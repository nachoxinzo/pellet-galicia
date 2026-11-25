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
import { extractConcelloFromVillage } from "@/services/galiciaStorage";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PUT(
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

  const parsed = customerInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Datos inválidos" },
      { status: 400 }
    );
  }

  const input = parsed.data;
  const concello = extractConcelloFromVillage(input.village);
  const now = new Date().toISOString();

  const { data: updated, error } = await auth.supabase
    .from("customers")
    .update({
      name: input.name,
      concello,
      village_enc: encryptField(input.village),
      phone_enc: encryptField(input.phone || ""),
      phone_hash: hashPhoneForLookup(input.phone || ""),
      lat: input.coordinates.lat,
      lng: input.coordinates.lng,
      equipment_info: input.equipmentInfo || "",
      internal_notes_enc: encryptField(input.internalNotes || ""),
      updated_at: now,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error || !updated) {
    return mapDbErrorToResponse(error, "Error actualizando cliente");
  }

  await logAuditEvent(
    auth.supabase,
    auth.profile,
    "customer.update",
    "customer",
    id,
    { concello }
  );

  return NextResponse.json({
    customer: mapCustomerRow(updated as CustomerDbRow),
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

  const { error } = await auth.supabase.from("customers").delete().eq("id", id);
  if (error) {
    return mapDbErrorToResponse(error, "Error eliminando cliente (RGPD)");
  }

  await logAuditEvent(
    auth.supabase,
    auth.profile,
    "customer.delete_gdpr",
    "customer",
    id,
    {}
  );

  return NextResponse.json({ ok: true });
}
