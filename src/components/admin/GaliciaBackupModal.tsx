"use client";

import React, { useState } from "react";
import {
  Download,
  Upload,
  ShieldCheck,
  FileJson,
  Loader2,
} from "lucide-react";
import { Customer, ServiceOrder, TechnicianConfig } from "@/types/pelletGalicia";
import { cloudApi, CloudApiError } from "@/services/cloudApi";

interface GaliciaBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataRestored: () => Promise<void> | void;
  customers: Customer[];
  orders: ServiceOrder[];
  config: TechnicianConfig;
}

export default function GaliciaBackupModal({
  isOpen,
  onClose,
  onDataRestored,
  customers,
  orders,
  config,
}: GaliciaBackupModalProps) {
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  if (!isOpen) return null;

  const handleExport = () => {
    try {
      const { googleMapsApiKey: _omit, ...safeConfig } = config;
      const nowIso = new Date().toISOString();
      const payload = {
        app: "SATRuta",
        version: "4.0-cloud",
        exportedAt: nowIso,
        data: {
          customers,
          orders,
          config: safeConfig,
        },
      };

      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const dateStr = nowIso.split("T")[0];
      a.href = url;
      a.download = `SATRuta_Cloud_Backup_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setFeedback({
        type: "success",
        text: `Archivo JSON descargado (${customers.length} clientes · ${orders.length} partes).`,
      });
    } catch {
      setFeedback({
        type: "error",
        text: "Error exportando el backup.",
      });
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setFeedback(null);

    try {
      const text = await file.text();
      if (text.length > 10 * 1024 * 1024) {
        throw new Error("El archivo supera el máximo permitido (10 MB).");
      }
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || !parsed.data) {
        throw new Error("Formato de backup inválido.");
      }

      const rawCustomers: Customer[] = Array.isArray(parsed.data.customers)
        ? parsed.data.customers
        : [];
      const rawOrders: ServiceOrder[] = Array.isArray(parsed.data.orders)
        ? parsed.data.orders
        : [];
      const rawConfig = parsed.data.config;

      const res = await cloudApi.migrateLocalData({
        customers: rawCustomers,
        orders: rawOrders,
        config: rawConfig,
      });

      await onDataRestored();
      setFeedback({
        type: "success",
        text: `Importación a la nube completada: ${res.importedCustomers} clientes y ${res.importedOrders} partes nuevos.`,
      });
    } catch (err) {
      const msg =
        err instanceof CloudApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : "El archivo no es un backup válido de SATRuta.";
      setFeedback({
        type: "error",
        text: msg,
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-white/[0.1] rounded-3xl max-w-md w-full p-6 text-white shadow-2xl space-y-5">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
              <FileJson className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base">
                Copia de Seguridad (Nube ⇄ PC)
              </h3>
              <p className="text-xs text-slate-400">
                Exporta o importa clientes y partes en JSON
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg"
          >
            ✕
          </button>
        </div>

        <div className="p-3 rounded-2xl bg-slate-950/60 border border-white/[0.07] text-xs text-slate-300 space-y-1">
          <p className="font-bold text-white flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Respaldo Portable Cifrado al Importar:
          </p>
          <p className="text-slate-400 text-[11px]">
            Los datos exportados se descifran únicamente bajo tu sesión de administrador. Al importar un JSON, los teléfonos, direcciones y notas vuelven a cifrarse con AES-256-GCM en servidor respetando el límite de 50 MB.
          </p>
        </div>

        {feedback && (
          <div
            className={`p-3 rounded-xl text-xs font-bold ${
              feedback.type === "success"
                ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
                : "bg-rose-500/10 border border-rose-500/30 text-rose-400"
            }`}
          >
            {feedback.text}
          </div>
        )}

        <div className="space-y-3 pt-1">
          <button
            type="button"
            onClick={handleExport}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs transition shadow-lg shadow-amber-500/20"
          >
            <Download className="w-4 h-4" />
            Exportar Backup desde la Nube (JSON)
          </button>

          <label className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs border border-white/[0.08] transition cursor-pointer">
            {isImporting ? (
              <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
            ) : (
              <Upload className="w-4 h-4 text-amber-400" />
            )}
            <span>
              {isImporting
                ? "Importando y cifrando en nube..."
                : "Importar Backup JSON a la Nube"}
            </span>
            <input
              type="file"
              accept=".json"
              disabled={isImporting}
              onChange={handleImport}
              className="hidden"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
