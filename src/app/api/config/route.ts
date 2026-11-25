import { NextRequest, NextResponse } from "next/server";
import {
  requireAuthSession,
  logAuditEvent,
  mapDbErrorToResponse,
} from "@/lib/supabase/server";
import { encryptField } from "@/lib/security/fieldCrypto";
import {
  configUpdateSchema,
  AppConfigDbRow,
  mapConfigRow,
} from "@/lib/mappers/satMappers";

export async function GET() {
  const auth = await requireAuthSession(["admin", "tecnico"]);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("app_config")
    .select("*")
    .eq("id", 1)
    .single();

  if (error || !data) {
    return mapDbErrorToResponse(error, "Error cargando configuración");
  }

  return NextResponse.json({
    config: mapConfigRow(data as AppConfigDbRow),
  });
}

export async function PUT(req: NextRequest) {
  const auth = await requireAuthSession(["admin"]);
  if (!auth.ok) return auth.response;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = configUpdateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Configuración inválida" },
      { status: 400 }
    );
  }

  const input = parsed.data;
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (input.maxWorkdayMinutes !== undefined)
    patch.max_workday_minutes = input.maxWorkdayMinutes;
  if (input.maxStopsPerRoute !== undefined)
    patch.max_stops_per_route = input.maxStopsPerRoute;
  if (input.workdayStartTime !== undefined)
    patch.workday_start_time = input.workdayStartTime;
  if (input.warehouseName !== undefined)
    patch.warehouse_name = input.warehouseName;
  if (input.warehouseVillage !== undefined)
    patch.warehouse_village = input.warehouseVillage;
  if (input.warehouseCoordinates !== undefined) {
    patch.warehouse_lat = input.warehouseCoordinates.lat;
    patch.warehouse_lng = input.warehouseCoordinates.lng;
  }
  if (input.consumoL100 !== undefined) patch.consumo_l100 = input.consumoL100;
  if (input.precioCombustible !== undefined)
    patch.precio_combustible = input.precioCombustible;
  if (input.hourlyCostEur !== undefined)
    patch.hourly_cost_eur = input.hourlyCostEur;

  if (input.clearGoogleMapsApiKey) {
    patch.google_maps_api_key_enc = "";
  } else if (input.googleMapsApiKey && input.googleMapsApiKey.length > 0) {
    patch.google_maps_api_key_enc = encryptField(input.googleMapsApiKey);
  }

  const { data, error } = await auth.supabase
    .from("app_config")
    .update(patch)
    .eq("id", 1)
    .select("*")
    .single();

  if (error || !data) {
    return mapDbErrorToResponse(error, "Error guardando configuración");
  }

  await logAuditEvent(
    auth.supabase,
    auth.profile,
    "config.update",
    "app_config",
    "1",
    {}
  );

  return NextResponse.json({
    config: mapConfigRow(data as AppConfigDbRow),
  });
}
