import postgres from "npm:postgres@3.4.7";

type Coordinates = { lat: number; lon: number };
type WeatherHour = Coordinates & {
  timestamp: Date;
  airTemperatureC: number;
  soilSurfaceTemperatureC: number;
  relativeHumidityPct: number;
  precipitationMm: number;
};
type EventModel = {
  id: string;
  displayName: string;
  minimumRain48hMm: number;
  temperatureRangeC: [number, number];
  preferredTemperatureC: number;
  minimumHumidityPct: number;
  optimalPostRainHours: [number, number];
  localVisibilityHours: [number, number];
  ecologicalIndicators: string[];
};
type Hotspot = Coordinates & {
  id: string;
  name: string;
  type: string;
  distanceKm: number;
  moistureScore: number;
  gridLat: number;
  gridLon: number;
};

const databaseUrl = Deno.env.get("DATABASE_URL");
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const sql = postgres(databaseUrl, { max: 3, idle_timeout: 20, connect_timeout: 10 });
const openWeatherKey = Deno.env.get("OPENWEATHER_API_KEY") ?? "";
const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? Deno.env.get("TWILIO_SID") ?? "";
const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const twilioFrom = Deno.env.get("TWILIO_FROM_NUMBER") ?? Deno.env.get("TWILIO_PHONE") ?? "";

const models: EventModel[] = [
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

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" },
  });
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function estimateSoilTemperature(air: number, timestamp: Date, offset: number, cloud = 50): number {
  const localHour = new Date(timestamp.getTime() + offset * 1000).getUTCHours();
  const daytimeOffset = localHour >= 8 && localHour <= 18 ? 1.5 : -0.5;
  return Number((air + daytimeOffset * ((100 - cloud) / 100)).toFixed(1));
}

function rainfallInPreviousHours(timeline: WeatherHour[], index: number, hours: number): number {
  const current = timeline[index];
  if (!current) return 0;
  const start = current.timestamp.getTime() - hours * 3_600_000;
  return timeline.reduce((total, point, pointIndex) => {
    const time = point.timestamp.getTime();
    return pointIndex <= index && time >= start && time <= current.timestamp.getTime()
      ? total + point.precipitationMm
      : total;
  }, 0);
}

function hoursSinceRain(timeline: WeatherHour[], index: number): number {
  const current = timeline[index];
  if (!current) return Number.POSITIVE_INFINITY;
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const point = timeline[cursor];
    if (point && point.precipitationMm >= 1) {
      return (current.timestamp.getTime() - point.timestamp.getTime()) / 3_600_000;
    }
  }
  return Number.POSITIVE_INFINITY;
}

function scoreHour(timeline: WeatherHour[], index: number, model: EventModel, offset: number): number {
  const point = timeline[index];
  if (!point) return 0;
  const rainScore = clamp(rainfallInPreviousHours(timeline, index, 48) / model.minimumRain48hMm);
  const [minimum, maximum] = model.temperatureRangeC;
  const temperatureScore = point.soilSurfaceTemperatureC <= minimum || point.soilSurfaceTemperatureC >= maximum
    ? 0
    : point.soilSurfaceTemperatureC < model.preferredTemperatureC
    ? (point.soilSurfaceTemperatureC - minimum) / (model.preferredTemperatureC - minimum)
    : (maximum - point.soilSurfaceTemperatureC) / (maximum - model.preferredTemperatureC);
  const humidityScore = clamp((point.relativeHumidityPct - (model.minimumHumidityPct - 20)) / 20);
  const sinceRain = hoursSinceRain(timeline, index);
  const [windowStart, windowEnd] = model.optimalPostRainHours;
  const postRainScore = sinceRain >= windowStart && sinceRain <= windowEnd
    ? 1
    : sinceRain < windowStart
    ? clamp(sinceRain / windowStart)
    : clamp(1 - (sinceRain - windowEnd) / Math.max(windowEnd, 12));
  const localHour = new Date(point.timestamp.getTime() + offset * 1000).getUTCHours();
  const visibilityScore = localHour >= model.localVisibilityHours[0] && localHour <= model.localVisibilityHours[1]
    ? 1
    : 0.65;
  return Math.round(clamp(
    rainScore * 0.3 + temperatureScore * 0.25 + humidityScore * 0.2 + postRainScore * 0.2 + visibilityScore * 0.05,
  ) * 100);
}

function predictBestWindow(timeline: WeatherHour[], model: EventModel, offset: number) {
  const candidates = timeline
    .map((point, index) => ({ point, index }))
    .filter(({ point }) => point.timestamp >= new Date())
    .slice(0, 72)
    .map(({ point, index }) => ({ point, index, score: scoreHour(timeline, index, model, offset) }));
  const best = candidates.reduce(
    (winner, candidate) => candidate.score > winner.score ? candidate : winner,
    candidates[0] ?? { point: timeline.at(-1), index: Math.max(0, timeline.length - 1), score: 0 },
  );
  return {
    modelId: model.id,
    eventName: model.displayName,
    score: best.score,
    peakTime: best.point?.timestamp ?? new Date(),
    ecologicalIndicators: model.ecologicalIndicators,
  };
}

async function openMeteoTimeline(coordinates: Coordinates) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(coordinates.lat),
    longitude: String(coordinates.lon),
    hourly: "temperature_2m,relative_humidity_2m,precipitation,cloud_cover",
    past_days: "2",
    forecast_days: "4",
    timezone: "GMT",
  }).toString();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`);
  const data = await response.json();
  const offset = Number(data.utc_offset_seconds ?? 0);
  const hours: WeatherHour[] = data.hourly.time.map((time: string, index: number) => {
    const timestamp = new Date(`${time}Z`);
    const air = Number(data.hourly.temperature_2m[index] ?? 0);
    return {
      ...coordinates,
      timestamp,
      airTemperatureC: air,
      soilSurfaceTemperatureC: estimateSoilTemperature(air, timestamp, offset, Number(data.hourly.cloud_cover[index] ?? 50)),
      relativeHumidityPct: Number(data.hourly.relative_humidity_2m[index] ?? 0),
      precipitationMm: Number(data.hourly.precipitation[index] ?? 0),
    };
  });
  return { offset, hours, source: "open-meteo" };
}

async function openWeatherTimeline(coordinates: Coordinates) {
  if (!openWeatherKey) throw new Error("OpenWeather key is unavailable");
  const params = new URLSearchParams({
    lat: String(coordinates.lat),
    lon: String(coordinates.lon),
    appid: openWeatherKey,
    units: "metric",
  });
  const [currentResponse, forecastResponse] = await Promise.all([
    fetch(`https://api.openweathermap.org/data/2.5/weather?${params}`),
    fetch(`https://api.openweathermap.org/data/2.5/forecast?${params}`),
  ]);
  if (!currentResponse.ok || !forecastResponse.ok) throw new Error("OpenWeather is not ready");
  const current = await currentResponse.json();
  const forecast = await forecastResponse.json();
  const offset = Number(forecast.city?.timezone ?? current.timezone ?? 0);
  const currentTimestamp = new Date(Number(current.dt) * 1000);
  const hours: WeatherHour[] = [{
    ...coordinates,
    timestamp: currentTimestamp,
    airTemperatureC: Number(current.main.temp),
    soilSurfaceTemperatureC: estimateSoilTemperature(Number(current.main.temp), currentTimestamp, offset, Number(current.clouds?.all ?? 50)),
    relativeHumidityPct: Number(current.main.humidity),
    precipitationMm: Number(current.rain?.["1h"] ?? 0),
  }];
  for (const item of forecast.list ?? []) {
    const totalRain = Number(item.rain?.["3h"] ?? 0);
    for (let hour = 0; hour < 3; hour += 1) {
      const timestamp = new Date((Number(item.dt) + hour * 3600) * 1000);
      const air = Number(item.main.temp);
      hours.push({
        ...coordinates,
        timestamp,
        airTemperatureC: air,
        soilSurfaceTemperatureC: estimateSoilTemperature(air, timestamp, offset, Number(item.clouds?.all ?? 50)),
        relativeHumidityPct: Number(item.main.humidity),
        precipitationMm: totalRain / 3,
      });
    }
  }
  return { offset, hours, source: "openweather" };
}

async function weatherTimeline(coordinates: Coordinates) {
  try {
    return await openWeatherTimeline(coordinates);
  } catch {
    return await openMeteoTimeline(coordinates);
  }
}

async function nearbyHotspots(coordinates: Coordinates, radiusKm: number): Promise<Hotspot[]> {
  const rows = await sql.unsafe(`
    WITH filtered AS (
      SELECT id, name, type, location, moisture_score,
             ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000.0 AS distance_km,
             ST_Transform(ST_Translate(ST_SnapToGrid(ST_Transform(location::geometry, 3857), 5000, 5000), 2500, 2500), 4326) AS grid_center
        FROM hotspots
       WHERE type::text = ANY($4::text[])
         AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3 * 1000)
         AND NOT (tags ? 'highway')
         AND COALESCE(tags->>'landuse', '') NOT IN ('industrial', 'commercial')
    )
    SELECT id::text, COALESCE(name, 'Unnamed habitat') AS name, type::text,
           ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon,
           distance_km, moisture_score, ST_Y(grid_center) AS grid_lat, ST_X(grid_center) AS grid_lon
      FROM filtered ORDER BY distance_km ASC, moisture_score DESC LIMIT 100
  `, [coordinates.lon, coordinates.lat, radiusKm, ["park", "nature_reserve", "pond", "riverbank"]]);
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    type: String(row.type),
    lat: Number(row.lat),
    lon: Number(row.lon),
    distanceKm: Number(row.distance_km),
    moistureScore: Number(row.moisture_score),
    gridLat: Number(row.grid_lat),
    gridLon: Number(row.grid_lon),
  }));
}

async function predict(coordinates: Coordinates, radiusKm: number) {
  const candidates = await nearbyHotspots(coordinates, radiusKm);
  const cellMap = new Map<string, Coordinates>();
  for (const candidate of candidates) {
    cellMap.set(`${candidate.gridLat.toFixed(5)},${candidate.gridLon.toFixed(5)}`, {
      lat: candidate.gridLat,
      lon: candidate.gridLon,
    });
  }
  const cellPredictions = new Map<string, { source: string; predictions: ReturnType<typeof predictBestWindow>[] }>();
  await Promise.all([...cellMap.entries()].slice(0, 25).map(async ([key, cell]) => {
    const timeline = await weatherTimeline(cell);
    cellPredictions.set(key, {
      source: timeline.source,
      predictions: models.map((model) => predictBestWindow(timeline.hours, model, timeline.offset)),
    });
  }));
  const hotspots = candidates.flatMap((candidate) => {
    const cell = cellPredictions.get(`${candidate.gridLat.toFixed(5)},${candidate.gridLon.toFixed(5)}`);
    if (!cell) return [];
    const best = cell.predictions.reduce((winner, item) => item.score > winner.score ? item : winner);
    const confidenceScore = Math.round(best.score * 0.85 + clamp(candidate.moistureScore, 0, 100) * 0.15);
    return [{
      id: candidate.id,
      spotName: candidate.name,
      type: candidate.type,
      lat: candidate.lat,
      lon: candidate.lon,
      distanceKm: Number(candidate.distanceKm.toFixed(2)),
      predictedPeakTime: best.peakTime,
      confidenceScore,
      probability_score: confidenceScore,
      eventPrediction: best.eventName,
      ecologicalIndicators: best.ecologicalIndicators,
    }];
  }).sort((left, right) => right.confidenceScore - left.confidenceScore || left.distanceKm - right.distanceKm);
  return {
    generatedAt: new Date(),
    weatherSource: cellPredictions.values().next().value?.source ?? "unavailable",
    searchRadiusKm: radiusKm,
    hotspots,
    safetyNotice: "Environmental estimates are not a substitute for expert fungal identification. Never consume a wild specimen based on this service.",
  };
}

async function subscribe(request: Request) {
  const body = await request.json();
  if (!/^[0-9a-f-]{36}$/i.test(body.user_id ?? "") || !/^\+[1-9]\d{7,14}$/.test(body.phone_number ?? "")) {
    return json({ error: "Use a UUID user_id and an E.164 phone_number" }, 400);
  }
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return json({ error: "Invalid coordinates" }, 400);
  }
  await sql.begin(async (transaction) => {
    await transaction.unsafe(`
      INSERT INTO users (id, phone, lat, lon, location)
      VALUES ($1::uuid, $2, $3, $4, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography)
      ON CONFLICT (id) DO UPDATE SET phone = EXCLUDED.phone, lat = EXCLUDED.lat, lon = EXCLUDED.lon,
        location = EXCLUDED.location, updated_at = NOW()
    `, [body.user_id, body.phone_number, lat, lon]);
    await transaction.unsafe(`
      INSERT INTO alert_subscriptions (user_id, radius_km, threshold, active)
      VALUES ($1::uuid, 10, 80, TRUE)
      ON CONFLICT (user_id) DO UPDATE SET active = TRUE, updated_at = NOW()
    `, [body.user_id]);
  });
  return json({ subscribed: true, checkInterval: "Every 6 hours", threshold: 80 }, 201);
}

async function sendTwilioMessage(to: string, body: string) {
  if (!twilioSid || !twilioToken || !twilioFrom) return false;
  const form = new URLSearchParams({ To: to, From: twilioFrom, Body: body });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  if (!response.ok) throw new Error(`Twilio returned ${response.status}`);
  return true;
}

async function sweep(request: Request) {
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return json({ error: "Unauthorized" }, 401);
  }
  const subscriptions = await sql.unsafe(`
    SELECT s.user_id::text, u.phone, u.lat, u.lon, s.radius_km, s.threshold
      FROM alert_subscriptions s JOIN users u ON u.id = s.user_id
     WHERE s.active = TRUE
       AND (s.last_notified_at IS NULL OR s.last_notified_at < NOW() - INTERVAL '6 hours')
  `);
  let sent = 0;
  for (const subscription of subscriptions) {
    const result = await predict({ lat: Number(subscription.lat), lon: Number(subscription.lon) }, Number(subscription.radius_km));
    const top = result.hotspots.find((hotspot) => hotspot.confidenceScore >= Number(subscription.threshold));
    if (!top) continue;
    const delivered = await sendTwilioMessage(
      String(subscription.phone),
      `🍄 SporeAlert: favorable ${top.eventPrediction.toLowerCase()} near ${top.spotName}. Confidence: ${top.confidenceScore}%. Never consume wild fungi based on this alert.`,
    );
    if (delivered) {
      sent += 1;
      await sql.unsafe("UPDATE alert_subscriptions SET last_notified_at = NOW(), updated_at = NOW() WHERE user_id = $1::uuid", [subscription.user_id]);
    }
  }
  return json({ completed: true, checked: subscriptions.length, sent, twilioConfigured: Boolean(twilioSid && twilioToken && twilioFrom) });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const pathname = new URL(request.url).pathname
    .replace(/^\/functions\/v1\/sporealert/, "")
    .replace(/^\/sporealert/, "") || "/";
  try {
    if (request.method === "GET" && pathname === "/health") {
      return json({ status: "ok", timestamp: new Date() });
    }
    if (request.method === "GET" && pathname === "/health/ready") {
      await sql`SELECT 1`;
      return json({ status: "ready", database: "connected", timestamp: new Date() });
    }
    if (request.method === "GET" && pathname === "/api/weather/predict") {
      const url = new URL(request.url);
      const lat = Number(url.searchParams.get("lat"));
      const lon = Number(url.searchParams.get("lon"));
      const radiusKm = Number(url.searchParams.get("radius_km") ?? url.searchParams.get("radius") ?? 10);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 50) {
        return json({ error: "Invalid lat, lon, or radius" }, 400);
      }
      return json(await predict({ lat, lon }, radiusKm));
    }
    if (request.method === "POST" && pathname === "/api/notify/subscribe") return await subscribe(request);
    if (request.method === "POST" && pathname === "/api/notify/sweep") return await sweep(request);
    return json({ error: "Not found" }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: "Request failed", detail: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
