const GEOCODER_URL = "https://photon.komoot.io/api/";
const ROUTER_URL = "https://valhalla1.openstreetmap.de/route";

async function readJson(response, serviceName) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${serviceName} returned an unreadable response.`);
  }
  if (!response.ok) {
    const detail = typeof payload?.error === "string" ? payload.error : `HTTP ${response.status}`;
    throw new Error(`${serviceName} request failed: ${detail}`);
  }
  return payload;
}

async function findDestination(query, language) {
  const url = new URL(GEOCODER_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "1");
  url.searchParams.set("lang", language || "en");
  const response = await fetch(url, { headers: { Accept: "application/geo+json" } });
  const payload = await readJson(response, "OpenStreetMap place search");
  const feature = payload?.features?.[0];
  const coordinates = feature?.geometry?.coordinates;
  const [longitude, latitude] = Array.isArray(coordinates) ? coordinates : [];
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("No matching destination was found. Add a city or region and try again.");
  }
  const properties = feature.properties || {};
  const destinationName = [...new Set([
    properties.name,
    properties.street,
    properties.city || properties.county,
    properties.state,
    properties.country
  ].filter(Boolean))].join(", ") || query;
  return { latitude, longitude, destinationName };
}

export async function getWalkingRoute({ origin, destination, language = "en" }) {
  if (
    !Number.isFinite(origin?.latitude) || !Number.isFinite(origin?.longitude) ||
    origin.latitude < -90 || origin.latitude > 90 ||
    origin.longitude < -180 || origin.longitude > 180
  ) {
    throw new Error("The current location is invalid.");
  }
  if (typeof destination !== "string" || !destination.trim()) {
    throw new Error("Enter a destination to estimate a route.");
  }
  const place = await findDestination(destination.trim().slice(0, 120), language);
  const url = new URL(ROUTER_URL);
  url.searchParams.set("json", JSON.stringify({
    locations: [
      { lat: origin.latitude, lon: origin.longitude, type: "break" },
      { lat: place.latitude, lon: place.longitude, type: "break" }
    ],
    costing: "pedestrian",
    units: "kilometers"
  }));
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const payload = await readJson(response, "OpenStreetMap pedestrian router");
  const summary = payload?.trip?.summary;
  if (payload?.trip?.status !== 0 || !Number.isFinite(summary?.length) || !Number.isFinite(summary?.time)) {
    throw new Error(payload?.trip?.status_message || "A pedestrian route could not be calculated for these locations.");
  }
  if (summary.length <= 0 || summary.time <= 0) {
    throw new Error("The routing service returned an invalid distance or duration.");
  }
  return {
    destinationName: place.destinationName,
    distanceKm: summary.length,
    durationSeconds: summary.time
  };
}
