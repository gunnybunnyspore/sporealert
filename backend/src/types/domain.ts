export type HabitatType = "park" | "nature_reserve" | "pond" | "riverbank";

export interface Coordinates {
  lat: number;
  lon: number;
}

export interface WeatherHour extends Coordinates {
  timestamp: Date;
  airTemperatureC: number;
  soilSurfaceTemperatureC: number;
  relativeHumidityPct: number;
  precipitationMm: number;
}

export interface WeatherTimeline {
  timezoneOffsetSeconds: number;
  hours: WeatherHour[];
  source: "live" | "memory-cache" | "database-cache";
}

export interface EventModel {
  id: string;
  displayName: string;
  minimumRain48hMm: number;
  temperatureRangeC: readonly [number, number];
  preferredTemperatureC: number;
  minimumHumidityPct: number;
  optimalPostRainHours: readonly [number, number];
  localVisibilityHours: readonly [number, number];
  ecologicalIndicators: string[];
}

export interface ModelPrediction {
  modelId: string;
  eventName: string;
  score: number;
  peakTime: Date;
  rain48hMm: number;
  ecologicalIndicators: string[];
}

export interface HotspotCandidate extends Coordinates {
  id: string;
  name: string | null;
  type: HabitatType;
  distanceKm: number;
  moistureScore: number;
  gridLat: number;
  gridLon: number;
}

export interface RankedHotspot extends Coordinates {
  id: string;
  spotName: string;
  type: HabitatType;
  distanceKm: number;
  predictedPeakTime: Date;
  confidenceScore: number;
  eventPrediction: string;
  ecologicalIndicators: string[];
}
