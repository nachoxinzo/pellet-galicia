"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
} from "@hello-pangea/dnd";
import {
  Order,
  Vehicle,
  DeliveryRoute,
  RouteStop,
  WarehouseLocation,
} from "@/types/pellet";
import { fetchOsrmRoute, OsrmRouteResult } from "@/utils/osrmRouting";
import {
  optimizeMultiTripRoutes,
  OptimizedTrip,
} from "@/utils/routeOptimizer";
import {
  Route as RouteIcon,
  Truck,
  Scale,
  Layers,
  MapPin,
  Clock,
  AlertTriangle,
  Sparkles,
  Trash2,
  Save,
  Warehouse as WarehouseIcon,
  Edit2,
  Check,
  Map as MapIcon,
  GripVertical,
  Navigation,
  RefreshCw,
  CheckCircle2,
  TrendingDown,
  Timer,
  ChevronRight,
  Info,
} from "lucide-react";

// Carga dinámica del mapa interactivo de rutas de Leaflet
const DeliveryRouteMap = dynamic(
  () => import("@/components/map/DeliveryRouteMap"),
  {
    ssr: false,
    loading: () => (
      <div className="h-[420px] w-full bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 text-sm animate-pulse border border-slate-200">
        Cargando mapa interactivo de rutas...
      </div>
    ),
  }
);

interface RoutePlannerViewProps {
  orders: Order[];
  vehicles: Vehicle[];
  routes: DeliveryRoute[];
  warehouse: WarehouseLocation;
  onSaveWarehouse: (w: WarehouseLocation) => void;
  onSaveRoute: (route: DeliveryRoute) => void;
  onDeleteRoute: (routeId: string) => void;
}

export default function RoutePlannerView({
  orders,
  vehicles,
  routes,
  warehouse,
  onSaveWarehouse,
  onSaveRoute,
  onDeleteRoute,
}: RoutePlannerViewProps) {
  const availableVehicles = useMemo(
    () => vehicles.filter((v) => v.isAvailable),
    [vehicles]
  );

  const [selectedVehicleId, setSelectedVehicleId] = useState<string>(
    availableVehicles[0]?.id || ""
  );
  const [routeName, setRouteName] = useState<string>("Ruta Reparto #1");
  const [routeDate, setRouteDate] = useState<string>(
    new Date().toISOString().split("T")[0]
  );

  // Pedidos marcados para ser repartidos hoy
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);

  // Estructura de viajes agrupados (Viaje 1, Viaje 2...)
  const [trips, setTrips] = useState<OptimizedTrip[]>([]);
  const [activeTripIndex, setActiveTripIndex] = useState<number>(0);

  // Estado de cálculo OSRM para el viaje activo
  const [osrmData, setOsrmData] = useState<OsrmRouteResult | null>(null);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState<boolean>(false);

  // Estado de edición del almacén base
  const [isEditingWarehouse, setIsEditingWarehouse] = useState(false);
  const [warehouseName, setWarehouseName] = useState(warehouse.name);
  const [warehouseAddress, setWarehouseAddress] = useState(warehouse.address);
  const [warehouseLat, setWarehouseLat] = useState(
    String(warehouse.coordinates.lat)
  );
  const [warehouseLng, setWarehouseLng] = useState(
    String(warehouse.coordinates.lng)
  );

  const selectedVehicle = useMemo(
    () =>
      vehicles.find((v) => v.id === selectedVehicleId) || availableVehicles[0],
    [vehicles, selectedVehicleId, availableVehicles]
  );

  const pendingOrders = useMemo(
    () => orders.filter((o) => o.status === "Pendiente"),
    [orders]
  );

  // Inicializar selección con los primeros pedidos pendientes si no hay selección
  useEffect(() => {
    if (selectedOrderIds.length === 0 && pendingOrders.length > 0) {
      setSelectedOrderIds(pendingOrders.map((o) => o.id));
    }
  }, [pendingOrders]);

  // Ejecuta la optimización multiviaje y clustering cuando cambian los pedidos seleccionados o el vehículo
  const runOptimization = useCallback(() => {
    if (!selectedVehicle || selectedOrderIds.length === 0) {
      setTrips([]);
      return;
    }

    const ordersToPlan = selectedOrderIds
      .map((id) => orders.find((o) => o.id === id))
      .filter((o): o is Order => Boolean(o));

    const result = optimizeMultiTripRoutes(
      ordersToPlan,
      selectedVehicle,
      warehouse
    );

    setTrips(result.trips);
    setActiveTripIndex(0);
  }, [selectedOrderIds, orders, selectedVehicle, warehouse]);

  useEffect(() => {
    runOptimization();
  }, [runOptimization]);

  // Viaje actualmente visualizado
  const activeTrip = trips[activeTripIndex] || trips[0] || null;

  // Consulta la API de OSRM cuando cambia el orden de paradas del viaje activo
  useEffect(() => {
    if (!activeTrip || activeTrip.orders.length === 0) {
      setOsrmData(null);
      return;
    }

    let isSubscribed = true;
    setIsCalculatingRoute(true);

    const coords = [
      warehouse.coordinates,
      ...activeTrip.orders.map((o) => o.client.coordinates),
      warehouse.coordinates,
    ];

    fetchOsrmRoute(coords)
      .then((res) => {
        if (isSubscribed) {
          setOsrmData(res);
          setIsCalculatingRoute(false);
        }
      })
      .catch(() => {
        if (isSubscribed) setIsCalculatingRoute(false);
      });

    return () => {
      isSubscribed = false;
    };
  }, [activeTrip, warehouse]);

  // Manejo de Drag and Drop para reordenar paradas dentro del viaje activo
  const handleDragEnd = (result: DropResult) => {
    if (!result.destination || !activeTrip) return;
    const sourceIdx = result.source.index;
    const destIdx = result.destination.index;
    if (sourceIdx === destIdx) return;

    const newOrders = Array.from(activeTrip.orders);
    const [movedOrder] = newOrders.splice(sourceIdx, 1);
    newOrders.splice(destIdx, 0, movedOrder);

    const updatedTrips = [...trips];
    updatedTrips[activeTripIndex] = {
      ...activeTrip,
      orders: newOrders,
    };

    setTrips(updatedTrips);
  };

  const toggleOrderSelection = (orderId: string) => {
    setSelectedOrderIds((prev) =>
      prev.includes(orderId)
        ? prev.filter((id) => id !== orderId)
        : [...prev, orderId]
    );
  };

  const selectAllPending = () => {
    setSelectedOrderIds(pendingOrders.map((o) => o.id));
  };

  const clearSelection = () => {
    setSelectedOrderIds([]);
  };

  const handleSaveWarehouse = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveWarehouse({
      name: warehouseName.trim() || warehouse.name,
      address: warehouseAddress.trim() || warehouse.address,
      coordinates: {
        lat: parseFloat(warehouseLat) || warehouse.coordinates.lat,
        lng: parseFloat(warehouseLng) || warehouse.coordinates.lng,
      },
    });
    setIsEditingWarehouse(false);
  };

  // Confirmar y guardar la hoja de ruta del viaje activo o de todos los viajes
  const handleConfirmActiveTrip = () => {
    if (!selectedVehicle || !activeTrip || activeTrip.orders.length === 0)
      return;
    const routeId = `rt-${Date.now().toString().slice(-5)}`;
    const now = new Date().toISOString();

    const stops: RouteStop[] = activeTrip.orders.map((ord, idx) => ({
      id: `stop-${routeId}-${idx + 1}`,
      routeId,
      orderId: ord.id,
      order: ord,
      sequenceOrder: idx + 1,
      estimatedArrival: `${String(8 + idx).padStart(2, "0")}:30`,
      estimatedUnloadingMinutes: 15,
      completed: false,
    }));

    const newRoute: DeliveryRoute = {
      id: routeId,
      name: `${routeName} (Viaje ${activeTrip.tripNumber})`,
      date: routeDate,
      vehicleId: selectedVehicle.id,
      vehicle: selectedVehicle,
      stops,
      totalWeightKg: activeTrip.totalWeightKg,
      totalPalletsOccupied: activeTrip.totalPallets,
      totalDistanceKm: osrmData?.distanceKm,
      estimatedDurationMinutes: osrmData
        ? osrmData.durationDrivingMinutes + activeTrip.orders.length * 15
        : undefined,
      status: "Confirmada",
      createdAt: now,
      updatedAt: now,
    };

    onSaveRoute(newRoute);

    // Quitamos los pedidos planificados de la selección pendiente
    const plannedIds = new Set(activeTrip.orders.map((o) => o.id));
    setSelectedOrderIds((prev) => prev.filter((id) => !plannedIds.has(id)));
  };

  // Métricas de tiempo de descarga y conducción: 15 min fijos por cliente
  const unloadingMinutes = (activeTrip?.orders.length || 0) * 15;
  const drivingMinutes = osrmData?.durationDrivingMinutes || 0;
  const totalServiceMinutes = drivingMinutes + unloadingMinutes;
  const totalHours = (totalServiceMinutes / 60).toFixed(1);

  // Porcentaje de carga del vehículo en el viaje activo
  const weightPercent = selectedVehicle && activeTrip
    ? Math.min(
        100,
        Math.round((activeTrip.totalWeightKg / selectedVehicle.maxWeightKg) * 100)
      )
    : 0;

  return (
    <div className="space-y-6">
      {/* 1. SECCIÓN DE CONFIGURACIÓN DEL ALMACÉN CENTRAL / BASE DE CARGA */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-slate-900 text-amber-400">
              <WarehouseIcon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  {warehouse.name}
                </h3>
                <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                  Punto de Salida & Retorno
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>{warehouse.address}</span>
                <span className="font-mono text-slate-400 text-[11px]">
                  ({warehouse.coordinates.lat.toFixed(4)},{" "}
                  {warehouse.coordinates.lng.toFixed(4)})
                </span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsEditingWarehouse(!isEditingWarehouse)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 transition self-start sm:self-auto"
          >
            <Edit2 className="w-3.5 h-3.5 text-slate-500" />
            {isEditingWarehouse ? "Cancelar" : "Modificar Almacén Base"}
          </button>
        </div>

        {/* Formulario para editar Almacén Base */}
        {isEditingWarehouse && (
          <form
            onSubmit={handleSaveWarehouse}
            className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-4 gap-3 animate-in fade-in duration-150"
          >
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Nombre de la Base
              </label>
              <input
                type="text"
                value={warehouseName}
                onChange={(e) => setWarehouseName(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Dirección del Almacén
              </label>
              <input
                type="text"
                value={warehouseAddress}
                onChange={(e) => setWarehouseAddress(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  Lat / Lng
                </label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    step="any"
                    value={warehouseLat}
                    onChange={(e) => setWarehouseLat(e.target.value)}
                    placeholder="Lat"
                    className="w-1/2 px-2 py-1.5 text-xs font-mono border border-slate-300 rounded-lg outline-none"
                  />
                  <input
                    type="number"
                    step="any"
                    value={warehouseLng}
                    onChange={(e) => setWarehouseLng(e.target.value)}
                    placeholder="Lng"
                    className="w-1/2 px-2 py-1.5 text-xs font-mono border border-slate-300 rounded-lg outline-none"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="px-3.5 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 h-[32px] flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5" />
                Guardar
              </button>
            </div>
          </form>
        )}
      </div>

      {/* 2. MAPA INTERACTIVO CON RUTA POR CARRETERA REAL (OSRM) */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <MapIcon className="w-5 h-5 text-amber-600" />
              Trazado Real por Carretera (OSRM)
            </h3>
            <p className="text-xs text-slate-500">
              Ruta óptima calculada por carretera desde la base, pasando por los
              clientes y retornando al almacén.
            </p>
          </div>

          {/* Métricas en vivo del viaje activo */}
          {osrmData && (
            <div className="flex items-center gap-3 bg-slate-900 text-white px-4 py-2 rounded-xl shadow-sm text-xs self-start sm:self-auto">
              <div>
                <span className="text-slate-400 block text-[10px]">
                  Distancia Carretera
                </span>
                <span className="font-extrabold text-amber-400 text-sm">
                  {osrmData.distanceKm} km
                </span>
              </div>
              <div className="h-6 w-px bg-slate-700"></div>
              <div>
                <span className="text-slate-400 block text-[10px]">
                  Conducción
                </span>
                <span className="font-extrabold text-white text-sm">
                  {osrmData.durationDrivingMinutes} min
                </span>
              </div>
              <div className="h-6 w-px bg-slate-700"></div>
              <div>
                <span className="text-slate-400 block text-[10px]">
                  Total + Descarga
                </span>
                <span className="font-extrabold text-emerald-400 text-sm">
                  ~{totalHours} h ({totalServiceMinutes} min)
                </span>
              </div>
            </div>
          )}
        </div>

        <DeliveryRouteMap
          warehouse={warehouse}
          pendingOrders={pendingOrders}
          selectedOrders={activeTrip?.orders || []}
          onOrderClick={toggleOrderSelection}
          osrmPolyline={osrmData?.polyline}
          height="420px"
        />
      </div>

      {/* 3. CONFIGURACIÓN DEL VEHÍCULO Y SELECTOR MULTIVIAJE (CLUSTERING) */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Truck className="w-5 h-5 text-amber-600" />
              Vehículo de Reparto y Algoritmo de Clustering
            </h2>
            <p className="text-xs text-slate-500">
              Si el peso o palés superan la capacidad, el motor dividirá la ruta
              automáticamente en Viaje 1, Viaje 2... con regreso a base.
            </p>
          </div>

          <button
            type="button"
            onClick={runOptimization}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-bold transition self-start sm:self-auto"
          >
            <Sparkles className="w-4 h-4 text-amber-600" />
            Re-Optimizar Ruta y Agrupación
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Nombre de la Hoja de Ruta
            </label>
            <input
              type="text"
              value={routeName}
              onChange={(e) => setRouteName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none text-slate-900"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Vehículo Seleccionado
            </label>
            <select
              value={selectedVehicle?.id || ""}
              onChange={(e) => setSelectedVehicleId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-amber-500 outline-none text-slate-900 font-medium"
            >
              {availableVehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.maxWeightKg.toLocaleString("es-ES")} kg /{" "}
                  {v.maxPallets} Palés)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Fecha de Reparto
            </label>
            <input
              type="date"
              value={routeDate}
              onChange={(e) => setRouteDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none text-slate-900"
            />
          </div>
        </div>

        {/* Pestañas de Viajes (Clustering Multiviaje) si la carga supera la capacidad */}
        {trips.length > 0 && (
          <div className="pt-2 border-t border-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Viajes Calculados:
                </span>
                {trips.length > 1 && (
                  <span className="text-[11px] font-semibold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full border border-amber-200">
                    Capacidad superada: dividido en {trips.length} viajes
                    geográficos
                  </span>
                )}
              </div>

              <div className="text-xs text-slate-500">
                Total a repartir hoy:{" "}
                <strong>
                  {trips
                    .reduce((acc, t) => acc + t.totalWeightKg, 0)
                    .toLocaleString("es-ES")}{" "}
                  kg
                </strong>{" "}
                en {selectedOrderIds.length} clientes
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {trips.map((trip, idx) => {
                const isActive = activeTripIndex === idx;
                return (
                  <button
                    key={trip.tripNumber}
                    type="button"
                    onClick={() => setActiveTripIndex(idx)}
                    className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-xs font-bold transition ${
                      isActive
                        ? "bg-slate-900 text-white border-slate-900 shadow-md"
                        : "bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200"
                    }`}
                  >
                    <span>Viaje {trip.tripNumber}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] ${
                        isActive
                          ? "bg-amber-500 text-slate-950"
                          : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {trip.totalWeightKg.toLocaleString("es-ES")} kg •{" "}
                      {trip.orders.length} paradas
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Medidores de Capacidad del Viaje Activo */}
        {selectedVehicle && activeTrip && (
          <div className="p-4 rounded-xl bg-slate-900 text-white space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-semibold text-slate-300">
                <Scale className="w-4 h-4 text-amber-400" />
                Carga Viaje {activeTrip.tripNumber}:
              </span>
              <span className="font-bold text-amber-400">
                {activeTrip.totalWeightKg.toLocaleString("es-ES")} /{" "}
                {selectedVehicle.maxWeightKg.toLocaleString("es-ES")} kg (
                {weightPercent}%)
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  activeTrip.totalWeightKg > selectedVehicle.maxWeightKg
                    ? "bg-red-500"
                    : weightPercent > 85
                    ? "bg-amber-500"
                    : "bg-emerald-500"
                }`}
                style={{ width: `${Math.min(100, weightPercent)}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-xs pt-1">
              <span className="flex items-center gap-1.5 font-semibold text-slate-300">
                <Layers className="w-4 h-4 text-amber-400" />
                Ocupación Palés:
              </span>
              <span className="font-bold text-emerald-400">
                ~{activeTrip.totalPallets} / {selectedVehicle.maxPallets} palés
                máx. ({activeTrip.totalSacks} sacos)
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 4. DRAG & DROP DE PARADAS Y SELECCIÓN DE PEDIDOS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Columna Izquierda: Selección de Pedidos Pendientes */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                Pedidos Pendientes ({pendingOrders.length})
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectAllPending}
                  className="text-[11px] font-semibold text-amber-700 hover:underline"
                >
                  Marcar Todos
                </button>
                <span className="text-slate-300">•</span>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="text-[11px] font-semibold text-slate-500 hover:underline"
                >
                  Desmarcar
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              Marca o desmarca los pedidos que quieres repartir en la jornada:
            </p>

            <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
              {pendingOrders.map((order) => {
                const isSelected = selectedOrderIds.includes(order.id);
                return (
                  <div
                    key={order.id}
                    onClick={() => toggleOrderSelection(order.id)}
                    className={`p-3 rounded-xl border cursor-pointer transition flex items-center justify-between gap-3 ${
                      isSelected
                        ? "bg-amber-50/70 border-amber-400 shadow-sm"
                        : "bg-white hover:bg-slate-50 border-slate-200 opacity-60"
                    }`}
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}} // controlado por el onClick del contenedor
                          className="w-3.5 h-3.5 rounded text-amber-600 focus:ring-amber-500"
                        />
                        <span className="text-xs font-bold text-slate-900">
                          {order.client.name}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700 font-medium">
                          {order.client.preferredTimeWindow}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 flex items-center gap-1 pl-5">
                        <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                        <span className="line-clamp-1">
                          {order.client.address}
                        </span>
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-xs font-extrabold text-slate-900">
                        {order.totalWeightKg.toLocaleString("es-ES")} kg
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {order.pallets}P + {order.looseSacks}S
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Columna Derecha: Paradas Reordenables con DRAG & DROP para el Viaje Activo */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <RouteIcon className="w-5 h-5 text-amber-600" />
                  Secuencia de Paradas — Viaje {activeTrip?.tripNumber || 1}
                </h3>
                <p className="text-xs text-slate-500">
                  Arrastra con el ratón las paradas para cambiar el orden según
                  tu conveniencia. El tiempo OSRM se recalcula al instante.
                </p>
              </div>

              {activeTrip && activeTrip.orders.length > 0 && (
                <button
                  type="button"
                  onClick={handleConfirmActiveTrip}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-md shadow-amber-600/20 transition self-start sm:self-auto shrink-0"
                >
                  <Save className="w-3.5 h-3.5" />
                  Confirmar Viaje {activeTrip.tripNumber}
                </button>
              )}
            </div>

            {/* Salida desde el Almacén */}
            <div className="p-3 rounded-xl bg-slate-900 text-white flex items-center justify-between text-xs font-bold shadow-sm">
              <div className="flex items-center gap-2.5">
                <WarehouseIcon className="w-4 h-4 text-amber-400" />
                <div>
                  <span className="text-slate-400 text-[10px] uppercase block">
                    Punto de Partida
                  </span>
                  <span>Salida de Base: {warehouse.name}</span>
                </div>
              </div>
              <span className="text-amber-400 font-mono text-xs">08:00h</span>
            </div>

            {/* Lista Drag & Drop */}
            {!activeTrip || activeTrip.orders.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-slate-200 rounded-xl text-slate-400 text-sm">
                No hay pedidos asignados a este viaje. Selecciona pedidos en la
                columna izquierda.
              </div>
            ) : (
              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="route-stops-droppable">
                  {(provided) => (
                    <div
                      {...provided.droppableProps}
                      ref={provided.innerRef}
                      className="space-y-2.5"
                    >
                      {activeTrip.orders.map((ord, idx) => (
                        <Draggable
                          key={ord.id}
                          draggableId={ord.id}
                          index={idx}
                        >
                          {(dragProvided, snapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 transition-all ${
                                snapshot.isDragging
                                  ? "bg-amber-50 border-amber-400 shadow-xl scale-[1.02] z-50"
                                  : "bg-slate-50/80 hover:bg-slate-100 border-slate-200"
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                {/* Tirador Drag & Drop */}
                                <div
                                  {...dragProvided.dragHandleProps}
                                  className="text-slate-400 hover:text-slate-700 cursor-grab active:cursor-grabbing p-1 -ml-1"
                                  title="Arrastrar para reordenar parada"
                                >
                                  <GripVertical className="w-4 h-4" />
                                </div>

                                <div className="w-7 h-7 rounded-full bg-orange-600 text-white text-xs font-extrabold flex items-center justify-center shrink-0 shadow-sm">
                                  {idx + 1}
                                </div>

                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-slate-900">
                                      {ord.client.name}
                                    </span>
                                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                                      ⏱ {ord.client.preferredTimeWindow}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">
                                    📍 {ord.client.address}
                                  </p>
                                </div>
                              </div>

                              <div className="text-right shrink-0">
                                <div className="text-xs font-extrabold text-amber-700">
                                  {ord.totalWeightKg.toLocaleString("es-ES")} kg
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  +15 min descarga
                                </div>
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
            <div className="p-3 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-between text-xs font-semibold border border-slate-200">
              <div className="flex items-center gap-2">
                <WarehouseIcon className="w-4 h-4 text-slate-500" />
                <div>
                  <span className="text-[10px] text-slate-400 uppercase block">
                    Punto de Retorno
                  </span>
                  <span>Vuelta a Base: {warehouse.name}</span>
                </div>
              </div>
              <span className="text-slate-500 text-[11px]">
                Recargar / Fin de Viaje
              </span>
            </div>

            {/* Desglose de Tiempos y Descarga */}
            {activeTrip && activeTrip.orders.length > 0 && (
              <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200/70 text-xs text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Timer className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    <strong>Estimación de Jornada:</strong> {drivingMinutes} min
                    de conducción + {unloadingMinutes} min de descarga (15 min
                    fijos × {activeTrip.orders.length} clientes).
                  </span>
                </div>
                <div className="font-extrabold text-amber-900 shrink-0">
                  Total viaje: {totalHours} horas
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
