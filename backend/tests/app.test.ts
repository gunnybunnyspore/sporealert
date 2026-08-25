import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("HTTP API", () => {
  const app = createApp();

  it("reports health", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
  });

  it("rejects invalid prediction coordinates before external calls", async () => {
    const response = await request(app)
      .get("/api/weather/predict")
      .query({ lat: 200, lon: -74, radius_km: 10 });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid request");
  });

  it("validates E.164 phone numbers", async () => {
    const response = await request(app)
      .post("/api/notify/subscribe")
      .send({
        user_id: "d4cb54dc-ff6b-4a69-a3bb-27494555d777",
        phone_number: "555-1234",
        lat: 40,
        lon: -74,
      });
    expect(response.status).toBe(400);
  });
});
