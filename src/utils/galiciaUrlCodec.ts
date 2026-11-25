import LZString from "lz-string";
import {
  EphemeralTripPayload,
  EphemeralStop,
  ServiceOrder,
  TechnicianConfig,
  ServiceType,
  UltraCompactStopWireV3,
  UltraCompactTripWireV3,
  UltraCompactStopWireV2,
  UltraCompactTripWireV2,
  UltraCompactReturnReceiptWireV2,
  DecodedReturnReceipt,
  Coordinates,
  FIELD_SERVICE_RULES,
} from "@/types/pelletGalicia";

/**
 * Extrae importe presupuestado/a cobrar y etiquetas operativas cortas
 * a partir de las notas técnicas o de acceso del aviso.
 */
export function extractTechTagsFromNotes(
  notes?: string,
  explicitPriceEur?: number
): {
  cashToCollectEur: number;
  tags: string;
} {
  let cashToCollectEur =
    explicitPriceEur && explicitPriceEur > 0 ? Number(explicitPriceEur) : 0;

  if (!notes || !notes.trim()) {
    return {
      cashToCollectEur,
      tags: cashToCollectEur > 0 ? `💶 Cobrar ${cashToCollectEur}€` : "",
    };
  }

  const raw = notes.trim();
  const lower = raw.toLowerCase();

  if (cashToCollectEur === 0) {
    const euroMatch =
      raw.match(/(\d+(?:[.,]\d{1,2})?)\s*€/i) ||
      raw.match(
        /(?:cobrar|presupuesto|importe|efectivo|pagar)\s*(?:de\s*)?(\d+(?:[.,]\d{1,2})?)/i
      );

    if (euroMatch && euroMatch[1]) {
      const parsed = parseFloat(euroMatch[1].replace(",", "."));
      if (!Number.isNaN(parsed) && parsed > 0) {
        cashToCollectEur = parsed;
      }
    }
  }

  const badges: string[] = [];
  if (
    lower.includes("repuesto") ||
    lower.includes("maletin") ||
    lower.includes("maletín") ||
    lower.includes("herramienta") ||
    lower.includes("material")
  ) {
    badges.push("🧰 Repuestos");
  }
  if (lower.includes("llave") || lower.includes("codigo") || lower.includes("código")) {
    badges.push("🔑 Llaves/Acceso");
  }
  if (lower.includes("perro") || lower.includes("can")) {
    badges.push("🐕 Perro");
  }
  if (lower.includes("llamar") || lower.includes("avisar")) {
    badges.push("📞 Llamar");
  }
  if (
    lower.includes("cuadro") ||
    lower.includes("toma") ||
    lower.includes("caldera") ||
    lower.includes("bomba")
  ) {
    badges.push("⚡ Revisar inst.");
  }
  if (cashToCollectEur > 0) {
    badges.push(`💶 Cobrar ${cashToCollectEur}€`);
  }

  const shortNote = raw.length > 55 ? `${raw.slice(0, 52)}...` : raw;
  const combinedTags =
    badges.length > 0 ? `${badges.join(" · ")} (${shortNote})` : shortNote;

  return {
    cashToCollectEur,
    tags: combinedTags,
  };
}

/**
 * Construye un EphemeralTripPayload directamente a partir de una lista de ServiceOrder.
 * Si preserveOrder=false, ordena automáticamente Urgentes primero y luego por estado/creación.
 */
export function buildTripPayloadFromOrders(
  orders: ServiceOrder[],
  config: TechnicianConfig,
  options?: { tripNum?: number; preserveOrder?: boolean }
): EphemeralTripPayload {
  const ordered = options?.preserveOrder
    ? [...orders]
    : [...orders].sort((a, b) => {
        if (a.priority === "Urgente" && b.priority !== "Urgente") return -1;
        if (b.priority === "Urgente" && a.priority !== "Urgente") return 1;
        if (a.status === "En Ruta" && b.status !== "En Ruta") return -1;
        if (b.status === "En Ruta" && a.status !== "En Ruta") return 1;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });

  const ephemeralStops: EphemeralStop[] = ordered
    .slice(0, MAX_STOPS_PER_TRIP)
    .map((ord, i) => {
      const { cashToCollectEur, tags } = extractTechTagsFromNotes(
        ord.technicalNotes || ord.customer.internalNotes,
        ord.estimatedPriceEur
      );
      return {
        seq: i + 1,
        id: `eph-${ord.id}`,
        name: ord.customer.name,
        village: ord.customer.village,
        lat: ord.customer.coordinates.lat,
        lng: ord.customer.coordinates.lng,
        serviceType: ord.serviceType,
        priority: ord.priority,
        estimatedMinutes: ord.estimatedMinutes,
        equipmentInfo: ord.equipmentInfo || ord.customer.equipmentInfo,
        cashToCollectEur,
        tags,
        phone: ord.customer.phone || undefined,
      };
    });

  return {
    v: "3.0",
    tripNum: options?.tripNum ?? 1,
    date: new Date().toISOString().split("T")[0],
    warehouse: {
      name: config.warehouseName,
      lat: config.warehouseCoordinates.lat,
      lng: config.warehouseCoordinates.lng,
    },
    stops: ephemeralStops,
  };
}

/**
 * Genera una URL completa hacia /tecnico?r=... lista para abrir o compartir.
 */
export function buildTechTerminalUrl(
  orders: ServiceOrder[],
  config: TechnicianConfig,
  baseUrl?: string
): string {
  const origin =
    baseUrl ?? (typeof window !== "undefined" ? window.location.origin : "");
  if (orders.length === 0) return `${origin}/tecnico`;

  const payload = buildTripPayloadFromOrders(orders, config);
  let encoded = encodeTripPayload(payload);

  // Recortar paradas si la URL excediera el máximo seguro
  if (encoded.length > MAX_ENCODED_URL_LENGTH - 120) {
    const trimmedStops = payload.stops.slice(0, 15);
    encoded = encodeTripPayload({ ...payload, stops: trimmedStops });
  }

  return `${origin}/tecnico?r=${encoded}`;
}

// Alias de compatibilidad
export const extractCashAndTagsFromNotes = extractTechTagsFromNotes;

function encodeServiceTypeCode(tp: ServiceType): "A" | "R" | "I" {
  if (tp === "Avería") return "A";
  if (tp === "Instalación") return "I";
  return "R";
}

function decodeServiceTypeCode(code?: string): ServiceType {
  if (code === "A") return "Avería";
  if (code === "I") return "Instalación";
  return "Revisión";
}

/**
 * Codifica y comprime la hoja de ruta del técnico en formato ultracompacto v3 (u: 3)
 * con lz-string para códigos QR ligeros y enlaces cortos por WhatsApp.
 */
export function encodeTripPayload(payload: EphemeralTripPayload): string {
  const compactStops: UltraCompactStopWireV3[] = payload.stops.map((st, idx) => {
    const shortId =
      st.id.replace(/^(eph-|ord-|srv-)/g, "").slice(-6) || String(idx + 1);
    const cleanPhone = st.phone
      ? st.phone.replace(/\s+/g, "").slice(0, 18)
      : "";
    const cleanEq = st.equipmentInfo
      ? st.equipmentInfo.trim().slice(0, 50)
      : "";

    return {
      i: shortId,
      n: st.name.trim().slice(0, 80),
      a: st.village.trim().slice(0, 120),
      x: Number(st.lat.toFixed(5)),
      y: Number(st.lng.toFixed(5)),
      tp: encodeServiceTypeCode(st.serviceType),
      pr: st.priority === "Urgente" ? 1 : 0,
      m: Math.max(5, Math.min(480, Math.round(st.estimatedMinutes || 45))),
      ...(cleanEq ? { eq: cleanEq } : {}),
      c: st.cashToCollectEur ? Number(st.cashToCollectEur.toFixed(2)) : 0,
      t: (st.tags || "").slice(0, 140),
      ...(cleanPhone ? { ph: cleanPhone } : {}),
    };
  });

  const compactWire: UltraCompactTripWireV3 = {
    u: 3,
    k: payload.tripNum,
    d: payload.date,
    w: {
      n: payload.warehouse.name.slice(0, 60),
      x: Number(payload.warehouse.lat.toFixed(5)),
      y: Number(payload.warehouse.lng.toFixed(5)),
    },
    p: compactStops,
  };

  return LZString.compressToEncodedURIComponent(JSON.stringify(compactWire));
}

const MAX_ENCODED_URL_LENGTH = 10_240; // 10 KB máx en URL
const MAX_DECOMPRESSED_JSON_LENGTH = 65_536; // 64 KB máx tras descomprimir
const MAX_STOPS_PER_TRIP = 50;

/**
 * Decodifica y descomprime el payload desde ?r=...
 * Soporta formato v3 (u: 3 SAT) y mantiene retrocompatibilidad con v2 (u: 2).
 */
export function decodeTripPayload(encoded: string): EphemeralTripPayload | null {
  if (!encoded || encoded.length > MAX_ENCODED_URL_LENGTH) return null;

  try {
    let jsonStr = LZString.decompressFromEncodedURIComponent(encoded);
    if (!jsonStr) {
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

    // 1. Formato Ultracompacto v3 (SAT Averías y Revisiones)
    if (parsed.u === 3 && Array.isArray(parsed.p)) {
      const wire = parsed as UltraCompactTripWireV3;
      const expandedStops: EphemeralStop[] = wire.p
        .slice(0, MAX_STOPS_PER_TRIP)
        .map((item: UltraCompactStopWireV3, idx: number): EphemeralStop | null => {
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
          const estimatedMinutes = Math.max(
            5,
            Math.min(
              480,
              Math.floor(
                Number(item?.m) ||
                  FIELD_SERVICE_RULES.DEFAULT_INTERVENTION_MINUTES
              )
            )
          );
          return {
            seq: idx + 1,
            id: String(item.i || `s-${idx + 1}`).slice(0, 32),
            name: String(item.n || "Cliente").slice(0, 120),
            village: String(item.a || "").slice(0, 200),
            lat,
            lng,
            serviceType: decodeServiceTypeCode(item.tp),
            priority: item.pr === 1 ? "Urgente" : "Normal",
            estimatedMinutes,
            equipmentInfo: item.eq ? String(item.eq).slice(0, 100) : undefined,
            cashToCollectEur: Math.max(
              0,
              Math.min(50_000, Number(item.c) || 0)
            ),
            tags: String(item.t || "").slice(0, 180),
            phone: item.ph ? String(item.ph).slice(0, 20) : undefined,
          };
        })
        .filter((s): s is EphemeralStop => s !== null);

      const whLat = Number(wire.w?.x);
      const whLng = Number(wire.w?.y);

      return {
        v: "3.0",
        tripNum: Math.max(1, Math.min(99, Number(wire.k) || 1)),
        date: String(wire.d || new Date().toISOString().split("T")[0]).slice(
          0,
          20
        ),
        warehouse: {
          name: String(wire.w?.n || "Base Técnica").slice(0, 120),
          lat:
            Number.isFinite(whLat) && Math.abs(whLat) <= 90 ? whLat : 42.2982,
          lng:
            Number.isFinite(whLng) && Math.abs(whLng) <= 180 ? whLng : -7.8185,
        },
        stops: expandedStops,
      };
    }

    // 2. Retrocompatibilidad con formato v2
    if (parsed.u === 2 || Array.isArray(parsed.p)) {
      const wire = parsed as UltraCompactTripWireV2;
      const expandedStops: EphemeralStop[] = (wire.p || [])
        .slice(0, MAX_STOPS_PER_TRIP)
        .map((item: UltraCompactStopWireV2, idx: number): EphemeralStop | null => {
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
          return {
            seq: idx + 1,
            id: String(item.i || `s-${idx + 1}`).slice(0, 32),
            name: String(item.n || "Cliente").slice(0, 120),
            village: String(item.a || "").slice(0, 200),
            lat,
            lng,
            serviceType: "Revisión",
            priority: "Normal",
            estimatedMinutes: FIELD_SERVICE_RULES.DEFAULT_INTERVENTION_MINUTES,
            cashToCollectEur: Math.max(
              0,
              Math.min(50_000, Number(item.c) || 0)
            ),
            tags: String(item.t || "").slice(0, 160),
            phone: item.ph ? String(item.ph).slice(0, 20) : undefined,
          };
        })
        .filter((s): s is EphemeralStop => s !== null);

      return {
        v: "3.0",
        tripNum: Math.max(1, Math.min(99, Number(wire.k) || 1)),
        date: String(wire.d || new Date().toISOString().split("T")[0]).slice(
          0,
          20
        ),
        warehouse: {
          name: String(wire.w?.n || "Base Técnica").slice(0, 120),
          lat: Number(wire.w?.x) || 42.2982,
          lng: Number(wire.w?.y) || -7.8185,
        },
        stops: expandedStops,
      };
    }

    return null;
  } catch (err) {
    console.error("Error decodificando payload de jornada:", err);
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
 * Enlace directo de Google Maps hacia un aviso específico.
 */
export function buildGoogleMapsSingleClientUrl(coords: Coordinates): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}&travelmode=driving`;
}

/**
 * Codifica un recibo de cierre Zero-Cloud v2 (/tecnico -> /admin) con prefijo SAT1-
 * No incluye datos personales ni GPS, solo IDs cortos, tipo, minutos reales, importe y nota breve.
 */
export function encodeReturnReceipt(receipt: DecodedReturnReceipt): string {
  const wire: UltraCompactReturnReceiptWireV2 = {
    r: 2,
    k: Math.max(1, Math.min(99, receipt.tripNum || 1)),
    d: receipt.date || new Date().toISOString().split("T")[0],
    t: receipt.closedAtTime || new Date().toTimeString().slice(0, 5),
    e: (receipt.deliveredItems || []).slice(0, MAX_STOPS_PER_TRIP).map((it) => ({
      i: String(it.shortId || "").slice(0, 12),
      tp: encodeServiceTypeCode(it.serviceType),
      m: Math.max(1, Math.min(480, Math.floor(Number(it.actualMinutes) || 45))),
      c: Math.max(
        0,
        Math.min(50_000, Number((it.cashCollectedEur || 0).toFixed(2)))
      ),
      ...(it.resolutionNote?.trim()
        ? { nt: it.resolutionNote.trim().slice(0, 60) }
        : {}),
    })),
  };

  const compressed = LZString.compressToEncodedURIComponent(
    JSON.stringify(wire)
  );
  return `SAT1-${compressed}`;
}

/**
 * Decodifica un recibo de cierre Zero-Cloud (acepta SAT1-... o PG1-... dentro de texto de WhatsApp).
 */
export function decodeReturnReceipt(
  encodedOrText: string
): DecodedReturnReceipt | null {
  if (!encodedOrText || encodedOrText.length > MAX_ENCODED_URL_LENGTH)
    return null;

  try {
    const tokenMatch = encodedOrText.match(/(?:SAT1|PG1)-([A-Za-z0-9+\-$_]+)/);
    const rawCompressed = tokenMatch
      ? tokenMatch[1]
      : encodedOrText.trim().replace(/^(?:SAT1|PG1)-/, "");

    if (!rawCompressed) return null;

    let jsonStr = LZString.decompressFromEncodedURIComponent(rawCompressed);
    if (!jsonStr) {
      jsonStr = LZString.decompressFromEncodedURIComponent(
        decodeURIComponent(rawCompressed)
      );
    }
    if (!jsonStr || jsonStr.length > MAX_DECOMPRESSED_JSON_LENGTH) return null;

    const parsed = JSON.parse(jsonStr);
    if (!parsed || !Array.isArray(parsed.e)) return null;

    // Formato v2 SAT1-
    if (parsed.r === 2) {
      const deliveredItems = parsed.e
        .slice(0, MAX_STOPS_PER_TRIP)
        .map((it: any) => ({
          shortId: String(it.i || "").slice(0, 12),
          serviceType: decodeServiceTypeCode(it.tp),
          actualMinutes: Math.max(
            1,
            Math.min(480, Math.floor(Number(it.m) || 45))
          ),
          cashCollectedEur: Math.max(0, Math.min(50_000, Number(it.c) || 0)),
          resolutionNote: it.nt ? String(it.nt).slice(0, 80) : undefined,
        }))
        .filter((it: any) => it.shortId.length > 0);

      const totalMinutesWorked = deliveredItems.reduce(
        (s: number, it: any) => s + it.actualMinutes,
        0
      );
      const totalCashCollectedEur = Number(
        deliveredItems
          .reduce((s: number, it: any) => s + it.cashCollectedEur, 0)
          .toFixed(2)
      );

      return {
        tripNum: Math.max(1, Math.min(99, Number(parsed.k) || 1)),
        date: String(parsed.d || new Date().toISOString().split("T")[0]).slice(
          0,
          20
        ),
        closedAtTime: String(parsed.t || "--:--").slice(0, 10),
        deliveredItems,
        totalMinutesWorked,
        totalCashCollectedEur,
      };
    }

    // Compatibilidad v1 PG1-
    if (parsed.r === 1) {
      const deliveredItems = parsed.e
        .slice(0, MAX_STOPS_PER_TRIP)
        .map((it: any) => ({
          shortId: String(it.i || "").slice(0, 12),
          serviceType: "Revisión" as ServiceType,
          actualMinutes: FIELD_SERVICE_RULES.DEFAULT_INTERVENTION_MINUTES,
          cashCollectedEur: Math.max(0, Math.min(50_000, Number(it.c) || 0)),
        }))
        .filter((it: any) => it.shortId.length > 0);

      return {
        tripNum: Math.max(1, Math.min(99, Number(parsed.k) || 1)),
        date: String(parsed.d || new Date().toISOString().split("T")[0]).slice(
          0,
          20
        ),
        closedAtTime: String(parsed.t || "--:--").slice(0, 10),
        deliveredItems,
        totalMinutesWorked:
          deliveredItems.length *
          FIELD_SERVICE_RULES.DEFAULT_INTERVENTION_MINUTES,
        totalCashCollectedEur: Number(
          deliveredItems
            .reduce((s: number, it: any) => s + it.cashCollectedEur, 0)
            .toFixed(2)
        ),
      };
    }

    return null;
  } catch (err) {
    console.error("Error decodificando recibo de cierre SAT:", err);
    return null;
  }
}
