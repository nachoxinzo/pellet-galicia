"use client";

import React, { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import {
  Order,
  OrderFormInput,
  TimeWindow,
  PELLET_RULES,
  Coordinates,
  calculateOrderMetrics,
} from "@/types/pellet";
import {
  searchAddressWithNominatim,
  parseCoordinatesOrGoogleMapsUrl,
  GeoSearchResult,
} from "@/utils/geocoding";
import {
  Package,
  Layers,
  Scale,
  User,
  Phone,
  MapPin,
  Clock,
  AlertTriangle,
  FileText,
  X,
  Check,
  Navigation,
  Plus,
  Minus,
  Search,
  ExternalLink,
  Map as MapIcon,
  Loader2,
} from "lucide-react";

// Carga dinámica del mapa de Leaflet sin SSR
const LocationPickerMap = dynamic(
  () => import("@/components/map/LocationPickerMap"),
  {
    ssr: false,
    loading: () => (
      <div className="h-[240px] w-full bg-slate-100 rounded-xl flex items-center justify-center text-slate-400 text-xs animate-pulse">
        Cargando mapa interactivo...
      </div>
    ),
  }
);

interface OrderFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (formInput: OrderFormInput) => void;
  editingOrder?: Order | null;
}

const QUICK_UNLOADING_TAGS = [
  "Acceso estrecho",
  "Necesita transpaleta",
  "Dejar en garaje",
  "Rampa con pendiente",
  "Avisar 15 min antes",
  "Camión con plataforma",
];

export default function OrderFormModal({
  isOpen,
  onClose,
  onSave,
  editingOrder,
}: OrderFormModalProps) {
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [lat, setLat] = useState<string>("40.6352");
  const [lng, setLng] = useState<string>("-3.7021");
  const [unloadingNotes, setUnloadingNotes] = useState("");
  const [preferredTimeWindow, setPreferredTimeWindow] =
    useState<TimeWindow>("Mañana");
  const [pallets, setPallets] = useState<number>(1);
  const [looseSacks, setLooseSacks] = useState<number>(0);
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState<string>(
    new Date().toISOString().split("T")[0]
  );
  const [orderNotes, setOrderNotes] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Estados de geolocalización y búsqueda de direcciones
  const [addressSearchQuery, setAddressSearchQuery] = useState("");
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const [searchResults, setSearchResults] = useState<GeoSearchResult[]>([]);
  const [mapsPasteInput, setMapsPasteInput] = useState("");
  const [mapsPasteFeedback, setMapsPasteFeedback] = useState<string | null>(
    null
  );
  const [showInteractiveMap, setShowInteractiveMap] = useState(true);

  useEffect(() => {
    if (editingOrder) {
      setClientName(editingOrder.client.name);
      setClientPhone(editingOrder.client.phone);
      setClientAddress(editingOrder.client.address);
      setLat(String(editingOrder.client.coordinates.lat));
      setLng(String(editingOrder.client.coordinates.lng));
      setUnloadingNotes(editingOrder.client.unloadingNotes);
      setPreferredTimeWindow(editingOrder.client.preferredTimeWindow);
      setPallets(editingOrder.pallets);
      setLooseSacks(editingOrder.looseSacks);
      setRequestedDeliveryDate(
        editingOrder.requestedDeliveryDate ||
          new Date().toISOString().split("T")[0]
      );
      setOrderNotes(editingOrder.orderNotes || "");
      setErrorMsg(null);
      setAddressSearchQuery("");
      setSearchResults([]);
      setMapsPasteInput("");
      setMapsPasteFeedback(null);
    } else {
      setClientName("");
      setClientPhone("");
      setClientAddress("");
      setLat("40.6400");
      setLng("-3.9800");
      setUnloadingNotes("");
      setPreferredTimeWindow("Mañana");
      setPallets(1);
      setLooseSacks(0);
      setRequestedDeliveryDate(new Date().toISOString().split("T")[0]);
      setOrderNotes("");
      setErrorMsg(null);
      setAddressSearchQuery("");
      setSearchResults([]);
      setMapsPasteInput("");
      setMapsPasteFeedback(null);
    }
  }, [editingOrder, isOpen]);

  // Cálculo automático en tiempo real al modificar palés o sacos sueltos
  const metrics = useMemo(() => {
    return calculateOrderMetrics(pallets, looseSacks);
  }, [pallets, looseSacks]);

  // Manejador de búsqueda con Nominatim (OpenStreetMap)
  const handleSearchAddress = async () => {
    const q = addressSearchQuery.trim() || clientAddress.trim();
    if (!q || q.length < 3) return;
    setIsSearchingAddress(true);
    setSearchResults([]);
    const results = await searchAddressWithNominatim(q);
    setSearchResults(results);
    setIsSearchingAddress(false);
  };

  const handleSelectSearchResult = (result: GeoSearchResult) => {
    setClientAddress(result.displayName);
    setLat(result.lat.toFixed(6));
    setLng(result.lng.toFixed(6));
    setSearchResults([]);
    setAddressSearchQuery("");
  };

  // Manejador de pegado de Google Maps link o coordenadas directas
  const handleParseMapsLink = () => {
    if (!mapsPasteInput.trim()) return;
    const extracted = parseCoordinatesOrGoogleMapsUrl(mapsPasteInput);
    if (extracted) {
      setLat(extracted.lat.toFixed(6));
      setLng(extracted.lng.toFixed(6));
      setMapsPasteFeedback(
        `✓ Coordenadas detectadas: ${extracted.lat.toFixed(
          5
        )}, ${extracted.lng.toFixed(5)}`
      );
      setMapsPasteInput("");
    } else {
      setMapsPasteFeedback(
        "❌ No se detectaron coordenadas válidas. Pega un enlace de Google Maps con @lat,lng o las coordenadas directamente (ej: 40.6352, -3.7021)"
      );
    }
  };

  const handleMapCoordinateChange = (coords: Coordinates) => {
    setLat(coords.lat.toFixed(6));
    setLng(coords.lng.toFixed(6));
  };

  if (!isOpen) return null;

  const handleAddTag = (tag: string) => {
    if (!unloadingNotes) {
      setUnloadingNotes(tag);
      return;
    }
    if (!unloadingNotes.toLowerCase().includes(tag.toLowerCase())) {
      setUnloadingNotes(`${unloadingNotes.trim().replace(/\.$/, "")}. ${tag}.`);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim()) {
      setErrorMsg("El nombre del cliente es obligatorio.");
      return;
    }
    if (!clientAddress.trim()) {
      setErrorMsg("La dirección de entrega es obligatoria.");
      return;
    }
    if (metrics.totalWeightKg <= 0) {
      setErrorMsg(
        "El pedido debe incluir al menos 1 palé o 1 saco suelto de pellets."
      );
      return;
    }

    onSave({
      orderId: editingOrder?.id,
      clientId: editingOrder?.clientId,
      clientName,
      clientPhone,
      clientAddress,
      lat: parseFloat(lat) || 40.4168,
      lng: parseFloat(lng) || -3.7038,
      unloadingNotes,
      preferredTimeWindow,
      pallets: metrics.pallets,
      looseSacks: metrics.looseSacks,
      requestedDeliveryDate,
      orderNotes,
    });
    onClose();
  };

  const currentCoords: Coordinates = {
    lat: parseFloat(lat) || 40.64,
    lng: parseFloat(lng) || -3.98,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-200">
        {/* Cabecera */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">
                {editingOrder
                  ? `Editar Pedido #${editingOrder.id}`
                  : "Nuevo Pedido de Pellets"}
              </h2>
              <p className="text-xs text-slate-400">
                Geolocalización en OpenStreetMap & cálculo automático de tonelaje
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-6 space-y-6 max-h-[82vh] overflow-y-auto"
        >
          {errorMsg && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* SECCIÓN 1: Configurador de Carga y Peso en Tiempo Real */}
          <div className="p-5 rounded-2xl bg-gradient-to-br from-amber-50/90 via-orange-50/50 to-slate-50 border border-amber-200/80 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-amber-800 bg-amber-200/70 px-2.5 py-1 rounded-full">
                  Cálculo en Tiempo Real
                </span>
                <h3 className="text-base font-bold text-slate-900 mt-1.5">
                  Formato de Carga del Pedido
                </h3>
              </div>

              {/* Widget de Peso Total en Vivo */}
              <div className="flex items-center gap-4 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-md">
                <Scale className="w-7 h-7 text-amber-400 shrink-0" />
                <div>
                  <div className="text-xs text-slate-400 uppercase tracking-wider font-medium">
                    Peso Total Calculado
                  </div>
                  <div className="text-2xl font-extrabold text-amber-400 tracking-tight">
                    {metrics.totalWeightKg.toLocaleString("es-ES")} kg
                  </div>
                  <div className="text-[11px] text-slate-300">
                    {metrics.totalSacksCount} sacos totales • ~
                    {metrics.equivalentPallets} palés eq.
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Control de Palés Completos */}
              <div className="bg-white p-4 rounded-xl border border-amber-200/70 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-amber-600" />
                    Palés Completos
                  </label>
                  <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                    1 palé = {PELLET_RULES.SACKS_PER_PALLET} sacos (
                    {PELLET_RULES.PALLET_WEIGHT_KG.toLocaleString("es-ES")} kg)
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <button
                    type="button"
                    onClick={() => setPallets((p) => Math.max(0, p - 1))}
                    className="p-2.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 transition"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    value={pallets}
                    onChange={(e) =>
                      setPallets(Math.max(0, parseInt(e.target.value, 10) || 0))
                    }
                    className="w-full text-center text-xl font-bold text-slate-900 border border-slate-300 rounded-lg py-2 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setPallets((p) => p + 1)}
                    className="p-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white transition"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <div className="mt-2.5 flex items-center justify-between text-xs text-slate-600">
                  <span>
                    Subtotal: {metrics.pallets * PELLET_RULES.SACKS_PER_PALLET}{" "}
                    sacos
                  </span>
                  <span className="font-semibold text-amber-700">
                    {metrics.palletsWeightKg.toLocaleString("es-ES")} kg
                  </span>
                </div>
              </div>

              {/* Control de Sacos Sueltos */}
              <div className="bg-white p-4 rounded-xl border border-amber-200/70 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                    <Package className="w-4 h-4 text-amber-600" />
                    Sacos Sueltos (15 kg)
                  </label>
                  <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                    1 saco = {PELLET_RULES.SACK_WEIGHT_KG} kg
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <button
                    type="button"
                    onClick={() => setLooseSacks((s) => Math.max(0, s - 5))}
                    title="-5 sacos"
                    className="px-2.5 py-2 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold transition"
                  >
                    -5
                  </button>
                  <button
                    type="button"
                    onClick={() => setLooseSacks((s) => Math.max(0, s - 1))}
                    className="p-2.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 transition"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <input
                    type="number"
                    min={0}
                    max={500}
                    value={looseSacks}
                    onChange={(e) =>
                      setLooseSacks(
                        Math.max(0, parseInt(e.target.value, 10) || 0)
                      )
                    }
                    className="w-full text-center text-xl font-bold text-slate-900 border border-slate-300 rounded-lg py-2 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setLooseSacks((s) => s + 1)}
                    className="p-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white transition"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setLooseSacks((s) => s + 10)}
                    title="+10 sacos"
                    className="px-2.5 py-2 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs font-bold transition"
                  >
                    +10
                  </button>
                </div>
                <div className="mt-2.5 flex items-center justify-between text-xs text-slate-600">
                  <span>
                    {metrics.looseSacks >= PELLET_RULES.SACKS_PER_PALLET
                      ? `💡 Equivale a ${Math.floor(
                          metrics.looseSacks / PELLET_RULES.SACKS_PER_PALLET
                        )} palé(s) + ${
                          metrics.looseSacks % PELLET_RULES.SACKS_PER_PALLET
                        } sacos`
                      : `Sacos individuales`}
                  </span>
                  <span className="font-semibold text-amber-700">
                    {metrics.looseSacksWeightKg.toLocaleString("es-ES")} kg
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* SECCIÓN 2: Datos del Cliente */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200 pb-2">
              Datos del Cliente y Horario
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nombre del Cliente / Empresa *
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    required
                    placeholder="Ej. Juan Pérez / Hotel El Pinar"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Teléfono de Contacto *
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="tel"
                    required
                    placeholder="Ej. 612 345 678"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Ventana Horaria Preferida
                </label>
                <div className="relative">
                  <Clock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <select
                    value={preferredTimeWindow}
                    onChange={(e) =>
                      setPreferredTimeWindow(e.target.value as TimeWindow)
                    }
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none text-slate-900 bg-white"
                  >
                    <option value="Mañana">🌅 Mañana (08:00 - 14:00)</option>
                    <option value="Tarde">🌇 Tarde (14:00 - 19:00)</option>
                    <option value="Indiferente">🕒 Indiferente (Todo el día)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* SECCIÓN 3: Geolocalización Avanzada y Mapa Interactivo */}
          <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-amber-600" />
                  Geolocalización y Ubicación de Entrega
                </h3>
                <p className="text-xs text-slate-500">
                  Busca con OpenStreetMap, pega enlace de Google Maps o ajusta
                  la chincheta en el mapa
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowInteractiveMap(!showInteractiveMap)}
                className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-3 py-1.5 rounded-lg transition self-start sm:self-auto"
              >
                <MapIcon className="w-3.5 h-3.5" />
                {showInteractiveMap ? "Ocultar Mapa" : "Mostrar Mapa"}
              </button>
            </div>

            {/* Buscador Nominatim y Extractor de Google Maps */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Buscador Nominatim */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  🔍 Buscar Dirección en OpenStreetMap (Nominatim)
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      placeholder="Ej. Calle Mayor 14, Collado Villalba"
                      value={addressSearchQuery}
                      onChange={(e) => setAddressSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleSearchAddress();
                        }
                      }}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSearchAddress}
                    disabled={isSearchingAddress}
                    className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 shrink-0"
                  >
                    {isSearchingAddress ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Search className="w-3.5 h-3.5" />
                    )}
                    Buscar
                  </button>
                </div>

                {/* Resultados de Búsqueda Nominatim */}
                {searchResults.length > 0 && (
                  <div className="mt-2 bg-white rounded-xl border border-amber-200 shadow-md p-2 space-y-1 max-h-40 overflow-y-auto">
                    <div className="text-[10px] font-bold uppercase text-slate-400 px-2 py-0.5">
                      Coincidencias encontradas:
                    </div>
                    {searchResults.map((res, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleSelectSearchResult(res)}
                        className="w-full text-left p-2 rounded-lg text-xs hover:bg-amber-50 text-slate-800 border-b last:border-b-0 border-slate-100 flex items-start gap-2"
                      >
                        <MapPin className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <div className="font-semibold">
                            {res.displayName.split(",")[0]}
                          </div>
                          <div className="text-[11px] text-slate-500 line-clamp-1">
                            {res.displayName}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Pegado directo de Google Maps o Coordenadas */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  🔗 O Pegar Enlace de Google Maps / Coordenadas
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="https://maps.google.com/?q=... o 40.6352, -3.7021"
                    value={mapsPasteInput}
                    onChange={(e) => setMapsPasteInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleParseMapsLink();
                      }
                    }}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                  />
                  <button
                    type="button"
                    onClick={handleParseMapsLink}
                    className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold flex items-center gap-1.5 shrink-0"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Extraer
                  </button>
                </div>

                {mapsPasteFeedback && (
                  <p
                    className={`text-[11px] mt-1.5 font-medium ${
                      mapsPasteFeedback.startsWith("✓")
                        ? "text-emerald-700"
                        : "text-red-600"
                    }`}
                  >
                    {mapsPasteFeedback}
                  </p>
                )}
              </div>
            </div>

            {/* Dirección Oficial */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Dirección Completa de Entrega *
              </label>
              <div className="relative">
                <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="text"
                  required
                  placeholder="Calle, número, urbanización, municipio y código postal"
                  value={clientAddress}
                  onChange={(e) => setClientAddress(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none text-slate-900 bg-white"
                />
              </div>
            </div>

            {/* Coordenadas GPS editables */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Latitud (GPS)
                </label>
                <div className="relative">
                  <Navigation className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="number"
                    step="any"
                    value={lat}
                    onChange={(e) => setLat(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none text-slate-900 font-mono bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Longitud (GPS)
                </label>
                <div className="relative">
                  <Navigation className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="number"
                    step="any"
                    value={lng}
                    onChange={(e) => setLng(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none text-slate-900 font-mono bg-white"
                  />
                </div>
              </div>
            </div>

            {/* Mapa Interactivo con React-Leaflet */}
            {showInteractiveMap && (
              <div className="space-y-1.5 pt-2">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span className="font-semibold">
                    Ajuste fino de la chincheta:
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Arrastra o haz clic en la entrada/garaje exacto
                  </span>
                </div>
                <LocationPickerMap
                  coordinates={currentCoords}
                  onChange={handleMapCoordinateChange}
                  height="220px"
                />
              </div>
            )}
          </div>

          {/* SECCIÓN 4: Notas de descarga y Observaciones */}
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  Notas Técnicas de Descarga (Accesibilidad / Maquinaria)
                </label>
                <span className="text-[11px] text-slate-400">
                  Clic rápido para añadir etiquetas:
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {QUICK_UNLOADING_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleAddTag(tag)}
                    className="text-xs px-2.5 py-1 rounded-full bg-slate-100 hover:bg-amber-100 text-slate-700 hover:text-amber-900 border border-slate-200 transition"
                  >
                    + {tag}
                  </button>
                ))}
              </div>
              <textarea
                rows={2}
                placeholder="Ej. Acceso estrecho, necesita transpaleta manual, dejar palé dentro del garaje..."
                value={unloadingNotes}
                onChange={(e) => setUnloadingNotes(e.target.value)}
                className="w-full p-3 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none text-slate-900"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Fecha Estimada / Solicitada
                </label>
                <input
                  type="date"
                  value={requestedDeliveryDate}
                  onChange={(e) => setRequestedDeliveryDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Notas del Pedido (Albarán / Cobro)
                </label>
                <div className="relative">
                  <FileText className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Ej. Cobrar en efectivo, pedir firma..."
                    value={orderNotes}
                    onChange={(e) => setOrderNotes(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none text-slate-900"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Botones de Acción */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-100 transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold shadow-md shadow-amber-600/20 transition"
            >
              <Check className="w-4 h-4" />
              {editingOrder ? "Guardar Cambios" : "Registrar Pedido"} (
              {metrics.totalWeightKg.toLocaleString("es-ES")} kg)
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
