"use client";

import React, { useState, useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Coordinates } from "@/types/pelletGalicia";
import { Satellite, Map, Crosshair } from "lucide-react";

interface PrecisionMapPickerProps {
  coordinates: Coordinates;
  onChange: (coords: Coordinates) => void;
  height?: string;
  zoom?: number;
}

// Icono personalizado de alta precisión estilo Google Maps
const precisionPinIcon = L.divIcon({
  className: "precision-map-marker",
  html: `
    <div style="
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      cursor: grab;
      filter: drop-shadow(0 4px 10px rgba(0,0,0,0.6));
    ">
      <div style="
        background: #ea4335;
        width: 38px;
        height: 38px;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        border: 3px solid #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <div style="
          width: 14px;
          height: 14px;
          background: #ffffff;
          border-radius: 50%;
          transform: rotate(45deg);
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <div style="width: 6px; height: 6px; background: #c5221f; border-radius: 50%;"></div>
        </div>
      </div>
      <div style="
        width: 8px;
        height: 4px;
        background: rgba(0,0,0,0.5);
        border-radius: 50%;
        margin-top: 2px;
      "></div>
    </div>
  `,
  iconSize: [38, 44],
  iconAnchor: [19, 42],
  popupAnchor: [0, -42],
});

function MapFlyToCenter({
  coordinates,
  targetZoom,
}: {
  coordinates: Coordinates;
  targetZoom: number;
}) {
  const map = useMap();
  useEffect(() => {
    const current = map.getCenter();
    const dist =
      Math.abs(current.lat - coordinates.lat) +
      Math.abs(current.lng - coordinates.lng);

    if (dist > 0.00005) {
      map.flyTo([coordinates.lat, coordinates.lng], targetZoom, {
        duration: 1.2,
      });
    }
  }, [coordinates, targetZoom, map]);
  return null;
}

function ClickToPosition({
  onSelectCoords,
}: {
  onSelectCoords: (coords: Coordinates) => void;
}) {
  useMapEvents({
    click(e) {
      onSelectCoords({
        lat: parseFloat(e.latlng.lat.toFixed(6)),
        lng: parseFloat(e.latlng.lng.toFixed(6)),
      });
    },
  });
  return null;
}

export default function PrecisionMapPicker({
  coordinates,
  onChange,
  height = "340px",
  zoom = 19, // Nivel tejado Google Maps
}: PrecisionMapPickerProps) {
  // Capas: "hybrid" (Google Maps Satélite Híbrido lyrs=y) o "streets" (Google Maps Callejero lyrs=m)
  const [mapLayer, setMapLayer] = useState<"hybrid" | "streets">("hybrid");

  return (
    <div
      style={{ height }}
      className="w-full rounded-3xl overflow-hidden border-2 border-slate-700 relative shadow-2xl z-0 group"
    >
      <MapContainer
        center={[coordinates.lat, coordinates.lng]}
        zoom={zoom}
        maxZoom={21}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%" }}
      >
        {/* 1. TILELAYER PRINCIPAL: GOOGLE MAPS SATÉLITE HÍBRIDO (lyrs=y con maxZoom=21 e idioma español) */}
        {mapLayer === "hybrid" ? (
          <TileLayer
            attribution='Imágenes &copy; Google Maps Satélite Híbrido &mdash; DGT/IGN'
            url="https://mt{s}.google.com/vt/lyrs=y&hl=es&x={x}&y={y}&z={z}"
            subdomains={["0", "1", "2", "3"]}
            maxZoom={21}
            maxNativeZoom={20}
          />
        ) : (
          /* 2. TILELAYER ALTERNATIVO: GOOGLE MAPS CALLEJERO (lyrs=m con maxZoom=21) */
          <TileLayer
            attribution='Mapa &copy; Google Maps Callejero &mdash; DGT/IGN'
            url="https://mt{s}.google.com/vt/lyrs=m&hl=es&x={x}&y={y}&z={z}"
            subdomains={["0", "1", "2", "3"]}
            maxZoom={21}
            maxNativeZoom={20}
          />
        )}

        <MapFlyToCenter coordinates={coordinates} targetZoom={zoom} />
        <ClickToPosition onSelectCoords={onChange} />

        <Marker
          position={[coordinates.lat, coordinates.lng]}
          icon={precisionPinIcon}
          draggable={true}
          eventHandlers={{
            dragend(e) {
              const marker = e.target;
              const pos = marker.getLatLng();
              onChange({
                lat: parseFloat(pos.lat.toFixed(6)),
                lng: parseFloat(pos.lng.toFixed(6)),
              });
            },
          }}
        >
          <Popup>
            <div className="text-xs font-sans text-slate-900 p-1">
              <strong className="text-red-600 text-sm block font-black">
                Punto de Descarga del Furgón
              </strong>
              <div className="font-mono text-xs text-slate-700 font-bold mt-1">
                {coordinates.lat.toFixed(6)}, {coordinates.lng.toFixed(6)}
              </div>
              <p className="text-[11px] text-slate-600 mt-1">
                🎯 Chincheta situada en el tejado o portón exacto. Puedes hacer clic en el mapa para moverla.
              </p>
            </div>
          </Popup>
        </Marker>
      </MapContainer>

      {/* Selector de Capa Google Maps en esquina superior derecha */}
      <div className="absolute top-3 right-3 z-[400] flex bg-slate-950/90 backdrop-blur-md border border-slate-700/80 rounded-2xl p-1 shadow-2xl">
        <button
          type="button"
          onClick={() => setMapLayer("hybrid")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition ${
            mapLayer === "hybrid"
              ? "bg-amber-500 text-slate-950 shadow-md"
              : "text-slate-300 hover:text-white"
          }`}
          title="Google Maps Satélite con nombres de aldeas, carreteras y pistas"
        >
          <Satellite className="w-3.5 h-3.5" />
          <span>Google Satélite Híbrido</span>
        </button>

        <button
          type="button"
          onClick={() => setMapLayer("streets")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition ${
            mapLayer === "streets"
              ? "bg-amber-500 text-slate-950 shadow-md"
              : "text-slate-300 hover:text-white"
          }`}
          title="Google Maps Callejero estándar"
        >
          <Map className="w-3.5 h-3.5" />
          <span>Google Callejero</span>
        </button>
      </div>

      {/* Indicador inferior de precisión */}
      <div className="absolute bottom-3 left-3 z-[400] bg-slate-950/90 backdrop-blur text-white px-3 py-1.5 rounded-xl text-[11px] font-bold border border-slate-700 pointer-events-none shadow-xl flex items-center gap-1.5">
        <Crosshair className="w-3.5 h-3.5 text-amber-400" />
        <span>Haz clic sobre el tejado o portón para afinar la chincheta</span>
      </div>
    </div>
  );
}
