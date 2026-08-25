import type { EventModel } from "../types/domain.js";

// Defaults intentionally cover legal, commonly observed fungal fruiting events.
export const eventModels: EventModel[] = [
  {
    id: "chanterelle",
    displayName: "Chanterelle-type fruiting conditions",
    minimumRain48hMm: 12,
    temperatureRangeC: [12, 22],
    preferredTemperatureC: 17,
    minimumHumidityPct: 80,
    optimalPostRainHours: [24, 96],
    localVisibilityHours: [6, 11],
    ecologicalIndicators: [
      "Moist forest floor near established trees",
      "Scattered growth rather than dense clusters",
      "Never consume a wild specimen based on this app",
    ],
  },
  {
    id: "oyster",
    displayName: "Oyster mushroom-type fruiting conditions",
    minimumRain48hMm: 8,
    temperatureRangeC: [8, 24],
    preferredTemperatureC: 16,
    minimumHumidityPct: 75,
    optimalPostRainHours: [12, 72],
    localVisibilityHours: [6, 11],
    ecologicalIndicators: [
      "Dead or stressed hardwood habitat",
      "Shelf-like clustered fruiting bodies",
      "Never consume a wild specimen based on this app",
    ],
  },
];
