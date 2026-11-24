"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Customer,
  ServiceOrder,
  ServiceType,
  OrderPriority,
  DecodedReturnReceipt,
  TechnicianConfig,
} from "@/types/pelletGalicia";
import { galiciaStorage, BackupAlertStatus } from "@/services/galiciaStorage";
import { estimateRoadDistanceKm } from "@/utils/galiciaRoutingEngine";
import CustomerOrdersTab from "@/components/admin/CustomerOrdersTab";
import RoutePlannerTab from "@/components/admin/RoutePlannerTab";
import ConfigBackupTab from "@/components/admin/ConfigBackupTab";
import {
  Wrench,
  ClipboardCheck,
  Route as RouteIcon,
  Settings,
  ExternalLink,
  AlertTriangle,
  Download,
  Coins,
  Fuel,
  TrendingUp,
  CheckCircle2,
} from "lucide-react";

type AdminActiveTab = "orders" | "planner" | "config";

export default function PelletGaliciaAdminDashboard() {
  const [activeTab, setActiveTab] = useState<AdminActiveTab>("orders");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [config, setConfig] = useState<TechnicianConfig>(
    galiciaStorage.getConfig()
  );
  const [backupStatus, setBackupStatus] = useState<BackupAlertStatus>({
    lastBackupAt: null,
    daysSinceBackup: null,
    ordersSinceBackup: 0,
    needsBackupAlert: false,
  });
  const [isLoaded, setIsLoaded] = useState(false);
  const [adminToast, setAdminToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setAdminToast(msg);
    setTimeout(() => {
      setAdminToast((prev) => (prev === msg ? null : prev));
    }, 4000);
  };

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

  // Atajos de teclado rápidos Alt+1, Alt+2, Alt+3
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key === "1") {
        e.preventDefault();
        setActiveTab("orders");
      } else if (e.altKey && e.key === "2") {
        e.preventDefault();
        setActiveTab("planner");
      } else if (e.altKey && e.key === "3") {
        e.preventDefault();
        setActiveTab("config");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSaveCustomer = (data: any) => {
    const saved = galiciaStorage.saveCustomer(data);
    refreshAll();
    return saved;
  };

  const handleDeleteCustomer = (id: string) => {
    galiciaStorage.deleteCustomer(id);
    refreshAll();
    showToast("🗑️ Cliente eliminado de la cartera local");
  };

  const handleSaveOrder = (
    customerId: string,
    payload: {
      serviceType?: ServiceType;
      priority?: OrderPriority;
      equipmentInfo?: string;
      estimatedMinutes?: number;
      estimatedPriceEur?: number;
      technicalNotes?: string;
    }
  ) => {
    galiciaStorage.saveOrder(customerId, payload);
    refreshAll();
  };

  const handleUpdateOrder = (
    orderId: string,
    updates: {
      serviceType?: ServiceType;
      priority?: OrderPriority;
      equipmentInfo?: string;
      estimatedMinutes?: number;
      estimatedPriceEur?: number;
      technicalNotes?: string;
      status?: ServiceOrder["status"];
    }
  ) => {
    galiciaStorage.updateOrder(orderId, updates);
    refreshAll();
  };

  const handleUpdateOrderDuration = (
    orderId: string,
    deltaOrExact: number,
    isDelta = false
  ) => {
    galiciaStorage.updateOrderDuration(orderId, deltaOrExact, isDelta);
    refreshAll();
  };

  const handleDeleteOrder = (id: string) => {
    galiciaStorage.deleteOrder(id);
    refreshAll();
  };

  const handleUpdateOrderStatus = (
    id: string,
    status: ServiceOrder["status"]
  ) => {
    galiciaStorage.updateOrderStatus(id, status);
    refreshAll();
  };

  const handleMarkCompleted = (orderIds: string[]) => {
    galiciaStorage.markOrdersCompleted(orderIds);
    refreshAll();
    showToast(`✅ ${orderIds.length} partes marcados como completados`);
  };

  const handleMarkInRoute = (orderIds: string[]) => {
    galiciaStorage.markOrdersInRoute(orderIds);
    refreshAll();
    showToast(
      `🚐 Turno despachado (${orderIds.length} avisos en estado 'En Ruta')`
    );
  };

  const handleReconcileReturnReceipt = (receipt: DecodedReturnReceipt) => {
    const res = galiciaStorage.reconcileReturnReceipt(receipt);
    refreshAll();
    if (res.matchedOrderIds.length > 0) {
      showToast(
        `📥 Cierre SAT conciliado: ${res.matchedOrderIds.length} partes (${res.totalMinutesRecorded} min · ${res.totalCashRecordedEur.toFixed(2)} € cobrados)`
      );
    }
    return res;
  };

  const handleSaveConfig = (partial: Partial<TechnicianConfig>) => {
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
      a.download = `SATRuta_Backup_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      refreshAll();
      showToast("💾 Copia de seguridad JSON descargada en tu equipo");
    } catch (err) {
      console.error("Error descargando backup rápido:", err);
    }
  };

  const pendingOrders = orders.filter(
    (o) => o.status === "Pendiente" || o.status === "En Ruta"
  );
  const completedOrders = orders.filter((o) => o.status === "Completado");

  // Métricas globales de actividad SAT
  const satSummary = useMemo(() => {
    const urgentActiveCount = pendingOrders.filter(
      (o) => o.priority === "Urgente"
    ).length;

    const completedRevenueEur = completedOrders.reduce(
      (s, o) => s + (o.collectedPriceEur ?? o.estimatedPriceEur ?? 0),
      0
    );
    const pendingRevenueEur = pendingOrders.reduce(
      (s, o) => s + (o.estimatedPriceEur ?? 0),
      0
    );
    const totalEstimatedRevenueEur = completedRevenueEur + pendingRevenueEur;

    const consumoL100 = config.consumoL100 ?? 7.5;
    const dieselPrice = config.precioCombustible ?? 1.55;
    const hourlyCost = config.hourlyCostEur ?? 0;

    let estRoadKm = 0;
    let totalWorkMinutes = 0;
    orders.forEach((o) => {
      const oneWayKm = estimateRoadDistanceKm(
        config.warehouseCoordinates,
        o.customer.coordinates
      );
      estRoadKm += Math.max(2, oneWayKm * 1.15);
      totalWorkMinutes += o.actualMinutes ?? o.estimatedMinutes ?? 45;
    });

    const estFuelLiters = (estRoadKm / 100) * consumoL100;
    const estFuelCostEur = estFuelLiters * dieselPrice;
    const estLaborCostEur =
      hourlyCost > 0 ? (totalWorkMinutes / 60) * hourlyCost : 0;

    const netMarginCompletedEur = Number(
      (completedRevenueEur - estFuelCostEur - estLaborCostEur).toFixed(2)
    );
    const netMarginTotalEur = Number(
      (totalEstimatedRevenueEur - estFuelCostEur - estLaborCostEur).toFixed(2)
    );
    const marginPercent =
      totalEstimatedRevenueEur > 0
        ? Math.max(
            0,
            Math.round((netMarginTotalEur / totalEstimatedRevenueEur) * 100)
          )
        : 0;

    return {
      activeCount: pendingOrders.length,
      completedCount: completedOrders.length,
      urgentActiveCount,
      completedRevenueEur: Number(completedRevenueEur.toFixed(2)),
      totalEstimatedRevenueEur: Number(totalEstimatedRevenueEur.toFixed(2)),
      estRoadKm: Math.round(estRoadKm),
      estFuelLiters: Number(estFuelLiters.toFixed(1)),
      estFuelCostEur: Number(estFuelCostEur.toFixed(2)),
      netMarginCompletedEur,
      netMarginTotalEur,
      marginPercent,
    };
  }, [orders, completedOrders, pendingOrders, config]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans print:bg-white print:text-slate-950">
      {/* BARRA SUPERIOR ADMIN */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-30 px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950 shadow-lg shadow-amber-500/20 font-black">
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black tracking-tight text-white">
                SAT<span className="text-amber-400">Ruta</span>
              </h1>
              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                Zero-Cloud
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Asistencia Técnica en Campo • Averías y Revisiones • Local-First
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
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
            href="/tecnico"
            target="_blank"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-black text-xs transition shadow-md shadow-amber-600/20"
          >
            <span>Ver Terminal /tecnico</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </header>

      {/* CUERPO PRINCIPAL */}
      <main className="max-w-6xl w-full mx-auto p-4 sm:p-6 space-y-5 flex-1">
        {/* BARRA DE 4 KPIs SAT */}
        {isLoaded && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-slate-900/90 border border-slate-800 p-3.5 rounded-3xl shadow-lg print:hidden">
            {/* KPI 1: Avisos Activos / Completados */}
            <div className="flex items-center gap-3 p-2.5 rounded-2xl bg-slate-950/80 border border-slate-800/90">
              <div className="p-2.5 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30 shrink-0">
                <ClipboardCheck className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Avisos Activos / Cerrados
                </span>
                <div className="text-sm font-black text-white truncate">
                  {satSummary.activeCount} activos · {satSummary.completedCount} cerrados
                </div>
                <span
                  className={`text-[10px] block truncate font-bold ${
                    satSummary.urgentActiveCount > 0
                      ? "text-rose-400"
                      : "text-slate-400"
                  }`}
                >
                  {satSummary.urgentActiveCount > 0
                    ? `🚨 ${satSummary.urgentActiveCount} averías urgentes en cola`
                    : `Cartera: ${customers.length} clientes / equipos`}
                </span>
              </div>
            </div>

            {/* KPI 2: Facturación Estimada */}
            <div className="flex items-center gap-3 p-2.5 rounded-2xl bg-slate-950/80 border border-slate-800/90">
              <div className="p-2.5 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
                <Coins className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Facturación Estimada
                </span>
                <div className="text-sm font-black text-emerald-400 truncate">
                  {satSummary.completedRevenueEur.toLocaleString("es-ES", {
                    minimumFractionDigits: 2,
                  })}{" "}
                  €{" "}
                  <span className="text-[10px] text-slate-400 font-normal">
                    cobrados
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 block truncate">
                  Total c/ cola:{" "}
                  {satSummary.totalEstimatedRevenueEur.toLocaleString("es-ES", {
                    minimumFractionDigits: 2,
                  })}{" "}
                  € previstos
                </span>
              </div>
            </div>

            {/* KPI 3: Coste Desplazamiento */}
            <div className="flex items-center gap-3 p-2.5 rounded-2xl bg-slate-950/80 border border-slate-800/90">
              <div className="p-2.5 rounded-xl bg-sky-500/15 text-sky-400 border border-sky-500/30 shrink-0">
                <Fuel className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Coste Desplazamiento Est.
                </span>
                <div className="text-sm font-black text-sky-400 truncate">
                  {satSummary.estFuelCostEur.toFixed(2)} €{" "}
                  <span className="text-xs text-slate-300 font-mono">
                    (~{satSummary.estRoadKm} km)
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 block truncate">
                  {satSummary.estFuelLiters} L est. • Backup:{" "}
                  {backupStatus.lastBackupAt
                    ? `hace ${backupStatus.daysSinceBackup ?? 0}d`
                    : "pendiente"}
                </span>
              </div>
            </div>

            {/* KPI 4: Margen Neto Estimado */}
            <div className="flex items-center gap-3 p-2.5 rounded-2xl bg-slate-950/80 border border-emerald-500/30">
              <div className="p-2.5 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
                <TrendingUp className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Margen Neto Est.
                  </span>
                  {satSummary.marginPercent > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 font-mono text-[9px] font-black">
                      {satSummary.marginPercent}%
                    </span>
                  )}
                </div>
                <div className="text-sm font-black text-emerald-400 truncate">
                  {satSummary.netMarginTotalEur.toLocaleString("es-ES", {
                    minimumFractionDigits: 2,
                  })}{" "}
                  €
                </div>
                <span className="text-[10px] text-slate-400 block truncate">
                  Ya cerrado neto:{" "}
                  {satSummary.netMarginCompletedEur.toFixed(2)} €
                </span>
              </div>
            </div>
          </div>
        )}

        {/* NAVEGACIÓN ENTRE LAS 3 PESTAÑAS */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 print:hidden">
          <div className="flex flex-wrap rounded-2xl bg-slate-900 border border-slate-800 p-1 gap-1">
            <button
              type="button"
              onClick={() => setActiveTab("orders")}
              className={`flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl text-xs font-black transition ${
                activeTab === "orders"
                  ? "bg-amber-600 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <ClipboardCheck className="w-4 h-4" />
              <span>Avisos y Clientes</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-300">
                {pendingOrders.length}
              </span>
              <kbd className="hidden md:inline-block px-1.5 py-0.5 text-[9px] rounded bg-slate-950/60 text-slate-300 font-mono">
                Alt+1
              </kbd>
            </button>

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
              <span>Planificador de Jornadas</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-800 text-amber-400 font-bold">
                OSRM + Satélite
              </span>
              <kbd className="hidden md:inline-block px-1.5 py-0.5 text-[9px] rounded bg-slate-950/60 text-slate-300 font-mono">
                Alt+2
              </kbd>
            </button>

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
              <kbd className="hidden md:inline-block px-1.5 py-0.5 text-[9px] rounded bg-slate-950/60 text-slate-300 font-mono">
                Alt+3
              </kbd>
            </button>
          </div>
        </div>

        {/* RENDERIZADO DINÁMICO */}
        {!isLoaded ? (
          <div className="p-12 text-center text-slate-500 text-xs">
            Cargando base de datos local de SATRuta...
          </div>
        ) : (
          <>
            {activeTab === "orders" && (
              <CustomerOrdersTab
                customers={customers}
                orders={orders}
                maxWorkdayMinutes={config.maxWorkdayMinutes}
                onSaveCustomer={handleSaveCustomer}
                onDeleteCustomer={handleDeleteCustomer}
                onSaveOrder={handleSaveOrder}
                onUpdateOrder={handleUpdateOrder}
                onUpdateOrderDuration={handleUpdateOrderDuration}
                onDeleteOrder={handleDeleteOrder}
                onUpdateOrderStatus={handleUpdateOrderStatus}
              />
            )}

            {activeTab === "planner" && (
              <RoutePlannerTab
                orders={orders}
                config={config}
                onMarkCompleted={handleMarkCompleted}
                onMarkInRoute={handleMarkInRoute}
                onReconcileReturnReceipt={handleReconcileReturnReceipt}
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

      {/* TOAST NO INTRUSIVO FLOTANTE */}
      {adminToast && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 border-2 border-emerald-500/70 text-emerald-300 px-4 py-3 rounded-2xl shadow-2xl text-xs font-black flex items-center gap-2.5 animate-in fade-in slide-in-from-bottom-4 duration-200 print:hidden">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{adminToast}</span>
        </div>
      )}

      {/* PIE DE PÁGINA */}
      <footer className="border-t border-slate-900 px-6 py-4 text-center text-[11px] text-slate-500 print:hidden">
        SATRuta • Asistencia Técnica en Campo (Averías y Revisiones) • Local-First & Zero-Cloud
      </footer>
    </div>
  );
}
