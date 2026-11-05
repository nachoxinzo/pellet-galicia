"use client";

import React, { useState, useEffect } from "react";
import {
  Order,
  Vehicle,
  DeliveryRoute,
  OrderFormInput,
  WarehouseLocation,
  PELLET_RULES,
} from "@/types/pellet";
import { pelletRepository, DEFAULT_WAREHOUSE } from "@/services/storageService";
import PendingOrdersView from "@/components/PendingOrdersView";
import FleetVehiclesView from "@/components/FleetVehiclesView";
import RoutePlannerView from "@/components/RoutePlannerView";
import RouteDriverModeView from "@/components/RouteDriverModeView";
import OrderFormModal from "@/components/OrderFormModal";
import {
  Flame,
  ClipboardList,
  Truck,
  Map,
  Plus,
  RotateCcw,
  Menu,
  X,
  Database,
  Scale,
  Navigation,
} from "lucide-react";

type ActiveTab = "orders" | "fleet" | "planner" | "driver";

export default function PelletRouteDashboard() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("orders");
  const [orders, setOrders] = useState<Order[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [routes, setRoutes] = useState<DeliveryRoute[]>([]);
  const [warehouse, setWarehouse] =
    useState<WarehouseLocation>(DEFAULT_WAREHOUSE);
  const [isLoaded, setIsLoaded] = useState(false);

  // Estado del modal de creación / edición de pedidos
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const refreshData = () => {
    setOrders(pelletRepository.getOrders());
    setVehicles(pelletRepository.getVehicles());
    setRoutes(pelletRepository.getRoutes());
    setWarehouse(pelletRepository.getWarehouse());
  };

  useEffect(() => {
    refreshData();
    setIsLoaded(true);
  }, []);

  const handleOpenNewOrderModal = () => {
    setEditingOrder(null);
    setIsOrderModalOpen(true);
  };

  const handleOpenEditOrderModal = (order: Order) => {
    setEditingOrder(order);
    setIsOrderModalOpen(true);
  };

  const handleSaveOrder = (input: OrderFormInput) => {
    pelletRepository.saveOrderFromForm(input);
    refreshData();
  };

  const handleDeleteOrder = (orderId: string) => {
    pelletRepository.deleteOrder(orderId);
    refreshData();
  };

  const handleChangeOrderStatus = (
    orderId: string,
    status: Order["status"]
  ) => {
    pelletRepository.updateOrderStatus(orderId, status);
    refreshData();
  };

  const handleSaveVehicle = (
    vehicleData: Omit<Vehicle, "id" | "createdAt" | "updatedAt"> & {
      id?: string;
    }
  ) => {
    pelletRepository.saveVehicle(vehicleData);
    refreshData();
  };

  const handleDeleteVehicle = (vehicleId: string) => {
    pelletRepository.deleteVehicle(vehicleId);
    refreshData();
  };

  const handleToggleVehicleAvailability = (vehicleId: string) => {
    pelletRepository.toggleVehicleAvailability(vehicleId);
    refreshData();
  };

  const handleSaveRoute = (route: DeliveryRoute) => {
    pelletRepository.saveRoute(route);
    // Marcar los pedidos incluidos como Planificados
    route.stops.forEach((s) => {
      pelletRepository.updateOrderStatus(s.orderId, "Planificado");
    });
    refreshData();
  };

  const handleUpdateRouteStop = (
    routeId: string,
    stopId: string,
    updates: Partial<any>
  ) => {
    pelletRepository.updateRouteStop(routeId, stopId, updates);
    refreshData();
  };

  const handleDeleteRoute = (routeId: string) => {
    pelletRepository.deleteRoute(routeId);
    refreshData();
  };

  const handleSaveWarehouse = (newWarehouse: WarehouseLocation) => {
    pelletRepository.saveWarehouse(newWarehouse);
    refreshData();
  };

  const handleResetDemo = () => {
    pelletRepository.resetDemoData();
    refreshData();
  };

  const pendingOrdersCount = orders.filter(
    (o) => o.status === "Pendiente"
  ).length;
  const activeVehiclesCount = vehicles.filter((v) => v.isAvailable).length;

  const navItems: {
    id: ActiveTab;
    label: string;
    subtitle: string;
    icon: React.ElementType;
    badge?: number | string;
  }[] = [
    {
      id: "orders",
      label: "Pedidos Pendientes",
      subtitle: "Clientes, sacos y palés",
      icon: ClipboardList,
      badge: pendingOrdersCount,
    },
    {
      id: "fleet",
      label: "Flota / Vehículos",
      subtitle: "Camiones y capacidades",
      icon: Truck,
      badge: `${activeVehiclesCount}/${vehicles.length}`,
    },
    {
      id: "planner",
      label: "Planificador de Rutas",
      subtitle: "Asignación y hojas de reparto",
      icon: Map,
      badge: routes.length > 0 ? routes.length : undefined,
    },
    {
      id: "driver",
      label: "Modo en Ruta (Conductor)",
      subtitle: "GPS, WhatsApp y entregas",
      icon: Navigation,
      badge: routes.filter((r) => r.status === "En Curso" || r.status === "Confirmada").length || undefined,
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row text-slate-900">
      {/* Barra superior móvil */}
      <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-amber-500 text-slate-950">
            <Flame className="w-5 h-5" />
          </div>
          <div>
            <span className="font-extrabold text-base tracking-tight">
              PelletRoute
            </span>
            <span className="block text-[10px] text-amber-400 uppercase tracking-wider">
              Logística Biomasa PWA
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleOpenNewOrderModal}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold"
          >
            <Plus className="w-3.5 h-3.5" />
            Pedido
          </button>
          <button
            type="button"
            onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
            className="p-2 rounded-lg text-slate-300 hover:bg-slate-800"
          >
            {isMobileSidebarOpen ? (
              <X className="w-5 h-5" />
            ) : (
              <Menu className="w-5 h-5" />
            )}
          </button>
        </div>
      </header>

      {/* Navegación Lateral (Sidebar) */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 bg-slate-900 text-white flex flex-col justify-between transition-transform duration-200 lg:static lg:translate-x-0 ${
          isMobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="p-6 space-y-6">
          {/* Branding */}
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950 shadow-lg shadow-amber-500/20">
              <Flame className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-extrabold tracking-tight">
                  PelletRoute
                </h1>
                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  PWA
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Optimización Reparto de Pellets
              </p>
            </div>
          </div>

          {/* Botón CTA Rápido */}
          <button
            type="button"
            onClick={() => {
              handleOpenNewOrderModal();
              setIsMobileSidebarOpen(false);
            }}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-sm shadow-lg shadow-amber-600/25 transition"
          >
            <Plus className="w-4 h-4" />
            Nuevo Pedido de Pellets
          </button>

          {/* Pestañas de Navegación */}
          <nav className="space-y-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 px-3 mb-2">
              Módulos de Gestión
            </p>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    setIsMobileSidebarOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-left transition-all ${
                    isActive
                      ? "bg-slate-800 text-white border border-slate-700 shadow-sm"
                      : "text-slate-400 hover:text-white hover:bg-slate-800/50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`p-2 rounded-lg ${
                        isActive
                          ? "bg-amber-500/20 text-amber-400"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold">{item.label}</div>
                      <div className="text-[11px] text-slate-400">
                        {item.subtitle}
                      </div>
                    </div>
                  </div>
                  {item.badge !== undefined && (
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        isActive
                          ? "bg-amber-500 text-slate-950"
                          : "bg-slate-800 text-slate-300"
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Pie del Sidebar: Reglas de negocio y estado de almacenamiento */}
        <div className="p-5 m-4 rounded-2xl bg-slate-800/70 border border-slate-700/70 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-400">
            <Scale className="w-4 h-4" />
            <span>Estándar de Conversión</span>
          </div>
          <div className="text-xs text-slate-300 space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-400">1 Palé completo:</span>
              <span className="font-mono font-semibold">
                {PELLET_RULES.SACKS_PER_PALLET} sacos ={" "}
                {PELLET_RULES.PALLET_WEIGHT_KG.toLocaleString("es-ES")} kg
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">1 Saco suelto:</span>
              <span className="font-mono font-semibold">
                {PELLET_RULES.SACK_WEIGHT_KG} kg
              </span>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-700/80 flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <Database className="w-3 h-3 text-emerald-400" />
              LocalStorage Modular
            </span>
            <button
              type="button"
              onClick={handleResetDemo}
              title="Restaurar datos de prueba iniciales"
              className="flex items-center gap-1 text-slate-400 hover:text-amber-400 transition"
            >
              <RotateCcw className="w-3 h-3" />
              Reset Demo
            </button>
          </div>
        </div>
      </aside>

      {/* Área de Contenido Principal */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Cabecera Superior de Escritorio */}
        <div className="bg-white border-b border-slate-200 px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-600">
              <span>Panel de Operaciones</span>
              <span>•</span>
              <span>
                {activeTab === "orders" && "Gestión de Pedidos"}
                {activeTab === "fleet" && "Configuración de Vehículos"}
                {activeTab === "planner" && "Optimización de Reparto"}
                {activeTab === "driver" && "Terminal del Conductor"}
              </span>
            </div>
            <h2 className="text-2xl font-extrabold text-slate-900 mt-0.5">
              {activeTab === "orders" && "Pedidos Pendientes de Entrega"}
              {activeTab === "fleet" && "Flota y Capacidad de Vehículos"}
              {activeTab === "planner" && "Planificador Inteligente de Rutas"}
              {activeTab === "driver" && "Modo en Ruta — Navegación y Entregas"}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleOpenNewOrderModal}
              className="hidden sm:inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold transition"
            >
              <Plus className="w-4 h-4 text-amber-400" />
              Añadir Pedido
            </button>
          </div>
        </div>

        {/* Contenido Dinámico de la Pestaña Activa */}
        <div className="p-6 max-w-7xl w-full mx-auto flex-1">
          {!isLoaded ? (
            <div className="p-12 text-center text-slate-500 text-sm">
              Cargando datos de PelletRoute...
            </div>
          ) : (
            <>
              {activeTab === "orders" && (
                <PendingOrdersView
                  orders={orders}
                  onCreateOrder={handleOpenNewOrderModal}
                  onEditOrder={handleOpenEditOrderModal}
                  onDeleteOrder={handleDeleteOrder}
                  onChangeStatus={handleChangeOrderStatus}
                />
              )}

              {activeTab === "fleet" && (
                <FleetVehiclesView
                  vehicles={vehicles}
                  onSaveVehicle={handleSaveVehicle}
                  onDeleteVehicle={handleDeleteVehicle}
                  onToggleAvailability={handleToggleVehicleAvailability}
                />
              )}

              {activeTab === "planner" && (
                <RoutePlannerView
                  orders={orders}
                  vehicles={vehicles}
                  routes={routes}
                  warehouse={warehouse}
                  onSaveWarehouse={handleSaveWarehouse}
                  onSaveRoute={handleSaveRoute}
                  onDeleteRoute={handleDeleteRoute}
                />
              )}

              {activeTab === "driver" && (
                <RouteDriverModeView
                  routes={routes}
                  warehouse={warehouse}
                  onUpdateStop={handleUpdateRouteStop}
                  onSelectRouteTab={() => setActiveTab("planner")}
                />
              )}
            </>
          )}
        </div>
      </main>

      {/* Modal Funcional para Crear / Editar Pedido con Cálculo en Tiempo Real */}
      <OrderFormModal
        isOpen={isOrderModalOpen}
        onClose={() => setIsOrderModalOpen(false)}
        onSave={handleSaveOrder}
        editingOrder={editingOrder}
      />
    </div>
  );
}
