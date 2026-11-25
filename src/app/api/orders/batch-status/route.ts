import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireAuthSession,
  logAuditEvent,
  mapDbErrorToResponse,
} from "@/lib/supabase/server";
import { ServiceOrderDbRow, mapOrderRow } from "@/lib/mappers/satMappers";

const batchSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(100),
  status: z.enum(["En Ruta", "Completado"]),
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

  const parsed = batchSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Lista de partes o estado inválido" },
      { status: 400 }
    );
  }

  const { orderIds, status } = parsed.data;
  const now = new Date().toISOString();

  if (status === "Completado") {
    const { data: rows } = await auth.supabase
      .from("service_orders")
      .select("*, customer:customers(*)")
      .in("id", orderIds);

    if (rows) {
      for (const r of rows as ServiceOrderDbRow[]) {
        const mapped = mapOrderRow(r);
        if (mapped && mapped.status !== "Completado") {
          const billed =
            mapped.collectedPriceEur ?? mapped.estimatedPriceEur ?? 0;
          await auth.supabase
            .from("customers")
            .update({
              last_service_type: mapped.serviceType,
              last_intervention_minutes:
                mapped.actualMinutes ?? mapped.estimatedMinutes,
              last_service_date: now,
              total_billed_history_eur:
                (mapped.customer.totalBilledHistoryEur || 0) + billed,
              updated_at: now,
            })
            .eq("id", mapped.customerId);
        }
      }
    }
  }

  const patch: Record<string, unknown> = {
    status,
    updated_at: now,
    ...(status === "En Ruta"
      ? { dispatched_at: now }
      : { completed_at: now, completed_by: auth.profile.id }),
  };

  const { error } = await auth.supabase
    .from("service_orders")
    .update(patch)
    .in("id", orderIds);

  if (error) {
    return mapDbErrorToResponse(error, "Error actualizando lote de avisos");
  }

  await logAuditEvent(
    auth.supabase,
    auth.profile,
    `order.batch_${status === "En Ruta" ? "dispatch" : "complete"}`,
    "service_order",
    "batch",
    { count: orderIds.length }
  );

  return NextResponse.json({ ok: true, count: orderIds.length });
}
