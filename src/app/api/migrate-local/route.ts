import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireAuthSession,
  logAuditEvent,
  mapDbErrorToResponse,
} from "@/lib/supabase/server";
import {
  encryptField,
  hashPhoneForLookup,
} from "@/lib/security/fieldCrypto";
import {
  customerInputSchema,
  configUpdateSchema,
  serviceTypeSchema,
  orderPrioritySchema,
  orderStatusSchema,
  CustomerDbRow,
} from "@/lib/mappers/satMappers";
import { extractConcelloFromVillage } from "@/services/galiciaStorage";

const migrateOrderSchema = z.object({
  id: z.string().max(128).optional(),
  customerId: z.string().max(128).optional(),
  customerName: z.string().max(160).optional(),
  customerPhone: z.string().max(40).optional(),
  serviceType: serviceTypeSchema.default("Avería"),
  priority: orderPrioritySchema.default("Normal"),
  equipmentInfo: z.string().max(200).optional().default(""),
  estimatedMinutes: z.number().int().min(5).max(480).default(45),
  actualMinutes: z.number().int().min(5).max(480).optional(),
  estimatedPriceEur: z.number().min(0).optional().default(0),
  collectedPriceEur: z.number().min(0).optional(),
  technicalNotes: z.string().max(1000).optional().default(""),
  resolutionNote: z.string().max(600).optional().default(""),
  status: orderStatusSchema.default("Pendiente"),
  createdAt: z.string().optional(),
  completedAt: z.string().optional(),
});

const migratePayloadSchema = z.object({
  customers: z.array(customerInputSchema).max(2000).default([]),
  orders: z.array(migrateOrderSchema).max(5000).default([]),
  config: configUpdateSchema.optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuthSession(["admin"]);
  if (!auth.ok) return auth.response;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = migratePayloadSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Formato de migración local inválido" },
      { status: 400 }
    );
  }

  const { customers, orders, config } = parsed.data;
  const now = new Date().toISOString();

  // Mapa legacyCustomerId -> cloudCustomerUuid
  const legacyToUuid = new Map<string, string>();
  let importedCustomers = 0;
  let importedOrders = 0;

  try {
    // 1. Cargar existentes por legacy_id y phone_hash para evitar duplicados
    const { data: existingRows } = await auth.supabase
      .from("customers")
      .select("id, legacy_id, phone_hash, name");

    const byLegacyId = new Map<string, string>();
    const byPhoneHash = new Map<string, string>();
    const byNormName = new Map<string, string>();

    ((existingRows || []) as Pick<CustomerDbRow, "id" | "legacy_id" | "phone_hash" | "name">[]).forEach(
      (r) => {
        if (r.legacy_id) byLegacyId.set(r.legacy_id, r.id);
        if (r.phone_hash) byPhoneHash.set(r.phone_hash, r.id);
        if (r.name) byNormName.set(r.name.trim().toLowerCase(), r.id);
      }
    );

    for (const c of customers) {
      const legacyKey = c.legacyId || c.id || "";
      const phoneHash = hashPhoneForLookup(c.phone);
      const normName = c.name.trim().toLowerCase();

      const matchedId =
        (legacyKey && byLegacyId.get(legacyKey)) ||
        (phoneHash && byPhoneHash.get(phoneHash)) ||
        byNormName.get(normName);

      if (matchedId) {
        if (legacyKey) legacyToUuid.set(legacyKey, matchedId);
        continue;
      }

      const concello = extractConcelloFromVillage(c.village);
      const { data: inserted, error } = await auth.supabase
        .from("customers")
        .insert({
          legacy_id: legacyKey || null,
          name: c.name,
          concello,
          village_enc: encryptField(c.village),
          phone_enc: encryptField(c.phone || ""),
          phone_hash: phoneHash,
          lat: c.coordinates.lat,
          lng: c.coordinates.lng,
          equipment_info: c.equipmentInfo || "",
          internal_notes_enc: encryptField(c.internalNotes || ""),
          last_service_type: c.lastServiceType ?? "Revisión",
          last_intervention_minutes: c.lastInterventionMinutes ?? 45,
          last_service_date: c.lastServiceDate || now,
          total_services_history: c.totalServicesHistory ?? 0,
          total_billed_history_eur: c.totalBilledHistoryEur ?? 0,
          created_by: auth.profile.id,
          updated_at: now,
        })
        .select("id")
        .single();

      if (error) {
        return mapDbErrorToResponse(error, "Error migrando clientes a la nube");
      }

      if (inserted) {
        importedCustomers++;
        if (legacyKey) {
          legacyToUuid.set(legacyKey, inserted.id);
          byLegacyId.set(legacyKey, inserted.id);
        }
        if (phoneHash) byPhoneHash.set(phoneHash, inserted.id);
        byNormName.set(normName, inserted.id);
      }
    }

    // 2. Migrar avisos evitando duplicar legacy_id
    const { data: existingOrders } = await auth.supabase
      .from("service_orders")
      .select("legacy_id");
    const existingOrderLegacySet = new Set<string>(
      (existingOrders || [])
        .map((o) => o.legacy_id)
        .filter((x): x is string => Boolean(x))
    );

    for (const o of orders) {
      if (o.id && existingOrderLegacySet.has(o.id)) continue;

      const phoneHash = hashPhoneForLookup(o.customerPhone);
      const resolvedCustId =
        (o.customerId && legacyToUuid.get(o.customerId)) ||
        (o.customerId && byLegacyId.get(o.customerId)) ||
        (phoneHash && byPhoneHash.get(phoneHash)) ||
        (o.customerName && byNormName.get(o.customerName.trim().toLowerCase()));

      if (!resolvedCustId) continue;

      const { error } = await auth.supabase.from("service_orders").insert({
        legacy_id: o.id || null,
        customer_id: resolvedCustId,
        service_type: o.serviceType,
        priority: o.priority,
        equipment_info: o.equipmentInfo || "",
        estimated_minutes: o.estimatedMinutes,
        actual_minutes: o.actualMinutes ?? null,
        estimated_price_eur: o.estimatedPriceEur ?? 0,
        collected_price_eur: o.collectedPriceEur ?? null,
        technical_notes_enc: encryptField(o.technicalNotes || ""),
        resolution_note_enc: encryptField(o.resolutionNote || ""),
        status: o.status,
        created_by: auth.profile.id,
        created_at: o.createdAt || now,
        completed_at: o.completedAt || null,
        updated_at: now,
      });

      if (error) {
        return mapDbErrorToResponse(error, "Error migrando partes a la nube");
      }
      importedOrders++;
    }

    // 3. Migrar configuración de taller si se incluye
    if (config) {
      const cfgPatch: Record<string, unknown> = { updated_at: now };
      if (config.maxWorkdayMinutes !== undefined)
        cfgPatch.max_workday_minutes = config.maxWorkdayMinutes;
      if (config.maxStopsPerRoute !== undefined)
        cfgPatch.max_stops_per_route = config.maxStopsPerRoute;
      if (config.workdayStartTime !== undefined)
        cfgPatch.workday_start_time = config.workdayStartTime;
      if (config.warehouseName !== undefined)
        cfgPatch.warehouse_name = config.warehouseName;
      if (config.warehouseVillage !== undefined)
        cfgPatch.warehouse_village = config.warehouseVillage;
      if (config.warehouseCoordinates !== undefined) {
        cfgPatch.warehouse_lat = config.warehouseCoordinates.lat;
        cfgPatch.warehouse_lng = config.warehouseCoordinates.lng;
      }
      if (config.consumoL100 !== undefined)
        cfgPatch.consumo_l100 = config.consumoL100;
      if (config.precioCombustible !== undefined)
        cfgPatch.precio_combustible = config.precioCombustible;
      if (config.hourlyCostEur !== undefined)
        cfgPatch.hourly_cost_eur = config.hourlyCostEur;

      await auth.supabase.from("app_config").update(cfgPatch).eq("id", 1);
    }

    await logAuditEvent(
      auth.supabase,
      auth.profile,
      "migration.local_to_cloud",
      "system",
      "migrate",
      { importedCustomers, importedOrders }
    );

    return NextResponse.json({
      ok: true,
      importedCustomers,
      importedOrders,
    });
  } catch (err) {
    return mapDbErrorToResponse(err, "Error durante la migración a la nube");
  }
}
