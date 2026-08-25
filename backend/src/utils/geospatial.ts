import type { HotspotCandidate } from "../types/domain.js";

export function gridKey(lat: number, lon: number): string {
  return `${lat.toFixed(5)},${lon.toFixed(5)}`;
}

export function combineEnvironmentalAndHabitatScores(
  environmentalScore: number,
  moistureScore: number,
): number {
  const normalizedMoisture = Math.min(100, Math.max(0, moistureScore));
  return Math.round(environmentalScore * 0.85 + normalizedMoisture * 0.15);
}

export function uniqueOccupiedGridCells(hotspots: HotspotCandidate[]): Array<{ lat: number; lon: number }> {
  const cells = new Map<string, { lat: number; lon: number }>();
  for (const hotspot of hotspots) {
    cells.set(gridKey(hotspot.gridLat, hotspot.gridLon), {
      lat: hotspot.gridLat,
      lon: hotspot.gridLon,
    });
  }
  return [...cells.values()];
}
