"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import {
  Customer,
  ServiceOrder,
  ServiceType,
  OrderPriority,
  TechnicianConfig,
  UserProfile,
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
  LocateFixed,
  Building2,
  Home,
  ExternalLink,
  Route as RouteIcon,
} from "lucide-react";
import {
  searchGoogleMapsLive,
  reverseGeocodeGalicia,
  resolveMapLocation,
  detectDirectLocationInput,
  extractGaliciaCoordinates,
  GoogleSearchResultItem,
} from "@/utils/galiciaGeocoding";
import {
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
      <div className="h-[260px] w-full bg-slate-950/70 rounded-2xl flex items-center justify-center text-slate-400 text-xs border border-white/[0.06] animate-pulse">
        Cargando mapa satélite híbrido...
      </div>
    ),
  }
);

interface CustomerOrdersTabProps {
  customers: Customer[];
  orders: ServiceOrder[];
  config: TechnicianConfig;
  technicians?: UserProfile[];
  maxWorkdayMinutes: number;
  onSaveCustomer: (
    customer: Omit<Customer, "id" | "createdAt" | "updatedAt"> & { id?: string }
  ) => Promise<Customer | void> | Customer | void;
  onDeleteCustomer: (id: string) => Promise<void> | void;
  onSaveOrder: (
    customerId: string,
    payload: {
      assignedTechId?: string | null;
      serviceType?: ServiceType;
      priority?: OrderPriority;
      equipmentInfo?: string;
      estimatedMinutes?: number;
      estimatedPriceEur?: number;
      technicalNotes?: string;
    }
  ) => Promise<void> | void;
  onUpdateOrder: (
    orderId: string,
    updates: {
      assignedTechId?: string | null;
      serviceType?: ServiceType;
      priority?: OrderPriority;
      equipmentInfo?: string;
      estimatedMinutes?: number;
      estimatedPriceEur?: number;
      technicalNotes?: string;
      status?: ServiceOrder["status"];
    }
  ) => Promise<void> | void;
  onUpdateOrderDuration: (
    orderId: string,
    deltaOrExact: number,
    isDelta?: boolean
  ) => Promise<void> | void;
  onDeleteOrder: (id: string) => Promise<void> | void;
  onUpdateOrderStatus: (
    id: string,
    status: ServiceOrder["status"]
  ) => Promise<void> | void;
  onNavigateToPlanner?: () => void;
}

export default function CustomerOrdersTab({
  customers,
  orders,
  config,
  technicians = [],
  maxWorkdayMinutes,
  onSaveCustomer,
  onDeleteCustomer,
  onSaveOrder,
  onUpdateOrder,
  onUpdateOrderDuration,
  onDeleteOrder,
  onUpdateOrderStatus,
  onNavigateToPlanner,
}: CustomerOrdersTabProps) {
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const formContainerRef = useRef<HTMLDivElement>(null);

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
  const [lat, setLat] = useState(
    config.warehouseCoordinates.lat.toFixed(6)
  );
  const [lng, setLng] = useState(
    config.warehouseCoordinates.lng.toFixed(6)
  );
  const [internalNotes, setInternalNotes] = useState("");
  const [isLocationPinned, setIsLocationPinned] = useState(false);
  const [isMapExpanded, setIsMapExpanded] = useState(true);

  // Campos del Parte / Aviso SAT
  const [serviceType, setServiceType] = useState<ServiceType>("Avería");
  const [orderPriority, setOrderPriority] = useState<OrderPriority>("Normal");
  const [estimatedMinutes, setEstimatedMinutes] = useState<number>(
    FIELD_SERVICE_RULES.DEFAULT_INTERVENTION_MINUTES
  );
  const [estimatedPriceEur, setEstimatedPriceEur] = useState<string>("");
  const [technicalNotes, setTechnicalNotes] = useState("");
  const [assignedTechId, setAssignedTechId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filtros de la Cola de Avisos
  const [queueStatusFilter, setQueueStatusFilter] = useState<
    "ACTIVOS" | "Completado" | "ALL"
  >("ACTIVOS");
  const [queueSearchQuery, setQueueSearchQuery] = useState("");
  const [onlyUrgentFilter, setOnlyUrgentFilter] = useState(false);

  // Buscador Google Maps Inteligente
  const [googleQuery, setGoogleQuery] = useState("");
  const [googleResults, setGoogleResults] = useState<GoogleSearchResultItem[]>(
    []
  );
  const [isSearchingGoogle, setIsSearchingGoogle] = useState(false);
  const [hasSearchedOnce, setHasSearchedOnce] = useState(false);
  const [showGoogleDropdown, setShowGoogleDropdown] = useState(false);
  const [isGettingGps, setIsGettingGps] = useState(false);
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

  // Resolver directo si el usuario pega coordenadas o link en el buscador
  const handleDirectLocationResolution = async (inputStr: string) => {
    const kind = detectDirectLocationInput(inputStr);
    if (kind === "coords") {
      const coords = extractGaliciaCoordinates(inputStr);
      if (coords) {
        setLat(coords.lat.toFixed(6));
        setLng(coords.lng.toFixed(6));
        setIsLocationPinned(true);
        setIsMapExpanded(false);
        setShowGoogleDropdown(false);
        setGoogleQuery("");
        const geo = await reverseGeocodeGalicia(coords.lat, coords.lng);
        if (geo?.fullAddress && !village.trim()) {
          setVillage(geo.fullAddress);
        }
        setConfirmedStatus(
          `Coordenadas fijadas: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
        );
        return true;
      }
    }

    if (kind === "maps_url") {
      setIsSearchingGoogle(true);
      try {
        const resolved = await resolveMapLocation(inputStr);
        if (resolved) {
          setLat(resolved.lat.toFixed(6));
          setLng(resolved.lng.toFixed(6));
          setIsLocationPinned(true);
          setIsMapExpanded(false);
          setShowGoogleDropdown(false);
          setGoogleQuery("");
          if (resolved.resolvedAddress && !village.trim()) {
            setVillage(resolved.resolvedAddress);
          }
          setConfirmedStatus(
            `Ubicación extraída (${resolved.source}): ${resolved.lat.toFixed(
              5
            )}, ${resolved.lng.toFixed(5)}`
          );
          return true;
        }
      } finally {
        setIsSearchingGoogle(false);
      }
    }

    return false;
  };

  // Búsqueda en tiempo real con AbortController + bias hacia la Base
  useEffect(() => {
    const trimmed = googleQuery.trim();
    if (!trimmed || trimmed.length < 2) {
      setGoogleResults([]);
      setIsSearchingGoogle(false);
      setHasSearchedOnce(false);
      return;
    }

    const kind = detectDirectLocationInput(trimmed);
    if (kind === "coords" || kind === "maps_url") {
      handleDirectLocationResolution(trimmed);
      return;
    }

    const controller = new AbortController();
    setIsSearchingGoogle(true);

    const timer = setTimeout(async () => {
      try {
        const results = await searchGoogleMapsLive(
          trimmed,
          config.googleMapsApiKey,
          config.warehouseCoordinates,
          controller.signal
        );
        if (!controller.signal.aborted) {
          setGoogleResults(results);
          setHasSearchedOnce(true);
          setShowGoogleDropdown(true);
        }
      } catch (err) {
        console.error("Error buscando en Google Maps:", err);
      } finally {
        if (!controller.signal.aborted) {
          setIsSearchingGoogle(false);
        }
      }
    }, 320);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [googleQuery, config.googleMapsApiKey, config.warehouseCoordinates]);

  const handleSelectGooglePlace = (place: GoogleSearchResultItem) => {
    setVillage(place.fullAddress);
    const latStr = place.lat.toFixed(6);
    const lngStr = place.lng.toFixed(6);
    setLat(latStr);
    setLng(lngStr);
    setShowGoogleDropdown(false);
    setGoogleQuery("");
    setHasSearchedOnce(false);
    setIsLocationPinned(true);

    if (place.categoryType === "municipality") {
      setIsMapExpanded(true);
      setConfirmedStatus(
        `Centro del concello fijado (${latStr}, ${lngStr}). Haz clic en el mapa sobre la casa o nave exacta.`
      );
    } else {
      setIsMapExpanded(false);
      setConfirmedStatus(
        `Ubicación fijada (${place.source}): ${place.title} (${latStr}, ${lngStr})`
      );
    }
  };

  const handleUseMyGps = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setConfirmedStatus("Tu navegador no soporta geolocalización GPS.");
      return;
    }
    setIsGettingGps(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const latNum = Number(pos.coords.latitude.toFixed(6));
        const lngNum = Number(pos.coords.longitude.toFixed(6));
        setLat(latNum.toFixed(6));
        setLng(lngNum.toFixed(6));
        setIsLocationPinned(true);
        setIsMapExpanded(false);
        try {
          const geo = await reverseGeocodeGalicia(latNum, lngNum);
          if (geo?.fullAddress && !village.trim()) {
            setVillage(geo.fullAddress);
          }
        } finally {
          setIsGettingGps(false);
          setConfirmedStatus(
            `Ubicación GPS actual fijada: ${latNum.toFixed(5)}, ${lngNum.toFixed(5)}`
          );
        }
      },
      () => {
        setIsGettingGps(false);
        setConfirmedStatus(
          "No se pudo obtener el GPS. Comprueba los permisos de ubicación."
        );
      },
      { enableHighAccuracy: true, timeout: 7000 }
    );
  };

  const handlePasteCoordsOrLink = async () => {
    let pasted = "";
    try {
      if (navigator.clipboard?.readText) {
        pasted = await navigator.clipboard.readText();
      }
    } catch {
      // Fallback a prompt si el navegador bloquea lectura directa del portapapeles
    }
    if (!pasted || detectDirectLocationInput(pasted) === "text") {
      pasted =
        prompt(
          "Pega un enlace de Google Maps o coordenadas (ej. 42.1912, -7.8012):"
        ) || "";
    }
    if (!pasted.trim()) return;

    const resolved = await resolveMapLocation(pasted);
    if (resolved) {
      setLat(resolved.lat.toFixed(6));
      setLng(resolved.lng.toFixed(6));
      setIsLocationPinned(true);
      setIsMapExpanded(false);
      if (resolved.resolvedAddress && !village.trim()) {
        setVillage(resolved.resolvedAddress);
      }
      setConfirmedStatus(
        `Coordenadas extraídas (${resolved.source}): ${resolved.lat.toFixed(
          5
        )}, ${resolved.lng.toFixed(5)}`
      );
    } else {
      setConfirmedStatus(
        "No se pudieron extraer coordenadas válidas del enlace o texto."
      );
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
    setIsLocationPinned(true);
    setIsMapExpanded(false);
    setConfirmedStatus(
      `Cliente "${c.name}" cargado con su GPS exacto y equipo.`
    );
  };

  const handleQuickCreateService = async (
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

    try {
      await onSaveOrder(c.id, {
        serviceType: targetType,
        priority: targetType === "Avería" ? "Urgente" : "Normal",
        equipmentInfo: c.equipmentInfo,
        estimatedMinutes: targetMinutes,
        technicalNotes: c.internalNotes || "",
      });
      setShowCustomerDropdown(false);

      const feedbackText = `Parte guardado en la nube: ${targetType} para ${c.name} (${targetMinutes} min)`;
      setQuickOrderFeedback(feedbackText);
      setTimeout(() => {
        setQuickOrderFeedback((prev) => (prev === feedbackText ? null : prev));
      }, 9000);
    } catch {
      // Error ya notificado por el dashboard
    }
  };

  const handleMapClick = async (coords: { lat: number; lng: number }) => {
    const latStr = coords.lat.toFixed(6);
    const lngStr = coords.lng.toFixed(6);
    setLat(latStr);
    setLng(lngStr);
    setIsLocationPinned(true);

    try {
      const geo = await reverseGeocodeGalicia(coords.lat, coords.lng);
      if (geo && geo.fullAddress && !village.trim()) {
        setVillage(geo.fullAddress);
      }
      setConfirmedStatus(
        `Coordenadas fijadas: ${latStr}, ${lngStr}${
          geo?.placeName ? ` (${geo.placeName})` : ""
        }`
      );
    } catch {
      setConfirmedStatus(`Coordenadas fijadas: ${latStr}, ${lngStr}`);
    }
  };

  const resetForm = () => {
    setSelectedCustomerId(null);
    setCustomerSearch("");
    setName("");
    setVillage("");
    setPhone("");
    setEquipmentInfo("");
    setLat(config.warehouseCoordinates.lat.toFixed(6));
    setLng(config.warehouseCoordinates.lng.toFixed(6));
    setInternalNotes("");
    setServiceType("Avería");
    setOrderPriority("Normal");
    setEstimatedMinutes(FIELD_SERVICE_RULES.DEFAULT_INTERVENTION_MINUTES);
    setEstimatedPriceEur("");
    setTechnicalNotes("");
    setAssignedTechId(null);
    setGoogleQuery("");
    setGoogleResults([]);
    setHasSearchedOnce(false);
    setConfirmedStatus(null);
    setEditingOrderId(null);
    setShowCustomerDropdown(false);
    setIsLocationPinned(false);
    setIsMapExpanded(true);
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
    setAssignedTechId(ord.assignedTechId || null);
    setGoogleQuery("");
    setShowGoogleDropdown(false);
    setShowCustomerDropdown(false);
    setIsLocationPinned(true);
    setIsMapExpanded(false);
    setConfirmedStatus(
      `Editando aviso de ${ord.customer.name} (${ord.serviceType} · ${ord.estimatedMinutes} min).`
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !village.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const effectiveCustomerId =
        selectedCustomerId || detectedExistingCustomer?.id || undefined;
      const combinedNotes = technicalNotes.trim() || internalNotes.trim();
      const parsedPrice = Math.max(
        0,
        parseFloat(estimatedPriceEur.replace(",", ".")) || 0
      );

      const savedCustomer = await onSaveCustomer({
        id: effectiveCustomerId,
        name,
        village,
        phone,
        equipmentInfo,
        coordinates: {
          lat: parseFloat(lat) || config.warehouseCoordinates.lat,
          lng: parseFloat(lng) || config.warehouseCoordinates.lng,
        },
        internalNotes: combinedNotes,
        lastServiceType: serviceType,
        lastInterventionMinutes: estimatedMinutes,
      });

      const targetCustId =
        effectiveCustomerId || (savedCustomer as Customer | undefined)?.id;

      if (editingOrderId) {
        await onUpdateOrder(editingOrderId, {
          assignedTechId,
          serviceType,
          priority: orderPriority,
          equipmentInfo,
          estimatedMinutes,
          estimatedPriceEur: parsedPrice,
          technicalNotes: combinedNotes,
        });
        const msg = `Cambios guardados en la nube: ${serviceType} para ${name} (${estimatedMinutes} min)`;
        setQuickOrderFeedback(msg);
        setTimeout(() => {
          setQuickOrderFeedback((prev) => (prev === msg ? null : prev));
        }, 9000);
        resetForm();
      } else if (targetCustId) {
        await onSaveOrder(targetCustId, {
          assignedTechId,
          serviceType,
          priority: orderPriority,
          equipmentInfo,
          estimatedMinutes,
          estimatedPriceEur: parsedPrice,
          technicalNotes: combinedNotes,
        });
        const msg = `Parte guardado en la nube: ${serviceType} para ${name} (${estimatedMinutes} min)`;
        setQuickOrderFeedback(msg);
        setTimeout(() => {
          setQuickOrderFeedback((prev) => (prev === msg ? null : prev));
        }, 9000);
        resetForm();
      }
    } catch {
      // Error ya mostrado en el dashboard
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenInTechPanel = () => {
    window.open("/tecnico", "_blank");
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
      {/* BANNER POST-GUARDADO CON CTAs DIRECTOS AL TÉCNICO Y PLANIFICADOR */}
      {quickOrderFeedback && (
        <div className="p-4 rounded-2xl bg-emerald-500/12 border border-emerald-500/35 text-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-2.5 text-sm font-semibold">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <span>{quickOrderFeedback}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleOpenInTechPanel}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Abrir en Panel Técnico</span>
            </button>
            {onNavigateToPlanner && (
              <button
                type="button"
                onClick={onNavigateToPlanner}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white border border-white/[0.1] font-semibold text-xs transition"
              >
                <RouteIcon className="w-3.5 h-3.5 text-amber-400" />
                <span>Planificar Ruta</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setQuickOrderFeedback(null)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              aria-label="Cerrar aviso"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* COLUMNA IZQUIERDA: FORMULARIO EN 3 PASOS LIMPIOS */}
        <div
          ref={formContainerRef}
          className={`lg:col-span-7 bg-slate-900/65 backdrop-blur-md border p-5 sm:p-6 rounded-2xl shadow-xl space-y-5 transition-colors ${
            editingOrderId
              ? "border-amber-500/60"
              : "border-white/[0.08]"
          }`}
        >
          {/* CABECERA + BOTÓN CARTERA */}
          {editingOrderId ? (
            <div className="flex items-center justify-between bg-amber-500/12 border border-amber-500/35 p-3.5 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center">
                  <Pencil className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-amber-300">
                    Editando aviso de {name || "Cliente"}
                  </h2>
                  <p className="text-xs text-slate-300">
                    Modifica los datos y pulsa Guardar Cambios.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={resetForm}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 border border-white/[0.08]"
              >
                <X className="w-3.5 h-3.5" />
                <span>Cancelar</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-4">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-amber-400" />
                  <span>Nuevo Parte de Asistencia</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Registra una avería, revisión o instalación en 3 pasos rápidos.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {customers.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowHabitualDrawer((prev) => !prev)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 border ${
                      showHabitualDrawer
                        ? "bg-amber-500 text-slate-950 border-amber-400"
                        : "bg-slate-800/80 hover:bg-slate-700 text-slate-200 border-white/[0.08]"
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>Cartera ({customers.length})</span>
                    {showHabitualDrawer ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
                {selectedCustomerId && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="text-xs font-medium text-slate-400 hover:text-white px-2 py-1"
                  >
                    Limpiar
                  </button>
                )}
              </div>
            </div>
          )}

          {/* CAJÓN DESPLEGABLE DE CARTERA (SI SE ABRE) */}
          {showHabitualDrawer && (
            <div className="p-4 rounded-2xl bg-slate-950/65 border border-white/[0.08] space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                <div className="sm:col-span-5 relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Buscar cliente, aldea o equipo..."
                    value={habitualSearch}
                    onChange={(e) => setHabitualSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs bg-slate-900 border border-white/[0.08] rounded-xl text-white outline-none focus:border-amber-500"
                  />
                </div>
                <div className="sm:col-span-4 flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <select
                    value={habitualConcelloFilter}
                    onChange={(e) => setHabitualConcelloFilter(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs bg-slate-900 border border-white/[0.08] rounded-xl text-white outline-none focus:border-amber-500"
                  >
                    <option value="ALL">Todas las zonas</option>
                    {availableConcellos.map((concello) => (
                      <option key={concello} value={concello}>
                        {concello}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-3 flex items-center gap-1.5">
                  <ArrowUpDown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
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
                    className="w-full px-2 py-2 text-xs bg-slate-900 border border-white/[0.08] rounded-xl text-white outline-none focus:border-amber-500"
                  >
                    <option value="frequent">Frecuentes</option>
                    <option value="inactive">Sin revisión</option>
                    <option value="recent">Recientes</option>
                    <option value="alpha">A-Z</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-72 overflow-y-auto pr-1">
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
                      className="p-3 rounded-xl bg-slate-900/80 border border-white/[0.07] space-y-2 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-bold text-white truncate">
                            {c.name}
                          </div>
                          <div className="text-slate-400 truncate">
                            {c.village}
                          </div>
                        </div>
                        <span className="text-[11px] text-slate-400 shrink-0">
                          {activeQueue
                            ? `En cola (${activeQueue.totalMinutes}m)`
                            : daysInfo.label}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-1">
                        <div className="flex gap-1">
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
                              className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                                cardType === tp
                                  ? "bg-amber-500 text-slate-950"
                                  : "bg-slate-800 text-slate-400"
                              }`}
                            >
                              {tp.slice(0, 4)}.
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-1">
                          {[30, 45, 60].map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() =>
                                setHabitualCardMinutes((prev) => ({
                                  ...prev,
                                  [c.id]: m,
                                }))
                              }
                              className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${
                                cardMins === m
                                  ? "bg-sky-600 text-white"
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
                          className="flex-1 py-1.5 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1"
                        >
                          <Zap className="w-3.5 h-3.5" />
                          <span>Crear ({cardMins}m)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            selectExistingCustomer(c);
                            setShowHabitualDrawer(false);
                          }}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                          title="Cargar ficha"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {confirmDeleteCustomerId === c.id ? (
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteCustomer(c.id);
                              setConfirmDeleteCustomerId(null);
                            }}
                            className="px-2 py-1 rounded-lg bg-rose-600 text-white font-bold text-[11px]"
                          >
                            Borrar
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteCustomerId(c.id)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-rose-400"
                            title="Eliminar cliente"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* PASO 1: QUÉ Y QUIÉN */}
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
                  1. Qué ocurre y quién llama
                </span>

                <div className="flex items-center gap-1 bg-slate-950/70 p-1 rounded-xl border border-white/[0.06]">
                  <button
                    type="button"
                    onClick={() => setOrderPriority("Normal")}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                      orderPriority === "Normal"
                        ? "bg-slate-800 text-white"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Normal
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderPriority("Urgente")}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 ${
                      orderPriority === "Urgente"
                        ? "bg-rose-600 text-white shadow"
                        : "text-rose-400/80 hover:text-rose-300"
                    }`}
                  >
                    <Flame className="w-3.5 h-3.5" />
                    <span>Urgente</span>
                  </button>
                </div>
              </div>

              {/* Selector Tipo Servicio */}
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    {
                      type: "Avería",
                      icon: Wrench,
                      activeCls: "bg-amber-500 text-slate-950 font-bold",
                    },
                    {
                      type: "Revisión",
                      icon: ClipboardCheck,
                      activeCls: "bg-sky-500 text-slate-950 font-bold",
                    },
                    {
                      type: "Instalación",
                      icon: Cog,
                      activeCls: "bg-emerald-500 text-slate-950 font-bold",
                    },
                  ] as const
                ).map(({ type, icon: Icon, activeCls }) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setServiceType(type)}
                    className={`h-10 px-3 rounded-xl text-xs sm:text-sm border transition flex items-center justify-center gap-2 ${
                      serviceType === type
                        ? `${activeCls} border-transparent shadow-md`
                        : "bg-slate-950/55 border-white/[0.07] text-slate-300 hover:bg-slate-800 font-medium"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{type}</span>
                  </button>
                ))}
              </div>

              {/* Buscador / Nombre de Cliente */}
              <div className="relative space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-300">
                    Cliente o Instalación *
                  </label>
                  {customers.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowCustomerDropdown((prev) => !prev)}
                      className="text-xs font-medium text-amber-400 hover:text-amber-300"
                    >
                      {showCustomerDropdown
                        ? "Ocultar recientes"
                        : `Recientes (${customers.length})`}
                    </button>
                  )}
                </div>

                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                  <input
                    type="text"
                    required
                    placeholder="Nombre del cliente, empresa o busca uno guardado..."
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
                    className="w-full h-11 pl-10 pr-9 text-sm bg-slate-950/60 border border-white/[0.08] rounded-xl text-white outline-none focus:border-amber-500 transition"
                  />
                  {name && (
                    <button
                      type="button"
                      onClick={() => {
                        setName("");
                        setCustomerSearch("");
                        setSelectedCustomerId(null);
                      }}
                      className="absolute right-3 top-3 text-slate-400 hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {detectedExistingCustomer && !selectedCustomerId && (
                  <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-between gap-2 text-xs">
                    <span className="text-amber-200 truncate">
                      Coincide con{" "}
                      <strong className="text-white">
                        {detectedExistingCustomer.name}
                      </strong>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        selectExistingCustomer(detectedExistingCustomer)
                      }
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 font-semibold shrink-0"
                    >
                      Cargar GPS y Equipo
                    </button>
                  </div>
                )}

                {showCustomerDropdown &&
                  matchingCustomers.length > 0 &&
                  !editingOrderId && (
                    <div className="absolute left-0 right-0 top-full mt-1.5 bg-slate-900/95 backdrop-blur-md border border-white/[0.12] rounded-2xl shadow-2xl z-30 max-h-72 overflow-y-auto p-2 space-y-1.5">
                      <div className="flex items-center justify-between px-2 py-1 border-b border-white/[0.06] text-xs text-slate-400">
                        <span>Clientes guardados ({matchingCustomers.length})</span>
                        <button
                          type="button"
                          onClick={() => setShowCustomerDropdown(false)}
                          className="hover:text-white"
                        >
                          Cerrar
                        </button>
                      </div>
                      {matchingCustomers.map((c) => (
                        <div
                          key={c.id}
                          className="p-2.5 rounded-xl bg-slate-950/60 hover:bg-slate-800/80 border border-white/[0.05] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-white text-sm">
                              {c.name}
                            </div>
                            <div className="text-xs text-slate-400 truncate">
                              {c.village}
                              {c.equipmentInfo ? ` · ${c.equipmentInfo}` : ""}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                handleQuickCreateService(c, "Avería", 45)
                              }
                              className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs"
                            >
                              + Avería
                            </button>
                            <button
                              type="button"
                              onClick={() => selectExistingCustomer(c)}
                              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs"
                            >
                              Cargar
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Teléfono de contacto
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. 654 321 987"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full h-11 px-3.5 text-sm bg-slate-950/60 border border-white/[0.08] rounded-xl text-white outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Equipo / Instalación
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. Caldera Domusa 25kW, Aerotermia..."
                    value={equipmentInfo}
                    onChange={(e) => setEquipmentInfo(e.target.value)}
                    className="w-full h-11 px-3.5 text-sm bg-slate-950/60 border border-white/[0.08] rounded-xl text-amber-200 font-medium outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Técnico asignado (opcional)
                </label>
                <select
                  value={assignedTechId || ""}
                  onChange={(e) => setAssignedTechId(e.target.value || null)}
                  className="w-full h-11 px-3.5 text-sm bg-slate-950/60 border border-white/[0.08] rounded-xl text-slate-200 outline-none focus:border-amber-500"
                >
                  <option value="">
                    Cualquier técnico disponible (compartido)
                  </option>
                  {technicians.map((tech) => (
                    <option key={tech.id} value={tech.id}>
                      {tech.fullName || tech.email}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* PASO 2: UBICACIÓN INTELIGENTE + MAPA COLAPSABLE */}
            <div className="space-y-3.5 pt-4 border-t border-white/[0.06]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
                  2. Ubicación en Google Maps
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleUseMyGps}
                    disabled={isGettingGps}
                    className="px-2.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-sky-300 border border-white/[0.08] text-xs font-semibold flex items-center gap-1.5 transition"
                  >
                    {isGettingGps ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <LocateFixed className="w-3.5 h-3.5" />
                    )}
                    <span>Mi GPS</span>
                  </button>
                  <button
                    type="button"
                    onClick={handlePasteCoordsOrLink}
                    className="px-2.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-white/[0.08] text-xs font-semibold flex items-center gap-1.5 transition"
                  >
                    <ClipboardPaste className="w-3.5 h-3.5 text-amber-400" />
                    <span>Pegar Link/Coords</span>
                  </button>
                </div>
              </div>

              {/* Buscador Google Maps */}
              <div className="relative">
                <Search className="w-4 h-4 text-amber-400 absolute left-3.5 top-3.5" />
                <input
                  type="text"
                  placeholder="Busca calle + número, aldea, negocio o pega un enlace de Google Maps..."
                  value={googleQuery}
                  onChange={(e) => setGoogleQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleDirectLocationResolution(googleQuery);
                    }
                  }}
                  onFocus={() => {
                    if (googleResults.length > 0 || hasSearchedOnce) {
                      setShowGoogleDropdown(true);
                    }
                  }}
                  className="w-full h-11 pl-10 pr-20 text-sm bg-slate-950/70 border border-amber-500/30 rounded-xl text-white outline-none focus:border-amber-500 transition"
                />
                <div className="absolute right-3 top-3 flex items-center gap-1.5">
                  {isSearchingGoogle && (
                    <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                  )}
                  {googleQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setGoogleQuery("");
                        setGoogleResults([]);
                        setHasSearchedOnce(false);
                        setShowGoogleDropdown(false);
                      }}
                      className="text-slate-400 hover:text-white p-0.5"
                      aria-label="Limpiar búsqueda"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Dropdown de resultados o estado vacío amigable */}
                {showGoogleDropdown &&
                  (googleResults.length > 0 ||
                    (!isSearchingGoogle &&
                      hasSearchedOnce &&
                      googleQuery.trim().length >= 2)) && (
                    <div className="absolute left-0 right-0 top-full mt-1.5 bg-slate-900/95 backdrop-blur-md border border-white/[0.12] rounded-2xl shadow-2xl z-30 max-h-72 overflow-y-auto p-1.5 space-y-1">
                      <div className="flex items-center justify-between px-2.5 py-1 text-xs text-slate-400 border-b border-white/[0.06]">
                        <span>
                          {googleResults.length > 0
                            ? "Selecciona ubicación"
                            : "Sin coincidencias"}
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowGoogleDropdown(false)}
                          className="hover:text-white"
                        >
                          Cerrar
                        </button>
                      </div>

                      {googleResults.length === 0 ? (
                        <div className="p-3 text-xs text-slate-400 leading-relaxed">
                          Sin resultados para{" "}
                          <strong className="text-white">«{googleQuery}»</strong>.
                          Prueba con{" "}
                          <span className="text-amber-300">
                            calle + localidad
                          </span>
                          , pega un enlace de Google Maps o pincha directamente en el mapa.
                        </div>
                      ) : (
                        googleResults.map((place) => {
                          const TypeIcon =
                            place.categoryType === "business"
                              ? Building2
                              : place.categoryType === "hamlet"
                              ? Home
                              : MapPin;
                          const iconColor =
                            place.categoryType === "business"
                              ? "text-amber-400"
                              : place.categoryType === "hamlet"
                              ? "text-emerald-400"
                              : "text-sky-400";

                          return (
                            <button
                              key={place.id}
                              type="button"
                              onClick={() => handleSelectGooglePlace(place)}
                              className="w-full text-left p-2.5 rounded-xl hover:bg-slate-800/80 text-xs flex items-center justify-between gap-2 transition"
                            >
                              <div className="flex items-start gap-2.5 min-w-0">
                                <TypeIcon
                                  className={`w-4 h-4 shrink-0 mt-0.5 ${iconColor}`}
                                />
                                <div className="min-w-0">
                                  <div className="font-bold text-white text-sm truncate">
                                    {place.title}
                                  </div>
                                  <div className="text-xs text-slate-400 truncate">
                                    {place.subtitle}
                                  </div>
                                </div>
                              </div>
                              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 shrink-0">
                                {place.source}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Dirección / Aldea / Concello *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Lugar de Vilar 12, Allariz"
                  value={village}
                  onChange={(e) => setVillage(e.target.value)}
                  className="w-full h-11 px-3.5 text-sm bg-slate-950/60 border border-white/[0.08] rounded-xl text-white outline-none focus:border-amber-500"
                />
              </div>

              {/* Píldora de ubicación fijada + Mapa Satélite Colapsable */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-950/55 border border-white/[0.07]">
                <div className="flex items-center gap-2 text-xs min-w-0">
                  <Satellite
                    className={`w-4 h-4 shrink-0 ${
                      isLocationPinned ? "text-emerald-400" : "text-amber-400"
                    }`}
                  />
                  <span className="text-slate-200 truncate">
                    {confirmedStatus ||
                      (isLocationPinned
                        ? `GPS fijado: ${lat}, ${lng}`
                        : "Haz clic en el mapa satélite para afinar la entrada")}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMapExpanded((p) => !p)}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-semibold shrink-0 transition"
                >
                  {isMapExpanded ? "Ocultar mapa" : "Ajustar en mapa satélite"}
                </button>
              </div>

              {isMapExpanded && (
                <PrecisionMapPicker
                  coordinates={{
                    lat: parseFloat(lat) || config.warehouseCoordinates.lat,
                    lng: parseFloat(lng) || config.warehouseCoordinates.lng,
                  }}
                  onChange={handleMapClick}
                  height="260px"
                  zoom={19}
                />
              )}
            </div>

            {/* PASO 3: DURACIÓN, PRESUPUESTO Y NOTAS */}
            <div className="space-y-4 pt-4 border-t border-white/[0.06]">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-400 block">
                3. Duración, Presupuesto y Notas
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-300">
                      Duración estimada
                    </span>
                    <span className="font-mono font-bold text-amber-400 tabular-nums">
                      {formatHoursMinutes(estimatedMinutes)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setEstimatedMinutes((m) => Math.max(15, m - 15))
                      }
                      className="h-10 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold"
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
                      className="w-full h-10 text-center text-base font-bold rounded-xl bg-slate-950/60 border border-white/[0.08] text-amber-400 outline-none tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setEstimatedMinutes((m) => Math.min(480, m + 15))
                      }
                      className="h-10 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold"
                    >
                      +15m
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[30, 45, 60, 90, 120].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setEstimatedMinutes(m)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                          estimatedMinutes === m
                            ? "bg-amber-500 text-slate-950 font-bold"
                            : "bg-slate-800/70 text-slate-400 hover:text-white"
                        }`}
                      >
                        {m}m
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">
                    Presupuesto / Cobro est. (€)
                  </label>
                  <input
                    type="number"
                    step="5"
                    min={0}
                    placeholder="Ej. 85.00 (0 = garantía)"
                    value={estimatedPriceEur}
                    onChange={(e) => setEstimatedPriceEur(e.target.value)}
                    className="w-full h-10 px-3.5 text-base bg-slate-950/60 border border-white/[0.08] rounded-xl text-emerald-400 font-mono font-bold outline-none focus:border-emerald-500 tabular-nums"
                  />
                  <span className="text-xs text-slate-400 block">
                    Opcional. El técnico podrá ajustarlo al cerrar el parte.
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-300">
                  Síntoma / Material necesario / Notas de acceso
                </label>
                <input
                  type="text"
                  placeholder="Ej. Falla encendido, llevar electrodo, llaves en portería..."
                  value={technicalNotes}
                  onChange={(e) => setTechnicalNotes(e.target.value)}
                  className="w-full h-11 px-3.5 text-sm bg-slate-950/60 border border-white/[0.08] rounded-xl text-white outline-none focus:border-amber-500"
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    "Llevar repuestos/maletín",
                    "Recoger llaves",
                    "Perro en finca",
                    "Llamar antes de ir",
                    estimatedPriceEur && parseFloat(estimatedPriceEur) > 0
                      ? `Cobrar ${estimatedPriceEur}€ al finalizar`
                      : "Cobrar al finalizar",
                  ].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => handleAppendNoteChip(chip)}
                      className="px-2.5 py-1 rounded-lg bg-slate-800/70 hover:bg-slate-700 border border-white/[0.06] text-xs font-medium text-slate-300 hover:text-amber-300 transition"
                    >
                      + {chip}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* BOTÓN SUBMIT */}
            {editingOrderId ? (
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={resetForm}
                  className="w-1/3 h-12 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-sm transition border border-white/[0.08] flex items-center justify-center gap-1.5"
                >
                  <X className="w-4 h-4" />
                  <span>Cancelar</span>
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-2/3 h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-bold text-sm transition shadow-lg shadow-emerald-600/25 flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  <span>
                    {isSubmitting
                      ? "Guardando..."
                      : `Guardar Cambios (${serviceType} · ${estimatedMinutes} min)`}
                  </span>
                </button>
              </div>
            ) : (
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-12 rounded-2xl bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 font-bold text-sm transition shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2"
              >
                <Plus className="w-5 h-5" />
                <span>
                  {isSubmitting
                    ? "Guardando en nube..."
                    : `Registrar Parte (${serviceType} · ${estimatedMinutes} min)`}
                </span>
              </button>
            )}
          </form>
        </div>

        {/* COLUMNA DERECHA: COLA DE AVISOS */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-slate-900/65 backdrop-blur-md border border-white/[0.08] p-5 sm:p-6 rounded-2xl shadow-xl space-y-4">
            <div className="space-y-3 border-b border-white/[0.06] pb-3.5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-wider text-white">
                  Cola de Avisos ({filteredQueueOrders.length})
                </h3>
                <span className="text-xs text-amber-400 font-semibold tabular-nums">
                  Activos: {formatHoursMinutes(totalPendingMinutes)}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1 bg-slate-950/70 p-1 rounded-xl border border-white/[0.06] text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setQueueStatusFilter("ACTIVOS")}
                  className={`py-1.5 px-2 rounded-lg transition ${
                    queueStatusFilter === "ACTIVOS"
                      ? "bg-amber-500 text-slate-950 font-bold"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Activos ({pendingOrders.length})
                </button>
                <button
                  type="button"
                  onClick={() => setQueueStatusFilter("Completado")}
                  className={`py-1.5 px-2 rounded-lg transition ${
                    queueStatusFilter === "Completado"
                      ? "bg-emerald-600 text-white font-bold"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Cerrados ({completedOrders.length})
                </button>
                <button
                  type="button"
                  onClick={() => setQueueStatusFilter("ALL")}
                  className={`py-1.5 px-2 rounded-lg transition ${
                    queueStatusFilter === "ALL"
                      ? "bg-slate-800 text-white font-bold"
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
                    className="w-full pl-8 pr-7 py-2 text-xs bg-slate-950/60 border border-white/[0.08] rounded-xl text-white outline-none focus:border-amber-500"
                  />
                  {queueSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setQueueSearchQuery("")}
                      className="absolute right-2.5 top-2 text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setOnlyUrgentFilter((p) => !p)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold border transition flex items-center gap-1 shrink-0 ${
                    onlyUrgentFilter
                      ? "bg-rose-600/20 border-rose-500/60 text-rose-300"
                      : "bg-slate-950/60 border-white/[0.08] text-slate-400 hover:text-white"
                  }`}
                >
                  <Flame className="w-3.5 h-3.5" />
                  <span>Urgentes</span>
                </button>
              </div>

              <div className="space-y-1.5 bg-slate-950/55 p-3 rounded-xl border border-white/[0.06]">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-medium flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                    <span>
                      Jornada ({formatHoursMinutes(maxWorkdayMinutes)} máx.)
                    </span>
                  </span>
                  <span
                    className={`font-bold tabular-nums ${
                      totalPendingMinutes > maxWorkdayMinutes
                        ? "text-rose-400"
                        : "text-amber-400"
                    }`}
                  >
                    {totalPendingMinutes} / {maxWorkdayMinutes} min (
                    {workdayOccupancyPercent}%)
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      totalPendingMinutes > maxWorkdayMinutes
                        ? "bg-rose-500"
                        : "bg-gradient-to-r from-amber-500 to-amber-400"
                    }`}
                    style={{
                      width: `${Math.min(100, workdayOccupancyPercent)}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {filteredQueueOrders.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs border border-dashed border-white/[0.08] rounded-2xl space-y-1">
                <p className="font-semibold text-slate-300">
                  No hay avisos en esta vista
                </p>
                <p>
                  Registra un parte en el formulario o cambia el filtro superior.
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[640px] overflow-y-auto pr-1">
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
                          ? "bg-amber-500/10 border-amber-400"
                          : isUrgent && !isCompleted
                          ? "bg-rose-950/20 border-rose-500/40"
                          : isInRoute
                          ? "bg-sky-950/20 border-sky-500/40"
                          : isCompleted
                          ? "bg-slate-950/40 border-white/[0.05] opacity-70"
                          : "bg-slate-950/55 border-white/[0.07] hover:border-white/[0.15]"
                      }`}
                    >
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="w-5 h-5 rounded-md bg-slate-800 font-bold flex items-center justify-center text-[11px] text-slate-300 shrink-0">
                            {i + 1}
                          </span>
                          <span className="font-bold text-white text-sm truncate">
                            {ord.customer.name}
                          </span>
                          <span
                            className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${meta.badgeClass}`}
                          >
                            {meta.label}
                          </span>
                          {isInRoute && (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300">
                              En Ruta
                            </span>
                          )}
                          {isCompleted && (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                              Cerrado
                            </span>
                          )}
                          {ord.assignedTechName && (
                            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-800 text-amber-300 border border-white/[0.07]">
                              {ord.assignedTechName}
                            </span>
                          )}
                        </div>

                        <div className="text-slate-400 text-xs flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span className="truncate">
                            {ord.customer.village}
                          </span>
                        </div>

                        {(ord.equipmentInfo || ord.customer.equipmentInfo) && (
                          <div className="text-xs font-medium text-amber-300">
                            {ord.equipmentInfo || ord.customer.equipmentInfo}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2 pt-0.5">
                          <span className="text-amber-400 font-bold text-xs font-mono tabular-nums">
                            {ord.actualMinutes ?? ord.estimatedMinutes} min
                          </span>

                          {!isCompleted && (
                            <div className="flex items-center gap-1 bg-slate-900 rounded-lg p-0.5 border border-white/[0.06]">
                              <button
                                type="button"
                                onClick={() =>
                                  handleQuickDurationDelta(ord.id, -15)
                                }
                                className="px-1.5 py-0.5 text-[11px] font-semibold rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                              >
                                -15m
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleQuickDurationDelta(ord.id, +15)
                                }
                                className="px-1.5 py-0.5 text-[11px] font-semibold rounded bg-slate-800 hover:bg-slate-700 text-amber-300"
                              >
                                +15m
                              </button>
                            </div>
                          )}

                          {ord.collectedPriceEur !== undefined &&
                          ord.collectedPriceEur > 0 ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono text-[11px] font-bold tabular-nums">
                              Cobrado: {ord.collectedPriceEur.toFixed(2)} €
                            </span>
                          ) : cashToCollectEur > 0 ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-mono text-[11px] font-semibold tabular-nums">
                              Presup: {cashToCollectEur.toFixed(2)} €
                            </span>
                          ) : null}
                        </div>

                        {ord.technicalNotes && (
                          <div className="text-xs text-slate-400 italic">
                            “{ord.technicalNotes}”
                          </div>
                        )}
                        {ord.resolutionNote && (
                          <div className="text-xs text-emerald-300 font-medium">
                            Cierre: {ord.resolutionNote}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleStartEdit(ord)}
                          className={`p-2 rounded-xl transition ${
                            isEditing
                              ? "bg-amber-500 text-slate-950"
                              : "text-slate-400 hover:text-amber-400 hover:bg-slate-800"
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
                            className="p-2 rounded-xl text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition"
                            title="Reabrir aviso"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateOrderStatus(ord.id, "Completado")
                            }
                            className="p-2 rounded-xl text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition"
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
                          className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition"
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
