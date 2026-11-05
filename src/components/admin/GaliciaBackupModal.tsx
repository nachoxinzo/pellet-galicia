"use client";

import React, { useState } from "react";
import { Download, Upload, ShieldCheck, FileJson, Check, AlertCircle } from "lucide-react";
import { galiciaStorage } from "@/services/galiciaStorage";

interface GaliciaBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataRestored: () => void;
}

export default function GaliciaBackupModal({
  isOpen,
  onClose,
  onDataRestored,
}: GaliciaBackupModalProps) {
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  if (!isOpen) return null;

  const handleExport = () => {
    try {
      const json = galiciaStorage.exportBackupJson();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const dateStr = new Date().toISOString().split("T")[0];
      a.href = url;
      a.download = `PelletGalicia_Backup_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setFeedback({
        type: "success",
        text: "✓ Archivo JSON descargado correctamente en tu PC.",
      });
      onDataRestored();
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

    try {
      const text = await file.text();
      galiciaStorage.importBackupJson(text);
      setFeedback({
        type: "success",
        text: "✓ Base de datos local restaurada con éxito.",
      });
      onDataRestored();
    } catch {
      setFeedback({
        type: "error",
        text: "❌ El archivo no es un backup válido de PelletGalicia.",
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 text-white shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
              <FileJson className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base">Copia de Seguridad Local</h3>
              <p className="text-xs text-slate-400">Exporta o restaura tus clientes y pedidos</p>
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

        <div className="p-3 rounded-2xl bg-slate-800/60 border border-slate-700/80 text-xs text-slate-300 space-y-1">
          <p className="font-bold text-white flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Privacidad Local-First & Zero-Cloud:
          </p>
          <p className="text-slate-400 text-[11px]">
            Tus datos no pasan por ningún servidor. Descarga este archivo JSON para conservarlos en tu ordenador o transferirlos a otro equipo.
          </p>
        </div>

        {feedback && (
          <div
            className={`p-3 rounded-xl text-xs font-bold ${
              feedback.type === "success"
                ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
                : "bg-red-500/10 border border-red-500/30 text-red-400"
            }`}
          >
            {feedback.text}
          </div>
        )}

        <div className="space-y-3 pt-1">
          <button
            type="button"
            onClick={handleExport}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-black text-xs transition shadow-lg shadow-amber-600/20"
          >
            <Download className="w-4 h-4" />
            Exportar Backup Seguro (JSON)
          </button>

          <label className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs border border-slate-700 transition cursor-pointer">
            <Upload className="w-4 h-4 text-amber-400" />
            <span>Importar Backup desde PC (JSON)</span>
            <input
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
