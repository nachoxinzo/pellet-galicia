import { createServerClient } from "@supabase/ssr";
import { createClient, User, SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { UserProfile, UserRole } from "@/types/pelletGalicia";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Faltan las variables NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // En Server Components de solo lectura ignoramos setAll si no aplica
        }
      },
    },
  });
}

/**
 * Cliente administrativo con Service Role Key.
 * Se usa únicamente en endpoints de gestión de usuarios (/api/admin/users).
 * Devuelve null si SUPABASE_SERVICE_ROLE_KEY no está configurada todavía.
 */
export function createSupabaseAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !serviceKey) {
    return null;
  }

  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export type AuthSessionResult =
  | {
      ok: true;
      supabase: SupabaseClient;
      user: User;
      profile: UserProfile;
    }
  | {
      ok: false;
      response: NextResponse;
    };

export async function requireAuthSession(
  allowedRoles?: UserRole[]
): Promise<AuthSessionResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sesión no iniciada o caducada.", code: "UNAUTHORIZED" },
        { status: 401 }
      ),
    };
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active, created_at, updated_at")
    .eq("id", user.id)
    .single();

  if (profileError || !profileRow) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Perfil de usuario no encontrado en SATRuta.", code: "FORBIDDEN" },
        { status: 403 }
      ),
    };
  }

  if (!profileRow.is_active) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Tu cuenta ha sido revocada o desactivada.", code: "ACCOUNT_DISABLED" },
        { status: 403 }
      ),
    };
  }

  const role = profileRow.role as UserRole;
  if (allowedRoles && !allowedRoles.includes(role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No tienes permisos suficientes para esta operación.", code: "FORBIDDEN" },
        { status: 403 }
      ),
    };
  }

  const profile: UserProfile = {
    id: profileRow.id,
    email: profileRow.email,
    fullName: profileRow.full_name,
    role,
    isActive: profileRow.is_active,
    createdAt: profileRow.created_at,
    updatedAt: profileRow.updated_at,
  };

  return { ok: true, supabase, user, profile };
}

export async function logAuditEvent(
  supabase: SupabaseClient,
  profile: UserProfile,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, string | number | boolean | null> = {}
): Promise<void> {
  try {
    await supabase.from("audit_logs").insert({
      actor_id: profile.id,
      actor_email: profile.email,
      actor_role: profile.role,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata,
    });
  } catch (err) {
    console.warn("Aviso registrando audit_log:", err);
  }
}

export function mapDbErrorToResponse(
  err: unknown,
  fallbackMessage = "Error interno de base de datos"
): NextResponse {
  const msg =
    typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err || fallbackMessage);

  if (msg.includes("STORAGE_QUOTA_EXCEEDED")) {
    return NextResponse.json(
      {
        error:
          "Límite de almacenamiento (50 MB) alcanzado en SATRuta. Purga logs antiguos o archiva partes cerrados antes de crear nuevos registros.",
        code: "STORAGE_QUOTA_EXCEEDED",
      },
      { status: 507 }
    );
  }

  if (msg.includes("FORBIDDEN")) {
    return NextResponse.json(
      { error: "No tienes permisos para esta acción.", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  if (msg.includes("ORDER_NOT_ACTIVE")) {
    return NextResponse.json(
      { error: "El aviso ya fue cerrado o cancelado previamente.", code: "CONFLICT" },
      { status: 409 }
    );
  }

  return NextResponse.json(
    { error: fallbackMessage, code: "DB_ERROR" },
    { status: 500 }
  );
}
