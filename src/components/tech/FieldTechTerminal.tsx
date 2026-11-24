"use client";

import React, { useState, useEffect, Suspense, useMemo } from "react";
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
  encodeReturnReceipt,
} from "@/utils/galiciaUrlCodec";
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

function TechTerminalContent() {
  const searchParams = useSearchParams();

  const [payload, setPayload] = useState<EphemeralTripPayload | null>(null);
  const [stops, setStops] = useState<EphemeralStop[]>([]);
  const [stats, setStats] = useState<CompletedStats>({
    completedStopsCount: 0,
    completedMinutesCount: 0,
    collectedCashEur: 0,
    deliveredItems: [],
  });
  const [isLoaded, setIsLoaded] = useState(false);

  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [copiedStopId, setCopiedStopId] = useState<string | null>(null);
  const [copiedReceiptToken, setCopiedReceiptToken] = useState(false);

  // Modal de Cierre de Parte con ajuste de minutos reales, cobro y nota breve
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

  // Carga segura + limpieza inmediata del parámetro ?r= del historial
  useEffect(() => {
    const rawR = searchParams.get("r") || searchParams.get("data");

    if (rawR) {
      const decoded = decodeTripPayload(rawR);
      if (decoded && decoded.stops && decoded.stops.length > 0) {
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

    try {
      const rawStored = sessionStorage.getItem(EPHEMERAL_STORAGE_KEY);
      const rawStats = sessionStorage.getItem(COMPLETED_STATS_KEY);
      if (rawStored) {
        const storedPayload = JSON.parse(rawStored) as EphemeralTripPayload;
        setPayload(storedPayload);
        setStops(storedPayload.stops || []);
      }
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
    } catch (e) {
      console.warn("Error leyendo sesión previa:", e);
    }

    setIsLoaded(true);
  }, [searchParams]);

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

  // Borrado definitivo del cliente de la memoria al cerrar el parte
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

  // Token de Recibo de Cierre Zero-Cloud (SAT1-)
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
        <div className="flex items-center gap-3 text-slate-400 text-sm font-bold">
          <Wrench className="w-6 h-6 text-amber-500 animate-spin" />
          <span>Iniciando terminal móvil de técnico...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-between max-w-lg mx-auto font-sans select-none pb-6">
      {/* BARRA SUPERIOR FIJA */}
      <header className="sticky top-0 z-40 bg-slate-950/95 backdrop-blur-md border-b border-slate-800/90 p-4 space-y-3">
        {!isOnline && (
          <div className="p-3 rounded-2xl bg-amber-500/20 border-2 border-amber-500/70 text-amber-200 text-xs font-bold flex items-center gap-2.5 shadow-lg animate-pulse">
            <WifiOff className="w-5 h-5 text-amber-400 shrink-0" />
            <span>
              📡 Modo Sin Cobertura Activo — Tus partes están seguros en memoria. No cierres esta pestaña.
            </span>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                isOnline
                  ? "bg-emerald-400 animate-pulse"
                  : "bg-amber-400 animate-ping"
              }`}
            ></div>
            <h1 className="text-xs font-black uppercase tracking-widest text-amber-400">
              SATRuta • Técnico en Campo
            </h1>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-slate-300">
              {stops.length} pendientes
            </span>
            {stats.completedStopsCount > 0 && (
              <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                {stats.completedStopsCount} cerrados
              </span>
            )}
          </div>
        </div>

        {/* BARRA DE PROGRESO DE JORNADA + COBRO ACUMULADO */}
        {totalTripStops > 0 && (
          <div className="bg-slate-900/90 p-3 rounded-2xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-xs font-bold">
              <span className="text-slate-200">
                {stats.completedStopsCount} de {totalTripStops} avisos cerrados
              </span>
              <span className="font-mono font-black text-amber-400">
                {completedPercent}% completado
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-amber-400 transition-all duration-300"
                style={{ width: `${Math.min(100, completedPercent)}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[11px] pt-0.5">
              <span className="text-slate-400 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>
                  Restante est.: {formatHoursMinutes(totalRemainingMinutes)}
                </span>
              </span>
              {stats.collectedCashEur > 0 && (
                <span className="font-mono font-black text-emerald-400">
                  💶 Cobrado: {stats.collectedCashEur.toFixed(2)} €
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
            className="w-full min-h-[54px] flex items-center justify-center gap-2.5 py-3.5 px-4 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black text-sm shadow-xl shadow-blue-900/30 active:scale-[0.98] transition"
          >
            <Map className="w-5 h-5 shrink-0 text-amber-300" />
            <span>
              🗺️ Abrir Ruta Completa en Google Maps ({stops.length} avisos)
            </span>
          </button>
        )}
      </header>

      {/* CONTENIDO PRINCIPAL */}
      <main className="flex-1 p-4 space-y-4">
        {stops.length === 0 ? (
          /* PANTALLA FIN DE JORNADA */
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 text-center space-y-5 shadow-2xl my-auto animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto shadow-inner">
              <CheckCircle2 className="w-9 h-9" />
            </div>

            <div className="space-y-2">
              <span className="text-xs font-black uppercase tracking-wider text-emerald-400">
                Jornada Finalizada con Éxito
              </span>
              <h2 className="text-2xl font-black text-white">
                {stats.completedStopsCount > 0
                  ? "Todos los Partes Cerrados"
                  : "Terminal Lista"}
              </h2>
              <div className="inline-block px-3 py-1 rounded-full bg-slate-800 text-slate-300 text-xs font-bold border border-slate-700">
                0 datos personales almacenados en este dispositivo
              </div>
              <p className="text-xs text-slate-400 pt-2 leading-relaxed">
                {stats.completedStopsCount > 0
                  ? "Los nombres, direcciones y datos de clientes han sido eliminados de la memoria del teléfono."
                  : "Escanea el código QR o abre el enlace enviado desde /admin para cargar tu hoja de avisos."}
              </p>
            </div>

            {stats.completedStopsCount > 0 && (
              <div className="p-4 bg-slate-950/80 rounded-2xl border border-slate-800 text-xs text-slate-300 space-y-2.5 text-left">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Avisos completados:</span>
                  <strong className="text-white font-mono text-sm">
                    {stats.completedStopsCount} partes
                  </strong>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Tiempo trabajado:</span>
                  <strong className="text-amber-400 font-mono text-sm">
                    {formatHoursMinutes(stats.completedMinutesCount)} (
                    {stats.completedMinutesCount} min)
                  </strong>
                </div>
                <div className="flex justify-between items-center pt-1 border-t border-slate-800">
                  <span className="text-slate-300 font-bold">
                    💶 Total cobrado en ruta:
                  </span>
                  <strong className="text-emerald-400 font-mono text-base font-black">
                    {stats.collectedCashEur.toFixed(2)} €
                  </strong>
                </div>
              </div>
            )}

            {/* RESUMEN DE CIERRE ZERO-CLOUD SAT1- */}
            {returnReceiptToken && (
              <div className="p-4 bg-slate-950 rounded-2xl border-2 border-emerald-500/40 space-y-3 text-left">
                <div className="text-xs font-black text-emerald-400 uppercase">
                  📲 Liquidación Zero-Cloud (/tecnico ➔ /admin)
                </div>
                <p className="text-[11px] text-slate-400">
                  Envía este resumen al despacho por WhatsApp para cerrar automáticamente los partes con tiempos reales e importes cobrados.
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={handleSendReturnReceiptWhatsApp}
                    className="w-full min-h-[54px] flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs sm:text-sm shadow-lg shadow-emerald-600/25 active:scale-[0.98] transition"
                  >
                    <MessageCircle className="w-5 h-5" />
                    <span>Enviar Resumen de Cierre por WhatsApp</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(returnReceiptToken);
                      setCopiedReceiptToken(true);
                      setTimeout(() => setCopiedReceiptToken(false), 2500);
                    }}
                    className="w-full py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono font-bold text-xs border border-slate-700 flex items-center justify-center gap-1.5"
                  >
                    {copiedReceiptToken ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-400" />
                        <span>¡Código SAT1 copiado!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 text-amber-400" />
                        <span>
                          Copiar Código ({returnReceiptToken.slice(0, 14)}...)
                        </span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {payload?.warehouse && (
              <button
                type="button"
                onClick={handleReturnToWarehouse}
                className="w-full min-h-[54px] flex items-center justify-center gap-2 py-4 px-4 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm shadow-xl shadow-amber-500/20 active:scale-[0.98] transition"
              >
                <Home className="w-5 h-5" />
                <span>
                  Volver a Base en Google Maps ({payload.warehouse.name})
                </span>
              </button>
            )}
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
                  className={`bg-slate-900 border-2 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-5 relative overflow-hidden animate-in fade-in duration-200 ${
                    isUrgent
                      ? "border-rose-500 ring-4 ring-rose-500/20"
                      : "border-amber-500 ring-4 ring-amber-500/10"
                  }`}
                >
                  {/* Encabezado */}
                  <div className="flex items-start justify-between gap-3">
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
                        <span className="text-[10px] font-black uppercase tracking-wider text-amber-400 block">
                          Intervención en Curso
                        </span>
                        <h2 className="text-xl sm:text-2xl font-black text-white leading-tight">
                          {currentStop.name}
                        </h2>
                      </div>
                    </div>

                    <span
                      className={`text-[10px] font-black px-2.5 py-1 rounded-full uppercase shrink-0 ${meta.badgeClass}`}
                    >
                      {meta.emoji} {meta.label}
                    </span>
                  </div>

                  {/* BLOQUE CENTRAL: EQUIPO, DURACIÓN Y NOTAS TÉCNICAS */}
                  <div className="bg-slate-950 p-4 sm:p-5 rounded-2xl border border-slate-800 space-y-3 shadow-inner">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                        Equipo / Instalación
                      </span>
                      <div className="text-lg sm:text-xl font-black text-white mt-0.5">
                        ⚙️ {currentStop.equipmentInfo || "Asistencia técnica general"}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                      <span className="text-xs font-bold text-slate-400">
                        Duración estimada:
                      </span>
                      <span className="text-xl font-mono font-black text-amber-400">
                        ⏱️ {currentStop.estimatedMinutes} MIN
                      </span>
                    </div>
                  </div>

                  {/* MATERIAL / NOTAS TÉCNICAS Y PRESUPUESTO */}
                  {(currentStop.tags ||
                    (currentStop.cashToCollectEur &&
                      currentStop.cashToCollectEur > 0)) && (
                    <div className="space-y-2">
                      {currentStop.cashToCollectEur &&
                      currentStop.cashToCollectEur > 0 ? (
                        <div className="p-3.5 rounded-2xl bg-emerald-500/15 border-2 border-emerald-500/50 text-emerald-300 font-black text-sm flex items-center justify-between">
                          <span className="flex items-center gap-2">
                            <Banknote className="w-5 h-5 text-emerald-400 shrink-0" />
                            <span>Presupuesto / Cobrar:</span>
                          </span>
                          <span className="text-xl font-mono text-white">
                            {currentStop.cashToCollectEur.toFixed(2)} €
                          </span>
                        </div>
                      ) : null}

                      {currentStop.tags && (
                        <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs sm:text-sm font-bold">
                          🧰 {currentStop.tags}
                        </div>
                      )}
                    </div>
                  )}

                  {/* DIRECCIÓN Y GPS */}
                  <div className="space-y-1 bg-slate-800/40 p-3.5 rounded-2xl border border-slate-800">
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">
                      Ubicación / Aldea / Dirección
                    </span>
                    <p className="font-black text-slate-100 text-base leading-snug flex items-start gap-2">
                      <MapPin className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                      <span>{currentStop.village}</span>
                    </p>
                    <div className="text-[11px] text-slate-400 pl-7 font-mono">
                      {currentStop.lat.toFixed(5)}, {currentStop.lng.toFixed(5)}
                    </div>
                  </div>

                  {/* BOTÓN LLAMADA DIRECTA */}
                  {currentStop.phone && (
                    <a
                      href={`tel:${currentStop.phone}`}
                      className="w-full min-h-[56px] flex items-center justify-center gap-2.5 py-3.5 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 border-2 border-sky-500/50 text-sky-300 font-black text-sm sm:text-base shadow-lg active:scale-[0.98] transition"
                    >
                      <Phone className="w-5 h-5 text-sky-400 shrink-0" />
                      <span>📞 Llamar al Cliente ({currentStop.phone})</span>
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
                      className="flex-1 min-h-[56px] flex items-center justify-center gap-2.5 py-4 px-4 rounded-2xl bg-sky-600 hover:bg-sky-500 text-white font-black text-sm sm:text-base shadow-xl shadow-sky-600/30 active:scale-[0.98] transition"
                    >
                      <Navigation className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" />
                      <span>📍 Ir en Google Maps</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleCopyGps(currentStop)}
                      className={`min-h-[56px] px-4 py-4 rounded-2xl font-black text-xs border transition flex flex-col items-center justify-center gap-1 shrink-0 ${
                        copiedStopId === currentStop.id
                          ? "bg-emerald-600 border-emerald-400 text-white"
                          : "bg-slate-800 hover:bg-slate-700 border-slate-700 text-amber-300"
                      }`}
                    >
                      {copiedStopId === currentStop.id ? (
                        <>
                          <Check className="w-4 h-4" />
                          <span>¡Copiado!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          <span>📋 Copiar GPS</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* BOTÓN PRINCIPAL: PARTE FINALIZADO */}
                  <button
                    type="button"
                    onClick={() => openCloseModal(currentStop)}
                    className="w-full min-h-[56px] flex items-center justify-center gap-2.5 py-4 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-base shadow-xl shadow-emerald-600/25 active:scale-[0.98] transition"
                  >
                    <CheckCircle2 className="w-6 h-6 shrink-0" />
                    <span>✅ Parte Finalizado (Cerrar y Borrar)</span>
                  </button>
                </div>
              );
            })()}

            {/* SIGUIENTES AVISOS EN COLA */}
            {upcomingStops.length > 0 && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between text-xs px-1">
                  <span className="font-black uppercase tracking-wider text-slate-400">
                    Siguientes Avisos del Turno ({upcomingStops.length})
                  </span>
                  <span className="text-slate-500 text-[11px]">En cola</span>
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
                        className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between gap-3 text-xs opacity-90 hover:opacity-100 transition"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-xl bg-slate-800 text-slate-300 font-black text-xs flex items-center justify-center shrink-0">
                            #{stop.seq}
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-white text-sm truncate flex items-center gap-1.5">
                              <span>{stop.name}</span>
                              <span>{meta.emoji}</span>
                            </div>
                            <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">
                              {stop.village}
                            </p>
                            {stop.equipmentInfo && (
                              <span className="text-[10px] text-amber-300/90 block truncate">
                                ⚙️ {stop.equipmentInfo}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleCopyGps(stop)}
                            className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-bold text-slate-300 flex items-center gap-1"
                          >
                            {copiedStopId === stop.id ? (
                              <span className="text-emerald-400">✓ GPS</span>
                            ) : (
                              <span>📋 GPS</span>
                            )}
                          </button>

                          <div className="text-right">
                            <span className="font-mono font-black text-amber-400 text-xs block">
                              {stop.estimatedMinutes} min
                            </span>
                            {stop.cashToCollectEur && stop.cashToCollectEur > 0 ? (
                              <span className="text-[10px] text-emerald-400 font-mono font-bold">
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

      {/* MODAL DE CIERRE DE INTERVENCIÓN (MINUTOS REALES + COBRO + NOTA + BORRADO) */}
      {confirmingStop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-sm w-full p-6 space-y-4 text-white shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="text-center space-y-1">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto mb-2">
                <Wrench className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-black text-white">
                Cerrar Parte #{confirmingStop.seq}
              </h3>
              <p className="text-xs text-slate-300">
                <strong className="text-white">{confirmingStop.name}</strong> •{" "}
                {confirmingStop.serviceType}
              </p>
            </div>

            {/* Ajuste de Tiempo Real Empleado */}
            <div className="p-3 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
              <label className="text-[11px] font-bold uppercase text-slate-400 block text-center">
                Tiempo real empleado (min)
              </label>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setActualMinutesInput((m) => Math.max(15, m - 15))
                  }
                  className="min-h-[46px] px-4 rounded-xl bg-slate-800 hover:bg-slate-700 font-black text-sm text-slate-200"
                >
                  -15m
                </button>
                <span className="font-mono text-2xl font-black text-amber-400">
                  {actualMinutesInput} min
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setActualMinutesInput((m) => Math.min(480, m + 15))
                  }
                  className="min-h-[46px] px-4 rounded-xl bg-slate-800 hover:bg-slate-700 font-black text-sm text-amber-300"
                >
                  +15m
                </button>
              </div>
            </div>

            {/* Importe Cobrado */}
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-300 block">
                Importe cobrado (€)
              </label>
              <input
                type="number"
                step="0.5"
                min={0}
                value={collectedCashInput}
                onChange={(e) => setCollectedCashInput(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-emerald-400 font-mono text-xl font-black outline-none focus:border-emerald-500 text-center"
              />
            </div>

            {/* Nota breve de resolución */}
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-300 block">
                Nota breve de resolución (opcional)
              </label>
              <input
                type="text"
                maxLength={60}
                placeholder="Ej. Cambiado sensor NTC, equipo probado OK..."
                value={resolutionNoteInput}
                onChange={(e) => setResolutionNoteInput(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs outline-none focus:border-amber-500"
              />
            </div>

            <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-[11px] text-red-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
              <span>
                Los datos personales del cliente se borrarán del teléfono al confirmar.
              </span>
            </div>

            <div className="flex gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setConfirmingStop(null)}
                className="w-1/3 min-h-[52px] rounded-2xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExecuteCompletion}
                className="w-2/3 min-h-[52px] rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs sm:text-sm shadow-lg shadow-emerald-600/25 transition active:scale-[0.98]"
              >
                Confirmar y Borrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PIE DE PÁGINA */}
      <footer className="text-center text-[10px] text-slate-600 px-4 pt-3 border-t border-slate-900">
        <span className="flex items-center justify-center gap-1.5 text-slate-500 font-bold">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          SATRuta Técnico • Terminal Efímera Sin Rastro
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
