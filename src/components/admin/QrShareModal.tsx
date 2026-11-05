"use client";

import React, { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Share2,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  MessageCircle,
  QrCode,
  X,
  FileCheck,
  Navigation,
  MapPin,
} from "lucide-react";
import { generateGoogleMapsMultiStopUrl } from "@/utils/googleMapsMultiStop";
import { Coordinates } from "@/types/pelletVan";

interface QrShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  encodedData: string;
  tripNumber: number;
  stopsCount: number;
  totalSacks: number;
  warehouseCoords?: Coordinates;
  stopsCoords?: Coordinates[];
}

export default function QrShareModal({
  isOpen,
  onClose,
  encodedData,
  tripNumber,
  stopsCount,
  totalSacks,
  warehouseCoords,
  stopsCoords = [],
}: QrShareModalProps) {
  const [copied, setCopied] = useState(false);
  const [copiedGmaps, setCopiedGmaps] = useState(false);

  if (!isOpen) return null;

  // Construir la URL completa para el repartidor
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const deliveryUrl = `${baseUrl}/reparto?data=${encodedData}`;

  // Construir el Universal Link oficial de Google Maps con múltiples paradas respetando el orden
  const gmapsMultiStopUrl = warehouseCoords
    ? generateGoogleMapsMultiStopUrl(warehouseCoords, stopsCoords)
    : "";

  const handleCopy = () => {
    navigator.clipboard.writeText(deliveryUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleCopyGmaps = () => {
    if (!gmapsMultiStopUrl) return;
    navigator.clipboard.writeText(gmapsMultiStopUrl);
    setCopiedGmaps(true);
    setTimeout(() => setCopiedGmaps(false), 2500);
  };

  const handleOpenWhatsApp = () => {
    const text = encodeURIComponent(
      `🚛 Hoja de Reparto PelletVan (Viaje #${tripNumber}):\n` +
      `📦 ${stopsCount} entregas (${totalSacks} sacos de pellets).\n\n` +
      `1️⃣ Terminal Móvil Efímera (Cero rastro):\n${deliveryUrl}\n\n` +
      (gmapsMultiStopUrl ? `2️⃣ Ruta Multi-Parada en Google Maps:\n${gmapsMultiStopUrl}` : "")
    );
    window.open(`https://wa.me/?text=${text}`, "_blank");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 text-white shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150 my-6 max-h-[94vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-base">Hoja de Reparto & Navegación</h3>
              <p className="text-xs text-slate-400">
                Viaje #{tripNumber} • {stopsCount} entregas • {totalSacks} sacos
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* CÓDIGO QR EN PANTALLA (Para escanear con la cámara del móvil en el almacén) */}
        <div className="flex flex-col items-center justify-center p-5 bg-white rounded-2xl shadow-inner">
          <QRCodeSVG
            value={deliveryUrl}
            size={200}
            level="M"
            includeMargin={true}
          />
          <p className="text-[11px] font-bold text-slate-800 mt-2 text-center">
            Escanea con la cámara del móvil para abrir en /reparto
          </p>
        </div>

        {/* INTEGRACIÓN DIRECTA CON GOOGLE MAPS MULTI-PARADA */}
        {gmapsMultiStopUrl && (
          <div className="p-3.5 rounded-2xl bg-sky-950/60 border border-sky-800/80 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-sky-400 flex items-center gap-1.5 uppercase tracking-wider">
                <Navigation className="w-4 h-4" />
                Ruta Completa en Google Maps (Nativa)
              </span>
              <span className="text-[10px] text-sky-300 bg-sky-900/60 px-2 py-0.5 rounded-full font-bold">
                {stopsCoords.length} paradas
              </span>
            </div>
            <p className="text-[11px] text-slate-300">
              Abre toda la secuencia ordenada en la app de Google Maps usando las coordenadas exactas de cada tejado/nave (Almacén ➔ Paradas ➔ Almacén).
            </p>
            <div className="flex gap-2 pt-1">
              <a
                href={gmapsMultiStopUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-2.5 px-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-black text-xs flex items-center justify-center gap-1.5 shadow-md shadow-sky-600/30 transition"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Abrir Ruta en Google Maps
              </a>
              <button
                type="button"
                onClick={handleCopyGmaps}
                className="px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold border border-slate-700"
                title="Copiar enlace de Google Maps"
              >
                {copiedGmaps ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        )}

        {/* Garantía de Privacidad Zero-Cloud */}
        <div className="flex items-start gap-2 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs">
          <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            <strong>Transferencia 100% privada:</strong> La información viaja encriptada/comprimida en la URL. El repartidor solo verá la dirección satelital y cantidad de sacos.
          </span>
        </div>

        {/* Botones de Envío Rápido */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleOpenWhatsApp}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs transition shadow-lg shadow-emerald-600/20"
          >
            <MessageCircle className="w-4 h-4" />
            Enviar Hoja de Reparto por WhatsApp (Todo-en-uno)
          </button>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs border border-slate-700 transition"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>¡Enlace /reparto Copiado!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 text-amber-400" />
                  <span>Copiar Enlace /reparto</span>
                </>
              )}
            </button>

            <a
              href={deliveryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs border border-slate-700 flex items-center gap-1"
              title="Abrir vista de repartidor"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Ver /reparto</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
