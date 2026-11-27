import { NextResponse } from "next/server";
import {
  requireAuthSession,
  mapDbErrorToResponse,
} from "@/lib/supabase/server";
import {
  AppConfigDbRow,
  ServiceOrderDbRow,
  mapConfigRow,
  mapOrderRow,
} from "@/lib/mappers/satMappers";

export async function GET() {
  const auth = await requireAuthSession(["admin", "tecnico"]);
  if (!auth.ok) return auth.response;

  const [ordersRes, cfgRes] = await Promise.all([
    auth.supabase
      .from("service_orders")
      .select(
        "*, customer:customers(*), assigned_tech:profiles!service_orders_assigned_tech_id_fkey(id, full_name, email)"
      )
      .in("status", ["Pendiente", "En Ruta"])
      .eq("needs_parts", false)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true }),
    auth.supabase.from("app_config").select("*").eq("id", 1).single(),
  ]);

  if (ordersRes.error) {
    return mapDbErrorToResponse(
      ordersRes.error,
      "Error cargando avisos activos del técnico"
    );
  }

  const orders = ((ordersRes.data || []) as ServiceOrderDbRow[])
    .map(mapOrderRow)
    .filter((o): o is NonNullable<typeof o> => o !== null);

  // Priorizar: 1) Urgentes, 2) Fecha programada (atrasados/hoy/sin fecha primero), 3) Franja horaria (Mañana -> Indiferente -> Tarde)
  const slotWeight = (slot?: string) =>
    slot === "Mañana" ? 0 : slot === "Indiferente" || !slot ? 1 : 2;

  orders.sort((a, b) => {
    if (a.priority === "Urgente" && b.priority !== "Urgente") return -1;
    if (a.priority !== "Urgente" && b.priority === "Urgente") return 1;

    const dateA = a.scheduledDate || "9999-12-31";
    const dateB = b.scheduledDate || "9999-12-31";
    if (dateA !== dateB) return dateA.localeCompare(dateB);

    const slotDiff = slotWeight(a.timeSlot) - slotWeight(b.timeSlot);
    if (slotDiff !== 0) return slotDiff;

    return a.createdAt.localeCompare(b.createdAt);
  });

  const config = cfgRes.data
    ? mapConfigRow(cfgRes.data as AppConfigDbRow)
    : null;

  return NextResponse.json({
    orders,
    config,
    profile: auth.profile,
  });
}
