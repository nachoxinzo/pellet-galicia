"use client";

import React, { useState, useEffect, Suspense, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  EphemeralStop,
  EphemeralTripPayload,
  ServiceType,
  Coordinates,
} from "@/types/pelletGalicia";
import {
  decodeTripPayload,
  buildGoogleMapsSingleClientUrl,
  buildTripPayloadFromOrders,
  encodeReturnReceipt,
} from "@/utils/galiciaUrlCodec";
import { galiciaStorage } from "@/services/galiciaStorage";
import {
  formatHoursMinutes,
  getServiceTypeBadgeMeta,
} from "@/utils/satUiHelpers";
import {
  Navigation,
  CheckCircle2,
  Wrench,
  MapPin,
  ShieldCheck,
  AlertCircle,
  Map,
  Home,
  Check,
  Copy,
  WifiOff,
  Banknote,
  Phone,
  MessageCircle,
  Clock,
  RefreshCw,
  ClipboardCheck,
  Flame,
  Cog,
  Laptop,
  ArrowLeft,
} from "lucide-react";

const EPHEMERAL_STORAGE_KEY = "satruta_ephemeral_payload_session";
const COMPLETED_STATS_KEY = "satruta_completed_stats_session";

interface CompletedStats {
  completedStopsCount: number;
  completedMinutesCount: number;
  collectedCashEur: number;
  deliveredItems: {
    shortId: string;
    serviceType: ServiceType;
    actualMinutes: number;
    cashCollectedEur: number;
    resolutionNote?: string;
  }[];
}

function ServiceTypeIcon({
  serviceType,
  priority,
  className = "w-3.5 h-3.5",
}: {
  serviceType: ServiceType;
  priority: "Urgente" | "Normal";
  className?: string;
}) {
  if (priority === "Urgente") return <Flame className={className} />;
  if (serviceType === "Avería") return <Wrench className={className} />;
  if (serviceType === "Instalación") return <Cog className={className} />;
  return <ClipboardCheck className={className} />;
}

function TechTerminalContent() {
  const searchParams = useSearchParams();

  const [terminalMode, setTerminalMode] = useState<"ephemeral" | "local">(
    "ephemeral"
  );
  const [payload, setPayload] = useState<EphemeralTripPayload | null>(null);
  const [stops, setStops] = useState<EphemeralStop[]>([]);
  const [stats, setStats] = useState<CompletedStats>({
    completedStopsCount: 0,
    completedMinutesCount: 0,
    collectedCashEur: 0,
    deliveredItems: [],
  });
  const [localPendingCount, setLocalPendingCount] = useState<number>(0);
  const [manualLinkInput, setManualLinkInput] = useState<string>("");
  const [manualLoadError, setManualLoadError] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [copiedStopId, setCopiedStopId] = useState<string | null>(null);
  const [copiedReceiptToken, setCopiedReceiptToken] = useState(false);

  // Modal de Cierre de Parte
  const [confirmingStop, setConfirmingStop] = useState<EphemeralStop | null>(
    null
  );
  const [actualMinutesInput, setActualMinutesInput] = useState<number>(45);
  const [collectedCashInput, setCollectedCashInput] = useState<string>("0");
  const [resolutionNoteInput, setResolutionNoteInput] = useState<string>("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsOnline(navigator.onLine);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const loadFromLocalStorage = () => {
    const pending = galiciaStorage.getPendingOrders();
    setLocalPendingCount(pending.length);
    if (pending.length > 0) {
      const cfg = galiciaStorage.getConfig();
      const localPayload = buildTripPayloadFromOrders(pending, cfg);
      setTerminalMode("local");
      setPayload(localPayload);
      setStops(localPayload.stops);
      return true;
    }
    return false;
  };

  // Carga Dual: 1) ?r= efímero | 2) sessionStorage efímero | 3) Cola Local del mismo navegador
  useEffect(() => {
    const rawR = searchParams.get("r") || searchParams.get("data");

    if (rawR) {
      const decoded = decodeTripPayload(rawR);
      if (decoded && decoded.stops && decoded.stops.length > 0) {
        setTerminalMode("ephemeral");
        setPayload(decoded);
        setStops(decoded.stops);
        const initialStats: CompletedStats = {
          completedStopsCount: 0,
          completedMinutesCount: 0,
          collectedCashEur: 0,
          deliveredItems: [],
        };
        setStats(initialStats);

        try {
          sessionStorage.setItem(
            EPHEMERAL_STORAGE_KEY,
            JSON.stringify(decoded)
          );
          sessionStorage.setItem(
            COMPLETED_STATS_KEY,
            JSON.stringify(initialStats)
          );
        } catch (e) {
          console.warn("Error guardando en sessionStorage:", e);
        }

        if (typeof window !== "undefined") {
          window.history.replaceState(
            {},
            document.title,
            window.location.pathname
          );
        }

        setIsLoaded(true);
        return;
      }
    }

    // 2. Sesión efímera activa en sessionStorage
    try {
      const rawStored = sessionStorage.getItem(EPHEMERAL_STORAGE_KEY);
      const rawStats = sessionStorage.getItem(COMPLETED_STATS_KEY);
      if (rawStored) {
        const storedPayload = JSON.parse(rawStored) as EphemeralTripPayload;
        if (storedPayload?.stops?.length > 0) {
          setTerminalMode("ephemeral");
          setPayload(storedPayload);
          setStops(storedPayload.stops);
          if (rawStats) {
            const parsedStats = JSON.parse(rawStats);
            setStats({
              completedStopsCount: parsedStats.completedStopsCount || 0,
              completedMinutesCount: parsedStats.completedMinutesCount || 0,
              collectedCashEur: parsedStats.collectedCashEur || 0,
              deliveredItems: Array.isArray(parsedStats.deliveredItems)
                ? parsedStats.deliveredItems
                : [],
            });
          }
          setIsLoaded(true);
          return;
        }
      }
    } catch (e) {
      console.warn("Error leyendo sesión previa:", e);
    }

    // 3. Fallback inteligente: Leer avisos activos guardados en este mismo navegador
    loadFromLocalStorage();
    setIsLoaded(true);
  }, [searchParams]);

  const handleLoadManualLink = () => {
    setManualLoadError(null);
    const trimmed = manualLinkInput.trim();
    if (!trimmed) return;

    let token = trimmed;
    const match = trimmed.match(/[?&](?:r|data)=([^&\s]+)/);
    if (match && match[1]) {
      token = match[1];
    }

    const decoded = decodeTripPayload(token);
    if (!decoded || !decoded.stops || decoded.stops.length === 0) {
      setManualLoadError(
        "No se pudo leer ese enlace o código. Asegúrate de pegar el enlace completo de SATRuta."
      );
      return;
    }

    setTerminalMode("ephemeral");
    setPayload(decoded);
    setStops(decoded.stops);
    const initialStats: CompletedStats = {
      completedStopsCount: 0,
      completedMinutesCount: 0,
      collectedCashEur: 0,
      deliveredItems: [],
    };
    setStats(initialStats);
    setManualLinkInput("");

    try {
      sessionStorage.setItem(EPHEMERAL_STORAGE_KEY, JSON.stringify(decoded));
      sessionStorage.setItem(COMPLETED_STATS_KEY, JSON.stringify(initialStats));
    } catch {
      // ignore
    }
  };

  const openCloseModal = (stop: EphemeralStop) => {
    setConfirmingStop(stop);
    setActualMinutesInput(stop.estimatedMinutes || 45);
    setCollectedCashInput(
      stop.cashToCollectEur && stop.cashToCollectEur > 0
        ? String(stop.cashToCollectEur)
        : "0"
    );
    setResolutionNoteInput("");
  };

  const handleExecuteCompletion = () => {
    if (!confirmingStop) return;

    const remaining = stops.filter((s) => s.id !== confirmingStop.id);
    const shortId =
      confirmingStop.id.replace(/^(eph-|ord-|srv-)/g, "").slice(-6) ||
      String(confirmingStop.seq);
    const parsedCash = Math.max(
      0,
      parseFloat(collectedCashInput.replace(",", ".")) || 0
    );
    const safeMinutes = Math.max(5, Math.min(480, actualMinutesInput || 45));

    // Si estamos en Modo Local (mismo navegador que /admin), sincronizar el cierre directamente
    if (terminalMode === "local") {
      galiciaStorage.completeOrderFromTech(confirmingStop.id, {
        actualMinutes: safeMinutes,
        collectedPriceEur: parsedCash,
        resolutionNote: resolutionNoteInput.trim() || undefined,
        serviceType: confirmingStop.serviceType,
      });
      setLocalPendingCount(galiciaStorage.getPendingOrders().length);
    }

    const newStats: CompletedStats = {
      completedStopsCount: stats.completedStopsCount + 1,
      completedMinutesCount: stats.completedMinutesCount + safeMinutes,
      collectedCashEur: Number((stats.collectedCashEur + parsedCash).toFixed(2)),
      deliveredItems: [
        ...(stats.deliveredItems || []),
        {
          shortId,
          serviceType: confirmingStop.serviceType,
          actualMinutes: safeMinutes,
          cashCollectedEur: parsedCash,
          ...(resolutionNoteInput.trim()
            ? { resolutionNote: resolutionNoteInput.trim().slice(0, 60) }
            : {}),
        },
      ],
    };

    setStops(remaining);
    setStats(newStats);
    setConfirmingStop(null);

    if (terminalMode === "ephemeral") {
      try {
        if (payload) {
          const updatedPayload: EphemeralTripPayload = {
            ...payload,
            stops: remaining,
          };
          setPayload(updatedPayload);

          if (remaining.length > 0) {
            sessionStorage.setItem(
              EPHEMERAL_STORAGE_KEY,
              JSON.stringify(updatedPayload)
            );
          } else {
            sessionStorage.removeItem(EPHEMERAL_STORAGE_KEY);
          }
        }
        sessionStorage.setItem(COMPLETED_STATS_KEY, JSON.stringify(newStats));
      } catch (e) {
        console.warn("Error actualizando sessionStorage:", e);
      }
    }
  };

  const handleNavigateToCustomer = (coords: Coordinates) => {
    const url = buildGoogleMapsSingleClientUrl(coords);
    window.open(url, "_blank");
  };

  const handleCopyGps = async (stop: EphemeralStop) => {
    const gpsText = `${stop.lat.toFixed(5)}, ${stop.lng.toFixed(5)}`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(gpsText);
      } else {
        const ta = document.createElement("textarea");
        ta.value = gpsText;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopiedStopId(stop.id);
      setTimeout(() => {
        setCopiedStopId((prev) => (prev === stop.id ? null : prev));
      }, 2200);
    } catch (e) {
      console.warn("No se pudo copiar GPS:", e);
    }
  };

  const multiStopGoogleMapsUrl = useMemo(() => {
    if (!payload || stops.length === 0) return "";
    const warehouseCoords = payload.warehouse;
    const warehouseStr = `${warehouseCoords.lat.toFixed(6)},${warehouseCoords.lng.toFixed(6)}`;

    if (stops.length === 1) {
      const stop = stops[0];
      return `https://www.google.com/maps/dir/?api=1&destination=${stop.lat.toFixed(6)},${stop.lng.toFixed(6)}&travelmode=driving`;
    }

    const waypoints = stops
      .slice(0, 9)
      .map((s) => `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`)
      .join("|");

    return `https://www.google.com/maps/dir/?api=1&destination=${warehouseStr}&waypoints=${encodeURIComponent(
      waypoints
    )}&travelmode=driving`;
  }, [payload, stops]);

  const handleOpenMultiStopRoute = () => {
    if (multiStopGoogleMapsUrl) {
      window.open(multiStopGoogleMapsUrl, "_blank");
    }
  };

  const handleReturnToWarehouse = () => {
    if (!payload?.warehouse) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${payload.warehouse.lat.toFixed(6)},${payload.warehouse.lng.toFixed(6)}&travelmode=driving`;
    window.open(url, "_blank");
  };

  const currentStop = stops[0] || null;
  const upcomingStops = stops.slice(1);
  const totalRemainingMinutes = stops.reduce(
    (sum, s) => sum + (s.estimatedMinutes || 45),
    0
  );
  const totalTripStops = stats.completedStopsCount + stops.length;
  const completedPercent =
    totalTripStops > 0
      ? Math.round((stats.completedStopsCount / totalTripStops) * 100)
      : 0;

  const returnReceiptToken = useMemo(() => {
    if (!stats.deliveredItems || stats.deliveredItems.length === 0) return "";
    return encodeReturnReceipt({
      tripNum: payload?.tripNum || 1,
      date: payload?.date || new Date().toISOString().split("T")[0],
      closedAtTime: new Date().toTimeString().slice(0, 5),
      deliveredItems: stats.deliveredItems,
      totalMinutesWorked: stats.completedMinutesCount,
      totalCashCollectedEur: stats.collectedCashEur,
    });
  }, [stats, payload]);

  const handleSendReturnReceiptWhatsApp = () => {
    if (!returnReceiptToken) return;
    const msg =
      `✅ *Cierre de Turno SATRuta #${payload?.tripNum || 1}*\n` +
      `🔧 Avisos cerrados: ${stats.completedStopsCount} (${formatHoursMinutes(
        stats.completedMinutesCount
      )} trabajadas)\n` +
      `💶 Importe total cobrado: ${stats.collectedCashEur.toFixed(2)} €\n\n` +
      `🔑 Código de Conciliación Admin:\n${returnReceiptToken}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  };

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
        <div className="flex items-center gap-3 text-slate-400 text-sm font-medium">
          <Wrench className="w-5 h-5 text-amber-500 animate-spin" />
          <span>Iniciando terminal de técnico...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between max-w-lg mx-auto font-sans select-none pb-8">
      {/* BARRA SUPERIOR FIJA */}
      <header className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md border-b border-white/[0.08] p-4 space-y-3">
        {!isOnline && (
          <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs font-semibold flex items-center gap-2.5">
            <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              Modo sin cobertura activo. Tus partes siguen guardados en memoria; no cierres esta pestaña.
            </span>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                isOnline
                  ? "bg-emerald-400 animate-pulse"
                  : "bg-amber-400 animate-ping"
              }`}
            />
            <h1 className="text-xs font-bold uppercase tracking-wider text-amber-400 truncate">
              SATRuta · Técnico
            </h1>
            {terminalMode === "local" && stops.length > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30 shrink-0">
                <Laptop className="w-3 h-3" />
                Cola local
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {terminalMode === "local" && (
              <button
                type="button"
                onClick={loadFromLocalStorage}
                title="Sincronizar con los últimos avisos guardados en /admin"
                className="p-1.5 rounded-lg bg-slate-900 border border-white/[0.08] text-slate-300 hover:text-amber-400 transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-900 border border-white/[0.08] text-slate-300 tabular-nums">
              {stops.length} pend.
            </span>
            {stats.completedStopsCount > 0 && (
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 tabular-nums">
                {stats.completedStopsCount} cerr.
              </span>
            )}
          </div>
        </div>

        {/* BARRA DE PROGRESO DE JORNADA */}
        {totalTripStops > 0 && (
          <div className="bg-slate-900/65 p-3 rounded-2xl border border-white/[0.08] space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-slate-200 tabular-nums">
                {stats.completedStopsCount} de {totalTripStops} avisos cerrados
              </span>
              <span className="font-mono font-bold text-amber-400 tabular-nums">
                {completedPercent}% completado
              </span>
            </div>
            <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-white/[0.06]">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-amber-400 transition-all duration-300"
                style={{ width: `${Math.min(100, completedPercent)}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-xs pt-0.5 text-slate-400">
              <span className="flex items-center gap-1.5 tabular-nums">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                Restante est.: {formatHoursMinutes(totalRemainingMinutes)}
              </span>
              {stats.collectedCashEur > 0 && (
                <span className="font-mono font-bold text-emerald-400 tabular-nums">
                  Cobrado: {stats.collectedCashEur.toFixed(2)} €
                </span>
              )}
            </div>
          </div>
        )}

        {/* BOTÓN RUTA COMPLETA GOOGLE MAPS */}
        {stops.length > 0 && (
          <button
            type="button"
            onClick={handleOpenMultiStopRoute}
            className="w-full min-h-[52px] flex items-center justify-center gap-2.5 py-3 px-4 rounded-2xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-sm shadow-lg shadow-sky-900/30 active:scale-[0.98] transition"
          >
            <Map className="w-5 h-5 shrink-0" />
            <span>Abrir Ruta Completa en Google Maps ({stops.length})</span>
          </button>
        )}
      </header>

      {/* CONTENIDO PRINCIPAL */}
      <main className="flex-1 p-4 space-y-4">
        {stops.length === 0 ? (
          /* PANTALLA INICIAL O FIN DE JORNADA */
          <div className="bg-slate-900/65 backdrop-blur-md border border-white/[0.08] rounded-3xl p-6 sm:p-7 text-center space-y-5 shadow-2xl my-auto">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                {stats.completedStopsCount > 0
                  ? "Jornada Finalizada"
                  : "Terminal de Técnico"}
              </span>
              <h2 className="text-2xl font-black text-white">
                {stats.completedStopsCount > 0
                  ? "Todos los Partes Cerrados"
                  : "Sin avisos activos en memoria"}
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                {stats.completedStopsCount > 0
                  ? terminalMode === "local"
                    ? "Los partes cerrados ya han quedado actualizados automáticamente en tu panel /admin."
                    : "Los datos personales de los clientes se han purgado de la memoria de este teléfono."
                  : "Abre el enlace o código QR enviado desde /admin, o carga directamente los avisos guardados en este dispositivo."}
              </p>
            </div>

            {stats.completedStopsCount === 0 && localPendingCount > 0 && (
              <button
                type="button"
                onClick={loadFromLocalStorage}
                className="w-full min-h-[54px] flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 active:scale-[0.98] transition"
              >
                <Wrench className="w-5 h-5" />
                <span>
                  Cargar {localPendingCount} avisos pendientes de este dispositivo
                </span>
              </button>
            )}

            {stats.completedStopsCount > 0 && (
              <div className="p-4 bg-slate-950/60 rounded-2xl border border-white/[0.06] text-xs sm:text-sm text-slate-300 space-y-2.5 text-left">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Avisos completados:</span>
                  <strong className="text-white font-mono tabular-nums">
                    {stats.completedStopsCount} partes
                  </strong>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Tiempo trabajado:</span>
                  <strong className="text-amber-400 font-mono tabular-nums">
                    {formatHoursMinutes(stats.completedMinutesCount)}
                  </strong>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-white/[0.06]">
                  <span className="text-slate-300 font-semibold">
                    Total cobrado en ruta:
                  </span>
                  <strong className="text-emerald-400 font-mono text-base font-bold tabular-nums">
                    {stats.collectedCashEur.toFixed(2)} €
                  </strong>
                </div>
              </div>
            )}

            {/* RESUMEN DE CIERRE ZERO-CLOUD (SOLO NECESARIO EN MODO EFÍMERO) */}
            {returnReceiptToken && terminalMode === "ephemeral" && (
              <div className="p-4 bg-slate-950/60 rounded-2xl border border-emerald-500/30 space-y-3 text-left">
                <div className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                  Liquidación Zero-Cloud (/tecnico ➔ /admin)
                </div>
                <p className="text-xs text-slate-400">
                  Envía este resumen al despacho por WhatsApp para cerrar los partes con tiempos reales y cobros.
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={handleSendReturnReceiptWhatsApp}
                    className="w-full min-h-[52px] flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-600/20 active:scale-[0.98] transition"
                  >
                    <MessageCircle className="w-5 h-5" />
                    <span>Enviar Resumen por WhatsApp</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(returnReceiptToken);
                      setCopiedReceiptToken(true);
                      setTimeout(() => setCopiedReceiptToken(false), 2500);
                    }}
                    className="w-full py-2.5 px-3 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 font-mono font-semibold text-xs border border-white/[0.08] flex items-center justify-center gap-1.5"
                  >
                    {copiedReceiptToken ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-400" />
                        <span>Código SAT1 copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 text-amber-400" />
                        <span>
                          Copiar código ({returnReceiptToken.slice(0, 14)}...)
                        </span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* PEGAR ENLACE MANUAL SI NO HAY TURNO CARGADO */}
            {stats.completedStopsCount === 0 && (
              <div className="p-4 bg-slate-950/55 rounded-2xl border border-white/[0.06] space-y-2.5 text-left">
                <label className="text-xs font-semibold text-slate-300 block">
                  ¿Recibiste un enlace de turno por WhatsApp? Pégalo aquí:
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="https://.../tecnico?r=..."
                    value={manualLinkInput}
                    onChange={(e) => setManualLinkInput(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs bg-slate-900 border border-white/[0.08] rounded-xl text-white outline-none focus:border-amber-500"
                  />
                  <button
                    type="button"
                    onClick={handleLoadManualLink}
                    className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-xs border border-white/[0.08] shrink-0"
                  >
                    Cargar
                  </button>
                </div>
                {manualLoadError && (
                  <p className="text-xs text-rose-400">{manualLoadError}</p>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2.5 pt-1">
              {payload?.warehouse && (
                <button
                  type="button"
                  onClick={handleReturnToWarehouse}
                  className="w-full min-h-[52px] flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm active:scale-[0.98] transition"
                >
                  <Home className="w-5 h-5" />
                  <span>Volver a Base ({payload.warehouse.name})</span>
                </button>
              )}

              <Link
                href="/admin"
                className="w-full py-3 px-4 rounded-2xl bg-slate-800/70 hover:bg-slate-800 text-slate-300 hover:text-white font-semibold text-xs border border-white/[0.08] flex items-center justify-center gap-2 transition"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Ir al Despacho / Coordinación (/admin)</span>
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* TARJETA ACTIVA (#1) */}
            {(() => {
              const meta = getServiceTypeBadgeMeta(
                currentStop.serviceType,
                currentStop.priority
              );
              const isUrgent = currentStop.priority === "Urgente";
              return (
                <div
                  className={`bg-slate-900/75 backdrop-blur-md rounded-3xl p-5 sm:p-6 shadow-2xl space-y-5 relative overflow-hidden border ${
                    isUrgent
                      ? "border-rose-500/60 shadow-rose-950/30"
                      : "border-amber-500/45 shadow-amber-950/20"
                  }`}
                >
                  {/* Franja superior de acento */}
                  <div
                    className={`absolute top-0 left-0 right-0 h-1 ${
                      isUrgent ? "bg-rose-500" : "bg-amber-500"
                    }`}
                  />

                  {/* Encabezado */}
                  <div className="flex items-start justify-between gap-3 pt-1">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-12 h-12 rounded-2xl font-black text-xl flex items-center justify-center shadow-lg shrink-0 ${
                          isUrgent
                            ? "bg-rose-600 text-white"
                            : "bg-amber-500 text-slate-950"
                        }`}
                      >
                        #{currentStop.seq}
                      </div>
                      <div>
                        <span className="text-xs font-semibold text-amber-400 block">
                          Intervención actual
                        </span>
                        <h2 className="text-xl sm:text-2xl font-black text-white leading-tight">
                          {currentStop.name}
                        </h2>
                      </div>
                    </div>

                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full shrink-0 ${meta.badgeClass}`}
                    >
                      <ServiceTypeIcon
                        serviceType={currentStop.serviceType}
                        priority={currentStop.priority}
                      />
                      <span>{meta.label}</span>
                    </span>
                  </div>

                  {/* BLOQUE CENTRAL: EQUIPO Y DURACIÓN */}
                  <div className="bg-slate-950/60 p-4 rounded-2xl border border-white/[0.06] space-y-3">
                    <div>
                      <span className="text-xs font-medium text-slate-400 block">
                        Equipo / Instalación
                      </span>
                      <div className="text-lg font-bold text-white mt-0.5 flex items-center gap-2">
                        <Wrench className="w-4 h-4 text-amber-400 shrink-0" />
                        <span>
                          {currentStop.equipmentInfo ||
                            "Asistencia técnica general"}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2.5 border-t border-white/[0.06]">
                      <span className="text-xs font-medium text-slate-400">
                        Duración estimada
                      </span>
                      <span className="text-lg font-mono font-bold text-amber-400 tabular-nums flex items-center gap-1.5">
                        <Clock className="w-4 h-4" />
                        {currentStop.estimatedMinutes} min
                      </span>
                    </div>
                  </div>

                  {/* NOTAS TÉCNICAS Y PRESUPUESTO */}
                  {(currentStop.tags ||
                    (currentStop.cashToCollectEur &&
                      currentStop.cashToCollectEur > 0)) && (
                    <div className="space-y-2.5">
                      {currentStop.cashToCollectEur &&
                      currentStop.cashToCollectEur > 0 ? (
                        <div className="p-3.5 rounded-2xl bg-emerald-500/12 border border-emerald-500/35 text-emerald-300 font-bold text-sm flex items-center justify-between">
                          <span className="flex items-center gap-2">
                            <Banknote className="w-5 h-5 text-emerald-400 shrink-0" />
                            <span>Presupuesto / Cobrar</span>
                          </span>
                          <span className="text-lg font-mono text-white tabular-nums">
                            {currentStop.cashToCollectEur.toFixed(2)} €
                          </span>
                        </div>
                      ) : null}

                      {currentStop.tags && (
                        <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-200 text-xs sm:text-sm font-medium leading-relaxed">
                          {currentStop.tags}
                        </div>
                      )}
                    </div>
                  )}

                  {/* DIRECCIÓN Y GPS */}
                  <div className="space-y-1 bg-slate-950/45 p-3.5 rounded-2xl border border-white/[0.06]">
                    <span className="text-xs font-medium text-slate-400 block">
                      Ubicación
                    </span>
                    <p className="font-bold text-slate-100 text-base leading-snug flex items-start gap-2">
                      <MapPin className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                      <span>{currentStop.village}</span>
                    </p>
                    <div className="text-xs text-slate-400 pl-7 font-mono tabular-nums">
                      {currentStop.lat.toFixed(5)}, {currentStop.lng.toFixed(5)}
                    </div>
                  </div>

                  {/* LLAMADA DIRECTA */}
                  {currentStop.phone && (
                    <a
                      href={`tel:${currentStop.phone}`}
                      className="w-full min-h-[54px] flex items-center justify-center gap-2.5 py-3 px-4 rounded-2xl bg-slate-800/80 hover:bg-slate-700 border border-sky-500/40 text-sky-300 font-bold text-sm sm:text-base active:scale-[0.98] transition"
                    >
                      <Phone className="w-5 h-5 text-sky-400 shrink-0" />
                      <span>Llamar al Cliente ({currentStop.phone})</span>
                    </a>
                  )}

                  {/* NAVEGACIÓN Y COPIAR GPS */}
                  <div className="flex items-stretch gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        handleNavigateToCustomer({
                          lat: currentStop.lat,
                          lng: currentStop.lng,
                        })
                      }
                      className="flex-1 min-h-[54px] flex items-center justify-center gap-2.5 py-3.5 px-4 rounded-2xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-sm sm:text-base shadow-lg shadow-sky-600/25 active:scale-[0.98] transition"
                    >
                      <Navigation className="w-5 h-5 shrink-0" />
                      <span>Ir en Google Maps</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleCopyGps(currentStop)}
                      className={`min-h-[54px] px-4 py-3.5 rounded-2xl font-bold text-xs border transition flex flex-col items-center justify-center gap-1 shrink-0 ${
                        copiedStopId === currentStop.id
                          ? "bg-emerald-600 border-emerald-400 text-white"
                          : "bg-slate-800/80 hover:bg-slate-700 border-white/[0.08] text-amber-300"
                      }`}
                    >
                      {copiedStopId === currentStop.id ? (
                        <>
                          <Check className="w-4 h-4" />
                          <span>Copiado</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          <span>Copiar GPS</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* BOTÓN PRINCIPAL: PARTE FINALIZADO */}
                  <button
                    type="button"
                    onClick={() => openCloseModal(currentStop)}
                    className="w-full min-h-[56px] flex items-center justify-center gap-2.5 py-4 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-base shadow-xl shadow-emerald-600/25 active:scale-[0.98] transition"
                  >
                    <CheckCircle2 className="w-6 h-6 shrink-0" />
                    <span>Parte Finalizado</span>
                  </button>
                </div>
              );
            })()}

            {/* SIGUIENTES AVISOS EN COLA */}
            {upcomingStops.length > 0 && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between text-xs px-1">
                  <span className="font-bold uppercase tracking-wider text-slate-400">
                    Siguientes avisos ({upcomingStops.length})
                  </span>
                </div>

                <div className="space-y-2.5">
                  {upcomingStops.map((stop) => {
                    const meta = getServiceTypeBadgeMeta(
                      stop.serviceType,
                      stop.priority
                    );
                    return (
                      <div
                        key={stop.id}
                        className="bg-slate-900/65 border border-white/[0.07] rounded-2xl p-4 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs flex items-center justify-center shrink-0">
                            #{stop.seq}
                          </div>
                          <div className="min-w-0 space-y-0.5">
                            <div className="font-bold text-white text-sm truncate flex items-center gap-2">
                              <span className="truncate">{stop.name}</span>
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 ${meta.badgeClass}`}
                              >
                                <ServiceTypeIcon
                                  serviceType={stop.serviceType}
                                  priority={stop.priority}
                                  className="w-3 h-3"
                                />
                              </span>
                            </div>
                            <p className="text-xs text-slate-400 line-clamp-1">
                              {stop.village}
                            </p>
                            {stop.equipmentInfo && (
                              <span className="text-xs text-amber-300/90 block truncate">
                                {stop.equipmentInfo}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleCopyGps(stop)}
                            className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-white/[0.08] text-xs font-semibold text-slate-300 flex items-center gap-1"
                          >
                            <Copy className="w-3 h-3" />
                            <span>
                              {copiedStopId === stop.id ? "OK" : "GPS"}
                            </span>
                          </button>

                          <div className="text-right tabular-nums">
                            <span className="font-mono font-bold text-amber-400 text-xs block">
                              {stop.estimatedMinutes}m
                            </span>
                            {stop.cashToCollectEur && stop.cashToCollectEur > 0 ? (
                              <span className="text-xs text-emerald-400 font-mono font-semibold">
                                {stop.cashToCollectEur} €
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* MODAL DE CIERRE DE INTERVENCIÓN */}
      {confirmingStop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/[0.1] rounded-3xl max-w-sm w-full p-6 space-y-4 text-white shadow-2xl">
            <div className="text-center space-y-1">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 flex items-center justify-center mx-auto mb-2">
                <Wrench className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">
                Cerrar Parte #{confirmingStop.seq}
              </h3>
              <p className="text-xs text-slate-300">
                <strong className="text-white">{confirmingStop.name}</strong> ·{" "}
                {confirmingStop.serviceType}
              </p>
            </div>

            <div className="p-3 bg-slate-950/60 rounded-2xl border border-white/[0.06] space-y-2">
              <label className="text-xs font-semibold text-slate-400 block text-center">
                Tiempo real empleado (min)
              </label>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setActualMinutesInput((m) => Math.max(15, m - 15))
                  }
                  className="min-h-[46px] px-4 rounded-xl bg-slate-800 hover:bg-slate-700 font-bold text-sm text-slate-200"
                >
                  -15m
                </button>
                <span className="font-mono text-2xl font-black text-amber-400 tabular-nums">
                  {actualMinutesInput} min
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setActualMinutesInput((m) => Math.min(480, m + 15))
                  }
                  className="min-h-[46px] px-4 rounded-xl bg-slate-800 hover:bg-slate-700 font-bold text-sm text-amber-300"
                >
                  +15m
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300 block">
                Importe cobrado (€)
              </label>
              <input
                type="number"
                step="0.5"
                min={0}
                value={collectedCashInput}
                onChange={(e) => setCollectedCashInput(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-slate-950/70 border border-white/[0.08] text-emerald-400 font-mono text-xl font-black outline-none focus:border-emerald-500 text-center tabular-nums"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300 block">
                Nota breve de resolución (opcional)
              </label>
              <input
                type="text"
                maxLength={60}
                placeholder="Ej. Cambiado sensor NTC, equipo probado OK..."
                value={resolutionNoteInput}
                onChange={(e) => setResolutionNoteInput(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-slate-950/70 border border-white/[0.08] text-white text-sm outline-none focus:border-amber-500"
              />
            </div>

            {terminalMode === "ephemeral" && (
              <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                <span>
                  Los datos personales del cliente se borrarán del teléfono al confirmar.
                </span>
              </div>
            )}

            <div className="flex gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setConfirmingStop(null)}
                className="w-1/3 min-h-[50px] rounded-2xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExecuteCompletion}
                className="w-2/3 min-h-[50px] rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-600/25 transition active:scale-[0.98]"
              >
                Confirmar Cierre
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PIE DE PÁGINA */}
      <footer className="text-center text-xs text-slate-500 px-4 pt-3 border-t border-white/[0.06]">
        <span className="flex items-center justify-center gap-1.5 font-medium">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          SATRuta Técnico · Privacidad Local-First & Zero-Cloud
        </span>
      </footer>
    </div>
  );
}

export default function FieldTechTerminal() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
          <span className="text-sm text-slate-400">
            Cargando terminal técnica...
          </span>
        </div>
      }
    >
      <TechTerminalContent />
    </Suspense>
  );
}
