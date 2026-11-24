"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { TechnicianConfig } from "@/types/pelletGalicia";
import {
  Settings,
  Save,
  Shield,
  FileJson,
  Satellite,
  Check,
  Trash2,
  Key,
  Search,
  Loader2,
  Fuel,
  Clock,
} from "lucide-react";
import GaliciaBackupModal from "@/components/admin/GaliciaBackupModal";
import { galiciaStorage } from "@/services/galiciaStorage";
import {
  searchGoogleMapsLive,
  GoogleSearchResultItem,
} from "@/utils/galiciaGeocoding";
import { formatHoursMinutes } from "@/utils/satUiHelpers";

const PrecisionMapPicker = dynamic(
  () => import("@/components/map/PrecisionMapPicker"),
  {
    ssr: false,
    loading: () => (
      <div className="h-[280px] w-full bg-slate-950 rounded-2xl flex items-center justify-center text-slate-500 text-xs border border-slate-800 animate-pulse">
        Cargando mapa satélite de la Base / Taller...
      </div>
    ),
  }
);

interface ConfigBackupTabProps {
  config: TechnicianConfig;
  onSaveConfig: (updated: Partial<TechnicianConfig>) => void;
  onRefreshAll: () => void;
}

export default function ConfigBackupTab({
  config,
  onSaveConfig,
  onRefreshAll,
}: ConfigBackupTabProps) {
  const [maxWorkdayMinutes, setMaxWorkdayMinutes] = useState<number>(
    config.maxWorkdayMinutes
  );
  const [maxStopsPerRoute, setMaxStopsPerRoute] = useState<number>(
    config.maxStopsPerRoute
  );
  const [workdayStartTime, setWorkdayStartTime] = useState<string>(
    config.workdayStartTime || "08:30"
  );
  const [consumoL100, setConsumoL100] = useState<number>(
    config.consumoL100 ?? 7.5
  );
  const [precioCombustible, setPrecioCombustible] = useState<number>(
    config.precioCombustible ?? 1.55
  );
  const [hourlyCostEur, setHourlyCostEur] = useState<number>(
    config.hourlyCostEur ?? 0
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
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const [clearedFeedback, setClearedFeedback] = useState(false);

  // Buscador para la Base / Taller
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
        console.error("Error buscando ubicación del taller:", err);
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
      maxWorkdayMinutes: Math.max(60, Math.min(960, maxWorkdayMinutes || 480)),
      maxStopsPerRoute: Math.max(1, Math.min(30, maxStopsPerRoute || 12)),
      workdayStartTime: workdayStartTime || "08:30",
      consumoL100: Math.max(2, Number(consumoL100) || 7.5),
      precioCombustible: Math.max(0.1, Number(precioCombustible) || 1.55),
      hourlyCostEur: Math.max(0, Number(hourlyCostEur) || 0),
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
    galiciaStorage.clearAllData();
    setIsConfirmingClear(false);
    setClearedFeedback(true);
    setTimeout(() => setClearedFeedback(false), 3500);
    onRefreshAll();
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
                Configuración de Jornada SAT, Vehículo y Base
              </h2>
              <p className="text-xs text-slate-400">
                Duración máxima de turno, costes de desplazamiento y punto de salida/retorno.
              </p>
            </div>
          </div>

          {savedSuccess && (
            <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
              <Check className="w-4 h-4" /> ¡Guardado con éxito!
            </span>
          )}
        </div>

        {/* Parámetros de Jornada */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">
              Jornada Máxima por Turno (minutos) *
            </label>
            <input
              type="number"
              min={60}
              max={960}
              step={15}
              value={maxWorkdayMinutes}
              onChange={(e) =>
                setMaxWorkdayMinutes(parseInt(e.target.value, 10) || 480)
              }
              className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded-xl text-white font-bold outline-none focus:border-amber-500"
            />
            <span className="text-[11px] text-amber-400 mt-1 block font-mono font-bold">
              = {formatHoursMinutes(maxWorkdayMinutes)} (Conducción + Intervenciones)
            </span>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">
              Máximo de Avisos por Turno *
            </label>
            <input
              type="number"
              min={1}
              max={30}
              value={maxStopsPerRoute}
              onChange={(e) =>
                setMaxStopsPerRoute(parseInt(e.target.value, 10) || 12)
              }
              className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded-xl text-white font-bold outline-none focus:border-amber-500"
            />
            <span className="text-[11px] text-slate-400 mt-1 block">
              Tope de paradas antes de abrir Turno #2
            </span>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>Hora Inicio Jornada</span>
            </label>
            <input
              type="time"
              value={workdayStartTime}
              onChange={(e) => setWorkdayStartTime(e.target.value || "08:30")}
              className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded-xl text-amber-400 font-mono font-black outline-none focus:border-amber-500"
            />
            <span className="text-[11px] text-slate-400 mt-1 block">
              Base para cálculo de ETA de llegada
            </span>
          </div>
        </div>

        {/* Parámetros de Vehículo Taller y Costes */}
        <div className="p-4 rounded-2xl bg-slate-950/90 border border-amber-500/30 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-amber-400">
              <Fuel className="w-4 h-4" />
              <span>Parámetros de Vehículo Taller y Rentabilidad</span>
            </div>
            <span className="text-[11px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
              Coste km: {((consumoL100 / 100) * precioCombustible).toFixed(3)} €/km
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">
                Consumo Vehículo (L/100km)
              </label>
              <input
                type="number"
                step="0.1"
                min={2}
                max={35}
                value={consumoL100}
                onChange={(e) =>
                  setConsumoL100(parseFloat(e.target.value) || 7.5)
                }
                className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-xl text-white font-bold outline-none focus:border-amber-500"
              />
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                Furgoneta taller (ej. 7.5 L/100km)
              </span>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">
                Precio Combustible (€/Litro)
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
                Para coste real de desplazamientos
              </span>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-300 mb-1">
                Coste/Hora Técnico (€/h, opcional)
              </label>
              <input
                type="number"
                step="1"
                min={0}
                max={300}
                value={hourlyCostEur}
                onChange={(e) =>
                  setHourlyCostEur(parseFloat(e.target.value) || 0)
                }
                className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-xl text-emerald-400 font-black outline-none focus:border-amber-500"
              />
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                0 € = solo descontar combustible en margen
              </span>
            </div>
          </div>
        </div>

        {/* Nombre de Base / Taller */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">
              Nombre de la Base / Taller Central *
            </label>
            <input
              type="text"
              required
              value={warehouseName}
              onChange={(e) => setWarehouseName(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">
              Dirección / Polígono de la Base *
            </label>
            <input
              type="text"
              required
              value={warehouseVillage}
              onChange={(e) => setWarehouseVillage(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-amber-500"
            />
          </div>
        </div>

        {/* Buscador de Ubicación de Base con Google Maps */}
        <div className="relative space-y-1.5 pt-1">
          <label className="block text-xs font-bold text-slate-300 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-amber-400">
              <Search className="w-3.5 h-3.5" />
              Buscar Ubicación de la Base / Taller en Google Maps
            </span>
            {isSearching && (
              <span className="text-[10px] text-amber-400 font-bold flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Buscando...
              </span>
            )}
          </label>
          <input
            type="text"
            placeholder="Escribe polígono, calle o aldea de tu taller/base..."
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

        {/* MAPA SATÉLITE */}
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-slate-300 flex items-center gap-1.5">
              <Satellite className="w-4 h-4 text-amber-400" />
              Ubicación Exacta de Salida y Retorno (Google Maps Satélite Híbrido)
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

        {/* GOOGLE MAPS API KEY OPCIONAL */}
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

      {/* BACKUP LOCAL-FIRST & VACIADO */}
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-400" />
            Copias de Seguridad (Local-First)
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Exporta tus clientes, equipos y partes de trabajo en un archivo JSON seguro para tu PC.
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

          {isConfirmingClear ? (
            <div className="flex items-center gap-1.5 bg-red-950/60 border border-red-500/50 p-1 rounded-2xl">
              <button
                type="button"
                onClick={handleClearDatabase}
                className="px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black text-xs transition"
              >
                ⚠️ Sí, borrar todo
              </button>
              <button
                type="button"
                onClick={() => setIsConfirmingClear(false)}
                className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsConfirmingClear(true)}
              className="px-4 py-2.5 rounded-2xl bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold text-xs border border-red-500/30 flex items-center gap-1.5 transition"
            >
              <Trash2 className="w-4 h-4" />
              <span>
                {clearedFeedback ? "✓ Base de datos vaciada" : "Vaciar Base de Datos"}
              </span>
            </button>
          )}
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
