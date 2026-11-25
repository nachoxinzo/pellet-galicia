import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireAuthSession,
  logAuditEvent,
  mapDbErrorToResponse,
} from "@/lib/supabase/server";

const pruneSchema = z.object({
  auditOlderThanDays: z.number().int().min(0).max(365).optional().default(30),
  keepLatestAuditRows: z.number().int().min(50).max(5000).optional().default(1000),
  archiveCompletedOlderThanDays: z.number().int().min(7).max(730).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuthSession(["admin"]);
  if (!auth.ok) return auth.response;

  let rawBody: unknown = {};
  try {
    rawBody = await req.json();
  } catch {
    rawBody = {};
  }

  const parsed = pruneSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Parámetros de limpieza inválidos" },
      { status: 400 }
    );
  }

  const {
    auditOlderThanDays,
    keepLatestAuditRows,
    archiveCompletedOlderThanDays,
  } = parsed.data;

  let deletedLogs = 0;
  let deletedOrders = 0;

  try {
    // 1. Borrar audit logs antiguos por fecha
    const cutoffAudit = new Date(
      Date.now() - auditOlderThanDays * 24 * 60 * 60 * 1000
    ).toISOString();

    const { count: ageCount } = await auth.supabase
      .from("audit_logs")
      .delete({ count: "exact" })
      .lt("created_at", cutoffAudit);
    deletedLogs += ageCount || 0;

    // 2. Si aún superan keepLatestAuditRows, recortar los más antiguos
    const { data: tailRows } = await auth.supabase
      .from("audit_logs")
      .select("id")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(keepLatestAuditRows, keepLatestAuditRows + 2000);

    if (tailRows && tailRows.length > 0) {
      const idsToDelete = tailRows.map((r) => r.id);
      const { count: excessCount } = await auth.supabase
        .from("audit_logs")
        .delete({ count: "exact" })
        .in("id", idsToDelete);
      deletedLogs += excessCount || 0;
    }

    // 3. Opcionalmente purgar partes cerrados/cancelados antiguos
    if (archiveCompletedOlderThanDays !== undefined) {
      const cutoffOrders = new Date(
        Date.now() - archiveCompletedOlderThanDays * 24 * 60 * 60 * 1000
      ).toISOString();

      const { count: ordCount } = await auth.supabase
        .from("service_orders")
        .delete({ count: "exact" })
        .in("status", ["Completado", "Cancelado"])
        .lt("updated_at", cutoffOrders);
      deletedOrders += ordCount || 0;
    }

    await logAuditEvent(
      auth.supabase,
      auth.profile,
      "storage.prune",
      "system",
      "quota",
      { deletedLogs, deletedOrders }
    );

    const { data: stats } = await auth.supabase.rpc("get_satruta_storage_stats");
    return NextResponse.json({
      ok: true,
      deletedLogs,
      deletedOrders,
      stats,
    });
  } catch (err) {
    return mapDbErrorToResponse(err, "Error ejecutando limpieza de espacio");
  }
}
