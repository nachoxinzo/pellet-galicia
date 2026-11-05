import LZString from "lz-string";
import {
  EphemeralTripPayload,
  EphemeralStop,
  UltraCompactStopWire,
  UltraCompactTripWire,
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
    return {
      i: shortId,
      n: st.name.trim(),
      a: st.village.trim(),
      x: Number(st.lat.toFixed(5)),
      y: Number(st.lng.toFixed(5)),
      s: st.sacks,
      c: st.cashToCollectEur ? Number(st.cashToCollectEur.toFixed(2)) : 0,
      t: st.tags || "",
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

/**
 * Decodifica y descomprime el payload desde el parámetro ?r=...
 * Mantiene compatibilidad total tanto con el formato ultracompacto de 1 letra (u: 2)
 * como con el formato anterior (v: "1.0").
 */
export function decodeTripPayload(encoded: string): EphemeralTripPayload | null {
  if (!encoded) return null;

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

    if (!jsonStr) return null;
    const parsed = JSON.parse(jsonStr);

    // Formato Ultracompacto v2 (claves de 1 letra: i, n, a, x, y, s, c, t)
    if (parsed && (parsed.u === 2 || Array.isArray(parsed.p))) {
      const wire = parsed as UltraCompactTripWire;
      const expandedStops: EphemeralStop[] = (wire.p || []).map(
        (item: UltraCompactStopWire, idx: number) => ({
          seq: idx + 1,
          id: item.i || `s-${idx + 1}`,
          name: item.n || "Cliente",
          village: item.a || "",
          lat: Number(item.x) || 42.2982,
          lng: Number(item.y) || -7.8185,
          sacks: Number(item.s) || 0,
          totalWeightKg:
            (Number(item.s) || 0) * PELLET_GALICIA_RULES.SACK_WEIGHT_KG,
          cashToCollectEur: Number(item.c) || 0,
          tags: item.t || "",
        })
      );

      return {
        v: "1.0",
        tripNum: wire.k || 1,
        date: wire.d || new Date().toISOString().split("T")[0],
        warehouse: {
          name: wire.w?.n || "Almacén Central",
          lat: Number(wire.w?.x) || 42.2982,
          lng: Number(wire.w?.y) || -7.8185,
        },
        stops: expandedStops,
      };
    }

    // Compatibilidad hacia atrás con el formato v1.0 anterior
    if (parsed && Array.isArray(parsed.stops)) {
      return parsed as EphemeralTripPayload;
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
