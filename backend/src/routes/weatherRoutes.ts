import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { predictHotspots } from "../services/hotspotService.js";

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  radius_km: z.coerce.number().positive().max(env.MAX_SEARCH_RADIUS_KM).optional(),
  radius: z.coerce.number().positive().max(env.MAX_SEARCH_RADIUS_KM).optional(),
}).transform((input) => ({
  lat: input.lat,
  lon: input.lon,
  radiusKm: input.radius_km ?? input.radius ?? 10,
}));

export const weatherRouter = Router();

weatherRouter.get("/predict", async (request, response, next) => {
  try {
    const query = querySchema.parse(request.query);
    const prediction = await predictHotspots(
      { lat: query.lat, lon: query.lon },
      query.radiusKm,
    );
    response.json({
      generatedAt: new Date(),
      weatherSource: prediction.weatherSource,
      searchRadiusKm: query.radiusKm,
      hotspots: prediction.hotspots.map((hotspot) => ({
        ...hotspot,
        probability_score: hotspot.confidenceScore,
      })),
      safetyNotice: "Environmental estimates are not a substitute for expert fungal identification. Never consume a wild specimen based on this service.",
    });
  } catch (error) {
    next(error);
  }
});
