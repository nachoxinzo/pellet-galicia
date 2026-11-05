"use client";

import React, { useState } from "react";
import { Download, Upload, ShieldCheck, Key, AlertTriangle, FileCode } from "lucide-react";
import { pelletVanStorage } from "@/services/pelletVanStorage";

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataRestored: () => void;
}

export default function BackupModal({
  isOpen,
  onClose,
  onDataRestored,
}: BackupModalProps) {
  const [tab, setTab] = useState<"export" | "import">("export");
  const [password, setPassword] = useState("");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isOpen) return null;

  const handleExport = async () => {
    if (!password.trim()) {
      setFeedback({ type: "error", msg: "Introduce una contraseña para cifrar el archivo." });
      return;
    }

    try {
      setIsProcessing(true);
      const jsonBackup = await pelletVanStorage.exportEncryptedBackup(password.trim());

      // Descargar como archivo .json
      const blob = new Blob([jsonBackup], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const dateStr = new Date().toISOString().split("T")[0];
      a.href = url;
      a.download = `PelletVan_Backup_AES_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setFeedback({
        type: "success",
        msg: "✓ Copia de seguridad exportada y cifrada con éxito. Guárdala en un lugar seguro.",
      });
      setPassword("");
    } catch (err: any) {
      setFeedback({ type: "error", msg: err.message || "Error al exportar el backup." });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!password.trim()) {
      setFeedback({ type: "error", msg: "Escribe primero la contraseña con la que se cifró el archivo." });
      return;
    }

    try {
      setIsProcessing(true);
      const text = await file.text();
      await pelletVanStorage.importEncryptedBackup(text, password.trim());
      setFeedback({
        type: "success",
        msg: "✓ Base de datos local restaurada correctamente.",
      });
      setPassword("");
      onDataRestored();
    } catch (err: any) {
      setFeedback({
        type: "error",
        msg: "❌ Contraseña incorrecta o archivo de copia dañado.",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-5 text-white shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base">Copia de Seguridad Cifrada</h3>
              <p className="text-xs text-slate-400">Zero-Cloud: Tus datos nunca salen sin cifrar</p>
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

        {/* Pestañas Exportar / Importar */}
        <div className="flex rounded-xl bg-slate-800/80 p-1">
          <button
            type="button"
            onClick={() => {
              setTab("export");
              setFeedback(null);
            }}
            className={`w-1/2 py-2 text-xs font-bold rounded-lg transition ${
              tab === "export" ? "bg-amber-600 text-slate-950" : "text-slate-400 hover:text-white"
            }`}
          >
            Exportar Backup
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("import");
              setFeedback(null);
            }}
            className={`w-1/2 py-2 text-xs font-bold rounded-lg transition ${
              tab === "import" ? "bg-amber-600 text-slate-950" : "text-slate-400 hover:text-white"
            }`}
          >
            Importar / Restaurar
          </button>
        </div>

        {/* Campo de Contraseña de Cifrado */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-slate-300">
            Contraseña Secreta de Cifrado (AES-256) *
          </label>
          <div className="relative">
            <Key className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="password"
              placeholder="Contraseña robusta para proteger tus clientes..."
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 text-xs bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-amber-500 font-mono"
            />
          </div>
          <span className="text-[11px] text-slate-400 block">
            {tab === "export"
              ? "Esta clave servirá para descifrar el archivo cuando lo necesites restaurar."
              : "Introduce la clave con la que creaste esta copia."}
          </span>
        </div>

        {feedback && (
          <div
            className={`p-3 rounded-xl text-xs font-medium ${
              feedback.type === "success"
                ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                : "bg-red-500/10 border border-red-500/20 text-red-400"
            }`}
          >
            {feedback.msg}
          </div>
        )}

        {tab === "export" ? (
          <button
            type="button"
            disabled={isProcessing}
            onClick={handleExport}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-black text-xs transition disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            Descargar Archivo JSON Cifrado
          </button>
        ) : (
          <label className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-black text-xs transition cursor-pointer border border-slate-700">
            <Upload className="w-4 h-4 text-amber-400" />
            <span>Seleccionar Archivo JSON de Backup</span>
            <input
              type="file"
              accept=".json"
              onChange={handleFileImport}
              className="hidden"
            />
          </label>
        )}
      </div>
    </div>
  );
}
