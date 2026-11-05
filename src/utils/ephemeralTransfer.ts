import LZString from "lz-string";
import { EphemeralDeliveryStop } from "@/types/pelletVan";

/**
 * Payload ultra-ligero y privado para la transferencia sin servidor al repartidor.
 * Omitimos teléfonos, notas internas y datos históricos.
 */
export interface MinimalRoutePayload {
  version: "1.0";
  date: string;
  tripNumber?: number;
  stops: {
    seq: number;
    name: string;
    addr: string;
    lat: number;
    lng: number;
    sacks: number;
  }[];
}

/**
 * Codifica y comprime las paradas efímeras en una cadena URL-safe con LZ-String.
 */
export function encodeRouteForDelivery(
  stops: EphemeralDeliveryStop[],
  tripNumber: number = 1
): string {
  const minimalPayload: MinimalRoutePayload = {
    version: "1.0",
    date: new Date().toISOString().split("T")[0],
    tripNumber,
    stops: stops.map((s, index) => ({
      seq: index + 1,
      name: s.clientName,
      addr: s.address,
      lat: s.coordinates.lat,
      lng: s.coordinates.lng,
      sacks: s.sacks,
    })),
  };

  const jsonStr = JSON.stringify(minimalPayload);
  return LZString.compressToEncodedURIComponent(jsonStr);
}

/**
 * Descomprime y decodifica la cadena del parámetro URL ?data=...
 */
export function decodeRouteFromDeliveryUrl(
  encodedData: string
): EphemeralDeliveryStop[] | null {
  if (!encodedData) return null;

  try {
    const jsonStr = LZString.decompressFromEncodedURIComponent(encodedData);
    if (!jsonStr) {
      // Fallback a Base64 estándar si viniera sin comprimir
      try {
        const decoded = atob(decodeURIComponent(encodedData));
        const parsed = JSON.parse(decoded);
        return mapToEphemeralStops(parsed);
      } catch {
        return null;
      }
    }

    const payload: MinimalRoutePayload = JSON.parse(jsonStr);
    return mapToEphemeralStops(payload);
  } catch (err) {
    console.error("Error decodificando payload de reparto:", err);
    return null;
  }
}

function mapToEphemeralStops(payload: MinimalRoutePayload): EphemeralDeliveryStop[] {
  if (!payload || !Array.isArray(payload.stops)) return [];

  return payload.stops.map((s) => ({
    id: `eph-${s.seq}-${Date.now().toString().slice(-4)}`,
    orderId: `ord-${s.seq}`,
    clientName: s.name,
    address: s.addr,
    coordinates: { lat: s.lat, lng: s.lng },
    sacks: s.sacks,
    totalWeightKg: s.sacks * 15,
    sequenceOrder: s.seq,
  }));
}
