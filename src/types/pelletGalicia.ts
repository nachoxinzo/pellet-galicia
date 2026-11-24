/**
 * Reglas de negocio y constantes de PelletGalicia
 * Reparto exclusivo en furgón por sacos sueltos de 15 kg por el rural de Galicia.
 */
export const PELLET_GALICIA_RULES = {
  SACK_WEIGHT_KG: 15,
  DEFAULT_VAN_CAPACITY_SACKS: 90, // 90 sacos = 1.350 kg
  DEFAULT_CONSUMO_VACIO_L100: 8.5, // 8.5 L/100km furgón vacío
  DEFAULT_EXTRA_CONSUMO_TONELADA: 2.2, // +2.2 L/100km por cada 1.000 kg de carga
  DEFAULT_PRECIO_COMBUSTIBLE: 1.55, // 1.55 €/L diésel
  DEFAULT_PRECIO_POR_SACO: 4.5, // 4.50 € por saco de 15 kg por defecto
} as const;

export interface Coordinates {
  lat: number;
  lng: number;
}

/**
 * Cliente / Aldea guardado en la base de datos local (Local-First).
 */
export interface Customer {
  id: string;
  name: string;
  village: string; // Aldea, Lugar, Parroquia, Concello o referencia
  phone?: string;
  coordinates: Coordinates;
  internalNotes?: string; // Notas habituales de descarga (ej. "Entrada por el hórreo", "Portón metálico verde")
  ultimosSacos?: number; // Cantidad de sacos de su último pedido (ej. 30)
  fechaUltimoPedido?: string; // Fecha ISO de la última vez que pidió
  totalPedidosHistorico?: number; // Acumulado de cuántos pedidos nos ha comprado en total
  totalSacosHistorico?: number; // Acumulado de cuántos sacos nos ha comprado en total
  createdAt: string;
  updatedAt: string;
}

export type OrderPriority = "Normal" | "Urgente";

export type OrderStatus =
  | "Pendiente"
  | "En Reparto"
  | "Completado"
  | "Cancelado";

/**
 * Pedido pendiente o en ciclo de entrega.
 */
export interface PendingOrder {
  id: string;
  customerId: string;
  customer: Customer;
  sacks: number; // Cantidad de sacos sueltos (15 kg)
  totalWeightKg: number; // sacks * 15 kg
  orderNotes?: string;
  priority?: OrderPriority; // "Normal" | "Urgente"
  concello?: string; // Concello extraído o asignado para filtrado rápido
  cashToCollectEur?: number; // Importe previsto a cobrar en mano
  cashCollectedEur?: number; // Importe real cobrado al entregar
  dispatchedAt?: string; // Fecha ISO cuando pasa a "En Reparto"
  deliveredAt?: string; // Fecha ISO cuando pasa a "Completado"
  createdAt: string;
  status: OrderStatus;
}

/**
 * Configuración del furgón y punto de carga (Almacén).
 */
export interface VanConfig {
  vanCapacitySacks: number; // Ej. 90 sacos
  maxWeightKg: number; // vanCapacitySacks * 15 kg
  warehouseName: string;
  warehouseVillage: string;
  warehouseCoordinates: Coordinates;
  googleMapsApiKey?: string; // Clave opcional de Google Maps Places API
  consumoVacioL100?: number; // Consumo del furgón vacío (ej. 8.5 L/100km)
  extraConsumoPorTonelada?: number; // Litros extra cada 100km por cada 1.000 kg de carga (ej. +2.2 L/100km)
  precioCombustible?: number; // Precio actual del diésel (ej. 1.55 €/L)
  precioPorSaco?: number; // Precio de venta por saco para métricas de campaña (ej. 4.50 €)
}

/**
 * Parada de un viaje optimizado.
 */
export interface OptimizedStop {
  order: PendingOrder;
  sequenceOrder: number;
  estimatedDrivingMinutesFromPrev?: number;
}

/**
 * Viaje optimizado con límite de capacidad de sacos.
 */
export interface OptimizedTrip {
  tripNumber: number;
  orders: PendingOrder[];
  stops: OptimizedStop[];
  totalSacks: number;
  totalWeightKg: number;
  estimatedDrivingMinutes: number;
  totalDistanceKm: number;
  polyline: [number, number][]; // [lat, lng]
}

/**
 * Parada efímera transmitida a la terminal móvil del repartidor (/reparto).
 * Contiene únicamente los datos estrictamente necesarios y se destruye al entregar.
 */
export interface EphemeralStop {
  seq: number;
  id: string;
  name: string;
  village: string;
  lat: number;
  lng: number;
  sacks: number;
  totalWeightKg: number;
  cashToCollectEur?: number; // Importe a cobrar en mano si aplica (c)
  tags?: string; // Etiquetas/iconos operativos cortos de descarga (t)
  phone?: string; // Teléfono opcional para botón tel: en cabina (ph)
}

/**
 * Formato de serialización ultracompacto con claves de 1 letra para códigos QR y enlaces WhatsApp:
 * { i: idCorto, n: nombre, a: aldea, x: lat, y: lng, s: sacos, c: cobrarEnMano, t: tagsIconos, ph?: telefono }
 */
export interface UltraCompactStopWire {
  i: string;
  n: string;
  a: string;
  x: number;
  y: number;
  s: number;
  c: number;
  t: string;
  ph?: string;
}

export interface UltraCompactTripWire {
  u: 2; // Versión ultracompacta v2
  k: number; // tripNum
  d: string; // date
  w: {
    n: string;
    x: number;
    y: number;
  };
  p: UltraCompactStopWire[];
}

/**
 * Payload completo comprimido en URL/QR para el repartidor.
 */
export interface EphemeralTripPayload {
  v: "1.0";
  tripNum: number;
  date: string;
  warehouse: {
    name: string;
    lat: number;
    lng: number;
  };
  stops: EphemeralStop[];
}

/**
 * Payload ultracompacto de Retorno Zero-Cloud (/reparto -> /admin)
 * No contiene nombres, ni direcciones, ni coordenadas GPS. Solo IDs cortos y totales.
 */
export interface UltraCompactReturnReceiptWire {
  r: 1; // Versión 1 del recibo de retorno
  k: number; // tripNum
  d: string; // fecha YYYY-MM-DD
  t: string; // timestamp HH:mm de cierre
  e: {
    i: string; // shortId de 6 caracteres del pedido
    s: number; // sacos entregados
    c: number; // efectivo cobrado en mano (€)
  }[];
}

export interface DecodedReturnReceipt {
  tripNum: number;
  date: string;
  closedAtTime: string;
  deliveredItems: {
    shortId: string;
    sacks: number;
    cashCollectedEur: number;
  }[];
  totalSacksDelivered: number;
  totalCashCollectedEur: number;
}
