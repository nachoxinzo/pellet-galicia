import { NextRequest, NextResponse } from "next/server";

export interface GoogleMapsSearchResult {
  id: string;
  title: string;
  subtitle: string;
  fullAddress: string;
  lat: number;
  lng: number;
  source: "Google Maps (Directo)" | "Google Places" | "IGN CartoCiudad" | "Photon (OSM)" | "Nominatim";
  categoryType: "business" | "hamlet" | "municipality";
  categoryLabel: string;
}

// Bounding Box estricto de Galicia
const GALICIA_BBOX = {
  minLon: -9.35,
  minLat: 41.8,
  maxLon: -6.7,
  maxLat: 43.85,
};

function isInsideGalicia(lat: number, lng: number): boolean {
  return (
    lat >= GALICIA_BBOX.minLat &&
    lat <= GALICIA_BBOX.maxLat &&
    lng >= GALICIA_BBOX.minLon &&
    lng <= GALICIA_BBOX.maxLon
  );
}

/**
 * MODO A: Google Places Text Search oficial con API Key
 */
async function searchGooglePlaces(
  query: string,
  apiKey: string
): Promise<GoogleMapsSearchResult[]> {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
      query
    )}&location=42.15,-7.85&radius=100000&language=es&region=es&key=${apiKey}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
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
      let categoryLabel = "🏪 Negocio / Local exacto";

      if (types.includes("locality") || types.includes("sublocality")) {
        categoryType = "hamlet";
        categoryLabel = "🏘️ Aldea / Núcleo rural";
      } else if (types.includes("administrative_area_level_4") || types.includes("administrative_area_level_3")) {
        categoryType = "municipality";
        categoryLabel = "📍 Centro del Concello (Ajustar chincheta en el mapa)";
      }

      results.push({
        id: `gp-${place.place_id || Math.random()}`,
        title,
        subtitle: subtitle || "Galicia, España",
        fullAddress: formattedAddress,
        lat,
        lng,
        source: "Google Places",
        categoryType,
        categoryLabel,
      });
    }

    return results;
  } catch (err) {
    console.warn("Fallo en Google Places:", err);
    return [];
  }
}

/**
 * MODO B - FUENTE PRINCIPAL: Scraper Directo al motor de búsqueda de Google Maps (Sin API Key)
 * Capaz de corregir erratas (ej. "otico" -> "óptico") y localizar comercios/negocios exactos.
 */
async function searchGoogleMapsDirect(query: string): Promise<GoogleMapsSearchResult | null> {
  try {
    const qWithRegion =
      query.toLowerCase().includes("galicia") ||
      query.toLowerCase().includes("ourense") ||
      query.toLowerCase().includes("lugo") ||
      query.toLowerCase().includes("pontevedra") ||
      query.toLowerCase().includes("coruña")
        ? query
        : `${query}, Galicia, España`;

    const searchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(qWithRegion)}`;

    const res1 = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "es-ES,es;q=0.9,gl;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(4000),
    });

    const html1 = await res1.text();
    const linkMatch = html1.match(/href="(\/search\?tbm=map[^"]+)"/);
    if (!linkMatch) return null;

    const dataUrl = `https://www.google.com${linkMatch[1].replaceAll("&amp;", "&")}`;
    const res2 = await fetch(dataUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "es-ES,es;q=0.9,gl;q=0.8",
        "Referer": "https://www.google.com/maps",
      },
      signal: AbortSignal.timeout(4000),
    });

    const text = await res2.text();

    // 1. Extraer coordenadas exactas [null,null,LAT,LNG]
    const coordMatch = text.match(/\[null,null,(-?\d{1,2}\.\d{4,}),(-?\d{1,3}\.\d{4,})\]/);
    if (!coordMatch) return null;

    const lat = Number(parseFloat(coordMatch[1]).toFixed(6));
    const lng = Number(parseFloat(coordMatch[2]).toFixed(6));

    if (!isInsideGalicia(lat, lng)) return null;

    // 2. Extraer nombre comercial corregido y categoría
    const titleMatch = text.match(/\[null,null,-?\d{1,2}\.\d+,-?\d{1,3}\.\d+\],"0x[^"]*","([^"]+)"/);
    const title = titleMatch ? titleMatch[1] : query;

    // 3. Buscar dirección completa en el payload
    const safeTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const addressMatch = text.match(new RegExp(`"${safeTitle}, ([^"]+)"`));
    const fullAddress = addressMatch ? `${title}, ${addressMatch[1]}` : `${title}, Galicia`;

    const catMatch = text.match(new RegExp(`"${safeTitle}",null,\\["([^"]+)"\\]`));
    const category = catMatch ? catMatch[1] : "Negocio / Local";

    return {
      id: `gmaps-direct-${Date.now()}`,
      title,
      subtitle: addressMatch ? addressMatch[1] : "Galicia, España",
      fullAddress,
      lat,
      lng,
      source: "Google Maps (Directo)",
      categoryType: "business",
      categoryLabel: `🏪 ${category}`,
    };
  } catch (err) {
    console.warn("Fallo en scraper directo de Google Maps:", err);
    return null;
  }
}

/**
 * MODO B - FUENTE 2: Photon API con Bounding Box de Galicia
 */
async function searchPhoton(query: string): Promise<GoogleMapsSearchResult[]> {
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

      if (!isInsideGalicia(lat, lng)) continue;

      const p = f.properties || {};
      const title = p.name || p.street || query;

      const parish = p.district || p.locality || "";
      const concello = p.city || p.municipality || p.county || "";
      const postcode = p.postcode ? `CP ${p.postcode}` : "";
      const province = p.county && p.county !== concello ? `(${p.county})` : p.state ? `(${p.state})` : "";

      // Filtro limpio sin dobles comas
      const subtitle = [parish, concello, postcode, province]
        .map((s) => s.trim())
        .filter((s, idx, arr) => s && s !== title && arr.indexOf(s) === idx)
        .join(", ") || "Galicia";

      const osmVal = p.osm_value || "";
      let categoryType: "business" | "hamlet" | "municipality" = "business";
      let categoryLabel = "🏪 Negocio / Local exacto";

      if (osmVal === "hamlet" || osmVal === "village" || osmVal === "isolated_dwelling") {
        categoryType = "hamlet";
        categoryLabel = "🏘️ Aldea / Núcleo rural";
      } else if (p.type === "city" || osmVal === "municipality" || osmVal === "administrative") {
        categoryType = "municipality";
        categoryLabel = "📍 Centro del Concello (Ajustar chincheta en el mapa)";
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
 * MODO B - FUENTE 3: Nominatim Galicia estructurado
 */
async function searchNominatim(query: string): Promise<GoogleMapsSearchResult[]> {
  try {
    const qWithContext =
      query.toLowerCase().includes("galicia") ||
      query.toLowerCase().includes("ourense") ||
      query.toLowerCase().includes("lugo") ||
      query.toLowerCase().includes("pontevedra") ||
      query.toLowerCase().includes("coruña")
        ? query
        : `${query}, Galicia`;

    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
      qWithContext
    )}&addressdetails=1&extratags=1&namedetails=1&countrycodes=es&viewbox=${GALICIA_BBOX.minLon},${GALICIA_BBOX.maxLat},${GALICIA_BBOX.maxLon},${GALICIA_BBOX.minLat}&bounded=1&limit=6`;

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
    const results: GoogleMapsSearchResult[] = [];

    for (const item of data) {
      const lat = Number(parseFloat(item.lat).toFixed(6));
      const lng = Number(parseFloat(item.lon).toFixed(6));

      if (!isInsideGalicia(lat, lng)) continue;

      const addr = item.address || {};
      const title =
        addr.shop ||
        addr.amenity ||
        addr.hamlet ||
        addr.village ||
        addr.isolated_dwelling ||
        addr.road ||
        item.display_name.split(",")[0];

      const parish = addr.city_district || addr.suburb || addr.quarter || "";
      const concello = addr.municipality || addr.city || addr.town || "";
      const postcode = addr.postcode ? `CP ${addr.postcode}` : "";
      const province = addr.province ? `(${addr.province})` : addr.state ? `(${addr.state})` : "";

      // Filtro limpio sin dobles comas
      const subtitle = [parish, concello, postcode, province]
        .map((s) => s.trim())
        .filter((s, idx, arr) => s && s !== title && arr.indexOf(s) === idx)
        .join(", ") || "Galicia";

      let categoryType: "business" | "hamlet" | "municipality" = "business";
      let categoryLabel = "🏪 Negocio / Local exacto";

      if (item.type === "hamlet" || item.type === "village" || item.type === "isolated_dwelling") {
        categoryType = "hamlet";
        categoryLabel = "🏘️ Aldea / Núcleo rural";
      } else if (item.category === "boundary" || item.type === "administrative" || item.type === "city") {
        categoryType = "municipality";
        categoryLabel = "📍 Centro del Concello (Ajustar chincheta en el mapa)";
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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = (searchParams.get("q") || "").trim();
    const apiKey = (
      searchParams.get("apiKey") ||
      process.env.GOOGLE_MAPS_API_KEY ||
      ""
    ).trim();

    if (!query || query.length < 2) {
      return NextResponse.json({ success: true, results: [] });
    }

    // 1. MODO A: Google Places API si existe clave configurada
    if (apiKey) {
      const googleResults = await searchGooglePlaces(query, apiKey);
      if (googleResults.length > 0) {
        return NextResponse.json({
          success: true,
          mode: "google_places",
          results: googleResults.slice(0, 8),
        });
      }
    }

    // 2. MODO B (Sin API Key): Consulta directa en paralelo a Google Maps + Photon + Nominatim
    // Eliminamos CartoCiudad para texto libre comercial porque devuelve el centro del concello
    const [gmapsDirectRes, photonRes, nomRes] = await Promise.all([
      searchGoogleMapsDirect(query),
      searchPhoton(query),
      searchNominatim(query),
    ]);

    const combined: GoogleMapsSearchResult[] = [];

    // Prioridad 1: Si Google Maps directo encontró el local comercial o la dirección exacta
    if (gmapsDirectRes) {
      combined.push(gmapsDirectRes);
    }

    // Prioridad 2: Resultados de Photon y Nominatim
    for (const item of [...photonRes, ...nomRes]) {
      // Si el usuario escribió un texto largo (ej. nombre de un local o calle) y Photon/Nominatim
      // solo devolvió el municipio genérico, no lo ponemos primero; se muestra con la etiqueta de aviso
      combined.push(item);
    }

    // Deduplicar por cercanía (~200m) manteniendo el resultado más específico
    const deduplicated: GoogleMapsSearchResult[] = [];
    for (const item of combined) {
      const isDup = deduplicated.some((ex) => {
        const dLat = Math.abs(ex.lat - item.lat);
        const dLng = Math.abs(ex.lng - item.lng);
        return dLat < 0.002 && dLng < 0.002;
      });
      if (!isDup) {
        deduplicated.push(item);
      }
    }

    return NextResponse.json({
      success: true,
      mode: gmapsDirectRes ? "google_maps_direct" : "fallback_rural",
      results: deduplicated.slice(0, 8),
    });
  } catch (err: any) {
    console.error("Error en /api/search-google-maps:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Error buscando en el mapa" },
      { status: 500 }
    );
  }
}
