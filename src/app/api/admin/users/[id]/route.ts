import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireAuthSession,
  createSupabaseAdminClient,
  logAuditEvent,
  mapDbErrorToResponse,
} from "@/lib/supabase/server";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchUserSchema = z.object({
  isActive: z.boolean().optional(),
  role: z.enum(["admin", "tecnico"]).optional(),
  fullName: z.string().trim().min(2).max(120).optional(),
  newPassword: z.string().min(8).max(128).optional(),
});

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthSession(["admin"]);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = patchUserSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Datos inválidos" },
      { status: 400 }
    );
  }

  const updates = parsed.data;

  if (id === auth.profile.id && updates.isActive === false) {
    return NextResponse.json(
      { error: "No puedes revocar tu propia cuenta mientras estás conectado." },
      { status: 400 }
    );
  }
  if (id === auth.profile.id && updates.role === "tecnico") {
    return NextResponse.json(
      { error: "No puedes quitarte a ti mismo el rol de administrador." },
      { status: 400 }
    );
  }

  const dbPatch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (updates.isActive !== undefined) dbPatch.is_active = updates.isActive;
  if (updates.role !== undefined) dbPatch.role = updates.role;
  if (updates.fullName !== undefined) dbPatch.full_name = updates.fullName;

  const { data: updatedProfile, error } = await auth.supabase
    .from("profiles")
    .update(dbPatch)
    .eq("id", id)
    .select("id, email, full_name, role, is_active, created_at, updated_at")
    .single();

  if (error || !updatedProfile) {
    return mapDbErrorToResponse(error, "Error actualizando usuario");
  }

  // Si hay SUPABASE_SERVICE_ROLE_KEY, aplicar también baneo/desbaneo o cambio de contraseña en Auth
  const adminClient = createSupabaseAdminClient();
  if (adminClient) {
    if (updates.isActive === false) {
      await adminClient.auth.admin.updateUserById(id, {
        ban_duration: "876000h",
      });
    } else if (updates.isActive === true) {
      await adminClient.auth.admin.updateUserById(id, {
        ban_duration: "none",
      });
    }

    if (updates.role !== undefined) {
      await adminClient.auth.admin.updateUserById(id, {
        app_metadata: { role: updates.role },
      });
    }

    if (updates.newPassword) {
      await adminClient.auth.admin.updateUserById(id, {
        password: updates.newPassword,
      });
    }
  } else if (updates.newPassword) {
    return NextResponse.json(
      {
        error:
          "Se actualizó el perfil, pero falta SUPABASE_SERVICE_ROLE_KEY en el servidor para cambiar contraseñas directamente.",
        code: "MISSING_SERVICE_ROLE",
      },
      { status: 503 }
    );
  }

  await logAuditEvent(
    auth.supabase,
    auth.profile,
    updates.isActive === false
      ? "user.revoke"
      : updates.isActive === true
      ? "user.reactivate"
      : "user.update",
    "profile",
    id,
    {
      isActive: updates.isActive ?? updatedProfile.is_active,
      role: updatedProfile.role,
    }
  );

  return NextResponse.json({
    user: {
      id: updatedProfile.id,
      email: updatedProfile.email,
      fullName: updatedProfile.full_name,
      role: updatedProfile.role,
      isActive: updatedProfile.is_active,
      createdAt: updatedProfile.created_at,
      updatedAt: updatedProfile.updated_at,
    },
  });
}
