import { pool } from "../db/pool.js";
import type { Coordinates, HotspotCandidate, ModelPrediction, RankedHotspot } from "../types/domain.js";
import { eventModels } from "../config/models.js";
import { getWeatherTimeline } from "./weatherService.js";
import { reverseGeocode } from "./geocodingService.js";
import { combineEnvironmentalAndHabitatScores, gridKey, uniqueOccupiedGridCells } from "../utils/geospatial.js";
import { predictBestWindow } from "../utils/weather.js";

export async function findNearbyHotspots(
  coordinates: Coordinates,
  radiusKm: number,
): Promise<HotspotCandidate[]> {
  const result = await pool.query<{
    id: string;
    name: string | null;
    type: HotspotCandidate["type"];
    lat: number;
    lon: number;
    distance_km: number;
    moisture_score: number;
    grid_lat: number;
    grid_lon: number;
  }>(
    `WITH filtered AS (
       SELECT id, name, type, location, moisture_score,
              ST_Distance(
                location,
                ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
              ) / 1000.0 AS distance_km,
              ST_Transform(
                ST_Translate(
                  ST_SnapToGrid(ST_Transform(location::geometry, 3857), 5000, 5000),
                  2500,
                  2500
                ),
                4326
              ) AS grid_center
         FROM hotspots
        WHERE type::text = ANY($4::text[])
          AND ST_DWithin(
            location,
            ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
            $3 * 1000
          )
          AND NOT (tags ? 'highway')
          AND COALESCE(tags->>'landuse', '') NOT IN ('industrial', 'commercial')
     )
     SELECT id, name, type,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lon,
            distance_km, moisture_score,
            ST_Y(grid_center) AS grid_lat,
            ST_X(grid_center) AS grid_lon
       FROM filtered
      ORDER BY distance_km ASC, moisture_score DESC
      LIMIT 100`,
    [coordinates.lon, coordinates.lat, radiusKm, ["park", "nature_reserve", "pond", "riverbank"]],
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    lat: Number(row.lat),
    lon: Number(row.lon),
    distanceKm: Number(row.distance_km),
    moistureScore: Number(row.moisture_score),
    gridLat: Number(row.grid_lat),
    gridLon: Number(row.grid_lon),
  }));
}

async function persistPredictions(
  hotspot: HotspotCandidate,
  predictions: ModelPrediction[],
): Promise<void> {
  await Promise.all(predictions.map((prediction) =>
    pool.query(
      `INSERT INTO predictions (hotspot_id, predicted_for, score, event_model)
       VALUES ($1, $2, $3, $4)`,
      [hotspot.id, prediction.peakTime, prediction.score, prediction.modelId],
    ),
  ));
}

export async function predictHotspots(
  coordinates: Coordinates,
  radiusKm: number,
): Promise<{ hotspots: RankedHotspot[]; weatherSource: string }> {
  const candidates = await findNearbyHotspots(coordinates, radiusKm);
  if (candidates.length === 0) return { hotspots: [], weatherSource: "unavailable" };

  // Limit external requests while still scoring every occupied cell represented in the result set.
  const cells = uniqueOccupiedGridCells(candidates).slice(0, 25);
  const cellPredictions = new Map<string, { predictions: ModelPrediction[]; source: string }>();

  // Four workers keep latency reasonable without creating a burst of dozens of API calls.
  let nextCellIndex = 0;
  const workers = Array.from({ length: Math.min(4, cells.length) }, async () => {
    while (nextCellIndex < cells.length) {
      const cell = cells[nextCellIndex];
      nextCellIndex += 1;
      if (!cell) continue;
      const timeline = await getWeatherTimeline(cell);
      cellPredictions.set(gridKey(cell.lat, cell.lon), {
        source: timeline.source,
        predictions: eventModels.map((model) =>
          predictBestWindow(timeline.hours, model, timeline.timezoneOffsetSeconds),
        ),
      });
    }
  });
  await Promise.all(workers);

  const ranked: RankedHotspot[] = [];
  for (const candidate of candidates) {
    const cell = cellPredictions.get(gridKey(candidate.gridLat, candidate.gridLon));
    if (!cell) continue;
    const best = cell.predictions.reduce((winner, prediction) =>
      prediction.score > winner.score ? prediction : winner,
    );
    const name = candidate.name ?? await reverseGeocode(candidate).catch(() => "Unnamed habitat");
    ranked.push({
      id: candidate.id,
      spotName: name,
      type: candidate.type,
      lat: candidate.lat,
      lon: candidate.lon,
      distanceKm: Number(candidate.distanceKm.toFixed(2)),
      predictedPeakTime: best.peakTime,
      confidenceScore: combineEnvironmentalAndHabitatScores(best.score, candidate.moistureScore),
      eventPrediction: best.eventName,
      ecologicalIndicators: best.ecologicalIndicators,
    });
    void persistPredictions(candidate, cell.predictions).catch(() => undefined);
  }

  ranked.sort((left, right) => right.confidenceScore - left.confidenceScore || left.distanceKm - right.distanceKm);
  return {
    hotspots: ranked,
    weatherSource: cellPredictions.values().next().value?.source ?? "unavailable",
  };
}
