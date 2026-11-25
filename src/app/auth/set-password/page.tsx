"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  Wrench,
  Lock,
  ShieldCheck,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";

function SetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [isInitializing, setIsInitializing] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const [userEmail, setUserEmail] = useState<string>("");
  const [initError, setInitError] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [doneSuccess, setDoneSuccess] = useState(false);

  useEffect(() => {
    let active = true;

    const verifyInviteSession = async () => {
      try {
        const supabase = createSupabaseBrowserClient();

        const code = searchParams.get("code");
        const tokenHash = searchParams.get("token_hash");
        const typeParam = searchParams.get("type");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (tokenHash && typeParam) {
          const otpType =
            typeParam === "recovery" || typeParam === "email"
              ? typeParam
              : "invite";
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: otpType,
          });
          if (error) throw error;
        } else if (
          typeof window !== "undefined" &&
          window.location.hash.includes("access_token=")
        ) {
          const hashParams = new URLSearchParams(
            window.location.hash.replace(/^#/, "")
          );
          const accessToken = hashParams.get("access_token");
          const refreshToken = hashParams.get("refresh_token");
          if (accessToken && refreshToken) {
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (error) throw error;
            window.history.replaceState(
              {},
              document.title,
              window.location.pathname
            );
          }
        }

        const {
          data: { user },
          error: userErr,
        } = await supabase.auth.getUser();

        if (userErr || !user) {
          throw new Error(
            "El enlace de invitación ha caducado o ya fue utilizado. Pide al administrador que te envíe uno nuevo o te asigne una contraseña."
          );
        }

        if (active) {
          setUserEmail(user.email || "");
          setSessionReady(true);
        }
      } catch (err) {
        if (active) {
          setInitError(
            err instanceof Error
              ? err.message
              : "No se pudo validar tu enlace de invitación."
          );
        }
      } finally {
        if (active) setIsInitializing(false);
      }
    };

    verifyInviteSession();
    return () => {
      active = false;
    };
  }, [searchParams]);

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (password.length < 8) {
      setSubmitError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setSubmitError("Las dos contraseñas no coinciden.");
      return;
    }

    setIsSaving(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setSubmitError(error.message || "No se pudo guardar la contraseña.");
        setIsSaving(false);
        return;
      }

      setDoneSuccess(true);

      const meRes = await fetch("/api/auth/me", { cache: "no-store" });
      if (meRes.ok) {
        const { profile } = await meRes.json();
        router.replace(profile?.role === "admin" ? "/admin" : "/tecnico");
      } else {
        router.replace("/login");
      }
      router.refresh();
    } catch {
      setSubmitError("Error de conexión al guardar la contraseña.");
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 font-sans">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-3">
          <div className="inline-flex p-3.5 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950 shadow-xl shadow-amber-500/20">
            <Wrench className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">
              SAT<span className="text-amber-400">Ruta</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Activación de cuenta y creación de contraseña
            </p>
          </div>
        </div>

        <div className="bg-slate-900/75 backdrop-blur-md border border-white/[0.08] rounded-3xl p-6 sm:p-7 shadow-2xl space-y-4">
          {isInitializing ? (
            <div className="py-8 flex flex-col items-center gap-3 text-xs text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
              <span>Verificando enlace de invitación seguro...</span>
            </div>
          ) : initError || !sessionReady ? (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5 leading-relaxed">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                <span>{initError || "Enlace inválido."}</span>
              </div>
              <Link
                href="/login"
                className="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center justify-center gap-2 transition"
              >
                <span>Ir a Iniciar Sesión</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ) : doneSuccess ? (
            <div className="py-6 text-center space-y-3">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
              <p className="text-sm font-bold text-white">
                Contraseña activada. Entrando a SATRuta...
              </p>
            </div>
          ) : (
            <form onSubmit={handleSavePassword} className="space-y-4">
              {userEmail && (
                <div className="p-3 rounded-xl bg-slate-950/60 border border-white/[0.06] text-xs text-slate-300">
                  Cuenta invitada:{" "}
                  <strong className="text-amber-300">{userEmail}</strong>
                </div>
              )}

              {submitError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                  <span>{submitError}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 block">
                  Nueva contraseña (mín. 8 caracteres)
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-slate-950/80 border border-white/[0.09] rounded-xl text-white placeholder:text-slate-600 outline-none focus:border-amber-500 transition"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 block">
                  Repetir contraseña
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    placeholder="••••••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-slate-950/80 border border-white/[0.09] rounded-xl text-white placeholder:text-slate-600 outline-none focus:border-amber-500 transition"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSaving}
                className="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 font-black text-sm transition shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Guardando contraseña...</span>
                  </>
                ) : (
                  <>
                    <span>Activar cuenta y entrar</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <div className="pt-3 border-t border-white/[0.06] flex items-center justify-center gap-2 text-[11px] text-slate-400">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Acceso privado · Datos cifrados AES-256 en la UE</span>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 text-xs">
          Cargando activación segura...
        </div>
      }
    >
      <SetPasswordContent />
    </Suspense>
  );
}
