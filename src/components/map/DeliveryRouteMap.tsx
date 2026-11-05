"use client";

import React, { useEffect, useMemo } from "react";
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
import { Order, WarehouseLocation } from "@/types/pellet";

interface DeliveryRouteMapProps {
  warehouse: WarehouseLocation;
  pendingOrders: Order[];
  selectedOrders?: Order[];
  onOrderClick?: (orderId: string) => void;
  osrmPolyline?: [number, number][]; // Polilínea real por carretera calculada con OSRM
  height?: string;
}

// Icono personalizado para el almacén / base central
const createWarehouseIcon = (name: string) =>
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
          box-shadow: 0 4px 12px rgba(0,0,0,0.4);
          border: 2px solid #fbbf24;
        ">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
            <polyline points="9 22 9 12 15 12 15 22"></polyline>
          </svg>
        </div>
        <div style="
          background: #0f172a;
          color: #ffffff;
          font-weight: 700;
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 6px;
          margin-top: 2px;
          white-space: nowrap;
          border: 1px solid #334155;
          box-shadow: 0 2px 6px rgba(0,0,0,0.25);
        ">BASE</div>
      </div>
    `,
    iconSize: [60, 60],
    iconAnchor: [30, 38],
    popupAnchor: [0, -38],
  });

// Icono para pedidos con badge numérico de Kg
const createOrderPinIcon = (
  kg: number,
  isSelected: boolean,
  sequence?: number
) => {
  const bg = isSelected ? "#ea580c" : "#0284c7"; // naranja si está en la ruta actual, azul si pendiente
  const badgeLabel =
    kg >= 1000 ? `${(kg / 1000).toFixed(1)}t` : `${Math.round(kg)}k`;

  return L.divIcon({
    className: "order-map-pin",
    html: `
      <div style="position: relative; display: flex; flex-direction: column; align-items: center; cursor: pointer;">
        <div style="
          background: ${bg};
          color: #ffffff;
          padding: 3px 8px;
          border-radius: 14px;
          font-size: 11px;
          font-weight: 800;
          box-shadow: 0 4px 12px rgba(0,0,0,0.35);
          border: 2px solid #ffffff;
          display: flex;
          align-items: center;
          gap: 4px;
          white-space: nowrap;
        ">
          ${
            sequence
              ? `<span style="background: #ffffff; color: ${bg}; font-size: 10px; border-radius: 50%; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; font-weight: 900;">${sequence}</span>`
              : ""
          }
          <span>${badgeLabel}</span>
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
    iconSize: [60, 40],
    iconAnchor: [30, 26],
    popupAnchor: [0, -26],
  });
};

function AutoFitBounds({
  points,
}: {
  points: [number, number][];
}) {
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
  height = "420px",
}: DeliveryRouteMapProps) {
  const selectedOrderIds = useMemo(
    () => new Set(selectedOrders.map((o) => o.id)),
    [selectedOrders]
  );

  // Puntos para ajustar automáticamente el encuadre del mapa
  const allCoordinates: [number, number][] = useMemo(() => {
    const list: [number, number][] = [
      [warehouse.coordinates.lat, warehouse.coordinates.lng],
    ];
    pendingOrders.forEach((o) => {
      list.push([o.client.coordinates.lat, o.client.coordinates.lng]);
    });
    return list;
  }, [warehouse, pendingOrders]);

  // Si no hay polilínea OSRM todavía, usamos una línea directa como fallback
  const fallbackPolyline: [number, number][] = useMemo(() => {
    if (selectedOrders.length === 0) return [];
    const pts: [number, number][] = [
      [warehouse.coordinates.lat, warehouse.coordinates.lng],
    ];
    selectedOrders.forEach((ord) => {
      pts.push([ord.client.coordinates.lat, ord.client.coordinates.lng]);
    });
    pts.push([warehouse.coordinates.lat, warehouse.coordinates.lng]);
    return pts;
  }, [warehouse, selectedOrders]);

  const activePolyline =
    osrmPolyline && osrmPolyline.length > 0 ? osrmPolyline : fallbackPolyline;

  return (
    <div
      style={{ height }}
      className="w-full rounded-2xl overflow-hidden border border-slate-200 shadow-sm relative z-0"
    >
      <MapContainer
        center={[warehouse.coordinates.lat, warehouse.coordinates.lng]}
        zoom={11}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <AutoFitBounds points={allCoordinates} />

        {/* Marcador del Almacén Central / Base */}
        <Marker
          position={[warehouse.coordinates.lat, warehouse.coordinates.lng]}
          icon={createWarehouseIcon(warehouse.name)}
        >
          <Popup>
            <div className="text-xs p-1 font-sans">
              <span className="font-extrabold text-slate-900 block text-sm">
                🏭 {warehouse.name}
              </span>
              <p className="text-slate-600 mt-0.5">{warehouse.address}</p>
              <div className="mt-2 text-[11px] font-semibold text-amber-700 bg-amber-50 p-1.5 rounded border border-amber-200">
                Punto central de carga de pellets y retorno de rutas
              </div>
            </div>
          </Popup>
        </Marker>

        {/* Marcadores de Pedidos Pendientes con Badges de Kg */}
        {pendingOrders.map((order) => {
          const isSelected = selectedOrderIds.has(order.id);
          const sequenceIndex = isSelected
            ? selectedOrders.findIndex((o) => o.id === order.id) + 1
            : undefined;

          return (
            <Marker
              key={order.id}
              position={[order.client.coordinates.lat, order.client.coordinates.lng]}
              icon={createOrderPinIcon(
                order.totalWeightKg,
                isSelected,
                sequenceIndex
              )}
              eventHandlers={{
                click: () => {
                  if (onOrderClick) onOrderClick(order.id);
                },
              }}
            >
              <Popup>
                <div className="text-xs p-1 font-sans space-y-1.5">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1">
                    <span className="font-bold text-slate-900 text-sm">
                      {order.client.name}
                    </span>
                    <span className="font-extrabold px-1.5 py-0.5 rounded text-[11px] bg-slate-900 text-amber-400">
                      {order.totalWeightKg.toLocaleString("es-ES")} kg
                    </span>
                  </div>
                  <p className="text-slate-600 text-[11px]">
                    📍 {order.client.address}
                  </p>
                  <p className="text-slate-600 text-[11px]">
                    📦 {order.pallets} palés ({order.pallets * 1050} kg) +{" "}
                    {order.looseSacks} sacos ({order.looseSacks * 15} kg)
                  </p>
                  <div className="text-[11px] text-sky-700 font-medium">
                    Horario: {order.client.preferredTimeWindow}
                  </div>
                  {order.client.unloadingNotes && (
                    <div className="p-1 rounded bg-amber-50 border border-amber-200 text-amber-900 text-[10px]">
                      ⚠️ {order.client.unloadingNotes}
                    </div>
                  )}
                  {onOrderClick && (
                    <button
                      type="button"
                      onClick={() => onOrderClick(order.id)}
                      className={`w-full mt-1 py-1 rounded text-center text-xs font-bold transition ${
                        isSelected
                          ? "bg-red-50 text-red-700 hover:bg-red-100"
                          : "bg-amber-600 text-white hover:bg-amber-700"
                      }`}
                    >
                      {isSelected ? "Quitar de este viaje" : "Añadir a este viaje"}
                    </button>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* Polilínea trazada por carretera real con OSRM */}
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

      {/* Leyenda interactiva sobre el mapa */}
      <div className="absolute top-3 right-3 z-[400] bg-white/95 backdrop-blur-sm p-2.5 rounded-xl border border-slate-200 shadow-md text-[11px] space-y-1.5 pointer-events-auto">
        <div className="font-bold text-slate-800 border-b border-slate-100 pb-1">
          Ruta por Carretera (OSRM)
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-slate-900 border border-amber-400"></span>
          <span>Almacén Base</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-sky-600"></span>
          <span>Pedido Pendiente (Kg)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-orange-600"></span>
          <span>Parada Viaje Activo</span>
        </div>
      </div>
    </div>
  );
}
