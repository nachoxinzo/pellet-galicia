import { NextRequest, NextResponse } from "next/server";
import {
  requireAuthSession,
  logAuditEvent,
  mapDbErrorToResponse,
} from "@/lib/supabase/server";
import { encryptField } from "@/lib/security/fieldCrypto";
import { techMissingPartsSchema } from "@/lib/mappers/satMappers";

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

  const parsed = techMissingPartsSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ||
          "Indica el repuesto o pieza necesaria",
      },
      { status: 400 }
    );
  }

  const { partsNote } = parsed.data;

  const { data: ok, error } = await auth.supabase.rpc(
    "report_missing_parts_as_tech",
    {
      p_order_id: id,
      p_parts_note_enc: encryptField(partsNote),
    }
  );

  if (error) {
    return mapDbErrorToResponse(
      error,
      "Error notificando falta de repuesto a tienda"
    );
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
    "order.missing_parts_tech",
    "service_order",
    id,
    {}
  );

  return NextResponse.json({ ok: true });
}
