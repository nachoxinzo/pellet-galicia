import { NextRequest, NextResponse } from "next/server";
import {
  requireAuthSession,
  logAuditEvent,
  mapDbErrorToResponse,
} from "@/lib/supabase/server";
import { encryptField } from "@/lib/security/fieldCrypto";
import { techCompleteSchema } from "@/lib/mappers/satMappers";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthSession(["admin", "tecnico"]);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: "ID de aviso inválido" }, { status: 400 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = techCompleteSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Datos de cierre inválidos" },
      { status: 400 }
    );
  }

  const { actualMinutes, collectedPriceEur, resolutionNote, serviceType } =
    parsed.data;

  const { data: ok, error } = await auth.supabase.rpc(
    "complete_order_as_tech",
    {
      p_order_id: id,
      p_actual_minutes: actualMinutes,
      p_collected_price_eur: collectedPriceEur,
      p_resolution_note_enc: encryptField(resolutionNote || ""),
      p_service_type: serviceType ?? null,
    }
  );

  if (error) {
    return mapDbErrorToResponse(error, "Error cerrando el parte técnico");
  }

  if (!ok) {
    return NextResponse.json(
      { error: "Aviso no encontrado o ya cerrado" },
      { status: 404 }
    );
  }

  await logAuditEvent(
    auth.supabase,
    auth.profile,
    "order.complete_tech",
    "service_order",
    id,
    {
      actualMinutes,
      collectedPriceEur,
    }
  );

  return NextResponse.json({ ok: true });
}
