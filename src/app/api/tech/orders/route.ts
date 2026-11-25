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

  // Priorizar Urgentes arriba del turno
  orders.sort((a, b) => {
    if (a.priority === "Urgente" && b.priority !== "Urgente") return -1;
    if (a.priority !== "Urgente" && b.priority === "Urgente") return 1;
    return 0;
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
