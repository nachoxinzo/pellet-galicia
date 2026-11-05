"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Customer, PendingOrder, VanConfig } from "@/types/pelletGalicia";
import { galiciaStorage, BackupAlertStatus } from "@/services/galiciaStorage";
import { estimateRoadDistanceKm } from "@/utils/galiciaRoutingEngine";
import CustomerOrdersTab from "@/components/admin/CustomerOrdersTab";
import RoutePlannerTab from "@/components/admin/RoutePlannerTab";
import ConfigBackupTab from "@/components/admin/ConfigBackupTab";
import {
  Truck,
  Package,
  Route as RouteIcon,
  Settings,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  Download,
  Coins,
  Fuel,
  Scale,
} from "lucide-react";

type AdminActiveTab = "orders" | "planner" | "config";

export default function PelletGaliciaAdminDashboard() {
  const [activeTab, setActiveTab] = useState<AdminActiveTab>("orders");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [config, setConfig] = useState<VanConfig>(galiciaStorage.getConfig());
  const [backupStatus, setBackupStatus] = useState<BackupAlertStatus>({
    lastBackupAt: null,
    daysSinceBackup: null,
    ordersSinceBackup: 0,
    needsBackupAlert: false,
  });
  const [isLoaded, setIsLoaded] = useState(false);

  const refreshAll = () => {
    setCustomers(galiciaStorage.getCustomers());
    setOrders(galiciaStorage.getOrders());
    setConfig(galiciaStorage.getConfig());
    setBackupStatus(galiciaStorage.getBackupAlertStatus());
  };

  useEffect(() => {
    refreshAll();
    setIsLoaded(true);
  }, []);

  const handleSaveCustomer = (data: any) => {
    const saved = galiciaStorage.saveCustomer(data);
    refreshAll();
    return saved;
  };

  const handleDeleteCustomer = (id: string) => {
    galiciaStorage.deleteCustomer(id);
    refreshAll();
  };

  const handleSaveOrder = (customerId: string, sacks: number, notes?: string) => {
    galiciaStorage.saveOrder(customerId, sacks, notes);
    refreshAll();
  };

  const handleUpdateOrder = (
    orderId: string,
    updates: {
      sacks?: number;
      orderNotes?: string;
      status?: PendingOrder["status"];
    }
  ) => {
    galiciaStorage.updateOrder(orderId, updates);
    refreshAll();
  };

  const handleUpdateOrderSacks = (
    orderId: string,
    deltaOrExact: number,
    isDelta = false
  ) => {
    galiciaStorage.updateOrderSacks(orderId, deltaOrExact, isDelta);
    refreshAll();
  };

  const handleDeleteOrder = (id: string) => {
    galiciaStorage.deleteOrder(id);
    refreshAll();
  };

  const handleUpdateOrderStatus = (id: string, status: PendingOrder["status"]) => {
    galiciaStorage.updateOrderStatus(id, status);
    refreshAll();
  };

  const handleMarkDelivered = (orderIds: string[]) => {
    galiciaStorage.markOrdersAsDelivered(orderIds);
    refreshAll();
  };

  const handleSaveConfig = (partial: Partial<VanConfig>) => {
    galiciaStorage.saveConfig(partial);
    refreshAll();
  };

  const handleQuickExportBackup = () => {
    try {
      const json = galiciaStorage.exportBackupJson();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const dateStr = new Date().toISOString().split("T")[0];
      a.href = url;
      a.download = `PelletGalicia_Backup_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      refreshAll();
    } catch (err) {
      console.error("Error descargando backup rápido:", err);
    }
  };

  const pendingOrders = orders.filter((o) => o.status === "Pendiente");
  const deliveredOrders = orders.filter((o) => o.status === "Completado");

  // 5. Métricas de Resumen de Campaña
  const campaignSummary = useMemo(() => {
    const deliveredSacks = deliveredOrders.reduce((s, o) => s + o.sacks, 0);
    const pendingSacks = pendingOrders.reduce((s, o) => s + o.sacks, 0);
    const totalCampaignSacks = deliveredSacks + pendingSacks;
    const deliveredTons = (deliveredSacks * 15) / 1000;
    const totalCampaignTons = (totalCampaignSacks * 15) / 1000;

    const pricePerSack = config.precioPorSaco ?? 4.5;
    const deliveredRevenueEur = deliveredSacks * pricePerSack;
    const totalCampaignRevenueEur = totalCampaignSacks * pricePerSack;

    const baseL100 = config.consumoVacioL100 ?? 8.5;
    const extraL100PerTon = config.extraConsumoPorTonelada ?? 2.2;
    const dieselPrice = config.precioCombustible ?? 1.55;

    // Estimación realista de coste de combustible acumulado sobre pedidos de la campaña
    let estFuelLiters = 0;
    orders.forEach((o) => {
      const oneWayKm = estimateRoadDistanceKm(
        config.warehouseCoordinates,
        o.customer.coordinates
      );
      // En rutas agrupadas cada parada supone ~1.15x su distancia directa prorrateada
      const effectiveKm = Math.max(2, oneWayKm * 1.15);
      const weightTons = (o.sacks * 15) / 1000;
      const rateL100 = baseL100 + weightTons * extraL100PerTon;
      estFuelLiters += (effectiveKm / 100) * rateL100;
    });

    const estFuelCostEur = estFuelLiters * dieselPrice;

    return {
      deliveredSacks,
      deliveredTons: Number(deliveredTons.toFixed(2)),
      totalCampaignSacks,
      totalCampaignTons: Number(totalCampaignTons.toFixed(2)),
      deliveredRevenueEur: Number(deliveredRevenueEur.toFixed(2)),
      totalCampaignRevenueEur: Number(totalCampaignRevenueEur.toFixed(2)),
      estFuelLiters: Number(estFuelLiters.toFixed(1)),
      estFuelCostEur: Number(estFuelCostEur.toFixed(2)),
      pricePerSack,
    };
  }, [orders, deliveredOrders, pendingOrders, config]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans print:bg-white print:text-slate-950">
      {/* BARRA SUPERIOR ADMIN */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-30 px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950 shadow-lg shadow-amber-500/20 font-black">
            <Truck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black tracking-tight text-white">
                Pellet<span className="text-amber-400">Galicia</span>
              </h1>
              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                Zero-Cloud
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Reparto Rural en Furgón • Local-First
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* 5. ALERTA DISCRETA EN CABECERA CUANDO HACE FALTA COPIA DE SEGURIDAD */}
          {isLoaded && backupStatus.needsBackupAlert && (
            <button
              type="button"
              onClick={handleQuickExportBackup}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/50 text-xs font-black transition animate-pulse"
              title="Haz clic para descargar ahora tu copia de seguridad JSON en el ordenador"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>⚠️ Recomendado descargar copia de seguridad</span>
              <Download className="w-3.5 h-3.5 text-amber-400 ml-0.5 shrink-0" />
            </button>
          )}

          <a
            href="/reparto"
            target="_blank"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-black text-xs transition shadow-md shadow-amber-600/20"
          >
            <span>Ver Móvil /reparto</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </header>

      {/* CUERPO PRINCIPAL CON 3 PESTAÑAS */}
      <main className="max-w-6xl w-full mx-auto p-4 sm:p-6 space-y-5 flex-1">
        {/* 5. BARRA DE RESUMEN DE CAMPAÑA */}
        {isLoaded && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-900/90 border border-slate-800 p-3.5 rounded-3xl shadow-lg print:hidden">
            {/* Métrica 1: Total Sacos Entregados (y Toneladas) */}
            <div className="flex items-center gap-3 p-2.5 rounded-2xl bg-slate-950/80 border border-slate-800/90">
              <div className="p-2.5 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30 shrink-0">
                <Scale className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Total Sacos Entregados (Toneladas)
                </span>
                <div className="text-sm font-black text-white truncate">
                  {campaignSummary.deliveredSacks} sacos{" "}
                  <span className="text-amber-400 font-mono text-xs">
                    ({campaignSummary.deliveredTons} t)
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 block">
                  En cola + entregados: {campaignSummary.totalCampaignSacks} sacos (
                  {campaignSummary.totalCampaignTons} t)
                </span>
              </div>
            </div>

            {/* Métrica 2: Ingresos Totales */}
            <div className="flex items-center gap-3 p-2.5 rounded-2xl bg-slate-950/80 border border-slate-800/90">
              <div className="p-2.5 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
                <Coins className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Ingresos Totales de Campaña
                </span>
                <div className="text-sm font-black text-emerald-400 truncate">
                  {campaignSummary.deliveredRevenueEur.toLocaleString("es-ES", {
                    minimumFractionDigits: 2,
                  })}{" "}
                  €{" "}
                  <span className="text-[10px] text-slate-400 font-normal">
                    entregados
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 block">
                  Total c/ pendientes:{" "}
                  {campaignSummary.totalCampaignRevenueEur.toLocaleString("es-ES", {
                    minimumFractionDigits: 2,
                  })}{" "}
                  € ({campaignSummary.pricePerSack.toFixed(2)} €/saco)
                </span>
              </div>
            </div>

            {/* Métrica 3: Coste de Combustible Estimado */}
            <div className="flex items-center gap-3 p-2.5 rounded-2xl bg-slate-950/80 border border-slate-800/90">
              <div className="p-2.5 rounded-xl bg-sky-500/15 text-sky-400 border border-sky-500/30 shrink-0">
                <Fuel className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Coste de Combustible Estimado
                </span>
                <div className="text-sm font-black text-sky-400 truncate">
                  {campaignSummary.estFuelCostEur.toFixed(2)} €{" "}
                  <span className="text-xs text-slate-300 font-mono">
                    (~{campaignSummary.estFuelLiters} L diésel)
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 block">
                  Clientes en cartera: {customers.length} • Backup:{" "}
                  {backupStatus.lastBackupAt
                    ? `hace ${backupStatus.daysSinceBackup ?? 0}d`
                    : "pendiente"}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* NAVEGACIÓN ENTRE LAS 3 PESTAÑAS */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 print:hidden">
          <div className="flex rounded-2xl bg-slate-900 border border-slate-800 p-1">
            {/* Pestaña 1: Pedidos y Clientes */}
            <button
              type="button"
              onClick={() => setActiveTab("orders")}
              className={`flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl text-xs font-black transition ${
                activeTab === "orders"
                  ? "bg-amber-600 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Package className="w-4 h-4" />
              <span>Pedidos y Clientes</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-300">
                {pendingOrders.length}
              </span>
            </button>

            {/* Pestaña 2: Planificador de Rutas */}
            <button
              type="button"
              onClick={() => setActiveTab("planner")}
              className={`flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl text-xs font-black transition ${
                activeTab === "planner"
                  ? "bg-amber-600 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <RouteIcon className="w-4 h-4" />
              <span>Planificador de Rutas</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-800 text-amber-400 font-bold">
                OSRM + Satélite
              </span>
            </button>

            {/* Pestaña 3: Configuración y Backup */}
            <button
              type="button"
              onClick={() => setActiveTab("config")}
              className={`flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl text-xs font-black transition ${
                activeTab === "config"
                  ? "bg-amber-600 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Settings className="w-4 h-4" />
              <span>Configuración y Backup</span>
            </button>
          </div>
        </div>

        {/* RENDERIZADO DINÁMICO */}
        {!isLoaded ? (
          <div className="p-12 text-center text-slate-500 text-xs">
            Cargando base de datos local de PelletGalicia...
          </div>
        ) : (
          <>
            {activeTab === "orders" && (
              <CustomerOrdersTab
                customers={customers}
                orders={orders}
                vanCapacitySacks={config.vanCapacitySacks}
                onSaveCustomer={handleSaveCustomer}
                onDeleteCustomer={handleDeleteCustomer}
                onSaveOrder={handleSaveOrder}
                onUpdateOrder={handleUpdateOrder}
                onUpdateOrderSacks={handleUpdateOrderSacks}
                onDeleteOrder={handleDeleteOrder}
                onUpdateOrderStatus={handleUpdateOrderStatus}
              />
            )}

            {activeTab === "planner" && (
              <RoutePlannerTab
                orders={orders}
                config={config}
                onMarkDelivered={handleMarkDelivered}
              />
            )}

            {activeTab === "config" && (
              <ConfigBackupTab
                config={config}
                onSaveConfig={handleSaveConfig}
                onRefreshAll={refreshAll}
              />
            )}
          </>
        )}
      </main>

      {/* PIE DE PÁGINA */}
      <footer className="border-t border-slate-900 px-6 py-4 text-center text-[11px] text-slate-500">
        PelletGalicia • Arquitectura Local-First & Zero-Cloud • OSRM + Satélite Esri
      </footer>
    </div>
  );
}
