"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Customer,
  ServiceOrder,
  ServiceType,
  OrderPriority,
  TimeSlot,
  DecodedReturnReceipt,
  TechnicianConfig,
  UserProfile,
  StorageQuotaStats,
} from "@/types/pelletGalicia";
import {
  galiciaStorage,
  DEFAULT_TECH_CONFIG,
} from "@/services/galiciaStorage";
import { cloudApi, CloudApiError } from "@/services/cloudApi";
import { estimateRoadDistanceKm } from "@/utils/galiciaRoutingEngine";
import CustomerOrdersTab from "@/components/admin/CustomerOrdersTab";
import RoutePlannerTab from "@/components/admin/RoutePlannerTab";
import ConfigBackupTab from "@/components/admin/ConfigBackupTab";
import {
  ClipboardCheck,
  Route as RouteIcon,
  Settings,
  ExternalLink,
  AlertTriangle,
  Coins,
  Fuel,
  TrendingUp,
  CheckCircle2,
  ShieldCheck,
  LogOut,
  UploadCloud,
  HardDrive,
  Loader2,
  PackageSearch,
} from "lucide-react";

type AdminActiveTab = "orders" | "planner" | "config";

function formatBytesToMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2);
}

export default function PelletGaliciaAdminDashboard() {
  const [activeTab, setActiveTab] = useState<AdminActiveTab>("orders");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [config, setConfig] = useState<TechnicianConfig>(DEFAULT_TECH_CONFIG);
  const [currentProfile, setCurrentProfile] = useState<UserProfile | null>(
    null
  );
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [canManageAuthUsers, setCanManageAuthUsers] = useState(false);
  const [storageStats, setStorageStats] = useState<StorageQuotaStats | null>(
    null
  );

  const [isLoaded, setIsLoaded] = useState(false);
  const [requestedQueueFilter, setRequestedQueueFilter] = useState<
    "ACTIVOS" | "REPUESTOS" | "Completado" | "ALL" | undefined
  >(undefined);
  const [adminToast, setAdminToast] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);

  // Migración opcional desde localStorage antiguo
  const [localLegacyCounts, setLocalLegacyCounts] = useState<{
    customers: number;
    orders: number;
  }>({ customers: 0, orders: 0 });
  const [isMigratingLocal, setIsMigratingLocal] = useState(false);
  const [dismissedLocalBanner, setDismissedLocalBanner] = useState(false);

  const showToast = useCallback(
    (text: string, type: "success" | "error" = "success") => {
      setAdminToast({ text, type });
      setTimeout(() => {
        setAdminToast((prev) => (prev?.text === text ? null : prev));
      }, 4500);
    },
    []
  );

  const handleApiError = useCallback(
    (err: unknown, fallbackMsg: string) => {
      if (err instanceof CloudApiError) {
        showToast(err.message, "error");
      } else {
        console.error(fallbackMsg, err);
        showToast(fallbackMsg, "error");
      }
    },
    [showToast]
  );

  const refreshAll = useCallback(async () => {
    try {
      const [meRes, custList, ordList, cfg, statsRes, usersRes] =
        await Promise.all([
          cloudApi.getMe(),
          cloudApi.getCustomers(),
          cloudApi.getOrders(),
          cloudApi.getConfig(),
          cloudApi.getStorageStats(),
          cloudApi.getUsers(),
        ]);

      setCurrentProfile(meRes.profile);
      setCustomers(custList);
      setOrders(ordList);
      setConfig(cfg);
      setStorageStats(statsRes);
      setUsers(usersRes.users);
      setCanManageAuthUsers(usersRes.canManageAuthUsers);
    } catch (err) {
      handleApiError(err, "Error sincronizando datos con Supabase");
    }
  }, [handleApiError]);

  useEffect(() => {
    let active = true;
    (async () => {
      await refreshAll();
      if (active) {
        try {
          const localCusts = galiciaStorage.getCustomers();
          const localOrds = galiciaStorage.getOrders();
          const alreadyMigrated =
            typeof window !== "undefined" &&
            localStorage.getItem("satruta_cloud_migrated_v1") === "true";

          if (
            !alreadyMigrated &&
            (localCusts.length > 0 || localOrds.length > 0)
          ) {
            setLocalLegacyCounts({
              customers: localCusts.length,
              orders: localOrds.length,
            });
          }
        } catch {
          // ignore
        }
        setIsLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshAll]);

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

  const handleMigrateLocalToCloud = async () => {
    setIsMigratingLocal(true);
    try {
      const localCusts = galiciaStorage.getCustomers();
      const localOrds = galiciaStorage.getOrders();
      const localCfg = galiciaStorage.getConfig();

      const res = await cloudApi.migrateLocalData({
        customers: localCusts,
        orders: localOrds,
        config: localCfg,
      });

      if (typeof window !== "undefined") {
        localStorage.setItem("satruta_cloud_migrated_v1", "true");
      }
      setLocalLegacyCounts({ customers: 0, orders: 0 });
      await refreshAll();
      showToast(
        `Migración completada: ${res.importedCustomers} clientes y ${res.importedOrders} avisos subidos a la nube`
      );
    } catch (err) {
      handleApiError(err, "Error migrando datos locales");
    } finally {
      setIsMigratingLocal(false);
    }
  };

  const handleSaveCustomer = async (
    data: Omit<Customer, "id" | "createdAt" | "updatedAt"> & { id?: string }
  ): Promise<Customer | void> => {
    try {
      const saved = await cloudApi.saveCustomer(data);
      await refreshAll();
      return saved;
    } catch (err) {
      handleApiError(err, "Error guardando cliente");
    }
  };

  const handleDeleteCustomer = async (id: string) => {
    try {
      await cloudApi.deleteCustomer(id);
      await refreshAll();
      showToast("Cliente eliminado definitivamente de la nube (RGPD)");
    } catch (err) {
      handleApiError(err, "Error eliminando cliente");
    }
  };

  const handleSaveOrder = async (
    customerId: string,
    payload: {
      assignedTechId?: string | null;
      serviceType?: ServiceType;
      priority?: OrderPriority;
      equipmentInfo?: string;
      estimatedMinutes?: number;
      estimatedPriceEur?: number;
      technicalNotes?: string;
      scheduledDate?: string | null;
      timeSlot?: TimeSlot;
    }
  ) => {
    try {
      await cloudApi.createOrder(customerId, payload);
      await refreshAll();
    } catch (err) {
      handleApiError(err, "Error guardando parte de trabajo");
      throw err;
    }
  };

  const handleUpdateOrder = async (
    orderId: string,
    updates: {
      assignedTechId?: string | null;
      serviceType?: ServiceType;
      priority?: OrderPriority;
      equipmentInfo?: string;
      estimatedMinutes?: number;
      estimatedPriceEur?: number;
      technicalNotes?: string;
      scheduledDate?: string | null;
      timeSlot?: TimeSlot;
      needsParts?: boolean;
      partsNote?: string;
      status?: ServiceOrder["status"];
    }
  ) => {
    try {
      await cloudApi.updateOrder(orderId, updates);
      await refreshAll();
    } catch (err) {
      handleApiError(err, "Error actualizando parte");
      throw err;
    }
  };

  const handleUpdateOrderDuration = async (
    orderId: string,
    deltaOrExact: number,
    isDelta = false
  ) => {
    try {
      const target = orders.find((o) => o.id === orderId);
      if (!target) return;
      const estimatedMinutes = isDelta
        ? Math.max(15, Math.min(480, target.estimatedMinutes + deltaOrExact))
        : Math.max(15, Math.min(480, deltaOrExact));
      await cloudApi.updateOrder(orderId, { estimatedMinutes });
      await refreshAll();
    } catch (err) {
      handleApiError(err, "Error ajustando duración");
    }
  };

  const handleDeleteOrder = async (id: string) => {
    try {
      await cloudApi.deleteOrder(id);
      await refreshAll();
    } catch (err) {
      handleApiError(err, "Error eliminando aviso");
    }
  };

  const handleUpdateOrderStatus = async (
    id: string,
    status: ServiceOrder["status"]
  ) => {
    try {
      await cloudApi.updateOrder(id, { status });
      await refreshAll();
    } catch (err) {
      handleApiError(err, "Error cambiando estado del aviso");
    }
  };

  const handleMarkCompleted = async (orderIds: string[]) => {
    try {
      await cloudApi.batchUpdateOrderStatus(orderIds, "Completado");
      await refreshAll();
      showToast(`${orderIds.length} partes marcados como completados`);
    } catch (err) {
      handleApiError(err, "Error cerrando partes");
    }
  };

  const handleMarkInRoute = async (orderIds: string[]) => {
    try {
      await cloudApi.batchUpdateOrderStatus(orderIds, "En Ruta");
      await refreshAll();
      showToast(
        `Turno despachado (${orderIds.length} avisos en estado 'En Ruta')`
      );
    } catch (err) {
      handleApiError(err, "Error despachando turno");
    }
  };

  const handleReconcileReturnReceipt = (_receipt: DecodedReturnReceipt) => {
    showToast(
      "Los cierres del técnico ya se sincronizan automáticamente en la nube"
    );
    return {
      matchedOrderIds: [],
      totalMinutesRecorded: 0,
      totalCashRecordedEur: 0,
    };
  };

  const handleSaveConfig = async (
    partial: Partial<TechnicianConfig> & { clearGoogleMapsApiKey?: boolean }
  ) => {
    try {
      const updated = await cloudApi.saveConfig(partial);
      setConfig(updated);
      showToast("Configuración guardada en la nube");
    } catch (err) {
      handleApiError(err, "Error guardando configuración");
    }
  };

  const handleLogout = async () => {
    await cloudApi.logout();
    window.location.href = "/login";
  };

  const activeTechnicians = useMemo(
    () => users.filter((u) => u.isActive && u.role === "tecnico"),
    [users]
  );

  const pendingOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          (o.status === "Pendiente" || o.status === "En Ruta") && !o.needsParts
      ),
    [orders]
  );
  const missingPartsOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          (o.status === "Pendiente" || o.status === "En Ruta") && o.needsParts
      ),
    [orders]
  );
  const completedOrders = useMemo(
    () => orders.filter((o) => o.status === "Completado"),
    [orders]
  );

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
          <img
            src="/logo-gregorio.png"
            alt="Ferretería Gregorio"
            className="w-11 h-11 rounded-full object-cover shadow-lg shadow-orange-500/20 ring-1 ring-orange-500/30 shrink-0"
          />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-black tracking-tight text-white">
                SAT<span className="text-amber-400">Ruta</span>
              </h1>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                <ShieldCheck className="w-3 h-3" />
                Nube Cifrada UE
              </span>
              {storageStats && (storageStats.is_warning || storageStats.is_blocked) && (
                <button
                  type="button"
                  onClick={() => setActiveTab("config")}
                  className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full border transition ${
                    storageStats.is_blocked
                      ? "bg-rose-500/15 text-rose-300 border-rose-500/40"
                      : "bg-amber-500/15 text-amber-300 border-amber-500/40"
                  }`}
                >
                  <HardDrive className="w-3 h-3" />
                  <span>
                    {formatBytesToMb(storageStats.used_bytes)} /{" "}
                    {formatBytesToMb(storageStats.limit_bytes)} MB
                  </span>
                </button>
              )}
            </div>
            <p className="text-xs text-slate-400">
              {currentProfile
                ? `${currentProfile.fullName || currentProfile.email} · Ferretería Gregorio`
                : "Ferretería Gregorio · Asistencia Técnica"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/tecnico"
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

          <button
            type="button"
            onClick={handleLogout}
            title="Cerrar sesión"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-white/[0.08] text-xs font-semibold transition"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </header>

      {/* CUERPO PRINCIPAL */}
      <main className="max-w-6xl w-full mx-auto p-4 sm:p-6 space-y-5 flex-1">
        {/* BANNER DE MIGRACIÓN DESDE LOCALSTORAGE (SI HAY DATOS LOCALES PREVIOS) */}
        {isLoaded &&
          !dismissedLocalBanner &&
          (localLegacyCounts.customers > 0 || localLegacyCounts.orders > 0) && (
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/35 flex flex-wrap items-center justify-between gap-3 print:hidden">
              <div className="flex items-center gap-3 text-xs text-amber-100">
                <UploadCloud className="w-5 h-5 text-amber-400 shrink-0" />
                <div>
                  <strong className="block text-sm text-white">
                    Se detectaron datos locales en este navegador
                  </strong>
                  <span className="text-amber-200/80">
                    Tienes {localLegacyCounts.customers} clientes y{" "}
                    {localLegacyCounts.orders} partes de la versión local.
                    Súbelos ahora cifrados a la nube (sin duplicados).
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isMigratingLocal}
                  onClick={handleMigrateLocalToCloud}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 font-black text-xs flex items-center gap-1.5 transition"
                >
                  {isMigratingLocal ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <UploadCloud className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {isMigratingLocal
                      ? "Subiendo..."
                      : "Subir a la Nube Cifrada"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setDismissedLocalBanner(true)}
                  className="px-3 py-2 rounded-xl bg-slate-900/70 hover:bg-slate-800 text-slate-400 text-xs font-semibold"
                >
                  Omitir
                </button>
              </div>
            </div>
          )}

        {/* AVISO DE REPUESTOS PENDIENTES SOLICITADOS DESDE CAMPO */}
        {isLoaded && missingPartsOrders.length > 0 && (
          <div className="p-4 rounded-2xl bg-orange-500/12 border border-orange-500/35 flex flex-wrap items-center justify-between gap-3 text-xs text-orange-100 print:hidden">
            <div className="flex items-center gap-2.5">
              <PackageSearch className="w-5 h-5 text-orange-400 shrink-0" />
              <span>
                <strong>
                  {missingPartsOrders.length} aviso
                  {missingPartsOrders.length === 1 ? "" : "s"} esperando repuesto en tienda:
                </strong>{" "}
                los técnicos solicitaron piezas para poder terminar la reparación.
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setActiveTab("orders");
                setRequestedQueueFilter("REPUESTOS");
              }}
              className="px-3.5 py-2 rounded-xl bg-orange-500 hover:bg-orange-400 text-slate-950 font-black text-xs transition"
            >
              Ver piezas pendientes ({missingPartsOrders.length})
            </button>
          </div>
        )}

        {/* AVISO DE CUOTA AL 100% */}
        {isLoaded && storageStats?.is_blocked && (
          <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-500/40 flex flex-wrap items-center justify-between gap-3 text-xs text-rose-200 print:hidden">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
              <span>
                <strong>Tope de 50 MB alcanzado:</strong> Las nuevas altas están
                bloqueadas para proteger tu otro proyecto de Supabase. Purga
                logs o partes antiguos en Configuración.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab("config")}
              className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs"
            >
              Liberar espacio
            </button>
          </div>
        )}

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
              <span>Equipo, Cuota y Config</span>
              <kbd className="hidden md:inline-block px-1.5 py-0.5 text-[10px] rounded bg-slate-950/50 text-slate-400 font-mono">
                Alt+3
              </kbd>
            </button>
          </div>
        </div>

        {/* RENDERIZADO DINÁMICO */}
        {!isLoaded ? (
          <div className="p-12 text-center text-slate-400 text-sm flex items-center justify-center gap-2.5">
            <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
            <span>Cargando y descifrando datos desde la nube europea...</span>
          </div>
        ) : (
          <>
            {activeTab === "orders" && (
              <CustomerOrdersTab
                customers={customers}
                orders={orders}
                config={config}
                technicians={activeTechnicians}
                maxWorkdayMinutes={config.maxWorkdayMinutes}
                onSaveCustomer={handleSaveCustomer}
                onDeleteCustomer={handleDeleteCustomer}
                onSaveOrder={handleSaveOrder}
                onUpdateOrder={handleUpdateOrder}
                onUpdateOrderDuration={handleUpdateOrderDuration}
                onDeleteOrder={handleDeleteOrder}
                onUpdateOrderStatus={handleUpdateOrderStatus}
                requestedQueueFilter={requestedQueueFilter}
                onConsumeRequestedFilter={() => setRequestedQueueFilter(undefined)}
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
                customers={customers}
                orders={orders}
                storageStats={storageStats}
                users={users}
                currentProfile={currentProfile}
                canManageAuthUsers={canManageAuthUsers}
                onSaveConfig={handleSaveConfig}
                onRefreshAll={refreshAll}
                onShowToast={showToast}
              />
            )}
          </>
        )}
      </main>

      {/* TOAST NO INTRUSIVO */}
      {adminToast && (
        <div
          className={`fixed bottom-5 right-5 z-50 bg-slate-900/95 backdrop-blur border px-4 py-3 rounded-2xl shadow-2xl text-xs font-semibold flex items-center gap-2.5 print:hidden ${
            adminToast.type === "error"
              ? "border-rose-500/50 text-rose-300"
              : "border-emerald-500/40 text-emerald-300"
          }`}
        >
          {adminToast.type === "error" ? (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span>{adminToast.text}</span>
        </div>
      )}

      <footer className="border-t border-white/[0.06] px-6 py-4 text-center text-xs text-slate-500 print:hidden">
        SATRuta · Asistencia Técnica en Campo · Nube Cifrada UE (AES-256-GCM + RLS)
      </footer>
    </div>
  );
}
