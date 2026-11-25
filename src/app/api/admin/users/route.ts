import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireAuthSession,
  createSupabaseAdminClient,
  logAuditEvent,
  mapDbErrorToResponse,
} from "@/lib/supabase/server";

const createUserSchema = z.object({
  email: z.string().trim().email("Email inválido"),
  fullName: z.string().trim().min(2, "Nombre requerido").max(120),
  password: z.string().min(8, "Contraseña mínima de 8 caracteres").max(128),
  role: z.enum(["admin", "tecnico"]),
});

export async function GET() {
  const auth = await requireAuthSession(["admin"]);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active, created_at, updated_at")
    .order("role", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return mapDbErrorToResponse(error, "Error cargando usuarios del equipo");
  }

  const users = (data || []).map((row) => ({
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return NextResponse.json({
    users,
    canManageAuthUsers: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthSession(["admin"]);
  if (!auth.ok) return auth.response;

  const adminClient = createSupabaseAdminClient();
  if (!adminClient) {
    return NextResponse.json(
      {
        error:
          "Falta configurar SUPABASE_SERVICE_ROLE_KEY en el servidor (Vercel/.env.local) para crear cuentas desde /admin. Mientras tanto puedes invitar al usuario desde el panel de Supabase Authentication -> Users.",
        code: "MISSING_SERVICE_ROLE",
      },
      { status: 503 }
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = createUserSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Datos inválidos" },
      { status: 400 }
    );
  }

  const { email, fullName, password, role } = parsed.data;

  // Verificar cupo máximo operativo sugerido (sin bloquear, solo informativo, aunque respetamos 3 admins + 2 técnicos si se quiere controlar)
  const { data: created, error: createErr } =
    await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
      app_metadata: { role },
    });

  if (createErr || !created.user) {
    return NextResponse.json(
      {
        error:
          createErr?.message || "No se pudo crear la cuenta en Supabase Auth",
      },
      { status: 400 }
    );
  }

  // Asegurar que el perfil tiene el nombre completo y rol exacto
  await adminClient
    .from("profiles")
    .upsert({
      id: created.user.id,
      email,
      full_name: fullName,
      role,
      is_active: true,
      updated_at: new Date().toISOString(),
    });

  await logAuditEvent(
    auth.supabase,
    auth.profile,
    "user.create",
    "profile",
    created.user.id,
    { role }
  );

  return NextResponse.json(
    {
      user: {
        id: created.user.id,
        email,
        fullName,
        role,
        isActive: true,
      },
    },
    { status: 201 }
  );
}
