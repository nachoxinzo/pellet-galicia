import LZString from "lz-string";
import {
  EphemeralTripPayload,
  EphemeralStop,
  UltraCompactStopWire,
  UltraCompactTripWire,
  UltraCompactReturnReceiptWire,
  DecodedReturnReceipt,
  Coordinates,
  PELLET_GALICIA_RULES,
} from "@/types/pelletGalicia";

/**
 * Extrae automáticamente importe a cobrar en mano y etiquetas visuales cortas
 * a partir de las notas internas/de descarga del pedido.
 */
export function extractCashAndTagsFromNotes(notes?: string): {
  cashToCollectEur: number;
  tags: string;
} {
  if (!notes || !notes.trim()) {
    return { cashToCollectEur: 0, tags: "" };
  }

  const raw = notes.trim();
  const lower = raw.toLowerCase();
  let cashToCollectEur = 0;

  // Detectar importes como "210€", "210 €", "cobrar 195", "efectivo 150"
  const euroMatch =
    raw.match(/(\d+(?:[.,]\d{1,2})?)\s*€/i) ||
    raw.match(/(?:cobrar|efectivo|mano|pagar)\s*(?:de\s*)?(\d+(?:[.,]\d{1,2})?)/i);

  if (euroMatch && euroMatch[1]) {
    const parsed = parseFloat(euroMatch[1].replace(",", "."));
    if (!Number.isNaN(parsed) && parsed > 0) {
      cashToCollectEur = parsed;
    }
  }

  const badges: string[] = [];
  if (lower.includes("perro") || lower.includes("can")) badges.push("🐕 Perro");
  if (
    lower.includes("carretilla") ||
    lower.includes("traspaleta") ||
    lower.includes("rampa")
  ) {
    badges.push("🛞 Carretilla");
  }
  if (
    lower.includes("cobertizo") ||
    lower.includes("alpendre") ||
    lower.includes("garaje") ||
    lower.includes("horreo") ||
    lower.includes("hórreo") ||
    lower.includes("nave")
  ) {
    badges.push("🏠 Alpendre/Garaje");
  }
  if (lower.includes("llamar") || lower.includes("avisar")) {
    badges.push("📞 Avisar");
  }
  if (cashToCollectEur > 0) {
    badges.push(`💶 Cobrar ${cashToCollectEur}€`);
  }

  // Incluir nota resumida (máx 45 caracteres) para no inflar el QR
  const shortNote = raw.length > 45 ? `${raw.slice(0, 42)}...` : raw;
  const combinedTags =
    badges.length > 0 ? `${badges.join(" · ")} (${shortNote})` : shortNote;

  return {
    cashToCollectEur,
    tags: combinedTags,
  };
}

/**
 * 1. ULTRA-COMPRESIÓN DEL PAYLOAD URL/QR PARA EL REPARTIDOR:
 * Mapea cada parada a claves de 1 letra:
 * { i: idCorto, n: nombre, a: aldea, x: Number(lat.toFixed(5)), y: Number(lng.toFixed(5)), s: sacos, c: cobrarEnMano ? importe : 0, t: tagsIconos }
 * y lo comprime con lz-string (compressToEncodedURIComponent).
 */
export function encodeTripPayload(payload: EphemeralTripPayload): string {
  const compactStops: UltraCompactStopWire[] = payload.stops.map((st, idx) => {
    const shortId =
      st.id.replace(/^(eph-|ord-)/g, "").slice(-6) || String(idx + 1);
    const cleanPhone = st.phone ? st.phone.replace(/\s+/g, "").slice(0, 18) : "";
    return {
      i: shortId,
      n: st.name.trim(),
      a: st.village.trim(),
      x: Number(st.lat.toFixed(5)),
      y: Number(st.lng.toFixed(5)),
      s: st.sacks,
      c: st.cashToCollectEur ? Number(st.cashToCollectEur.toFixed(2)) : 0,
      t: st.tags || "",
      ...(cleanPhone ? { ph: cleanPhone } : {}),
    };
  });

  const compactWire: UltraCompactTripWire = {
    u: 2,
    k: payload.tripNum,
    d: payload.date,
    w: {
      n: payload.warehouse.name,
      x: Number(payload.warehouse.lat.toFixed(5)),
      y: Number(payload.warehouse.lng.toFixed(5)),
    },
    p: compactStops,
  };

  const jsonStr = JSON.stringify(compactWire);
  return LZString.compressToEncodedURIComponent(jsonStr);
}

const MAX_ENCODED_URL_LENGTH = 8_192; // 8 KB máx en URL
const MAX_DECOMPRESSED_JSON_LENGTH = 65_536; // 64 KB máx tras descomprimir
const MAX_STOPS_PER_TRIP = 50;

/**
 * Decodifica y descomprime el payload desde el parámetro ?r=...
 * Mantiene compatibilidad total tanto con el formato ultracompacto de 1 letra (u: 2)
 * como con el formato anterior (v: "1.0"), aplicando límites contra bombas de descompresión.
 */
export function decodeTripPayload(encoded: string): EphemeralTripPayload | null {
  if (!encoded || encoded.length > MAX_ENCODED_URL_LENGTH) return null;

  try {
    let jsonStr = LZString.decompressFromEncodedURIComponent(encoded);
    if (!jsonStr) {
      // Fallback por si el navegador alteró algún carácter URI o viene en Base64
      try {
        jsonStr =
          LZString.decompressFromEncodedURIComponent(
            decodeURIComponent(encoded)
          ) || atob(decodeURIComponent(encoded));
      } catch {
        return null;
      }
    }

    if (!jsonStr || jsonStr.length > MAX_DECOMPRESSED_JSON_LENGTH) return null;
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== "object") return null;

    // Formato Ultracompacto v2 (claves de 1 letra: i, n, a, x, y, s, c, t)
    if (parsed.u === 2 || Array.isArray(parsed.p)) {
      const wire = parsed as UltraCompactTripWire;
      const rawStops = Array.isArray(wire.p)
        ? wire.p.slice(0, MAX_STOPS_PER_TRIP)
        : [];

      const expandedStops: EphemeralStop[] = rawStops
        .map((item: UltraCompactStopWire, idx: number): EphemeralStop | null => {
          const lat = Number(item?.x);
          const lng = Number(item?.y);
          if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng) ||
            Math.abs(lat) > 90 ||
            Math.abs(lng) > 180
          ) {
            return null;
          }
          const sacks = Math.max(
            1,
            Math.min(500, Math.floor(Number(item?.s) || 1))
          );
          return {
            seq: idx + 1,
            id: String(item.i || `s-${idx + 1}`).slice(0, 32),
            name: String(item.n || "Cliente").slice(0, 120),
            village: String(item.a || "").slice(0, 200),
            lat,
            lng,
            sacks,
            totalWeightKg: sacks * PELLET_GALICIA_RULES.SACK_WEIGHT_KG,
            cashToCollectEur: Math.max(
              0,
              Math.min(50_000, Number(item.c) || 0)
            ),
            tags: String(item.t || "").slice(0, 160),
            phone: item.ph ? String(item.ph).slice(0, 20) : undefined,
          };
        })
        .filter((s): s is EphemeralStop => s !== null);

      const whLat = Number(wire.w?.x);
      const whLng = Number(wire.w?.y);

      return {
        v: "1.0",
        tripNum: Math.max(1, Math.min(99, Number(wire.k) || 1)),
        date: String(wire.d || new Date().toISOString().split("T")[0]).slice(
          0,
          20
        ),
        warehouse: {
          name: String(wire.w?.n || "Almacén Central").slice(0, 120),
          lat:
            Number.isFinite(whLat) && Math.abs(whLat) <= 90 ? whLat : 42.2982,
          lng:
            Number.isFinite(whLng) && Math.abs(whLng) <= 180 ? whLng : -7.8185,
        },
        stops: expandedStops,
      };
    }

    // Compatibilidad hacia atrás con el formato v1.0 anterior (con validación de campos)
    if (Array.isArray(parsed.stops)) {
      const safeStops: EphemeralStop[] = parsed.stops
        .slice(0, MAX_STOPS_PER_TRIP)
        .map((st: any, idx: number): EphemeralStop | null => {
          const lat = Number(st?.lat);
          const lng = Number(st?.lng);
          if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng) ||
            Math.abs(lat) > 90 ||
            Math.abs(lng) > 180
          ) {
            return null;
          }
          const sacks = Math.max(
            1,
            Math.min(500, Math.floor(Number(st?.sacks) || 1))
          );
          return {
            seq: idx + 1,
            id: String(st?.id || `s-${idx + 1}`).slice(0, 32),
            name: String(st?.name || "Cliente").slice(0, 120),
            village: String(st?.village || "").slice(0, 200),
            lat,
            lng,
            sacks,
            totalWeightKg: sacks * PELLET_GALICIA_RULES.SACK_WEIGHT_KG,
            cashToCollectEur: Math.max(
              0,
              Math.min(50_000, Number(st?.cashToCollectEur) || 0)
            ),
            tags: String(st?.tags || "").slice(0, 160),
          };
        })
        .filter((s: EphemeralStop | null): s is EphemeralStop => s !== null);

      return {
        v: "1.0",
        tripNum: Math.max(1, Math.min(99, Number(parsed.tripNum) || 1)),
        date: String(parsed.date || new Date().toISOString().split("T")[0]).slice(
          0,
          20
        ),
        warehouse: {
          name: String(parsed.warehouse?.name || "Almacén Central").slice(
            0,
            120
          ),
          lat: Number(parsed.warehouse?.lat) || 42.2982,
          lng: Number(parsed.warehouse?.lng) || -7.8185,
        },
        stops: safeStops,
      };
    }

    return null;
  } catch (err) {
    console.error("Error decodificando payload de viaje:", err);
    return null;
  }
}

/**
 * Genera el enlace oficial multi-parada de Google Maps (hasta 9 waypoints intermedios).
 */
export function buildGoogleMapsMultiStopUrl(
  origin: Coordinates,
  destination: Coordinates,
  waypointsCoords: Coordinates[]
): string {
  const originStr = `${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}`;
  const destinationStr = `${destination.lat.toFixed(6)},${destination.lng.toFixed(6)}`;

  const cappedWaypoints = waypointsCoords.slice(0, 9);
  const waypointsStr = cappedWaypoints
    .map((c) => `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`)
    .join("|");

  if (!waypointsStr) {
    return `https://www.google.com/maps/dir/?api=1&origin=${originStr}&destination=${destinationStr}&travelmode=driving`;
  }

  const encodedWaypoints = encodeURIComponent(waypointsStr);
  return `https://www.google.com/maps/dir/?api=1&origin=${originStr}&destination=${destinationStr}&waypoints=${encodedWaypoints}&travelmode=driving`;
}

/**
 * Enlace directo de Google Maps hacia un cliente específico.
 */
export function buildGoogleMapsSingleClientUrl(coords: Coordinates): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}&travelmode=driving`;
}

/**
 * Codifica un recibo de cierre Zero-Cloud (/reparto -> /admin) con prefijo PG1-
 * No incluye ningún dato personal ni coordenadas GPS, solo IDs cortos de 6 caracteres, sacos y efectivo.
 */
export function encodeReturnReceipt(receipt: DecodedReturnReceipt): string {
  const wire: UltraCompactReturnReceiptWire = {
    r: 1,
    k: Math.max(1, Math.min(99, receipt.tripNum || 1)),
    d: receipt.date || new Date().toISOString().split("T")[0],
    t: receipt.closedAtTime || new Date().toTimeString().slice(0, 5),
    e: (receipt.deliveredItems || []).slice(0, MAX_STOPS_PER_TRIP).map((it) => ({
      i: String(it.shortId || "").slice(0, 12),
      s: Math.max(1, Math.min(500, Math.floor(Number(it.sacks) || 1))),
      c: Math.max(0, Math.min(50_000, Number((it.cashCollectedEur || 0).toFixed(2)))),
    })),
  };

  const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(wire));
  return `PG1-${compressed}`;
}

/**
 * Decodifica un recibo de cierre Zero-Cloud (acepta el token PG1-... o un mensaje completo de WhatsApp que lo contenga).
 */
export function decodeReturnReceipt(
  encodedOrText: string
): DecodedReturnReceipt | null {
  if (!encodedOrText || encodedOrText.length > MAX_ENCODED_URL_LENGTH) return null;

  try {
    const tokenMatch = encodedOrText.match(/PG1-([A-Za-z0-9+\-$_]+)/);
    const rawCompressed = tokenMatch
      ? tokenMatch[1]
      : encodedOrText.trim().replace(/^PG1-/, "");

    if (!rawCompressed) return null;

    let jsonStr = LZString.decompressFromEncodedURIComponent(rawCompressed);
    if (!jsonStr) {
      jsonStr = LZString.decompressFromEncodedURIComponent(
        decodeURIComponent(rawCompressed)
      );
    }
    if (!jsonStr || jsonStr.length > MAX_DECOMPRESSED_JSON_LENGTH) return null;

    const parsed = JSON.parse(jsonStr) as UltraCompactReturnReceiptWire;
    if (!parsed || parsed.r !== 1 || !Array.isArray(parsed.e)) return null;

    const deliveredItems = parsed.e
      .slice(0, MAX_STOPS_PER_TRIP)
      .map((it) => ({
        shortId: String(it.i || "").slice(0, 12),
        sacks: Math.max(1, Math.min(500, Math.floor(Number(it.s) || 1))),
        cashCollectedEur: Math.max(0, Math.min(50_000, Number(it.c) || 0)),
      }))
      .filter((it) => it.shortId.length > 0);

    const totalSacksDelivered = deliveredItems.reduce((s, it) => s + it.sacks, 0);
    const totalCashCollectedEur = Number(
      deliveredItems.reduce((s, it) => s + it.cashCollectedEur, 0).toFixed(2)
    );

    return {
      tripNum: Math.max(1, Math.min(99, Number(parsed.k) || 1)),
      date: String(parsed.d || new Date().toISOString().split("T")[0]).slice(0, 20),
      closedAtTime: String(parsed.t || "--:--").slice(0, 10),
      deliveredItems,
      totalSacksDelivered,
      totalCashCollectedEur,
    };
  } catch (err) {
    console.error("Error decodificando recibo de cierre:", err);
    return null;
  }
}
