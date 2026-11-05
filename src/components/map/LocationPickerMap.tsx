"use client";

import React, { useEffect } from "react";
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
import { Coordinates } from "@/types/pellet";

interface LocationPickerMapProps {
  coordinates: Coordinates;
  onChange: (coords: Coordinates) => void;
  height?: string;
  zoom?: number;
}

// Icono personalizado para el marcador de cliente
const clientPinIcon = L.divIcon({
  className: "custom-leaflet-marker",
  html: `
    <div style="
      background-color: #d97706;
      width: 34px;
      height: 34px;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      border: 3px solid #ffffff;
      box-shadow: 0 4px 10px rgba(0,0,0,0.35);
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <div style="
        width: 12px;
        height: 12px;
        background-color: #ffffff;
        border-radius: 50%;
        transform: rotate(45deg);
      "></div>
    </div>
  `,
  iconSize: [34, 34],
  iconAnchor: [17, 34],
  popupAnchor: [0, -34],
});

function MapRecenter({ coordinates }: { coordinates: Coordinates }) {
  const map = useMap();
  useEffect(() => {
    map.setView([coordinates.lat, coordinates.lng], map.getZoom());
  }, [coordinates, map]);
  return null;
}

function MapClickHandler({
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

export default function LocationPickerMap({
  coordinates,
  onChange,
  height = "240px",
  zoom = 14,
}: LocationPickerMapProps) {
  return (
    <div
      style={{ height }}
      className="w-full rounded-xl overflow-hidden border border-slate-300 relative shadow-inner z-0"
    >
      <MapContainer
        center={[coordinates.lat, coordinates.lng]}
        zoom={zoom}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapRecenter coordinates={coordinates} />
        <MapClickHandler onSelectCoords={onChange} />

        <Marker
          position={[coordinates.lat, coordinates.lng]}
          icon={clientPinIcon}
          draggable={true}
          eventHandlers={{
            dragend(e) {
              const marker = e.target;
              const position = marker.getLatLng();
              onChange({
                lat: parseFloat(position.lat.toFixed(6)),
                lng: parseFloat(position.lng.toFixed(6)),
              });
            },
          }}
        >
          <Popup>
            <div className="text-xs font-sans text-slate-800">
              <strong className="text-amber-700">Punto de Entrega</strong>
              <br />
              {coordinates.lat.toFixed(5)}, {coordinates.lng.toFixed(5)}
              <br />
              <span className="text-[10px] text-slate-500">
                (Arrastra el marcador o haz clic en el mapa)
              </span>
            </div>
          </Popup>
        </Marker>
      </MapContainer>
      <div className="absolute bottom-2 left-2 z-[400] bg-white/90 backdrop-blur-sm px-2.5 py-1 rounded-md text-[11px] font-medium text-slate-700 shadow border border-slate-200 pointer-events-none">
        📍 Haz clic o arrastra la chincheta para afinar
      </div>
    </div>
  );
}
