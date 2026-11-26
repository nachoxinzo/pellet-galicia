"use client";

import React, { useState, useMemo, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
} from "@hello-pangea/dnd";
import {
  ServiceOrder,
  TechnicianConfig,
  EphemeralStop,
  EphemeralTripPayload,
  DecodedReturnReceipt,
} from "@/types/pelletGalicia";
import {
  optimizeFieldServiceRoutes,
  recalculateSingleFieldTripSync,
  OptimizedFieldRoute,
  FieldRoutingParams,
} from "@/utils/galiciaRoutingEngine";
import {
  fetchOsrmTripRoute,
  OsrmRouteGeometryResult,
} from "@/utils/osrmTableService";
import {
  buildGoogleMapsMultiStopUrl,
  extractTechTagsFromNotes,
  decodeReturnReceipt,
} from "@/utils/galiciaUrlCodec";
import {
  normalizePhoneDigits,
  extractConcelloFromVillage,
} from "@/services/galiciaStorage";
import {
  formatHoursMinutes,
  getServiceTypeBadgeMeta,
} from "@/utils/satUiHelpers";
import { QRCodeSVG } from "qrcode.react";
import {
  Route as RouteIcon,
  Clock,
  ArrowUpDown,
  GripVertical,
  QrCode,
  ExternalLink,
  Copy,
  Check,
  X,
  MessageCircle,
  Wrench,
  CheckCircle2,
  Navigation,
  ShieldCheck,
  AlertTriangle,
  Fuel,
  Coins,
  Printer,
  TrendingUp,
  Inbox,
  Filter,
} from "lucide-react";

const DeliveryRouteMap = dynamic(
  () => import("@/components/map/DeliveryRouteMap"),
  {
    ssr: false,
    loading: () => (
      <div className="h-[380px] w-full bg-slate-950 rounded-2xl flex items-center justify-center text-slate-500 text-xs animate-pulse border border-slate-800">
        Cargando mapa OSRM por carretera...
      </div>
    ),
  }
);

interface RoutePlannerTabProps {
  orders: ServiceOrder[];
  config: TechnicianConfig;
  onMarkCompleted: (orderIds: string[]) => void;
  onMarkInRoute?: (orderIds: string[]) => void;
  onReconcileReturnReceipt?: (receipt: DecodedReturnReceipt) => {
    matchedOrderIds: string[];
    totalMinutesRecorded: number;
    totalCashRecordedEur: number;
  };
}

export default function RoutePlannerTab({
  orders,
  config,
  onMarkCompleted,
  onMarkInRoute,
  onReconcileReturnReceipt,
}: RoutePlannerTabProps) {
  const pendingOrders = useMemo(
    () =>
      orders.filter((o) => o.status === "Pendiente" || o.status === "En Ruta"),
    [orders]
  );

  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [trips, setTrips] = useState<OptimizedFieldRoute<ServiceOrder>[]>([]);
  const [activeTripIdx, setActiveTripIdx] = useState<number>(0);
  const [osrmRouteData, setOsrmRouteData] =
    useState<OsrmRouteGeometryResult | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [interRouteSwaps, setInterRouteSwaps] = useState<number>(0);
  const [fromOsrmCache, setFromOsrmCache] = useState<boolean>(false);

  const [concelloFilter, setConcelloFilter] = useState<string>("ALL");

  const [isReconcileOpen, setIsReconcileOpen] = useState(false);
  const [returnTokenInput, setReturnTokenInput] = useState("");
  const [reconcileResultMsg, setReconcileResultMsg] = useState<string | null>(
    null
  );

  const routingParams: FieldRoutingParams = useMemo(
    () => ({
      consumoL100: config.consumoL100 ?? 7.5,
      precioCombustible: config.precioCombustible ?? 1.55,
      hourlyCostEur: config.hourlyCostEur ?? 0,
    }),
    [config.consumoL100, config.precioCombustible, config.hourlyCostEur]
  );

  const [isQrOpen, setIsQrOpen] = useState(false);
  const [isPrintSheetOpen, setIsPrintSheetOpen] = useState(false);
  const [sharePayloadStr, setSharePayloadStr] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedGmaps, setCopiedGmaps] = useState(false);
  const [departureTime, setDepartureTime] = useState<string>(
    config.workdayStartTime || "08:30"
  );

  useEffect(() => {
    if (pendingOrders.length > 0 && selectedOrderIds.length === 0) {
      setSelectedOrderIds(pendingOrders.map((o) => o.id));
    }
  }, [pendingOrders]);

  const handleOptimize = async () => {
    const selectedOrders = selectedOrderIds
      .map((id) => orders.find((o) => o.id === id))
      .filter((o): o is ServiceOrder => Boolean(o));

    if (selectedOrders.length === 0) {
      setTrips([]);
      setInterRouteSwaps(0);
      return;
    }

    setIsOptimizing(true);
    try {
      const res = await optimizeFieldServiceRoutes(
        selectedOrders,
        config.warehouseCoordinates,
        config.maxWorkdayMinutes,
        config.maxStopsPerRoute,
        routingParams
      );

      setTrips(res.trips);
      setInterRouteSwaps(res.interRouteSwapsApplied);
      setFromOsrmCache(res.fromOsrmCache);
      setActiveTripIdx(0);
    } catch (err) {
      console.error("Error optimizando turnos SAT:", err);
    } finally {
      setIsOptimizing(false);
    }
  };

  useEffect(() => {
    handleOptimize();
  }, [
    selectedOrderIds,
    orders,
    config.maxWorkdayMinutes,
    config.maxStopsPerRoute,
    config.warehouseCoordinates,
    routingParams,
  ]);

  const activeTrip = trips[activeTripIdx] || trips[0] || null;

  const globalSummary = useMemo(() => {
    const totalKm = trips.reduce((s, t) => s + (t.totalDistanceKm || 0), 0);
    const totalDrivingMin = trips.reduce(
      (s, t) => s + (t.estimatedDrivingMinutes || 0),
      0
    );
    const totalInterventionMin = trips.reduce(
      (s, t) => s + (t.totalInterventionMinutes || 0),
      0
    );
    const totalWorkdayMin = totalDrivingMin + totalInterventionMin;
    const totalLiters = trips.reduce((s, t) => s + (t.totalFuelLiters || 0), 0);
    const totalFuelCostEur = trips.reduce(
      (s, t) => s + (t.totalFuelCostEur || 0),
      0
    );
    const totalLaborCostEur = trips.reduce(
      (s, t) => s + (t.totalLaborCostEur || 0),
      0
    );
    const totalCostEur = totalFuelCostEur + totalLaborCostEur;
    const totalStops = trips.reduce((s, t) => s + t.totalStops, 0);
    const avgCostPerStop = totalStops > 0 ? totalCostEur / totalStops : 0;
    const grossRevenueEur = trips.reduce(
      (s, t) => s + (t.tripRevenueEur || 0),
      0
    );
    const netMarginEur = grossRevenueEur - totalCostEur;
    const overtimeTrips = trips.filter((t) => t.isOvertimeWarning);

    return {
      totalKm: Number(totalKm.toFixed(1)),
      totalDrivingMin,
      totalInterventionMin,
      totalWorkdayMin,
      totalLiters: Number(totalLiters.toFixed(2)),
      totalFuelCostEur: Number(totalFuelCostEur.toFixed(2)),
      totalLaborCostEur: Number(totalLaborCostEur.toFixed(2)),
      totalCostEur: Number(totalCostEur.toFixed(2)),
      avgCostPerStop: Number(avgCostPerStop.toFixed(2)),
      grossRevenueEur: Number(grossRevenueEur.toFixed(2)),
      netMarginEur: Number(netMarginEur.toFixed(2)),
      overtimeTrips,
    };
  }, [trips]);

  useEffect(() => {
    if (!activeTrip || activeTrip.orders.length === 0) {
      setOsrmRouteData(null);
      return;
    }

    let active = true;
    const coords = [
      config.warehouseCoordinates,
      ...activeTrip.orders.map((o) => o.customer.coordinates),
      config.warehouseCoordinates,
    ];

    fetchOsrmTripRoute(coords).then((res) => {
      if (active) setOsrmRouteData(res);
    });

    return () => {
      active = false;
    };
  }, [activeTrip, config.warehouseCoordinates]);

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination || !activeTrip) return;
    const from = result.source.index;
    const to = result.destination.index;
    if (from === to) return;

    const copy = Array.from(activeTrip.orders);
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);

    const recalculated = recalculateSingleFieldTripSync(
      copy,
      activeTrip.tripNumber,
      config.warehouseCoordinates,
      config.maxWorkdayMinutes,
      routingParams
    );

    const updated = [...trips];
    updated[activeTripIdx] = recalculated;
    setTrips(updated);
  };

  const handleInvertRoute = () => {
    if (!activeTrip || activeTrip.orders.length <= 1) return;
    const reversed = [...activeTrip.orders].reverse();
    const recalculated = recalculateSingleFieldTripSync(
      reversed,
      activeTrip.tripNumber,
      config.warehouseCoordinates,
      config.maxWorkdayMinutes,
      routingParams
    );
    const updated = [...trips];
    updated[activeTripIdx] = recalculated;
    setTrips(updated);
  };

  // Ruta limpia sin PII en URL ni QR (el técnico inicia sesión en /tecnico)
  const activeTripEncodedPayload = useMemo(() => {
    return activeTrip && activeTrip.orders.length > 0 ? "cloud" : "";
  }, [activeTrip]);

  // Cálculo de ETA realista acumulando conducción OSRM + duración real de cada intervención anterior
  const stopEtasMap = useMemo(() => {
    if (!activeTrip || activeTrip.orders.length === 0)
      return {} as Record<string, string>;
    const [hoursStr, minsStr] = (departureTime || "08:30").split(":");
    const startMinutes =
      (parseInt(hoursStr, 10) || 8) * 60 + (parseInt(minsStr, 10) || 30);

    let cumulativeMinutes = 0;
    const map: Record<string, string> = {};

    activeTrip.orders.forEach((ord, idx) => {
      const leg = activeTrip.legDetails?.[idx];
      const legDrive = leg?.drivingMinutesFromPrev ?? 12;
      cumulativeMinutes += legDrive;

      const arrivalTotalMins = (startMinutes + cumulativeMinutes) % (24 * 60);
      const hh = String(Math.floor(arrivalTotalMins / 60)).padStart(2, "0");
      const mm = String(Math.round(arrivalTotalMins % 60)).padStart(2, "0");
      map[ord.id] = `${hh}:${mm}`;

      // Sumar la duración real estimada de esta intervención para la siguiente parada
      cumulativeMinutes += ord.estimatedMinutes || 45;
    });

    return map;
  }, [activeTrip, departureTime]);

  const handleGenerateDispatch = () => {
    if (!activeTrip || activeTrip.orders.length === 0) return;
    setSharePayloadStr(activeTripEncodedPayload);
    if (onMarkInRoute) {
      onMarkInRoute(activeTrip.orders.map((o) => o.id));
    }
    setIsQrOpen(true);
  };

  const handleOpenPrintSheet = () => {
    if (!activeTrip || activeTrip.orders.length === 0) return;
    setSharePayloadStr(activeTripEncodedPayload);
    setIsPrintSheetOpen(true);
  };

  const handleNotifyCustomerWhatsApp = (ord: ServiceOrder, etaStr: string) => {
    const rawDigits = normalizePhoneDigits(ord.customer.phone);
    const phoneWithPrefix =
      rawDigits.length === 9
        ? `34${rawDigits}`
        : rawDigits.startsWith("34")
        ? rawDigits
        : rawDigits;
    const equipPart =
      ord.equipmentInfo || ord.customer.equipmentInfo
        ? ` (${ord.equipmentInfo || ord.customer.equipmentInfo})`
        : "";
    const message = `Hola ${ord.customer.name}, nuestro técnico pasará hoy a realizar tu ${ord.serviceType.toLowerCase()}${equipPart} aproximadamente sobre las ${etaStr}. ¡Un saludo!`;
    const waUrl = phoneWithPrefix
      ? `https://wa.me/${phoneWithPrefix}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(waUrl, "_blank");
  };

  const handleProcessReturnReceipt = () => {
    const decoded = decodeReturnReceipt(returnTokenInput);
    if (!decoded) {
      setReconcileResultMsg(
        "❌ Código no válido. Pega el mensaje completo de WhatsApp o el código SAT1-..."
      );
      return;
    }
    if (onReconcileReturnReceipt) {
      const res = onReconcileReturnReceipt(decoded);
      setReconcileResultMsg(
        `✅ Cierre conciliado: ${res.matchedOrderIds.length} partes cerrados (${res.totalMinutesRecorded} min · ${res.totalCashRecordedEur.toFixed(
          2
        )} € cobrados).`
      );
      setSelectedOrderIds((prev) =>
        prev.filter((id) => !res.matchedOrderIds.includes(id))
      );
      setReturnTokenInput("");
    }
  };

  const availableConcellos = useMemo(() => {
    const set = new Set<string>();
    pendingOrders.forEach((o) => {
      set.add(o.concello || extractConcelloFromVillage(o.customer.village));
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [pendingOrders]);

  const filteredAvailableOrders = useMemo(() => {
    if (concelloFilter === "ALL") return pendingOrders;
    if (concelloFilter === "URGENTES") {
      return pendingOrders.filter((o) => o.priority === "Urgente");
    }
    return pendingOrders.filter(
      (o) =>
        (o.concello || extractConcelloFromVillage(o.customer.village)) ===
        concelloFilter
    );
  }, [pendingOrders, concelloFilter]);

  const handleSelectOneShiftCapacity = () => {
    let accMin = 0;
    const picked: string[] = [];
    const sorted = [...filteredAvailableOrders].sort((a, b) =>
      a.priority === "Urgente" && b.priority !== "Urgente"
        ? -1
        : b.priority === "Urgente" && a.priority !== "Urgente"
        ? 1
        : b.estimatedMinutes - a.estimatedMinutes
    );
    for (const ord of sorted) {
      // Reservar ~15 min de conducción estimada entre avisos
      if (
        picked.length < config.maxStopsPerRoute &&
        accMin + ord.estimatedMinutes + 15 <= config.maxWorkdayMinutes
      ) {
        picked.push(ord.id);
        accMin += ord.estimatedMinutes + 15;
      }
    }
    if (picked.length === 0 && sorted.length > 0) {
      picked.push(sorted[0].id);
    }
    setSelectedOrderIds(picked);
  };

  const handleMarkActiveTripCompleted = () => {
    if (!activeTrip) return;
    const ids = activeTrip.orders.map((o) => o.id);
    onMarkCompleted(ids);
    setSelectedOrderIds((prev) => prev.filter((id) => !ids.includes(id)));
  };

  const toggleSelectOrder = (id: string) => {
    setSelectedOrderIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const selectedInterventionMinutes = useMemo(() => {
    return selectedOrderIds
      .map((id) => orders.find((o) => o.id === id))
      .filter(Boolean)
      .reduce((sum, o) => sum + (o?.estimatedMinutes || 45), 0);
  }, [selectedOrderIds, orders]);

  const occupancyPercent = Math.round(
    (globalSummary.totalWorkdayMin / Math.max(1, config.maxWorkdayMinutes)) * 100
  );

  const selectedActiveTripOrders = useMemo(
    () => (activeTrip ? activeTrip.orders : []),
    [activeTrip]
  );

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const techTerminalUrl = `${baseUrl}/tecnico`;
  const gmapsMultiStopUrl = activeTrip
    ? buildGoogleMapsMultiStopUrl(
        config.warehouseCoordinates,
        config.warehouseCoordinates,
        activeTrip.orders.map((o) => o.customer.coordinates)
      )
    : "";

  return (
    <div className="space-y-6">
      {/* BARRA DE OCUPACIÓN DE JORNADA LABORAL */}
      <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl shadow-xl space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-bold">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400 uppercase tracking-wider">
              Jornada Laboral Estimada Hoy:
            </span>
            <span className="text-white font-mono text-sm">
              {formatHoursMinutes(globalSummary.totalWorkdayMin)} /{" "}
              {formatHoursMinutes(config.maxWorkdayMinutes)} (
              {globalSummary.totalDrivingMin}m volante +{" "}
              {globalSummary.totalInterventionMin}m trabajo)
            </span>
          </div>

          <span
            className={`px-3 py-1 rounded-full text-xs font-black ${
              occupancyPercent > 100
                ? "bg-red-500/20 text-red-400 border border-red-500/30"
                : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
            }`}
          >
            {occupancyPercent}% de jornada{" "}
            {trips.length > 1 && `(Dividido en ${trips.length} turnos)`}
          </span>
        </div>

        <div className="w-full h-3.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              occupancyPercent > 100
                ? "bg-red-500"
                : "bg-gradient-to-r from-amber-500 to-amber-400"
            }`}
            style={{ width: `${Math.min(100, occupancyPercent)}%` }}
          />
        </div>
      </div>

      {/* MAPA OSRM POR CARRETERA REAL */}
      <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-white flex items-center gap-2">
              <RouteIcon className="w-5 h-5 text-amber-400" />
              Trazado OSRM por Carreteras Reales (Averías y Revisiones)
            </h2>
            <p className="text-xs text-slate-400">
              Salida y retorno a {config.warehouseName}. Prioriza Averías Urgentes al inicio del Turno #1.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            {osrmRouteData && (
              <div className="flex items-center gap-3 bg-slate-950 px-4 py-2 rounded-2xl border border-slate-800 text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">
                    Carretera
                  </span>
                  <span className="font-black text-amber-400 text-sm">
                    {osrmRouteData.distanceKm} km
                  </span>
                </div>
                <div className="h-6 w-px bg-slate-800"></div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">
                    Volante
                  </span>
                  <span className="font-black text-white text-sm">
                    {activeTrip?.estimatedDrivingMinutes ||
                      osrmRouteData.durationMinutes}{" "}
                    min
                  </span>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handleOptimize}
              disabled={isOptimizing}
              className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-black text-xs shadow-lg shadow-amber-600/25 transition disabled:opacity-50"
            >
              <Wrench className="w-4 h-4" />
              <span>
                {isOptimizing
                  ? "Optimizando Turnos..."
                  : "⚡ Optimizar Rutas SAT"}
              </span>
            </button>
          </div>
        </div>

        <DeliveryRouteMap
          warehouse={{
            name: config.warehouseName,
            address: config.warehouseVillage,
            coordinates: config.warehouseCoordinates,
          }}
          pendingOrders={pendingOrders}
          selectedOrders={selectedActiveTripOrders}
          onOrderClick={toggleSelectOrder}
          osrmPolyline={osrmRouteData?.polyline}
          height="400px"
        />
      </div>

      {/* PANEL DE RENTABILIDAD Y EFICIENCIA DE JORNADA (5 KPIs) */}
      {trips.length > 0 && (
        <div className="bg-slate-900 border border-amber-500/40 p-5 rounded-3xl shadow-xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-black uppercase tracking-wider text-white">
                    ⚡ Eficiencia de Jornada Técnica (Clarke-Wright + Prioridad Urgencias)
                  </h3>
                  {fromOsrmCache && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30">
                      ⚡ Matriz OSRM en Caché (0 ms)
                    </span>
                  )}
                  {interRouteSwaps > 0 && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30">
                      {interRouteSwaps} ajustes entre turnos
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">
                  Vehículo: {config.consumoL100} L/100km • Diésel:{" "}
                  {config.precioCombustible.toFixed(2)} €/L
                  {config.hourlyCostEur && config.hourlyCostEur > 0
                    ? ` • Coste/h técnico: ${config.hourlyCostEur.toFixed(2)} €/h`
                    : ""}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
            {/* KPI 1: Turnos */}
            <div className="p-3.5 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-1.5">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">
                1. Turnos / Rutas
              </span>
              <div className="text-lg font-black text-white">
                {trips.length} {trips.length === 1 ? "Turno" : "Turnos"}
              </div>
              <div className="space-y-1 pt-0.5">
                {trips.map((t) => (
                  <div
                    key={t.tripNumber}
                    className="flex items-center justify-between text-[11px]"
                  >
                    <span className="text-slate-300 font-bold">
                      Turno {t.tripNumber} ({t.totalStops} av.):
                    </span>
                    <span
                      className={`font-mono font-black ${
                        t.isOvertimeWarning ? "text-rose-400" : "text-emerald-400"
                      }`}
                    >
                      {formatHoursMinutes(t.totalWorkdayMinutes)} ({t.occupancyPercent}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* KPI 2: Distancia y Tiempo */}
            <div className="p-3.5 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-1.5">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">
                2. Distancia y Tiempos
              </span>
              <div className="text-lg font-black text-amber-400">
                {globalSummary.totalKm} km totales
              </div>
              <div className="text-[11px] text-slate-300">
                Volante:{" "}
                <strong className="text-white">
                  {formatHoursMinutes(globalSummary.totalDrivingMin)}
                </strong>
              </div>
              <div className="text-[11px] text-slate-300">
                Intervenciones:{" "}
                <strong className="text-amber-300">
                  {formatHoursMinutes(globalSummary.totalInterventionMin)}
                </strong>
              </div>
            </div>

            {/* KPI 3: Combustible y Coste */}
            <div className="p-3.5 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-1.5">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">
                3. Desplazamiento y Costes
              </span>
              <div className="text-lg font-black text-sky-400">
                {globalSummary.totalFuelCostEur.toFixed(2)} €{" "}
                <span className="text-xs font-mono text-slate-300">
                  ({globalSummary.totalLiters} L)
                </span>
              </div>
              {globalSummary.totalLaborCostEur > 0 && (
                <div className="text-[11px] text-slate-300">
                  Coste hora:{" "}
                  <strong className="text-white">
                    {globalSummary.totalLaborCostEur.toFixed(2)} €
                  </strong>
                </div>
              )}
              <div className="text-[10px] text-slate-400">
                Coste medio/aviso:{" "}
                <strong className="text-slate-200">
                  {globalSummary.avgCostPerStop.toFixed(2)} €
                </strong>
              </div>
            </div>

            {/* KPI 4: Facturación Prevista */}
            <div className="p-3.5 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-1.5">
              <span className="text-[10px] font-bold uppercase text-slate-400 flex items-center justify-between">
                <span>4. Presupuesto Turnos</span>
                <Coins className="w-3.5 h-3.5 text-amber-400" />
              </span>
              <div className="text-lg font-black text-white">
                {globalSummary.grossRevenueEur.toFixed(2)} €
              </div>
              <div className="text-[11px] text-slate-400">
                Suma de presupuestos / importes previstos de los avisos seleccionados.
              </div>
            </div>

            {/* KPI 5: Margen Neto Estimado */}
            <div className="p-3.5 rounded-2xl bg-slate-950/90 border border-emerald-500/40 space-y-1.5">
              <span className="text-[10px] font-bold uppercase text-emerald-300 flex items-center justify-between">
                <span>5. Margen Neto Est.</span>
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              </span>
              <div className="text-lg font-black text-emerald-400">
                {globalSummary.netMarginEur >= 0 ? "+" : ""}
                {globalSummary.netMarginEur.toFixed(2)} €
              </div>
              <div className="text-[11px] text-slate-300">
                Facturación menos desplazamiento
                {globalSummary.totalLaborCostEur > 0 ? " y horas" : ""}.
              </div>
            </div>
          </div>

          {globalSummary.overtimeTrips.length > 0 && (
            <div className="p-3.5 rounded-2xl bg-amber-500/15 border-2 border-amber-500/60 text-amber-200 text-xs space-y-1">
              <div className="font-black text-amber-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>⚠️ Aviso de Jornada Extendida:</span>
              </div>
              {globalSummary.overtimeTrips.map((t) => (
                <p key={t.tripNumber} className="text-[11px] pl-6">
                  • <strong>Turno #{t.tripNumber}:</strong> {t.warningReason}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ACCIONES DEL TURNO */}
      {trips.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl shadow-xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-wider text-slate-300">
                Turnos Planificados ({formatHoursMinutes(config.maxWorkdayMinutes)} máx.):
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleInvertRoute}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs border border-slate-700 transition"
              >
                <ArrowUpDown className="w-3.5 h-3.5 text-amber-400" />
                <span>🔄 Invertir orden</span>
              </button>

              <button
                type="button"
                onClick={handleOpenPrintSheet}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-black text-xs border border-amber-500/40 transition"
              >
                <Printer className="w-3.5 h-3.5 text-amber-400" />
                <span>🖨️ Imprimir Hoja de Ruta y Partes</span>
              </button>

              <button
                type="button"
                onClick={handleGenerateDispatch}
                className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-black text-xs transition shadow-lg shadow-amber-600/25"
              >
                <QrCode className="w-4 h-4" />
                <span>📲 Enviar Turno al Técnico</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setReconcileResultMsg(null);
                  setIsReconcileOpen((p) => !p);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-slate-800 hover:bg-slate-700 text-sky-300 font-black text-xs border border-sky-500/40 transition"
              >
                <Inbox className="w-3.5 h-3.5 text-sky-400" />
                <span>📥 Conciliar Cierre</span>
              </button>

              <button
                type="button"
                onClick={handleMarkActiveTripCompleted}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition shadow-md shadow-emerald-600/20"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Cerrar Turno</span>
              </button>
            </div>
          </div>

          {isReconcileOpen && (
            <div className="p-4 rounded-2xl bg-slate-950 border-2 border-sky-500/50 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-sky-300 flex items-center gap-1.5">
                  <Inbox className="w-4 h-4 text-sky-400" />
                  <span>
                    Conciliación Zero-Cloud (/tecnico ➔ /admin): Pega el mensaje o código SAT1-...
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setIsReconcileOpen(false)}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  placeholder="Pega aquí el código SAT1-... o el resumen de WhatsApp enviado por el técnico..."
                  value={returnTokenInput}
                  onChange={(e) => setReturnTokenInput(e.target.value)}
                  className="flex-1 px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-xl text-white font-mono outline-none focus:border-sky-400"
                />
                <button
                  type="button"
                  onClick={handleProcessReturnReceipt}
                  className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-black text-xs shrink-0 transition"
                >
                  Confirmar Cierre y Cobros
                </button>
              </div>
              {reconcileResultMsg && (
                <p className="text-xs font-bold text-emerald-300">
                  {reconcileResultMsg}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {trips.map((t, idx) => {
              const isActive = activeTripIdx === idx;
              return (
                <button
                  key={t.tripNumber}
                  type="button"
                  onClick={() => setActiveTripIdx(idx)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition border ${
                    isActive
                      ? "bg-amber-500 text-slate-950 border-amber-500 shadow-md font-black"
                      : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
                  }`}
                >
                  <span>Turno #{t.tripNumber}</span>
                  {t.urgentOrdersCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-black">
                      🚨 {t.urgentOrdersCount} urg.
                    </span>
                  )}
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] ${
                      isActive
                        ? "bg-slate-950 text-amber-400"
                        : "bg-slate-900 text-slate-400"
                    }`}
                  >
                    {t.totalStops} avisos •{" "}
                    {formatHoursMinutes(t.totalWorkdayMinutes)} •{" "}
                    {t.totalDistanceKm} km
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* SELECCIÓN Y SECUENCIA DRAG & DROP */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Columna Izquierda: Avisos Disponibles */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-3 shadow-xl">
          <div className="space-y-2.5 border-b border-slate-800 pb-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-300">
                Avisos Disponibles ({filteredAvailableOrders.length})
              </h3>
              <span className="text-[11px] text-amber-400 font-bold">
                {selectedOrderIds.length} sel. (
                {formatHoursMinutes(selectedInterventionMinutes)} trabajo)
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  setSelectedOrderIds(filteredAvailableOrders.map((o) => o.id))
                }
                className="px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-[10px] border border-slate-700 transition"
              >
                ✓ Todos ({filteredAvailableOrders.length})
              </button>
              <button
                type="button"
                onClick={handleSelectOneShiftCapacity}
                className="px-2.5 py-1 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 font-black text-[10px] border border-amber-500/40 transition"
              >
                ⚡ Llenar 1 Jornada ({formatHoursMinutes(config.maxWorkdayMinutes)})
              </button>
              <button
                type="button"
                onClick={() => setSelectedOrderIds([])}
                className="px-2.5 py-1 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-slate-400 hover:text-white font-bold text-[10px] border border-slate-800 transition"
              >
                Limpiar
              </button>
            </div>

            {pendingOrders.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <select
                  value={concelloFilter}
                  onChange={(e) => setConcelloFilter(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-[11px] bg-slate-950 border border-slate-800 rounded-xl text-white font-bold outline-none focus:border-amber-500"
                >
                  <option value="ALL">
                    Todos los Concellos ({pendingOrders.length})
                  </option>
                  <option value="URGENTES">🚨 Solo Averías Urgentes</option>
                  {availableConcellos.map((c) => (
                    <option key={c} value={c}>
                      📍 Concello / Zona: {c}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
            {filteredAvailableOrders.length === 0 ? (
              <div className="p-6 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-2xl space-y-1">
                <p className="font-bold text-slate-400">
                  No hay avisos en este filtro
                </p>
                <p className="text-[11px]">
                  Ve a la pestaña &apos;Avisos y Clientes&apos; para registrar averías o revisiones.
                </p>
              </div>
            ) : (
              filteredAvailableOrders.map((ord) => {
                const isSelected = selectedOrderIds.includes(ord.id);
                const meta = getServiceTypeBadgeMeta(
                  ord.serviceType,
                  ord.priority
                );
                return (
                  <div
                    key={ord.id}
                    onClick={() => toggleSelectOrder(ord.id)}
                    className={`p-3 rounded-2xl border cursor-pointer transition flex items-center justify-between gap-3 text-xs ${
                      isSelected
                        ? "bg-amber-500/10 border-amber-500/60 text-white"
                        : "bg-slate-800/40 border-slate-800 opacity-60 hover:opacity-100"
                    }`}
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="font-bold text-white flex items-center gap-1.5 flex-wrap">
                        <span className="truncate">{ord.customer.name}</span>
                        <span
                          className={`px-1.5 py-0.2 rounded-full text-[9px] font-black ${meta.badgeClass}`}
                        >
                          {meta.emoji} {meta.label}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 line-clamp-1">
                        {ord.customer.village}
                        {ord.equipmentInfo ? ` · ⚙️ ${ord.equipmentInfo}` : ""}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-black text-amber-400 font-mono">
                        {ord.estimatedMinutes} min
                      </span>
                      {ord.estimatedPriceEur && ord.estimatedPriceEur > 0 ? (
                        <div className="text-[10px] text-emerald-400 font-mono font-bold">
                          {ord.estimatedPriceEur.toFixed(0)} €
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Columna Derecha: Secuencia de Intervenciones Drag & Drop */}
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-4 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-white">
                Secuencia de Asistencias (Turno #{activeTrip?.tripNumber || 1})
              </h3>
              <p className="text-[11px] text-slate-400">
                Urgencias primero + ruta óptima OSRM. Arrastra para ajustar el orden manualmente.
              </p>
            </div>
            {activeTrip && (
              <div className="text-right text-[11px] font-mono">
                <span className="text-emerald-400 font-black">
                  {formatHoursMinutes(activeTrip.totalWorkdayMinutes)} jornada
                </span>
                <span className="text-slate-400 block">
                  {activeTrip.totalDistanceKm} km • {activeTrip.totalFuelCostEur} € gasoil
                </span>
              </div>
            )}
          </div>

          <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-white">
            <div className="flex items-center gap-2">
              <Wrench className="w-4 h-4 text-amber-400" />
              <span>
                Salida: {config.warehouseName} ({activeTrip?.totalStops || 0} avisos)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-slate-400 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>Hora Salida Base:</span>
              </label>
              <input
                type="time"
                value={departureTime}
                onChange={(e) => setDepartureTime(e.target.value || "08:30")}
                className="px-2.5 py-1 rounded-xl bg-slate-900 border border-amber-500/40 text-amber-400 font-mono text-xs font-black outline-none focus:border-amber-400"
              />
            </div>
          </div>

          {!activeTrip || activeTrip.orders.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-2xl">
              Selecciona avisos en la columna izquierda para trazar el turno.
            </div>
          ) : (
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="sat-field-stops">
                {(provided) => (
                  <div
                    {...provided.droppableProps}
                    ref={provided.innerRef}
                    className="space-y-2.5"
                  >
                    {activeTrip.orders.map((ord, idx) => {
                      const leg = activeTrip.legDetails?.[idx];
                      const etaStr = stopEtasMap[ord.id] || "09:00";
                      const meta = getServiceTypeBadgeMeta(
                        ord.serviceType,
                        ord.priority
                      );
                      const { cashToCollectEur } = extractTechTagsFromNotes(
                        ord.technicalNotes || ord.customer.internalNotes,
                        ord.estimatedPriceEur
                      );

                      return (
                        <Draggable key={ord.id} draggableId={ord.id} index={idx}>
                          {(dragProvided, snapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs transition-all ${
                                snapshot.isDragging
                                  ? "bg-amber-500/20 border-amber-500 shadow-2xl scale-[1.02] z-50 text-white"
                                  : ord.priority === "Urgente"
                                  ? "bg-rose-950/20 border-rose-500/50 text-white"
                                  : "bg-slate-800/80 hover:bg-slate-800 border-slate-700/80 text-white"
                              }`}
                            >
                              <div className="flex items-start sm:items-center gap-3 min-w-0">
                                <div
                                  {...dragProvided.dragHandleProps}
                                  className="text-slate-400 hover:text-white p-1 cursor-grab active:cursor-grabbing mt-0.5 sm:mt-0"
                                >
                                  <GripVertical className="w-4 h-4" />
                                </div>
                                <div className="w-6 h-6 rounded-xl bg-amber-500 text-slate-950 font-black flex items-center justify-center text-xs shrink-0 mt-0.5 sm:mt-0">
                                  {idx + 1}
                                </div>
                                <div className="min-w-0 space-y-1">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="font-extrabold truncate">
                                      {ord.customer.name}
                                    </span>
                                    <span
                                      className={`px-2 py-0.5 rounded-full text-[10px] font-black ${meta.badgeClass}`}
                                    >
                                      {meta.emoji} {meta.label}
                                    </span>
                                    <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono text-[10px] font-black">
                                      🕒 ETA ~{etaStr}
                                    </span>
                                    {cashToCollectEur > 0 && (
                                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono text-[10px] font-black">
                                        💶 {cashToCollectEur.toFixed(0)} €
                                      </span>
                                    )}
                                  </div>

                                  <div className="text-[11px] text-slate-400 line-clamp-1">
                                    📍 {ord.customer.village}
                                    {(ord.equipmentInfo ||
                                      ord.customer.equipmentInfo) && (
                                      <span className="ml-2 text-amber-300 font-bold">
                                        • ⚙️{" "}
                                        {ord.equipmentInfo ||
                                          ord.customer.equipmentInfo}
                                      </span>
                                    )}
                                  </div>

                                  {leg && (
                                    <div className="flex flex-wrap items-center gap-2 text-[10px] pt-0.5">
                                      <span className="px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-700 font-mono">
                                        Desplaz.: {leg.distanceFromPrevKm} km (~
                                        {leg.drivingMinutesFromPrev} min)
                                      </span>
                                      <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 font-mono flex items-center gap-1.5">
                                        <span>
                                          Acumulado:{" "}
                                          {formatHoursMinutes(
                                            leg.cumulativeWorkdayMinutesAfterStop
                                          )}
                                        </span>
                                        <span className="w-12 h-1.5 bg-slate-950 rounded-full overflow-hidden inline-block border border-slate-800">
                                          <span
                                            className="block h-full bg-amber-400"
                                            style={{
                                              width: `${Math.min(
                                                100,
                                                Math.round(
                                                  (leg.cumulativeWorkdayMinutesAfterStop /
                                                    Math.max(
                                                      1,
                                                      config.maxWorkdayMinutes
                                                    )) *
                                                    100
                                                )
                                              )}%`,
                                            }}
                                          />
                                        </span>
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 shrink-0 pl-9 sm:pl-0">
                                <div className="text-right">
                                  <div className="font-black text-amber-400 font-mono">
                                    ⏱️ {ord.estimatedMinutes} min
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleNotifyCustomerWhatsApp(ord, etaStr)
                                  }
                                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/40 font-black text-[10px] transition"
                                >
                                  <MessageCircle className="w-3.5 h-3.5" />
                                  <span>💬 Avisar ETA</span>
                                </button>
                              </div>
                            </div>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          )}

          <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs font-semibold text-slate-400">
            <div className="flex items-center gap-2">
              <Wrench className="w-4 h-4 text-slate-500" />
              <span>Retorno a Base: {config.warehouseName}</span>
            </div>
            {activeTrip?.returnLeg ? (
              <span className="text-[11px] font-mono text-emerald-400">
                {activeTrip.returnLeg.distanceKm} km (~
                {activeTrip.returnLeg.drivingMinutes} min) • ⛽{" "}
                {activeTrip.returnLeg.fuelCostEur} €
              </span>
            ) : (
              <span className="text-[11px]">Fin de jornada</span>
            )}
          </div>
        </div>
      </div>

      {/* MODAL QR Y ENLACE PARA EL TÉCNICO */}
      {isQrOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 text-white shadow-2xl space-y-5 my-6 max-h-[94vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
                  <QrCode className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-base">
                    Acceso al Turno del Técnico (Nube Cifrada)
                  </h3>
                  <p className="text-xs text-slate-400">
                    Turno #{activeTrip?.tripNumber || 1} •{" "}
                    {activeTrip?.totalStops} avisos •{" "}
                    {formatHoursMinutes(activeTrip?.totalWorkdayMinutes || 0)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsQrOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-col items-center justify-center p-5 bg-white rounded-2xl shadow-inner">
              <QRCodeSVG
                value={techTerminalUrl}
                size={200}
                level="M"
                includeMargin={true}
              />
              <p className="text-[11px] font-bold text-slate-800 mt-2 text-center">
                Escanea con la cámara del móvil para abrir en /tecnico
              </p>
            </div>

            {gmapsMultiStopUrl && (
              <div className="p-3.5 rounded-2xl bg-sky-950/60 border border-sky-800/80 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-sky-400 flex items-center gap-1.5 uppercase">
                    <Navigation className="w-4 h-4" />
                    Ruta Multi-Parada Google Maps
                  </span>
                </div>
                <div className="flex gap-2">
                  <a
                    href={gmapsMultiStopUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-2.5 px-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-black text-xs flex items-center justify-center gap-1.5 transition"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Abrir Ruta Completa
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(gmapsMultiStopUrl);
                      setCopiedGmaps(true);
                      setTimeout(() => setCopiedGmaps(false), 2000);
                    }}
                    className="px-3 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold border border-slate-700"
                  >
                    {copiedGmaps ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-start gap-2 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <strong>Privacidad Cero-Fugas:</strong> Ningún dato de cliente viaja en el enlace ni en el código QR. El técnico ve solo su turno al abrir{" "}
                <code className="font-mono">/tecnico</code> con su sesión iniciada.
              </span>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  const text = encodeURIComponent(
                    `🛠️ Hoja de Ruta SATRuta (Turno #${
                      activeTrip?.tripNumber || 1
                    }):\n` +
                      `📋 ${activeTrip?.totalStops} avisos (${formatHoursMinutes(
                        activeTrip?.totalWorkdayMinutes || 0
                      )} est.).\n\n` +
                      `1️⃣ Abre la terminal de técnico:\n${techTerminalUrl}\n\n` +
                      (gmapsMultiStopUrl
                        ? `2️⃣ Google Maps Multi-Parada:\n${gmapsMultiStopUrl}`
                        : "")
                  );
                  window.open(`https://wa.me/?text=${text}`, "_blank");
                }}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs transition shadow-lg shadow-emerald-600/20"
              >
                <MessageCircle className="w-4 h-4" />
                Enviar por WhatsApp al Técnico
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(techTerminalUrl);
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 2000);
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs border border-slate-700"
                >
                  {copiedLink ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4 text-amber-400" />
                  )}
                  <span>
                    {copiedLink ? "¡Enlace Copiado!" : "Copiar Enlace /tecnico"}
                  </span>
                </button>

                <a
                  href={techTerminalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs border border-slate-700 flex items-center gap-1"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Probar</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL IMPRIMIBLE A4: CHECKLIST DE MATERIAL + PARTES DE TRABAJO */}
      {isPrintSheetOpen && activeTrip && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/90 backdrop-blur-sm p-3 sm:p-6 overflow-y-auto print:static print:inset-auto print:bg-white print:p-0 print:block">
          <div
            id="pelletgalicia-print-sheet"
            className="bg-white text-slate-950 rounded-2xl max-w-4xl w-full p-6 sm:p-8 shadow-2xl space-y-5 my-4 print:my-0 print:p-2 print:shadow-none print:rounded-none print:max-w-none"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-300 print:hidden">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-amber-500 text-slate-950 font-black">
                  <Printer className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-base text-slate-950">
                    Vista Previa A4: Hoja de Ruta SAT y Checklist de Material (Turno #{activeTrip.tripNumber})
                  </h3>
                  <p className="text-xs text-slate-600">
                    Diseñada para imprimir en 1 página A4 para el técnico en campo.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs shadow-md transition"
                >
                  <Printer className="w-4 h-4" />
                  <span>🖨️ Imprimir ahora (A4)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsPrintSheetOpen(false)}
                  className="px-3.5 py-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs transition"
                >
                  Cerrar
                </button>
              </div>
            </div>

            {/* CABECERA IMPRIMIBLE CON QR */}
            <div className="flex items-start justify-between gap-4 border-b-2 border-slate-900 pb-4">
              <div className="flex items-start gap-3">
                <img
                  src="/logo-gregorio.png"
                  alt="Ferretería Gregorio"
                  className="w-12 h-12 rounded-full object-cover shrink-0 border border-slate-300"
                />
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-black tracking-tight uppercase">
                      Ferretería Gregorio • Hoja de Ruta y Partes
                    </span>
                    <span className="px-2.5 py-0.5 rounded bg-slate-900 text-white font-black text-xs">
                      TURNO #{activeTrip.tripNumber}
                    </span>
                  </div>
                <p className="text-xs font-bold text-slate-700">
                  Fecha: {new Date().toLocaleDateString("es-ES")} • Salida:{" "}
                  {departureTime}h • Base: {config.warehouseName} (
                  {config.warehouseVillage})
                </p>
                <div className="flex flex-wrap items-center gap-4 text-xs font-bold pt-1 text-slate-900">
                  <span>
                    🔧 Avisos: <strong>{activeTrip.totalStops}</strong> (
                    {activeTrip.averiaCount} averías, {activeTrip.revisionCount}{" "}
                    rev.)
                  </span>
                  <span>
                    ⏱️ Jornada est.:{" "}
                    <strong>
                      {formatHoursMinutes(activeTrip.totalWorkdayMinutes)}
                    </strong>{" "}
                    ({activeTrip.estimatedDrivingMinutes}m volante +{" "}
                    {activeTrip.totalInterventionMinutes}m trabajo)
                  </span>
                  <span>
                    🛣️ Distancia: <strong>{activeTrip.totalDistanceKm} km</strong>
                  </span>
                </div>
                </div>
              </div>

              <div className="flex flex-col items-center border border-slate-400 rounded-xl p-2 bg-white shrink-0">
                <QRCodeSVG
                  value={techTerminalUrl}
                  size={88}
                  level="M"
                  includeMargin={false}
                />
                <span className="text-[9px] font-black uppercase text-slate-700 mt-1">
                  Escanear /tecnico
                </span>
              </div>
            </div>

            {/* BLOQUE 1: CHECKLIST DE MATERIAL Y EQUIPOS */}
            <div className="space-y-2">
              <div className="flex items-center justify-between bg-slate-900 text-white px-3 py-1.5 rounded-lg">
                <h4 className="text-xs font-black uppercase tracking-wider">
                  BLOQUE 1: Checklist de Material, Repuestos y Equipos a Cargar
                </h4>
                <span className="text-[10px] font-bold text-amber-300">
                  Verificar antes de salir del taller
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {activeTrip.orders.map((ord, idx) => {
                  const equip =
                    ord.equipmentInfo || ord.customer.equipmentInfo || "General";
                  const notes =
                    ord.technicalNotes || ord.customer.internalNotes || "";
                  return (
                    <div
                      key={`prep-${ord.id}`}
                      className="flex items-start justify-between border border-slate-400 rounded-lg px-3 py-1.5 bg-slate-50 gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-[10px] font-black uppercase text-slate-600">
                          [ ] Parada #{idx + 1} • {ord.serviceType}
                          {ord.priority === "Urgente" ? " (URGENTE)" : ""}
                        </div>
                        <div className="font-black text-slate-950 truncate">
                          {ord.customer.name} — ⚙️ {equip}
                        </div>
                        {notes && (
                          <div className="text-[10px] text-slate-700 italic">
                            🧰 {notes}
                          </div>
                        )}
                      </div>
                      <span className="font-mono font-black text-xs shrink-0">
                        {ord.estimatedMinutes}m
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* BLOQUE 2: TABLA SECUENCIAL DE PARTES */}
            <div className="space-y-2">
              <div className="flex items-center justify-between bg-slate-900 text-white px-3 py-1.5 rounded-lg">
                <h4 className="text-xs font-black uppercase tracking-wider">
                  BLOQUE 2: Tabla Secuencial de Intervenciones
                </h4>
                <span className="text-[10px] font-bold text-slate-300">
                  Marcar casilla [ ✓ ] al cerrar cada parte
                </span>
              </div>

              <table className="w-full border-collapse border border-slate-400 text-xs">
                <thead>
                  <tr className="bg-slate-200 text-slate-900 text-[11px] uppercase">
                    <th className="border border-slate-400 px-2 py-1.5 text-center w-10">
                      Ord
                    </th>
                    <th className="border border-slate-400 px-2 py-1.5 text-center w-14">
                      ETA
                    </th>
                    <th className="border border-slate-400 px-2 py-1.5 text-left w-24">
                      Tipo
                    </th>
                    <th className="border border-slate-400 px-2.5 py-1.5 text-left">
                      Cliente y Teléfono
                    </th>
                    <th className="border border-slate-400 px-2.5 py-1.5 text-left">
                      Ubicación / Equipo
                    </th>
                    <th className="border border-slate-400 px-2 py-1.5 text-right w-16">
                      Dur.
                    </th>
                    <th className="border border-slate-400 px-2 py-1.5 text-right w-24">
                      Presup.
                    </th>
                    <th className="border border-slate-400 px-2 py-1.5 text-center w-14">
                      Hecho
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activeTrip.orders.map((ord, idx) => {
                    const etaStr = stopEtasMap[ord.id] || "--:--";
                    const equip =
                      ord.equipmentInfo || ord.customer.equipmentInfo || "";
                    const { cashToCollectEur } = extractTechTagsFromNotes(
                      ord.technicalNotes || ord.customer.internalNotes,
                      ord.estimatedPriceEur
                    );
                    return (
                      <tr
                        key={`row-${ord.id}`}
                        className="border-b border-slate-300"
                      >
                        <td className="border border-slate-400 px-2 py-2 text-center font-black text-sm">
                          #{idx + 1}
                        </td>
                        <td className="border border-slate-400 px-2 py-2 text-center font-mono font-bold">
                          {etaStr}
                        </td>
                        <td className="border border-slate-400 px-2 py-2 font-bold">
                          {ord.serviceType}
                          {ord.priority === "Urgente" && (
                            <span className="block text-[9px] font-black text-rose-700 uppercase">
                              URGENTE
                            </span>
                          )}
                        </td>
                        <td className="border border-slate-400 px-2.5 py-2">
                          <div className="font-black text-slate-950">
                            {ord.customer.name}
                          </div>
                          {ord.customer.phone && (
                            <div className="text-[11px] font-mono text-slate-700">
                              📞 {ord.customer.phone}
                            </div>
                          )}
                        </td>
                        <td className="border border-slate-400 px-2.5 py-2">
                          <div className="font-bold text-slate-900">
                            {ord.customer.village}
                          </div>
                          {equip && (
                            <div className="text-[10px] font-semibold text-slate-700">
                              ⚙️ {equip}
                            </div>
                          )}
                        </td>
                        <td className="border border-slate-400 px-2 py-2 text-right font-mono font-bold">
                          {ord.estimatedMinutes}m
                        </td>
                        <td className="border border-slate-400 px-2 py-2 text-right font-mono font-black">
                          {cashToCollectEur > 0 ? (
                            <span>{cashToCollectEur.toFixed(2)} €</span>
                          ) : (
                            <span className="text-slate-500 text-[10px] font-normal">
                              Garantía / Cta.
                            </span>
                          )}
                        </td>
                        <td className="border border-slate-400 px-2 py-2 text-center font-mono text-base font-black">
                          [ &nbsp;&nbsp; ]
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between text-[10px] text-slate-600 pt-2 border-t border-slate-300">
              <span>SATRuta • Asistencia Técnica en Campo • Local-First</span>
              <span>
                Retorno a {config.warehouseName} ({activeTrip.returnLeg?.distanceKm || 0} km)
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
