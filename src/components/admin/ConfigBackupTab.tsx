"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { VanConfig } from "@/types/pelletGalicia";
import {
  Settings,
  Warehouse,
  Save,
  Shield,
  FileJson,
  Satellite,
  Check,
  Trash2,
  Key,
  Search,
  MapPin,
  Loader2,
  Fuel,
} from "lucide-react";
import GaliciaBackupModal from "@/components/admin/GaliciaBackupModal";
import { galiciaStorage } from "@/services/galiciaStorage";
import {
  searchGoogleMapsLive,
  GoogleSearchResultItem,
} from "@/utils/galiciaGeocoding";

const PrecisionMapPicker = dynamic(
  () => import("@/components/map/PrecisionMapPicker"),
  {
    ssr: false,
    loading: () => (
      <div className="h-[280px] w-full bg-slate-950 rounded-2xl flex items-center justify-center text-slate-500 text-xs border border-slate-800 animate-pulse">
        Cargando mapa de Google Maps del almacén...
      </div>
    ),
  }
);

interface ConfigBackupTabProps {
  config: VanConfig;
  onSaveConfig: (updated: Partial<VanConfig>) => void;
  onRefreshAll: () => void;
}

export default function ConfigBackupTab({
  config,
  onSaveConfig,
  onRefreshAll,
}: ConfigBackupTabProps) {
  const [vanCapacity, setVanCapacity] = useState<number>(
    config.vanCapacitySacks
  );
  const [consumoVacioL100, setConsumoVacioL100] = useState<number>(
    config.consumoVacioL100 ?? 8.5
  );
  const [extraConsumoPorTonelada, setExtraConsumoPorTonelada] =
    useState<number>(config.extraConsumoPorTonelada ?? 2.2);
  const [precioCombustible, setPrecioCombustible] = useState<number>(
    config.precioCombustible ?? 1.55
  );
  const [precioPorSaco, setPrecioPorSaco] = useState<number>(
    config.precioPorSaco ?? 4.5
  );
  const [warehouseName, setWarehouseName] = useState(config.warehouseName);
  const [warehouseVillage, setWarehouseVillage] = useState(
    config.warehouseVillage
  );
  const [googleMapsApiKey, setGoogleMapsApiKey] = useState(
    config.googleMapsApiKey || ""
  );
  const [lat, setLat] = useState(config.warehouseCoordinates.lat.toFixed(6));
  const [lng, setLng] = useState(config.warehouseCoordinates.lng.toFixed(6));
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [isBackupOpen, setIsBackupOpen] = useState(false);

  // Buscador para el almacén
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GoogleSearchResultItem[]>(
    []
  );
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchGoogleMapsLive(
          searchQuery,
          googleMapsApiKey || config.googleMapsApiKey
        );
        setSearchResults(res);
        setShowDropdown(true);
      } catch (err) {
        console.error("Error buscando ubicación del almacén:", err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, googleMapsApiKey, config.googleMapsApiKey]);

  const handleSelectPlace = (place: GoogleSearchResultItem) => {
    setWarehouseVillage(place.fullAddress);
    setLat(place.lat.toFixed(6));
    setLng(place.lng.toFixed(6));
    setShowDropdown(false);
    setSearchQuery("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveConfig({
      vanCapacitySacks: vanCapacity,
      consumoVacioL100: Math.max(1, Number(consumoVacioL100) || 8.5),
      extraConsumoPorTonelada: Math.max(
        0,
        Number(extraConsumoPorTonelada) || 2.2
      ),
      precioCombustible: Math.max(0.1, Number(precioCombustible) || 1.55),
      precioPorSaco: Math.max(0.5, Number(precioPorSaco) || 4.5),
      warehouseName: warehouseName.trim(),
      warehouseVillage: warehouseVillage.trim(),
      googleMapsApiKey: googleMapsApiKey.trim() || undefined,
      warehouseCoordinates: {
        lat: parseFloat(lat) || config.warehouseCoordinates.lat,
        lng: parseFloat(lng) || config.warehouseCoordinates.lng,
      },
    });
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const handleClearDatabase = () => {
    if (
      confirm(
        "⚠️ ¿Estás seguro de que deseas vaciar toda la base de datos?\n\nSe eliminarán todos los clientes y pedidos guardados en este navegador para que puedas empezar tu base de datos desde cero."
      )
    ) {
      galiciaStorage.clearAllData();
      onRefreshAll();
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <form
        onSubmit={handleSubmit}
        className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl space-y-5"
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-black uppercase tracking-wider text-white">
                Configuración del Furgón, Almacén y Google Maps
              </h2>
              <p className="text-xs text-slate-400">
                Punto de carga central, pesaje y configuración de cartografía.
              </p>
            </div>
          </div>

          {savedSuccess && (
            <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
              <Check className="w-4 h-4" /> ¡Guardado con éxito!
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">
              Capacidad Máxima del Furgón (Sacos de 15 kg) *
            </label>
            <input
              type="number"
              min={10}
              max={250}
              value={vanCapacity}
              onChange={(e) =>
                setVanCapacity(parseInt(e.target.value, 10) || 90)
              }
              className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded-xl text-white font-bold outline-none focus:border-amber-500"
            />
            <span className="text-[11px] text-amber-400 mt-1 block">
              = {(vanCapacity * 15).toLocaleString("es-ES")} kg de carga útil
              máxima por viaje
            </span>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">
              Nombre de la Base / Almacén *
            </label>
            <input
              type="text"
              required
              value={warehouseName}
              onChange={(e) => setWarehouseName(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-amber-500"
            />
          </div>
        </div>

        {/* 1. PARÁMETROS DE CONSUMO DE COMBUSTIBLE DEL FURGÓN (CVRP + PESO DINÁMICO) */}
        <div className="p-4 rounded-2xl bg-slate-950/90 border border-amber-500/30 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-amber-400">
              <Fuel className="w-4 h-4" />
              <span>Parámetros de Consumo del Furgón (Motor CVRP + Peso Dinámico)</span>
            </div>
            <span className="text-[11px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
              Plena carga ({vanCapacity} sacos = {vanCapacity * 15} kg):{" "}
              {(
                consumoVacioL100 +
                ((vanCapacity * 15) / 1000) * extraConsumoPorTonelada
              ).toFixed(2)}{" "}
              L/100km
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">
                Consumo Furgón Vacío (L/100km)
              </label>
              <input
                type="number"
                step="0.1"
                min={3}
                max={35}
                value={consumoVacioL100}
                onChange={(e) =>
                  setConsumoVacioL100(parseFloat(e.target.value) || 8.5)
                }
                className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-xl text-white font-bold outline-none focus:border-amber-500"
              />
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                Rodaje sin carga (ej. 8.5 L/100km)
              </span>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">
                Extra por Tonelada (+L/100km por 1.000 kg)
              </label>
              <input
                type="number"
                step="0.1"
                min={0}
                max={15}
                value={extraConsumoPorTonelada}
                onChange={(e) =>
                  setExtraConsumoPorTonelada(parseFloat(e.target.value) || 2.2)
                }
                className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-xl text-white font-bold outline-none focus:border-amber-500"
              />
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                Penalización por peso (ej. +2.2 L/100km/t)
              </span>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">
                Precio Combustible Diésel (€/Litro)
              </label>
              <input
                type="number"
                step="0.01"
                min={0.5}
                max={5}
                value={precioCombustible}
                onChange={(e) =>
                  setPrecioCombustible(parseFloat(e.target.value) || 1.55)
                }
                className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-xl text-amber-400 font-black outline-none focus:border-amber-500"
              />
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                Para coste por viaje y por saco (ej. 1.55 €/L)
              </span>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">
                Precio Venta por Saco (€/saco 15 kg)
              </label>
              <input
                type="number"
                step="0.05"
                min={1}
                max={30}
                value={precioPorSaco}
                onChange={(e) =>
                  setPrecioPorSaco(parseFloat(e.target.value) || 4.5)
                }
                className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-xl text-emerald-400 font-black outline-none focus:border-amber-500"
              />
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                Para resumen de ingresos de campaña (ej. 4.50 €)
              </span>
            </div>
          </div>
        </div>

        {/* Buscador de Ubicación del Almacén con Google Maps */}
        <div className="relative space-y-1.5 pt-1">
          <label className="block text-xs font-bold text-slate-300 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-amber-400">
              <Search className="w-3.5 h-3.5" />
              Buscar Ubicación del Almacén en Google Maps
            </span>
            {isSearching && (
              <span className="text-[10px] text-amber-400 font-bold flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Buscando...
              </span>
            )}
          </label>
          <input
            type="text"
            placeholder="Escribe polígono, calle o aldea de tu almacén..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => {
              if (searchResults.length > 0) setShowDropdown(true);
            }}
            className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-amber-500"
          />

          {showDropdown && searchResults.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-slate-900 border-2 border-amber-500/50 rounded-2xl shadow-2xl z-30 max-h-52 overflow-y-auto p-1.5 space-y-1">
              {searchResults.map((place) => (
                <button
                  key={place.id}
                  type="button"
                  onClick={() => handleSelectPlace(place)}
                  className="w-full text-left p-2.5 rounded-xl hover:bg-slate-800 text-xs flex items-center justify-between gap-2 transition"
                >
                  <div>
                    <div className="font-extrabold text-white text-sm">
                      {place.title}
                    </div>
                    <div className="text-[11px] text-slate-300 line-clamp-1">
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

        <div>
          <label className="block text-xs font-bold text-slate-300 mb-1">
            Dirección / Polígono del Almacén *
          </label>
          <input
            type="text"
            required
            value={warehouseVillage}
            onChange={(e) => setWarehouseVillage(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-amber-500"
          />
        </div>

        {/* MAPA CON CARTOGRAFÍA SATÉLITE HÍBRIDA DE GOOGLE MAPS */}
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-slate-300 flex items-center gap-1.5">
              <Satellite className="w-4 h-4 text-amber-400" />
              Ubicación Exacta de Carga y Retorno (Google Maps Satélite Híbrido)
            </span>
            <span className="font-mono text-[11px] text-amber-400 font-bold">
              {lat}, {lng}
            </span>
          </div>
          <PrecisionMapPicker
            coordinates={{
              lat: parseFloat(lat) || config.warehouseCoordinates.lat,
              lng: parseFloat(lng) || config.warehouseCoordinates.lng,
            }}
            onChange={(c) => {
              setLat(c.lat.toFixed(6));
              setLng(c.lng.toFixed(6));
            }}
            height="260px"
            zoom={19}
          />
        </div>

        {/* CAMPO OPCIONAL: GOOGLE MAPS API KEY */}
        <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-300 flex items-center gap-2">
              <Key className="w-4 h-4 text-amber-400" />
              <span>Google Maps API Key (Opcional)</span>
            </label>
            <span className="text-[10px] text-emerald-400 font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              Modo Zero-Config Activo
            </span>
          </div>

          <input
            type="password"
            placeholder="AIzaSy... (Opcional, no requerida inicialmente)"
            value={googleMapsApiKey}
            onChange={(e) => setGoogleMapsApiKey(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-xl text-white font-mono outline-none focus:border-amber-500"
          />

          <p className="text-[11px] text-slate-400 leading-relaxed">
            💡 <strong>Sin API Key necesaria:</strong> El sistema ya incluye el
            buscador oficial de toponimia del IGN (Instituto Geográfico
            Nacional) y Photon/OSM para Galicia. Si en el futuro quieres
            activar el autocompletado comercial de Google Places para buscar
            también nombres de negocios o bares específicos, solo tienes que
            pegar tu clave aquí.
          </p>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            className="px-6 py-3 rounded-2xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-black text-xs transition shadow-lg shadow-amber-600/25 flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            Guardar Configuración
          </button>
        </div>
      </form>

      {/* SECCIÓN DE BACKUP LOCAL-FIRST & VACIADO */}
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-400" />
            Copias de Seguridad (Local-First)
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Exporta tus clientes habituales y pedidos en un archivo JSON seguro
            para tu PC, o restáuralo si cambias de navegador.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setIsBackupOpen(true)}
            className="px-4 py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs border border-slate-700 flex items-center gap-1.5 transition"
          >
            <FileJson className="w-4 h-4 text-amber-400" />
            <span>Gestionar Backup (JSON)</span>
          </button>

          <button
            type="button"
            onClick={handleClearDatabase}
            className="px-4 py-2.5 rounded-2xl bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold text-xs border border-red-500/30 flex items-center gap-1.5 transition"
            title="Eliminar todos los clientes y pedidos de la base de datos"
          >
            <Trash2 className="w-4 h-4" />
            <span>Vaciar Base de Datos</span>
          </button>
        </div>
      </div>

      <GaliciaBackupModal
        isOpen={isBackupOpen}
        onClose={() => setIsBackupOpen(false)}
        onDataRestored={onRefreshAll}
      />
    </div>
  );
}
