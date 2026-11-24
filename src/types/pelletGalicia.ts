/**
 * Reglas de negocio y constantes de SATRuta (Asistencia Técnica en Campo: Averías, Revisiones e Instalaciones)
 * Arquitectura Local-First & Zero-Cloud.
 */
export const FIELD_SERVICE_RULES = {
  DEFAULT_MAX_WORKDAY_MINUTES: 480, // 8 horas de jornada (conducción + intervenciones)
  DEFAULT_MAX_STOPS_PER_ROUTE: 12, // Límite operativo por defecto de avisos por turno
  DEFAULT_INTERVENTION_MINUTES: 45, // Duración estimada por defecto (min)
  DEFAULT_START_TIME: "08:30", // Hora de inicio de jornada
  DEFAULT_CONSUMO_L100: 7.5, // Consumo medio furgoneta taller (L/100km)
  DEFAULT_PRECIO_COMBUSTIBLE: 1.55, // Precio diésel/gasolina (€/L)
  DEFAULT_HOURLY_COST_EUR: 0, // Coste interno por hora opcional (0 = solo combustible)
} as const;

export interface Coordinates {
  lat: number;
  lng: number;
}

export type ServiceType = "Avería" | "Revisión" | "Instalación";
export type OrderPriority = "Urgente" | "Normal";
export type ServiceStatus = "Pendiente" | "En Ruta" | "Completado" | "Cancelado";

/**
 * Cliente / Ubicación / Instalación guardado en la base de datos local (Local-First).
 */
export interface Customer {
  id: string;
  name: string;
  village: string; // Dirección, aldea, parroquia o referencia
  phone?: string;
  coordinates: Coordinates;
  equipmentInfo?: string; // Ej. "Caldera Biomasa Domusa 25kW", "Grupo presión pozo"
  internalNotes?: string; // Notas de acceso: llaves, perro, cuadro eléctrico, portón
  lastServiceType?: ServiceType;
  lastInterventionMinutes?: number;
  lastServiceDate?: string; // Fecha ISO del último parte
  totalServicesHistory?: number;
  totalBilledHistoryEur?: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Parte / Aviso de Trabajo (Avería, Revisión o Instalación).
 */
export interface ServiceOrder {
  id: string;
  customerId: string;
  customer: Customer;
  serviceType: ServiceType;
  priority: OrderPriority;
  equipmentInfo?: string; // Equipo o instalación específica del aviso
  estimatedMinutes: number; // Duración estimada de intervención (min)
  actualMinutes?: number; // Duración real reportada al cierre
  estimatedPriceEur?: number; // Presupuesto o importe previsto a cobrar
  collectedPriceEur?: number; // Importe real cobrado al finalizar
  technicalNotes?: string; // Síntoma, material o repuestos necesarios
  resolutionNote?: string; // Nota breve de cierre reportada por el técnico
  concello?: string;
  status: ServiceStatus;
  dispatchedAt?: string;
  completedAt?: string;
  createdAt: string;
}

/**
 * Configuración del Técnico / Vehículo Taller y Base Operativa.
 */
export interface TechnicianConfig {
  maxWorkdayMinutes: number; // Ej. 480 min (8h)
  maxStopsPerRoute: number; // Ej. 12 avisos/jornada
  workdayStartTime: string; // "HH:mm", ej. "08:30"
  warehouseName: string; // Base / Taller central
  warehouseVillage: string;
  warehouseCoordinates: Coordinates;
  googleMapsApiKey?: string;
  consumoL100: number; // L/100km vehículo taller
  precioCombustible: number; // €/L
  hourlyCostEur?: number; // Coste interno por hora (opcional)
}

/**
 * Parada efímera transmitida a la terminal móvil del técnico (/tecnico y /reparto).
 * Contiene únicamente los datos necesarios para la jornada y se destruye al cerrar cada parte.
 */
export interface EphemeralStop {
  seq: number;
  id: string;
  name: string;
  village: string;
  lat: number;
  lng: number;
  serviceType: ServiceType;
  priority: OrderPriority;
  estimatedMinutes: number;
  equipmentInfo?: string;
  cashToCollectEur?: number; // Presupuesto o importe a cobrar (€)
  tags?: string; // Material / notas técnicas / alertas cortas
  phone?: string; // Teléfono opcional para botón tel: en campo
}

/**
 * Formato de serialización ultracompacto v3 para QR y WhatsApp del técnico.
 */
export interface UltraCompactStopWireV3 {
  i: string; // shortId
  n: string; // nombre cliente
  a: string; // dirección / aldea
  x: number; // lat (5 dec)
  y: number; // lng (5 dec)
  tp: "A" | "R" | "I"; // Avería | Revisión | Instalación
  pr: 0 | 1; // 1 = Urgente, 0 = Normal
  m: number; // estimatedMinutes
  eq?: string; // equipmentInfo
  c: number; // estimatedPriceEur
  t: string; // technicalNotes / alertas
  ph?: string; // teléfono
}

export interface UltraCompactTripWireV3 {
  u: 3; // Versión ultracompacta v3 (SAT)
  k: number; // tripNum
  d: string; // date
  w: {
    n: string;
    x: number;
    y: number;
  };
  p: UltraCompactStopWireV3[];
}

/**
 * Formato anterior v2 (compatibilidad hacia atrás con enlaces antiguos de pellets).
 */
export interface UltraCompactStopWireV2 {
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

export interface UltraCompactTripWireV2 {
  u: 2;
  k: number;
  d: string;
  w: {
    n: string;
    x: number;
    y: number;
  };
  p: UltraCompactStopWireV2[];
}

/**
 * Payload completo comprimido en URL/QR para la terminal de técnico.
 */
export interface EphemeralTripPayload {
  v: "3.0" | "1.0";
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
 * Payload ultracompacto de Retorno Zero-Cloud v2 (SAT1-).
 * No contiene nombres, ni direcciones, ni coordenadas GPS. Solo IDs cortos, minutos reales y cobro.
 */
export interface UltraCompactReturnReceiptWireV2 {
  r: 2; // Versión 2 (SAT)
  k: number; // tripNum
  d: string; // fecha YYYY-MM-DD
  t: string; // timestamp HH:mm de cierre
  e: {
    i: string; // shortId de 6 caracteres
    tp: "A" | "R" | "I"; // tipo ejecutado
    m: number; // actualMinutes empleados
    c: number; // collectedPriceEur cobrados
    nt?: string; // nota breve de resolución
  }[];
}

export interface DecodedReturnReceipt {
  tripNum: number;
  date: string;
  closedAtTime: string;
  deliveredItems: {
    shortId: string;
    serviceType: ServiceType;
    actualMinutes: number;
    cashCollectedEur: number;
    resolutionNote?: string;
  }[];
  totalMinutesWorked: number;
  totalCashCollectedEur: number;
}
