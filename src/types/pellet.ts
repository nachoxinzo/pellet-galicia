/**
 * Constantes de negocio para el reparto de pellets
 * - 1 Palé completo = 70 sacos = 1.050 kg
 * - 1 Saco suelto = 15 kg
 */
export const PELLET_RULES = {
  SACK_WEIGHT_KG: 15,
  SACKS_PER_PALLET: 70,
  PALLET_WEIGHT_KG: 1050, // 70 * 15 kg
} as const;

export type TimeWindow = "Mañana" | "Tarde" | "Indiferente";

export type OrderStatus =
  | "Pendiente"
  | "Planificado"
  | "En Ruta"
  | "Entregado"
  | "Incidencia";

export type RouteStatus =
  | "Borrador"
  | "Confirmada"
  | "En Curso"
  | "Completada";

export interface Coordinates {
  lat: number;
  lng: number;
}

/**
 * Configuración del almacén o punto base central donde se cargan los pellets.
 */
export interface WarehouseLocation {
  name: string;
  address: string;
  coordinates: Coordinates;
}

/**
 * Representa un cliente receptor de pellets a domicilio.
 */
export interface Client {
  id: string;
  name: string;
  phone: string;
  address: string;
  coordinates: Coordinates;
  unloadingNotes: string; // ej. 'acceso estrecho', 'necesita transpaleta', 'dejar en garaje'
  preferredTimeWindow: TimeWindow;
  createdAt: string;
  updatedAt: string;
}

/**
 * Representa un pedido de pellets asociado a un cliente.
 */
export interface Order {
  id: string;
  clientId: string;
  /** Datos del cliente embebidos/hidratados para facilitar vistas y migración relacional a Supabase */
  client: Client;
  pallets: number; // 1 palé = 70 sacos = 1.050 kg
  looseSacks: number; // 1 saco = 15 kg
  totalSacksCount: number; // pallets * 70 + looseSacks
  totalWeightKg: number; // Calculado automáticamente: (pallets * 1050) + (looseSacks * 15)
  equivalentPallets: number; // Ocupación estimada en palés para control de volumen en camión
  status: OrderStatus;
  requestedDeliveryDate?: string;
  orderNotes?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Configuración de un vehículo de la flota de reparto.
 */
export interface Vehicle {
  id: string;
  name: string; // ej. 'Camión Rígido Iveco Plataforma', 'Furgón Renault Master'
  licensePlate?: string;
  maxWeightKg: number; // ej. 3.500 kg
  maxPallets: number; // ej. 3 palés
  hasTailLift?: boolean; // Plataforma elevadora / transpaleta
  isAvailable: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type PaymentMethod =
  | "Efectivo"
  | "Bizum"
  | "Transferencia"
  | "Pendiente de cobro"
  | "Ya pagado";

export type StopStatus = "Pendiente" | "Entregado" | "Incidencia";

/**
 * Representa una parada individual dentro de una ruta de reparto.
 */
export interface RouteStop {
  id: string;
  routeId: string;
  orderId: string;
  order?: Order;
  sequenceOrder: number; // 1, 2, 3...
  estimatedArrival?: string; // ej. '09:30'
  estimatedUnloadingMinutes: number; // ej. 20 min
  completed: boolean;
  completedAt?: string;
  status?: StopStatus;
  paymentMethod?: PaymentMethod;
  amountCollected?: number; // Monto cobrado en euros (si aplica)
  incidentReason?: string;
  deliveryDriverNotes?: string;
}

/**
 * Representa una hoja de ruta planificada asignada a un vehículo.
 */
export interface DeliveryRoute {
  id: string;
  name: string; // ej. 'Ruta Norte - Mañana #1'
  date: string; // ISO Date (YYYY-MM-DD)
  vehicleId: string;
  vehicle?: Vehicle;
  stops: RouteStop[];
  totalWeightKg: number;
  totalPalletsOccupied: number;
  totalDistanceKm?: number;
  estimatedDurationMinutes?: number;
  status: RouteStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * DTO para el formulario de creación / edición de pedidos pendientes
 * (incluye datos del cliente y las cantidades de pellets).
 */
export interface OrderFormInput {
  orderId?: string;
  clientId?: string;
  clientName: string;
  clientPhone: string;
  clientAddress: string;
  lat: number;
  lng: number;
  unloadingNotes: string;
  preferredTimeWindow: TimeWindow;
  pallets: number;
  looseSacks: number;
  requestedDeliveryDate?: string;
  orderNotes?: string;
}

/**
 * Función pura de dominio para calcular el peso total y sacos equivalentes en tiempo real.
 */
export function calculateOrderMetrics(pallets: number, looseSacks: number) {
  const safePallets = Math.max(0, Math.floor(Number(pallets) || 0));
  const safeSacks = Math.max(0, Math.floor(Number(looseSacks) || 0));

  const palletsWeightKg = safePallets * PELLET_RULES.PALLET_WEIGHT_KG;
  const looseSacksWeightKg = safeSacks * PELLET_RULES.SACK_WEIGHT_KG;
  const totalWeightKg = palletsWeightKg + looseSacksWeightKg;
  const totalSacksCount =
    safePallets * PELLET_RULES.SACKS_PER_PALLET + safeSacks;

  // Ocupación física en espacios de palé (suponiendo que sacos sueltos agrupados ocupan fracción o espacio adicional)
  const equivalentPallets = Number(
    (safePallets + safeSacks / PELLET_RULES.SACKS_PER_PALLET).toFixed(2)
  );

  return {
    pallets: safePallets,
    looseSacks: safeSacks,
    palletsWeightKg,
    looseSacksWeightKg,
    totalWeightKg,
    totalSacksCount,
    equivalentPallets,
  };
}
