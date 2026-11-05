import { Coordinates } from "@/types/pelletGalicia";

export interface GaliciaPlaceResult {
  id: string;
  title: string; // Nombre del Lugar/Aldea (ej. "Outeiro" o "Casasoá")
  subtitle: string; // Parroquia / Concello y Provincia (ej. "Rairiz de Veiga (Ourense)")
  fullLabel: string; // "Outeiro — Rairiz de Veiga (Ourense)"
  lat: number;
  lng: number;
  source: "IGN CartoCiudad" | "Photon (OSM)" | "Nominatim";
  type?: string;
}

export interface ReverseGeocodeResult {
  fullAddress: string;
  placeName: string;
  concello: string;
  province: string;
}

export interface GoogleSearchResultItem {
  id: string;
  title: string;
  subtitle: string;
  fullAddress: string;
  lat: number;
  lng: number;
  source: string;
  categoryType?: "business" | "hamlet" | "municipality";
  categoryLabel?: string;
}

/**
 * Consulta el endpoint /api/search-google-maps en el backend de Next.js.
 * Utiliza Google Places API si hay clave configurada o fallback automático rural de Galicia.
 */
export async function searchGoogleMapsLive(
  query: string,
  apiKey?: string
): Promise<GoogleSearchResultItem[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) return [];

  try {
    const keyParam = apiKey ? `&apiKey=${encodeURIComponent(apiKey)}` : "";
    const res = await fetch(
      `/api/search-google-maps?q=${encodeURIComponent(trimmed)}${keyParam}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (data.success && Array.isArray(data.results)) {
      return data.results;
    }
    return [];
  } catch (err) {
    console.error("Error en búsqueda Google Maps Live:", err);
    return [];
  }
}

// Bounding Box geográfico estricto de Galicia
export const GALICIA_BBOX = {
  minLon: -9.35,
  minLat: 41.80,
  maxLon: -6.70,
  maxLat: 43.85,
} as const;

function isInsideGalicia(lat: number, lng: number): boolean {
  return (
    lat >= GALICIA_BBOX.minLat &&
    lat <= GALICIA_BBOX.maxLat &&
    lng >= GALICIA_BBOX.minLon &&
    lng <= GALICIA_BBOX.maxLon
  );
}

/**
 * FUENTE 1: CartoCiudad IGN (Instituto Geográfico Nacional de España).
 * Especializado en toponimia oficial de poblaciones, aldeas y concellos.
 */
async function searchCartoCiudad(query: string): Promise<GaliciaPlaceResult[]> {
  try {
    const trimmed = query.trim();
    const url = `https://www.cartociudad.es/geocoder/api/geocoder/find?q=${encodeURIComponent(
      trimmed
    )}`;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3500),
    });

    if (!res.ok) return [];
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("json")) return [];
    const data = await res.json();

    if (!data || !data.lat || !data.lng || data.lat === 0) return [];

    const lat = Number(parseFloat(data.lat).toFixed(6));
    const lng = Number(parseFloat(data.lng).toFixed(6));

    if (!isInsideGalicia(lat, lng)) return [];

    const place = data.poblacion || data.address || query;
    const muni = data.muni || "";
    const province = data.province || "";

    const subtitle = muni
      ? province
        ? `${muni} (${province})`
        : muni
      : province || "Galicia";

    return [
      {
        id: `ign-${data.id || Math.random()}`,
        title: place,
        subtitle,
        fullLabel: `${place} — ${subtitle}`,
        lat,
        lng,
        source: "IGN CartoCiudad",
        type: data.type || "poboación",
      },
    ];
  } catch {
    return [];
  }
}

/**
 * FUENTE 2: Photon API (Komoot / OpenStreetMap).
 * Excelente indexación de aldeas (hamlet), parroquias, fincas y caminos rurales.
 */
async function searchPhoton(query: string): Promise<GaliciaPlaceResult[]> {
  try {
    const trimmed = query.trim();
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(
      trimmed
    )}&bbox=${GALICIA_BBOX.minLon},${GALICIA_BBOX.minLat},${GALICIA_BBOX.maxLon},${GALICIA_BBOX.maxLat}&limit=8`;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3500),
    });

    if (!res.ok) return [];
    const json = await res.json();
    const features = json.features || [];

    const results: GaliciaPlaceResult[] = [];

    for (const f of features) {
      const coords = f.geometry?.coordinates;
      if (!coords || coords.length < 2) continue;

      const lng = Number(coords[0].toFixed(6));
      const lat = Number(coords[1].toFixed(6));

      if (!isInsideGalicia(lat, lng)) continue;

      const p = f.properties || {};
      const title = p.name || p.street || query;
      const concello = p.city || p.municipality || p.district || p.county || "";
      const province = p.county || p.state || "Galicia";

      const subtitle = concello
        ? province && province !== concello
          ? `${concello} (${province})`
          : concello
        : province;

      results.push({
        id: `photon-${f.properties.osm_id || Math.random()}`,
        title,
        subtitle,
        fullLabel: `${title} — ${subtitle}`,
        lat,
        lng,
        source: "Photon (OSM)",
        type: p.osm_value || p.type,
      });
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * FUENTE 3: Fallback Nominatim estructurado con Bounding Box de Galicia.
 */
async function searchNominatimGalicia(query: string): Promise<GaliciaPlaceResult[]> {
  try {
    const trimmed = query.trim();
    // Añadir contexto geográfico gallego si es necesario
    const qWithContext =
      trimmed.toLowerCase().includes("galicia") ||
      trimmed.toLowerCase().includes("ourense") ||
      trimmed.toLowerCase().includes("lugo") ||
      trimmed.toLowerCase().includes("pontevedra") ||
      trimmed.toLowerCase().includes("coruña")
        ? trimmed
        : `${trimmed}, Galicia`;

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      qWithContext
    )}&addressdetails=1&countrycodes=es&viewbox=${GALICIA_BBOX.minLon},${GALICIA_BBOX.maxLat},${GALICIA_BBOX.maxLon},${GALICIA_BBOX.minLat}&bounded=1&limit=6`;

    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "PelletGalicia-Rural-Logistics/2.0",
      },
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) return [];
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("json")) return [];
    const data = await res.json();

    const results: GaliciaPlaceResult[] = [];

    for (const item of data) {
      const lat = Number(parseFloat(item.lat).toFixed(6));
      const lng = Number(parseFloat(item.lon).toFixed(6));

      if (!isInsideGalicia(lat, lng)) continue;

      const addr = item.address || {};
      const place =
        addr.hamlet ||
        addr.village ||
        addr.isolated_dwelling ||
        addr.suburb ||
        addr.road ||
        item.display_name.split(",")[0];

      const parish = addr.city_district || addr.suburb || addr.quarter || "";
      const concello =
        addr.municipality || addr.city || addr.town || addr.county || "";
      const province = addr.province || addr.state || "";

      let subtitle = "";
      if (parish && parish !== place && parish !== concello) {
        subtitle += `${parish}, `;
      }
      if (concello) {
        subtitle += concello;
      }
      if (province) {
        subtitle += ` (${province})`;
      }

      results.push({
        id: `nom-${item.place_id || Math.random()}`,
        title: place,
        subtitle: subtitle || "Galicia",
        fullLabel: `${place} — ${subtitle || "Galicia"}`,
        lat,
        lng,
        source: "Nominatim",
        type: item.type,
      });
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * BUSCADOR MULTI-FUENTE ESPECIALIZADO EN TOPONIMIA RURAL DE GALICIA.
 * Consulta en paralelo CartoCiudad IGN, Photon y Nominatim, deduplicando por proximidad.
 */
export async function searchRuralGalicia(
  query: string
): Promise<GaliciaPlaceResult[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) return [];

  // Consultar en paralelo las tres fuentes
  const [ignResults, photonResults, nominatimResults] = await Promise.all([
    searchCartoCiudad(trimmed),
    searchPhoton(trimmed),
    searchNominatimGalicia(trimmed),
  ]);

  // Combinar priorizando IGN -> Photon -> Nominatim
  const combined = [...ignResults, ...photonResults, ...nominatimResults];

  // Deduplicar resultados que estén a menos de 200m entre sí con nombre similar
  const deduplicated: GaliciaPlaceResult[] = [];

  for (const item of combined) {
    const isDuplicate = deduplicated.some((existing) => {
      const distLat = Math.abs(existing.lat - item.lat);
      const distLng = Math.abs(existing.lng - item.lng);
      // ~200 metros de margen
      return distLat < 0.002 && distLng < 0.002;
    });

    if (!isDuplicate) {
      deduplicated.push(item);
    }
  }

  return deduplicated.slice(0, 8);
}

/**
 * Geocodificación Inversa Automática:
 * Convierte lat, lng en un nombre de Aldea, Parroquia y Concello.
 */
export async function reverseGeocodeGalicia(
  lat: number,
  lng: number
): Promise<ReverseGeocodeResult | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "PelletGalicia-Rural-Logistics/2.0 (admin@pelletgalicia.local)",
      },
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const addr = data.address || {};

    const placeName =
      addr.hamlet ||
      addr.village ||
      addr.isolated_dwelling ||
      addr.place ||
      addr.road ||
      data.display_name?.split(",")[0] ||
      "Lugar rural";

    const parish = addr.city_district || addr.suburb || addr.quarter || "";
    const concello =
      addr.municipality || addr.city || addr.town || addr.county || "";
    const province = addr.province || addr.state || "Ourense";

    const parts: string[] = [placeName];
    if (parish && parish !== placeName && parish !== concello) {
      parts.push(parish);
    }
    if (concello && concello !== placeName) {
      parts.push(concello);
    }
    if (province) {
      parts.push(`(${province})`);
    }

    return {
      fullAddress: parts.join(" — "),
      placeName,
      concello,
      province,
    };
  } catch {
    return null;
  }
}

/**
 * Resuelve cualquier enlace o texto pegado (Google Maps corto, largo, DMS o decimales)
 * conectando con /api/resolve-map-link en el backend de Next.js para seguir redirecciones.
 */
export async function resolveMapLocation(
  input: string
): Promise<{
  lat: number;
  lng: number;
  source: string;
  resolvedAddress?: string;
} | null> {
  if (!input || !input.trim()) return null;

  try {
    const res = await fetch("/api/resolve-map-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: input.trim() }),
    });

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    if (data.success && typeof data.lat === "number" && typeof data.lng === "number") {
      return {
        lat: data.lat,
        lng: data.lng,
        source: data.source || "Google Maps",
        resolvedAddress: data.resolvedAddress,
      };
    }

    return null;
  } catch (err) {
    console.error("Error llamando a /api/resolve-map-link:", err);
    return null;
  }
}

// --- ALIASES DE COMPATIBILIDAD HACIA ATRÁS ---
export interface GaliciaGeoResult {
  displayName: string;
  lat: number;
  lng: number;
  type?: string;
  lugar?: string;
  parroquia?: string;
  concello?: string;
}

export async function searchGaliciaNominatim(query: string): Promise<GaliciaGeoResult[]> {
  const results = await searchRuralGalicia(query);
  return results.map((r) => ({
    displayName: r.fullLabel,
    lat: r.lat,
    lng: r.lng,
    type: r.type,
    lugar: r.title,
    parroquia: r.subtitle.split(",")[0] || "",
    concello: r.subtitle,
  }));
}

export function extractGaliciaCoordinates(input: string): Coordinates | null {
  if (!input) return null;
  const pinMatch = input.match(/!3d(-?\d{1,2}(?:\.\d+)?)[^!]*!4d(-?\d{1,3}(?:\.\d+)?)/);
  if (pinMatch) return { lat: parseFloat(pinMatch[1]), lng: parseFloat(pinMatch[2]) };
  const atMatch = input.match(/@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
  if (atMatch) return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };
  const qMatch = input.match(/[?&](?:q|query|ll|destination)=(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
  if (qMatch) return { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]) };
  const rawMatch = input.match(/(-?\d{1,2}\.\d{3,})[\s,]+(-?\d{1,3}\.\d{3,})/);
  if (rawMatch) return { lat: parseFloat(rawMatch[1]), lng: parseFloat(rawMatch[2]) };
  return null;
}

