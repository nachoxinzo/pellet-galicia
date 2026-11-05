"use client";

import React, { useState } from "react";
import { Lock, ShieldCheck, KeyRound, AlertCircle } from "lucide-react";

interface AdminPinGuardProps {
  correctPin: string;
  onAuthenticated: () => void;
  onUpdatePin?: (newPin: string) => void;
}

export default function AdminPinGuard({
  correctPin,
  onAuthenticated,
}: AdminPinGuardProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.trim() === correctPin.trim()) {
      setError(false);
      onAuthenticated();
    } else {
      setError(true);
      setPin("");
    }
  };

  const handleKeyClick = (digit: string) => {
    if (pin.length < 8) {
      setPin((prev) => prev + digit);
      setError(false);
    }
  };

  const handleBackspace = () => {
    setPin((prev) => prev.slice(0, -1));
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 max-w-sm w-full text-center shadow-2xl space-y-6 animate-in fade-in zoom-in-95 duration-200">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto shadow-inner">
          <Lock className="w-8 h-8" />
        </div>

        <div className="space-y-1">
          <span className="text-[11px] font-black uppercase tracking-widest text-amber-400">
            Local-First & Zero-Cloud
          </span>
          <h1 className="text-xl font-extrabold text-white">
            PelletVan Admin
          </h1>
          <p className="text-xs text-slate-400">
            Introduce el PIN local de seguridad para acceder a la gestión de clientes y pedidos.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              autoFocus
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                setError(false);
              }}
              placeholder="••••"
              className="w-full text-center tracking-[0.5em] font-mono text-3xl py-3 px-4 rounded-2xl bg-slate-800 border-2 border-slate-700 text-amber-400 focus:border-amber-500 outline-none transition"
            />
          </div>

          {error && (
            <div className="flex items-center justify-center gap-1.5 text-xs text-red-400 font-medium animate-shake">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>PIN incorrecto. Revisa el código.</span>
            </div>
          )}

          {/* Teclado numérico táctil */}
          <div className="grid grid-cols-3 gap-2.5 pt-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => handleKeyClick(num)}
                className="py-3 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-white font-extrabold text-lg transition shadow-sm"
              >
                {num}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPin("")}
              className="py-3 rounded-xl bg-slate-800/50 hover:bg-slate-700 text-slate-400 font-bold text-xs transition"
            >
              Borrar
            </button>
            <button
              type="button"
              onClick={() => handleKeyClick("0")}
              className="py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-extrabold text-lg transition shadow-sm"
            >
              0
            </button>
            <button
              type="button"
              onClick={handleBackspace}
              className="py-3 rounded-xl bg-slate-800/50 hover:bg-slate-700 text-slate-400 font-bold text-xs transition"
            >
              ⌫
            </button>
          </div>

          <button
            type="submit"
            className="w-full py-3.5 px-4 rounded-2xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-black text-sm tracking-wide shadow-lg shadow-amber-600/25 transition active:scale-[0.98]"
          >
            Entrar al Panel Admin
          </button>
        </form>

        <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-500">
          PIN por defecto: <code className="text-amber-400 font-bold">1234</code> (modificable en ajustes)
        </div>
      </div>
    </div>
  );
}
