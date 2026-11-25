import { NextRequest, NextResponse } from "next/server";

export interface GoogleMapsSearchResult {
  id: string;
  title: string;
  subtitle: string;
  fullAddress: string;
  lat: number;
  lng: number;
  source:
    | "Google Maps (Directo)"
    | "Google Places"
    | "IGN CartoCiudad"
    | "Photon (OSM)"
    | "Nominatim";
  categoryType: "business" | "hamlet" | "municipality";
  categoryLabel: string;
}

// Ámbito Iberia para no cortar zonas limítrofes ni otras provincias españolas
const IBERIA_BBOX = {
  minLon: -9.8,
  minLat: 35.5,
  maxLon: 4.5,
  maxLat: 44.2,
};

function isInsideIberia(lat: number, lng: number): boolean {
  return (
    lat >= IBERIA_BBOX.minLat &&
    lat <= IBERIA_BBOX.maxLat &&
    lng >= IBERIA_BBOX.minLon &&
    lng <= IBERIA_BBOX.maxLon
  );
}

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * MODO A: Google Places Text Search oficial con API Key
 */
async function searchGooglePlaces(
  query: string,
  apiKey: string,
  biasLat: number,
  biasLng: number
): Promise<GoogleMapsSearchResult[]> {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
      query
    )}&location=${biasLat},${biasLng}&radius=100000&language=es&region=es&key=${apiKey}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
    if (!res.ok) return [];
    const data = await res.json();

    if (data.status !== "OK" || !Array.isArray(data.results)) return [];

    const results: GoogleMapsSearchResult[] = [];
    for (const place of data.results) {
      const loc = place.geometry?.location;
      if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") {
        continue;
      }
      const lat = Number(loc.lat.toFixed(6));
      const lng = Number(loc.lng.toFixed(6));
      const title = place.name || query;
      const formattedAddress = place.formatted_address || title;

      let subtitle = formattedAddress;
      if (subtitle.startsWith(title)) {
        subtitle = subtitle.replace(title, "").replace(/^[, -]+/, "");
      }

      const types = place.types || [];
      let categoryType: "business" | "hamlet" | "municipality" = "business";
      let categoryLabel = "Negocio / Local";

      if (types.includes("locality") || types.includes("sublocality")) {
        categoryType = "hamlet";
        categoryLabel = "Aldea / Núcleo";
      } else if (
        types.includes("administrative_area_level_4") ||
        types.includes("administrative_area_level_3")
      ) {
        categoryType = "municipality";
        categoryLabel = "Concello (afinar en mapa)";
      }

      results.push({
        id: `gp-${place.place_id || Math.random()}`,
        title,
        subtitle: subtitle || "España",
        fullAddress: formattedAddress,
        lat,
        lng,
        source: "Google Places",
        categoryType,
        categoryLabel,
      });
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * MODO B1: Scraper Directo a Google Maps (extrae hasta 5 resultados y aborta rápido si hay consent wall)
 */
async function searchGoogleMapsDirect(
  query: string
): Promise<GoogleMapsSearchResult[]> {
  try {
    const lower = query.toLowerCase();
    const hasRegionContext =
      lower.includes("españa") ||
      lower.includes("spain") ||
      lower.includes("galicia") ||
      lower.includes("ourense") ||
      lower.includes("lugo") ||
      lower.includes("pontevedra") ||
      lower.includes("coruña") ||
      lower.includes("madrid") ||
      lower.includes("vigo");

    const qWithRegion = hasRegionContext ? query : `${query}, Galicia, España`;
    const searchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      qWithRegion
    )}`;

    const res1 = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "es-ES,es;q=0.9,gl;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(3000),
    });

    if (res1.url?.includes("consent.google")) return [];
    const html1 = await res1.text();
    if (html1.includes("consent.google.com")) return [];

    const linkMatch = html1.match(/href="(\/search\?tbm=map[^"]+)"/);
    if (!linkMatch) return [];

    const dataUrl = `https://www.google.com${linkMatch[1].replaceAll("&amp;", "&")}`;
    const res2 = await fetch(dataUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "es-ES,es;q=0.9,gl;q=0.8",
        Referer: "https://www.google.com/maps",
      },
      signal: AbortSignal.timeout(3000),
    });

    const text = await res2.text();
    const coordRegex =
      /\[null,null,(-?\d{1,2}\.\d{4,}),(-?\d{1,3}\.\d{4,})\],"0x[^"]*","([^"]+)"/g;

    const results: GoogleMapsSearchResult[] = [];
    for (const match of text.matchAll(coordRegex)) {
      if (results.length >= 5) break;
      const lat = Number(parseFloat(match[1]).toFixed(6));
      const lng = Number(parseFloat(match[2]).toFixed(6));
      if (!isInsideIberia(lat, lng)) continue;

      const title = match[3] || query;
      const safeTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const addressMatch = text.match(new RegExp(`"${safeTitle}, ([^"]+)"`));
      const fullAddress = addressMatch
        ? `${title}, ${addressMatch[1]}`
        : `${title}, Galicia`;

      results.push({
        id: `gmaps-${lat}-${lng}-${results.length}`,
        title,
        subtitle: addressMatch ? addressMatch[1] : "España",
        fullAddress,
        lat,
        lng,
        source: "Google Maps (Directo)",
        categoryType: "business",
        categoryLabel: "Negocio / Lugar exacto",
      });
    }

    // Fallback si el patrón no tenía el 0x cid pero sí [null,null,lat,lng]
    if (results.length === 0) {
      const fallbackMatch = text.match(
        /\[null,null,(-?\d{1,2}\.\d{4,}),(-?\d{1,3}\.\d{4,})\]/
      );
      if (fallbackMatch) {
        const lat = Number(parseFloat(fallbackMatch[1]).toFixed(6));
        const lng = Number(parseFloat(fallbackMatch[2]).toFixed(6));
        if (isInsideIberia(lat, lng)) {
          results.push({
            id: `gmaps-fb-${lat}-${lng}`,
            title: query,
            subtitle: "Ubicación Google Maps",
            fullAddress: query,
            lat,
            lng,
            source: "Google Maps (Directo)",
            categoryType: "business",
            categoryLabel: "Ubicación Google Maps",
          });
        }
      }
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * MODO B2: IGN CartoCiudad Candidates (excelente para direcciones con número de portal y aldeas españolas)
 */
async function searchCartoCiudadCandidates(
  query: string
): Promise<GoogleMapsSearchResult[]> {
  try {
    const url = `https://www.cartociudad.es/geocoder/api/geocoder/candidates?q=${encodeURIComponent(
      query.trim()
    )}&limit=5`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(2800),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    const results: GoogleMapsSearchResult[] = [];
    for (const item of data) {
      const lat = Number(parseFloat(item.lat).toFixed(6));
      const lng = Number(parseFloat(item.lng).toFixed(6));
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0) continue;
      if (!isInsideIberia(lat, lng)) continue;

      const title =
        item.address || item.poblacion || item.muni || query;
      const subtitle = [item.muni, item.province ? `(${item.province})` : ""]
        .filter((s) => s && s !== title)
        .join(" ")
        .trim();

      const itemType = String(item.type || "").toLowerCase();
      let categoryType: "business" | "hamlet" | "municipality" = "business";
      let categoryLabel = "Dirección postal";

      if (itemType.includes("poblacion")) {
        categoryType = "hamlet";
        categoryLabel = "Aldea / Núcleo rural";
      } else if (itemType.includes("municipio")) {
        categoryType = "municipality";
        categoryLabel = "Concello (afinar en mapa)";
      }

      results.push({
        id: `ign-${item.id || `${lat}-${lng}`}`,
        title,
        subtitle: subtitle || "España",
        fullAddress: subtitle ? `${title} — ${subtitle}` : title,
        lat,
        lng,
        source: "IGN CartoCiudad",
        categoryType,
        categoryLabel,
      });
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * MODO B3: Photon API con bias geográfico hacia la base del técnico
 */
async function searchPhoton(
  query: string,
  biasLat: number,
  biasLng: number
): Promise<GoogleMapsSearchResult[]> {
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(
      query.trim()
    )}&lat=${biasLat}&lon=${biasLng}&limit=7`;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) return [];
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("json")) return [];

    const json = await res.json();
    const features = json.features || [];
    const results: GoogleMapsSearchResult[] = [];

    for (const f of features) {
      const coords = f.geometry?.coordinates;
      if (!coords || coords.length < 2) continue;
      const lng = Number(coords[0].toFixed(6));
      const lat = Number(coords[1].toFixed(6));
      if (!isInsideIberia(lat, lng)) continue;

      const p = f.properties || {};
      const streetPart = p.street
        ? p.housenumber
          ? `${p.street} ${p.housenumber}`
          : p.street
        : "";
      const title = p.name || streetPart || query;

      const parish = p.district || p.locality || "";
      const concello = p.city || p.municipality || p.county || "";
      const postcode = p.postcode ? `CP ${p.postcode}` : "";
      const province =
        p.county && p.county !== concello
          ? `(${p.county})`
          : p.state
          ? `(${p.state})`
          : "";

      const subtitle =
        [parish, concello, postcode, province]
          .map((s) => s.trim())
          .filter((s, idx, arr) => s && s !== title && arr.indexOf(s) === idx)
          .join(", ") || "España";

      const osmVal = p.osm_value || "";
      let categoryType: "business" | "hamlet" | "municipality" = "business";
      let categoryLabel = "Lugar / Dirección";

      if (
        osmVal === "hamlet" ||
        osmVal === "village" ||
        osmVal === "isolated_dwelling"
      ) {
        categoryType = "hamlet";
        categoryLabel = "Aldea / Núcleo rural";
      } else if (
        p.type === "city" ||
        osmVal === "municipality" ||
        osmVal === "administrative"
      ) {
        categoryType = "municipality";
        categoryLabel = "Concello (afinar en mapa)";
      }

      results.push({
        id: `photon-${f.properties.osm_id || Math.random()}`,
        title,
        subtitle,
        fullAddress: `${title} — ${subtitle}`,
        lat,
        lng,
        source: "Photon (OSM)",
        categoryType,
        categoryLabel,
      });
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * MODO B4: Nominatim estructurado
 */
async function searchNominatim(query: string): Promise<GoogleMapsSearchResult[]> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
      query.trim()
    )}&addressdetails=1&countrycodes=es&limit=5`;

    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "SATRuta-FieldService/3.0",
      },
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) return [];
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("json")) return [];

    const data = await res.json();
    const results: GoogleMapsSearchResult[] = [];

    for (const item of data) {
      const lat = Number(parseFloat(item.lat).toFixed(6));
      const lng = Number(parseFloat(item.lon).toFixed(6));
      if (!isInsideIberia(lat, lng)) continue;

      const addr = item.address || {};
      const roadPart = addr.road
        ? addr.house_number
          ? `${addr.road} ${addr.house_number}`
          : addr.road
        : "";
      const title =
        addr.shop ||
        addr.amenity ||
        addr.hamlet ||
        addr.village ||
        addr.isolated_dwelling ||
        roadPart ||
        item.display_name.split(",")[0];

      const parish = addr.city_district || addr.suburb || addr.quarter || "";
      const concello = addr.municipality || addr.city || addr.town || "";
      const postcode = addr.postcode ? `CP ${addr.postcode}` : "";
      const province = addr.province
        ? `(${addr.province})`
        : addr.state
        ? `(${addr.state})`
        : "";

      const subtitle =
        [parish, concello, postcode, province]
          .map((s) => s.trim())
          .filter((s, idx, arr) => s && s !== title && arr.indexOf(s) === idx)
          .join(", ") || "España";

      let categoryType: "business" | "hamlet" | "municipality" = "business";
      let categoryLabel = "Dirección / Local";

      if (
        item.type === "hamlet" ||
        item.type === "village" ||
        item.type === "isolated_dwelling"
      ) {
        categoryType = "hamlet";
        categoryLabel = "Aldea / Núcleo rural";
      } else if (
        item.category === "boundary" ||
        item.type === "administrative" ||
        item.type === "city"
      ) {
        categoryType = "municipality";
        categoryLabel = "Concello (afinar en mapa)";
      }

      results.push({
        id: `nom-${item.place_id || Math.random()}`,
        title,
        subtitle,
        fullAddress: `${title} — ${subtitle}`,
        lat,
        lng,
        source: "Nominatim",
        categoryType,
        categoryLabel,
      });
    }

    return results;
  } catch {
    return [];
  }
}

const SEARCH_RATE_LIMIT_WINDOW_MS = 60_000;
const SEARCH_RATE_LIMIT_MAX_REQ = 40;
const MAX_QUERY_LENGTH = 120;
const searchRateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkSearchRateLimit(req: NextRequest): boolean {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const now = Date.now();
  const entry = searchRateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    searchRateLimitMap.set(ip, {
      count: 1,
      resetAt: now + SEARCH_RATE_LIMIT_WINDOW_MS,
    });
    return true;
  }
  if (entry.count >= SEARCH_RATE_LIMIT_MAX_REQ) return false;
  entry.count += 1;
  return true;
}

export async function GET(req: NextRequest) {
  try {
    if (!checkSearchRateLimit(req)) {
      return NextResponse.json(
        {
          success: false,
          error: "Demasiadas búsquedas seguidas. Espera unos segundos.",
        },
        { status: 429 }
      );
    }

    const { searchParams } = new URL(req.url);
    const query = (searchParams.get("q") || "")
      .trim()
      .slice(0, MAX_QUERY_LENGTH);

    const rawLat = parseFloat(searchParams.get("lat") || "");
    const rawLng = parseFloat(searchParams.get("lng") || "");
    const biasLat = Number.isFinite(rawLat) ? rawLat : 42.2982;
    const biasLng = Number.isFinite(rawLng) ? rawLng : -7.8185;

    const apiKey = (
      req.headers.get("x-google-maps-key") ||
      process.env.GOOGLE_MAPS_API_KEY ||
      ""
    )
      .trim()
      .slice(0, 128);

    if (!query || query.length < 2) {
      return NextResponse.json({ success: true, results: [] });
    }

    // 1. MODO A: Google Places API oficial si existe clave
    if (apiKey) {
      const googleResults = await searchGooglePlaces(
        query,
        apiKey,
        biasLat,
        biasLng
      );
      if (googleResults.length > 0) {
        return NextResponse.json({
          success: true,
          mode: "google_places",
          results: googleResults.slice(0, 8),
        });
      }
    }

    // 2. MODO B: 4 fuentes gratuitas en paralelo (Google Maps Direct + CartoCiudad + Photon + Nominatim)
    const [gmapsRes, ignRes, photonRes, nomRes] = await Promise.all([
      searchGoogleMapsDirect(query),
      searchCartoCiudadCandidates(query),
      searchPhoton(query, biasLat, biasLng),
      searchNominatim(query),
    ]);

    const combined: GoogleMapsSearchResult[] = [
      ...gmapsRes,
      ...ignRes,
      ...photonRes,
      ...nomRes,
    ];

    // Deduplicar (~150m)
    const deduplicated: GoogleMapsSearchResult[] = [];
    for (const item of combined) {
      const isDup = deduplicated.some(
        (ex) =>
          Math.abs(ex.lat - item.lat) < 0.0015 &&
          Math.abs(ex.lng - item.lng) < 0.0015
      );
      if (!isDup) deduplicated.push(item);
    }

    // Ordenar: resultados específicos cercanos primero, municipios al final
    deduplicated.sort((a, b) => {
      const aMuni = a.categoryType === "municipality" ? 1 : 0;
      const bMuni = b.categoryType === "municipality" ? 1 : 0;
      if (aMuni !== bMuni) return aMuni - bMuni;

      const distA = haversineKm(biasLat, biasLng, a.lat, a.lng);
      const distB = haversineKm(biasLat, biasLng, b.lat, b.lng);
      const nearA = distA <= 80 ? 0 : 1;
      const nearB = distB <= 80 ? 0 : 1;
      if (nearA !== nearB) return nearA - nearB;

      return distA - distB;
    });

    return NextResponse.json({
      success: true,
      mode: gmapsRes.length > 0 ? "google_maps_direct" : "multi_source",
      results: deduplicated.slice(0, 8),
    });
  } catch (err: unknown) {
    console.error("Error en /api/search-google-maps:", err);
    return NextResponse.json(
      { success: false, error: "Error interno realizando la búsqueda en el mapa." },
      { status: 500 }
    );
  }
}
