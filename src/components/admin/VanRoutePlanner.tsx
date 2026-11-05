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
  VanOrder,
  VanSettings,
  EphemeralDeliveryStop,
} from "@/types/pelletVan";
import {
  optimizeGaliciaRoutes,
  OptimizedGaliciaTrip,
} from "@/utils/galiciaRoutingEngine";
import { fetchOsrmTripRoute, OsrmRouteGeometryResult } from "@/utils/osrmTableService";
import { optimizeWithOsrmTripApi } from "@/utils/osrmTripOptimizer";
import { generateGoogleMapsMultiStopUrl } from "@/utils/googleMapsMultiStop";
import { encodeRouteForDelivery } from "@/utils/ephemeralTransfer";
import QrShareModal from "@/components/admin/QrShareModal";
import {
  Route as RouteIcon,
  Truck,
  Sparkles,
  MapPin,
  Clock,
  Layers,
  Scale,
  GripVertical,
  QrCode,
  Share2,
  AlertTriangle,
  Warehouse,
  CheckCircle2,
  Navigation,
  ArrowUpDown,
  RotateCcw,
  Zap,
  Timer,
  Check,
  Compass,
} from "lucide-react";

// Cargar dinámicamente el mapa de Leaflet
const DeliveryRouteMap = dynamic(
  () => import("@/components/map/DeliveryRouteMap"),
  {
    ssr: false,
    loading: () => (
      <div className="h-[400px] w-full bg-slate-900 rounded-2xl flex items-center justify-center text-slate-500 text-xs animate-pulse border border-slate-800">
        Cargando trazado OSRM por carretera...
      </div>
    ),
  }
);

interface VanRoutePlannerProps {
  orders: VanOrder[];
  settings: VanSettings;
}

export default function VanRoutePlanner({
  orders,
  settings,
}: VanRoutePlannerProps) {
  const pendingOrders = useMemo(
    () => orders.filter((o) => o.status === "Pendiente"),
    [orders]
  );

  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [trips, setTrips] = useState<OptimizedGaliciaTrip[]>([]);
  const [activeTripIdx, setActiveTripIdx] = useState<number>(0);
  const [osrmRouteData, setOsrmRouteData] = useState<OsrmRouteGeometryResult | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);

  // Modal QR / Compartir
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [encodedPayload, setEncodedPayload] = useState("");

  // Inicializar selección con los pedidos pendientes
  useEffect(() => {
    if (pendingOrders.length > 0 && selectedOrderIds.length === 0) {
      setSelectedOrderIds(pendingOrders.map((o) => o.id));
    }
  }, [pendingOrders]);

  // MOTOR OSRM: Optimización basada en tiempos reales por carretera de Galicia
  const handleRunGaliciaOptimization = async () => {
    const selectedOrders = selectedOrderIds
      .map((id) => orders.find((o) => o.id === id))
      .filter((o): o is VanOrder => Boolean(o));

    if (selectedOrders.length === 0) {
      setTrips([]);
      return;
    }

    setIsOptimizing(true);

    try {
      const result = await optimizeGaliciaRoutes(
        selectedOrders,
        settings.warehouseCoordinates,
        settings.vanCapacitySacks
      );

      setTrips(result.trips);
      setActiveTripIdx(0);
    } catch (err) {
      console.error("Error optimizando rutas Galicia:", err);
    } finally {
      setIsOptimizing(false);
    }
  };

  useEffect(() => {
    handleRunGaliciaOptimization();
  }, [selectedOrderIds, orders, settings.vanCapacitySacks, settings.warehouseCoordinates]);

  const activeTrip = trips[activeTripIdx] || trips[0] || null;

  // Actualizar trazado polilínea OSRM para el viaje activo
  useEffect(() => {
    if (!activeTrip || activeTrip.orders.length === 0) {
      setOsrmRouteData(null);
      return;
    }

    let active = true;
    const coords = [
      settings.warehouseCoordinates,
      ...activeTrip.orders.map((o) => o.client.coordinates),
      settings.warehouseCoordinates,
    ];

    fetchOsrmTripRoute(coords).then((res) => {
      if (active) setOsrmRouteData(res);
    });

    return () => {
      active = false;
    };
  }, [activeTrip, settings.warehouseCoordinates]);

  // Reordenación manual Drag & Drop
  const handleDragEnd = (result: DropResult) => {
    if (!result.destination || !activeTrip) return;
    const from = result.source.index;
    const to = result.destination.index;
    if (from === to) return;

    const copy = Array.from(activeTrip.orders);
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);

    const updated = [...trips];
    updated[activeTripIdx] = {
      ...activeTrip,
      orders: copy,
    };
    setTrips(updated);
  };

  // BOTÓN: Invertir Orden de Ruta (conocedor de la zona)
  const handleInvertRoute = () => {
    if (!activeTrip || activeTrip.orders.length <= 1) return;

    const reversed = [...activeTrip.orders].reverse();
    const updated = [...trips];
    updated[activeTripIdx] = {
      ...activeTrip,
      orders: reversed,
    };
    setTrips(updated);
  };

  const toggleSelectOrder = (id: string) => {
    setSelectedOrderIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  // GENERAR HOJA DE REPARTO: Codifica coordenadas exactas (lat, lng) y sacos
  const handleGenerateDispatch = () => {
    if (!activeTrip || activeTrip.orders.length === 0) return;

    const ephemeralStops: EphemeralDeliveryStop[] = activeTrip.orders.map(
      (ord, index) => ({
        id: `eph-${ord.id}`,
        orderId: ord.id,
        clientName: ord.client.name,
        address: ord.client.address,
        coordinates: {
          lat: ord.client.coordinates.lat,
          lng: ord.client.coordinates.lng,
        },
        sacks: ord.sacks,
        totalWeightKg: ord.totalWeightKg,
        sequenceOrder: index + 1,
      })
    );

    const encoded = encodeRouteForDelivery(ephemeralStops, activeTrip.tripNumber);
    setEncodedPayload(encoded);
    setIsQrModalOpen(true);
  };

  // Adaptar pedidos para Leaflet Map
  const mapPendingOrders = useMemo(() => {
    return pendingOrders.map((o) => ({
      id: o.id,
      clientId: o.clientId,
      client: {
        id: o.client.id,
        name: o.client.name,
        phone: o.client.phone,
        address: o.client.address,
        coordinates: o.client.coordinates,
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
      clientId: o.clientId,
      client: {
        id: o.client.id,
        name: o.client.name,
        phone: o.client.phone,
        address: o.client.address,
        coordinates: o.client.coordinates,
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

  return (
    <div className="space-y-6">
      {/* 1. MAPA INTERACTIVO Y TRAZADO REAL OSRM POR CARRETERAS DE GALICIA */}
      <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-white flex items-center gap-2">
                <Compass className="w-5 h-5 text-amber-400" />
                Motor de Rutas Rural Galicia (Tiempos Reales de Conducción OSRM)
              </h2>
              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
                2-Opt TSP
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Sin distancias euclidianas. Optimizado por puertos, rías y carreteras secundarias reales desde {settings.warehouseName}.
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
              onClick={handleRunGaliciaOptimization}
              disabled={isOptimizing}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-black text-xs shadow-lg shadow-amber-600/20 disabled:opacity-50 transition active:scale-95"
            >
              <Zap className="w-4 h-4" />
              <span>{isOptimizing ? "Optimizando con OSRM..." : "⚡ Optimizar Reparto Automáticamente"}</span>
            </button>
          </div>
        </div>

        <DeliveryRouteMap
          warehouse={{
            name: settings.warehouseName,
            address: settings.warehouseAddress,
            coordinates: settings.warehouseCoordinates,
          }}
          pendingOrders={mapPendingOrders}
          selectedOrders={mapSelectedOrders}
          onOrderClick={toggleSelectOrder}
          osrmPolyline={osrmRouteData?.polyline}
          height="400px"
        />
      </div>

      {/* 2. PESTAÑAS DE VIAJES (CLUSTERING POR TIEMPOS DE CARRETERA REALES) */}
      {trips.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl shadow-xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-wider text-slate-300">
                Viajes en Furgón ({settings.vanCapacitySacks} sacos máx.):
              </span>
              {trips.length > 1 && (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Capacidad superada: {trips.length} viajes agrupados por valles y corredores viales
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* BOTÓN: INVERTIR ORDEN DE RUTA */}
              <button
                type="button"
                onClick={handleInvertRoute}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs border border-slate-700 transition"
                title="Invertir secuencia de entrega (ej. entregar primero el más lejano o pesado)"
              >
                <ArrowUpDown className="w-3.5 h-3.5 text-amber-400" />
                <span>Invertir Orden</span>
              </button>

              {/* BOTÓN: GENERAR HOJA DE REPARTO CON COORDENADAS GPS EXACTAS */}
              <button
                type="button"
                onClick={handleGenerateDispatch}
                className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-black text-xs transition shadow-lg shadow-amber-600/25"
              >
                <QrCode className="w-4 h-4" />
                Generar Hoja de Reparto (QR / WhatsApp)
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
                    {t.totalSacks} sacos ({t.totalWeightKg} kg) • ~{t.estimatedDrivingMinutes}m
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. PARADAS REORDENABLES (DRAG & DROP) DEL VIAJE ACTIVO */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Columna Izquierda: Pedidos Disponibles */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-3 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-300">
              Pedidos Pendientes ({pendingOrders.length})
            </h3>
            <span className="text-[11px] text-slate-400">
              {selectedOrderIds.length} seleccionados
            </span>
          </div>

          <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
            {pendingOrders.map((ord) => {
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
                    <div className="font-bold text-white">{ord.client.name}</div>
                    <div className="text-[11px] text-slate-400 line-clamp-1">{ord.client.address}</div>
                    <div className="font-mono text-[10px] text-amber-400/80">
                      GPS: {ord.client.coordinates.lat.toFixed(4)}, {ord.client.coordinates.lng.toFixed(4)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-black text-amber-400">{ord.sacks} sacos</span>
                    <div className="text-[10px] text-slate-400">{ord.totalWeightKg} kg</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Columna Derecha: Paradas Ordenadas con TSP + 2-Opt (Drag & Drop) */}
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-white">
                Secuencia Óptima de Entrega (Viaje #{activeTrip?.tripNumber || 1})
              </h3>
              <p className="text-[11px] text-slate-400">
                Calculado con OSRM Table + 2-Opt. Puedes arrastrar para forzar el orden.
              </p>
            </div>
          </div>

          {/* Salida del Almacén */}
          <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs font-bold text-white">
            <div className="flex items-center gap-2">
              <Warehouse className="w-4 h-4 text-amber-400" />
              <span>Salida: {settings.warehouseName} (Carga furgón)</span>
            </div>
            <span className="text-amber-400 font-mono text-[11px]">08:30h</span>
          </div>

          {/* Lista Drag and Drop */}
          {!activeTrip || activeTrip.orders.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-2xl">
              Selecciona pedidos en la columna izquierda para trazar el viaje.
            </div>
          ) : (
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="van-rural-stops-droppable">
                {(provided) => (
                  <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2.5">
                    {activeTrip.orders.map((ord, idx) => (
                      <Draggable key={ord.id} draggableId={ord.id} index={idx}>
                        {(dragProvided, snapshot) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 text-xs transition-all ${
                              snapshot.isDragging
                                ? "bg-amber-500/20 border-amber-500 shadow-2xl scale-[1.02] z-50 text-white"
                                : "bg-slate-800/80 hover:bg-slate-800 border-slate-700/80 text-white"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div
                                {...dragProvided.dragHandleProps}
                                className="text-slate-400 hover:text-white p-1 cursor-grab active:cursor-grabbing"
                              >
                                <GripVertical className="w-4 h-4" />
                              </div>
                              <div className="w-6 h-6 rounded-xl bg-amber-500 text-slate-950 font-black flex items-center justify-center text-xs">
                                {idx + 1}
                              </div>
                              <div>
                                <div className="font-extrabold">{ord.client.name}</div>
                                <div className="text-[11px] text-slate-400 line-clamp-1">📍 {ord.client.address}</div>
                                <div className="font-mono text-[10px] text-amber-400">
                                  GPS: {ord.client.coordinates.lat.toFixed(5)}, {ord.client.coordinates.lng.toFixed(5)}
                                </div>
                              </div>
                            </div>

                            <div className="text-right shrink-0">
                              <div className="font-black text-amber-400">{ord.sacks} sacos</div>
                              <div className="text-[10px] text-slate-400">{ord.totalWeightKg} kg</div>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          )}

          {/* Retorno al Almacén */}
          <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs font-semibold text-slate-400">
            <div className="flex items-center gap-2">
              <Warehouse className="w-4 h-4 text-slate-500" />
              <span>Retorno: {settings.warehouseName}</span>
            </div>
            <span className="text-[11px]">Fin de viaje</span>
          </div>
        </div>
      </div>

      {/* Modal QR y Compartir */}
      <QrShareModal
        isOpen={isQrModalOpen}
        onClose={() => setIsQrModalOpen(false)}
        encodedData={encodedPayload}
        tripNumber={activeTrip?.tripNumber || 1}
        stopsCount={activeTrip?.orders.length || 0}
        totalSacks={activeTrip?.totalSacks || 0}
        warehouseCoords={settings.warehouseCoordinates}
        stopsCoords={activeTrip?.orders.map((o) => o.client.coordinates) || []}
      />
    </div>
  );
}
