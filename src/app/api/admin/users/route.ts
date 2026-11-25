import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireAuthSession,
  createSupabaseAdminClient,
  logAuditEvent,
  mapDbErrorToResponse,
} from "@/lib/supabase/server";

const createUserSchema = z.object({
  mode: z.literal("create"),
  email: z.string().trim().email("Email inválido"),
  fullName: z.string().trim().min(2, "Nombre requerido").max(120),
  password: z.string().min(8, "Contraseña mínima de 8 caracteres").max(128),
  role: z.enum(["admin", "tecnico"]),
});

const inviteUserSchema = z.object({
  mode: z.literal("invite"),
  email: z.string().trim().email("Email inválido"),
  fullName: z.string().trim().min(2, "Nombre requerido").max(120),
  role: z.enum(["admin", "tecnico"]),
});

const postUserSchema = z.discriminatedUnion("mode", [
  createUserSchema,
  inviteUserSchema,
]);

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
          "Falta configurar SUPABASE_SERVICE_ROLE_KEY en el servidor (Vercel/.env.local) para crear o invitar cuentas desde /admin.",
        code: "MISSING_SERVICE_ROLE",
      },
      { status: 503 }
    );
  }

  let rawBody: Record<string, unknown>;
  try {
    rawBody = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const normalizedBody = {
    ...rawBody,
    mode: rawBody?.mode === "invite" ? "invite" : "create",
  };

  const parsed = postUserSchema.safeParse(normalizedBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Datos inválidos" },
      { status: 400 }
    );
  }

  const payload = parsed.data;
  const now = new Date().toISOString();

  if (payload.mode === "invite") {
    const siteOrigin =
      process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") ||
      req.nextUrl.origin;

    const { data: invited, error: inviteErr } =
      await adminClient.auth.admin.inviteUserByEmail(payload.email, {
        data: { full_name: payload.fullName },
        redirectTo: `${siteOrigin}/auth/set-password`,
      });

    if (inviteErr || !invited.user) {
      return NextResponse.json(
        {
          error:
            inviteErr?.message ||
            "No se pudo enviar la invitación desde Supabase Auth.",
        },
        { status: 400 }
      );
    }

    // Fijar el rol en app_metadata y en public.profiles
    await adminClient.auth.admin.updateUserById(invited.user.id, {
      app_metadata: { role: payload.role },
    });

    await adminClient.from("profiles").upsert({
      id: invited.user.id,
      email: payload.email,
      full_name: payload.fullName,
      role: payload.role,
      is_active: true,
      updated_at: now,
    });

    await logAuditEvent(
      auth.supabase,
      auth.profile,
      "user.invite",
      "profile",
      invited.user.id,
      { role: payload.role }
    );

    return NextResponse.json(
      {
        user: {
          id: invited.user.id,
          email: payload.email,
          fullName: payload.fullName,
          role: payload.role,
          isActive: true,
        },
        invited: true,
      },
      { status: 201 }
    );
  }

  // Modo creación directa con contraseña temporal
  const { data: created, error: createErr } =
    await adminClient.auth.admin.createUser({
      email: payload.email,
      password: payload.password,
      email_confirm: true,
      user_metadata: { full_name: payload.fullName },
      app_metadata: { role: payload.role },
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

  await adminClient.from("profiles").upsert({
    id: created.user.id,
    email: payload.email,
    full_name: payload.fullName,
    role: payload.role,
    is_active: true,
    updated_at: now,
  });

  await logAuditEvent(
    auth.supabase,
    auth.profile,
    "user.create",
    "profile",
    created.user.id,
    { role: payload.role }
  );

  return NextResponse.json(
    {
      user: {
        id: created.user.id,
        email: payload.email,
        fullName: payload.fullName,
        role: payload.role,
        isActive: true,
      },
      invited: false,
    },
    { status: 201 }
  );
}
