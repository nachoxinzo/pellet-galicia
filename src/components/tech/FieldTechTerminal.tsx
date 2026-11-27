"use client";

import React, { useState, useEffect, Suspense, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  EphemeralStop,
  ServiceOrder,
  ServiceType,
  Coordinates,
  TechnicianConfig,
  UserProfile,
} from "@/types/pelletGalicia";
import {
  buildGoogleMapsSingleClientUrl,
  extractTechTagsFromNotes,
} from "@/utils/galiciaUrlCodec";
import { cloudApi } from "@/services/cloudApi";
import { DEFAULT_TECH_CONFIG } from "@/services/galiciaStorage";
import {
  formatHoursMinutes,
  getServiceTypeBadgeMeta,
} from "@/utils/satUiHelpers";
import {
  Navigation,
  CheckCircle2,
  Wrench,
  MapPin,
  ShieldCheck,
  Map,
  Home,
  Check,
  Copy,
  WifiOff,
  Banknote,
  Phone,
  Clock,
  RefreshCw,
  ClipboardCheck,
  Flame,
  Cog,
  ArrowLeft,
  LogOut,
  CloudUpload,
  Loader2,
  SkipForward,
  ArrowUp,
  ArrowDown,
  ArrowUpCircle,
  Calendar,
} from "lucide-react";

const CLOUD_CACHE_KEY = "satruta_cloud_tech_cache_v1";
const OFFLINE_QUEUE_KEY = "satruta_offline_queue_v1";
const CUSTOM_ORDER_KEY = "satruta_tech_custom_order_v1";

function getLocalDateIso(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function readCustomOrderIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(CUSTOM_ORDER_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeCustomOrderIds(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(CUSTOM_ORDER_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

function applyCustomOrder(items: EphemeralStop[]): EphemeralStop[] {
  const savedIds = readCustomOrderIds();
  if (savedIds.length === 0) return items;
  const orderMap = new globalThis.Map<string, number>();
  savedIds.forEach((id, idx) => orderMap.set(id, idx));

  const sorted = [...items].sort((a, b) => {
    const idxA = orderMap.get(a.id);
    const idxB = orderMap.get(b.id);
    if (idxA !== undefined && idxB !== undefined) return idxA - idxB;
    if (idxA !== undefined) return -1;
    if (idxB !== undefined) return 1;
    return 0;
  });

  return sorted.map((s, idx) => ({ ...s, seq: idx + 1 }));
}

function formatStopScheduleLabel(
  stop: EphemeralStop,
  todayIso: string,
  tomorrowIso: string
): { label: string; isOverdue: boolean } | null {
  const hasDate = Boolean(stop.scheduledDate);
  const hasSlot = Boolean(stop.timeSlot && stop.timeSlot !== "Indiferente");
  if (!hasDate && !hasSlot) return null;

  let datePart = "";
  let isOverdue = false;
  if (stop.scheduledDate) {
    if (stop.scheduledDate < todayIso) {
      isOverdue = true;
      datePart = `Atrasado (${new Date(
        stop.scheduledDate + "T12:00:00"
      ).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" })})`;
    } else if (stop.scheduledDate === todayIso) {
      datePart = "Hoy";
    } else if (stop.scheduledDate === tomorrowIso) {
      datePart = "Mañana";
    } else {
      datePart = new Date(
        stop.scheduledDate + "T12:00:00"
      ).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });
    }
  }

  const slotPart = hasSlot ? stop.timeSlot! : "";
  const label = [datePart, slotPart].filter(Boolean).join(" · ");
  return { label, isOverdue };
}

interface QueuedCompletion {
  orderId: string;
  actualMinutes: number;
  collectedPriceEur: number;
  resolutionNote?: string;
  serviceType: ServiceType;
  queuedAt: string;
}

interface CompletedSessionStats {
  completedCount: number;
  completedMinutes: number;
  collectedEur: number;
}

function ordersToStops(orders: ServiceOrder[]): EphemeralStop[] {
  return orders.map((ord, idx) => {
    const notes = ord.technicalNotes || ord.customer.internalNotes || "";
    const { tags, cashToCollectEur } = extractTechTagsFromNotes(
      notes,
      ord.estimatedPriceEur
    );
    return {
      seq: idx + 1,
      id: ord.id,
      name: ord.customer.name,
      village: ord.customer.village,
      lat: ord.customer.coordinates.lat,
      lng: ord.customer.coordinates.lng,
      serviceType: ord.serviceType,
      priority: ord.priority,
      estimatedMinutes: ord.estimatedMinutes,
      equipmentInfo: ord.equipmentInfo || ord.customer.equipmentInfo,
      cashToCollectEur,
      tags: tags || undefined,
      phone: ord.customer.phone || undefined,
      scheduledDate: ord.scheduledDate || null,
      timeSlot: ord.timeSlot || "Indiferente",
    };
  });
}

function ServiceTypeIcon({
  serviceType,
  priority,
  className = "w-3.5 h-3.5",
}: {
  serviceType: ServiceType;
  priority: "Urgente" | "Normal";
  className?: string;
}) {
  if (priority === "Urgente") return <Flame className={className} />;
  if (serviceType === "Avería") return <Wrench className={className} />;
  if (serviceType === "Instalación") return <Cog className={className} />;
  return <ClipboardCheck className={className} />;
}

function readOfflineQueue(): QueuedCompletion[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedCompletion[]) : [];
  } catch {
    return [];
  }
}

function writeOfflineQueue(items: QueuedCompletion[]): void {
  if (typeof window === "undefined") return;
  try {
    if (items.length === 0) {
      localStorage.removeItem(OFFLINE_QUEUE_KEY);
    } else {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));
    }
  } catch {
    // ignore
  }
}

function TechTerminalContent() {
  const [stops, setStops] = useState<EphemeralStop[]>([]);
  const [config, setConfig] = useState<TechnicianConfig>(DEFAULT_TECH_CONFIG);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<CompletedSessionStats>({
    completedCount: 0,
    completedMinutes: 0,
    collectedEur: 0,
  });
  const [offlineQueue, setOfflineQueue] = useState<QueuedCompletion[]>([]);
  const [isSyncingQueue, setIsSyncingQueue] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [copiedStopId, setCopiedStopId] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [agendaTab, setAgendaTab] = useState<"today" | "upcoming">("today");

  // Modal de Cierre de Parte
  const [confirmingStop, setConfirmingStop] = useState<EphemeralStop | null>(
    null
  );
  const [actualMinutesInput, setActualMinutesInput] = useState<number>(45);
  const [collectedCashInput, setCollectedCashInput] = useState<string>("0");
  const [resolutionNoteInput, setResolutionNoteInput] = useState<string>("");
  const [isSubmittingClose, setIsSubmittingClose] = useState(false);

  const syncOfflineQueue = useCallback(async () => {
    const currentQueue = readOfflineQueue();
    if (currentQueue.length === 0 || !navigator.onLine) return;

    setIsSyncingQueue(true);
    const remaining: QueuedCompletion[] = [];

    for (const item of currentQueue) {
      try {
        await cloudApi.completeTechOrder(item.orderId, {
          actualMinutes: item.actualMinutes,
          collectedPriceEur: item.collectedPriceEur,
          resolutionNote: item.resolutionNote,
          serviceType: item.serviceType,
        });
      } catch (err) {
        // Si es error de red, mantener en cola; si ya estaba cerrado (404/409), descartar
        const status =
          typeof err === "object" && err !== null && "status" in err
            ? (err as { status: number }).status
            : 0;
        if (status !== 404 && status !== 409) {
          remaining.push(item);
        }
      }
    }

    writeOfflineQueue(remaining);
    setOfflineQueue(remaining);
    setIsSyncingQueue(false);

    if (remaining.length === 0) {
      setStatusNotice("Cierres offline sincronizados con la nube");
      setTimeout(() => setStatusNotice(null), 3500);
    }
  }, []);

  const loadFromCloud = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await syncOfflineQueue();

      const res = await cloudApi.getTechOrders();
      const queuedIds = new Set(readOfflineQueue().map((q) => q.orderId));
      const mappedStops = applyCustomOrder(
        ordersToStops(res.orders.filter((o) => !queuedIds.has(o.id)))
      );

      setStops(mappedStops);
      if (res.config) setConfig(res.config);
      setProfile(res.profile);

      try {
        sessionStorage.setItem(
          CLOUD_CACHE_KEY,
          JSON.stringify({
            stops: mappedStops,
            config: res.config || DEFAULT_TECH_CONFIG,
            profile: res.profile,
          })
        );
      } catch {
        // ignore
      }
    } catch {
      // Fallback offline a caché de sesión del mismo turno
      try {
        const raw = sessionStorage.getItem(CLOUD_CACHE_KEY);
        if (raw) {
          const cached = JSON.parse(raw);
          const queuedIds = new Set(readOfflineQueue().map((q) => q.orderId));
          const cachedStops: EphemeralStop[] = Array.isArray(cached.stops)
            ? cached.stops.filter((s: EphemeralStop) => !queuedIds.has(s.id))
            : [];
          setStops(cachedStops);
          if (cached.config) setConfig(cached.config);
          if (cached.profile) setProfile(cached.profile);
        }
      } catch {
        // ignore
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [syncOfflineQueue]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsOnline(navigator.onLine);
    setOfflineQueue(readOfflineQueue());

    const handleOnline = () => {
      setIsOnline(true);
      loadFromCloud();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [loadFromCloud]);

  useEffect(() => {
    (async () => {
      await loadFromCloud();
      setIsLoaded(true);
    })();
  }, [loadFromCloud]);

  const openCloseModal = (stop: EphemeralStop) => {
    setConfirmingStop(stop);
    setActualMinutesInput(stop.estimatedMinutes || 45);
    setCollectedCashInput(
      stop.cashToCollectEur && stop.cashToCollectEur > 0
        ? String(stop.cashToCollectEur)
        : "0"
    );
    setResolutionNoteInput("");
  };

  const handleExecuteCompletion = async () => {
    if (!confirmingStop || isSubmittingClose) return;
    setIsSubmittingClose(true);

    const parsedCash = Math.max(
      0,
      parseFloat(collectedCashInput.replace(",", ".")) || 0
    );
    const safeMinutes = Math.max(5, Math.min(480, actualMinutesInput || 45));
    const trimmedNote = resolutionNoteInput.trim() || undefined;

    let savedInCloud = false;
    if (navigator.onLine) {
      try {
        await cloudApi.completeTechOrder(confirmingStop.id, {
          actualMinutes: safeMinutes,
          collectedPriceEur: parsedCash,
          resolutionNote: trimmedNote,
          serviceType: confirmingStop.serviceType,
        });
        savedInCloud = true;
      } catch (err) {
        const status =
          typeof err === "object" && err !== null && "status" in err
            ? (err as { status: number }).status
            : 0;
        if (status === 404 || status === 409) {
          savedInCloud = true;
        }
      }
    }

    if (!savedInCloud) {
      const nextQueue: QueuedCompletion[] = [
        ...readOfflineQueue(),
        {
          orderId: confirmingStop.id,
          actualMinutes: safeMinutes,
          collectedPriceEur: parsedCash,
          resolutionNote: trimmedNote,
          serviceType: confirmingStop.serviceType,
          queuedAt: new Date().toISOString(),
        },
      ];
      writeOfflineQueue(nextQueue);
      setOfflineQueue(nextQueue);
    }

    const remaining = stops
      .filter((s) => s.id !== confirmingStop.id)
      .map((s, idx) => ({ ...s, seq: idx + 1 }));

    setStops(remaining);
    setStats((prev) => ({
      completedCount: prev.completedCount + 1,
      completedMinutes: prev.completedMinutes + safeMinutes,
      collectedEur: Number((prev.collectedEur + parsedCash).toFixed(2)),
    }));

    try {
      sessionStorage.setItem(
        CLOUD_CACHE_KEY,
        JSON.stringify({ stops: remaining, config, profile })
      );
    } catch {
      // ignore
    }

    setConfirmingStop(null);
    setIsSubmittingClose(false);
    setStatusNotice(
      savedInCloud
        ? "Parte cerrado y sincronizado en la nube"
        : "Sin cobertura: parte guardado en cola offline para sincronizar luego"
    );
    setTimeout(() => setStatusNotice(null), 3500);
  };

  const handleLogout = async () => {
    try {
      sessionStorage.removeItem(CLOUD_CACHE_KEY);
      sessionStorage.removeItem(CUSTOM_ORDER_KEY);
      if (readOfflineQueue().length === 0) {
        localStorage.removeItem(OFFLINE_QUEUE_KEY);
      }
    } catch {
      // ignore
    }
    await cloudApi.logout();
    window.location.href = "/login";
  };

  const handleNavigateToCustomer = (coords: Coordinates) => {
    const url = buildGoogleMapsSingleClientUrl(coords);
    window.open(url, "_blank");
  };

  const handleCopyGps = async (stop: EphemeralStop) => {
    const gpsText = `${stop.lat.toFixed(5)}, ${stop.lng.toFixed(5)}`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(gpsText);
      } else {
        const ta = document.createElement("textarea");
        ta.value = gpsText;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopiedStopId(stop.id);
      setTimeout(() => {
        setCopiedStopId((prev) => (prev === stop.id ? null : prev));
      }, 2200);
    } catch (e) {
      console.warn("No se pudo copiar GPS:", e);
    }
  };

  const todayIso = getLocalDateIso(0);
  const tomorrowIso = getLocalDateIso(1);

  const todayStops = useMemo(
    () =>
      stops
        .filter(
          (s) =>
            !s.scheduledDate ||
            s.scheduledDate <= todayIso ||
            s.priority === "Urgente"
        )
        .map((s, idx) => ({ ...s, seq: idx + 1 })),
    [stops, todayIso]
  );

  const upcomingFutureStops = useMemo(
    () =>
      stops
        .filter(
          (s) =>
            Boolean(s.scheduledDate) &&
            s.scheduledDate! > todayIso &&
            s.priority !== "Urgente"
        )
        .map((s, idx) => ({ ...s, seq: idx + 1 })),
    [stops, todayIso]
  );

  const visibleStops =
    agendaTab === "upcoming" && upcomingFutureStops.length > 0
      ? upcomingFutureStops
      : todayStops;

  const applyVisibleReorder = useCallback(
    (reorderedVisible: EphemeralStop[], noticeText: string) => {
      const visibleIds = new Set(reorderedVisible.map((s) => s.id));
      const otherStops = stops.filter((s) => !visibleIds.has(s.id));
      const merged = (
        agendaTab === "upcoming"
          ? [...otherStops, ...reorderedVisible]
          : [...reorderedVisible, ...otherStops]
      ).map((s, idx) => ({ ...s, seq: idx + 1 }));

      setStops(merged);
      writeCustomOrderIds(merged.map((s) => s.id));
      try {
        sessionStorage.setItem(
          CLOUD_CACHE_KEY,
          JSON.stringify({ stops: merged, config, profile })
        );
      } catch {
        // ignore
      }
      setStatusNotice(noticeText);
      setTimeout(() => {
        setStatusNotice((prev) => (prev === noticeText ? null : prev));
      }, 2800);
    },
    [stops, agendaTab, config, profile]
  );

  const handleSkipCurrentStop = () => {
    if (visibleStops.length <= 1) return;
    const [first, ...rest] = visibleStops;
    applyVisibleReorder(
      [...rest, first],
      `"${first.name}" pospuesto al final de la cola`
    );
  };

  const handlePromoteStop = (stopId: string) => {
    const target = visibleStops.find((s) => s.id === stopId);
    if (!target || visibleStops[0]?.id === stopId) return;
    const rest = visibleStops.filter((s) => s.id !== stopId);
    applyVisibleReorder(
      [target, ...rest],
      `Siguiente parada: ${target.name}`
    );
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleMoveStop = (stopId: string, direction: "up" | "down") => {
    const idx = visibleStops.findIndex((s) => s.id === stopId);
    if (idx === -1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= visibleStops.length) return;
    const copy = [...visibleStops];
    const tmp = copy[idx];
    copy[idx] = copy[swapIdx];
    copy[swapIdx] = tmp;
    applyVisibleReorder(copy, "Orden de ruta actualizado");
  };

  const multiStopGoogleMapsUrl = useMemo(() => {
    if (visibleStops.length === 0) return "";
    const wh = config.warehouseCoordinates;
    const warehouseStr = `${wh.lat.toFixed(6)},${wh.lng.toFixed(6)}`;

    if (visibleStops.length === 1) {
      const stop = visibleStops[0];
      return `https://www.google.com/maps/dir/?api=1&destination=${stop.lat.toFixed(6)},${stop.lng.toFixed(6)}&travelmode=driving`;
    }

    const waypoints = visibleStops
      .slice(0, 9)
      .map((s) => `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`)
      .join("|");

    return `https://www.google.com/maps/dir/?api=1&destination=${warehouseStr}&waypoints=${encodeURIComponent(
      waypoints
    )}&travelmode=driving`;
  }, [config, visibleStops]);

  const handleOpenMultiStopRoute = () => {
    if (multiStopGoogleMapsUrl) {
      window.open(multiStopGoogleMapsUrl, "_blank");
    }
  };

  const handleReturnToWarehouse = () => {
    const wh = config.warehouseCoordinates;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${wh.lat.toFixed(6)},${wh.lng.toFixed(6)}&travelmode=driving`;
    window.open(url, "_blank");
  };

  const currentStop = visibleStops[0] || null;
  const upcomingStops = visibleStops.slice(1);
  const totalRemainingMinutes = visibleStops.reduce(
    (sum, s) => sum + (s.estimatedMinutes || 45),
    0
  );
  const totalTripStops = stats.completedCount + visibleStops.length;
  const completedPercent =
    totalTripStops > 0
      ? Math.round((stats.completedCount / totalTripStops) * 100)
      : 0;

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
        <div className="flex items-center gap-3 text-slate-400 text-sm font-medium">
          <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />
          <span>Cargando avisos asignados desde la nube...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between max-w-lg mx-auto font-sans select-none pb-8">
      {/* BARRA SUPERIOR FIJA */}
      <header className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md border-b border-white/[0.08] p-4 space-y-3">
        {!isOnline && (
          <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs font-semibold flex items-center gap-2.5">
            <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              Modo sin cobertura activo. Tus cierres se guardan en este dispositivo y se subirán al recuperar señal.
            </span>
          </div>
        )}

        {offlineQueue.length > 0 && (
          <div className="p-3 rounded-xl bg-sky-500/15 border border-sky-500/40 text-sky-200 text-xs font-semibold flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CloudUpload className="w-4 h-4 text-sky-400 shrink-0" />
              <span>
                {offlineQueue.length} parte(s) pendientes de subir a la nube
              </span>
            </div>
            {isOnline && (
              <button
                type="button"
                disabled={isSyncingQueue}
                onClick={syncOfflineQueue}
                className="px-2.5 py-1 rounded-lg bg-sky-500 text-slate-950 font-black text-[11px]"
              >
                {isSyncingQueue ? "Subiendo..." : "Sincronizar"}
              </button>
            )}
          </div>
        )}

        {statusNotice && (
          <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 text-xs font-semibold text-center">
            {statusNotice}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="/logo-gregorio.png"
              alt="Ferretería Gregorio"
              className="w-9 h-9 rounded-full object-cover shrink-0 shadow-md shadow-orange-500/20 ring-1 ring-orange-500/30"
            />
            <div
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                isOnline
                  ? "bg-emerald-400 animate-pulse"
                  : "bg-amber-400 animate-ping"
              }`}
            />
            <div className="min-w-0">
              <h1 className="text-xs font-bold uppercase tracking-wider text-amber-400 truncate">
                F. Gregorio · Técnico
              </h1>
              {profile && (
                <span className="text-[11px] text-slate-400 block truncate">
                  {profile.fullName || profile.email}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={isRefreshing || !isOnline}
              onClick={loadFromCloud}
              title="Actualizar avisos desde la nube"
              className="p-1.5 rounded-lg bg-slate-900 border border-white/[0.08] text-slate-300 hover:text-amber-400 disabled:opacity-40 transition"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`}
              />
            </button>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-900 border border-white/[0.08] text-slate-300 tabular-nums">
              {stops.length} pend.
            </span>
            <button
              type="button"
              onClick={handleLogout}
              title="Cerrar sesión"
              className="p-1.5 rounded-lg bg-slate-900 border border-white/[0.08] text-slate-400 hover:text-rose-400 transition"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* BARRA DE PROGRESO DE JORNADA */}
        {totalTripStops > 0 && (
          <div className="bg-slate-900/65 p-3 rounded-2xl border border-white/[0.08] space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-slate-200 tabular-nums">
                {stats.completedCount} de {totalTripStops} avisos cerrados en esta sesión
              </span>
              <span className="font-mono font-bold text-amber-400 tabular-nums">
                {completedPercent}%
              </span>
            </div>
            <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-white/[0.06]">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-amber-400 transition-all duration-300"
                style={{ width: `${Math.min(100, completedPercent)}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-xs pt-0.5 text-slate-400">
              <span className="flex items-center gap-1.5 tabular-nums">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                Restante est.: {formatHoursMinutes(totalRemainingMinutes)}
              </span>
              {stats.collectedEur > 0 && (
                <span className="font-mono font-bold text-emerald-400 tabular-nums">
                  Cobrado: {stats.collectedEur.toFixed(2)} €
                </span>
              )}
            </div>
          </div>
        )}

        {/* SELECTOR AGENDA: HOY vs PRÓXIMOS DÍAS */}
        {upcomingFutureStops.length > 0 && (
          <div className="grid grid-cols-2 gap-1.5 bg-slate-900/75 p-1 rounded-xl border border-white/[0.08] text-xs font-bold">
            <button
              type="button"
              onClick={() => setAgendaTab("today")}
              className={`py-1.5 px-3 rounded-lg transition ${
                agendaTab === "today"
                  ? "bg-amber-500 text-slate-950"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              Hoy / Urgentes ({todayStops.length})
            </button>
            <button
              type="button"
              onClick={() => setAgendaTab("upcoming")}
              className={`py-1.5 px-3 rounded-lg transition ${
                agendaTab === "upcoming"
                  ? "bg-sky-500 text-slate-950"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              Próximos días ({upcomingFutureStops.length})
            </button>
          </div>
        )}

        {/* BOTÓN RUTA COMPLETA GOOGLE MAPS */}
        {visibleStops.length > 0 && (
          <button
            type="button"
            onClick={handleOpenMultiStopRoute}
            className="w-full min-h-[50px] flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-2xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-sm shadow-lg shadow-sky-900/30 active:scale-[0.98] transition"
          >
            <Map className="w-5 h-5 shrink-0" />
            <span>
              Abrir Ruta Completa en Google Maps ({visibleStops.length})
            </span>
          </button>
        )}
      </header>

      {/* CONTENIDO PRINCIPAL */}
      <main className="flex-1 p-4 space-y-4">
        {visibleStops.length === 0 ? (
          <div className="bg-slate-900/65 backdrop-blur-md border border-white/[0.08] rounded-3xl p-6 sm:p-7 text-center space-y-5 shadow-2xl my-auto">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                {stats.completedCount > 0
                  ? "Jornada al día"
                  : "Terminal de Técnico"}
              </span>
              <h2 className="text-2xl font-black text-white">
                {stats.completedCount > 0
                  ? "Avisos Cerrados y Sincronizados"
                  : "Sin avisos pendientes"}
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                {stats.completedCount > 0
                  ? "Todos tus partes cerrados están actualizados en tiempo real en la nube para el despacho."
                  : "No tienes averías ni revisiones pendientes asignadas ahora mismo. Pulsa actualizar si oficina acaba de grabar un aviso."}
              </p>
            </div>

            {stats.completedCount > 0 && (
              <div className="p-4 bg-slate-950/60 rounded-2xl border border-white/[0.06] text-xs sm:text-sm text-slate-300 space-y-2.5 text-left">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Avisos completados:</span>
                  <strong className="text-white font-mono tabular-nums">
                    {stats.completedCount} partes
                  </strong>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Tiempo trabajado:</span>
                  <strong className="text-amber-400 font-mono tabular-nums">
                    {formatHoursMinutes(stats.completedMinutes)}
                  </strong>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-white/[0.06]">
                  <span className="text-slate-300 font-semibold">
                    Total cobrado en ruta:
                  </span>
                  <strong className="text-emerald-400 font-mono text-base font-bold tabular-nums">
                    {stats.collectedEur.toFixed(2)} €
                  </strong>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2.5 pt-1">
              {agendaTab === "today" && upcomingFutureStops.length > 0 && (
                <button
                  type="button"
                  onClick={() => setAgendaTab("upcoming")}
                  className="w-full min-h-[50px] flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-sm transition"
                >
                  <Calendar className="w-4 h-4" />
                  <span>
                    Ver {upcomingFutureStops.length} avisos de próximos días
                  </span>
                </button>
              )}

              <button
                type="button"
                disabled={isRefreshing || !isOnline}
                onClick={loadFromCloud}
                className="w-full min-h-[50px] flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-sm border border-white/[0.08] transition"
              >
                <RefreshCw
                  className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`}
                />
                <span>Comprobar nuevos avisos</span>
              </button>

              <button
                type="button"
                onClick={handleReturnToWarehouse}
                className="w-full min-h-[50px] flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm active:scale-[0.98] transition"
              >
                <Home className="w-5 h-5" />
                <span>Volver a Base ({config.warehouseName})</span>
              </button>

              {profile?.role === "admin" && (
                <Link
                  href="/admin"
                  className="w-full py-3 px-4 rounded-2xl bg-slate-800/70 hover:bg-slate-800 text-slate-300 hover:text-white font-semibold text-xs border border-white/[0.08] flex items-center justify-center gap-2 transition"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Volver al Despacho (/admin)</span>
                </Link>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* TARJETA ACTIVA (#1) */}
            {(() => {
              const meta = getServiceTypeBadgeMeta(
                currentStop.serviceType,
                currentStop.priority
              );
              const isUrgent = currentStop.priority === "Urgente";
              const schedMeta = formatStopScheduleLabel(
                currentStop,
                todayIso,
                tomorrowIso
              );
              return (
                <div
                  className={`bg-slate-900/75 backdrop-blur-md rounded-3xl p-5 sm:p-6 shadow-2xl space-y-5 relative overflow-hidden border ${
                    isUrgent
                      ? "border-rose-500/60 shadow-rose-950/30"
                      : "border-amber-500/45 shadow-amber-950/20"
                  }`}
                >
                  <div
                    className={`absolute top-0 left-0 right-0 h-1 ${
                      isUrgent ? "bg-rose-500" : "bg-amber-500"
                    }`}
                  />

                  <div className="flex items-start justify-between gap-3 pt-1">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-12 h-12 rounded-2xl font-black text-xl flex items-center justify-center shadow-lg shrink-0 ${
                          isUrgent
                            ? "bg-rose-600 text-white"
                            : "bg-amber-500 text-slate-950"
                        }`}
                      >
                        #{currentStop.seq}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-amber-400">
                            Intervención actual
                          </span>
                          {schedMeta && (
                            <span
                              className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                                schedMeta.isOverdue
                                  ? "bg-rose-500/20 text-rose-300"
                                  : "bg-sky-500/15 text-sky-300"
                              }`}
                            >
                              <Calendar className="w-3 h-3" />
                              {schedMeta.label}
                            </span>
                          )}
                        </div>
                        <h2 className="text-xl sm:text-2xl font-black text-white leading-tight">
                          {currentStop.name}
                        </h2>
                      </div>
                    </div>

                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full shrink-0 ${meta.badgeClass}`}
                    >
                      <ServiceTypeIcon
                        serviceType={currentStop.serviceType}
                        priority={currentStop.priority}
                      />
                      <span>{meta.label}</span>
                    </span>
                  </div>

                  {/* BLOQUE CENTRAL */}
                  <div className="bg-slate-950/60 p-4 rounded-2xl border border-white/[0.06] space-y-3">
                    <div>
                      <span className="text-xs font-medium text-slate-400 block">
                        Equipo / Instalación
                      </span>
                      <div className="text-lg font-bold text-white mt-0.5 flex items-center gap-2">
                        <Wrench className="w-4 h-4 text-amber-400 shrink-0" />
                        <span>
                          {currentStop.equipmentInfo ||
                            "Asistencia técnica general"}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2.5 border-t border-white/[0.06]">
                      <span className="text-xs font-medium text-slate-400">
                        Duración estimada
                      </span>
                      <span className="text-lg font-mono font-bold text-amber-400 tabular-nums flex items-center gap-1.5">
                        <Clock className="w-4 h-4" />
                        {currentStop.estimatedMinutes} min
                      </span>
                    </div>
                  </div>

                  {(currentStop.tags ||
                    (currentStop.cashToCollectEur &&
                      currentStop.cashToCollectEur > 0)) && (
                    <div className="space-y-2.5">
                      {currentStop.cashToCollectEur &&
                      currentStop.cashToCollectEur > 0 ? (
                        <div className="p-3.5 rounded-2xl bg-emerald-500/12 border border-emerald-500/35 text-emerald-300 font-bold text-sm flex items-center justify-between">
                          <span className="flex items-center gap-2">
                            <Banknote className="w-5 h-5 text-emerald-400 shrink-0" />
                            <span>Presupuesto / Cobrar</span>
                          </span>
                          <span className="text-lg font-mono text-white tabular-nums">
                            {currentStop.cashToCollectEur.toFixed(2)} €
                          </span>
                        </div>
                      ) : null}

                      {currentStop.tags && (
                        <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-200 text-xs sm:text-sm font-medium leading-relaxed">
                          {currentStop.tags}
                        </div>
                      )}
                    </div>
                  )}

                  {/* DIRECCIÓN Y GPS */}
                  <div className="space-y-1 bg-slate-950/45 p-3.5 rounded-2xl border border-white/[0.06]">
                    <span className="text-xs font-medium text-slate-400 block">
                      Ubicación
                    </span>
                    <p className="font-bold text-slate-100 text-base leading-snug flex items-start gap-2">
                      <MapPin className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                      <span>{currentStop.village}</span>
                    </p>
                    <div className="text-xs text-slate-400 pl-7 font-mono tabular-nums">
                      {currentStop.lat.toFixed(5)}, {currentStop.lng.toFixed(5)}
                    </div>
                  </div>

                  {currentStop.phone && (
                    <a
                      href={`tel:${currentStop.phone}`}
                      className="w-full min-h-[54px] flex items-center justify-center gap-2.5 py-3 px-4 rounded-2xl bg-slate-800/80 hover:bg-slate-700 border border-sky-500/40 text-sky-300 font-bold text-sm sm:text-base active:scale-[0.98] transition"
                    >
                      <Phone className="w-5 h-5 text-sky-400 shrink-0" />
                      <span>Llamar al Cliente ({currentStop.phone})</span>
                    </a>
                  )}

                  <div className="flex items-stretch gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        handleNavigateToCustomer({
                          lat: currentStop.lat,
                          lng: currentStop.lng,
                        })
                      }
                      className="flex-1 min-h-[54px] flex items-center justify-center gap-2.5 py-3.5 px-4 rounded-2xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-sm sm:text-base shadow-lg shadow-sky-600/25 active:scale-[0.98] transition"
                    >
                      <Navigation className="w-5 h-5 shrink-0" />
                      <span>Ir en Google Maps</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleCopyGps(currentStop)}
                      className={`min-h-[54px] px-4 py-3.5 rounded-2xl font-bold text-xs border transition flex flex-col items-center justify-center gap-1 shrink-0 ${
                        copiedStopId === currentStop.id
                          ? "bg-emerald-600 border-emerald-400 text-white"
                          : "bg-slate-800/80 hover:bg-slate-700 border-white/[0.08] text-amber-300"
                      }`}
                    >
                      {copiedStopId === currentStop.id ? (
                        <>
                          <Check className="w-4 h-4" />
                          <span>Copiado</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          <span>Copiar GPS</span>
                        </>
                      )}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => openCloseModal(currentStop)}
                    className="w-full min-h-[56px] flex items-center justify-center gap-2.5 py-4 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-base shadow-xl shadow-emerald-600/25 active:scale-[0.98] transition"
                  >
                    <CheckCircle2 className="w-6 h-6 shrink-0" />
                    <span>Parte Finalizado</span>
                  </button>

                  {visibleStops.length > 1 && (
                    <button
                      type="button"
                      onClick={handleSkipCurrentStop}
                      className="w-full py-2.5 px-4 rounded-xl bg-slate-800/75 hover:bg-slate-800 text-slate-300 hover:text-amber-300 border border-white/[0.08] font-semibold text-xs flex items-center justify-center gap-2 transition"
                    >
                      <SkipForward className="w-4 h-4 text-amber-400" />
                      <span>Posponer y saltar a la siguiente parada</span>
                    </button>
                  )}
                </div>
              );
            })()}

            {upcomingStops.length > 0 && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between text-xs px-1">
                  <span className="font-bold uppercase tracking-wider text-slate-400">
                    Siguientes avisos ({upcomingStops.length})
                  </span>
                </div>

                <div className="space-y-2.5">
                  {upcomingStops.map((stop, upcomingIdx) => {
                    const meta = getServiceTypeBadgeMeta(
                      stop.serviceType,
                      stop.priority
                    );
                    const schedMeta = formatStopScheduleLabel(
                      stop,
                      todayIso,
                      tomorrowIso
                    );
                    const isLastUpcoming =
                      upcomingIdx === upcomingStops.length - 1;
                    return (
                      <div
                        key={stop.id}
                        className="bg-slate-900/65 border border-white/[0.07] rounded-2xl p-4 space-y-3 text-xs"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs flex items-center justify-center shrink-0">
                              #{stop.seq}
                            </div>
                            <div className="min-w-0 space-y-0.5">
                              <div className="font-bold text-white text-sm truncate flex items-center gap-2">
                                <span className="truncate">{stop.name}</span>
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 ${meta.badgeClass}`}
                                >
                                  <ServiceTypeIcon
                                    serviceType={stop.serviceType}
                                    priority={stop.priority}
                                    className="w-3 h-3"
                                  />
                                </span>
                              </div>
                              <p className="text-xs text-slate-400 line-clamp-1">
                                {stop.village}
                              </p>
                              <div className="flex flex-wrap items-center gap-2">
                                {stop.equipmentInfo && (
                                  <span className="text-xs text-amber-300/90 truncate">
                                    {stop.equipmentInfo}
                                  </span>
                                )}
                                {schedMeta && (
                                  <span
                                    className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                                      schedMeta.isOverdue
                                        ? "text-rose-300"
                                        : "text-sky-300"
                                    }`}
                                  >
                                    <Calendar className="w-3 h-3" />
                                    {schedMeta.label}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleCopyGps(stop)}
                              className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-white/[0.08] text-xs font-semibold text-slate-300 flex items-center gap-1"
                            >
                              <Copy className="w-3 h-3" />
                              <span>
                                {copiedStopId === stop.id ? "OK" : "GPS"}
                              </span>
                            </button>

                            <div className="text-right tabular-nums">
                              <span className="font-mono font-bold text-amber-400 text-xs block">
                                {stop.estimatedMinutes}m
                              </span>
                              {stop.cashToCollectEur &&
                              stop.cashToCollectEur > 0 ? (
                                <span className="text-xs text-emerald-400 font-mono font-semibold">
                                  {stop.cashToCollectEur} €
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        {/* CONTROLES DE REORDENACIÓN EN MARCHA */}
                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.06]">
                          <button
                            type="button"
                            onClick={() => handlePromoteStop(stop.id)}
                            className="flex-1 py-1.5 px-3 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 font-bold text-xs flex items-center justify-center gap-1.5 transition"
                          >
                            <ArrowUpCircle className="w-3.5 h-3.5" />
                            <span>Ir a este aviso ahora</span>
                          </button>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleMoveStop(stop.id, "up")}
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-white/[0.08]"
                              title="Subir una posición"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={isLastUpcoming}
                              onClick={() => handleMoveStop(stop.id, "down")}
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-35 text-slate-300 border border-white/[0.08]"
                              title="Bajar una posición"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* MODAL DE CIERRE DE INTERVENCIÓN */}
      {confirmingStop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/[0.1] rounded-3xl max-w-sm w-full p-6 space-y-4 text-white shadow-2xl">
            <div className="text-center space-y-1">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 flex items-center justify-center mx-auto mb-2">
                <Wrench className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">
                Cerrar Parte #{confirmingStop.seq}
              </h3>
              <p className="text-xs text-slate-300">
                <strong className="text-white">{confirmingStop.name}</strong> ·{" "}
                {confirmingStop.serviceType}
              </p>
            </div>

            <div className="p-3 bg-slate-950/60 rounded-2xl border border-white/[0.06] space-y-2">
              <label className="text-xs font-semibold text-slate-400 block text-center">
                Tiempo real empleado (min)
              </label>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setActualMinutesInput((m) => Math.max(15, m - 15))
                  }
                  className="min-h-[46px] px-4 rounded-xl bg-slate-800 hover:bg-slate-700 font-bold text-sm text-slate-200"
                >
                  -15m
                </button>
                <span className="font-mono text-2xl font-black text-amber-400 tabular-nums">
                  {actualMinutesInput} min
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setActualMinutesInput((m) => Math.min(480, m + 15))
                  }
                  className="min-h-[46px] px-4 rounded-xl bg-slate-800 hover:bg-slate-700 font-bold text-sm text-amber-300"
                >
                  +15m
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300 block">
                Importe cobrado (€)
              </label>
              <input
                type="number"
                step="0.5"
                min={0}
                value={collectedCashInput}
                onChange={(e) => setCollectedCashInput(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-slate-950/70 border border-white/[0.08] text-emerald-400 font-mono text-xl font-black outline-none focus:border-emerald-500 text-center tabular-nums"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300 block">
                Nota breve de resolución (opcional)
              </label>
              <input
                type="text"
                maxLength={120}
                placeholder="Ej. Cambiado sensor NTC, equipo probado OK..."
                value={resolutionNoteInput}
                onChange={(e) => setResolutionNoteInput(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-slate-950/70 border border-white/[0.08] text-white text-sm outline-none focus:border-amber-500"
              />
            </div>

            <div className="flex gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setConfirmingStop(null)}
                className="w-1/3 min-h-[50px] rounded-2xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isSubmittingClose}
                onClick={handleExecuteCompletion}
                className="w-2/3 min-h-[50px] rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-bold text-sm shadow-lg shadow-emerald-600/25 transition active:scale-[0.98]"
              >
                {isSubmittingClose ? "Guardando..." : "Confirmar Cierre"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PIE DE PÁGINA */}
      <footer className="text-center text-xs text-slate-500 px-4 pt-3 border-t border-white/[0.06]">
        <span className="flex items-center justify-center gap-1.5 font-medium">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          SATRuta Técnico · Nube Cifrada UE + Cola Offline
        </span>
      </footer>
    </div>
  );
}

export default function FieldTechTerminal() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
          <span className="text-sm text-slate-400">
            Cargando terminal técnica...
          </span>
        </div>
      }
    >
      <TechTerminalContent />
    </Suspense>
  );
}
