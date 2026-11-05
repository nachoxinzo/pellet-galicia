"use client";

import React, { useState, useMemo, useEffect } from "react";
import dynamic from "next/dynamic";
import { Customer, PendingOrder } from "@/types/pelletGalicia";
import {
  Package,
  Plus,
  Search,
  MapPin,
  Trash2,
  CheckCircle2,
  Satellite,
  Crosshair,
  Loader2,
  Check,
  ClipboardPaste,
  Building2,
  AlertTriangle,
  Pencil,
  Save,
  X,
  Truck,
  Zap,
  Users,
  Clock,
  Hash,
  ChevronDown,
  ChevronUp,
  Phone,
  Filter,
  ArrowUpDown,
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
} from "@/services/galiciaStorage";

function formatDaysSinceOrder(isoDate?: string): {
  label: string;
  days: number;
} {
  if (!isoDate) return { label: "Sin pedidos previos", days: 9999 };
  const parsed = new Date(isoDate).getTime();
  if (Number.isNaN(parsed)) return { label: "Sin fecha", days: 9999 };
  const diffMs = Date.now() - parsed;
  const days = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  if (days === 0) return { label: "Pidió hoy", days: 0 };
  if (days === 1) return { label: "Hace 1 día", days: 1 };
  return { label: `Hace ${days} días`, days };
}

function extractConcelloTag(village: string): string {
  if (!village) return "Otros";
  const parts = village
    .split(/[,—\-()]/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length > 2 &&
        !/^\d+$/.test(s) &&
        !["ourense", "lugo", "pontevedra", "a coruña", "coruña", "galicia", "españa"].includes(
          s.toLowerCase()
        )
    );
  return parts[parts.length - 1] || parts[0] || "General";
}

// Mapa interactivo con Google Maps Satélite Híbrido (lyrs=y con maxZoom=21 y flyTo)
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
  orders: PendingOrder[];
  vanCapacitySacks: number;
  onSaveCustomer: (
    customer: Omit<Customer, "id" | "createdAt" | "updatedAt"> & { id?: string }
  ) => Customer | void;
  onDeleteCustomer: (id: string) => void;
  onSaveOrder: (customerId: string, sacks: number, notes?: string) => void;
  onUpdateOrder: (
    orderId: string,
    updates: {
      sacks?: number;
      orderNotes?: string;
      status?: PendingOrder["status"];
    }
  ) => void;
  onUpdateOrderSacks: (
    orderId: string,
    deltaOrExact: number,
    isDelta?: boolean
  ) => void;
  onDeleteOrder: (id: string) => void;
  onUpdateOrderStatus: (id: string, status: PendingOrder["status"]) => void;
}

export default function CustomerOrdersTab({
  customers,
  orders,
  vanCapacitySacks,
  onSaveCustomer,
  onDeleteCustomer,
  onSaveOrder,
  onUpdateOrder,
  onUpdateOrderSacks,
  onDeleteOrder,
  onUpdateOrderStatus,
}: CustomerOrdersTabProps) {
  // Estado de edición de pedido existente
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const formContainerRef = React.useRef<HTMLDivElement>(null);

  // Super-Buscador de clientes habituales con Re-pedido en 1 Clic
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null
  );
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [customQtyCustomerId, setCustomQtyCustomerId] = useState<string | null>(
    null
  );
  const [customQtyValue, setCustomQtyValue] = useState<number>(30);
  const [quickOrderFeedback, setQuickOrderFeedback] = useState<string | null>(
    null
  );

  // Cajón / Vista de Cartera de Clientes Habituales (Re-pedido Masivo)
  const [showHabitualDrawer, setShowHabitualDrawer] = useState(false);
  const [habitualSearch, setHabitualSearch] = useState("");
  const [habitualConcelloFilter, setHabitualConcelloFilter] =
    useState<string>("ALL");
  const [habitualSort, setHabitualSort] = useState<
    "frequent" | "recent" | "inactive" | "alpha"
  >("frequent");
  const [habitualCardSacks, setHabitualCardSacks] = useState<
    Record<string, number>
  >({});

  // Campos de cliente
  const [name, setName] = useState("");
  const [village, setVillage] = useState("");
  const [phone, setPhone] = useState("");
  const [lat, setLat] = useState("42.2982");
  const [lng, setLng] = useState("-7.8185");
  const [internalNotes, setInternalNotes] = useState("");

  // Pedido
  const [sacks, setSacks] = useState<number>(30);
  const [orderNotes, setOrderNotes] = useState("");

  // BUSCADOR DIRECTO DE GOOGLE MAPS CON AUTOCOMPLETADO EN TIEMPO REAL
  const [googleQuery, setGoogleQuery] = useState("");
  const [googleResults, setGoogleResults] = useState<GoogleSearchResultItem[]>(
    []
  );
  const [isSearchingGoogle, setIsSearchingGoogle] = useState(false);
  const [showGoogleDropdown, setShowGoogleDropdown] = useState(false);

  // Indicador de confirmación de coordenadas
  const [confirmedStatus, setConfirmedStatus] = useState<string | null>(null);

  // Sugerencias enriquecidas del Super-Buscador (filtra por nombre, teléfono o aldea, o muestra recientes si está vacío)
  const matchingCustomers = useMemo(() => {
    const q = normalizeGaliciaText(customerSearch);
    const qDigits = normalizePhoneDigits(customerSearch);

    const sortedRecent = [...customers].sort((a, b) => {
      const dateA = new Date(a.fechaUltimoPedido || a.updatedAt).getTime();
      const dateB = new Date(b.fechaUltimoPedido || b.updatedAt).getTime();
      return dateB - dateA;
    });

    if (!q) {
      return sortedRecent.slice(0, 8);
    }

    return sortedRecent.filter((c) => {
      const nameMatch = normalizeGaliciaText(c.name).includes(q);
      const villageMatch = normalizeGaliciaText(c.village).includes(q);
      const phoneMatch =
        qDigits.length >= 3 && normalizePhoneDigits(c.phone).includes(qDigits);
      return nameMatch || villageMatch || phoneMatch;
    });
  }, [customers, customerSearch]);

  // Detección inteligente de cliente duplicado al escribir nombre o teléfono
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

  // Mapa de pedidos pendientes activos hoy por cliente (para mostrar etiqueta "🕒 Ya en cola")
  const pendingOrderByCustomerId = useMemo(() => {
    const map: Record<string, { count: number; totalSacks: number }> = {};
    orders
      .filter((o) => o.status === "Pendiente")
      .forEach((o) => {
        if (!map[o.customerId]) {
          map[o.customerId] = { count: 0, totalSacks: 0 };
        }
        map[o.customerId].count += 1;
        map[o.customerId].totalSacks += o.sacks;
      });
    return map;
  }, [orders]);

  // Lista de concellos/zonas únicos para filtrar la Cartera de Clientes Habituales
  const availableConcellos = useMemo(() => {
    const set = new Set<string>();
    customers.forEach((c) => {
      if (c.village) set.add(extractConcelloTag(c.village));
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [customers]);

  // Clientes filtrados y ordenados para la Cartera de Clientes Habituales
  const filteredHabitualCustomers = useMemo(() => {
    const q = normalizeGaliciaText(habitualSearch);
    const qDigits = normalizePhoneDigits(habitualSearch);

    const filtered = customers.filter((c) => {
      if (
        habitualConcelloFilter !== "ALL" &&
        extractConcelloTag(c.village) !== habitualConcelloFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        normalizeGaliciaText(c.name).includes(q) ||
        normalizeGaliciaText(c.village).includes(q) ||
        normalizeGaliciaText(c.internalNotes).includes(q) ||
        (qDigits.length >= 3 && normalizePhoneDigits(c.phone).includes(qDigits))
      );
    });

    return filtered.sort((a, b) => {
      if (habitualSort === "frequent") {
        const diffSacks =
          (b.totalSacosHistorico || b.ultimosSacos || 0) -
          (a.totalSacosHistorico || a.ultimosSacos || 0);
        if (diffSacks !== 0) return diffSacks;
        return (b.totalPedidosHistorico || 0) - (a.totalPedidosHistorico || 0);
      }
      if (habitualSort === "recent") {
        return (
          new Date(b.fechaUltimoPedido || b.updatedAt).getTime() -
          new Date(a.fechaUltimoPedido || a.updatedAt).getTime()
        );
      }
      if (habitualSort === "inactive") {
        return (
          new Date(a.fechaUltimoPedido || a.updatedAt).getTime() -
          new Date(b.fechaUltimoPedido || b.updatedAt).getTime()
        );
      }
      return a.name.localeCompare(b.name, "es");
    });
  }, [customers, habitualSearch, habitualConcelloFilter, habitualSort]);

  // Acción 1 y 2: Re-pedido directo en 1 clic sin pasar por el formulario
  const handleQuickRepeatOrder = (c: Customer, customSacks?: number) => {
    const finalSacks = Math.max(1, customSacks ?? c.ultimosSacos ?? 30);
    onSaveOrder(c.id, finalSacks, c.internalNotes || "");
    setShowCustomerDropdown(false);
    setCustomQtyCustomerId(null);
    setCustomerSearch("");
    const msg = `✅ Pedido de ${c.name} (${finalSacks} sacos · ${
      finalSacks * 15
    } kg) añadido a la cola`;
    setQuickOrderFeedback(msg);
    setTimeout(() => {
      setQuickOrderFeedback((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  // Acción 3: Cargar en formulario y volar en el mapa satélite
  const selectExistingCustomer = (c: Customer) => {
    setSelectedCustomerId(c.id);
    setCustomerSearch(c.name);
    setName(c.name);
    setVillage(c.village);
    setPhone(c.phone || "");
    setLat(c.coordinates.lat.toFixed(6));
    setLng(c.coordinates.lng.toFixed(6));
    setInternalNotes(c.internalNotes || "");
    setSacks(c.ultimosSacos || 30);
    setOrderNotes(c.internalNotes || "");
    setShowCustomerDropdown(false);
    setCustomQtyCustomerId(null);
    setConfirmedStatus(
      `✅ Ficha de ${c.name} cargada (${c.coordinates.lat.toFixed(
        6
      )}, ${c.coordinates.lng.toFixed(6)}). Último pedido: ${
        c.ultimosSacos || 30
      } sacos.`
    );
    setTimeout(() => {
      formContainerRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 60);
  };

  // 1. AUTO-DETECCIÓN INTELIGENTE SI SE PEGAN COORDENADAS O ENLACE DIRECTAMENTE
  const processDirectCoordinatesOrLink = async (text: string): Promise<boolean> => {
    const trimmed = text.trim();
    if (!trimmed) return false;

    const isCoordOrLink =
      trimmed.includes("http") ||
      trimmed.includes("maps.app.goo.gl") ||
      trimmed.includes("goo.gl") ||
      /(-?\d{1,2}\.\d+)[,\s]+(-?\d{1,3}\.\d+)/.test(trimmed) ||
      trimmed.includes("!3d") ||
      /[°º]/.test(trimmed);

    if (isCoordOrLink) {
      setIsSearchingGoogle(true);
      try {
        const res = await resolveMapLocation(trimmed);
        if (res) {
          setLat(res.lat.toFixed(6));
          setLng(res.lng.toFixed(6));
          if (res.resolvedAddress) {
            setVillage(res.resolvedAddress);
          }
          setConfirmedStatus(
            `✅ Coordenadas fijadas con éxito: ${res.lat.toFixed(6)}, ${res.lng.toFixed(6)} (${res.source})`
          );
          setGoogleQuery("");
          setShowGoogleDropdown(false);
          setIsSearchingGoogle(false);
          return true;
        }
      } catch (err) {
        console.warn("Error resolviendo coordenadas directas:", err);
      } finally {
        setIsSearchingGoogle(false);
      }
    }
    return false;
  };

  // Botón rápido de pegar enlace o coordenadas
  const handlePasteCoordsOrLink = async () => {
    let text = "";
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
        text = await navigator.clipboard.readText();
      }
    } catch {
      // Ignorar fallo de permisos
    }

    if (!text) {
      text = window.prompt("Pega aquí el enlace de Google Maps o coordenadas directas:") || "";
    }

    if (text.trim()) {
      const handled = await processDirectCoordinatesOrLink(text);
      if (!handled) {
        setGoogleQuery(text);
      }
    }
  };

  // BUSCADOR EN TIEMPO REAL CON DEBOUNCE (300ms)
  useEffect(() => {
    if (!googleQuery.trim() || googleQuery.trim().length < 2) {
      setGoogleResults([]);
      setIsSearchingGoogle(false);
      return;
    }

    // Si parece un enlace o coordenadas completas, procesarlo directamente
    if (googleQuery.includes("http") || /(-?\d{1,2}\.\d{3,})[,\s]+(-?\d{1,3}\.\d{3,})/.test(googleQuery)) {
      processDirectCoordinatesOrLink(googleQuery);
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
        console.error("Error en autocompletado de Google Maps:", err);
      } finally {
        setIsSearchingGoogle(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [googleQuery]);

  // AL HACER CLIC EN UN RESULTADO DE GOOGLE MAPS
  const handleSelectGooglePlace = (place: GoogleSearchResultItem) => {
    setVillage(place.fullAddress);
    setLat(place.lat.toFixed(6));
    setLng(place.lng.toFixed(6));
    setShowGoogleDropdown(false);
    setGoogleQuery("");

    if (place.categoryType === "municipality") {
      setConfirmedStatus(
        `📍 Situado en el centro de ${place.title}. Haz clic sobre el tejado o nave en el mapa para afinar la chincheta.`
      );
    } else {
      setConfirmedStatus(
        `✅ Coordenadas exactas fijadas: ${place.lat.toFixed(6)}, ${place.lng.toFixed(6)} (${place.title})`
      );
    }
  };

  // AJUSTE FINO HACIENDO CLIC EN EL MAPA O ARRASTRANDO LA CHINCHETA
  const handleMapCoordinateChange = async (coords: {
    lat: number;
    lng: number;
  }) => {
    const latStr = coords.lat.toFixed(6);
    const lngStr = coords.lng.toFixed(6);
    setLat(latStr);
    setLng(lngStr);

    try {
      const geo = await reverseGeocodeGalicia(coords.lat, coords.lng);
      if (geo) {
        if (!village.trim() || village.includes("—")) {
          setVillage(geo.fullAddress);
        }
        setConfirmedStatus(
          `✅ Coordenadas exactas fijadas: ${latStr}, ${lngStr} (${geo.placeName || geo.concello})`
        );
      } else {
        setConfirmedStatus(`✅ Coordenadas exactas fijadas: ${latStr}, ${lngStr}`);
      }
    } catch {
      setConfirmedStatus(`✅ Coordenadas exactas fijadas: ${latStr}, ${lngStr}`);
    }
  };

  const resetForm = () => {
    setSelectedCustomerId(null);
    setCustomerSearch("");
    setName("");
    setVillage("");
    setPhone("");
    setLat("42.2982");
    setLng("-7.8185");
    setInternalNotes("");
    setSacks(30);
    setOrderNotes("");
    setGoogleQuery("");
    setGoogleResults([]);
    setConfirmedStatus(null);
    setEditingOrderId(null);
    setShowCustomerDropdown(false);
    setCustomQtyCustomerId(null);
  };

  const handleStartEdit = (ord: PendingOrder) => {
    setEditingOrderId(ord.id);
    setSelectedCustomerId(ord.customerId);
    setName(ord.customer.name);
    setCustomerSearch(ord.customer.name);
    setVillage(ord.customer.village);
    setPhone(ord.customer.phone || "");
    setLat(ord.customer.coordinates.lat.toFixed(6));
    setLng(ord.customer.coordinates.lng.toFixed(6));
    setInternalNotes(ord.customer.internalNotes || "");
    setSacks(ord.sacks);
    setOrderNotes(ord.orderNotes || "");
    setGoogleQuery("");
    setShowGoogleDropdown(false);
    setShowCustomerDropdown(false);
    setConfirmedStatus(
      `✏️ Editando pedido de ${ord.customer.name} (${ord.sacks} sacos). Chincheta fijada en ${ord.customer.coordinates.lat.toFixed(6)}, ${ord.customer.coordinates.lng.toFixed(6)}`
    );

    // Scroll suave hacia el formulario en pantallas móviles o escritorio
    setTimeout(() => {
      formContainerRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 60);
  };

  const handleCancelEdit = () => {
    resetForm();
  };

  const handleQuickSackDelta = (orderId: string, delta: number) => {
    onUpdateOrderSacks(orderId, delta, true);
    if (editingOrderId === orderId) {
      setSacks((prev) => Math.max(1, prev + delta));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !village.trim()) return;

    const effectiveCustomerId =
      selectedCustomerId || detectedExistingCustomer?.id || undefined;
    const combinedNotes = orderNotes.trim() || internalNotes.trim();

    // 1. Guardar o actualizar ficha del cliente en base local (con prevención de duplicados)
    const savedCustomer = onSaveCustomer({
      id: effectiveCustomerId,
      name,
      village,
      phone,
      coordinates: {
        lat: parseFloat(lat) || 42.2982,
        lng: parseFloat(lng) || -7.8185,
      },
      internalNotes: combinedNotes,
      ultimosSacos: sacks,
    });

    const targetCustId = effectiveCustomerId || (savedCustomer as any)?.id;

    if (editingOrderId) {
      // 2. MODO EDICIÓN: Actualizar el pedido existente
      onUpdateOrder(editingOrderId, {
        sacks,
        orderNotes: combinedNotes,
      });
      const msg = `💾 ¡Cambios guardados con éxito para ${name} (${sacks} sacos)!`;
      setQuickOrderFeedback(msg);
      setTimeout(() => {
        setQuickOrderFeedback((prev) => (prev === msg ? null : prev));
      }, 4500);
      resetForm();
    } else {
      // 2. MODO CREACIÓN: Registrar nuevo pedido pendiente
      if (targetCustId) {
        onSaveOrder(targetCustId, sacks, combinedNotes);
        const msg = `✅ Pedido de ${name} (${sacks} sacos · ${
          sacks * 15
        } kg) añadido a la cola`;
        setQuickOrderFeedback(msg);
        setTimeout(() => {
          setQuickOrderFeedback((prev) => (prev === msg ? null : prev));
        }, 4500);
      }
      resetForm();
    }
  };

  const pendingOrders = orders.filter((o) => o.status === "Pendiente");
  const totalPendingSacks = pendingOrders.reduce((sum, o) => sum + o.sacks, 0);
  const vanOccupancyPercent = Math.round(
    (totalPendingSacks / vanCapacitySacks) * 100
  );

  return (
    <div className="space-y-6">
      {/* AVISO FLOTANTE DE CONFIRMACIÓN DE RE-PEDIDO EN 1 CLIC */}
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

      {/* 3. PESTAÑA / CAJÓN DESPLEGABLE DE "CARTERA DE CLIENTES HABITUALES" (RE-PEDIDO MASIVO) */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl shadow-xl overflow-hidden">
        <div className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/20">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black uppercase tracking-wider text-white">
                  👥 Cartera de Clientes Habituales ({customers.length})
                </h2>
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  Re-pedido en 1 Clic
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Añade clientes habituales al reparto de hoy en 1 segundo con sus coordenadas GPS y sacos guardados.
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
                ? "Ocultar Cartera de Clientes"
                : `Abrir Cartera Habitual (${customers.length})`}
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
            {/* Barra de herramientas: Buscador instantáneo, filtro por Concello y Ordenación */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-5 relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  placeholder="Buscar por nombre, aldea, concello o teléfono..."
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
                  <option value="frequent">
                    🏆 Más frecuentes (Total sacos histórico)
                  </option>
                  <option value="inactive">
                    ⏳ Más tiempo desde el último pedido
                  </option>
                  <option value="recent">🕒 Último pedido más reciente</option>
                  <option value="alpha">🔤 Orden Alfabético (A-Z)</option>
                </select>
              </div>
            </div>

            {filteredHabitualCustomers.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs border border-dashed border-slate-800 rounded-2xl">
                {customers.length === 0
                  ? "Todavía no hay clientes guardados en tu base local. Registra tu primer pedido abajo y el cliente quedará guardado automáticamente."
                  : "No hay clientes habituales que coincidan con ese filtro."}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 max-h-[520px] overflow-y-auto pr-1">
                {filteredHabitualCustomers.map((c) => {
                  const lastSacks = c.ultimosSacos || 30;
                  const cardSacks = habitualCardSacks[c.id] ?? lastSacks;
                  const daysInfo = formatDaysSinceOrder(
                    c.fechaUltimoPedido || c.updatedAt
                  );
                  const activeQueue = pendingOrderByCustomerId[c.id];
                  const totalSacksHist = c.totalSacosHistorico || lastSacks;
                  const totalOrdersHist = c.totalPedidosHistorico || 1;

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
                            <div className="font-black text-white text-sm flex items-center gap-1.5">
                              <span>{c.name}</span>
                            </div>
                            <div className="text-[11px] text-slate-300 flex items-center gap-1 mt-0.5">
                              <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                              <span className="line-clamp-1">{c.village}</span>
                            </div>
                          </div>

                          {activeQueue ? (
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-amber-500 text-slate-950 shrink-0 shadow">
                              🕒 Ya en cola de reparto ({activeQueue.totalSacks}{" "}
                              sacos)
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700 shrink-0">
                              {daysInfo.label}
                            </span>
                          )}
                        </div>

                        {c.phone && (
                          <div className="text-[11px] text-slate-400 flex items-center gap-1">
                            <Phone className="w-3 h-3 text-slate-500" />
                            <span>{c.phone}</span>
                          </div>
                        )}

                        {/* Historial resumido del cliente */}
                        <div className="p-2 rounded-xl bg-slate-950/90 border border-slate-800/80 text-[11px] text-slate-300 font-medium">
                          <span className="text-amber-400 font-bold">
                            Último: {lastSacks} sacos
                          </span>{" "}
                          ({daysInfo.label.toLowerCase()}) ·{" "}
                          <span className="text-emerald-400 font-bold">
                            Total año/hist: {totalSacksHist} sacos
                          </span>{" "}
                          ({totalOrdersHist}{" "}
                          {totalOrdersHist === 1 ? "pedido" : "pedidos"})
                        </div>

                        {c.internalNotes && (
                          <div className="text-[10px] text-amber-200/80 italic line-clamp-1">
                            “{c.internalNotes}”
                          </div>
                        )}
                      </div>

                      {/* Selector numérico + Botón directo de Añadir al reparto de hoy */}
                      <div className="space-y-2 pt-1 border-t border-slate-800/80">
                        <div className="flex items-center justify-between gap-1.5">
                          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                            <button
                              type="button"
                              onClick={() =>
                                setHabitualCardSacks((prev) => ({
                                  ...prev,
                                  [c.id]: Math.max(1, cardSacks - 5),
                                }))
                              }
                              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-[10px]"
                            >
                              -5
                            </button>
                            <input
                              type="number"
                              min={1}
                              max={300}
                              value={cardSacks}
                              onChange={(e) =>
                                setHabitualCardSacks((prev) => ({
                                  ...prev,
                                  [c.id]: Math.max(
                                    1,
                                    parseInt(e.target.value, 10) || 1
                                  ),
                                }))
                              }
                              className="w-12 text-center bg-slate-900 border border-slate-700 rounded-lg py-1 text-amber-400 font-black text-xs outline-none"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setHabitualCardSacks((prev) => ({
                                  ...prev,
                                  [c.id]: cardSacks + 5,
                                }))
                              }
                              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-[10px]"
                            >
                              +5
                            </button>
                          </div>

                          <div className="flex items-center gap-1">
                            {[15, 30, 45, 70].map((preset) => (
                              <button
                                key={preset}
                                type="button"
                                onClick={() =>
                                  setHabitualCardSacks((prev) => ({
                                    ...prev,
                                    [c.id]: preset,
                                  }))
                                }
                                className={`px-1.5 py-1 rounded-lg text-[10px] font-bold transition ${
                                  cardSacks === preset
                                    ? "bg-amber-500 text-slate-950 font-black"
                                    : "bg-slate-800 text-slate-400 hover:text-white"
                                }`}
                              >
                                {preset}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleQuickRepeatOrder(c, cardSacks)}
                            className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs transition shadow-md shadow-emerald-600/20 flex items-center justify-center gap-1.5"
                          >
                            <Zap className="w-3.5 h-3.5" />
                            <span>
                              ⚡ Añadir al reparto de hoy ({cardSacks} sacos)
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

                          <button
                            type="button"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `¿Eliminar a "${c.name}" de la Cartera de Clientes Habituales?`
                                )
                              ) {
                                onDeleteCustomer(c.id);
                              }
                            }}
                            title="Eliminar cliente de la cartera"
                            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-red-400 border border-slate-700 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
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
        {/* FORMULARIO DE CLIENTE CON GOOGLE MAPS AUTOCOMPLETE */}
        <div
          ref={formContainerRef}
          className={`lg:col-span-7 bg-slate-900 border p-6 rounded-3xl shadow-xl space-y-5 transition-colors ${
            editingOrderId
              ? "border-amber-500/80 ring-1 ring-amber-500/40"
              : "border-slate-800"
          }`}
        >
          {/* CABECERA DINÁMICA: MODO EDICIÓN O MODO NUEVO PEDIDO */}
          {editingOrderId ? (
            <div className="flex items-center justify-between bg-amber-500/15 border-2 border-amber-500/60 p-3.5 rounded-2xl animate-in fade-in duration-200">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-black shadow-md">
                  <Pencil className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-black text-amber-300 flex items-center gap-2">
                    <span>✏️ Editando pedido de {name || "Cliente"}</span>
                  </h2>
                  <p className="text-[11px] text-slate-300">
                    Modifica los sacos, notas o afina la chincheta en el satélite y pulsa Guardar Cambios.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCancelEdit}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold transition flex items-center gap-1.5 border border-slate-700 shrink-0 shadow"
              >
                <X className="w-3.5 h-3.5" />
                <span>Cancelar</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
                  <Package className="w-4 h-4 text-amber-400" />
                  Nuevo Pedido de Pellets (Furgón)
                </h2>
                <p className="text-xs text-slate-400">
                  Super-Buscador con Re-pedido en 1 Clic + Google Maps Satélite Híbrido.
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
            {/* 2. SUPER-BUSCADOR DE CLIENTES HABITUALES CON "RE-PEDIDO EN 1 CLIC" */}
            <div className="relative space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-black text-slate-200">
                  Buscar Cliente Habitual o Escribir Nombre Nuevo *
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
                  placeholder="Haz clic o escribe nombre, teléfono o aldea para repetir pedido en 1 clic..."
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

              {/* Aviso de Prevención de Duplicados Inteligente */}
              {detectedExistingCustomer && !selectedCustomerId && (
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-2 text-[11px]">
                  <div className="text-amber-200">
                    💡 Coincide con cliente habitual:{" "}
                    <strong className="text-white">
                      {detectedExistingCustomer.name}
                    </strong>{" "}
                    ({detectedExistingCustomer.village}). Se actualizará su ficha sin duplicar.
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        handleQuickRepeatOrder(detectedExistingCustomer)
                      }
                      className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[10px]"
                    >
                      ⚡ Repetir ({detectedExistingCustomer.ultimosSacos || 30}{" "}
                      sacos)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        selectExistingCustomer(detectedExistingCustomer)
                      }
                      className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-[10px] border border-slate-700"
                    >
                      ✏️ Cargar GPS
                    </button>
                  </div>
                </div>
              )}

              {/* DESPLEGABLE ENRIQUECIDO DEL SUPER-BUSCADOR CON 3 BOTONES DE ACCIÓN */}
              {showCustomerDropdown &&
                matchingCustomers.length > 0 &&
                !editingOrderId && (
                  <div className="absolute left-0 right-0 top-full mt-1.5 bg-slate-900 border-2 border-amber-500/60 rounded-2xl shadow-2xl z-30 max-h-96 overflow-y-auto p-2 space-y-1.5">
                    <div className="flex items-center justify-between px-2 py-1 border-b border-slate-800 text-[10px] font-black uppercase text-slate-400">
                      <span>
                        {customerSearch.trim()
                          ? `Clientes habituales encontrados (${matchingCustomers.length})`
                          : "⚡ Clientes Habituales Recientes — Re-pedido en 1 Clic"}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setShowCustomerDropdown(false);
                          setCustomQtyCustomerId(null);
                        }}
                        className="text-slate-400 hover:text-white"
                      >
                        ✕ Cerrar
                      </button>
                    </div>

                    {matchingCustomers.map((c) => {
                      const lastSacks = c.ultimosSacos || 30;
                      const daysInfo = formatDaysSinceOrder(
                        c.fechaUltimoPedido || c.updatedAt
                      );
                      const inQueue = pendingOrderByCustomerId[c.id];
                      const isCustomOpen = customQtyCustomerId === c.id;

                      return (
                        <div
                          key={c.id}
                          className="p-3 rounded-xl bg-slate-800/90 hover:bg-slate-800 border border-slate-700/80 space-y-2 transition"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-black text-white text-xs sm:text-sm">
                                  {c.name}
                                </span>
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-900 text-amber-300 font-bold border border-slate-700 flex items-center gap-1">
                                  <Clock className="w-2.5 h-2.5" />
                                  {daysInfo.label}
                                </span>
                                {inQueue && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 font-black">
                                    🕒 Ya en cola ({inQueue.totalSacks} sacos)
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-300 truncate mt-0.5">
                                📍 {c.village}
                                {c.phone ? ` · 📞 ${c.phone}` : ""}
                              </div>
                              {c.totalSacosHistorico ? (
                                <div className="text-[10px] text-slate-400">
                                  Último: {lastSacks} sacos · Histórico:{" "}
                                  {c.totalSacosHistorico} sacos (
                                  {c.totalPedidosHistorico || 1} ped.)
                                </div>
                              ) : null}
                            </div>

                            {/* 3 BOTONES DE ACCIÓN DIRECTA EN LA FILA */}
                            <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                              {/* 1. Botón Verde Destacado: Repetir (X sacos) en 1 Clic */}
                              <button
                                type="button"
                                onClick={() =>
                                  handleQuickRepeatOrder(c, lastSacks)
                                }
                                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[11px] shadow-md shadow-emerald-600/20 flex items-center gap-1 transition"
                              >
                                <Zap className="w-3.5 h-3.5" />
                                <span>⚡ Repetir ({lastSacks} sacos)</span>
                              </button>

                              {/* 2. Botón: Otra cantidad */}
                              <button
                                type="button"
                                onClick={() => {
                                  if (isCustomOpen) {
                                    setCustomQtyCustomerId(null);
                                  } else {
                                    setCustomQtyCustomerId(c.id);
                                    setCustomQtyValue(lastSacks);
                                  }
                                }}
                                className={`px-2.5 py-1.5 rounded-xl font-bold text-[11px] border transition flex items-center gap-1 ${
                                  isCustomOpen
                                    ? "bg-amber-500 text-slate-950 border-amber-400 font-black"
                                    : "bg-slate-900 hover:bg-slate-700 text-amber-300 border-slate-700"
                                }`}
                              >
                                <Hash className="w-3 h-3" />
                                <span>🔢 Otra cantidad</span>
                              </button>

                              {/* 3. Botón: Cargar en formulario */}
                              <button
                                type="button"
                                onClick={() => selectExistingCustomer(c)}
                                className="px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-[11px] transition flex items-center gap-1"
                              >
                                <Pencil className="w-3 h-3 text-amber-400" />
                                <span>✏️ Cargar en formulario</span>
                              </button>
                            </div>
                          </div>

                          {/* Mini-selector rápido si se pulsa "🔢 Otra cantidad" */}
                          {isCustomOpen && (
                            <div className="p-2.5 rounded-xl bg-slate-950 border border-amber-500/40 flex flex-wrap items-center justify-between gap-2 animate-in fade-in duration-150">
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCustomQtyValue((v) => Math.max(1, v - 5))
                                  }
                                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs"
                                >
                                  -5
                                </button>
                                <input
                                  type="number"
                                  min={1}
                                  max={300}
                                  value={customQtyValue}
                                  onChange={(e) =>
                                    setCustomQtyValue(
                                      Math.max(
                                        1,
                                        parseInt(e.target.value, 10) || 1
                                      )
                                    )
                                  }
                                  className="w-16 text-center py-1 rounded-lg bg-slate-900 border border-amber-500/50 text-amber-400 font-black text-sm outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCustomQtyValue((v) => v + 5)
                                  }
                                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-xs"
                                >
                                  +5
                                </button>

                                <div className="flex items-center gap-1 ml-1">
                                  {[15, 30, 45, 70].map((preset) => (
                                    <button
                                      key={preset}
                                      type="button"
                                      onClick={() => setCustomQtyValue(preset)}
                                      className={`px-2 py-1 rounded-lg text-[10px] font-black transition ${
                                        customQtyValue === preset
                                          ? "bg-amber-500 text-slate-950"
                                          : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                                      }`}
                                    >
                                      {preset}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() =>
                                  handleQuickRepeatOrder(c, customQtyValue)
                                }
                                className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs shadow flex items-center gap-1.5"
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>
                                  Confirmar {customQtyValue} sacos (
                                  {customQtyValue * 15} kg)
                                </span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
            </div>

          {/* 1. CAMPO PRINCIPAL: BUSCADOR DIRECTO DE GOOGLE MAPS + BOTÓN PEGAR */}
          <div className="relative p-4 rounded-2xl bg-slate-950 border-2 border-amber-500/40 space-y-2.5 shadow-inner">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black uppercase tracking-wider text-amber-400 flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] font-black shadow">
                  G
                </div>
                <span>Buscar en Google Maps (Aldea, comercio, casa o dirección...)</span>
              </label>

              {isSearchingGoogle && (
                <span className="text-[11px] text-amber-400 font-bold flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando en Google Maps...
                </span>
              )}
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Ej. centro otico losada xinzo, bar a boeira allariz, o vilar..."
                  value={googleQuery}
                  onChange={(e) => setGoogleQuery(e.target.value)}
                  onFocus={() => {
                    if (googleResults.length > 0) setShowGoogleDropdown(true);
                  }}
                  className="w-full px-4 py-2.5 text-xs bg-slate-900 border border-slate-700 rounded-xl text-white font-bold outline-none focus:border-amber-500 shadow-sm"
                />
              </div>

              {/* Botón rápido para pegar coordenadas o link */}
              <button
                type="button"
                onClick={handlePasteCoordsOrLink}
                className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold shrink-0 flex items-center gap-1.5 transition"
                title="Pegar enlace de Google Maps o coordenadas directas"
              >
                <ClipboardPaste className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">Pegar Coords/Link</span>
              </button>
            </div>

            {/* Desplegable limpio con sugerencias de Google Maps y etiquetas de tipo */}
            {showGoogleDropdown && googleResults.length > 0 && (
              <div className="absolute left-3 right-3 top-full mt-1.5 bg-slate-900 border-2 border-amber-500/60 rounded-2xl shadow-2xl z-30 max-h-72 overflow-y-auto p-1.5 space-y-1">
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

                {googleResults.map((place) => {
                  const isBiz = place.categoryType === "business";
                  const isMuni = place.categoryType === "municipality";
                  const isHamlet = place.categoryType === "hamlet";

                  return (
                    <button
                      key={place.id}
                      type="button"
                      onClick={() => handleSelectGooglePlace(place)}
                      className={`w-full text-left p-3 rounded-xl hover:bg-slate-800 text-xs flex items-center justify-between gap-3 transition border ${
                        isBiz
                          ? "border-blue-500/20 bg-blue-500/5"
                          : isMuni
                          ? "border-amber-500/20 bg-amber-500/5"
                          : "border-slate-800/60"
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="font-black text-white text-sm flex items-center gap-2">
                          <MapPin
                            className={`w-4 h-4 shrink-0 ${
                              isBiz
                                ? "text-blue-400"
                                : isMuni
                                ? "text-amber-400"
                                : "text-emerald-400"
                            }`}
                          />
                          <span>{place.title}</span>
                        </div>
                        <div className="text-[11px] text-slate-300 pl-6 leading-relaxed">
                          {place.subtitle}
                        </div>
                      </div>

                      <div className="text-right shrink-0 space-y-1">
                        <span
                          className={`text-[10px] font-black px-2.5 py-1 rounded-full block text-center ${
                            isBiz
                              ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                              : isMuni
                              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                              : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          }`}
                        >
                          {place.categoryLabel || (isBiz ? "🏪 Negocio / Local exacto" : isHamlet ? "🏘️ Aldea / Núcleo rural" : "📍 Centro del Concello")}
                        </span>
                        <span className="text-[9px] text-slate-400 block font-bold">
                          {place.source}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Aldea y Teléfono */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">
                Dirección / Aldea / Concello *
              </label>
              <input
                type="text"
                required
                placeholder="Ej. Outeiro — Rairiz de Veiga (Ourense)"
                value={village}
                onChange={(e) => setVillage(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-amber-500 font-bold"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">
                Teléfono del Cliente (Opcional)
              </label>
              <input
                type="tel"
                placeholder="Ej. 654 321 987"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-amber-500"
              />
            </div>
          </div>

          {/* 2. MAPA CON CARTOGRAFÍA SATÉLITE HÍBRIDA DE GOOGLE MAPS (lyrs=y con maxZoom=21 y flyTo) */}
          <div className="space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
              <span className="font-black text-white flex items-center gap-2">
                <Satellite className="w-4 h-4 text-amber-400" />
                <span>Google Maps Satélite Híbrido (Haz clic sobre el tejado o portón exacto)</span>
              </span>

              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-amber-400 font-bold bg-slate-950 px-2 py-0.5 rounded-md border border-slate-800">
                  {lat}, {lng}
                </span>
              </div>
            </div>

            <PrecisionMapPicker
              coordinates={{
                lat: parseFloat(lat) || 42.2982,
                lng: parseFloat(lng) || -7.8185,
              }}
              onChange={handleMapCoordinateChange}
              height="340px"
              zoom={19}
            />

            {/* Badge de confirmación de coordenadas */}
            {confirmedStatus && (
              <div
                className={`p-3 rounded-2xl text-xs font-bold flex items-center gap-2 animate-in fade-in duration-200 ${
                  confirmedStatus.startsWith("📍")
                    ? "bg-amber-500/10 border border-amber-500/30 text-amber-300"
                    : "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
                }`}
              >
                {confirmedStatus.startsWith("📍") ? (
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                ) : (
                  <Check className="w-4 h-4 shrink-0 text-emerald-400" />
                )}
                <span>{confirmedStatus}</span>
              </div>
            )}
          </div>

          {/* Cantidad de sacos (15 kg c/u) */}
          <div className="p-4 rounded-2xl bg-slate-800/60 border border-slate-700/80 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-white">
                Cantidad a Repartir (Sacos de 15 kg)
              </label>
              <span className="text-xs font-mono font-black text-amber-400">
                {(sacks * 15).toLocaleString("es-ES")} kg en pellets
              </span>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSacks((s) => Math.max(1, s - 5))}
                className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold transition"
              >
                -5 sacos
              </button>
              <input
                type="number"
                min={1}
                max={200}
                value={sacks}
                onChange={(e) =>
                  setSacks(Math.max(1, parseInt(e.target.value, 10) || 1))
                }
                className="w-full text-center text-2xl font-black py-2 rounded-xl bg-slate-900 border border-slate-700 text-amber-400 outline-none"
              />
              <button
                type="button"
                onClick={() => setSacks((s) => s + 5)}
                className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold transition"
              >
                +5 sacos
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-300 mb-1">
              Notas de Descarga / Observaciones Internas
            </label>
            <input
              type="text"
              placeholder="Ej. Dejar en el cobertizo, perro en finca, cobrar 210€ en efectivo..."
              value={orderNotes}
              onChange={(e) => setOrderNotes(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-amber-500"
            />
          </div>

          {/* BOTONES DE ACCIÓN: GUARDAR CAMBIOS (EDICIÓN) O REGISTRAR PEDIDO */}
          {editingOrderId ? (
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleCancelEdit}
                className="w-1/3 py-4 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs sm:text-sm transition border border-slate-700 flex items-center justify-center gap-1.5 shadow"
              >
                <X className="w-4 h-4" />
                <span>Cancelar</span>
              </button>
              <button
                type="submit"
                className="w-2/3 py-4 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs sm:text-sm transition shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2"
              >
                <Save className="w-4 h-4 sm:w-5 sm:h-5" />
                <span>💾 Guardar Cambios ({sacks} sacos · {sacks * 15} kg)</span>
              </button>
            </div>
          ) : (
            <button
              type="submit"
              className="w-full py-4 px-4 rounded-2xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-black text-sm transition shadow-lg shadow-amber-600/25 flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" />
              <span>
                Registrar Pedido ({sacks} sacos · {sacks * 15} kg)
              </span>
            </button>
          )}
        </form>
      </div>

      {/* LISTADO DE PEDIDOS PENDIENTES CON EDICIÓN Y AJUSTE RÁPIDO DE SACOS */}
      <div className="lg:col-span-5 space-y-4">
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl space-y-4">
          <div className="space-y-3 border-b border-slate-800 pb-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black uppercase tracking-wider text-white">
                Pedidos en Cola ({pendingOrders.length})
              </h3>
              <span className="text-xs text-amber-400 font-bold">
                Total: {totalPendingSacks} sacos ({totalPendingSacks * 15} kg)
              </span>
            </div>

            {/* Barra de ocupación del furgón */}
            <div className="space-y-1.5 bg-slate-950/80 p-3 rounded-2xl border border-slate-800/80">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400 font-bold flex items-center gap-1.5">
                  <Truck className="w-3.5 h-3.5 text-amber-400" />
                  <span>Carga Furgón ({vanCapacitySacks} sacos máx.):</span>
                </span>
                <span
                  className={`font-black ${
                    totalPendingSacks > vanCapacitySacks
                      ? "text-red-400"
                      : "text-amber-400"
                  }`}
                >
                  {totalPendingSacks} / {vanCapacitySacks} sacos ({vanOccupancyPercent}%)
                  {totalPendingSacks > vanCapacitySacks &&
                    ` • ${Math.ceil(totalPendingSacks / vanCapacitySacks)} viajes`}
                </span>
              </div>
              <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                <div
                  className={`h-full transition-all duration-300 ${
                    totalPendingSacks > vanCapacitySacks
                      ? "bg-red-500"
                      : "bg-gradient-to-r from-amber-500 to-amber-400"
                  }`}
                  style={{
                    width: `${Math.min(100, vanOccupancyPercent)}%`,
                  }}
                />
              </div>
              {totalPendingSacks > vanCapacitySacks && (
                <p className="text-[10px] text-amber-300/90 flex items-center gap-1 font-medium">
                  <AlertTriangle className="w-3 h-3 shrink-0 text-amber-400" />
                  Supera el furgón: el Planificador de Rutas dividirá automáticamente en viajes.
                </p>
              )}
            </div>
          </div>

          {pendingOrders.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-2xl space-y-1">
              <p className="font-bold text-slate-400">
                No hay pedidos pendientes
              </p>
              <p className="text-[11px]">
                Utiliza el formulario de la izquierda con el buscador de Google Maps para registrar a tus
                clientes y pedidos.
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[660px] overflow-y-auto pr-1">
              {pendingOrders.map((ord, i) => {
                const isEditing = editingOrderId === ord.id;

                return (
                  <div
                    key={ord.id}
                    className={`p-4 rounded-2xl transition flex items-start justify-between gap-3 text-xs border ${
                      isEditing
                        ? "bg-amber-500/10 border-amber-400 ring-2 ring-amber-400/80 shadow-lg shadow-amber-500/10"
                        : "bg-slate-800/80 border-slate-700/80 hover:border-slate-600"
                    }`}
                  >
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-lg bg-slate-900 font-bold flex items-center justify-center text-[10px] text-slate-400 shrink-0">
                          {i + 1}
                        </span>
                        <span className="font-extrabold text-white text-sm truncate">
                          {ord.customer.name}
                        </span>
                        {isEditing && (
                          <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 shrink-0 animate-pulse">
                            ✏️ Editando
                          </span>
                        )}
                      </div>

                      <div className="text-slate-300 text-[11px] flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span className="line-clamp-1">
                          {ord.customer.village}
                        </span>
                      </div>

                      {/* Contador de sacos + Botones rápidos de ajuste -5, -1, +1, +5 */}
                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        <span className="text-amber-400 font-black text-xs">
                          {ord.sacks} sacos ({ord.totalWeightKg} kg)
                        </span>

                        <div className="flex items-center gap-1 bg-slate-950 rounded-lg p-0.5 border border-slate-700/80">
                          <button
                            type="button"
                            onClick={() => handleQuickSackDelta(ord.id, -5)}
                            title="Restar 5 sacos"
                            className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                          >
                            -5
                          </button>
                          <button
                            type="button"
                            onClick={() => handleQuickSackDelta(ord.id, -1)}
                            title="Restar 1 saco"
                            className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                          >
                            -1
                          </button>
                          <button
                            type="button"
                            onClick={() => handleQuickSackDelta(ord.id, +1)}
                            title="Sumar 1 saco"
                            className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-slate-800 hover:bg-slate-700 text-amber-300 hover:text-amber-200 transition"
                          >
                            +1
                          </button>
                          <button
                            type="button"
                            onClick={() => handleQuickSackDelta(ord.id, +5)}
                            title="Sumar 5 sacos"
                            className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-slate-800 hover:bg-slate-700 text-amber-300 hover:text-amber-200 transition"
                          >
                            +5
                          </button>
                        </div>
                      </div>

                      {ord.orderNotes && (
                        <div className="text-[10px] text-amber-200/90 italic">
                          “{ord.orderNotes}”
                        </div>
                      )}
                    </div>

                    {/* Botones de acción: Editar, Completar, Eliminar */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(ord)}
                        className={`p-2 rounded-xl transition flex items-center gap-1 font-bold ${
                          isEditing
                            ? "bg-amber-500 text-slate-950 font-black shadow"
                            : "text-slate-400 hover:text-amber-400 hover:bg-slate-700"
                        }`}
                        title="✏️ Editar pedido"
                      >
                        <Pencil className="w-4 h-4" />
                        <span className="text-[11px] hidden sm:inline">Editar</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateOrderStatus(ord.id, "Completado")}
                        className="p-2 rounded-xl text-slate-400 hover:text-emerald-400 hover:bg-slate-700 transition"
                        title="Marcar completado"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (editingOrderId === ord.id) handleCancelEdit();
                          onDeleteOrder(ord.id);
                        }}
                        className="p-2 rounded-xl text-slate-400 hover:text-red-400 hover:bg-slate-700 transition"
                        title="Eliminar"
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
