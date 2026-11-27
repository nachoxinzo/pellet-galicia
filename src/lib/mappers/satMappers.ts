import { z } from "zod";
import {
  Customer,
  ServiceOrder,
  ServiceStatus,
  ServiceType,
  OrderPriority,
  TimeSlot,
  TechnicianConfig,
  FIELD_SERVICE_RULES,
} from "@/types/pelletGalicia";
import { decryptField } from "@/lib/security/fieldCrypto";

export const serviceTypeSchema = z.enum(["Avería", "Revisión", "Instalación"]);
export const orderPrioritySchema = z.enum(["Urgente", "Normal"]);
export const timeSlotSchema = z.enum(["Mañana", "Tarde", "Indiferente"]);
export const orderStatusSchema = z.enum([
  "Pendiente",
  "En Ruta",
  "Completado",
  "Cancelado",
]);

export const coordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const customerInputSchema = z.object({
  id: z.string().max(128).optional(),
  legacyId: z.string().max(128).optional(),
  name: z.string().trim().min(1, "El nombre es obligatorio").max(160),
  village: z.string().trim().min(1, "La dirección es obligatoria").max(320),
  phone: z.string().trim().max(40).optional().default(""),
  coordinates: coordinatesSchema,
  equipmentInfo: z.string().trim().max(200).optional().default(""),
  internalNotes: z.string().trim().max(800).optional().default(""),
  lastServiceType: serviceTypeSchema.optional(),
  lastInterventionMinutes: z.number().int().min(5).max(480).optional(),
  lastServiceDate: z.string().optional(),
  totalServicesHistory: z.number().int().min(0).optional(),
  totalBilledHistoryEur: z.number().min(0).optional(),
});

export const orderCreateSchema = z.object({
  customerId: z.string().uuid("ID de cliente inválido"),
  assignedTechId: z.string().uuid().nullable().optional(),
  serviceType: serviceTypeSchema.default("Avería"),
  priority: orderPrioritySchema.default("Normal"),
  equipmentInfo: z.string().trim().max(200).optional(),
  estimatedMinutes: z.number().int().min(5).max(480).default(45),
  estimatedPriceEur: z.number().min(0).max(100000).optional().default(0),
  technicalNotes: z.string().trim().max(1000).optional(),
  scheduledDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")
    .nullable()
    .optional(),
  timeSlot: timeSlotSchema.optional(),
});

export const orderUpdateSchema = z.object({
  assignedTechId: z.string().uuid().nullable().optional(),
  serviceType: serviceTypeSchema.optional(),
  priority: orderPrioritySchema.optional(),
  equipmentInfo: z.string().trim().max(200).optional(),
  estimatedMinutes: z.number().int().min(5).max(480).optional(),
  estimatedPriceEur: z.number().min(0).max(100000).optional(),
  technicalNotes: z.string().trim().max(1000).optional(),
  scheduledDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")
    .nullable()
    .optional(),
  timeSlot: timeSlotSchema.optional(),
  status: orderStatusSchema.optional(),
});

export const techCompleteSchema = z.object({
  actualMinutes: z.number().int().min(5).max(480),
  collectedPriceEur: z.number().min(0).max(100000),
  resolutionNote: z.string().trim().max(600).optional().default(""),
  serviceType: serviceTypeSchema.optional(),
});

export const configUpdateSchema = z.object({
  maxWorkdayMinutes: z.number().int().min(60).max(960).optional(),
  maxStopsPerRoute: z.number().int().min(1).max(30).optional(),
  workdayStartTime: z.string().trim().min(4).max(5).optional(),
  warehouseName: z.string().trim().min(1).max(160).optional(),
  warehouseVillage: z.string().trim().min(1).max(280).optional(),
  warehouseCoordinates: coordinatesSchema.optional(),
  consumoL100: z.number().min(2).max(35).optional(),
  precioCombustible: z.number().min(0.1).max(10).optional(),
  hourlyCostEur: z.number().min(0).max(300).optional(),
  googleMapsApiKey: z.string().trim().max(200).optional(),
  clearGoogleMapsApiKey: z.boolean().optional(),
});

export interface CustomerDbRow {
  id: string;
  legacy_id: string | null;
  name: string;
  concello: string;
  village_enc: string;
  phone_enc: string;
  phone_hash: string;
  lat: number;
  lng: number;
  equipment_info: string;
  internal_notes_enc: string;
  last_service_type: string;
  last_intervention_minutes: number;
  last_service_date: string | null;
  total_services_history: number;
  total_billed_history_eur: number | string;
  created_at: string;
  updated_at: string;
}

export interface ServiceOrderDbRow {
  id: string;
  legacy_id: string | null;
  customer_id: string;
  assigned_tech_id: string | null;
  service_type: string;
  priority: string;
  equipment_info: string;
  estimated_minutes: number;
  actual_minutes: number | null;
  estimated_price_eur: number | string;
  collected_price_eur: number | string | null;
  technical_notes_enc: string;
  resolution_note_enc: string;
  concello: string;
  scheduled_date?: string | null;
  time_slot?: string | null;
  status: string;
  dispatched_at: string | null;
  completed_at: string | null;
  created_at: string;
  customer?: CustomerDbRow | CustomerDbRow[] | null;
  assigned_tech?:
    | { id: string; full_name: string | null; email: string }
    | { id: string; full_name: string | null; email: string }[]
    | null;
}

export interface AppConfigDbRow {
  id: number;
  max_workday_minutes: number;
  max_stops_per_route: number;
  workday_start_time: string;
  warehouse_name: string;
  warehouse_village: string;
  warehouse_lat: number;
  warehouse_lng: number;
  consumo_l100: number | string;
  precio_combustible: number | string;
  hourly_cost_eur: number | string;
  google_maps_api_key_enc: string;
}

export function mapCustomerRow(row: CustomerDbRow): Customer {
  return {
    id: row.id,
    name: row.name,
    village: decryptField(row.village_enc) || row.concello || "",
    phone: decryptField(row.phone_enc),
    coordinates: {
      lat: Number(row.lat),
      lng: Number(row.lng),
    },
    equipmentInfo: row.equipment_info || "",
    internalNotes: decryptField(row.internal_notes_enc),
    lastServiceType: (row.last_service_type as ServiceType) || "Revisión",
    lastInterventionMinutes:
      Number(row.last_intervention_minutes) ||
      FIELD_SERVICE_RULES.DEFAULT_INTERVENTION_MINUTES,
    lastServiceDate: row.last_service_date || undefined,
    totalServicesHistory: Number(row.total_services_history) || 0,
    totalBilledHistoryEur: Number(row.total_billed_history_eur) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapOrderRow(row: ServiceOrderDbRow): ServiceOrder | null {
  const rawCust = Array.isArray(row.customer) ? row.customer[0] : row.customer;
  if (!rawCust) return null;

  const rawTech = Array.isArray(row.assigned_tech)
    ? row.assigned_tech[0]
    : row.assigned_tech;

  const customer = mapCustomerRow(rawCust);

  return {
    id: row.id,
    customerId: row.customer_id,
    customer,
    assignedTechId: row.assigned_tech_id,
    assignedTechName: rawTech
      ? rawTech.full_name || rawTech.email
      : undefined,
    serviceType: (row.service_type as ServiceType) || "Avería",
    priority: (row.priority as OrderPriority) || "Normal",
    equipmentInfo: row.equipment_info || customer.equipmentInfo || "",
    estimatedMinutes: Number(row.estimated_minutes) || 45,
    actualMinutes:
      row.actual_minutes !== null && row.actual_minutes !== undefined
        ? Number(row.actual_minutes)
        : undefined,
    estimatedPriceEur: Number(row.estimated_price_eur) || 0,
    collectedPriceEur:
      row.collected_price_eur !== null && row.collected_price_eur !== undefined
        ? Number(row.collected_price_eur)
        : undefined,
    technicalNotes: decryptField(row.technical_notes_enc),
    resolutionNote: decryptField(row.resolution_note_enc) || undefined,
    concello: row.concello || customer.village || "General",
    scheduledDate: row.scheduled_date || null,
    timeSlot: (row.time_slot as TimeSlot) || "Indiferente",
    status: (row.status as ServiceStatus) || "Pendiente",
    dispatchedAt: row.dispatched_at || undefined,
    completedAt: row.completed_at || undefined,
    createdAt: row.created_at,
  };
}

export function mapConfigRow(row: AppConfigDbRow): TechnicianConfig {
  return {
    maxWorkdayMinutes:
      Number(row.max_workday_minutes) ||
      FIELD_SERVICE_RULES.DEFAULT_MAX_WORKDAY_MINUTES,
    maxStopsPerRoute:
      Number(row.max_stops_per_route) ||
      FIELD_SERVICE_RULES.DEFAULT_MAX_STOPS_PER_ROUTE,
    workdayStartTime:
      row.workday_start_time || FIELD_SERVICE_RULES.DEFAULT_START_TIME,
    warehouseName: row.warehouse_name || "Base / Taller Central",
    warehouseVillage:
      row.warehouse_village ||
      "Polígono San Cibrao das Viñas, Parcela 14, Ourense",
    warehouseCoordinates: {
      lat: Number(row.warehouse_lat) || 42.2982,
      lng: Number(row.warehouse_lng) || -7.8185,
    },
    hasGoogleMapsApiKey: Boolean(
      row.google_maps_api_key_enc && row.google_maps_api_key_enc.length > 0
    ),
    consumoL100:
      Number(row.consumo_l100) || FIELD_SERVICE_RULES.DEFAULT_CONSUMO_L100,
    precioCombustible:
      Number(row.precio_combustible) ||
      FIELD_SERVICE_RULES.DEFAULT_PRECIO_COMBUSTIBLE,
    hourlyCostEur:
      Number(row.hourly_cost_eur) || FIELD_SERVICE_RULES.DEFAULT_HOURLY_COST_EUR,
  };
}
