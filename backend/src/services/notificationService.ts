import cron, { type ScheduledTask } from "node-cron";
import twilio from "twilio";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { predictHotspots } from "./hotspotService.js";

const twilioClient = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN
  ? twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN)
  : null;

interface AlertSubscription {
  user_id: string;
  phone: string;
  lat: number;
  lon: number;
  radius_km: number;
  threshold: number;
}

export async function upsertSubscription(input: {
  userId: string;
  phoneNumber: string;
  lat: number;
  lon: number;
}): Promise<void> {
  await pool.query("BEGIN");
  try {
    await pool.query(
      `INSERT INTO users (id, phone, lat, lon, location)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography)
       ON CONFLICT (id) DO UPDATE
         SET phone = EXCLUDED.phone,
             lat = EXCLUDED.lat,
             lon = EXCLUDED.lon,
             location = EXCLUDED.location,
             updated_at = NOW()`,
      [input.userId, input.phoneNumber, input.lat, input.lon],
    );
    await pool.query(
      `INSERT INTO alert_subscriptions (user_id, radius_km, threshold, active)
       VALUES ($1, 10, 80, TRUE)
       ON CONFLICT (user_id) DO UPDATE
         SET active = TRUE, updated_at = NOW()`,
      [input.userId],
    );
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

async function sendAlert(subscription: AlertSubscription): Promise<void> {
  if (!twilioClient || !env.TWILIO_FROM_NUMBER) return;

  const prediction = await predictHotspots(
    { lat: Number(subscription.lat), lon: Number(subscription.lon) },
    Number(subscription.radius_km),
  );
  const top = prediction.hotspots.find((hotspot) => hotspot.confidenceScore >= subscription.threshold);
  if (!top) return;

  const peak = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(top.predictedPeakTime);

  await twilioClient.messages.create({
    from: env.TWILIO_FROM_NUMBER,
    to: subscription.phone,
    body: `🍄 SporeAlert: favorable ${top.eventPrediction.toLowerCase()} near ${top.spotName}. Peak window: ${peak}. Confidence: ${top.confidenceScore}%. Do not consume wild fungi based on this alert.`,
  });
  await pool.query(
    `UPDATE alert_subscriptions
        SET last_notified_at = NOW(), updated_at = NOW()
      WHERE user_id = $1`,
    [subscription.user_id],
  );
}

export async function runNotificationSweep(): Promise<void> {
  const result = await pool.query<AlertSubscription>(
    `SELECT s.user_id, u.phone, u.lat, u.lon, s.radius_km, s.threshold
       FROM alert_subscriptions s
       JOIN users u ON u.id = s.user_id
      WHERE s.active = TRUE
        AND (s.last_notified_at IS NULL OR s.last_notified_at < NOW() - INTERVAL '6 hours')`,
  );

  for (const subscription of result.rows) {
    await sendAlert(subscription).catch((error) => {
      console.error("Notification sweep failed for a subscription", error);
    });
  }
}

export function startNotificationScheduler(): ScheduledTask {
  return cron.schedule(env.ALERT_CRON, () => {
    void runNotificationSweep();
  });
}
