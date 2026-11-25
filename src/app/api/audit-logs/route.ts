import { NextResponse } from "next/server";
import {
  requireAuthSession,
  mapDbErrorToResponse,
} from "@/lib/supabase/server";

export async function GET() {
  const auth = await requireAuthSession(["admin"]);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(100);

  if (error) {
    return mapDbErrorToResponse(error, "Error cargando registro de auditoría");
  }

  return NextResponse.json({ logs: data || [] });
}
