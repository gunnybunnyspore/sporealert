import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  OPENWEATHER_API_KEY: z.string().min(1),
  OPENWEATHER_BASE_URL: z.string().url().default("https://api.openweathermap.org"),
  NOMINATIM_BASE_URL: z.string().url().default("https://nominatim.openstreetmap.org"),
  NOMINATIM_USER_AGENT: z.string().min(8),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  ALERT_CRON: z.string().default("0 */6 * * *"),
  CRON_SECRET: z.string().min(24).optional(),
  WEATHER_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  MAX_SEARCH_RADIUS_KM: z.coerce.number().positive().max(100).default(50),
});

export type AppEnv = z.infer<typeof envSchema>;

export const env = envSchema.parse({
  ...process.env,
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID ?? process.env.TWILIO_SID,
  TWILIO_FROM_NUMBER: process.env.TWILIO_FROM_NUMBER ?? process.env.TWILIO_PHONE,
});
