"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Coordinates, ServiceOrder } from "@/types/pelletGalicia";
import { getServiceTypeBadgeMeta } from "@/utils/satUiHelpers";

type RouteMapLayerKey = "dark" | "street" | "satellite" | "fallback";

interface TileProviderConfig {
  label: string;
  url: string;
  attribution: string;
  subdomains?: string[];
  maxZoom: number;
}

const ROUTE_TILE_PROVIDERS: Record<RouteMapLayerKey, TileProviderConfig> = {
  dark: {
    label: "Oscuro",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: ["a", "b", "c", "d"],
    maxZoom: 20,
  },
  street: {
    label: "Calle",
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: ["a", "b", "c", "d"],
    maxZoom: 20,
  },
  satellite: {
    label: "Satélite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    maxZoom: 19,
  },
  fallback: {
    label: "Esri Calle",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
    maxZoom: 19,
  },
};

export interface MapWarehouseLocation {
  name: string;
  address: string;
  coordinates: Coordinates;
}

interface DeliveryRouteMapProps {
  warehouse: MapWarehouseLocation;
  pendingOrders: ServiceOrder[];
  selectedOrders?: ServiceOrder[];
  onOrderClick?: (orderId: string) => void;
  osrmPolyline?: [number, number][];
  height?: string;
}

const createWarehouseIcon = () =>
  L.divIcon({
    className: "warehouse-map-pin",
    html: `
      <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
        <div style="
          background: #0f172a;
          color: #fbbf24;
          width: 38px;
          height: 38px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 12px rgba(0,0,0,0.45);
          border: 2px solid #fbbf24;
        ">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
          </svg>
        </div>
        <div style="
          background: #0f172a;
          color: #ffffff;
          font-weight: 800;
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 6px;
          margin-top: 2px;
          white-space: nowrap;
          border: 1px solid #334155;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        ">BASE / TALLER</div>
      </div>
    `,
    iconSize: [72, 60],
    iconAnchor: [36, 38],
    popupAnchor: [0, -38],
  });

const createServicePinIcon = (
  order: ServiceOrder,
  isSelected: boolean,
  sequence?: number
) => {
  const meta = getServiceTypeBadgeMeta(order.serviceType, order.priority);
  const bg = isSelected ? "#ea580c" : meta.mapPinHex;
  const durationLabel = `${order.estimatedMinutes || 45}m`;
  const prefix = order.priority === "Urgente" ? "🚨" : meta.emoji;

  return L.divIcon({
    className: "service-map-pin",
    html: `
      <div style="position: relative; display: flex; flex-direction: column; align-items: center; cursor: pointer;">
        <div style="
          background: ${bg};
          color: #ffffff;
          padding: 3px 8px;
          border-radius: 14px;
          font-size: 11px;
          font-weight: 800;
          box-shadow: 0 4px 12px rgba(0,0,0,0.4);
          border: 2px solid #ffffff;
          display: flex;
          align-items: center;
          gap: 4px;
          white-space: nowrap;
        ">
          ${
            sequence
              ? `<span style="background: #ffffff; color: ${bg}; font-size: 10px; border-radius: 50%; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; font-weight: 900;">${sequence}</span>`
              : `<span>${prefix}</span>`
          }
          <span>${durationLabel}</span>
        </div>
        <div style="
          width: 0;
          height: 0;
          border-left: 6px solid transparent;
          border-right: 6px solid transparent;
          border-top: 7px solid ${bg};
          margin-top: -1px;
        "></div>
      </div>
    `,
    iconSize: [70, 40],
    iconAnchor: [35, 26],
    popupAnchor: [0, -26],
  });
};

function AutoFitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 13);
      return;
    }
    const bounds = L.latLngBounds(points.map((p) => L.latLng(p[0], p[1])));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }, [points, map]);

  return null;
}

export default function DeliveryRouteMap({
  warehouse,
  pendingOrders,
  selectedOrders = [],
  onOrderClick,
  osrmPolyline,
  height = "400px",
}: DeliveryRouteMapProps) {
  const [activeLayer, setActiveLayer] = useState<RouteMapLayerKey>("dark");
  const [fallbackActive, setFallbackActive] = useState(false);
  const tileErrorCountRef = useRef(0);

  const handleSelectLayer = useCallback((layer: RouteMapLayerKey) => {
    tileErrorCountRef.current = 0;
    setFallbackActive(false);
    setActiveLayer(layer);
  }, []);

  const handleTileError = useCallback(() => {
    tileErrorCountRef.current += 1;
    if (tileErrorCountRef.current > 3 && activeLayer !== "fallback") {
      tileErrorCountRef.current = 0;
      setActiveLayer("fallback");
      setFallbackActive(true);
    }
  }, [activeLayer]);

  const currentProvider = ROUTE_TILE_PROVIDERS[activeLayer];

  const selectedOrderIds = useMemo(
    () => new Set(selectedOrders.map((o) => o.id)),
    [selectedOrders]
  );

  const allCoordinates: [number, number][] = useMemo(() => {
    const list: [number, number][] = [
      [warehouse.coordinates.lat, warehouse.coordinates.lng],
    ];
    pendingOrders.forEach((o) => {
      list.push([o.customer.coordinates.lat, o.customer.coordinates.lng]);
    });
    return list;
  }, [warehouse, pendingOrders]);

  const fallbackPolyline: [number, number][] = useMemo(() => {
    if (selectedOrders.length === 0) return [];
    const pts: [number, number][] = [
      [warehouse.coordinates.lat, warehouse.coordinates.lng],
    ];
    selectedOrders.forEach((ord) => {
      pts.push([ord.customer.coordinates.lat, ord.customer.coordinates.lng]);
    });
    pts.push([warehouse.coordinates.lat, warehouse.coordinates.lng]);
    return pts;
  }, [warehouse, selectedOrders]);

  const activePolyline =
    osrmPolyline && osrmPolyline.length > 0 ? osrmPolyline : fallbackPolyline;

  return (
    <div
      style={{ height }}
      className="w-full rounded-2xl overflow-hidden border border-white/[0.08] bg-slate-950 shadow-sm relative z-0"
    >
      {/* Selector de capas Dark Slate Glass */}
      <div className="absolute top-3 left-14 z-[450] flex items-center gap-1 bg-slate-900/80 backdrop-blur-md border border-white/[0.1] rounded-xl p-1 shadow-lg">
        {(["dark", "street", "satellite"] as const).map((key) => {
          const isSelected = activeLayer === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => handleSelectLayer(key)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                isSelected
                  ? "bg-amber-500 text-slate-950 shadow-sm"
                  : "text-slate-300 hover:text-white hover:bg-white/[0.06]"
              }`}
            >
              {ROUTE_TILE_PROVIDERS[key].label}
            </button>
          );
        })}
      </div>

      {fallbackActive && (
        <div className="absolute bottom-3 left-3 z-[450] bg-slate-900/85 backdrop-blur-md border border-amber-500/30 text-amber-300 text-[11px] font-medium px-2.5 py-1 rounded-lg shadow-md">
          Capa alternativa Esri activada automáticamente
        </div>
      )}

      <MapContainer
        center={[warehouse.coordinates.lat, warehouse.coordinates.lng]}
        zoom={11}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          key={activeLayer}
          attribution={currentProvider.attribution}
          url={currentProvider.url}
          {...(currentProvider.subdomains
            ? { subdomains: currentProvider.subdomains }
            : {})}
          maxZoom={currentProvider.maxZoom}
          eventHandlers={{
            tileerror: handleTileError,
          }}
        />

        <AutoFitBounds points={allCoordinates} />

        {/* Marcador de la Base / Taller Central */}
        <Marker
          position={[warehouse.coordinates.lat, warehouse.coordinates.lng]}
          icon={createWarehouseIcon()}
        >
          <Popup>
            <div className="text-xs p-1 font-sans">
              <span className="font-extrabold text-slate-900 block text-sm">
                🛠️ {warehouse.name}
              </span>
              <p className="text-slate-600 mt-0.5">{warehouse.address}</p>
              <div className="mt-2 text-[11px] font-semibold text-amber-700 bg-amber-50 p-1.5 rounded border border-amber-200">
                Punto de salida y retorno del técnico
              </div>
            </div>
          </Popup>
        </Marker>

        {/* Marcadores de Avisos (Averías, Revisiones, Instalaciones) */}
        {pendingOrders.map((order) => {
          const isSelected = selectedOrderIds.has(order.id);
          const sequenceIndex = isSelected
            ? selectedOrders.findIndex((o) => o.id === order.id) + 1
            : undefined;
          const notes = order.technicalNotes || order.customer.internalNotes || "";
          const equip = order.equipmentInfo || order.customer.equipmentInfo || "";
          const meta = getServiceTypeBadgeMeta(
            order.serviceType,
            order.priority
          );

          return (
            <Marker
              key={order.id}
              position={[
                order.customer.coordinates.lat,
                order.customer.coordinates.lng,
              ]}
              icon={createServicePinIcon(order, isSelected, sequenceIndex)}
              eventHandlers={{
                click: () => {
                  if (onOrderClick) onOrderClick(order.id);
                },
              }}
            >
              <Popup>
                <div className="text-xs p-1 font-sans space-y-1.5 min-w-[200px]">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1">
                    <span className="font-bold text-slate-900 text-sm">
                      {order.customer.name}
                    </span>
                    <span className="font-extrabold px-1.5 py-0.5 rounded text-[11px] bg-slate-900 text-amber-400">
                      ⏱️ {order.estimatedMinutes} min
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                      {meta.emoji} {meta.label}
                    </span>
                    {order.estimatedPriceEur && order.estimatedPriceEur > 0 ? (
                      <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                        💶 {order.estimatedPriceEur.toFixed(2)} €
                      </span>
                    ) : null}
                  </div>

                  <p className="text-slate-600 text-[11px]">
                    📍 {order.customer.village}
                  </p>
                  {equip && (
                    <p className="text-slate-800 text-[11px] font-semibold">
                      ⚙️ {equip}
                    </p>
                  )}
                  {order.customer.phone && (
                    <p className="text-slate-600 text-[11px] font-mono">
                      📞 {order.customer.phone}
                    </p>
                  )}
                  {notes && (
                    <div className="p-1.5 rounded bg-amber-50 border border-amber-200 text-amber-900 text-[10px]">
                      🧰 {notes}
                    </div>
                  )}
                  {onOrderClick && (
                    <button
                      type="button"
                      onClick={() => onOrderClick(order.id)}
                      className={`w-full mt-1 py-1.5 rounded text-center text-xs font-bold transition ${
                        isSelected
                          ? "bg-red-50 text-red-700 hover:bg-red-100"
                          : "bg-amber-600 text-white hover:bg-amber-700"
                      }`}
                    >
                      {isSelected ? "Quitar de este turno" : "Añadir a este turno"}
                    </button>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* Polilínea OSRM */}
        {activePolyline.length > 1 && (
          <Polyline
            positions={activePolyline}
            pathOptions={{
              color: "#ea580c",
              weight: 5,
              opacity: 0.9,
              lineCap: "round",
              lineJoin: "round",
            }}
          />
        )}
      </MapContainer>

      {/* Leyenda interactiva */}
      <div className="absolute top-3 right-3 z-[400] bg-slate-950/90 backdrop-blur-sm p-2.5 rounded-xl border border-slate-700 shadow-md text-[11px] text-slate-200 space-y-1 pointer-events-auto">
        <div className="font-bold text-white border-b border-slate-800 pb-1">
          Mapa SAT (OSRM)
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-slate-900 border border-amber-400"></span>
          <span>Base / Taller</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-rose-600"></span>
          <span>Avería Urgente</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-amber-600"></span>
          <span>Avería / Turno Activo</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-sky-600"></span>
          <span>Revisión</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-emerald-600"></span>
          <span>Instalación</span>
        </div>
      </div>
    </div>
  );
}
