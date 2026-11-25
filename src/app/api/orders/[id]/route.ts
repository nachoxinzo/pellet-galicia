import { NextRequest, NextResponse } from "next/server";
import {
  requireAuthSession,
  logAuditEvent,
  mapDbErrorToResponse,
} from "@/lib/supabase/server";
import { encryptField } from "@/lib/security/fieldCrypto";
import {
  orderUpdateSchema,
  ServiceOrderDbRow,
  mapOrderRow,
} from "@/lib/mappers/satMappers";
import { extractTechTagsFromNotes } from "@/utils/galiciaUrlCodec";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthSession(["admin"]);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = orderUpdateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Datos inválidos" },
      { status: 400 }
    );
  }

  const { data: currentRow, error: fetchErr } = await auth.supabase
    .from("service_orders")
    .select(
      "*, customer:customers(*), assigned_tech:profiles!service_orders_assigned_tech_id_fkey(id, full_name, email)"
    )
    .eq("id", id)
    .single();

  if (fetchErr || !currentRow) {
    return NextResponse.json({ error: "Parte no encontrado" }, { status: 404 });
  }

  const current = mapOrderRow(currentRow as ServiceOrderDbRow);
  if (!current) {
    return NextResponse.json({ error: "Parte corrupto" }, { status: 500 });
  }

  const updates = parsed.data;
  const now = new Date().toISOString();

  const updatedNotes =
    updates.technicalNotes !== undefined
      ? updates.technicalNotes.trim()
      : current.technicalNotes || "";
  const updatedEquipment =
    updates.equipmentInfo !== undefined
      ? updates.equipmentInfo.trim()
      : current.equipmentInfo || "";

  const explicitPrice =
    updates.estimatedPriceEur !== undefined
      ? updates.estimatedPriceEur
      : current.estimatedPriceEur;
  const { cashToCollectEur } = extractTechTagsFromNotes(
    updatedNotes,
    explicitPrice
  );

  const nextStatus = updates.status ?? current.status;
  const dbPatch: Record<string, unknown> = {
    updated_at: now,
    equipment_info: updatedEquipment,
    technical_notes_enc: encryptField(updatedNotes),
  };

  if (updates.assignedTechId !== undefined) {
    dbPatch.assigned_tech_id = updates.assignedTechId;
  }
  if (updates.serviceType !== undefined) {
    dbPatch.service_type = updates.serviceType;
  }
  if (updates.priority !== undefined) {
    dbPatch.priority = updates.priority;
  }
  if (updates.estimatedMinutes !== undefined) {
    dbPatch.estimated_minutes = updates.estimatedMinutes;
  }
  if (updates.estimatedPriceEur !== undefined) {
    dbPatch.estimated_price_eur = Math.max(0, updates.estimatedPriceEur);
  } else if (cashToCollectEur > 0) {
    dbPatch.estimated_price_eur = cashToCollectEur;
  }
  if (updates.status !== undefined) {
    dbPatch.status = updates.status;
    if (updates.status === "Completado") {
      dbPatch.completed_at = now;
      dbPatch.completed_by = auth.profile.id;
    } else if (updates.status === "En Ruta") {
      dbPatch.dispatched_at = now;
    }
  }

  const { data: updatedRow, error: updateErr } = await auth.supabase
    .from("service_orders")
    .update(dbPatch)
    .eq("id", id)
    .select(
      "*, customer:customers(*), assigned_tech:profiles!service_orders_assigned_tech_id_fkey(id, full_name, email)"
    )
    .single();

  if (updateErr || !updatedRow) {
    return mapDbErrorToResponse(updateErr, "Error actualizando parte");
  }

  // Sincronizar ficha cliente
  const custUpdates: Record<string, unknown> = {
    equipment_info: updatedEquipment || current.customer.equipmentInfo || "",
    last_service_type: updates.serviceType ?? current.serviceType,
    last_intervention_minutes:
      updates.estimatedMinutes ?? current.estimatedMinutes,
    internal_notes_enc: encryptField(
      updatedNotes || current.customer.internalNotes || ""
    ),
    updated_at: now,
  };

  if (nextStatus === "Completado" && current.status !== "Completado") {
    const billed = current.collectedPriceEur ?? (dbPatch.estimated_price_eur as number) ?? current.estimatedPriceEur ?? 0;
    custUpdates.last_service_date = now;
    custUpdates.total_billed_history_eur =
      (current.customer.totalBilledHistoryEur || 0) + billed;
  }

  await auth.supabase
    .from("customers")
    .update(custUpdates)
    .eq("id", current.customerId);

  await logAuditEvent(
    auth.supabase,
    auth.profile,
    "order.update",
    "service_order",
    id,
    { status: nextStatus }
  );

  return NextResponse.json({
    order: mapOrderRow(updatedRow as ServiceOrderDbRow),
  });
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthSession(["admin"]);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const { error } = await auth.supabase
    .from("service_orders")
    .delete()
    .eq("id", id);

  if (error) {
    return mapDbErrorToResponse(error, "Error eliminando parte");
  }

  await logAuditEvent(
    auth.supabase,
    auth.profile,
    "order.delete",
    "service_order",
    id,
    {}
  );

  return NextResponse.json({ ok: true });
}
