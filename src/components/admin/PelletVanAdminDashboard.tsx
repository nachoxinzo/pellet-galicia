"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  VanClient,
  VanOrder,
  VanSettings,
  PELLET_VAN_RULES,
} from "@/types/pelletVan";
import { pelletVanStorage } from "@/services/pelletVanStorage";
import AdminPinGuard from "@/components/admin/AdminPinGuard";
import BackupModal from "@/components/admin/BackupModal";
import ClientManagementModal from "@/components/admin/ClientManagementModal";
import VanRoutePlanner from "@/components/admin/VanRoutePlanner";
import {
  Truck,
  Package,
  Scale,
  Users,
  Plus,
  Shield,
  Settings,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  Clock,
  Sparkles,
  Search,
  ExternalLink,
  Warehouse,
  KeyRound,
  RotateCcw,
  Check,
  Route as RouteIcon,
} from "lucide-react";

export default function PelletVanAdminDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeTab, setActiveTab] = useState<"orders" | "route">("orders");
  const [settings, setSettings] = useState<VanSettings | null>(null);
  const [clients, setClients] = useState<VanClient[]>([]);
  const [orders, setOrders] = useState<VanOrder[]>([]);

  // Modales
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isClientsModalOpen, setIsClientsModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Formulario rápido para Nuevo Pedido
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [clientSearchTerm, setClientSearchTerm] = useState<string>("");
  const [sacksInput, setSacksInput] = useState<number>(25);
  const [orderNotes, setOrderNotes] = useState<string>("");

  // Edición de Almacén y Capacidad Furgón
  const [editVanCapacity, setEditVanCapacity] = useState<number>(90);
  const [editWarehouseName, setEditWarehouseName] = useState("");
  const [editWarehouseAddress, setEditWarehouseAddress] = useState("");
  const [editAdminPin, setEditAdminPin] = useState("");

  const refreshData = async () => {
    const s = await pelletVanStorage.getSettings();
    const c = await pelletVanStorage.getClients();
    const o = await pelletVanStorage.getOrders();
    setSettings(s);
    setClients(c);
    setOrders(o);

    setEditVanCapacity(s.vanCapacitySacks);
    setEditWarehouseName(s.warehouseName);
    setEditWarehouseAddress(s.warehouseAddress);
    setEditAdminPin(s.adminPin);
  };

  useEffect(() => {
    refreshData();
  }, []);

  // Clientes filtrados para autocompletado rápido
  const matchingClients = useMemo(() => {
    if (!clientSearchTerm.trim()) return [];
    return clients.filter((c) =>
      c.name.toLowerCase().includes(clientSearchTerm.toLowerCase())
    );
  }, [clients, clientSearchTerm]);

  const selectedClient = useMemo(() => {
    return clients.find((c) => c.id === selectedClientId) || null;
  }, [clients, selectedClientId]);

  // Métricas del nuevo pedido que se está configurando
  const currentOrderKg = sacksInput * PELLET_VAN_RULES.SACK_WEIGHT_KG;
  const vanMaxSacks = settings?.vanCapacitySacks || 90;
  const currentOrderOccupancyPercent = Math.min(
    100,
    Math.round((sacksInput / vanMaxSacks) * 100)
  );

  // Pedidos pendientes activos
  const pendingOrders = useMemo(() => {
    return orders.filter((o) => o.status === "Pendiente");
  }, [orders]);

  const totalPendingSacks = useMemo(() => {
    return pendingOrders.reduce((sum, o) => sum + o.sacks, 0);
  }, [pendingOrders]);

  const totalPendingKg = totalPendingSacks * PELLET_VAN_RULES.SACK_WEIGHT_KG;
  const totalOccupancyVanPercent = Math.round(
    (totalPendingSacks / vanMaxSacks) * 100
  );

  // Crear Pedido
  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId) return;

    await pelletVanStorage.saveOrder(selectedClientId, sacksInput, orderNotes);
    setSelectedClientId("");
    setClientSearchTerm("");
    setSacksInput(25);
    setOrderNotes("");
    await refreshData();
  };

  const handleDeleteOrder = async (id: string) => {
    await pelletVanStorage.deleteOrder(id);
    await refreshData();
  };

  const handleUpdateOrderStatus = async (id: string, status: VanOrder["status"]) => {
    await pelletVanStorage.updateOrderStatus(id, status);
    await refreshData();
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    await pelletVanStorage.saveSettings({
      vanCapacitySacks: editVanCapacity,
      warehouseName: editWarehouseName,
      warehouseAddress: editWarehouseAddress,
      adminPin: editAdminPin || undefined,
    });
    setIsSettingsOpen(false);
    await refreshData();
  };

  // Si no está autenticado, mostramos la pantalla de PIN de seguridad
  if (!isAuthenticated) {
    return (
      <AdminPinGuard
        correctPin={settings?.adminPin || PELLET_VAN_RULES.DEFAULT_ADMIN_PIN}
        onAuthenticated={() => setIsAuthenticated(true)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Barra de Navegación Superior Admin */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-30 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20 font-black">
            <Truck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black tracking-tight text-white">
                PelletVan <span className="text-amber-400">Admin</span>
              </h1>
              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                Zero-Cloud
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Gestión Privada en Local (IndexedDB)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsClientsModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition border border-slate-700"
          >
            <Users className="w-4 h-4 text-amber-400" />
            <span className="hidden sm:inline">Cartera de Clientes</span> ({clients.length})
          </button>

          <button
            type="button"
            onClick={() => setIsBackupModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition border border-slate-700"
          >
            <Shield className="w-4 h-4 text-amber-400" />
            <span className="hidden sm:inline">Backup AES</span>
          </button>

          <button
            type="button"
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition border border-slate-700"
            title="Ajustes de Furgón y Almacén"
          >
            <Settings className="w-4 h-4" />
          </button>

          <a
            href="/reparto"
            target="_blank"
            className="flex items-center gap-1 px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-black text-xs transition shadow-md shadow-amber-600/20"
          >
            <span>Ver /reparto</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </header>

      {/* Panel Desplegable de Ajustes de Furgón & Almacén */}
      {isSettingsOpen && (
        <div className="bg-slate-900 border-b border-slate-800 p-6 animate-in slide-in-from-top-4 duration-150">
          <form onSubmit={handleSaveSettings} className="max-w-4xl mx-auto space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                <Warehouse className="w-4 h-4 text-amber-400" />
                Configuración del Furgón y Almacén Central
              </h3>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="text-slate-400 text-xs hover:text-white"
              >
                Cerrar
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Capacidad Máx. Furgón (Sacos)
                </label>
                <input
                  type="number"
                  min={10}
                  max={250}
                  value={editVanCapacity}
                  onChange={(e) => setEditVanCapacity(parseInt(e.target.value, 10) || 90)}
                  className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded-xl text-white font-bold"
                />
                <span className="text-[10px] text-amber-400 mt-1 block">
                  = {(editVanCapacity * 15).toLocaleString("es-ES")} kg máx.
                </span>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Nombre del Almacén Base
                </label>
                <input
                  type="text"
                  value={editWarehouseName}
                  onChange={(e) => setEditWarehouseName(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded-xl text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Dirección del Almacén
                </label>
                <input
                  type="text"
                  value={editWarehouseAddress}
                  onChange={(e) => setEditWarehouseAddress(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded-xl text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  PIN de Acceso Admin
                </label>
                <input
                  type="password"
                  value={editAdminPin}
                  onChange={(e) => setEditAdminPin(e.target.value)}
                  placeholder="PIN"
                  className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded-xl text-white font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-black text-xs"
              >
                Guardar Configuración
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Contenido Principal */}
      <main className="max-w-6xl w-full mx-auto p-6 space-y-6 flex-1">
        {/* Pestañas de Navegación del Admin */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex rounded-2xl bg-slate-900 border border-slate-800 p-1">
            <button
              type="button"
              onClick={() => setActiveTab("orders")}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black transition ${
                activeTab === "orders"
                  ? "bg-amber-600 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Package className="w-4 h-4" />
              <span>Pedidos y Furgón</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-300">
                {pendingOrders.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("route")}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black transition ${
                activeTab === "route"
                  ? "bg-amber-600 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <RouteIcon className="w-4 h-4" />
              <span>Crear Ruta & Enviar al Repartidor</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-800 text-amber-400 font-bold">
                OSRM + QR
              </span>
            </button>
          </div>
        </div>

        {activeTab === "route" && settings ? (
          <VanRoutePlanner orders={orders} settings={settings} />
        ) : (
          <>
            {/* KPIs de Ocupación del Furgón */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl shadow-sm space-y-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
              Sacos Pendientes en Cola
            </span>
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-black text-white">
                {totalPendingSacks}{" "}
                <span className="text-sm font-normal text-slate-400">sacos</span>
              </span>
              <span className="text-sm font-black text-amber-400">
                {totalPendingKg.toLocaleString("es-ES")} kg
              </span>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl shadow-sm space-y-2 sm:col-span-2">
            <div className="flex items-center justify-between text-xs font-bold">
              <span className="text-slate-400 uppercase tracking-wider">
                Ocupación del Furgón ({settings?.vanCapacitySacks || 90} sacos máx.)
              </span>
              <span className={totalOccupancyVanPercent > 100 ? "text-red-400 font-black" : "text-amber-400"}>
                {totalPendingSacks} / {settings?.vanCapacitySacks || 90} sacos ({totalOccupancyVanPercent}%)
              </span>
            </div>
            <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  totalOccupancyVanPercent > 100 ? "bg-red-500" : "bg-gradient-to-r from-amber-500 to-amber-400"
                }`}
                style={{ width: `${Math.min(100, totalOccupancyVanPercent)}%` }}
              />
            </div>
            {totalOccupancyVanPercent > 100 && (
              <p className="text-[11px] text-red-400 flex items-center gap-1 font-medium">
                <AlertTriangle className="w-3.5 h-3.5" />
                La cola pendiente sobrepasa la carga de 1 viaje. Requerirá más de un viaje del furgón.
              </p>
            )}
          </div>
        </div>

        {/* Sección Dividida: Formulario de Pedido + Cola de Pedidos */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Formulario Rápido de Nuevo Pedido con Autocompletado */}
          <div className="lg:col-span-5 bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
                <Package className="w-4 h-4 text-amber-400" />
                Crear Pedido de Pellets
              </h2>
              <button
                type="button"
                onClick={() => setIsClientsModalOpen(true)}
                className="text-xs font-bold text-amber-400 hover:underline flex items-center gap-1"
              >
                + Nuevo Cliente
              </button>
            </div>

            <form onSubmit={handleCreateOrder} className="space-y-4">
              {/* Buscador / Autocompletado de Clientes Habituales */}
              <div className="space-y-1 relative">
                <label className="block text-xs font-bold text-slate-300">
                  Seleccionar Cliente Habitual *
                </label>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    placeholder="Escribe el nombre del cliente para buscar..."
                    value={clientSearchTerm}
                    onChange={(e) => {
                      setClientSearchTerm(e.target.value);
                      if (selectedClientId) setSelectedClientId("");
                    }}
                    className="w-full pl-9 pr-3 py-2.5 text-xs bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-amber-500 font-medium"
                  />
                </div>

                {/* Desplegable de coincidencias */}
                {matchingClients.length > 0 && !selectedClientId && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-20 max-h-48 overflow-y-auto p-1.5 space-y-1">
                    {matchingClients.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSelectedClientId(c.id);
                          setClientSearchTerm(c.name);
                        }}
                        className="w-full text-left p-2 rounded-lg hover:bg-slate-700 text-xs flex items-center justify-between"
                      >
                        <span className="font-bold text-white">{c.name}</span>
                        <span className="text-[10px] text-slate-400 line-clamp-1">{c.address.split(",")[0]}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Ficha rápida del cliente seleccionado */}
              {selectedClient && (
                <div className="p-3 rounded-2xl bg-slate-800/60 border border-slate-700/80 text-xs space-y-1">
                  <div className="font-bold text-amber-400 flex items-center justify-between">
                    <span>{selectedClient.name}</span>
                    <span className="text-slate-400 font-normal">{selectedClient.phone}</span>
                  </div>
                  <p className="text-slate-300 text-[11px]">📍 {selectedClient.address}</p>
                  {selectedClient.internalNotes && (
                    <p className="text-[10px] text-amber-300 italic">“{selectedClient.internalNotes}”</p>
                  )}
                </div>
              )}

              {/* Cantidad de Sacos Sueltos y Cálculo de Peso en Vivo */}
              <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700/70 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-200">
                    Cantidad de Sacos (15 kg/saco)
                  </label>
                  <span className="text-xs font-mono font-bold text-amber-400">
                    {currentOrderKg.toLocaleString("es-ES")} kg
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSacksInput((s) => Math.max(1, s - 5))}
                    className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold"
                  >
                    -5
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={sacksInput}
                    onChange={(e) => setSacksInput(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-full text-center text-xl font-black py-2 rounded-xl bg-slate-900 border border-slate-700 text-amber-400 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setSacksInput((s) => s + 5)}
                    className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold"
                  >
                    +5
                  </button>
                </div>

                <div className="text-[11px] text-slate-400 flex items-center justify-between">
                  <span>Ocupación de furgón:</span>
                  <span className="font-bold text-white">{currentOrderOccupancyPercent}% de 1 viaje</span>
                </div>
              </div>

              {/* Observaciones del Pedido */}
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Notas del Pedido (Cobro / Descarga)
                </label>
                <input
                  type="text"
                  placeholder="Ej. Cobrar 175€ en efectivo, dejar en porche..."
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-amber-500"
                />
              </div>

              <button
                type="submit"
                disabled={!selectedClientId}
                className="w-full py-3 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-slate-950 font-black text-xs transition flex items-center justify-center gap-1.5 shadow-lg shadow-amber-600/20"
              >
                <Plus className="w-4 h-4" />
                Registrar Pedido ({currentOrderKg} kg)
              </button>
            </form>
          </div>

          {/* Cola de Pedidos Pendientes */}
          <div className="lg:col-span-7 bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-sm font-black uppercase tracking-wider text-white">
                Pedidos en Cola ({pendingOrders.length})
              </h2>
              <span className="text-xs text-slate-400">
                Total: <strong className="text-amber-400">{totalPendingSacks} sacos</strong>
              </span>
            </div>

            {pendingOrders.length === 0 ? (
              <div className="p-12 text-center text-slate-500 text-xs">
                No hay pedidos pendientes en la cola. Añade uno con el formulario.
              </div>
            ) : (
              <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                {pendingOrders.map((ord, idx) => (
                  <div
                    key={ord.id}
                    className="p-4 rounded-2xl bg-slate-800/80 border border-slate-700/80 hover:border-slate-600 transition flex items-start justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-slate-400">#{idx + 1}</span>
                        <span className="font-extrabold text-white text-sm">{ord.client.name}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold">
                          {ord.sacks} sacos ({ord.totalWeightKg} kg)
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>{ord.client.address}</span>
                      </p>
                      {ord.orderNotes && (
                        <p className="text-[11px] text-amber-300/90 italic">“{ord.orderNotes}”</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleUpdateOrderStatus(ord.id, "Completado")}
                        title="Marcar completado"
                        className="p-2 rounded-xl text-slate-400 hover:text-emerald-400 hover:bg-slate-700 transition"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteOrder(ord.id)}
                        title="Eliminar pedido"
                        className="p-2 rounded-xl text-slate-400 hover:text-red-400 hover:bg-slate-700 transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        </>
        )}
      </main>

      {/* Modales */}
      <BackupModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        onDataRestored={refreshData}
      />

      <ClientManagementModal
        isOpen={isClientsModalOpen}
        onClose={() => setIsClientsModalOpen(false)}
        clients={clients}
        onSaveClient={async (c) => {
          await pelletVanStorage.saveClient(c);
          await refreshData();
        }}
        onDeleteClient={async (id) => {
          await pelletVanStorage.deleteClient(id);
          await refreshData();
        }}
      />
    </div>
  );
}
