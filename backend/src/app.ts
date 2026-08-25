import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { notificationRouter } from "./routes/notificationRoutes.js";
import { weatherRouter } from "./routes/weatherRoutes.js";
import { env } from "./config/env.js";
import { checkDatabase } from "./db/pool.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "32kb" }));
  app.use(pinoHttp({ enabled: env.NODE_ENV !== "test" }));
  app.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true }));

  app.get("/health", (_request, response) => {
    response.json({ status: "ok", timestamp: new Date() });
  });
  app.get("/health/ready", async (_request, response) => {
    try {
      await checkDatabase();
      response.json({ status: "ready", database: "connected", timestamp: new Date() });
    } catch {
      response.status(503).json({ status: "not-ready", database: "unavailable", timestamp: new Date() });
    }
  });
  app.use("/api/weather", weatherRouter);
  app.use("/api/notify", notificationRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
