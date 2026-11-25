import { NextRequest, NextResponse } from "next/server";
import {
  requireAuthSession,
  logAuditEvent,
  mapDbErrorToResponse,
} from "@/lib/supabase/server";
import { encryptField } from "@/lib/security/fieldCrypto";
import {
  orderCreateSchema,
  CustomerDbRow,
  ServiceOrderDbRow,
  mapCustomerRow,
  mapOrderRow,
} from "@/lib/mappers/satMappers";
import { extractTechTagsFromNotes } from "@/utils/galiciaUrlCodec";
import { extractConcelloFromVillage } from "@/services/galiciaStorage";

export async function GET() {
  const auth = await requireAuthSession(["admin"]);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("service_orders")
    .select(
      "*, customer:customers(*), assigned_tech:profiles!service_orders_assigned_tech_id_fkey(id, full_name, email)"
    )
    .order("created_at", { ascending: false });

  if (error) {
    return mapDbErrorToResponse(error, "Error cargando avisos y partes");
  }

  const orders = (data as ServiceOrderDbRow[])
    .map(mapOrderRow)
    .filter((o): o is NonNullable<typeof o> => o !== null);

  return NextResponse.json({ orders });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthSession(["admin"]);
  if (!auth.ok) return auth.response;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = orderCreateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Datos del aviso inválidos" },
      { status: 400 }
    );
  }

  const input = parsed.data;

  const { data: custRow, error: custErr } = await auth.supabase
    .from("customers")
    .select("*")
    .eq("id", input.customerId)
    .single();

  if (custErr || !custRow) {
    return NextResponse.json(
      { error: "Cliente no encontrado" },
      { status: 404 }
    );
  }

  const existingCust = mapCustomerRow(custRow as CustomerDbRow);
  const now = new Date().toISOString();

  const resolvedNotes =
    input.technicalNotes?.trim() || existingCust.internalNotes || "";
  const resolvedEquipment =
    input.equipmentInfo?.trim() || existingCust.equipmentInfo || "";
  const { cashToCollectEur } = extractTechTagsFromNotes(
    resolvedNotes,
    input.estimatedPriceEur
  );

  // Actualizar ficha resumen del cliente
  await auth.supabase
    .from("customers")
    .update({
      equipment_info: resolvedEquipment,
      last_service_type: input.serviceType,
      last_intervention_minutes: input.estimatedMinutes,
      last_service_date: now,
      total_services_history: (existingCust.totalServicesHistory || 0) + 1,
      internal_notes_enc: encryptField(resolvedNotes),
      updated_at: now,
    })
    .eq("id", input.customerId);

  const { data: inserted, error } = await auth.supabase
    .from("service_orders")
    .insert({
      customer_id: input.customerId,
      assigned_tech_id: input.assignedTechId || null,
      service_type: input.serviceType,
      priority: input.priority,
      equipment_info: resolvedEquipment,
      estimated_minutes: input.estimatedMinutes,
      estimated_price_eur: cashToCollectEur > 0 ? cashToCollectEur : 0,
      technical_notes_enc: encryptField(resolvedNotes),
      resolution_note_enc: "",
      concello: extractConcelloFromVillage(existingCust.village),
      status: "Pendiente",
      created_by: auth.profile.id,
      updated_at: now,
    })
    .select(
      "*, customer:customers(*), assigned_tech:profiles!service_orders_assigned_tech_id_fkey(id, full_name, email)"
    )
    .single();

  if (error || !inserted) {
    return mapDbErrorToResponse(error, "Error creando parte de trabajo");
  }

  const mapped = mapOrderRow(inserted as ServiceOrderDbRow);

  await logAuditEvent(
    auth.supabase,
    auth.profile,
    "order.create",
    "service_order",
    (inserted as ServiceOrderDbRow).id,
    {
      serviceType: input.serviceType,
      priority: input.priority,
      assignedTechId: input.assignedTechId || null,
    }
  );

  return NextResponse.json({ order: mapped }, { status: 201 });
}
