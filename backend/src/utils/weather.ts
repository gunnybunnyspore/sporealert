import type { EventModel, ModelPrediction, WeatherHour } from "../types/domain.js";

const HOUR_MS = 60 * 60 * 1000;

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function triangularScore(value: number, minimum: number, optimum: number, maximum: number): number {
  if (value <= minimum || value >= maximum) return 0;
  if (value === optimum) return 1;
  return value < optimum
    ? (value - minimum) / (optimum - minimum)
    : (maximum - value) / (maximum - optimum);
}

function windowScore(value: number, minimum: number, maximum: number): number {
  if (value < 0) return 0;
  if (value >= minimum && value <= maximum) return 1;
  if (value < minimum) return clamp(value / minimum);
  return clamp(1 - (value - maximum) / Math.max(maximum, 12));
}

function localHour(timestamp: Date, timezoneOffsetSeconds: number): number {
  return new Date(timestamp.getTime() + timezoneOffsetSeconds * 1000).getUTCHours();
}

function hoursSinceRain(timeline: WeatherHour[], index: number): number {
  const current = timeline[index];
  if (!current) return Number.POSITIVE_INFINITY;

  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const point = timeline[cursor];
    if (point && point.precipitationMm >= 1) {
      return (current.timestamp.getTime() - point.timestamp.getTime()) / HOUR_MS;
    }
  }

  return Number.POSITIVE_INFINITY;
}

export function rainfallInPreviousHours(timeline: WeatherHour[], index: number, hours: number): number {
  const current = timeline[index];
  if (!current) return 0;
  const start = current.timestamp.getTime() - hours * HOUR_MS;

  return timeline.reduce((total, point, pointIndex) => {
    if (pointIndex > index) return total;
    const time = point.timestamp.getTime();
    return time >= start && time <= current.timestamp.getTime()
      ? total + point.precipitationMm
      : total;
  }, 0);
}

export function scoreEventAtHour(
  timeline: WeatherHour[],
  index: number,
  model: EventModel,
  timezoneOffsetSeconds: number,
): number {
  const point = timeline[index];
  if (!point) return 0;

  const rain48h = rainfallInPreviousHours(timeline, index, 48);
  const rainScore = clamp(rain48h / model.minimumRain48hMm);
  const temperatureScore = triangularScore(
    point.soilSurfaceTemperatureC,
    model.temperatureRangeC[0],
    model.preferredTemperatureC,
    model.temperatureRangeC[1],
  );
  const humidityScore = clamp(
    (point.relativeHumidityPct - (model.minimumHumidityPct - 20)) / 20,
  );
  const postRainScore = windowScore(
    hoursSinceRain(timeline, index),
    model.optimalPostRainHours[0],
    model.optimalPostRainHours[1],
  );
  const hour = localHour(point.timestamp, timezoneOffsetSeconds);
  const visibilityScore = hour >= model.localVisibilityHours[0] && hour <= model.localVisibilityHours[1]
    ? 1
    : 0.65;

  const weighted =
    rainScore * 0.3 +
    temperatureScore * 0.25 +
    humidityScore * 0.2 +
    postRainScore * 0.2 +
    visibilityScore * 0.05;

  return Math.round(clamp(weighted) * 100);
}

export function predictBestWindow(
  timeline: WeatherHour[],
  model: EventModel,
  timezoneOffsetSeconds: number,
  now = new Date(),
): ModelPrediction {
  const futureIndexes = timeline
    .map((point, index) => ({ point, index }))
    .filter(({ point }) => point.timestamp >= now)
    .slice(0, 72);

  const candidates = futureIndexes.map(({ point, index }) => ({
    point,
    index,
    score: scoreEventAtHour(timeline, index, model, timezoneOffsetSeconds),
  }));

  const best = candidates.reduce((winner, candidate) =>
    candidate.score > winner.score ? candidate : winner,
  candidates[0] ?? { point: timeline.at(-1), index: Math.max(0, timeline.length - 1), score: 0 });

  return {
    modelId: model.id,
    eventName: model.displayName,
    score: best.score,
    peakTime: best.point?.timestamp ?? now,
    rain48hMm: rainfallInPreviousHours(timeline, best.index, 48),
    ecologicalIndicators: model.ecologicalIndicators,
  };
}
