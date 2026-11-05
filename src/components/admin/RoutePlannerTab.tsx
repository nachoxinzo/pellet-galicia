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
  PendingOrder,
  VanConfig,
  EphemeralStop,
  EphemeralTripPayload,
} from "@/types/pelletGalicia";
import {
  optimizeGaliciaRoutes,
  recalculateSingleTripMetricsSync,
  OptimizedGaliciaTrip,
  FuelOptimizationParams,
} from "@/utils/galiciaRoutingEngine";
import { fetchOsrmTripRoute, OsrmRouteGeometryResult } from "@/utils/osrmTableService";
import {
  encodeTripPayload,
  buildGoogleMapsMultiStopUrl,
  extractCashAndTagsFromNotes,
} from "@/utils/galiciaUrlCodec";
import { normalizePhoneDigits } from "@/services/galiciaStorage";
import { QRCodeSVG } from "qrcode.react";
import {
  Route as RouteIcon,
  Sparkles,
  Zap,
  MapPin,
  Clock,
  ArrowUpDown,
  GripVertical,
  QrCode,
  Share2,
  ExternalLink,
  Copy,
  Check,
  X,
  MessageCircle,
  Warehouse,
  CheckCircle2,
  Navigation,
  ShieldCheck,
  AlertTriangle,
  Fuel,
  Scale,
  Coins,
  Printer,
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
  orders: PendingOrder[];
  config: VanConfig;
  onMarkDelivered: (orderIds: string[]) => void;
}

export default function RoutePlannerTab({
  orders,
  config,
  onMarkDelivered,
}: RoutePlannerTabProps) {
  const pendingOrders = useMemo(
    () => orders.filter((o) => o.status === "Pendiente"),
    [orders]
  );

  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [trips, setTrips] = useState<OptimizedGaliciaTrip[]>([]);
  const [activeTripIdx, setActiveTripIdx] = useState<number>(0);
  const [osrmRouteData, setOsrmRouteData] = useState<OsrmRouteGeometryResult | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [interRouteSwaps, setInterRouteSwaps] = useState<number>(0);

  const fuelParams: FuelOptimizationParams = useMemo(
    () => ({
      consumoVacioL100: config.consumoVacioL100 ?? 8.5,
      extraConsumoPorTonelada: config.extraConsumoPorTonelada ?? 2.2,
      precioCombustible: config.precioCombustible ?? 1.55,
    }),
    [
      config.consumoVacioL100,
      config.extraConsumoPorTonelada,
      config.precioCombustible,
    ]
  );

  // Modal QR / Compartir e Impresión A4
  const [isQrOpen, setIsQrOpen] = useState(false);
  const [isPrintSheetOpen, setIsPrintSheetOpen] = useState(false);
  const [sharePayloadStr, setSharePayloadStr] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedGmaps, setCopiedGmaps] = useState(false);
  const [departureTime, setDepartureTime] = useState<string>("09:00");

  // Inicializar selección con los pedidos pendientes
  useEffect(() => {
    if (pendingOrders.length > 0 && selectedOrderIds.length === 0) {
      setSelectedOrderIds(pendingOrders.map((o) => o.id));
    }
  }, [pendingOrders]);

  // MOTOR OSRM + CLARKE-WRIGHT CVRP + PESO DINÁMICO: Optimizar para mínimo consumo
  const handleOptimize = async () => {
    const selectedOrders = selectedOrderIds
      .map((id) => orders.find((o) => o.id === id))
      .filter((o): o is PendingOrder => Boolean(o));

    if (selectedOrders.length === 0) {
      setTrips([]);
      setInterRouteSwaps(0);
      return;
    }

    setIsOptimizing(true);
    try {
      const res = await optimizeGaliciaRoutes(
        selectedOrders,
        config.warehouseCoordinates,
        config.vanCapacitySacks,
        fuelParams
      );

      setTrips(res.trips);
      setInterRouteSwaps(res.interRouteSwapsApplied);
      setActiveTripIdx(0);
    } catch (err) {
      console.error("Error optimizando:", err);
    } finally {
      setIsOptimizing(false);
    }
  };

  useEffect(() => {
    handleOptimize();
  }, [
    selectedOrderIds,
    orders,
    config.vanCapacitySacks,
    config.warehouseCoordinates,
    fuelParams,
  ]);

  const activeTrip = trips[activeTripIdx] || trips[0] || null;

  // Resumen global de eficiencia de combustible sumando todos los viajes
  const globalFuelSummary = useMemo(() => {
    const totalKm = trips.reduce((s, t) => s + (t.totalDistanceKm || 0), 0);
    const totalMinutes = trips.reduce(
      (s, t) => s + (t.estimatedDrivingMinutes || 0),
      0
    );
    const baseLiters = trips.reduce((s, t) => s + (t.baseFuelLiters || 0), 0);
    const weightExtraLiters = trips.reduce(
      (s, t) => s + (t.weightExtraFuelLiters || 0),
      0
    );
    const totalLiters = trips.reduce((s, t) => s + (t.totalFuelLiters || 0), 0);
    const savedHeavyFirstLiters = trips.reduce(
      (s, t) => s + (t.heavyFirstSavedLiters || 0),
      0
    );
    const totalCostEur = totalLiters * fuelParams.precioCombustible;
    const totalSacksInTrips = trips.reduce((s, t) => s + t.totalSacks, 0);
    const avgCostPerSack =
      totalSacksInTrips > 0 ? totalCostEur / totalSacksInTrips : 0;
    const highCostTrips = trips.filter((t) => t.isHighCostPerSack);

    return {
      totalKm: Number(totalKm.toFixed(1)),
      totalMinutes,
      baseLiters: Number(baseLiters.toFixed(2)),
      weightExtraLiters: Number(weightExtraLiters.toFixed(2)),
      totalLiters: Number(totalLiters.toFixed(2)),
      savedHeavyFirstLiters: Number(savedHeavyFirstLiters.toFixed(2)),
      totalCostEur: Number(totalCostEur.toFixed(2)),
      baseCostEur: Number((baseLiters * fuelParams.precioCombustible).toFixed(2)),
      weightExtraCostEur: Number(
        (weightExtraLiters * fuelParams.precioCombustible).toFixed(2)
      ),
      avgCostPerSack: Number(avgCostPerSack.toFixed(2)),
      highCostTrips,
    };
  }, [trips, fuelParams]);

  // Actualizar polilínea OSRM
  useEffect(() => {
    if (!activeTrip || activeTrip.orders.length === 0) {
      setOsrmRouteData(null);
      return;
    }

    let active = true;
    const coords = [
      config.warehouseCoordinates,
      ...activeTrip.orders.map((o: PendingOrder) => o.customer.coordinates),
      config.warehouseCoordinates,
    ];

    fetchOsrmTripRoute(coords).then((res) => {
      if (active) setOsrmRouteData(res);
    });

    return () => {
      active = false;
    };
  }, [activeTrip, config.warehouseCoordinates]);

  // Drag & drop (recalcula al instante el consumo con el nuevo orden de peso dinámico)
  const handleDragEnd = (result: DropResult) => {
    if (!result.destination || !activeTrip) return;
    const from = result.source.index;
    const to = result.destination.index;
    if (from === to) return;

    const copy = Array.from(activeTrip.orders);
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);

    const recalculated = recalculateSingleTripMetricsSync(
      copy,
      activeTrip.tripNumber,
      config.warehouseCoordinates,
      config.vanCapacitySacks,
      fuelParams
    );

    const updated = [...trips];
    updated[activeTripIdx] = recalculated;
    setTrips(updated);
  };

  // Invertir sentido (recalcula al instante el consumo en sentido inverso)
  const handleInvertRoute = () => {
    if (!activeTrip || activeTrip.orders.length <= 1) return;
    const reversed = [...activeTrip.orders].reverse();
    const recalculated = recalculateSingleTripMetricsSync(
      reversed,
      activeTrip.tripNumber,
      config.warehouseCoordinates,
      config.vanCapacitySacks,
      fuelParams
    );
    const updated = [...trips];
    updated[activeTripIdx] = recalculated;
    setTrips(updated);
  };

  // Construir payload ultracompacto para el viaje activo
  const activeTripEncodedPayload = useMemo(() => {
    if (!activeTrip || activeTrip.orders.length === 0) return "";
    const ephemeralStops: EphemeralStop[] = activeTrip.orders.map((ord, i) => {
      const { cashToCollectEur, tags } = extractCashAndTagsFromNotes(
        ord.orderNotes || ord.customer.internalNotes
      );
      return {
        seq: i + 1,
        id: `eph-${ord.id}`,
        name: ord.customer.name,
        village: ord.customer.village,
        lat: ord.customer.coordinates.lat,
        lng: ord.customer.coordinates.lng,
        sacks: ord.sacks,
        totalWeightKg: ord.totalWeightKg,
        cashToCollectEur,
        tags,
      };
    });

    const payload: EphemeralTripPayload = {
      v: "1.0",
      tripNum: activeTrip.tripNumber,
      date: new Date().toISOString().split("T")[0],
      warehouse: {
        name: config.warehouseName,
        lat: config.warehouseCoordinates.lat,
        lng: config.warehouseCoordinates.lng,
      },
      stops: ephemeralStops,
    };

    return encodeTripPayload(payload);
  }, [activeTrip, config.warehouseName, config.warehouseCoordinates]);

  // Calcular ETAs por parada: Hora de salida + tiempo de conducción acumulado + 12 min por parada anterior
  const stopEtasMap = useMemo(() => {
    if (!activeTrip || activeTrip.orders.length === 0) return {} as Record<string, string>;
    const [hoursStr, minsStr] = (departureTime || "09:00").split(":");
    const startMinutes =
      (parseInt(hoursStr, 10) || 9) * 60 + (parseInt(minsStr, 10) || 0);

    let cumulativeDriving = 0;
    const map: Record<string, string> = {};

    activeTrip.orders.forEach((ord, idx) => {
      const leg = activeTrip.legDetails?.[idx];
      const legDrive = leg?.drivingMinutesFromPrev ?? 12;
      cumulativeDriving += legDrive;
      const unloadMinutesBefore = idx * 12;
      const arrivalTotalMins =
        (startMinutes + cumulativeDriving + unloadMinutesBefore) % (24 * 60);
      const hh = String(Math.floor(arrivalTotalMins / 60)).padStart(2, "0");
      const mm = String(Math.round(arrivalTotalMins % 60)).padStart(2, "0");
      map[ord.id] = `${hh}:${mm}`;
    });

    return map;
  }, [activeTrip, departureTime]);

  // Generar Hoja de Reparto / Enlace / QR
  const handleGenerateDispatch = () => {
    if (!activeTrip || activeTrip.orders.length === 0) return;
    setSharePayloadStr(activeTripEncodedPayload);
    setIsQrOpen(true);
  };

  // Abrir e imprimir Hoja de Carga y Ruta A4
  const handleOpenPrintSheet = () => {
    if (!activeTrip || activeTrip.orders.length === 0) return;
    setSharePayloadStr(activeTripEncodedPayload);
    setIsPrintSheetOpen(true);
  };

  // Avisar ETA al cliente por WhatsApp
  const handleNotifyCustomerWhatsApp = (ord: PendingOrder, etaStr: string) => {
    const rawDigits = normalizePhoneDigits(ord.customer.phone);
    const phoneWithPrefix =
      rawDigits.length === 9
        ? `34${rawDigits}`
        : rawDigits.startsWith("34")
        ? rawDigits
        : rawDigits;
    const message = `Hola ${ord.customer.name}, hoy pasamos a entregarte tu pedido de ${ord.sacks} sacos de pellets. Calculamos llegar aproximadamente sobre las ${etaStr}. ¡Un saludo!`;
    const waUrl = phoneWithPrefix
      ? `https://wa.me/${phoneWithPrefix}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(waUrl, "_blank");
  };

  const handleMarkActiveTripDelivered = () => {
    if (!activeTrip) return;
    const ids = activeTrip.orders.map((o) => o.id);
    onMarkDelivered(ids);
    setSelectedOrderIds((prev) => prev.filter((id) => !ids.includes(id)));
  };

  const toggleSelectOrder = (id: string) => {
    setSelectedOrderIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  // Total de sacos seleccionados vs capacidad
  const selectedSacksTotal = useMemo(() => {
    return selectedOrderIds
      .map((id) => orders.find((o) => o.id === id))
      .filter(Boolean)
      .reduce((sum, o) => sum + (o?.sacks || 0), 0);
  }, [selectedOrderIds, orders]);

  const occupancyPercent = Math.round(
    (selectedSacksTotal / config.vanCapacitySacks) * 100
  );

  // Mapear para Leaflet
  const mapPendingOrders = useMemo(() => {
    return pendingOrders.map((o) => ({
      id: o.id,
      clientId: o.customerId,
      client: {
        id: o.customer.id,
        name: o.customer.name,
        phone: o.customer.phone || "",
        address: o.customer.village,
        coordinates: o.customer.coordinates,
        unloadingNotes: o.orderNotes || "",
        preferredTimeWindow: "Mañana" as const,
        createdAt: o.createdAt,
        updatedAt: o.createdAt,
      },
      pallets: 0,
      looseSacks: o.sacks,
      totalSacksCount: o.sacks,
      totalWeightKg: o.totalWeightKg,
      equivalentPallets: o.sacks / 70,
      status: "Pendiente" as const,
      createdAt: o.createdAt,
      updatedAt: o.createdAt,
    }));
  }, [pendingOrders]);

  const mapSelectedOrders = useMemo(() => {
    if (!activeTrip) return [];
    return activeTrip.orders.map((o) => ({
      id: o.id,
      clientId: o.customerId,
      client: {
        id: o.customer.id,
        name: o.customer.name,
        phone: o.customer.phone || "",
        address: o.customer.village,
        coordinates: o.customer.coordinates,
        unloadingNotes: o.orderNotes || "",
        preferredTimeWindow: "Mañana" as const,
        createdAt: o.createdAt,
        updatedAt: o.createdAt,
      },
      pallets: 0,
      looseSacks: o.sacks,
      totalSacksCount: o.sacks,
      totalWeightKg: o.totalWeightKg,
      equivalentPallets: o.sacks / 70,
      status: "Pendiente" as const,
      createdAt: o.createdAt,
      updatedAt: o.createdAt,
    }));
  }, [activeTrip]);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const effectivePayload = sharePayloadStr || activeTripEncodedPayload;
  const deliveryRepartoUrl = `${baseUrl}/reparto?r=${effectivePayload}`;
  const gmapsMultiStopUrl = activeTrip
    ? buildGoogleMapsMultiStopUrl(
        config.warehouseCoordinates,
        config.warehouseCoordinates,
        activeTrip.orders.map((o) => o.customer.coordinates)
      )
    : "";

  return (
    <div className="space-y-6">
      {/* BARRA DE PROGRESO DE OCUPACIÓN DEL FURGÓN */}
      <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl shadow-xl space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-bold">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 uppercase tracking-wider">
              Ocupación del Furgón para hoy:
            </span>
            <span className="text-white font-mono text-sm">
              {selectedSacksTotal} / {config.vanCapacitySacks} sacos ({selectedSacksTotal * 15} kg)
            </span>
          </div>

          <span
            className={`px-3 py-1 rounded-full text-xs font-black ${
              occupancyPercent > 100
                ? "bg-red-500/20 text-red-400 border border-red-500/30"
                : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
            }`}
          >
            {occupancyPercent}% de capacidad {occupancyPercent > 100 && `(Requiere ${trips.length} viajes)`}
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
              Trazado OSRM por Carreteras Rurales (Galicia)
            </h2>
            <p className="text-xs text-slate-400">
              Salida y retorno a {config.warehouseName}. Tiempos reales por carreteras secundarias.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            {osrmRouteData && (
              <div className="flex items-center gap-3 bg-slate-950 px-4 py-2 rounded-2xl border border-slate-800 text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Carretera</span>
                  <span className="font-black text-amber-400 text-sm">{osrmRouteData.distanceKm} km</span>
                </div>
                <div className="h-6 w-px bg-slate-800"></div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Volante</span>
                  <span className="font-black text-white text-sm">
                    {activeTrip?.estimatedDrivingMinutes || osrmRouteData.durationMinutes} min
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
              <Fuel className="w-4 h-4" />
              <span>
                {isOptimizing
                  ? "Calculando Clarke-Wright + Peso Dinámico..."
                  : "⛽ Optimizar para Mínimo Gasto de Combustible"}
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
          pendingOrders={mapPendingOrders}
          selectedOrders={mapSelectedOrders}
          onOrderClick={toggleSelectOrder}
          osrmPolyline={osrmRouteData?.polyline}
          height="400px"
        />
      </div>

      {/* 4. PANEL COMPARATIVO DE AHORRO DE GASOIL Y COSTE POR SACO (MULTI-VIAJE CVRP + PESO DINÁMICO) */}
      {trips.length > 0 && (
        <div className="bg-slate-900 border border-amber-500/40 p-5 rounded-3xl shadow-xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
                <Fuel className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-black uppercase tracking-wider text-white">
                    ⛽ Eficiencia de Combustible del Reparto (Clarke-Wright CVRP + Peso Dinámico)
                  </h3>
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    Heavy-First Activo
                  </span>
                  {interRouteSwaps > 0 && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30">
                      {interRouteSwaps} intercambios Inter-Ruta aplicados
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">
                  Parámetros: {fuelParams.consumoVacioL100} L/100km vacío • +
                  {fuelParams.extraConsumoPorTonelada} L/100km por tonelada • Diésel a{" "}
                  {fuelParams.precioCombustible.toFixed(2)} €/L
                </p>
              </div>
            </div>

            {globalFuelSummary.savedHeavyFirstLiters > 0.01 && (
              <div className="px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-1.5">
                <Scale className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  Ahorro por descargar peso pesado primero:{" "}
                  <strong>
                    -{globalFuelSummary.savedHeavyFirstLiters.toFixed(2)} L
                  </strong>{" "}
                  (
                  {(
                    globalFuelSummary.savedHeavyFirstLiters *
                    fuelParams.precioCombustible
                  ).toFixed(2)}{" "}
                  €)
                </span>
              </div>
            )}
          </div>

          {/* 4 KPIs Principales de Combustible y Coste */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {/* KPI 1: Número óptimo de viajes y llenado */}
            <div className="p-3.5 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-1.5">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">
                1. Viajes Óptimos y Llenado
              </span>
              <div className="text-lg font-black text-white">
                {trips.length} {trips.length === 1 ? "Viaje" : "Viajes"} necesarios
              </div>
              <div className="space-y-1 pt-0.5">
                {trips.map((t) => (
                  <div
                    key={t.tripNumber}
                    className="flex items-center justify-between text-[11px]"
                  >
                    <span className="text-slate-300 font-bold">
                      Viaje {t.tripNumber}:
                    </span>
                    <span
                      className={`font-mono font-black ${
                        t.occupancyPercent < 45
                          ? "text-amber-400"
                          : "text-emerald-400"
                      }`}
                    >
                      {t.totalSacks}/{config.vanCapacitySacks} sacos (
                      {t.occupancyPercent}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* KPI 2: Kilómetros totales sumando todos los viajes */}
            <div className="p-3.5 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-1.5">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">
                2. Kilómetros Totales (Con Retornos)
              </span>
              <div className="text-lg font-black text-amber-400">
                {globalFuelSummary.totalKm} km totales
              </div>
              <div className="text-[11px] text-slate-300">
                Tiempo total al volante:{" "}
                <strong className="text-white">
                  ~{globalFuelSummary.totalMinutes} min
                </strong>
              </div>
              <div className="text-[10px] text-slate-400">
                Incluye {trips.length}{" "}
                {trips.length === 1
                  ? "retorno en vacío al almacén"
                  : "retornos al almacén para recargar"}
              </div>
            </div>

            {/* KPI 3: Litros de Diésel y Coste en Euros (Desglose Base vs Peso) */}
            <div className="p-3.5 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-1.5">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">
                3. Gasoil Estimado y Desglose por Peso
              </span>
              <div className="text-lg font-black text-emerald-400">
                {globalFuelSummary.totalLiters.toFixed(2)} L ·{" "}
                {globalFuelSummary.totalCostEur.toFixed(2)} €
              </div>
              <div className="text-[11px] text-slate-300 space-y-0.5">
                <div className="flex justify-between">
                  <span className="text-slate-400">Rodaje base vacío:</span>
                  <span className="font-mono font-bold text-slate-200">
                    {globalFuelSummary.baseLiters.toFixed(2)} L (
                    {globalFuelSummary.baseCostEur.toFixed(2)} €)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Extra por peso sacos:</span>
                  <span className="font-mono font-bold text-amber-300">
                    +{globalFuelSummary.weightExtraLiters.toFixed(2)} L (+
                    {globalFuelSummary.weightExtraCostEur.toFixed(2)} €)
                  </span>
                </div>
              </div>
            </div>

            {/* KPI 4: Coste de gasoil por saco entregado */}
            <div
              className={`p-3.5 rounded-2xl border space-y-1.5 ${
                globalFuelSummary.highCostTrips.length > 0
                  ? "bg-amber-500/10 border-amber-500/60"
                  : "bg-slate-950/90 border-slate-800"
              }`}
            >
              <span className="text-[10px] font-bold uppercase text-slate-400 flex items-center justify-between">
                <span>4. Coste Gasoil por Saco</span>
                <Coins className="w-3.5 h-3.5 text-amber-400" />
              </span>
              <div className="text-lg font-black text-white">
                {globalFuelSummary.avgCostPerSack.toFixed(2)} €{" "}
                <span className="text-xs font-bold text-slate-400">
                  / saco entregado
                </span>
              </div>
              <div className="space-y-0.5 text-[11px]">
                {trips.map((t) => (
                  <div
                    key={t.tripNumber}
                    className="flex items-center justify-between"
                  >
                    <span className="text-slate-400">Viaje {t.tripNumber}:</span>
                    <span
                      className={`font-mono font-bold ${
                        t.isHighCostPerSack
                          ? "text-amber-400 font-black"
                          : "text-slate-200"
                      }`}
                    >
                      {t.costPerSackEur.toFixed(2)} €/saco ({t.totalFuelLiters} L)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Alerta en color ámbar si algún viaje queda con pocos sacos o muy lejos y dispara el coste por saco */}
          {globalFuelSummary.highCostTrips.length > 0 && (
            <div className="p-3.5 rounded-2xl bg-amber-500/15 border-2 border-amber-500/60 text-amber-200 text-xs space-y-1">
              <div className="font-black text-amber-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  ⚠️ Aviso de Rentabilidad de Combustible por Saco:
                </span>
              </div>
              {globalFuelSummary.highCostTrips.map((t) => (
                <p key={t.tripNumber} className="text-[11px] pl-6">
                  • <strong>Viaje #{t.tripNumber}:</strong>{" "}
                  {t.highCostWarningReason}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* PESTAÑAS DE VIAJES & ACCIONES */}
      {trips.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl shadow-xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-wider text-slate-300">
                Viajes del Furgón ({config.vanCapacitySacks} sacos máx.):
              </span>
              {trips.length > 1 && (
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Agrupado en {trips.length} viajes por Clarke-Wright Savings
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* BOTÓN INVERTIR SENTIDO */}
              <button
                type="button"
                onClick={handleInvertRoute}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs border border-slate-700 transition"
              >
                <ArrowUpDown className="w-3.5 h-3.5 text-amber-400" />
                <span>🔄 Invertir sentido de la ruta</span>
              </button>

              {/* BOTÓN IMPRIMIR HOJA DE CARGA / RUTA EN PAPEL A4 */}
              <button
                type="button"
                onClick={handleOpenPrintSheet}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-black text-xs border border-amber-500/40 transition"
                title="Imprimir Hoja de Carga LIFO + Tabla de Ruta en A4"
              >
                <Printer className="w-3.5 h-3.5 text-amber-400" />
                <span>🖨️ Imprimir Hoja de Carga / Ruta</span>
              </button>

              {/* BOTÓN ENVIAR RUTA AL REPARTIDOR */}
              <button
                type="button"
                onClick={handleGenerateDispatch}
                className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-black text-xs transition shadow-lg shadow-amber-600/25"
              >
                <QrCode className="w-4 h-4" />
                <span>📲 Enviar Ruta al Repartidor</span>
              </button>

              {/* BOTÓN MARCAR COMO ENTREGADO */}
              <button
                type="button"
                onClick={handleMarkActiveTripDelivered}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition shadow-md shadow-emerald-600/20"
                title="Marcar viaje como entregado y descontar de pendientes"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Marcar Entregado</span>
              </button>
            </div>
          </div>

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
                  <span>Viaje #{t.tripNumber}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] ${
                      isActive ? "bg-slate-950 text-amber-400" : "bg-slate-900 text-slate-400"
                    }`}
                  >
                    {t.totalSacks}/{config.vanCapacitySacks} sacos ({t.occupancyPercent}%) •{" "}
                    {t.totalDistanceKm} km • {t.totalFuelLiters} L ({t.totalFuelCostEur} €)
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* PARADAS REORDENABLES (DRAG & DROP) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Columna Izquierda: Pedidos Disponibles */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-3 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-300">
              Pedidos Disponibles ({pendingOrders.length})
            </h3>
            <span className="text-[11px] text-slate-400">
              {selectedOrderIds.length} seleccionados
            </span>
          </div>

          <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
            {pendingOrders.length === 0 ? (
              <div className="p-6 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-2xl space-y-1">
                <p className="font-bold text-slate-400">No hay pedidos pendientes</p>
                <p className="text-[11px]">Ve a la pestaña &apos;Pedidos y Clientes&apos; para añadir tus propios clientes y pedidos.</p>
              </div>
            ) : (
              pendingOrders.map((ord) => {
                const isSelected = selectedOrderIds.includes(ord.id);
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
                    <div className="space-y-0.5">
                      <div className="font-bold text-white">{ord.customer.name}</div>
                      <div className="text-[11px] text-slate-400 line-clamp-1">{ord.customer.village}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-black text-amber-400">{ord.sacks} sacos</span>
                      <div className="text-[10px] text-slate-400">{ord.totalWeightKg} kg</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Columna Derecha: Paradas Ordenadas con Peso Dinámico por Tramo */}
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-4 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-white">
                Secuencia de Entrega Optimizada por Peso (Viaje #{activeTrip?.tripNumber || 1})
              </h3>
              <p className="text-[11px] text-slate-400">
                Descarga primero los pedidos más pesados para rodar ligero. Arrastra para reordenar.
              </p>
            </div>
            {activeTrip && (
              <div className="text-right text-[11px] font-mono">
                <span className="text-emerald-400 font-black">
                  {activeTrip.totalFuelLiters} L ({activeTrip.totalFuelCostEur} €)
                </span>
                <span className="text-slate-400 block">
                  {activeTrip.costPerSackEur.toFixed(2)} € gasoil / saco
                </span>
              </div>
            )}
          </div>

          <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-white">
            <div className="flex items-center gap-2">
              <Warehouse className="w-4 h-4 text-amber-400" />
              <span>
                Salida: {config.warehouseName} (Carga inicial:{" "}
                {activeTrip?.totalSacks || 0} sacos ·{" "}
                {activeTrip?.totalWeightKg || 0} kg)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-slate-400 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>Hora de Salida del Almacén:</span>
              </label>
              <input
                type="time"
                value={departureTime}
                onChange={(e) => setDepartureTime(e.target.value || "09:00")}
                className="px-2.5 py-1 rounded-xl bg-slate-900 border border-amber-500/40 text-amber-400 font-mono text-xs font-black outline-none focus:border-amber-400"
              />
            </div>
          </div>

          {!activeTrip || activeTrip.orders.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-2xl">
              Selecciona pedidos en la columna izquierda para trazar el viaje.
            </div>
          ) : (
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="van-galicia-stops">
                {(provided) => (
                  <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2.5">
                    {activeTrip.orders.map((ord: PendingOrder, idx: number) => {
                      const leg = activeTrip.legDetails?.[idx];
                      const etaStr = stopEtasMap[ord.id] || "09:30";
                      const { cashToCollectEur, tags } =
                        extractCashAndTagsFromNotes(
                          ord.orderNotes || ord.customer.internalNotes
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
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-extrabold truncate">
                                      {ord.customer.name}
                                    </span>
                                    <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono text-[10px] font-black">
                                      🕒 ETA ~{etaStr}
                                    </span>
                                    {cashToCollectEur > 0 && (
                                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono text-[10px] font-black">
                                        💵 Cobrar {cashToCollectEur} €
                                      </span>
                                    )}
                                    {tags && (
                                      <span className="px-1.5 py-0.5 rounded bg-slate-900 text-slate-200 border border-slate-700 text-[10px]">
                                        {tags}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-400 line-clamp-1">
                                    📍 {ord.customer.village}
                                    {ord.customer.phone && (
                                      <span className="ml-2 text-slate-300 font-mono">
                                        • 📞 {ord.customer.phone}
                                      </span>
                                    )}
                                  </div>
                                  {leg && (
                                    <div className="flex flex-wrap items-center gap-2 text-[10px] pt-0.5">
                                      <span className="px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-700 font-mono">
                                        Tramo: {leg.distanceFromPrevKm} km (~{leg.drivingMinutesFromPrev} min)
                                      </span>
                                      <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 font-mono">
                                        Peso en furgón: {leg.carriedWeightKgBeforeUnload} kg ({leg.carriedSacksBeforeUnload} sacos)
                                      </span>
                                      <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-mono font-bold">
                                        ⛽ {leg.legFuelLiters} L ({leg.legFuelCostEur} €)
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 shrink-0 pl-9 sm:pl-0">
                                <div className="text-right">
                                  <div className="font-black text-amber-400">-{ord.sacks} sacos</div>
                                  <div className="text-[10px] text-slate-400">-{ord.totalWeightKg} kg</div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleNotifyCustomerWhatsApp(ord, etaStr)
                                  }
                                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/40 font-black text-[10px] transition"
                                  title={`Enviar aviso de llegada estimada (${etaStr}) por WhatsApp a ${ord.customer.name}`}
                                >
                                  <MessageCircle className="w-3.5 h-3.5" />
                                  <span>💬 Avisar ETA por WhatsApp</span>
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
              <Warehouse className="w-4 h-4 text-slate-500" />
              <span>
                Retorno en vacío (0 kg): {config.warehouseName}
              </span>
            </div>
            {activeTrip?.returnLeg ? (
              <span className="text-[11px] font-mono text-emerald-400">
                {activeTrip.returnLeg.distanceKm} km • ⛽{" "}
                {activeTrip.returnLeg.fuelLiters} L (
                {activeTrip.returnLeg.fuelCostEur} €)
              </span>
            ) : (
              <span className="text-[11px]">Fin de viaje</span>
            )}
          </div>
        </div>
      </div>

      {/* MODAL DE ENVÍO CON CÓDIGO QR Y ENLACE EFÍMERO */}
      {isQrOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 text-white shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150 my-6 max-h-[94vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
                  <QrCode className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-base">Hoja de Reparto Efímera</h3>
                  <p className="text-xs text-slate-400">
                    Viaje #{activeTrip?.tripNumber || 1} • {activeTrip?.orders.length} paradas • {activeTrip?.totalSacks} sacos
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

            {/* CÓDIGO QR EN PANTALLA */}
            <div className="flex flex-col items-center justify-center p-5 bg-white rounded-2xl shadow-inner">
              <QRCodeSVG
                value={deliveryRepartoUrl}
                size={200}
                level="M"
                includeMargin={true}
              />
              <p className="text-[11px] font-bold text-slate-800 mt-2 text-center">
                Escanea con la cámara del móvil para abrir en /reparto
              </p>
            </div>

            {/* ENLACE DIRECTO GOOGLE MAPS MULTI-PARADA */}
            {gmapsMultiStopUrl && (
              <div className="p-3.5 rounded-2xl bg-sky-950/60 border border-sky-800/80 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-sky-400 flex items-center gap-1.5 uppercase">
                    <Navigation className="w-4 h-4" />
                    Ruta Multi-Parada Google Maps
                  </span>
                  <span className="text-[10px] text-sky-300 bg-sky-900/60 px-2 py-0.5 rounded-full font-bold">
                    Nativo
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
                    {copiedGmaps ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-start gap-2 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <strong>Zero-Cloud:</strong> Los datos viajan comprimidos en el enlace. El repartidor los destruirá de su memoria tras cada entrega.
              </span>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  const text = encodeURIComponent(
                    `🚛 Hoja de Reparto PelletGalicia (Viaje #${activeTrip?.tripNumber || 1}):\n` +
                    `📦 ${activeTrip?.orders.length} paradas (${activeTrip?.totalSacks} sacos).\n\n` +
                    `1️⃣ Abre la app efímera:\n${deliveryRepartoUrl}\n\n` +
                    (gmapsMultiStopUrl ? `2️⃣ Google Maps Multi-Parada:\n${gmapsMultiStopUrl}` : "")
                  );
                  window.open(`https://wa.me/?text=${text}`, "_blank");
                }}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs transition shadow-lg shadow-emerald-600/20"
              >
                <MessageCircle className="w-4 h-4" />
                Enviar por WhatsApp al Repartidor
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(deliveryRepartoUrl);
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 2000);
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs border border-slate-700"
                >
                  {copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-amber-400" />}
                  <span>{copiedLink ? "¡Enlace Copiado!" : "Copiar Enlace /reparto"}</span>
                </button>

                <a
                  href={deliveryRepartoUrl}
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

      {/* 3. MODAL IMPRIMIBLE A4: HOJA DE CARGA (LIFO) Y RUTA EN PAPEL */}
      {isPrintSheetOpen && activeTrip && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/90 backdrop-blur-sm p-3 sm:p-6 overflow-y-auto print:static print:inset-auto print:bg-white print:p-0 print:block">
          <div
            id="pelletgalicia-print-sheet"
            className="bg-white text-slate-950 rounded-2xl max-w-4xl w-full p-6 sm:p-8 shadow-2xl space-y-5 my-4 print:my-0 print:p-2 print:shadow-none print:rounded-none print:max-w-none"
          >
            {/* Barra de controles superior (Oculta al imprimir) */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-300 print:hidden">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-amber-500 text-slate-950 font-black">
                  <Printer className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-base text-slate-950">
                    Vista Previa A4: Hoja de Carga LIFO y Ruta (Viaje #{activeTrip.tripNumber})
                  </h3>
                  <p className="text-xs text-slate-600">
                    Diseñada para imprimirse en 1 sola página A4 para el salpicadero del furgón.
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

            {/* CABECERA IMPRIMIBLE CON QR EN LA ESQUINA */}
            <div className="flex items-start justify-between gap-4 border-b-2 border-slate-900 pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xl font-black tracking-tight uppercase">
                    PelletGalicia • Hoja de Carga y Ruta
                  </span>
                  <span className="px-2.5 py-0.5 rounded bg-slate-900 text-white font-black text-xs">
                    VIAJE #{activeTrip.tripNumber}
                  </span>
                </div>
                <p className="text-xs font-bold text-slate-700">
                  Fecha: {new Date().toLocaleDateString("es-ES")} • Hora Salida:{" "}
                  {departureTime}h • Base: {config.warehouseName} ({config.warehouseVillage})
                </p>
                <div className="flex flex-wrap items-center gap-4 text-xs font-bold pt-1 text-slate-900">
                  <span>
                    📦 Carga Total: <strong>{activeTrip.totalSacks} sacos</strong> ({activeTrip.totalWeightKg} kg / {config.vanCapacitySacks} máx.)
                  </span>
                  <span>
                    🛣️ Distancia: <strong>{activeTrip.totalDistanceKm} km</strong> (~{activeTrip.estimatedDrivingMinutes} min volante)
                  </span>
                  <span>
                    ⛽ Gasoil est.: <strong>{activeTrip.totalFuelLiters} L</strong> ({activeTrip.totalFuelCostEur} €)
                  </span>
                </div>
              </div>

              {/* QR IMPRESO EN LA ESQUINA PARA ESCANEAR DESDE EL PAPEL */}
              <div className="flex flex-col items-center border border-slate-400 rounded-xl p-2 bg-white shrink-0">
                <QRCodeSVG
                  value={deliveryRepartoUrl}
                  size={88}
                  level="M"
                  includeMargin={false}
                />
                <span className="text-[9px] font-black uppercase text-slate-700 mt-1">
                  Escanear /reparto
                </span>
              </div>
            </div>

            {/* BLOQUE 1: INSTRUCCIONES DE CARGA EN ALMACÉN (ORDEN INVERSO LIFO) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between bg-slate-900 text-white px-3 py-1.5 rounded-lg">
                <h4 className="text-xs font-black uppercase tracking-wider">
                  BLOQUE 1: Instrucciones de Carga en Almacén (Orden Inverso LIFO: del fondo a la puerta)
                </h4>
                <span className="text-[10px] font-bold text-amber-300">
                  Cargar primero el último cliente para que el 1º quede junto a la puerta
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {[...activeTrip.orders].reverse().map((ord, revIdx) => {
                  const totalStops = activeTrip.orders.length;
                  const deliveryOrderNum = totalStops - revIdx;
                  const positionLabel =
                    revIdx === 0
                      ? "FONDO DEL FURGÓN (Cargar 1º)"
                      : revIdx === totalStops - 1
                      ? "JUNTO A LA PUERTA (Cargar Último)"
                      : `Posición de carga #${revIdx + 1}`;
                  return (
                    <div
                      key={`lifo-${ord.id}`}
                      className="flex items-center justify-between border border-slate-400 rounded-lg px-3 py-1.5 bg-slate-50"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="text-[10px] font-black uppercase text-slate-600">
                          {positionLabel} → Parada #{deliveryOrderNum}
                        </div>
                        <div className="font-black text-slate-950 truncate">
                          {ord.customer.name} ({ord.customer.village})
                        </div>
                      </div>
                      <div className="text-right shrink-0 font-mono">
                        <span className="text-sm font-black text-slate-950">
                          {ord.sacks} sacos
                        </span>
                        <span className="block text-[10px] text-slate-600">
                          {ord.totalWeightKg} kg
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* BLOQUE 2: TABLA SECUENCIAL DE PARADAS CON CASILLA DE VERIFICACIÓN */}
            <div className="space-y-2">
              <div className="flex items-center justify-between bg-slate-900 text-white px-3 py-1.5 rounded-lg">
                <h4 className="text-xs font-black uppercase tracking-wider">
                  BLOQUE 2: Tabla Secuencial de Paradas de Reparto
                </h4>
                <span className="text-[10px] font-bold text-slate-300">
                  Marcar casilla [ ✓ ] a bolígrafo al entregar cada pedido
                </span>
              </div>

              <table className="w-full border-collapse border border-slate-400 text-xs">
                <thead>
                  <tr className="bg-slate-200 text-slate-900 text-[11px] uppercase">
                    <th className="border border-slate-400 px-2 py-1.5 text-center w-12">
                      Orden
                    </th>
                    <th className="border border-slate-400 px-2 py-1.5 text-center w-16">
                      ETA
                    </th>
                    <th className="border border-slate-400 px-2.5 py-1.5 text-left">
                      Cliente y Teléfono
                    </th>
                    <th className="border border-slate-400 px-2.5 py-1.5 text-left">
                      Aldea / Dirección y Notas
                    </th>
                    <th className="border border-slate-400 px-2 py-1.5 text-right w-24">
                      Sacos
                    </th>
                    <th className="border border-slate-400 px-2 py-1.5 text-right w-28">
                      Cobrar Efectivo
                    </th>
                    <th className="border border-slate-400 px-2 py-1.5 text-center w-16">
                      Entregado
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activeTrip.orders.map((ord, idx) => {
                    const etaStr = stopEtasMap[ord.id] || "--:--";
                    const { cashToCollectEur, tags } =
                      extractCashAndTagsFromNotes(
                        ord.orderNotes || ord.customer.internalNotes
                      );
                    const notesText =
                      ord.orderNotes || ord.customer.internalNotes || "";
                    return (
                      <tr key={`row-${ord.id}`} className="border-b border-slate-300">
                        <td className="border border-slate-400 px-2 py-2 text-center font-black text-sm">
                          #{idx + 1}
                        </td>
                        <td className="border border-slate-400 px-2 py-2 text-center font-mono font-bold">
                          {etaStr}
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
                          {(notesText || tags) && (
                            <div className="text-[10px] text-slate-700 italic">
                              {tags ? `${tags} ` : ""}
                              {notesText}
                            </div>
                          )}
                        </td>
                        <td className="border border-slate-400 px-2 py-2 text-right font-mono">
                          <div className="font-black text-sm text-slate-950">
                            {ord.sacks} sacos
                          </div>
                          <div className="text-[10px] text-slate-600">
                            {ord.totalWeightKg} kg
                          </div>
                        </td>
                        <td className="border border-slate-400 px-2 py-2 text-right font-mono font-black">
                          {cashToCollectEur > 0 ? (
                            <span className="text-slate-950">
                              {cashToCollectEur.toFixed(2)} €
                            </span>
                          ) : (
                            <span className="text-slate-500 text-[11px] font-normal">
                              Pagado / Cta.
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
              <span>
                PelletGalicia • Sistema de Reparto Local-First & Zero-Cloud
              </span>
              <span>
                Retorno a {config.warehouseName} ({activeTrip.returnLeg?.distanceKm || 0} km en vacío)
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
