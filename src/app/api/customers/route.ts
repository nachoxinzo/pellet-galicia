import { NextRequest, NextResponse } from "next/server";
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
  CustomerDbRow,
  mapCustomerRow,
} from "@/lib/mappers/satMappers";
import {
  extractConcelloFromVillage,
  normalizeGaliciaText,
} from "@/services/galiciaStorage";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET() {
  const auth = await requireAuthSession(["admin"]);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("customers")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    return mapDbErrorToResponse(error, "Error cargando clientes de la nube");
  }

  const customers = (data as CustomerDbRow[]).map(mapCustomerRow);
  return NextResponse.json({ customers });
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

  const parsed = customerInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Datos de cliente inválidos" },
      { status: 400 }
    );
  }

  const input = parsed.data;
  const concello = extractConcelloFromVillage(input.village);
  const phoneHash = hashPhoneForLookup(input.phone);

  // Buscar coincidencia existente por ID UUID, legacy_id, phone_hash o nombre normalizado
  let existing: CustomerDbRow | null = null;

  if (input.id && UUID_REGEX.test(input.id)) {
    const { data } = await auth.supabase
      .from("customers")
      .select("*")
      .eq("id", input.id)
      .maybeSingle();
    if (data) existing = data as CustomerDbRow;
  }

  if (!existing && input.legacyId) {
    const { data } = await auth.supabase
      .from("customers")
      .select("*")
      .eq("legacy_id", input.legacyId)
      .maybeSingle();
    if (data) existing = data as CustomerDbRow;
  }

  if (!existing && phoneHash) {
    const { data } = await auth.supabase
      .from("customers")
      .select("*")
      .eq("phone_hash", phoneHash)
      .limit(1)
      .maybeSingle();
    if (data) existing = data as CustomerDbRow;
  }

  if (!existing) {
    const normTarget = normalizeGaliciaText(input.name);
    const { data: candidates } = await auth.supabase
      .from("customers")
      .select("*")
      .ilike("name", input.name.trim())
      .limit(10);

    if (candidates && candidates.length > 0) {
      const matched = (candidates as CustomerDbRow[]).find(
        (c) => normalizeGaliciaText(c.name) === normTarget
      );
      if (matched) existing = matched;
    }
  }

  const now = new Date().toISOString();

  if (existing) {
    const existingDecrypted = mapCustomerRow(existing);
    const resolvedPhone = input.phone?.trim() || existingDecrypted.phone || "";
    const resolvedEquipment =
      input.equipmentInfo?.trim() || existingDecrypted.equipmentInfo || "";
    const resolvedNotes =
      input.internalNotes?.trim() || existingDecrypted.internalNotes || "";

    const { data: updated, error } = await auth.supabase
      .from("customers")
      .update({
        name: input.name,
        concello,
        village_enc: encryptField(input.village),
        phone_enc: encryptField(resolvedPhone),
        phone_hash: hashPhoneForLookup(resolvedPhone),
        lat: input.coordinates.lat,
        lng: input.coordinates.lng,
        equipment_info: resolvedEquipment,
        internal_notes_enc: encryptField(resolvedNotes),
        last_service_type:
          input.lastServiceType ?? existingDecrypted.lastServiceType ?? "Revisión",
        last_intervention_minutes:
          input.lastInterventionMinutes ??
          existingDecrypted.lastInterventionMinutes ??
          45,
        updated_at: now,
      })
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error || !updated) {
      return mapDbErrorToResponse(error, "Error actualizando el cliente");
    }

    await logAuditEvent(
      auth.supabase,
      auth.profile,
      "customer.update",
      "customer",
      existing.id,
      { concello }
    );

    return NextResponse.json({
      customer: mapCustomerRow(updated as CustomerDbRow),
    });
  }

  const { data: inserted, error } = await auth.supabase
    .from("customers")
    .insert({
      legacy_id: input.legacyId || null,
      name: input.name,
      concello,
      village_enc: encryptField(input.village),
      phone_enc: encryptField(input.phone || ""),
      phone_hash: phoneHash,
      lat: input.coordinates.lat,
      lng: input.coordinates.lng,
      equipment_info: input.equipmentInfo || "",
      internal_notes_enc: encryptField(input.internalNotes || ""),
      last_service_type: input.lastServiceType ?? "Revisión",
      last_intervention_minutes: input.lastInterventionMinutes ?? 45,
      last_service_date: input.lastServiceDate || now,
      total_services_history: input.totalServicesHistory ?? 0,
      total_billed_history_eur: input.totalBilledHistoryEur ?? 0,
      created_by: auth.profile.id,
      updated_at: now,
    })
    .select("*")
    .single();

  if (error || !inserted) {
    return mapDbErrorToResponse(error, "Error guardando nuevo cliente");
  }

  await logAuditEvent(
    auth.supabase,
    auth.profile,
    "customer.create",
    "customer",
    (inserted as CustomerDbRow).id,
    { concello }
  );

  return NextResponse.json(
    { customer: mapCustomerRow(inserted as CustomerDbRow) },
    { status: 201 }
  );
}
