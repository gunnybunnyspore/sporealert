# SporeAlert Backend

Production-oriented TypeScript API for legal fungal phenology and micro-weather analytics. It scores weather conditions for occupied 5 km PostGIS grid cells, ranks nearby habitats, caches external weather responses, and can send threshold alerts through Twilio.

The service is educational environmental software. It does not identify fungi or certify specimens as edible. Never consume a wild fungus based on an app prediction.

## Stack

- Node.js 20+, Express, TypeScript
- PostgreSQL + PostGIS
- OpenWeatherMap current weather and five-day forecast
- Open-Meteo fallback when a new or unavailable OpenWeather key cannot serve requests
- OpenStreetMap Nominatim reverse geocoding
- Twilio SMS and `node-cron`
- Supabase Edge Function production runtime

## Run locally

```bash
cp .env.example .env
docker compose up -d
npm run dev
```

Set `OPENWEATHER_API_KEY` and a descriptive `NOMINATIM_USER_AGENT`. Twilio variables are optional; the scheduler runs without sending SMS when they are absent.

## Commands

```bash
npm run typecheck
npm test
npm run build
npm start
```

## API

Live API base:

```text
https://vktgxmqfwxioeyohlmdc.supabase.co/functions/v1/sporealert
```

### `GET /api/weather/predict`

```bash
curl "http://localhost:4000/api/weather/predict?lat=40.75&lon=-73.98&radius_km=10"
```

`radius` is also accepted as an alias for `radius_km`. Each result includes both `confidenceScore` and the integration-friendly alias `probability_score`.

The response contains ranked habitats, distance, predicted peak time, confidence, event model, ecological indicators, weather source, and a safety notice.

### `POST /api/notify/subscribe`

```bash
curl -X POST http://localhost:4000/api/notify/subscribe \
  -H 'Content-Type: application/json' \
  -d '{
    "user_id":"d4cb54dc-ff6b-4a69-a3bb-27494555d777",
    "phone_number":"+15555550123",
    "lat":40.75,
    "lon":-73.98
  }'
```

One process-wide cron task checks active subscriptions every six hours. This is more reliable than creating an in-memory cron task per user and remains safe across restarts.

The production Edge Function exposes the same subscription and sweep routes. Call `POST /api/notify/sweep` every six hours from Supabase `pg_cron`/`pg_net`, using `Authorization: Bearer <CRON_SECRET>`.

## Production deployment

The verified no-card deployment runs from `../supabase/functions/sporealert/index.ts`. The original Express service and Docker image remain available for conventional container deployment. Apply `schema.sql` and `seed.sql`, set Edge Function secrets, then deploy with:

```bash
supabase functions deploy sporealert --project-ref <project-ref> --no-verify-jwt
```

Verified on August 25, 2026:

- `GET /health` returned HTTP 200.
- `GET /health/ready` returned HTTP 200 with a connected database.
- The Windsor test request returned Northwest Park & Open Space, 4.41 km away, with a nonzero probability score.
- A sanitized full response is saved in `live-response.json`.

## Data model and geospatial behavior

- `hotspots.location`, `users.location`, and observations use `GEOGRAPHY(POINT, 4326)`.
- Candidate lookup uses indexed `ST_DWithin` rather than buffering geometries.
- POIs are restricted to park, nature reserve, pond, and riverbank records.
- `highway`, `industrial`, and `commercial` records are excluded through OSM-style JSONB tags.
- Occupied POIs are grouped into projected 5 km grid cells before weather scoring.
- A request evaluates at most 25 occupied cells to protect external API quotas.

Nominatim is used only to reverse-geocode unnamed records. Bulk POI population should come from a regional OSM extract or another permitted import pipeline, not repeated Nominatim searches.

## Rainfall history and fallback

OpenWeatherMap's standard forecast is three-hourly, so the service expands each period into hourly estimates. Every live request stores the current observation. Those observations provide the rolling prior 48-hour rainfall window over time.

If OpenWeatherMap fails or a newly issued key is still activating, the service uses Open-Meteo immediately. The Express runtime then falls back to its memory cache and PostgreSQL cache if both providers are unavailable. Responses expose `weatherSource` so clients can communicate provenance and freshness.

## Event models

Default models cover chanterelle-type and oyster-mushroom-type environmental conditions. Their continuous score combines rainfall, estimated soil-surface temperature, humidity, time since rain, and local hour. Models live in `src/config/models.ts` and can be extended for other legal ecological events.
