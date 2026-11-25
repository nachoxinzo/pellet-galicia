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
import { buildTechTerminalUrl } from "@/utils/galiciaUrlCodec";
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
    showToast("Cliente eliminado de la cartera local");
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
    showToast(`${orderIds.length} partes marcados como completados`);
  };

  const handleMarkInRoute = (orderIds: string[]) => {
    galiciaStorage.markOrdersInRoute(orderIds);
    refreshAll();
    showToast(
      `Turno despachado (${orderIds.length} avisos en estado 'En Ruta')`
    );
  };

  const handleReconcileReturnReceipt = (receipt: DecodedReturnReceipt) => {
    const res = galiciaStorage.reconcileReturnReceipt(receipt);
    refreshAll();
    if (res.matchedOrderIds.length > 0) {
      showToast(
        `Cierre SAT conciliado: ${res.matchedOrderIds.length} partes (${res.totalMinutesRecorded} min · ${res.totalCashRecordedEur.toFixed(2)} €)`
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
      showToast("Copia de seguridad JSON descargada");
    } catch (err) {
      console.error("Error descargando backup rápido:", err);
    }
  };

  const pendingOrders = useMemo(
    () =>
      orders.filter((o) => o.status === "Pendiente" || o.status === "En Ruta"),
    [orders]
  );
  const completedOrders = useMemo(
    () => orders.filter((o) => o.status === "Completado"),
    [orders]
  );

  // URL dinámica al Terminal del Técnico llevando los avisos activos si existen
  const dynamicTechHref = useMemo(() => {
    if (!isLoaded || pendingOrders.length === 0) return "/tecnico";
    return buildTechTerminalUrl(pendingOrders, config);
  }, [isLoaded, pendingOrders, config]);

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
      estFuelCostEur: Number(estFuelCostEur.toFixed(2)),
      netMarginTotalEur,
      marginPercent,
    };
  }, [orders, completedOrders, pendingOrders, config]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans print:bg-white print:text-slate-950">
      {/* HEADER LIMPIO */}
      <header className="border-b border-white/[0.08] bg-slate-950/85 backdrop-blur-md sticky top-0 z-30 px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950 shadow-lg shadow-amber-500/15">
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black tracking-tight text-white">
                SAT<span className="text-amber-400">Ruta</span>
              </h1>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                Local-First
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Asistencia Técnica en Campo
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {isLoaded && backupStatus.needsBackupAlert && (
            <button
              type="button"
              onClick={handleQuickExportBackup}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/35 text-xs font-semibold transition"
              title="Descargar copia de seguridad JSON en el ordenador"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>Guardar copia de seguridad</span>
              <Download className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            </button>
          )}

          <a
            href={dynamicTechHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-amber-400 border border-amber-500/30 font-bold text-xs transition"
          >
            <span>
              Abrir Terminal Técnico
              {pendingOrders.length > 0 ? ` (${pendingOrders.length})` : ""}
            </span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </header>

      {/* CUERPO PRINCIPAL */}
      <main className="max-w-6xl w-full mx-auto p-4 sm:p-6 space-y-5 flex-1">
        {/* FRANJA COMPACTA DE 4 KPIs (2 NIVELES) */}
        {isLoaded && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 print:hidden">
            <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-slate-900/55 border border-white/[0.07]">
              <div className="p-2 rounded-xl bg-amber-500/12 text-amber-400 shrink-0">
                <ClipboardCheck className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-xs text-slate-400 block truncate">
                  Avisos activos / cerrados
                </span>
                <div className="text-base sm:text-lg font-bold text-white tabular-nums flex items-center gap-2 flex-wrap">
                  <span>
                    {satSummary.activeCount} / {satSummary.completedCount}
                  </span>
                  {satSummary.urgentActiveCount > 0 && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400">
                      {satSummary.urgentActiveCount} urg.
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-slate-900/55 border border-white/[0.07]">
              <div className="p-2 rounded-xl bg-emerald-500/12 text-emerald-400 shrink-0">
                <Coins className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-xs text-slate-400 block truncate">
                  Facturación prevista
                </span>
                <div className="text-base sm:text-lg font-bold text-emerald-400 tabular-nums truncate">
                  {satSummary.totalEstimatedRevenueEur.toLocaleString("es-ES", {
                    minimumFractionDigits: 2,
                  })}{" "}
                  €
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-slate-900/55 border border-white/[0.07]">
              <div className="p-2 rounded-xl bg-sky-500/12 text-sky-400 shrink-0">
                <Fuel className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-xs text-slate-400 block truncate">
                  Desplazamiento est.
                </span>
                <div className="text-base sm:text-lg font-bold text-sky-400 tabular-nums truncate">
                  {satSummary.estFuelCostEur.toFixed(2)} €{" "}
                  <span className="text-xs font-normal text-slate-400">
                    ({satSummary.estRoadKm} km)
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-slate-900/55 border border-white/[0.07]">
              <div className="p-2 rounded-xl bg-emerald-500/12 text-emerald-400 shrink-0">
                <TrendingUp className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-xs text-slate-400 block truncate">
                  Margen neto est.
                </span>
                <div className="text-base sm:text-lg font-bold text-emerald-400 tabular-nums flex items-center gap-2">
                  <span>
                    {satSummary.netMarginTotalEur.toLocaleString("es-ES", {
                      minimumFractionDigits: 2,
                    })}{" "}
                    €
                  </span>
                  {satSummary.marginPercent > 0 && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">
                      {satSummary.marginPercent}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* NAVEGACIÓN ENTRE LAS 3 PESTAÑAS */}
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3 print:hidden">
          <div className="flex flex-wrap rounded-2xl bg-slate-900/70 border border-white/[0.08] p-1 gap-1">
            <button
              type="button"
              onClick={() => setActiveTab("orders")}
              className={`flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl text-xs font-bold transition ${
                activeTab === "orders"
                  ? "bg-amber-500 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <ClipboardCheck className="w-4 h-4" />
              <span>Avisos y Clientes</span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[11px] tabular-nums ${
                  activeTab === "orders"
                    ? "bg-slate-950/20 text-slate-950"
                    : "bg-slate-800 text-slate-300"
                }`}
              >
                {pendingOrders.length}
              </span>
              <kbd className="hidden md:inline-block px-1.5 py-0.5 text-[10px] rounded bg-slate-950/50 text-slate-400 font-mono">
                Alt+1
              </kbd>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("planner")}
              className={`flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl text-xs font-bold transition ${
                activeTab === "planner"
                  ? "bg-amber-500 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <RouteIcon className="w-4 h-4" />
              <span>Planificador de Jornadas</span>
              <kbd className="hidden md:inline-block px-1.5 py-0.5 text-[10px] rounded bg-slate-950/50 text-slate-400 font-mono">
                Alt+2
              </kbd>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("config")}
              className={`flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl text-xs font-bold transition ${
                activeTab === "config"
                  ? "bg-amber-500 text-slate-950 shadow-md"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Settings className="w-4 h-4" />
              <span>Configuración y Backup</span>
              <kbd className="hidden md:inline-block px-1.5 py-0.5 text-[10px] rounded bg-slate-950/50 text-slate-400 font-mono">
                Alt+3
              </kbd>
            </button>
          </div>
        </div>

        {/* RENDERIZADO DINÁMICO */}
        {!isLoaded ? (
          <div className="p-12 text-center text-slate-500 text-sm">
            Cargando base de datos local de SATRuta...
          </div>
        ) : (
          <>
            {activeTab === "orders" && (
              <CustomerOrdersTab
                customers={customers}
                orders={orders}
                config={config}
                maxWorkdayMinutes={config.maxWorkdayMinutes}
                onSaveCustomer={handleSaveCustomer}
                onDeleteCustomer={handleDeleteCustomer}
                onSaveOrder={handleSaveOrder}
                onUpdateOrder={handleUpdateOrder}
                onUpdateOrderDuration={handleUpdateOrderDuration}
                onDeleteOrder={handleDeleteOrder}
                onUpdateOrderStatus={handleUpdateOrderStatus}
                onNavigateToPlanner={() => setActiveTab("planner")}
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

      {/* TOAST NO INTRUSIVO */}
      {adminToast && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900/95 backdrop-blur border border-emerald-500/40 text-emerald-300 px-4 py-3 rounded-2xl shadow-2xl text-xs font-semibold flex items-center gap-2.5 print:hidden">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{adminToast}</span>
        </div>
      )}

      <footer className="border-t border-white/[0.06] px-6 py-4 text-center text-xs text-slate-500 print:hidden">
        SATRuta · Asistencia Técnica en Campo · Local-First & Zero-Cloud
      </footer>
    </div>
  );
}
