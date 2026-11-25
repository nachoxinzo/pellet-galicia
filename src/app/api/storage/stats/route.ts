import { NextResponse } from "next/server";
import {
  requireAuthSession,
  mapDbErrorToResponse,
} from "@/lib/supabase/server";

export async function GET() {
  const auth = await requireAuthSession(["admin"]);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase.rpc("get_satruta_storage_stats");
  if (error) {
    return mapDbErrorToResponse(error, "Error obteniendo uso de almacenamiento");
  }

  return NextResponse.json({ stats: data });
}
