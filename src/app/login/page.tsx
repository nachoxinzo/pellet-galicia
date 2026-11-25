"use client";

import React, { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  Wrench,
  Lock,
  Mail,
  ShieldCheck,
  Loader2,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next");
  const errorParam = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(
    errorParam === "disabled"
      ? "Tu cuenta ha sido desactivada o revocada por un administrador."
      : null
  );

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsLoading(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setErrorMsg("Credenciales incorrectas o cuenta inactiva.");
        setIsLoading(false);
        return;
      }

      // Consultar perfil y rol en el servidor
      const meRes = await fetch("/api/auth/me", { cache: "no-store" });
      if (!meRes.ok) {
        const errData = await meRes.json().catch(() => null);
        setErrorMsg(
          errData?.error ||
            "No tienes un perfil activo asignado en SATRuta. Contacta con un administrador."
        );
        await supabase.auth.signOut();
        setIsLoading(false);
        return;
      }

      const { profile } = await meRes.json();

      if (nextPath && nextPath.startsWith("/")) {
        if (nextPath.startsWith("/admin") && profile.role !== "admin") {
          router.replace("/tecnico");
        } else {
          router.replace(nextPath);
        }
      } else {
        router.replace(profile.role === "admin" ? "/admin" : "/tecnico");
      }
      router.refresh();
    } catch (err) {
      console.error("Error en inicio de sesión:", err);
      setErrorMsg("Error de conexión con el servidor de autenticación.");
      setIsLoading(false);
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
              Acceso privado para coordinación y técnicos en campo
            </p>
          </div>
        </div>

        <form
          onSubmit={handleLogin}
          className="bg-slate-900/75 backdrop-blur-md border border-white/[0.08] rounded-3xl p-6 sm:p-7 shadow-2xl space-y-4"
        >
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 block">
              Correo electrónico
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="usuario@empresa.es"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-slate-950/80 border border-white/[0.09] rounded-xl text-white placeholder:text-slate-600 outline-none focus:border-amber-500 transition"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 block">
              Contraseña
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-slate-950/80 border border-white/[0.09] rounded-xl text-white placeholder:text-slate-600 outline-none focus:border-amber-500 transition"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 font-black text-sm transition shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Verificando sesión...</span>
              </>
            ) : (
              <>
                <span>Entrar en SATRuta</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          <div className="pt-3 border-t border-white/[0.06] flex items-center justify-center gap-2 text-[11px] text-slate-400">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>
              Registro cerrado por invitación · Datos cifrados AES-256 en la UE
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 text-xs">
          Cargando acceso seguro...
        </div>
      }
    >
      <LoginFormContent />
    </Suspense>
  );
}
