import { describe, expect, it } from "vitest";
import type { EventModel, WeatherHour } from "../src/types/domain.js";
import { predictBestWindow, rainfallInPreviousHours, scoreEventAtHour } from "../src/utils/weather.js";

const model: EventModel = {
  id: "test-event",
  displayName: "Test fungal event",
  minimumRain48hMm: 10,
  temperatureRangeC: [10, 20],
  preferredTemperatureC: 15,
  minimumHumidityPct: 80,
  optimalPostRainHours: [24, 72],
  localVisibilityHours: [6, 10],
  ecologicalIndicators: ["Test indicator"],
};

function buildTimeline(): WeatherHour[] {
  const start = Date.UTC(2026, 7, 25, 6);
  return Array.from({ length: 80 }, (_, index) => ({
    lat: 40,
    lon: -74,
    timestamp: new Date(start + index * 60 * 60 * 1000),
    airTemperatureC: 15,
    soilSurfaceTemperatureC: 15,
    relativeHumidityPct: 95,
    precipitationMm: index === 0 ? 12 : 0,
  }));
}

describe("weather prediction engine", () => {
  it("calculates rolling 48-hour precipitation", () => {
    const timeline = buildTimeline();
    expect(rainfallInPreviousHours(timeline, 24, 48)).toBe(12);
    expect(rainfallInPreviousHours(timeline, 60, 48)).toBe(0);
  });

  it("scores an optimal post-rain window near 100", () => {
    const timeline = buildTimeline();
    expect(scoreEventAtHour(timeline, 24, model, 0)).toBeGreaterThanOrEqual(95);
  });

  it("returns the best future window", () => {
    const timeline = buildTimeline();
    const prediction = predictBestWindow(timeline, model, 0, timeline[1]?.timestamp);
    expect(prediction.modelId).toBe("test-event");
    expect(prediction.score).toBeGreaterThanOrEqual(95);
    expect(prediction.rain48hMm).toBe(12);
  });
});
