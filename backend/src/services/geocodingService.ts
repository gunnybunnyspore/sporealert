import axios from "axios";
import { env } from "../config/env.js";
import type { Coordinates } from "../types/domain.js";

const nameCache = new Map<string, string>();

export async function reverseGeocode(coordinates: Coordinates): Promise<string> {
  const key = `${coordinates.lat.toFixed(5)},${coordinates.lon.toFixed(5)}`;
  const cached = nameCache.get(key);
  if (cached) return cached;

  const response = await axios.get<{ display_name?: string; name?: string }>(
    `${env.NOMINATIM_BASE_URL}/reverse`,
    {
      timeout: 6_000,
      headers: { "User-Agent": env.NOMINATIM_USER_AGENT },
      params: {
        lat: coordinates.lat,
        lon: coordinates.lon,
        format: "jsonv2",
        zoom: 16,
      },
    },
  );
  const name = response.data.name ?? response.data.display_name?.split(",")[0] ?? "Unnamed habitat";
  nameCache.set(key, name);
  return name;
}
