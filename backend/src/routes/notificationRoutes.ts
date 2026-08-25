import { Router } from "express";
import { z } from "zod";
import { upsertSubscription } from "../services/notificationService.js";
import { runNotificationSweep } from "../services/notificationService.js";
import { env } from "../config/env.js";
import { HttpError } from "../middleware/errorHandler.js";

const subscriptionSchema = z.object({
  user_id: z.string().uuid(),
  phone_number: z.string().regex(/^\+[1-9]\d{7,14}$/, "Use E.164 format, for example +15555550123"),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export const notificationRouter = Router();

notificationRouter.post("/subscribe", async (request, response, next) => {
  try {
    const input = subscriptionSchema.parse(request.body);
    await upsertSubscription({
      userId: input.user_id,
      phoneNumber: input.phone_number,
      lat: input.lat,
      lon: input.lon,
    });
    response.status(201).json({
      subscribed: true,
      checkInterval: "Every 6 hours",
      threshold: 80,
    });
  } catch (error) {
    next(error);
  }
});

notificationRouter.post("/sweep", async (request, response, next) => {
  try {
    if (!env.CRON_SECRET || request.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
      throw new HttpError(401, "Unauthorized");
    }
    await runNotificationSweep();
    response.json({ completed: true, timestamp: new Date() });
  } catch (error) {
    next(error);
  }
});
