"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { VanClient } from "@/types/pelletVan";
import {
  User,
  Phone,
  MapPin,
  Search,
  Check,
  Edit3,
  Trash2,
  Layers,
  Sparkles,
  Link2,
  ExternalLink,
  Satellite,
  Compass,
} from "lucide-react";
import {
  searchGaliciaNominatim,
  extractGaliciaCoordinates,
  GaliciaGeoResult,
} from "@/utils/galiciaGeocoding";

// Cargar dinámicamente el mapa con soporte Satélite (Esri World Imagery)
const PrecisionMapPicker = dynamic(
  () => import("@/components/map/PrecisionMapPicker"),
  {
    ssr: false,
    loading: () => (
      <div className="h-[280px] w-full bg-slate-950 rounded-2xl flex items-center justify-center text-slate-500 text-xs border border-slate-800 animate-pulse">
        Cargando mapa satelital Esri / OSM...
      </div>
    ),
  }
);

interface ClientManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  clients: VanClient[];
  onSaveClient: (
    clientData: Omit<VanClient, "id" | "createdAt" | "updatedAt"> & { id?: string }
  ) => Promise<void>;
  onDeleteClient: (id: string) => Promise<void>;
}

export default function ClientManagementModal({
  isOpen,
  onClose,
  clients,
  onSaveClient,
  onDeleteClient,
}: ClientManagementModalProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  // Campos del cliente
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("42.3352");
  const [lng, setLng] = useState("-7.8638");
  const [internalNotes, setInternalNotes] = useState("");

  // Herramientas de localización rural
  const [pasteMapsInput, setPasteMapsInput] = useState("");
  const [pasteFeedback, setPasteFeedback] = useState<string | null>(null);
  const [nominatimQuery, setNominatimQuery] = useState("");
  const [nominatimResults, setNominatimResults] = useState<GaliciaGeoResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  if (!isOpen) return null;

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setPhone("");
    setAddress("");
    setLat("42.3352");
    setLng("-7.8638");
    setInternalNotes("");
    setPasteMapsInput("");
    setPasteFeedback(null);
    setNominatimResults([]);
  };

  const handleEdit = (c: VanClient) => {
    setEditingId(c.id);
    setName(c.name);
    setPhone(c.phone);
    setAddress(c.address);
    setLat(String(c.coordinates.lat));
    setLng(String(c.coordinates.lng));
    setInternalNotes(c.internalNotes || "");
    setPasteMapsInput("");
    setPasteFeedback(null);
  };

  // 1. Pegado inteligente de enlace Google Maps o coordenadas directas
  const handleExtractFromMaps = () => {
    if (!pasteMapsInput.trim()) return;
    const extracted = extractGaliciaCoordinates(pasteMapsInput);

    if (extracted) {
      setLat(extracted.lat.toFixed(6));
      setLng(extracted.lng.toFixed(6));
      setPasteFeedback(
        `✓ Coordenadas detectadas: ${extracted.lat.toFixed(6)}, ${extracted.lng.toFixed(6)}`
      );
      setPasteMapsInput("");
    } else {
      setPasteFeedback(
        "❌ No se detectaron coordenadas válidas. Pega un enlace con @lat,lng o las coordenadas directas (ej. 42.3352, -7.8638)"
      );
    }
  };

  // 2. Buscador Nominatim prefiltrado para Galicia (Lugar / Parroquia / Concello)
  const handleSearchGalicia = async () => {
    const q = nominatimQuery.trim() || address.trim();
    if (!q || q.length < 2) return;
    setIsSearching(true);
    setNominatimResults([]);
    const results = await searchGaliciaNominatim(q);
    setNominatimResults(results);
    setIsSearching(false);
  };

  const handleSelectNominatim = (res: GaliciaGeoResult) => {
    setAddress(res.displayName);
    setLat(res.lat.toFixed(6));
    setLng(res.lng.toFixed(6));
    setNominatimResults([]);
    setNominatimQuery("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !address.trim()) return;

    await onSaveClient({
      id: editingId || undefined,
      name,
      phone,
      address,
      coordinates: {
        lat: parseFloat(lat) || 42.3352,
        lng: parseFloat(lng) || -7.8638,
      },
      internalNotes,
    });
    resetForm();
  };

  const filteredClients = clients.filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.phone.includes(searchTerm)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-5xl w-full p-5 sm:p-7 text-white shadow-2xl my-6 space-y-6 max-h-[92vh] overflow-y-auto">
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-lg font-black text-white flex items-center gap-2">
              <Compass className="w-5 h-5 text-amber-400" />
              Gestión Rural de Clientes (Lugar, Parroquia & Aldea)
            </h2>
            <p className="text-xs text-slate-400">
              Precisión milimétrica por satélite para tejados, naves y fincas sin número de calle oficial en Galicia.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Formulario de Cliente con Mapa Satelital */}
          <form
            onSubmit={handleSubmit}
            className="lg:col-span-7 bg-slate-800/60 p-5 rounded-3xl border border-slate-700/80 space-y-4"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-amber-400">
                {editingId ? "Editar Cliente / Aldea" : "Ficha de Nuevo Cliente"}
              </span>
              <span className="text-[11px] text-slate-400">
                Almacenado 100% en local (IndexedDB)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Nombre del Cliente / Casa *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Casa Manolo (Lugar de Vilar)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-xl outline-none focus:border-amber-500 text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Teléfono de Contacto
                </label>
                <input
                  type="tel"
                  placeholder="Ej. 654 321 987"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-xl outline-none focus:border-amber-500 text-white"
                />
              </div>
            </div>

            {/* SECCIÓN INTELIGENTE 1: Pegar Enlace de Google Maps / Coordenadas */}
            <div className="p-3 rounded-2xl bg-slate-900/90 border border-slate-700/80 space-y-1.5">
              <label className="block text-[11px] font-bold text-amber-400 flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5" />
                Pegar Enlace de Google Maps o Coordenadas Crudas
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="https://maps.google.com/?q=... o 42.3352, -7.8638"
                  value={pasteMapsInput}
                  onChange={(e) => setPasteMapsInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleExtractFromMaps();
                    }
                  }}
                  className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-amber-500"
                />
                <button
                  type="button"
                  onClick={handleExtractFromMaps}
                  className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-black text-xs shrink-0"
                >
                  Extraer GPS
                </button>
              </div>

              {pasteFeedback && (
                <p
                  className={`text-[11px] font-bold ${
                    pasteFeedback.startsWith("✓")
                      ? "text-emerald-400"
                      : "text-red-400"
                  }`}
                >
                  {pasteFeedback}
                </p>
              )}
            </div>

            {/* SECCIÓN INTELIGENTE 2: Buscador Nominatim de Galicia (Lugar / Parroquia / Concello) */}
            <div className="p-3 rounded-2xl bg-slate-900/90 border border-slate-700/80 space-y-1.5">
              <label className="block text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5 text-amber-400" />
                Buscar por Lugar / Parroquia / Aldea / Concello
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Ej. Lugar de Casanova, Castro Caldelas o Parroquia..."
                  value={nominatimQuery}
                  onChange={(e) => setNominatimQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSearchGalicia();
                    }
                  }}
                  className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-amber-500"
                />
                <button
                  type="button"
                  onClick={handleSearchGalicia}
                  disabled={isSearching}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-bold text-xs shrink-0"
                >
                  {isSearching ? "Buscando..." : "Localizar"}
                </button>
              </div>

              {nominatimResults.length > 0 && (
                <div className="mt-2 bg-slate-800 border border-slate-700 rounded-xl p-1.5 space-y-1 max-h-40 overflow-y-auto">
                  {nominatimResults.map((r, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleSelectNominatim(r)}
                      className="w-full text-left p-2 rounded-lg hover:bg-slate-700 text-xs flex items-start gap-2 border-b last:border-b-0 border-slate-700/50"
                    >
                      <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-extrabold text-white">
                          {r.displayName.split(",")[0]}
                        </div>
                        <div className="text-[10px] text-slate-400 line-clamp-1">
                          {r.displayName}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Dirección descriptiva */}
            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">
                Dirección Descriptiva / Indicaciones de Acceso *
              </label>
              <input
                type="text"
                required
                placeholder="Ej. Lugar de Vilar s/n, desvío tras la iglesia románica"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-xl outline-none focus:border-amber-500 text-white"
              />
            </div>

            {/* MAPA DE PRECISIÓN CON CAPA SATÉLITE ESRI & CALLEJERO OSM */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-300 flex items-center gap-1.5">
                  <Satellite className="w-4 h-4 text-amber-400" />
                  Ajuste Fino por Satélite (Esri World Imagery)
                </span>
                <span className="font-mono text-[11px] text-amber-400">
                  {lat}, {lng}
                </span>
              </div>
              <PrecisionMapPicker
                coordinates={{
                  lat: parseFloat(lat) || 42.3352,
                  lng: parseFloat(lng) || -7.8638,
                }}
                onChange={(coords) => {
                  setLat(coords.lat.toFixed(6));
                  setLng(coords.lng.toFixed(6));
                }}
                height="240px"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">
                Notas Internas de Descarga (Naves, Pendientes, Portones)
              </label>
              <textarea
                rows={2}
                placeholder="Ej. Pista de tierra con baches, descargar en cobertizo de chapa, perro pastor..."
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                className="w-full p-2.5 text-xs bg-slate-900 border border-slate-700 rounded-xl outline-none focus:border-amber-500 text-white"
              />
            </div>

            <div className="flex gap-2 pt-1">
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="w-1/3 py-2.5 rounded-xl border border-slate-700 text-xs font-bold text-slate-400 hover:text-white"
                >
                  Cancelar
                </button>
              )}
              <button
                type="submit"
                className="flex-1 py-3 rounded-2xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-black text-xs transition flex items-center justify-center gap-1.5 shadow-lg shadow-amber-600/20"
              >
                <Check className="w-4 h-4" />
                {editingId ? "Actualizar Coordenadas y Datos" : "Guardar Ficha del Cliente"}
              </button>
            </div>
          </form>

          {/* Listado Lateral de Clientes Registrados */}
          <div className="lg:col-span-5 space-y-3.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Buscar cliente, lugar o aldea..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 text-xs bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-amber-500"
              />
            </div>

            <div className="space-y-2.5 max-h-[580px] overflow-y-auto pr-1">
              {filteredClients.map((c) => (
                <div
                  key={c.id}
                  className="p-3.5 rounded-2xl bg-slate-800/80 border border-slate-700 hover:border-slate-600 transition flex items-start justify-between gap-3 text-xs"
                >
                  <div className="space-y-1">
                    <div className="font-extrabold text-white text-sm">
                      {c.name}
                    </div>
                    <div className="text-slate-300 text-[11px] line-clamp-2">
                      📍 {c.address}
                    </div>
                    <div className="font-mono text-[10px] text-amber-400">
                      GPS: {c.coordinates.lat.toFixed(5)}, {c.coordinates.lng.toFixed(5)}
                    </div>
                    {c.internalNotes && (
                      <div className="text-[10px] text-amber-200/90 italic">
                        “{c.internalNotes}”
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleEdit(c)}
                      className="p-2 rounded-xl text-slate-400 hover:text-amber-400 hover:bg-slate-700"
                      title="Editar coordenadas y datos"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteClient(c.id)}
                      className="p-2 rounded-xl text-slate-400 hover:text-red-400 hover:bg-slate-700"
                      title="Eliminar cliente"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
