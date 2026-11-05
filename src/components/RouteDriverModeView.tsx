"use client";

import React, { useState, useMemo } from "react";
import {
  DeliveryRoute,
  RouteStop,
  PaymentMethod,
  StopStatus,
  WarehouseLocation,
} from "@/types/pellet";
import {
  Navigation,
  Phone,
  MessageCircle,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  Clock,
  Layers,
  Package,
  Scale,
  CreditCard,
  Banknote,
  Smartphone,
  FileCheck,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Trophy,
  ArrowRight,
  TrendingUp,
  Euro,
  Route as RouteIcon,
  ShieldAlert,
} from "lucide-react";

interface RouteDriverModeViewProps {
  routes: DeliveryRoute[];
  warehouse: WarehouseLocation;
  onUpdateStop: (
    routeId: string,
    stopId: string,
    updates: Partial<RouteStop>
  ) => void;
  onSelectRouteTab?: () => void;
}

const PAYMENT_METHODS: { id: PaymentMethod; label: string; icon: React.ElementType }[] = [
  { id: "Efectivo", label: "Efectivo", icon: Banknote },
  { id: "Bizum", label: "Bizum", icon: Smartphone },
  { id: "Transferencia", label: "Transferencia", icon: CreditCard },
  { id: "Pendiente de cobro", label: "Pendiente cobro", icon: Clock },
  { id: "Ya pagado", label: "Ya pagado / Adelantado", icon: FileCheck },
];

export default function RouteDriverModeView({
  routes,
  warehouse,
  onUpdateStop,
  onSelectRouteTab,
}: RouteDriverModeViewProps) {
  // Seleccionar la ruta activa (por defecto la primera en curso o confirmada)
  const [selectedRouteId, setSelectedRouteId] = useState<string>(() => {
    const inProgress = routes.find((r) => r.status === "En Curso");
    if (inProgress) return inProgress.id;
    const confirmed = routes.find((r) => r.status === "Confirmada");
    return confirmed ? confirmed.id : routes[0]?.id || "";
  });

  // Modal para marcar como entregado y registrar cobro
  const [deliverModalStop, setDeliverModalStop] = useState<RouteStop | null>(
    null
  );
  const [selectedPaymentMethod, setSelectedPaymentMethod] =
    useState<PaymentMethod>("Efectivo");
  const [amountCollected, setAmountCollected] = useState<string>("");
  const [driverNotes, setDriverNotes] = useState<string>("");

  // Modal para registrar incidencia
  const [incidentModalStop, setIncidentModalStop] = useState<RouteStop | null>(
    null
  );
  const [incidentReason, setIncidentReason] = useState<string>("");

  // Minutos estimados para llegar (para plantilla WhatsApp)
  const [etaMinutesInput, setEtaMinutesInput] = useState<{
    [stopId: string]: number;
  }>({});

  const activeRoute = useMemo(() => {
    return routes.find((r) => r.id === selectedRouteId) || routes[0] || null;
  }, [routes, selectedRouteId]);

  // Identificar el índice de la siguiente parada activa pendiente (para iluminarla)
  const currentActiveStopIndex = useMemo(() => {
    if (!activeRoute) return -1;
    return activeRoute.stops.findIndex(
      (s) => !s.completed && s.status !== "Incidencia"
    );
  }, [activeRoute]);

  // Resumen del día y ruta
  const routeSummary = useMemo(() => {
    if (!activeRoute) return null;
    const totalStops = activeRoute.stops.length;
    const completedStops = activeRoute.stops.filter((s) => s.completed).length;
    const incidentStops = activeRoute.stops.filter(
      (s) => s.status === "Incidencia"
    ).length;

    const totalKgDelivered = activeRoute.stops
      .filter((s) => s.completed)
      .reduce((sum, s) => sum + (s.order?.totalWeightKg || 0), 0);

    const totalMoneyCollected = activeRoute.stops
      .filter((s) => s.completed && s.amountCollected)
      .reduce((sum, s) => sum + (s.amountCollected || 0), 0);

    const isAllFinished =
      totalStops > 0 && completedStops + incidentStops === totalStops;

    return {
      totalStops,
      completedStops,
      incidentStops,
      totalKgDelivered,
      totalMoneyCollected,
      isAllFinished,
      totalDistanceKm: activeRoute.totalDistanceKm || 0,
      totalRouteKg: activeRoute.totalWeightKg || 0,
    };
  }, [activeRoute]);

  // Genera el enlace de navegación nativo a Google Maps
  const handleOpenNavigation = (lat: number, lng: number) => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
    window.open(url, "_blank");
  };

  // Genera el enlace de WhatsApp con mensaje personalizado
  const handleSendWhatsApp = (stop: RouteStop) => {
    if (!stop.order) return;
    const phoneClean = stop.order.client.phone.replace(/[\s\-\(\)]/g, "");
    // Si no tiene prefijo país, asumir +34 España
    const fullPhone = phoneClean.startsWith("+")
      ? phoneClean.replace("+", "")
      : phoneClean.startsWith("34")
      ? phoneClean
      : `34${phoneClean}`;

    const eta = etaMinutesInput[stop.id] || 15;
    const cargaDesc = `${
      stop.order.pallets > 0
        ? `${stop.order.pallets} ${stop.order.pallets === 1 ? "palé" : "palés"}`
        : ""
    }${
      stop.order.pallets > 0 && stop.order.looseSacks > 0 ? " y " : ""
    }${
      stop.order.looseSacks > 0
        ? `${stop.order.looseSacks} sacos sueltos`
        : ""
    } (${stop.order.totalWeightKg.toLocaleString("es-ES")} kg)`;

    const message = encodeURIComponent(
      `Hola ${stop.order.client.name}, soy del reparto de pellets de PelletRoute. 🚛 Estoy de camino a tu dirección, llegaré en unos ${eta} minutos con tu pedido de ${cargaDesc}.`
    );

    const waUrl = `https://wa.me/${fullPhone}?text=${message}`;
    window.open(waUrl, "_blank");
  };

  // Guardar estado de entrega y cobro
  const confirmDelivery = () => {
    if (!activeRoute || !deliverModalStop) return;

    onUpdateStop(activeRoute.id, deliverModalStop.id, {
      completed: true,
      status: "Entregado",
      completedAt: new Date().toISOString(),
      paymentMethod: selectedPaymentMethod,
      amountCollected: amountCollected ? parseFloat(amountCollected) : undefined,
      deliveryDriverNotes: driverNotes.trim() || undefined,
    });

    setDeliverModalStop(null);
    setAmountCollected("");
    setDriverNotes("");
  };

  // Guardar estado de incidencia
  const confirmIncident = () => {
    if (!activeRoute || !incidentModalStop) return;

    onUpdateStop(activeRoute.id, incidentModalStop.id, {
      completed: false,
      status: "Incidencia",
      completedAt: new Date().toISOString(),
      incidentReason: incidentReason.trim() || "Cliente ausente / Sin acceso",
    });

    setIncidentModalStop(null);
    setIncidentReason("");
  };

  if (routes.length === 0) {
    return (
      <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center max-w-lg mx-auto shadow-sm my-8">
        <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4">
          <RouteIcon className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-extrabold text-slate-900">
          No hay rutas planificadas para hoy
        </h2>
        <p className="text-sm text-slate-500 mt-2">
          Primero debes armar y confirmar una hoja de ruta en el{" "}
          <strong>Planificador de Rutas</strong>.
        </p>
        {onSelectRouteTab && (
          <button
            type="button"
            onClick={onSelectRouteTab}
            className="mt-6 w-full py-3.5 px-4 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-sm shadow-lg shadow-amber-600/25 transition"
          >
            Ir al Planificador de Rutas
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5 pb-16">
      {/* Selector de Ruta Activa y Estado del Camión */}
      <div className="bg-slate-900 text-white p-4 sm:p-5 rounded-3xl shadow-xl space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-emerald-400 animate-ping"></span>
            <span className="text-xs font-black uppercase tracking-widest text-amber-400">
              Modo Conductor En Ruta
            </span>
          </div>

          <span
            className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
              activeRoute?.status === "Completada"
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
            }`}
          >
            {activeRoute?.status}
          </span>
        </div>

        {/* Selector de Rutas si hay múltiples */}
        {routes.length > 1 && (
          <div>
            <label className="block text-[10px] text-slate-400 uppercase font-bold mb-1">
              Cambiar Hoja de Ruta:
            </label>
            <select
              value={selectedRouteId}
              onChange={(e) => setSelectedRouteId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-white text-xs font-semibold py-2 px-3 rounded-xl outline-none"
            >
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.stops.length} paradas •{" "}
                  {r.totalWeightKg.toLocaleString("es-ES")} kg)
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center justify-between pt-1 border-t border-slate-800 text-xs">
          <div>
            <span className="text-slate-400 text-[11px]">Vehículo:</span>
            <div className="font-bold text-white text-sm">
              {activeRoute?.vehicle?.name || "Camión asignado"}
            </div>
          </div>
          <div className="text-right">
            <span className="text-slate-400 text-[11px]">Carga Total:</span>
            <div className="font-bold text-amber-400 text-sm">
              {activeRoute?.totalWeightKg.toLocaleString("es-ES")} kg
            </div>
          </div>
        </div>

        {/* Barra de progreso de la ruta */}
        {routeSummary && (
          <div className="space-y-1.5 pt-1">
            <div className="flex justify-between text-[11px] font-medium text-slate-300">
              <span>
                Progreso: {routeSummary.completedStops} de{" "}
                {routeSummary.totalStops} paradas
              </span>
              <span className="font-bold text-amber-400">
                {Math.round(
                  (routeSummary.completedStops / routeSummary.totalStops) * 100
                )}
                %
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-emerald-500 transition-all duration-300"
                style={{
                  width: `${
                    (routeSummary.completedStops / routeSummary.totalStops) *
                    100
                  }%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Salida del Almacén */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200 flex items-center justify-between text-xs font-semibold shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-slate-900 text-amber-400">
            <WarehouseLocationIcon className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block uppercase font-bold">
              Base de Salida (Pellets Cargados)
            </span>
            <span className="text-slate-900">{warehouse.name}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            handleOpenNavigation(
              warehouse.coordinates.lat,
              warehouse.coordinates.lng
            )
          }
          className="text-amber-700 text-xs font-bold hover:underline"
        >
          Navegar a Base
        </button>
      </div>

      {/* LISTA SECUENCIAL DE PARADAS (TARJETAS GRANDES DE ALTO CONTRASTE) */}
      <div className="space-y-4">
        {activeRoute?.stops.map((stop, index) => {
          const isCurrentTarget = index === currentActiveStopIndex;
          const isDone = stop.completed;
          const isIncident = stop.status === "Incidencia";
          const client = stop.order?.client;
          if (!client) return null;

          return (
            <div
              key={stop.id}
              className={`rounded-3xl p-5 border-2 transition-all shadow-md ${
                isDone
                  ? "bg-slate-50 border-emerald-300/80 opacity-85"
                  : isIncident
                  ? "bg-red-50/70 border-red-300"
                  : isCurrentTarget
                  ? "bg-white border-amber-500 shadow-xl ring-4 ring-amber-400/20"
                  : "bg-white border-slate-200"
              }`}
            >
              {/* Cabecera de la Parada */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-2xl font-black text-sm flex items-center justify-center shrink-0 shadow-md ${
                      isDone
                        ? "bg-emerald-600 text-white"
                        : isIncident
                        ? "bg-red-600 text-white"
                        : isCurrentTarget
                        ? "bg-amber-500 text-slate-950 scale-105"
                        : "bg-slate-900 text-white"
                    }`}
                  >
                    {isDone ? <Check className="w-5 h-5" /> : index + 1}
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black uppercase tracking-wider text-slate-400">
                        Parada {index + 1}
                      </span>
                      {isCurrentTarget && (
                        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 uppercase animate-pulse">
                          Siguiente Entrega
                        </span>
                      )}
                      {isDone && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                          Entregado • {stop.paymentMethod || "Cobrado"}
                        </span>
                      )}
                      {isIncident && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-800">
                          Incidencia registrada
                        </span>
                      )}
                    </div>
                    <h3 className="text-lg font-black text-slate-900 leading-snug">
                      {client.name}
                    </h3>
                  </div>
                </div>

                <span className="text-xs font-semibold px-2.5 py-1 rounded-xl bg-slate-100 text-slate-700 shrink-0">
                  ⏱ {client.preferredTimeWindow}
                </span>
              </div>

              {/* Cantidad exacta de pellets a descargar (DESTACADA) */}
              <div className="bg-slate-900 text-white p-3.5 rounded-2xl flex items-center justify-between mb-3 shadow-sm">
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block">
                    Carga a Descargar
                  </span>
                  <div className="text-sm font-black text-amber-400 flex items-center gap-2">
                    {stop.order?.pallets ? (
                      <span className="flex items-center gap-1">
                        <Layers className="w-4 h-4 text-amber-400" />
                        {stop.order.pallets}{" "}
                        {stop.order.pallets === 1 ? "Palé" : "Palés"}
                      </span>
                    ) : null}
                    {stop.order?.pallets && stop.order?.looseSacks ? " + " : ""}
                    {stop.order?.looseSacks ? (
                      <span className="flex items-center gap-1 text-emerald-400">
                        <Package className="w-4 h-4" />
                        {stop.order.looseSacks} sacos
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xl font-black text-amber-400 font-mono">
                    {stop.order?.totalWeightKg.toLocaleString("es-ES")} kg
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {stop.order?.totalSacksCount} sacos totales
                  </div>
                </div>
              </div>

              {/* Dirección y Teléfono */}
              <div className="space-y-1.5 text-xs text-slate-700 mb-3">
                <div className="flex items-start gap-2">
                  <MapPin className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span className="font-semibold text-slate-800">
                    {client.address}
                  </span>
                </div>
              </div>

              {/* NOTAS DE DESCARGA DESTACADAS EN AMARILLO */}
              {client.unloadingNotes && (
                <div className="p-3 rounded-2xl bg-amber-300 text-amber-950 font-medium text-xs mb-4 border border-amber-400 shadow-sm flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-900 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-black uppercase tracking-wide text-[11px] block text-amber-900">
                      Instrucciones de Descarga:
                    </span>
                    {client.unloadingNotes}
                  </div>
                </div>
              )}

              {/* Si hay incidencia registrada */}
              {stop.incidentReason && (
                <div className="p-2.5 rounded-xl bg-red-100 text-red-900 text-xs mb-3 font-semibold flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-red-700 shrink-0" />
                  <span>Motivo: {stop.incidentReason}</span>
                </div>
              )}

              {/* 3 BOTONES DE ACCIÓN RÁPIDA (DISEÑO MÓVIL CON BOTONES GRANDES) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-100">
                {/* 1. NAVEGAR (Google Maps) */}
                <button
                  type="button"
                  onClick={() =>
                    handleOpenNavigation(
                      client.coordinates.lat,
                      client.coordinates.lng
                    )
                  }
                  className="w-full flex items-center justify-center gap-2 py-3 px-3 rounded-2xl bg-sky-600 hover:bg-sky-700 text-white font-extrabold text-xs shadow-md shadow-sky-600/25 active:scale-95 transition"
                >
                  <Navigation className="w-4 h-4" />
                  Navegar
                </button>

                {/* 2. LLAMAR */}
                <a
                  href={`tel:${client.phone}`}
                  className="w-full flex items-center justify-center gap-2 py-3 px-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs shadow-md active:scale-95 transition"
                >
                  <Phone className="w-4 h-4 text-amber-400" />
                  Llamar
                </a>

                {/* 3. WHATSAPP CON MENSAJE PREDEFINIDO */}
                <button
                  type="button"
                  onClick={() => handleSendWhatsApp(stop)}
                  className="w-full flex items-center justify-center gap-2 py-3 px-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs shadow-md shadow-emerald-600/25 active:scale-95 transition"
                >
                  <MessageCircle className="w-4 h-4" />
                  WhatsApp
                </button>

                {/* 4. MARCAR COMO ENTREGADO */}
                <button
                  type="button"
                  onClick={() => {
                    setDeliverModalStop(stop);
                    setSelectedPaymentMethod("Efectivo");
                    setAmountCollected("");
                  }}
                  className={`w-full flex items-center justify-center gap-1.5 py-3 px-3 rounded-2xl font-extrabold text-xs shadow-md active:scale-95 transition ${
                    isDone
                      ? "bg-slate-200 text-slate-700 hover:bg-slate-300"
                      : "bg-amber-600 hover:bg-amber-700 text-white shadow-amber-600/25"
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {isDone ? "Modificar" : "Entregado"}
                </button>
              </div>

              {/* Botón secundario para registrar incidencia */}
              {!isDone && (
                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setIncidentModalStop(stop)}
                    className="text-[11px] font-semibold text-red-600 hover:text-red-800 hover:underline flex items-center gap-1"
                  >
                    <AlertTriangle className="w-3 h-3" />
                    Registrar Incidencia / Ausente
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Retorno a Base */}
      <div className="bg-slate-100 p-3.5 rounded-2xl border border-slate-200 flex items-center justify-between text-xs font-semibold text-slate-700">
        <div className="flex items-center gap-2.5">
          <WarehouseLocationIcon className="w-4 h-4 text-slate-500" />
          <span>Fin de Ruta: Retorno a {warehouse.name}</span>
        </div>
        <button
          type="button"
          onClick={() =>
            handleOpenNavigation(
              warehouse.coordinates.lat,
              warehouse.coordinates.lng
            )
          }
          className="text-amber-800 text-xs font-bold hover:underline"
        >
          Navegar a Base
        </button>
      </div>

      {/* 5. RESUMEN DEL DÍA / SERVICIO AL FINALIZAR */}
      {routeSummary && (
        <div className="bg-gradient-to-br from-slate-900 to-slate-950 text-white rounded-3xl p-6 shadow-2xl border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-2xl bg-amber-500/20 text-amber-400">
                <Trophy className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-extrabold tracking-tight">
                  Resumen de la Jornada
                </h3>
                <p className="text-xs text-slate-400">
                  {routeSummary.isAllFinished
                    ? "🎉 ¡Todas las paradas han sido completadas!"
                    : "En progreso durante el reparto"}
                </p>
              </div>
            </div>

            <span className="text-xs font-bold px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-amber-400">
              {routeSummary.completedStops} / {routeSummary.totalStops} entregas
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 pt-2">
            <div className="bg-slate-800/80 p-3 rounded-2xl border border-slate-700/60 text-center">
              <span className="text-[10px] text-slate-400 uppercase font-bold block">
                Total Repartido
              </span>
              <div className="text-lg font-black text-amber-400 mt-0.5">
                {routeSummary.totalKgDelivered.toLocaleString("es-ES")}{" "}
                <span className="text-xs">kg</span>
              </div>
              <span className="text-[10px] text-slate-400">
                de {routeSummary.totalRouteKg.toLocaleString("es-ES")} kg
              </span>
            </div>

            <div className="bg-slate-800/80 p-3 rounded-2xl border border-slate-700/60 text-center">
              <span className="text-[10px] text-slate-400 uppercase font-bold block">
                Km Recorridos
              </span>
              <div className="text-lg font-black text-white mt-0.5">
                {routeSummary.totalDistanceKm}{" "}
                <span className="text-xs">km</span>
              </div>
              <span className="text-[10px] text-slate-400">Ruta por carretera</span>
            </div>

            <div className="bg-slate-800/80 p-3 rounded-2xl border border-slate-700/60 text-center">
              <span className="text-[10px] text-slate-400 uppercase font-bold block">
                Total Cobrado
              </span>
              <div className="text-lg font-black text-emerald-400 mt-0.5">
                {routeSummary.totalMoneyCollected.toLocaleString("es-ES")}{" "}
                <span className="text-xs">€</span>
              </div>
              <span className="text-[10px] text-slate-400">
                Efectivo & Bizum
              </span>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: MARCAR COMO ENTREGADO & REGISTRAR COBRO */}
      {deliverModalStop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-100 text-emerald-800">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-slate-900">
                    Confirmar Entrega
                  </h3>
                  <p className="text-xs text-slate-500">
                    {deliverModalStop.order?.client.name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeliverModalStop(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-xs">
              <span className="text-slate-500 block">Carga entregada:</span>
              <strong className="text-slate-900 text-sm">
                {deliverModalStop.order?.pallets} Palés +{" "}
                {deliverModalStop.order?.looseSacks} sacos (
                {deliverModalStop.order?.totalWeightKg.toLocaleString("es-ES")}{" "}
                kg)
              </strong>
            </div>

            {/* Selector de Método de Pago */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700">
                Método de Cobro:
              </label>
              <div className="grid grid-cols-2 gap-2">
                {PAYMENT_METHODS.map((pm) => {
                  const Icon = pm.icon;
                  const isSelected = selectedPaymentMethod === pm.id;
                  return (
                    <button
                      key={pm.id}
                      type="button"
                      onClick={() => setSelectedPaymentMethod(pm.id)}
                      className={`flex items-center gap-2 p-2.5 rounded-xl border text-xs font-bold transition text-left ${
                        isSelected
                          ? "bg-amber-50 border-amber-500 text-amber-900 shadow-sm"
                          : "bg-white hover:bg-slate-50 border-slate-200 text-slate-700"
                      }`}
                    >
                      <Icon className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>{pm.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Importe Cobrado en € */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Importe Cobrado en € (Opcional):
              </label>
              <div className="relative">
                <Euro className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="number"
                  step="0.01"
                  placeholder="Ej. 340.00"
                  value={amountCollected}
                  onChange={(e) => setAmountCollected(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm font-bold border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            {/* Notas del Conductor */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Notas de la Entrega:
              </label>
              <input
                type="text"
                placeholder="Ej. Dejado junto a caldera, firma en albarán..."
                value={driverNotes}
                onChange={(e) => setDriverNotes(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeliverModalStop(null)}
                className="w-1/2 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmDelivery}
                className="w-1/2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md shadow-emerald-600/20"
              >
                Confirmar Entrega
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: REGISTRAR INCIDENCIA */}
      {incidentModalStop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-red-100 text-red-800">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-slate-900">
                    Registrar Incidencia
                  </h3>
                  <p className="text-xs text-slate-500">
                    {incidentModalStop.order?.client.name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIncidentModalStop(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Motivo de la Incidencia:
              </label>
              <textarea
                rows={3}
                placeholder="Ej. Cliente ausente, no responde al teléfono, calle cortada por obras..."
                value={incidentReason}
                onChange={(e) => setIncidentReason(e.target.value)}
                className="w-full p-3 text-xs border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIncidentModalStop(null)}
                className="w-1/2 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmIncident}
                className="w-1/2 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-md shadow-red-600/20"
              >
                Guardar Incidencia
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WarehouseLocationIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}
