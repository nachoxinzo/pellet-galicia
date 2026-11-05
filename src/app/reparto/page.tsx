"use client";

import React, { useState, useEffect, Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  EphemeralStop,
  EphemeralTripPayload,
  Coordinates,
} from "@/types/pelletGalicia";
import {
  decodeTripPayload,
  buildGoogleMapsSingleClientUrl,
} from "@/utils/galiciaUrlCodec";
import {
  Navigation,
  CheckCircle2,
  Package,
  MapPin,
  ShieldCheck,
  Truck,
  AlertCircle,
  Map,
  Home,
  Check,
  Copy,
  WifiOff,
  Banknote,
} from "lucide-react";

const EPHEMERAL_STORAGE_KEY = "pelletgalicia_ephemeral_payload_session";
const COMPLETED_STATS_KEY = "pelletgalicia_completed_stats_session";

interface CompletedStats {
  completedStopsCount: number;
  completedSacksCount: number;
}

function RepartoContent() {
  const searchParams = useSearchParams();

  const [payload, setPayload] = useState<EphemeralTripPayload | null>(null);
  const [stops, setStops] = useState<EphemeralStop[]>([]);
  const [stats, setStats] = useState<CompletedStats>({
    completedStopsCount: 0,
    completedSacksCount: 0,
  });
  const [isLoaded, setIsLoaded] = useState(false);

  // 2. DETECTOR DE ESTADO DE RED PARA EL RURAL SIN COBERTURA
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [copiedStopId, setCopiedStopId] = useState<string | null>(null);

  // Modal de confirmación para evitar toques accidentales con guantes de trabajo
  const [confirmingStop, setConfirmingStop] = useState<EphemeralStop | null>(
    null
  );

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

  // 1. CARGA SEGURA Y LIMPIEZA DE RASTRO (Zero-Trace URL Cleanup)
  useEffect(() => {
    const rawR = searchParams.get("r") || searchParams.get("data");

    if (rawR) {
      const decoded = decodeTripPayload(rawR);
      if (decoded && decoded.stops && decoded.stops.length > 0) {
        setPayload(decoded);
        setStops(decoded.stops);
        const initialStats: CompletedStats = {
          completedStopsCount: 0,
          completedSacksCount: 0,
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

        // LIMPIEZA INMEDIATA DEL HISTORIAL: Eliminar parámetro ?r= de la URL
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

    // Si no viene en la URL, leer de la memoria de sesión activa
    try {
      const rawStored = sessionStorage.getItem(EPHEMERAL_STORAGE_KEY);
      const rawStats = sessionStorage.getItem(COMPLETED_STATS_KEY);
      if (rawStored) {
        const storedPayload = JSON.parse(rawStored) as EphemeralTripPayload;
        setPayload(storedPayload);
        setStops(storedPayload.stops || []);
      }
      if (rawStats) {
        setStats(JSON.parse(rawStats));
      }
    } catch (e) {
      console.warn("Error leyendo sesión previa:", e);
    }

    setIsLoaded(true);
  }, [searchParams]);

  // BORRADO DEFINITIVO AL ENTREGAR: El cliente desaparece permanentemente del móvil
  const handleExecuteDelivery = () => {
    if (!confirmingStop) return;

    const remaining = stops.filter((s) => s.id !== confirmingStop.id);
    const newStats: CompletedStats = {
      completedStopsCount: stats.completedStopsCount + 1,
      completedSacksCount: stats.completedSacksCount + confirmingStop.sacks,
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
          // Si finalizó el reparto, purgar la carga de clientes de sessionStorage
          sessionStorage.removeItem(EPHEMERAL_STORAGE_KEY);
        }
      }
      sessionStorage.setItem(COMPLETED_STATS_KEY, JSON.stringify(newStats));
    } catch (e) {
      console.warn("Error actualizando sessionStorage:", e);
    }
  };

  // NAVEGACIÓN INDIVIDUAL AL CLIENTE ACTUAL
  const handleNavigateToCustomer = (coords: Coordinates) => {
    const url = buildGoogleMapsSingleClientUrl(coords);
    window.open(url, "_blank");
  };

  // COPIAR GPS AL PORTAPAPELES (Útil para mapas offline en zonas sin cobertura)
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

  // NAVEGACIÓN MULTI-PARADA DINÁMICO:
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

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
        <div className="flex items-center gap-3 text-slate-400 text-sm font-bold">
          <Truck className="w-6 h-6 text-amber-500 animate-bounce" />
          <span>Iniciando terminal móvil de reparto...</span>
        </div>
      </div>
    );
  }

  const currentStop = stops[0] || null;
  const upcomingStops = stops.slice(1);
  const totalRemainingSacks = stops.reduce((sum, s) => sum + s.sacks, 0);

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-between max-w-lg mx-auto font-sans select-none pb-6">
      {/* 1. BARRA SUPERIOR FIJA: DETECTOR OFFLINE + PRIVACIDAD + RUTA COMPLETA */}
      <header className="sticky top-0 z-40 bg-slate-950/95 backdrop-blur-md border-b border-slate-800/90 p-4 space-y-3">
        {/* AVISO DE PROTECCIÓN CONTRA PÉRDIDA DE COBERTURA EN EL RURAL */}
        {!isOnline && (
          <div className="p-3 rounded-2xl bg-amber-500/20 border-2 border-amber-500/70 text-amber-200 text-xs font-bold flex items-center gap-2.5 shadow-lg animate-pulse">
            <WifiOff className="w-5 h-5 text-amber-400 shrink-0" />
            <span>
              📡 Modo Sin Cobertura Activo — Tus paradas están seguras en memoria. No cierres esta pestaña.
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
              PelletGalicia • Reparto en Ruta
            </h1>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-slate-300">
              {stops.length} restantes
            </span>
            {stats.completedStopsCount > 0 && (
              <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                {stats.completedStopsCount} entregadas
              </span>
            )}
          </div>
        </div>

        {/* CONTADOR DE SACOS PENDIENTES */}
        {stops.length > 0 && (
          <div className="flex items-center justify-between text-xs bg-slate-900/90 px-3.5 py-2 rounded-2xl border border-slate-800">
            <span className="text-slate-400 font-bold flex items-center gap-1.5">
              <Package className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Carga pendiente en furgón:</span>
            </span>
            <span className="font-mono font-black text-amber-400 text-sm">
              {totalRemainingSacks} sacos ({totalRemainingSacks * 15} kg)
            </span>
          </div>
        )}

        {/* BOTÓN MULTI-PARADA DINÁMICO SUPERIOR */}
        {stops.length > 0 && (
          <button
            type="button"
            onClick={handleOpenMultiStopRoute}
            className="w-full flex items-center justify-center gap-2.5 py-3.5 px-4 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black text-sm shadow-xl shadow-blue-900/30 active:scale-[0.98] transition"
          >
            <Map className="w-5 h-5 shrink-0 text-amber-300" />
            <span>
              🗺️ Abrir Ruta Completa en Google Maps ({stops.length} paradas)
            </span>
          </button>
        )}
      </header>

      {/* 2. CONTENIDO PRINCIPAL */}
      <main className="flex-1 p-4 space-y-4">
        {stops.length === 0 ? (
          /* PANTALLA FIN DE RUTA (0 DATOS RESIDUALES EN EL TELÉFONO) */
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 text-center space-y-5 shadow-2xl my-auto animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto shadow-inner">
              <CheckCircle2 className="w-9 h-9" />
            </div>

            <div className="space-y-2">
              <span className="text-xs font-black uppercase tracking-wider text-emerald-400">
                Viaje Finalizado con Éxito
              </span>
              <h2 className="text-2xl font-black text-white">
                Ruta Completada
              </h2>
              <div className="inline-block px-3 py-1 rounded-full bg-slate-800 text-slate-300 text-xs font-bold border border-slate-700">
                0 datos almacenados en este dispositivo
              </div>
              <p className="text-xs text-slate-400 pt-2 leading-relaxed">
                Todas las paradas han sido entregadas. Los nombres, ubicaciones y datos de clientes han sido purgados completamente de la memoria del teléfono.
              </p>
            </div>

            {stats.completedStopsCount > 0 && (
              <div className="p-4 bg-slate-950/80 rounded-2xl border border-slate-800 text-xs text-slate-300 space-y-2 text-left">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Clientes atendidos:</span>
                  <strong className="text-white font-mono text-sm">
                    {stats.completedStopsCount} paradas
                  </strong>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Sacos descargados:</span>
                  <strong className="text-amber-400 font-mono text-sm">
                    {stats.completedSacksCount} sacos (
                    {stats.completedSacksCount * 15} kg)
                  </strong>
                </div>
              </div>
            )}

            {/* BOTÓN VOLVER AL ALMACÉN */}
            {payload?.warehouse && (
              <button
                type="button"
                onClick={handleReturnToWarehouse}
                className="w-full flex items-center justify-center gap-2 py-4 px-4 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm shadow-xl shadow-amber-500/20 active:scale-[0.98] transition"
              >
                <Home className="w-5 h-5" />
                <span>
                  Volver al Almacén en Google Maps ({payload.warehouse.name})
                </span>
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* 3. TARJETA ACTIVA (#1) ULTRA-VISIBLE CON ALTO CONTRASTE */}
            <div className="bg-slate-900 border-2 border-amber-500 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-5 relative overflow-hidden ring-4 ring-amber-500/10 animate-in fade-in duration-200">
              {/* Encabezado con número de parada */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500 text-slate-950 font-black text-xl flex items-center justify-center shadow-lg shrink-0">
                    #{currentStop.seq}
                  </div>
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-amber-400 block">
                      Entrega en Curso
                    </span>
                    <h2 className="text-xl sm:text-2xl font-black text-white leading-tight">
                      {currentStop.name}
                    </h2>
                  </div>
                </div>

                <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-slate-800 text-amber-300 border border-amber-500/20 uppercase shrink-0">
                  Parada Actual
                </span>
              </div>

              {/* CANTIDAD DE SACOS EN TEXTO GIGANTE */}
              <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800 text-center space-y-1.5 shadow-inner">
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-400 block">
                  Descargar en esta parada
                </span>
                <div className="text-4xl sm:text-5xl font-black text-amber-400 font-mono tracking-tight">
                  {currentStop.sacks} SACOS
                </div>
                <div className="text-sm text-slate-300 font-bold">
                  {currentStop.totalWeightKg.toLocaleString("es-ES")} kg (sacos
                  de 15 kg)
                </div>
              </div>

              {/* AVISO DE COBRO EN MANO Y ETIQUETAS OPERATIVAS SI EXISTEN */}
              {(currentStop.cashToCollectEur &&
                currentStop.cashToCollectEur > 0) ||
              currentStop.tags ? (
                <div className="space-y-2">
                  {currentStop.cashToCollectEur &&
                  currentStop.cashToCollectEur > 0 ? (
                    <div className="p-3 rounded-2xl bg-emerald-500/15 border-2 border-emerald-500/50 text-emerald-300 font-black text-sm flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <Banknote className="w-5 h-5 text-emerald-400 shrink-0" />
                        <span>Cobrar en mano:</span>
                      </span>
                      <span className="text-lg font-mono text-white">
                        {currentStop.cashToCollectEur.toFixed(2)} €
                      </span>
                    </div>
                  ) : null}

                  {currentStop.tags && (
                    <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs font-bold">
                      📌 {currentStop.tags}
                    </div>
                  )}
                </div>
              ) : null}

              {/* DIRECCIÓN Y ALDEA / PARROQUIA */}
              <div className="space-y-1 bg-slate-800/40 p-3.5 rounded-2xl border border-slate-800">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  Lugar / Aldea / Concello
                </span>
                <p className="font-black text-slate-100 text-base leading-snug flex items-start gap-2">
                  <MapPin className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <span>{currentStop.village}</span>
                </p>
                <div className="text-[11px] text-slate-400 pl-7 font-mono">
                  {currentStop.lat.toFixed(5)}, {currentStop.lng.toFixed(5)}
                </div>
              </div>

              {/* BOTÓN GIGANTE: IR A ESTE CLIENTE (GOOGLE MAPS) + BOTÓN COPIAR GPS OFFLINE */}
              <div className="flex items-stretch gap-2.5">
                <button
                  type="button"
                  onClick={() =>
                    handleNavigateToCustomer({
                      lat: currentStop.lat,
                      lng: currentStop.lng,
                    })
                  }
                  className="flex-1 flex items-center justify-center gap-2.5 py-4 px-4 rounded-2xl bg-sky-600 hover:bg-sky-500 text-white font-black text-sm sm:text-base shadow-xl shadow-sky-600/30 active:scale-[0.98] transition"
                >
                  <Navigation className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" />
                  <span>📍 Ir en Google Maps</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleCopyGps(currentStop)}
                  title="Copiar coordenadas GPS al portapapeles para mapas offline"
                  className={`px-4 py-4 rounded-2xl font-black text-xs border transition flex flex-col items-center justify-center gap-1 shrink-0 ${
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

              {/* BOTÓN CON CONFIRMACIÓN: ENTREGA COMPLETADA (BORRAR) */}
              <button
                type="button"
                onClick={() => setConfirmingStop(currentStop)}
                className="w-full flex items-center justify-center gap-2.5 py-4 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-base shadow-xl shadow-emerald-600/25 active:scale-[0.98] transition"
              >
                <CheckCircle2 className="w-6 h-6 shrink-0" />
                <span>✅ Entrega Completada (Borrar)</span>
              </button>
            </div>

            {/* 4. SIGUIENTES PARADAS PENDIENTES */}
            {upcomingStops.length > 0 && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between text-xs px-1">
                  <span className="font-black uppercase tracking-wider text-slate-400">
                    Siguientes Paradas del Viaje ({upcomingStops.length})
                  </span>
                  <span className="text-slate-500 text-[11px]">En cola</span>
                </div>

                <div className="space-y-2.5">
                  {upcomingStops.map((stop) => (
                    <div
                      key={stop.id}
                      className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between gap-3 text-xs opacity-85 hover:opacity-100 transition"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-slate-800 text-slate-300 font-black text-xs flex items-center justify-center shrink-0">
                          #{stop.seq}
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-white text-sm truncate">
                            {stop.name}
                          </div>
                          <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">
                            {stop.village}
                          </p>
                          {stop.cashToCollectEur && stop.cashToCollectEur > 0 ? (
                            <span className="text-[10px] text-emerald-400 font-bold">
                              💶 Cobrar: {stop.cashToCollectEur} €
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleCopyGps(stop)}
                          className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-bold text-slate-300 flex items-center gap-1"
                          title="Copiar coordenadas GPS"
                        >
                          {copiedStopId === stop.id ? (
                            <span className="text-emerald-400">✓ GPS</span>
                          ) : (
                            <span>📋 Copiar GPS</span>
                          )}
                        </button>

                        <div className="text-right">
                          <span className="font-mono font-black text-amber-400 text-xs block">
                            {stop.sacks} SACOS
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {stop.totalWeightKg} kg
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* 5. MODAL DE CONFIRMACIÓN DE ENTREGA */}
      {confirmingStop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-sm w-full p-6 space-y-5 text-white shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
              <Package className="w-7 h-7" />
            </div>

            <div className="text-center space-y-1">
              <h3 className="text-lg font-black text-white">
                ¿Confirmar entrega y borrar?
              </h3>
              <p className="text-xs text-slate-300">
                Se han descargado los{" "}
                <strong className="text-amber-400 font-bold">
                  {confirmingStop.sacks} sacos ({confirmingStop.totalWeightKg} kg)
                </strong>{" "}
                en el cliente{" "}
                <strong className="text-white">{confirmingStop.name}</strong>.
              </p>
            </div>

            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-[11px] text-red-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
              <span>
                <strong>Privacidad Zero-Cloud:</strong> Los datos de este cliente desaparecerán definitivamente del teléfono.
              </span>
            </div>

            <div className="flex gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setConfirmingStop(null)}
                className="w-1/2 py-3.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExecuteDelivery}
                className="w-1/2 py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs shadow-lg shadow-emerald-600/25 transition active:scale-[0.98]"
              >
                Sí, Confirmar y Borrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PIE DE PÁGINA */}
      <footer className="text-center text-[10px] text-slate-600 px-4 pt-3 border-t border-slate-900">
        <span className="flex items-center justify-center gap-1.5 text-slate-500 font-bold">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          PelletGalicia Reparto • Terminal Efímera Sin Rastro
        </span>
      </footer>
    </div>
  );
}

export default function RepartoDriverPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
          <span className="text-sm text-slate-400">Cargando reparto...</span>
        </div>
      }
    >
      <RepartoContent />
    </Suspense>
  );
}
