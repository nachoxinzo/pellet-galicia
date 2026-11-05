"use client";

import React, { useState, useMemo } from "react";
import { Order, TimeWindow } from "@/types/pellet";
import {
  Plus,
  Search,
  Layers,
  Package,
  Scale,
  MapPin,
  Phone,
  Clock,
  Edit3,
  Trash2,
  AlertCircle,
  Filter,
  CheckCircle2,
  Navigation,
} from "lucide-react";

interface PendingOrdersViewProps {
  orders: Order[];
  onCreateOrder: () => void;
  onEditOrder: (order: Order) => void;
  onDeleteOrder: (orderId: string) => void;
  onChangeStatus: (orderId: string, status: Order["status"]) => void;
}

export default function PendingOrdersView({
  orders,
  onCreateOrder,
  onEditOrder,
  onDeleteOrder,
  onChangeStatus,
}: PendingOrdersViewProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [windowFilter, setWindowFilter] = useState<TimeWindow | "Todas">(
    "Todas"
  );
  const [statusFilter, setStatusFilter] = useState<string>("Pendiente");

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const matchesSearch =
        order.client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.client.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.client.phone.includes(searchTerm) ||
        order.id.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesWindow =
        windowFilter === "Todas" ||
        order.client.preferredTimeWindow === windowFilter;

      const matchesStatus =
        statusFilter === "Todos" || order.status === statusFilter;

      return matchesSearch && matchesWindow && matchesStatus;
    });
  }, [orders, searchTerm, windowFilter, statusFilter]);

  const summary = useMemo(() => {
    const activeOrders = orders.filter((o) => o.status === "Pendiente");
    return activeOrders.reduce(
      (acc, o) => {
        acc.totalOrders += 1;
        acc.totalWeightKg += o.totalWeightKg;
        acc.totalPallets += o.pallets;
        acc.totalLooseSacks += o.looseSacks;
        acc.equivalentPallets += o.equivalentPallets;
        return acc;
      },
      {
        totalOrders: 0,
        totalWeightKg: 0,
        totalPallets: 0,
        totalLooseSacks: 0,
        equivalentPallets: 0,
      }
    );
  }, [orders]);

  const getTimeWindowBadge = (tw: TimeWindow) => {
    switch (tw) {
      case "Mañana":
        return "bg-sky-50 text-sky-700 border-sky-200";
      case "Tarde":
        return "bg-indigo-50 text-indigo-700 border-indigo-200";
      default:
        return "bg-slate-100 text-slate-700 border-slate-200";
    }
  };

  const getStatusBadge = (status: Order["status"]) => {
    switch (status) {
      case "Pendiente":
        return "bg-amber-50 text-amber-800 border-amber-200";
      case "Planificado":
        return "bg-blue-50 text-blue-700 border-blue-200";
      case "En Ruta":
        return "bg-purple-50 text-purple-700 border-purple-200";
      case "Entregado":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      default:
        return "bg-red-50 text-red-700 border-red-200";
    }
  };

  return (
    <div className="space-y-6">
      {/* KPIs superiores de carga pendiente */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Pedidos Pendientes
            </p>
            <p className="text-3xl font-extrabold text-slate-900 mt-1">
              {summary.totalOrders}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Listos para asignar ruta
            </p>
          </div>
          <div className="p-3.5 rounded-2xl bg-amber-50 text-amber-600">
            <Clock className="w-7 h-7" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Tonelaje Pendiente
            </p>
            <p className="text-3xl font-extrabold text-amber-600 mt-1">
              {summary.totalWeightKg.toLocaleString("es-ES")}{" "}
              <span className="text-lg font-bold">kg</span>
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {(summary.totalWeightKg / 1000).toFixed(2)} toneladas totales
            </p>
          </div>
          <div className="p-3.5 rounded-2xl bg-slate-900 text-amber-400">
            <Scale className="w-7 h-7" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Palés Completos
            </p>
            <p className="text-3xl font-extrabold text-slate-900 mt-1">
              {summary.totalPallets}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              ~{summary.equivalentPallets.toFixed(1)} palés eq. con sueltos
            </p>
          </div>
          <div className="p-3.5 rounded-2xl bg-orange-50 text-orange-600">
            <Layers className="w-7 h-7" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Sacos Sueltos
            </p>
            <p className="text-3xl font-extrabold text-slate-900 mt-1">
              {summary.totalLooseSacks}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {(summary.totalLooseSacks * 15).toLocaleString("es-ES")} kg en
              sacos de 15 kg
            </p>
          </div>
          <div className="p-3.5 rounded-2xl bg-emerald-50 text-emerald-600">
            <Package className="w-7 h-7" />
          </div>
        </div>
      </div>

      {/* Barra de Herramientas y Filtros */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              placeholder="Buscar por cliente, dirección, teléfono o ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none text-slate-800"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400 hidden sm:block" />
            <select
              value={windowFilter}
              onChange={(e) =>
                setWindowFilter(e.target.value as TimeWindow | "Todas")
              }
              className="px-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 text-slate-700 font-medium outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="Todas">Horario: Todos</option>
              <option value="Mañana">🌅 Mañana</option>
              <option value="Tarde">🌇 Tarde</option>
              <option value="Indiferente">🕒 Indiferente</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 text-slate-700 font-medium outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="Pendiente">Estado: Pendientes</option>
              <option value="Planificado">Estado: Planificados</option>
              <option value="Entregado">Estado: Entregados</option>
              <option value="Todos">Ver Todos</option>
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={onCreateOrder}
          className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold shadow-md shadow-amber-600/20 transition shrink-0"
        >
          <Plus className="w-4 h-4" />
          Nuevo Pedido
        </button>
      </div>

      {/* Listado de Pedidos */}
      {filteredOrders.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-3">
            <Package className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-800">
            No se encontraron pedidos con estos filtros
          </h3>
          <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
            Crea un nuevo pedido de pellets o cambia los criterios de búsqueda
            para ver todos los registros.
          </p>
          <button
            type="button"
            onClick={onCreateOrder}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition"
          >
            <Plus className="w-4 h-4" />
            Añadir Primer Pedido
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {filteredOrders.map((order) => (
            <div
              key={order.id}
              className="bg-white rounded-2xl border border-slate-200 hover:border-amber-300 shadow-sm hover:shadow-md transition-all p-5 flex flex-col justify-between gap-4"
            >
              {/* Parte superior: Cliente, Estado, Horario y Peso */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-mono font-bold text-slate-400">
                      #{order.id}
                    </span>
                    <span
                      className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${getStatusBadge(
                        order.status
                      )}`}
                    >
                      {order.status}
                    </span>
                    <span
                      className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${getTimeWindowBadge(
                        order.client.preferredTimeWindow
                      )}`}
                    >
                      ⏱ {order.client.preferredTimeWindow}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-slate-900">
                    {order.client.name}
                  </h3>
                  <div className="flex items-center gap-3 text-xs text-slate-600">
                    <span className="flex items-center gap-1 font-medium">
                      <Phone className="w-3.5 h-3.5 text-slate-400" />
                      {order.client.phone}
                    </span>
                    <span className="flex items-center gap-1 font-mono text-slate-400">
                      <Navigation className="w-3 h-3" />
                      {order.client.coordinates.lat.toFixed(4)},{" "}
                      {order.client.coordinates.lng.toFixed(4)}
                    </span>
                  </div>
                </div>

                {/* Bloque de Peso y Desglose de Carga */}
                <div className="bg-slate-900 text-white px-4 py-2.5 rounded-xl flex sm:flex-col items-center sm:items-end justify-between shrink-0">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400">
                    Peso Total
                  </div>
                  <div className="text-xl font-extrabold text-amber-400">
                    {order.totalWeightKg.toLocaleString("es-ES")} kg
                  </div>
                  <div className="text-[11px] text-slate-300">
                    {order.totalSacksCount} sacos totales
                  </div>
                </div>
              </div>

              {/* Dirección y Notas de Descarga */}
              <div className="space-y-2.5 pt-2 border-t border-slate-100">
                <div className="flex items-start gap-2 text-sm text-slate-700">
                  <MapPin className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>{order.client.address}</span>
                </div>

                {order.client.unloadingNotes && (
                  <div className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-50/80 border border-amber-200/70 text-xs text-amber-950">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Notas de descarga: </span>
                      {order.client.unloadingNotes}
                    </div>
                  </div>
                )}
              </div>

              {/* Pie de tarjeta: Composición (Palés + Sacos) y Botones */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-800 text-xs font-semibold">
                    <Layers className="w-3.5 h-3.5 text-amber-600" />
                    <span>
                      {order.pallets} {order.pallets === 1 ? "Palé" : "Palés"}
                    </span>
                    <span className="text-slate-400">
                      ({(order.pallets * 1050).toLocaleString("es-ES")} kg)
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-800 text-xs font-semibold">
                    <Package className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{order.looseSacks} Sacos sueltos</span>
                    <span className="text-slate-400">
                      ({(order.looseSacks * 15).toLocaleString("es-ES")} kg)
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {order.status !== "Entregado" && (
                    <button
                      type="button"
                      onClick={() => onChangeStatus(order.id, "Entregado")}
                      title="Marcar como Entregado"
                      className="p-2 rounded-lg text-emerald-600 hover:bg-emerald-50 border border-transparent hover:border-emerald-200 transition"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onEditOrder(order)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 hover:text-amber-700 bg-slate-50 hover:bg-amber-50 border border-slate-200 hover:border-amber-200 transition"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteOrder(order.id)}
                    title="Eliminar pedido"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
