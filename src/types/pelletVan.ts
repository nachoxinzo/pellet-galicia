/**
 * Reglas de negocio y constantes de PelletVan
 * Reparto exclusivo en furgón por sacos sueltos de 15 kg.
 */
export const PELLET_VAN_RULES = {
  SACK_WEIGHT_KG: 15,
  DEFAULT_VAN_CAPACITY_SACKS: 90, // 90 sacos = 1.350 kg
  DEFAULT_ADMIN_PIN: "1234", // PIN por defecto modificable
} as const;

export interface Coordinates {
  lat: number;
  lng: number;
}

/**
 * Cliente habitual guardado en la base de datos local (IndexedDB del Admin).
 */
export interface VanClient {
  id: string;
  name: string;
  phone: string;
  address: string;
  coordinates: Coordinates;
  internalNotes?: string; // Ej. "Entrada por calle trasera", "Perro en finca", etc.
  createdAt: string;
  updatedAt: string;
}

/**
 * Pedido de reparto registrado por el Admin.
 */
export interface VanOrder {
  id: string;
  clientId: string;
  client: VanClient;
  sacks: number; // Cantidad de sacos sueltos (15 kg c/u)
  totalWeightKg: number; // sacks * 15 kg
  orderNotes?: string;
  createdAt: string;
  status: "Pendiente" | "En Reparto" | "Completado" | "Cancelado";
}

/**
 * Configuración del furgón y punto de salida (Almacén).
 */
export interface VanSettings {
  vanCapacitySacks: number; // Ej. 90 sacos
  maxWeightKg: number; // Ej. 1.350 kg (vanCapacitySacks * 15)
  warehouseName: string;
  warehouseAddress: string;
  warehouseCoordinates: Coordinates;
  adminPin: string; // PIN para acceder a /admin
}

/**
 * Estructura de la parada efímera que recibe el repartidor en /reparto.
 * Contiene únicamente los datos estrictamente necesarios y se purga de memoria al completarse.
 */
export interface EphemeralDeliveryStop {
  id: string;
  orderId: string;
  clientName: string;
  address: string;
  coordinates: Coordinates;
  sacks: number;
  totalWeightKg: number;
  sequenceOrder: number;
}

/**
 * Estructura del Backup JSON Cifrado con AES.
 */
export interface EncryptedBackupPayload {
  version: "1.0";
  timestamp: string;
  encryptedData: string; // AES ciphertext con clients, orders y settings
}
