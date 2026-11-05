import { Coordinates } from "@/types/pellet";

export interface GeoSearchResult {
  displayName: string;
  lat: number;
  lng: number;
}

/**
 * Busca direcciones usando la API pública gratuita de OpenStreetMap (Nominatim).
 */
export async function searchAddressWithNominatim(
  query: string
): Promise<GeoSearchResult[]> {
  if (!query || query.trim().length < 3) return [];

  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
    query
  )}&addressdetails=1&limit=5&countrycodes=es`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "PelletRoute-PWA/1.0",
      },
    });

    if (!res.ok) return [];

    const data = await res.json();
    return data.map((item: any) => ({
      displayName: item.display_name,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
    }));
  } catch (error) {
    console.error("Error geocodificando con Nominatim:", error);
    return [];
  }
}

/**
 * Extrae latitud y longitud a partir de coordenadas directas o enlaces de Google Maps.
 * Formatos soportados:
 * - "40.6352, -3.7021" o "40.6352 -3.7021"
 * - https://www.google.com/maps?q=40.6352,-3.7021
 * - https://maps.google.com/?q=40.6352,-3.7021
 * - https://www.google.com/maps/@40.6352,-3.7021,17z
 * - https://www.google.com/maps/place/.../@40.6352,-3.7021,15z
 */
export function parseCoordinatesOrGoogleMapsUrl(
  input: string
): Coordinates | null {
  if (!input) return null;
  const trimmed = input.trim();

  // 1. Patrón @lat,lng en URLs de Google Maps
  const atMatch = trimmed.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) {
    const lat = parseFloat(atMatch[1]);
    const lng = parseFloat(atMatch[2]);
    if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
  }

  // 2. Patrón q=lat,lng o query=lat,lng o ll=lat,lng
  const qMatch = trimmed.match(/[?&](?:q|query|ll)=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (qMatch) {
    const lat = parseFloat(qMatch[1]);
    const lng = parseFloat(qMatch[2]);
    if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
  }

  // 3. Patrón directo "lat, lng" o "lat lng" (ej. "40.6352, -3.7021")
  const directMatch = trimmed.match(/^(-?\d+\.\d+)[\s,]+(-?\d+\.\d+)$/);
  if (directMatch) {
    const lat = parseFloat(directMatch[1]);
    const lng = parseFloat(directMatch[2]);
    if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }

  return null;
}
