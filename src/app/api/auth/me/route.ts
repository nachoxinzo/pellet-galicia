import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/supabase/server";

export async function GET() {
  const auth = await requireAuthSession();
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    user: {
      id: auth.user.id,
      email: auth.user.email,
    },
    profile: auth.profile,
  });
}
