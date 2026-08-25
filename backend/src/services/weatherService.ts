import axios from "axios";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import type { Coordinates, WeatherHour, WeatherTimeline } from "../types/domain.js";

interface OpenWeatherCurrent {
  dt: number;
  timezone: number;
  main: { temp: number; humidity: number };
  rain?: { "1h"?: number };
  clouds?: { all?: number };
}

interface OpenWeatherForecastItem {
  dt: number;
  main: { temp: number; humidity: number };
  rain?: { "3h"?: number };
  clouds?: { all?: number };
}

interface OpenWeatherForecast {
  city: { timezone: number };
  list: OpenWeatherForecastItem[];
}

interface CacheEntry {
  expiresAt: number;
  timeline: WeatherTimeline;
}

const memoryCache = new Map<string, CacheEntry>();

function cacheKey({ lat, lon }: Coordinates): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

function estimateSoilSurfaceTemperature(
  airTemperatureC: number,
  timestamp: Date,
  timezoneOffsetSeconds: number,
  cloudCoverPct = 50,
): number {
  const localHour = new Date(timestamp.getTime() + timezoneOffsetSeconds * 1000).getUTCHours();
  const daytimeOffset = localHour >= 8 && localHour <= 18 ? 1.5 : -0.5;
  const cloudDamping = (100 - cloudCoverPct) / 100;
  return Number((airTemperatureC + daytimeOffset * cloudDamping).toFixed(1));
}

function expandThreeHourForecast(
  item: OpenWeatherForecastItem,
  coordinates: Coordinates,
  timezoneOffsetSeconds: number,
): WeatherHour[] {
  const totalRain = item.rain?.["3h"] ?? 0;
  return [0, 1, 2].map((hourOffset) => {
    const timestamp = new Date((item.dt + hourOffset * 3600) * 1000);
    return {
      ...coordinates,
      timestamp,
      airTemperatureC: item.main.temp,
      soilSurfaceTemperatureC: estimateSoilSurfaceTemperature(
        item.main.temp,
        timestamp,
        timezoneOffsetSeconds,
        item.clouds?.all,
      ),
      relativeHumidityPct: item.main.humidity,
      precipitationMm: totalRain / 3,
    };
  });
}

async function loadRecentObservations(coordinates: Coordinates): Promise<WeatherHour[]> {
  const result = await pool.query<{
    observed_at: Date;
    air_temperature_c: number;
    soil_temperature_c: number;
    humidity_pct: number;
    precipitation_mm: number;
  }>(
    `SELECT observed_at, air_temperature_c, soil_temperature_c, humidity_pct, precipitation_mm
       FROM weather_observations
      WHERE ST_DWithin(
        location,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
        7500
      )
        AND observed_at >= NOW() - INTERVAL '48 hours'
      ORDER BY observed_at ASC`,
    [coordinates.lon, coordinates.lat],
  );

  return result.rows.map((row) => ({
    ...coordinates,
    timestamp: row.observed_at,
    airTemperatureC: Number(row.air_temperature_c),
    soilSurfaceTemperatureC: Number(row.soil_temperature_c),
    relativeHumidityPct: Number(row.humidity_pct),
    precipitationMm: Number(row.precipitation_mm),
  }));
}

async function persistCurrentObservation(point: WeatherHour): Promise<void> {
  const gridKey = `${point.lat.toFixed(2)},${point.lon.toFixed(2)}`;
  await pool.query(
    `INSERT INTO weather_observations (
       grid_key, location, observed_at, air_temperature_c, soil_temperature_c,
       humidity_pct, precipitation_mm
     ) VALUES (
       $1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
       $4, $5, $6, $7, $8
     )
     ON CONFLICT (grid_key, observed_at) DO NOTHING`,
    [
      gridKey,
      point.lon,
      point.lat,
      point.timestamp,
      point.airTemperatureC,
      point.soilSurfaceTemperatureC,
      point.relativeHumidityPct,
      point.precipitationMm,
    ],
  );
}

async function persistTimelineCache(key: string, timeline: WeatherTimeline): Promise<void> {
  await pool.query(
    `INSERT INTO weather_cache (cache_key, payload, expires_at)
     VALUES ($1, $2::jsonb, NOW() + ($3 * INTERVAL '1 second'))
     ON CONFLICT (cache_key) DO UPDATE
       SET payload = EXCLUDED.payload,
           expires_at = EXCLUDED.expires_at,
           updated_at = NOW()`,
    [key, JSON.stringify(timeline), env.WEATHER_CACHE_TTL_SECONDS],
  );
}

async function loadDatabaseCache(key: string): Promise<WeatherTimeline | null> {
  const result = await pool.query<{ payload: WeatherTimeline }>(
    `SELECT payload
       FROM weather_cache
      WHERE cache_key = $1
        AND expires_at > NOW() - INTERVAL '12 hours'`,
    [key],
  );
  const cached = result.rows[0]?.payload;
  if (!cached) return null;

  return {
    ...cached,
    source: "database-cache",
    hours: cached.hours.map((hour) => ({ ...hour, timestamp: new Date(hour.timestamp) })),
  };
}

export async function getWeatherTimeline(coordinates: Coordinates): Promise<WeatherTimeline> {
  const key = cacheKey(coordinates);
  const cached = memoryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.timeline, source: "memory-cache" };
  }

  try {
    const commonParams = {
      lat: coordinates.lat,
      lon: coordinates.lon,
      appid: env.OPENWEATHER_API_KEY,
      units: "metric",
    };
    const client = axios.create({ baseURL: env.OPENWEATHER_BASE_URL, timeout: 8_000 });
    const [currentResponse, forecastResponse, history] = await Promise.all([
      client.get<OpenWeatherCurrent>("/data/2.5/weather", { params: commonParams }),
      client.get<OpenWeatherForecast>("/data/2.5/forecast", { params: commonParams }),
      loadRecentObservations(coordinates),
    ]);

    const current = currentResponse.data;
    const timezoneOffsetSeconds = forecastResponse.data.city.timezone ?? current.timezone;
    const currentTimestamp = new Date(current.dt * 1000);
    const currentPoint: WeatherHour = {
      ...coordinates,
      timestamp: currentTimestamp,
      airTemperatureC: current.main.temp,
      soilSurfaceTemperatureC: estimateSoilSurfaceTemperature(
        current.main.temp,
        currentTimestamp,
        timezoneOffsetSeconds,
        current.clouds?.all,
      ),
      relativeHumidityPct: current.main.humidity,
      precipitationMm: current.rain?.["1h"] ?? 0,
    };

    const forecast = forecastResponse.data.list.flatMap((item) =>
      expandThreeHourForecast(item, coordinates, timezoneOffsetSeconds),
    );
    const byTimestamp = new Map<number, WeatherHour>();
    for (const point of [...history, currentPoint, ...forecast]) {
      byTimestamp.set(point.timestamp.getTime(), point);
    }

    const timeline: WeatherTimeline = {
      timezoneOffsetSeconds,
      hours: [...byTimestamp.values()].sort(
        (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
      ),
      source: "live",
    };

    memoryCache.set(key, {
      expiresAt: Date.now() + env.WEATHER_CACHE_TTL_SECONDS * 1000,
      timeline,
    });
    await Promise.allSettled([
      persistCurrentObservation(currentPoint),
      persistTimelineCache(key, timeline),
    ]);
    return timeline;
  } catch (error) {
    const databaseCache = await loadDatabaseCache(key);
    if (databaseCache) return databaseCache;
    throw error;
  }
}
