"use client";

import React, { useState, useMemo, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  Customer,
  ServiceOrder,
  ServiceType,
  OrderPriority,
  FIELD_SERVICE_RULES,
} from "@/types/pelletGalicia";
import {
  Wrench,
  ClipboardCheck,
  Plus,
  Search,
  MapPin,
  Trash2,
  CheckCircle2,
  Satellite,
  Crosshair,
  Loader2,
  ClipboardPaste,
  AlertTriangle,
  Pencil,
  Save,
  X,
  Zap,
  Users,
  Clock,
  ChevronDown,
  ChevronUp,
  Phone,
  Filter,
  ArrowUpDown,
  RotateCcw,
  Flame,
  Cog,
} from "lucide-react";
import {
  searchGoogleMapsLive,
  reverseGeocodeGalicia,
  resolveMapLocation,
  GoogleSearchResultItem,
} from "@/utils/galiciaGeocoding";
import {
  galiciaStorage,
  normalizeGaliciaText,
  normalizePhoneDigits,
  extractConcelloFromVillage,
} from "@/services/galiciaStorage";
import { extractTechTagsFromNotes } from "@/utils/galiciaUrlCodec";
import {
  formatHoursMinutes,
  getServiceTypeBadgeMeta,
} from "@/utils/satUiHelpers";

function formatDaysSinceService(isoDate?: string): {
  label: string;
  days: number;
} {
  if (!isoDate) return { label: "Sin avisos previos", days: 9999 };
  const parsed = new Date(isoDate).getTime();
  if (Number.isNaN(parsed)) return { label: "Sin fecha", days: 9999 };
  const diffMs = Date.now() - parsed;
  const days = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  if (days === 0) return { label: "Aviso hoy", days: 0 };
  if (days === 1) return { label: "Hace 1 día", days: 1 };
  return { label: `Hace ${days} días`, days };
}

const PrecisionMapPicker = dynamic(
  () => import("@/components/map/PrecisionMapPicker"),
  {
    ssr: false,
    loading: () => (
      <div className="h-[340px] w-full bg-slate-950 rounded-3xl flex items-center justify-center text-slate-500 text-xs border border-slate-800 animate-pulse">
        Cargando Google Maps Satélite Híbrido...
      </div>
    ),
  }
);

interface CustomerOrdersTabProps {
  customers: Customer[];
  orders: ServiceOrder[];
  maxWorkdayMinutes: number;
  onSaveCustomer: (
    customer: Omit<Customer, "id" | "createdAt" | "updatedAt"> & { id?: string }
  ) => Customer | void;
  onDeleteCustomer: (id: string) => void;
  onSaveOrder: (
    customerId: string,
    payload: {
      serviceType?: ServiceType;
      priority?: OrderPriority;
      equipmentInfo?: string;
      estimatedMinutes?: number;
      estimatedPriceEur?: number;
      technicalNotes?: string;
    }
  ) => void;
  onUpdateOrder: (
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
  ) => void;
  onUpdateOrderDuration: (
    orderId: string,
    deltaOrExact: number,
    isDelta?: boolean
  ) => void;
  onDeleteOrder: (id: string) => void;
  onUpdateOrderStatus: (id: string, status: ServiceOrder["status"]) => void;
}

export default function CustomerOrdersTab({
  customers,
  orders,
  maxWorkdayMinutes,
  onSaveCustomer,
  onDeleteCustomer,
  onSaveOrder,
  onUpdateOrder,
  onUpdateOrderDuration,
  onDeleteOrder,
  onUpdateOrderStatus,
}: CustomerOrdersTabProps) {
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const formContainerRef = React.useRef<HTMLDivElement>(null);

  // Super-Buscador de clientes habituales
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null
  );
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [quickOrderFeedback, setQuickOrderFeedback] = useState<string | null>(
    null
  );

  // Cajón de Cartera de Clientes e Instalaciones
  const [showHabitualDrawer, setShowHabitualDrawer] = useState(false);
  const [habitualSearch, setHabitualSearch] = useState("");
  const [habitualConcelloFilter, setHabitualConcelloFilter] =
    useState<string>("ALL");
  const [habitualSort, setHabitualSort] = useState<
    "frequent" | "recent" | "inactive" | "alpha"
  >("frequent");
  const [habitualCardMinutes, setHabitualCardMinutes] = useState<
    Record<string, number>
  >({});
  const [habitualCardType, setHabitualCardType] = useState<
    Record<string, ServiceType>
  >({});
  const [confirmDeleteCustomerId, setConfirmDeleteCustomerId] = useState<
    string | null
  >(null);

  // Campos de Cliente / Instalación
  const [name, setName] = useState("");
  const [village, setVillage] = useState("");
  const [phone, setPhone] = useState("");
  const [equipmentInfo, setEquipmentInfo] = useState("");
  const [lat, setLat] = useState("42.2982");
  const [lng, setLng] = useState("-7.8185");
  const [internalNotes, setInternalNotes] = useState("");

  // Campos del Parte / Aviso SAT
  const [serviceType, setServiceType] = useState<ServiceType>("Avería");
  const [orderPriority, setOrderPriority] = useState<OrderPriority>("Normal");
  const [estimatedMinutes, setEstimatedMinutes] = useState<number>(
    FIELD_SERVICE_RULES.DEFAULT_INTERVENTION_MINUTES
  );
  const [estimatedPriceEur, setEstimatedPriceEur] = useState<string>("");
  const [technicalNotes, setTechnicalNotes] = useState("");

  // Filtros de la Cola de Avisos
  const [queueStatusFilter, setQueueStatusFilter] = useState<
    "ACTIVOS" | "Completado" | "ALL"
  >("ACTIVOS");
  const [queueSearchQuery, setQueueSearchQuery] = useState("");
  const [onlyUrgentFilter, setOnlyUrgentFilter] = useState(false);

  // Buscador Google Maps
  const [googleQuery, setGoogleQuery] = useState("");
  const [googleResults, setGoogleResults] = useState<GoogleSearchResultItem[]>(
    []
  );
  const [isSearchingGoogle, setIsSearchingGoogle] = useState(false);
  const [showGoogleDropdown, setShowGoogleDropdown] = useState(false);
  const [confirmedStatus, setConfirmedStatus] = useState<string | null>(null);

  const matchingCustomers = useMemo(() => {
    const q = normalizeGaliciaText(customerSearch);
    const qDigits = normalizePhoneDigits(customerSearch);

    const sortedRecent = [...customers].sort((a, b) => {
      const dateA = new Date(a.lastServiceDate || a.updatedAt).getTime();
      const dateB = new Date(b.lastServiceDate || b.updatedAt).getTime();
      return dateB - dateA;
    });

    if (!q) return sortedRecent.slice(0, 8);

    return sortedRecent.filter((c) => {
      const nameMatch = normalizeGaliciaText(c.name).includes(q);
      const villageMatch = normalizeGaliciaText(c.village).includes(q);
      const equipMatch = normalizeGaliciaText(c.equipmentInfo).includes(q);
      const phoneMatch =
        qDigits.length >= 3 && normalizePhoneDigits(c.phone).includes(qDigits);
      return nameMatch || villageMatch || equipMatch || phoneMatch;
    });
  }, [customers, customerSearch]);

  const detectedExistingCustomer = useMemo(() => {
    if (selectedCustomerId) {
      return customers.find((c) => c.id === selectedCustomerId) || null;
    }
    const normName = normalizeGaliciaText(name);
    const normPhone = normalizePhoneDigits(phone);
    if (!normName && normPhone.length < 6) return null;

    return (
      customers.find(
        (c) =>
          (normName && normalizeGaliciaText(c.name) === normName) ||
          (normPhone.length >= 6 &&
            normalizePhoneDigits(c.phone) === normPhone)
      ) || null
    );
  }, [customers, name, phone, selectedCustomerId]);

  const activeOrderByCustomerId = useMemo(() => {
    const map: Record<string, { count: number; totalMinutes: number }> = {};
    orders
      .filter((o) => o.status === "Pendiente" || o.status === "En Ruta")
      .forEach((o) => {
        if (!map[o.customerId]) {
          map[o.customerId] = { count: 0, totalMinutes: 0 };
        }
        map[o.customerId].count += 1;
        map[o.customerId].totalMinutes += o.estimatedMinutes;
      });
    return map;
  }, [orders]);

  const availableConcellos = useMemo(() => {
    const set = new Set<string>();
    customers.forEach((c) => {
      if (c.village) set.add(extractConcelloFromVillage(c.village));
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [customers]);

  const filteredHabitualCustomers = useMemo(() => {
    const q = normalizeGaliciaText(habitualSearch);
    const qDigits = normalizePhoneDigits(habitualSearch);

    const list = customers.filter((c) => {
      if (
        habitualConcelloFilter !== "ALL" &&
        extractConcelloFromVillage(c.village) !== habitualConcelloFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        normalizeGaliciaText(c.name).includes(q) ||
        normalizeGaliciaText(c.village).includes(q) ||
        normalizeGaliciaText(c.equipmentInfo).includes(q) ||
        (qDigits.length >= 3 && normalizePhoneDigits(c.phone).includes(qDigits))
      );
    });

    return [...list].sort((a, b) => {
      if (habitualSort === "frequent") {
        return (b.totalServicesHistory || 0) - (a.totalServicesHistory || 0);
      }
      if (habitualSort === "recent") {
        const dA = new Date(a.lastServiceDate || a.updatedAt).getTime();
        const dB = new Date(b.lastServiceDate || b.updatedAt).getTime();
        return dB - dA;
      }
      if (habitualSort === "inactive") {
        const dA = new Date(a.lastServiceDate || a.updatedAt).getTime();
        const dB = new Date(b.lastServiceDate || b.updatedAt).getTime();
        return dA - dB;
      }
      return a.name.localeCompare(b.name, "es");
    });
  }, [customers, habitualSearch, habitualConcelloFilter, habitualSort]);

  useEffect(() => {
    if (!googleQuery.trim() || googleQuery.trim().length < 2) {
      setGoogleResults([]);
      setIsSearchingGoogle(false);
      return;
    }

    setIsSearchingGoogle(true);
    const timer = setTimeout(async () => {
      try {
        const config = galiciaStorage.getConfig();
        const results = await searchGoogleMapsLive(
          googleQuery,
          config.googleMapsApiKey
        );
        setGoogleResults(results);
        setShowGoogleDropdown(true);
      } catch (err) {
        console.error("Error buscando en Google Maps:", err);
      } finally {
        setIsSearchingGoogle(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [googleQuery]);

  const handleSelectGooglePlace = (place: GoogleSearchResultItem) => {
    setVillage(place.fullAddress);
    const latStr = place.lat.toFixed(6);
    const lngStr = place.lng.toFixed(6);
    setLat(latStr);
    setLng(lngStr);
    setShowGoogleDropdown(false);
    setGoogleQuery("");

    if (place.categoryType === "municipality") {
      setConfirmedStatus(
        `⚠️ Centro del concello fijado (${latStr}, ${lngStr}). Haz clic sobre la casa/nave en el mapa satélite.`
      );
    } else {
      setConfirmedStatus(
        `✅ Ubicación localizada (${place.source}): ${latStr}, ${lngStr}`
      );
    }
  };

  const handlePasteCoordsOrLink = async () => {
    const pasted = prompt(
      "Pega un enlace de Google Maps o coordenadas (ej. 42.1912, -7.8012):"
    );
    if (!pasted) return;
    const resolved = await resolveMapLocation(pasted);
    if (resolved) {
      setLat(resolved.lat.toFixed(6));
      setLng(resolved.lng.toFixed(6));
      if (resolved.resolvedAddress && !village.trim()) {
        setVillage(resolved.resolvedAddress);
      }
      setConfirmedStatus(
        `✅ Coordenadas extraídas (${resolved.source}): ${resolved.lat.toFixed(
          6
        )}, ${resolved.lng.toFixed(6)}`
      );
    } else {
      alert("No se pudieron extraer coordenadas válidas del texto pegado.");
    }
  };

  const selectExistingCustomer = (c: Customer) => {
    setSelectedCustomerId(c.id);
    setName(c.name);
    setCustomerSearch(c.name);
    setVillage(c.village);
    setPhone(c.phone || "");
    setEquipmentInfo(c.equipmentInfo || "");
    setLat(c.coordinates.lat.toFixed(6));
    setLng(c.coordinates.lng.toFixed(6));
    setInternalNotes(c.internalNotes || "");
    setTechnicalNotes(c.internalNotes || "");
    setEstimatedMinutes(
      c.lastInterventionMinutes ||
        FIELD_SERVICE_RULES.DEFAULT_INTERVENTION_MINUTES
    );
    setShowCustomerDropdown(false);
    setConfirmedStatus(
      `✅ Cliente "${c.name}" cargado con su GPS exacto y equipo (${
        c.equipmentInfo || "General"
      }).`
    );
  };

  const handleQuickCreateService = (
    c: Customer,
    typeOverride?: ServiceType,
    minutesOverride?: number
  ) => {
    const targetType = typeOverride ?? habitualCardType[c.id] ?? "Avería";
    const targetMinutes =
      minutesOverride ??
      habitualCardMinutes[c.id] ??
      c.lastInterventionMinutes ??
      45;

    onSaveOrder(c.id, {
      serviceType: targetType,
      priority: targetType === "Avería" ? "Urgente" : "Normal",
      equipmentInfo: c.equipmentInfo,
      estimatedMinutes: targetMinutes,
      technicalNotes: c.internalNotes || "",
    });
    setShowCustomerDropdown(false);

    const feedbackText = `⚡ Parte de ${targetType} (${targetMinutes} min) para ${c.name} añadido a la cola`;
    setQuickOrderFeedback(feedbackText);
    setTimeout(() => {
      setQuickOrderFeedback((prev) => (prev === feedbackText ? null : prev));
    }, 4500);
  };

  const handleMapClick = async (coords: { lat: number; lng: number }) => {
    const latStr = coords.lat.toFixed(6);
    const lngStr = coords.lng.toFixed(6);
    setLat(latStr);
    setLng(lngStr);

    try {
      const geo = await reverseGeocodeGalicia(coords.lat, coords.lng);
      if (geo && geo.fullAddress) {
        if (!village.trim()) {
          setVillage(geo.fullAddress);
        }
        setConfirmedStatus(
          `✅ Coordenadas fijadas: ${latStr}, ${lngStr} (${
            geo.placeName || geo.concello
          })`
        );
      } else {
        setConfirmedStatus(`✅ Coordenadas fijadas: ${latStr}, ${lngStr}`);
      }
    } catch {
      setConfirmedStatus(`✅ Coordenadas fijadas: ${latStr}, ${lngStr}`);
    }
  };

  const resetForm = () => {
    setSelectedCustomerId(null);
    setCustomerSearch("");
    setName("");
    setVillage("");
    setPhone("");
    setEquipmentInfo("");
    setLat("42.2982");
    setLng("-7.8185");
    setInternalNotes("");
    setServiceType("Avería");
    setOrderPriority("Normal");
    setEstimatedMinutes(FIELD_SERVICE_RULES.DEFAULT_INTERVENTION_MINUTES);
    setEstimatedPriceEur("");
    setTechnicalNotes("");
    setGoogleQuery("");
    setGoogleResults([]);
    setConfirmedStatus(null);
    setEditingOrderId(null);
    setShowCustomerDropdown(false);
  };

  const handleStartEdit = (ord: ServiceOrder) => {
    setEditingOrderId(ord.id);
    setSelectedCustomerId(ord.customerId);
    setName(ord.customer.name);
    setCustomerSearch(ord.customer.name);
    setVillage(ord.customer.village);
    setPhone(ord.customer.phone || "");
    setEquipmentInfo(ord.equipmentInfo || ord.customer.equipmentInfo || "");
    setLat(ord.customer.coordinates.lat.toFixed(6));
    setLng(ord.customer.coordinates.lng.toFixed(6));
    setInternalNotes(ord.customer.internalNotes || "");
    setServiceType(ord.serviceType);
    setOrderPriority(ord.priority);
    setEstimatedMinutes(ord.estimatedMinutes);
    setEstimatedPriceEur(
      ord.estimatedPriceEur && ord.estimatedPriceEur > 0
        ? String(ord.estimatedPriceEur)
        : ""
    );
    setTechnicalNotes(ord.technicalNotes || "");
    setGoogleQuery("");
    setShowGoogleDropdown(false);
    setShowCustomerDropdown(false);
    setConfirmedStatus(
      `✏️ Editando aviso de ${ord.customer.name} (${ord.serviceType} · ${ord.estimatedMinutes} min).`
    );

    setTimeout(() => {
      formContainerRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 60);
  };

  const handleQuickDurationDelta = (orderId: string, delta: number) => {
    onUpdateOrderDuration(orderId, delta, true);
    if (editingOrderId === orderId) {
      setEstimatedMinutes((prev) => Math.max(15, Math.min(480, prev + delta)));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !village.trim()) return;

    const effectiveCustomerId =
      selectedCustomerId || detectedExistingCustomer?.id || undefined;
    const combinedNotes = technicalNotes.trim() || internalNotes.trim();
    const parsedPrice = Math.max(
      0,
      parseFloat(estimatedPriceEur.replace(",", ".")) || 0
    );

    const savedCustomer = onSaveCustomer({
      id: effectiveCustomerId,
      name,
      village,
      phone,
      equipmentInfo,
      coordinates: {
        lat: parseFloat(lat) || 42.2982,
        lng: parseFloat(lng) || -7.8185,
      },
      internalNotes: combinedNotes,
      lastServiceType: serviceType,
      lastInterventionMinutes: estimatedMinutes,
    });

    const targetCustId = effectiveCustomerId || (savedCustomer as any)?.id;

    if (editingOrderId) {
      onUpdateOrder(editingOrderId, {
        serviceType,
        priority: orderPriority,
        equipmentInfo,
        estimatedMinutes,
        estimatedPriceEur: parsedPrice,
        technicalNotes: combinedNotes,
      });
      const msg = `💾 ¡Cambios guardados para ${name} (${serviceType} · ${estimatedMinutes} min)!`;
      setQuickOrderFeedback(msg);
      setTimeout(() => {
        setQuickOrderFeedback((prev) => (prev === msg ? null : prev));
      }, 4500);
      resetForm();
    } else {
      if (targetCustId) {
        onSaveOrder(targetCustId, {
          serviceType,
          priority: orderPriority,
          equipmentInfo,
          estimatedMinutes,
          estimatedPriceEur: parsedPrice,
          technicalNotes: combinedNotes,
        });
        const msg = `✅ Parte de ${serviceType} para ${name} (${estimatedMinutes} min) añadido a la cola`;
        setQuickOrderFeedback(msg);
        setTimeout(() => {
          setQuickOrderFeedback((prev) => (prev === msg ? null : prev));
        }, 4500);
      }
      resetForm();
    }
  };

  const pendingOrders = orders.filter(
    (o) => o.status === "Pendiente" || o.status === "En Ruta"
  );
  const completedOrders = orders.filter((o) => o.status === "Completado");
  const totalPendingMinutes = pendingOrders.reduce(
    (sum, o) => sum + o.estimatedMinutes,
    0
  );
  const workdayOccupancyPercent = Math.round(
    (totalPendingMinutes / Math.max(1, maxWorkdayMinutes)) * 100
  );

  const filteredQueueOrders = useMemo(() => {
    const q = normalizeGaliciaText(queueSearchQuery);
    return orders.filter((ord) => {
      if (
        queueStatusFilter === "ACTIVOS" &&
        ord.status !== "Pendiente" &&
        ord.status !== "En Ruta"
      ) {
        return false;
      }
      if (queueStatusFilter === "Completado" && ord.status !== "Completado") {
        return false;
      }
      if (onlyUrgentFilter && ord.priority !== "Urgente") {
        return false;
      }
      if (q) {
        return (
          normalizeGaliciaText(ord.customer.name).includes(q) ||
          normalizeGaliciaText(ord.customer.village).includes(q) ||
          normalizeGaliciaText(
            ord.equipmentInfo || ord.customer.equipmentInfo || ""
          ).includes(q) ||
          normalizeGaliciaText(
            ord.technicalNotes || ord.customer.internalNotes || ""
          ).includes(q)
        );
      }
      return true;
    });
  }, [orders, queueStatusFilter, queueSearchQuery, onlyUrgentFilter]);

  const handleAppendNoteChip = (chipText: string) => {
    setTechnicalNotes((prev) => {
      const clean = prev.trim();
      if (!clean) return chipText;
      if (clean.toLowerCase().includes(chipText.toLowerCase())) return clean;
      return `${clean} · ${chipText}`;
    });
  };

  return (
    <div className="space-y-6">
      {quickOrderFeedback && (
        <div className="p-4 rounded-2xl bg-emerald-500/20 border-2 border-emerald-500/70 text-emerald-300 font-black text-xs sm:text-sm flex items-center justify-between shadow-xl shadow-emerald-950/50 animate-in fade-in duration-200">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <span>{quickOrderFeedback}</span>
          </div>
          <button
            type="button"
            onClick={() => setQuickOrderFeedback(null)}
            className="text-emerald-300 hover:text-white px-2 py-0.5 rounded-lg text-xs font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* CAJÓN DESPLEGABLE: CARTERA DE CLIENTES E INSTALACIONES */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl shadow-xl overflow-hidden">
        <div className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/20">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black uppercase tracking-wider text-white">
                  👥 Cartera de Clientes e Instalaciones ({customers.length})
                </h2>
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  Nuevo Aviso en 1 Clic
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Crea partes de avería o revisión en 1 segundo usando las coordenadas GPS y equipo ya guardados.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowHabitualDrawer((prev) => !prev)}
            className={`px-4 py-2.5 rounded-2xl text-xs font-black transition flex items-center gap-2 border ${
              showHabitualDrawer
                ? "bg-amber-500 text-slate-950 border-amber-400 shadow-lg shadow-amber-500/20"
                : "bg-slate-800 hover:bg-slate-700 text-amber-400 border-slate-700"
            }`}
          >
            <Users className="w-4 h-4" />
            <span>
              {showHabitualDrawer
                ? "Ocultar Cartera"
                : `Abrir Cartera (${customers.length})`}
            </span>
            {showHabitualDrawer ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
        </div>

        {showHabitualDrawer && (
          <div className="p-5 border-t border-slate-800 space-y-4 bg-slate-950/50">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-5 relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  placeholder="Buscar por nombre, aldea, equipo o teléfono..."
                  value={habitualSearch}
                  onChange={(e) => setHabitualSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 text-xs bg-slate-900 border border-slate-700 rounded-xl text-white font-bold outline-none focus:border-amber-500"
                />
              </div>

              <div className="sm:col-span-3 flex items-center gap-2">
                <Filter className="w-4 h-4 text-amber-400 shrink-0" />
                <select
                  value={habitualConcelloFilter}
                  onChange={(e) => setHabitualConcelloFilter(e.target.value)}
                  className="w-full px-3 py-2.5 text-xs bg-slate-900 border border-slate-700 rounded-xl text-white font-bold outline-none focus:border-amber-500"
                >
                  <option value="ALL">Todos los Concellos / Zonas</option>
                  {availableConcellos.map((concello) => (
                    <option key={concello} value={concello}>
                      📍 {concello}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-4 flex items-center gap-2">
                <ArrowUpDown className="w-4 h-4 text-amber-400 shrink-0" />
                <select
                  value={habitualSort}
                  onChange={(e) =>
                    setHabitualSort(
                      e.target.value as
                        | "frequent"
                        | "recent"
                        | "inactive"
                        | "alpha"
                    )
                  }
                  className="w-full px-3 py-2.5 text-xs bg-slate-900 border border-slate-700 rounded-xl text-white font-bold outline-none focus:border-amber-500"
                >
                  <option value="frequent">🏆 Más asistencias históricas</option>
                  <option value="inactive">⏳ Más tiempo sin revisión</option>
                  <option value="recent">🕒 Último aviso más reciente</option>
                  <option value="alpha">🔤 Orden Alfabético (A-Z)</option>
                </select>
              </div>
            </div>

            {filteredHabitualCustomers.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs border border-dashed border-slate-800 rounded-2xl">
                {customers.length === 0
                  ? "Todavía no hay clientes guardados. Registra tu primer aviso abajo y quedará guardado automáticamente."
                  : "No hay clientes que coincidan con ese filtro."}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 max-h-[520px] overflow-y-auto pr-1">
                {filteredHabitualCustomers.map((c) => {
                  const cardMins =
                    habitualCardMinutes[c.id] ??
                    c.lastInterventionMinutes ??
                    45;
                  const cardType: ServiceType =
                    habitualCardType[c.id] ?? c.lastServiceType ?? "Avería";
                  const daysInfo = formatDaysSinceService(
                    c.lastServiceDate || c.updatedAt
                  );
                  const activeQueue = activeOrderByCustomerId[c.id];

                  return (
                    <div
                      key={c.id}
                      className={`p-4 rounded-2xl border transition flex flex-col justify-between gap-3 text-xs ${
                        activeQueue
                          ? "bg-amber-500/10 border-amber-500/50"
                          : "bg-slate-900/90 border-slate-800 hover:border-slate-700"
                      }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-black text-white text-sm">
                              {c.name}
                            </div>
                            <div className="text-[11px] text-slate-300 flex items-center gap-1 mt-0.5">
                              <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                              <span className="line-clamp-1">{c.village}</span>
                            </div>
                          </div>

                          {activeQueue ? (
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-amber-500 text-slate-950 shrink-0 shadow">
                              🕒 En cola ({activeQueue.totalMinutes}m)
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700 shrink-0">
                              {daysInfo.label}
                            </span>
                          )}
                        </div>

                        {c.equipmentInfo && (
                          <div className="px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-bold text-amber-300">
                            ⚙️ {c.equipmentInfo}
                          </div>
                        )}

                        {c.phone && (
                          <div className="text-[11px] text-slate-400 flex items-center gap-1">
                            <Phone className="w-3 h-3 text-slate-500" />
                            <span>{c.phone}</span>
                          </div>
                        )}
                      </div>

                      <div className="space-y-2 pt-1 border-t border-slate-800/80">
                        <div className="flex items-center justify-between gap-1">
                          <div className="flex items-center gap-1">
                            {(
                              ["Avería", "Revisión", "Instalación"] as ServiceType[]
                            ).map((tp) => (
                              <button
                                key={tp}
                                type="button"
                                onClick={() =>
                                  setHabitualCardType((prev) => ({
                                    ...prev,
                                    [c.id]: tp,
                                  }))
                                }
                                className={`px-2 py-1 rounded-lg text-[10px] font-bold transition ${
                                  cardType === tp
                                    ? "bg-amber-500 text-slate-950 font-black"
                                    : "bg-slate-800 text-slate-400 hover:text-white"
                                }`}
                              >
                                {tp === "Avería"
                                  ? "🔧 Avería"
                                  : tp === "Revisión"
                                  ? "📋 Rev."
                                  : "⚙️ Inst."}
                              </button>
                            ))}
                          </div>

                          <div className="flex items-center gap-1">
                            {[30, 45, 60, 90].map((m) => (
                              <button
                                key={m}
                                type="button"
                                onClick={() =>
                                  setHabitualCardMinutes((prev) => ({
                                    ...prev,
                                    [c.id]: m,
                                  }))
                                }
                                className={`px-1.5 py-1 rounded-lg text-[10px] font-bold ${
                                  cardMins === m
                                    ? "bg-sky-600 text-white font-black"
                                    : "bg-slate-800 text-slate-400"
                                }`}
                              >
                                {m}m
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              handleQuickCreateService(c, cardType, cardMins)
                            }
                            className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs transition shadow-md shadow-emerald-600/20 flex items-center justify-center gap-1.5"
                          >
                            <Zap className="w-3.5 h-3.5" />
                            <span>
                              ⚡ Crear {cardType} ({cardMins}m)
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              selectExistingCustomer(c);
                              setShowHabitualDrawer(false);
                            }}
                            title="Cargar en formulario y ver en mapa satélite"
                            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-400 border border-slate-700 transition"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>

                          {confirmDeleteCustomerId === c.id ? (
                            <div className="flex items-center gap-1 bg-red-950/80 border border-red-500/60 px-2 py-1 rounded-xl">
                              <button
                                type="button"
                                onClick={() => {
                                  onDeleteCustomer(c.id);
                                  setConfirmDeleteCustomerId(null);
                                }}
                                className="text-[10px] font-black text-red-300 hover:text-white px-1.5 py-0.5 rounded bg-red-600"
                              >
                                Sí
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteCustomerId(null)}
                                className="text-[10px] font-bold text-slate-300 hover:text-white px-1"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteCustomerId(c.id)}
                              title="Eliminar cliente"
                              className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-red-400 border border-slate-700 transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* COLUMNA IZQUIERDA: FORMULARIO DE CLIENTE Y PARTE DE TRABAJO */}
        <div
          ref={formContainerRef}
          className={`lg:col-span-7 bg-slate-900 border p-6 rounded-3xl shadow-xl space-y-5 transition-colors ${
            editingOrderId
              ? "border-amber-500/80 ring-1 ring-amber-500/40"
              : "border-slate-800"
          }`}
        >
          {editingOrderId ? (
            <div className="flex items-center justify-between bg-amber-500/15 border-2 border-amber-500/60 p-3.5 rounded-2xl">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-black shadow-md">
                  <Pencil className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-black text-amber-300">
                    ✏️ Editando aviso de {name || "Cliente"}
                  </h2>
                  <p className="text-[11px] text-slate-300">
                    Ajusta tipo, urgencia, duración, equipo o afina la chincheta en el satélite.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={resetForm}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold transition flex items-center gap-1.5 border border-slate-700 shrink-0"
              >
                <X className="w-3.5 h-3.5" />
                <span>Cancelar</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-amber-400" />
                  Nuevo Parte / Aviso Técnico (Avería o Revisión)
                </h2>
                <p className="text-xs text-slate-400">
                  Localización exacta por Google Maps Satélite Híbrido + Ficha de Equipo.
                </p>
              </div>
              {selectedCustomerId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs font-bold text-slate-400 hover:text-white"
                >
                  Limpiar Formulario
                </button>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* SUPER-BUSCADOR DE CLIENTES */}
            <div className="relative space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-black text-slate-200">
                  Buscar Cliente / Instalación Habitual o Escribir Nuevo *
                </label>
                {customers.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setShowCustomerDropdown((prev) => !prev)
                    }
                    className="text-[11px] font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1"
                  >
                    <Zap className="w-3 h-3" />
                    <span>
                      {showCustomerDropdown
                        ? "Cerrar lista rápida"
                        : `Ver recientes (${customers.length})`}
                    </span>
                  </button>
                )}
              </div>

              <div className="relative">
                <Search className="w-4 h-4 text-amber-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  required
                  placeholder="Escribe nombre, teléfono, aldea o equipo..."
                  value={name}
                  onFocus={() => {
                    if (customers.length > 0 && !editingOrderId) {
                      setShowCustomerDropdown(true);
                    }
                  }}
                  onChange={(e) => {
                    setName(e.target.value);
                    setCustomerSearch(e.target.value);
                    setShowCustomerDropdown(true);
                    if (selectedCustomerId) setSelectedCustomerId(null);
                  }}
                  className="w-full pl-10 pr-9 py-2.5 text-xs bg-slate-800 border border-slate-700 rounded-xl text-white font-bold outline-none focus:border-amber-500"
                />
                {name && (
                  <button
                    type="button"
                    onClick={() => {
                      setName("");
                      setCustomerSearch("");
                      setSelectedCustomerId(null);
                    }}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-white text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>

              {detectedExistingCustomer && !selectedCustomerId && (
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-2 text-[11px]">
                  <div className="text-amber-200">
                    💡 Coincide con cliente guardado:{" "}
                    <strong className="text-white">
                      {detectedExistingCustomer.name}
                    </strong>{" "}
                    ({detectedExistingCustomer.village}).
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      selectExistingCustomer(detectedExistingCustomer)
                    }
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-[10px] border border-slate-700 shrink-0"
                  >
                    ✏️ Cargar GPS y Equipo
                  </button>
                </div>
              )}

              {showCustomerDropdown &&
                matchingCustomers.length > 0 &&
                !editingOrderId && (
                  <div className="absolute left-0 right-0 top-full mt-1.5 bg-slate-900 border-2 border-amber-500/60 rounded-2xl shadow-2xl z-30 max-h-80 overflow-y-auto p-2 space-y-1.5">
                    <div className="flex items-center justify-between px-2 py-1 border-b border-slate-800 text-[10px] font-black uppercase text-slate-400">
                      <span>Clientes e Instalaciones ({matchingCustomers.length})</span>
                      <button
                        type="button"
                        onClick={() => setShowCustomerDropdown(false)}
                        className="text-slate-400 hover:text-white"
                      >
                        ✕ Cerrar
                      </button>
                    </div>

                    {matchingCustomers.map((c) => (
                      <div
                        key={c.id}
                        className="p-2.5 rounded-xl bg-slate-800/90 hover:bg-slate-800 border border-slate-700/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-black text-white text-xs">
                            {c.name}
                          </div>
                          <div className="text-[11px] text-slate-300 truncate">
                            📍 {c.village}
                            {c.equipmentInfo ? ` · ⚙️ ${c.equipmentInfo}` : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              handleQuickCreateService(c, "Avería", 45)
                            }
                            className="px-2.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-black text-[10px]"
                          >
                            🔧 + Avería
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleQuickCreateService(c, "Revisión", 45)
                            }
                            className="px-2.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-black text-[10px]"
                          >
                            📋 + Revisión
                          </button>
                          <button
                            type="button"
                            onClick={() => selectExistingCustomer(c)}
                            className="px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-[10px]"
                          >
                            ✏️ Cargar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
            </div>

            {/* BUSCADOR GOOGLE MAPS + PEGAR COORDS */}
            <div className="relative p-4 rounded-2xl bg-slate-950 border-2 border-amber-500/40 space-y-2.5 shadow-inner">
              <div className="flex items-center justify-between">
                <label className="text-xs font-black uppercase tracking-wider text-amber-400 flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] font-black shadow">
                    G
                  </div>
                  <span>Buscar Ubicación en Google Maps (Aldea, nave, calle...)</span>
                </label>

                {isSearchingGoogle && (
                  <span className="text-[11px] text-amber-400 font-bold flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando...
                  </span>
                )}
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Ej. Polígono San Cibrao, Bar A Boeira Allariz, O Vilar..."
                  value={googleQuery}
                  onChange={(e) => setGoogleQuery(e.target.value)}
                  onFocus={() => {
                    if (googleResults.length > 0) setShowGoogleDropdown(true);
                  }}
                  className="flex-1 px-4 py-2.5 text-xs bg-slate-900 border border-slate-700 rounded-xl text-white font-bold outline-none focus:border-amber-500"
                />
                <button
                  type="button"
                  onClick={handlePasteCoordsOrLink}
                  className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold shrink-0 flex items-center gap-1.5 transition"
                >
                  <ClipboardPaste className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden sm:inline">Pegar Coords/Link</span>
                </button>
              </div>

              {showGoogleDropdown && googleResults.length > 0 && (
                <div className="absolute left-3 right-3 top-full mt-1.5 bg-slate-900 border-2 border-amber-500/60 rounded-2xl shadow-2xl z-30 max-h-64 overflow-y-auto p-1.5 space-y-1">
                  <div className="flex items-center justify-between px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase border-b border-slate-800">
                    <span>Resultados encontrados:</span>
                    <button
                      type="button"
                      onClick={() => setShowGoogleDropdown(false)}
                      className="text-slate-400 hover:text-white"
                    >
                      ✕ Cerrar
                    </button>
                  </div>
                  {googleResults.map((place) => (
                    <button
                      key={place.id}
                      type="button"
                      onClick={() => handleSelectGooglePlace(place)}
                      className="w-full text-left p-2.5 rounded-xl hover:bg-slate-800 text-xs flex items-center justify-between gap-2 transition"
                    >
                      <div>
                        <div className="font-black text-white text-sm">
                          {place.title}
                        </div>
                        <div className="text-[11px] text-slate-300">
                          {place.subtitle}
                        </div>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-amber-300 border border-slate-700 shrink-0">
                        {place.source}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* CAMPOS DE DIRECCIÓN, TELÉFONO Y EQUIPO */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Dirección / Aldea / Concello *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Lugar de Vilar 12, Allariz"
                  value={village}
                  onChange={(e) => setVillage(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Teléfono de Contacto
                </label>
                <input
                  type="text"
                  placeholder="Ej. 654 321 987"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">
                Equipo / Instalación a Revisar o Reparar
              </label>
              <input
                type="text"
                placeholder="Ej. Caldera Domusa 25kW, Aerotermia Daikin, Cuadro eléctrico trifásico..."
                value={equipmentInfo}
                onChange={(e) => setEquipmentInfo(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded-xl text-amber-200 font-bold outline-none focus:border-amber-500"
              />
            </div>

            {/* MAPA SATÉLITE */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-300 flex items-center gap-1.5">
                  <Satellite className="w-4 h-4 text-amber-400" />
                  Ubicación Exacta en Satélite (Haz clic sobre el tejado o entrada)
                </span>
                <span className="font-mono text-[11px] text-amber-400 font-bold flex items-center gap-1">
                  <Crosshair className="w-3.5 h-3.5" />
                  {lat}, {lng}
                </span>
              </div>

              {confirmedStatus && (
                <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-bold">
                  {confirmedStatus}
                </div>
              )}

              <PrecisionMapPicker
                coordinates={{
                  lat: parseFloat(lat) || 42.2982,
                  lng: parseFloat(lng) || -7.8185,
                }}
                onChange={handleMapClick}
                height="280px"
                zoom={19}
              />
            </div>

            {/* BLOQUE DATOS DEL PARTE / AVISO */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-black uppercase tracking-wider text-white">
                  Tipo de Aviso y Prioridad
                </label>

                <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-xl border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setOrderPriority("Normal")}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition ${
                      orderPriority === "Normal"
                        ? "bg-slate-800 text-white"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Prioridad Normal
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderPriority("Urgente")}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-black transition flex items-center gap-1 ${
                      orderPriority === "Urgente"
                        ? "bg-rose-600 text-white shadow"
                        : "text-rose-400/70 hover:text-rose-300"
                    }`}
                  >
                    <Flame className="w-3 h-3" />
                    <span>🚨 Urgente (Turno #1)</span>
                  </button>
                </div>
              </div>

              {/* 3 Tipos de Servicio */}
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { type: "Avería", icon: Wrench, activeCls: "bg-amber-500 text-slate-950 font-black" },
                    { type: "Revisión", icon: ClipboardCheck, activeCls: "bg-sky-500 text-slate-950 font-black" },
                    { type: "Instalación", icon: Cog, activeCls: "bg-emerald-500 text-slate-950 font-black" },
                  ] as const
                ).map(({ type, icon: Icon, activeCls }) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setServiceType(type)}
                    className={`py-2.5 px-3 rounded-xl text-xs border transition flex items-center justify-center gap-1.5 ${
                      serviceType === type
                        ? `${activeCls} border-transparent shadow-md`
                        : "bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800 font-bold"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{type}</span>
                  </button>
                ))}
              </div>

              {/* Duración Estimada y Presupuesto */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-slate-300">
                      Duración Estimada (min)
                    </span>
                    <span className="font-mono font-black text-amber-400">
                      {formatHoursMinutes(estimatedMinutes)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setEstimatedMinutes((m) => Math.max(15, m - 15))
                      }
                      className="px-2.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold"
                    >
                      -15m
                    </button>
                    <input
                      type="number"
                      min={15}
                      max={480}
                      step={15}
                      value={estimatedMinutes}
                      onChange={(e) =>
                        setEstimatedMinutes(
                          Math.max(15, parseInt(e.target.value, 10) || 45)
                        )
                      }
                      className="w-full text-center text-base font-black py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-amber-400 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setEstimatedMinutes((m) => Math.min(480, m + 15))
                      }
                      className="px-2.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold"
                    >
                      +15m
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {[30, 45, 60, 90, 120].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setEstimatedMinutes(m)}
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${
                          estimatedMinutes === m
                            ? "bg-amber-500 text-slate-950 font-black"
                            : "bg-slate-800 text-slate-400 hover:text-white"
                        }`}
                      >
                        {m}m
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[11px] font-bold text-slate-300">
                    Presupuesto / Cobro Est. (€)
                  </label>
                  <input
                    type="number"
                    step="5"
                    min={0}
                    placeholder="Ej. 85.00 (0 = garantía)"
                    value={estimatedPriceEur}
                    onChange={(e) => setEstimatedPriceEur(e.target.value)}
                    className="w-full px-3 py-2 text-base bg-slate-900 border border-slate-700 rounded-xl text-emerald-400 font-mono font-black outline-none focus:border-emerald-500"
                  />
                  <span className="text-[10px] text-slate-400 block">
                    Se mostrará al técnico al cerrar el parte para confirmar cobro.
                  </span>
                </div>
              </div>
            </div>

            {/* NOTAS TÉCNICAS + CHIPS RÁPIDOS */}
            <div className="space-y-2">
              <label className="block text-[11px] font-bold text-slate-300">
                Síntoma / Material Necesario / Notas de Acceso
              </label>
              <input
                type="text"
                placeholder="Ej. Falla encendido, llevar electrodo y junta, llaves en portería..."
                value={technicalNotes}
                onChange={(e) => setTechnicalNotes(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-amber-500"
              />
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span className="text-[10px] text-slate-400 font-bold mr-1">
                  + Añadir en 1 clic:
                </span>
                {[
                  "🧰 Llevar repuestos/maletín",
                  "🔑 Recoger llaves",
                  "🐕 Perro en finca",
                  "📞 Llamar antes de ir",
                  "⚡ Revisar cuadro/toma",
                  estimatedPriceEur && parseFloat(estimatedPriceEur) > 0
                    ? `💶 Cobrar ${estimatedPriceEur}€ al finalizar`
                    : "💶 Cobrar al finalizar",
                ].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => handleAppendNoteChip(chip)}
                    className="px-2 py-1 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-slate-700 text-[10px] font-bold text-slate-300 hover:text-amber-300 transition"
                  >
                    + {chip}
                  </button>
                ))}
              </div>
            </div>

            {/* BOTÓN GUARDAR / REGISTRAR */}
            {editingOrderId ? (
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={resetForm}
                  className="w-1/3 py-4 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs sm:text-sm transition border border-slate-700 flex items-center justify-center gap-1.5"
                >
                  <X className="w-4 h-4" />
                  <span>Cancelar</span>
                </button>
                <button
                  type="submit"
                  className="w-2/3 py-4 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs sm:text-sm transition shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4 sm:w-5 sm:h-5" />
                  <span>
                    💾 Guardar Cambios ({serviceType} · {estimatedMinutes} min)
                  </span>
                </button>
              </div>
            ) : (
              <button
                type="submit"
                className="w-full py-4 px-4 rounded-2xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-black text-sm transition shadow-lg shadow-amber-600/25 flex items-center justify-center gap-2"
              >
                <Plus className="w-5 h-5" />
                <span>
                  Registrar Parte ({serviceType} · {estimatedMinutes} min)
                </span>
              </button>
            )}
          </form>
        </div>

        {/* COLUMNA DERECHA: COLA DE AVISOS */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl space-y-4">
            <div className="space-y-3 border-b border-slate-800 pb-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black uppercase tracking-wider text-white">
                  Cola de Avisos ({filteredQueueOrders.length})
                </h3>
                <span className="text-xs text-amber-400 font-bold">
                  Activos: {formatHoursMinutes(totalPendingMinutes)}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-2xl border border-slate-800 text-[11px] font-bold">
                <button
                  type="button"
                  onClick={() => setQueueStatusFilter("ACTIVOS")}
                  className={`py-1.5 px-2 rounded-xl transition ${
                    queueStatusFilter === "ACTIVOS"
                      ? "bg-amber-500 text-slate-950 font-black shadow"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Activos ({pendingOrders.length})
                </button>
                <button
                  type="button"
                  onClick={() => setQueueStatusFilter("Completado")}
                  className={`py-1.5 px-2 rounded-xl transition ${
                    queueStatusFilter === "Completado"
                      ? "bg-emerald-600 text-white font-black shadow"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Cerrados ({completedOrders.length})
                </button>
                <button
                  type="button"
                  onClick={() => setQueueStatusFilter("ALL")}
                  className={`py-1.5 px-2 rounded-xl transition ${
                    queueStatusFilter === "ALL"
                      ? "bg-slate-800 text-white font-black shadow"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Todos ({orders.length})
                </button>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Filtrar por cliente, aldea, equipo..."
                    value={queueSearchQuery}
                    onChange={(e) => setQueueSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-amber-500"
                  />
                  {queueSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setQueueSearchQuery("")}
                      className="absolute right-2.5 top-2 text-slate-400 hover:text-white text-xs"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setOnlyUrgentFilter((p) => !p)}
                  className={`px-2.5 py-1.5 rounded-xl text-[10px] font-black border transition flex items-center gap-1 shrink-0 ${
                    onlyUrgentFilter
                      ? "bg-rose-600/25 border-rose-500 text-rose-300"
                      : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white"
                  }`}
                >
                  <Flame className="w-3.5 h-3.5" />
                  <span>🚨 Urgentes</span>
                </button>
              </div>

              {/* Barra de ocupación de jornada */}
              <div className="space-y-1.5 bg-slate-950/80 p-3 rounded-2xl border border-slate-800/80">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400 font-bold flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                    <span>Carga Trabajo ({formatHoursMinutes(maxWorkdayMinutes)} máx.):</span>
                  </span>
                  <span
                    className={`font-black ${
                      totalPendingMinutes > maxWorkdayMinutes
                        ? "text-red-400"
                        : "text-amber-400"
                    }`}
                  >
                    {totalPendingMinutes} / {maxWorkdayMinutes} min ({workdayOccupancyPercent}%)
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className={`h-full transition-all duration-300 ${
                      totalPendingMinutes > maxWorkdayMinutes
                        ? "bg-red-500"
                        : "bg-gradient-to-r from-amber-500 to-amber-400"
                    }`}
                    style={{
                      width: `${Math.min(100, workdayOccupancyPercent)}%`,
                    }}
                  />
                </div>
                {totalPendingMinutes > maxWorkdayMinutes && (
                  <p className="text-[10px] text-amber-300/90 flex items-center gap-1 font-medium">
                    <AlertTriangle className="w-3 h-3 shrink-0 text-amber-400" />
                    Supera 1 jornada: el Planificador dividirá en varios turnos.
                  </p>
                )}
              </div>
            </div>

            {filteredQueueOrders.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-2xl space-y-1">
                <p className="font-bold text-slate-400">
                  No hay avisos en esta vista
                </p>
                <p className="text-[11px]">
                  Registra un nuevo parte en el formulario o cambia el filtro superior.
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[660px] overflow-y-auto pr-1">
                {filteredQueueOrders.map((ord, i) => {
                  const isEditing = editingOrderId === ord.id;
                  const isCompleted = ord.status === "Completado";
                  const isInRoute = ord.status === "En Ruta";
                  const isUrgent = ord.priority === "Urgente";
                  const meta = getServiceTypeBadgeMeta(
                    ord.serviceType,
                    ord.priority
                  );
                  const { cashToCollectEur } = extractTechTagsFromNotes(
                    ord.technicalNotes || ord.customer.internalNotes,
                    ord.estimatedPriceEur
                  );

                  return (
                    <div
                      key={ord.id}
                      className={`p-4 rounded-2xl transition flex items-start justify-between gap-3 text-xs border ${
                        isEditing
                          ? "bg-amber-500/10 border-amber-400 ring-2 ring-amber-400/80 shadow-lg"
                          : isUrgent && !isCompleted
                          ? "bg-rose-950/20 border-rose-500/50 hover:border-rose-400"
                          : isInRoute
                          ? "bg-sky-950/25 border-sky-500/50"
                          : isCompleted
                          ? "bg-slate-900/60 border-slate-800 opacity-75"
                          : "bg-slate-800/80 border-slate-700/80 hover:border-slate-600"
                      }`}
                    >
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="w-5 h-5 rounded-lg bg-slate-900 font-bold flex items-center justify-center text-[10px] text-slate-400 shrink-0">
                            {i + 1}
                          </span>
                          <span className="font-extrabold text-white text-sm truncate">
                            {ord.customer.name}
                          </span>
                          <span
                            className={`text-[10px] font-black px-2 py-0.5 rounded-full shrink-0 ${meta.badgeClass}`}
                          >
                            {meta.emoji} {meta.label}
                          </span>
                          {isInRoute && (
                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/40 shrink-0">
                              🚐 En Ruta
                            </span>
                          )}
                          {isCompleted && (
                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0">
                              ✓ Cerrado
                            </span>
                          )}
                        </div>

                        <div className="text-slate-300 text-[11px] flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span className="line-clamp-1">
                            {ord.customer.village}
                          </span>
                        </div>

                        {(ord.equipmentInfo || ord.customer.equipmentInfo) && (
                          <div className="text-[11px] font-bold text-amber-300">
                            ⚙️ {ord.equipmentInfo || ord.customer.equipmentInfo}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2 pt-0.5">
                          <span className="text-amber-400 font-black text-xs font-mono">
                            ⏱️ {ord.actualMinutes ?? ord.estimatedMinutes} min
                          </span>

                          {!isCompleted && (
                            <div className="flex items-center gap-1 bg-slate-950 rounded-lg p-0.5 border border-slate-700/80">
                              <button
                                type="button"
                                onClick={() =>
                                  handleQuickDurationDelta(ord.id, -15)
                                }
                                className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                              >
                                -15m
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleQuickDurationDelta(ord.id, +15)
                                }
                                className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-slate-800 hover:bg-slate-700 text-amber-300"
                              >
                                +15m
                              </button>
                            </div>
                          )}

                          {ord.collectedPriceEur !== undefined &&
                          ord.collectedPriceEur > 0 ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono text-[10px] font-black">
                              💶 Cobrado: {ord.collectedPriceEur.toFixed(2)} €
                            </span>
                          ) : cashToCollectEur > 0 ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 font-mono text-[10px] font-black">
                              💶 Presup: {cashToCollectEur.toFixed(2)} €
                            </span>
                          ) : null}
                        </div>

                        {ord.technicalNotes && (
                          <div className="text-[10px] text-amber-200/90 italic">
                            “{ord.technicalNotes}”
                          </div>
                        )}
                        {ord.resolutionNote && (
                          <div className="text-[10px] text-emerald-300 font-bold">
                            ✓ Cierre: {ord.resolutionNote}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleStartEdit(ord)}
                          className={`p-2 rounded-xl transition flex items-center gap-1 font-bold ${
                            isEditing
                              ? "bg-amber-500 text-slate-950 font-black shadow"
                              : "text-slate-400 hover:text-amber-400 hover:bg-slate-700"
                          }`}
                          title="Editar aviso"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>

                        {isCompleted ? (
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateOrderStatus(ord.id, "Pendiente")
                            }
                            className="p-2 rounded-xl text-slate-400 hover:text-amber-400 hover:bg-slate-700 transition"
                            title="Reabrir aviso a Pendiente"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateOrderStatus(ord.id, "Completado")
                            }
                            className="p-2 rounded-xl text-slate-400 hover:text-emerald-400 hover:bg-slate-700 transition"
                            title="Marcar cerrado"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            if (editingOrderId === ord.id) resetForm();
                            onDeleteOrder(ord.id);
                          }}
                          className="p-2 rounded-xl text-slate-400 hover:text-red-400 hover:bg-slate-700 transition"
                          title="Eliminar aviso"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
