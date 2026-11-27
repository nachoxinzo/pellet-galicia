"use client";

import React, { useMemo } from "react";
import { Customer, ServiceOrder } from "@/types/pelletGalicia";
import {
  formatHoursMinutes,
  getServiceTypeBadgeMeta,
} from "@/utils/satUiHelpers";
import { buildGoogleMapsSingleClientUrl } from "@/utils/galiciaUrlCodec";
import {
  X,
  History,
  MapPin,
  Phone,
  Wrench,
  Clock,
  Banknote,
  Calendar,
  ExternalLink,
  Plus,
  Pencil,
  CheckCircle2,
  UserCheck,
  MessageCircle,
} from "lucide-react";

interface CustomerHistoryModalProps {
  customer: Customer | null;
  orders: ServiceOrder[];
  onClose: () => void;
  onCreateNewOrder: (customer: Customer) => void;
  onEditCustomer: (customer: Customer) => void;
}

export default function CustomerHistoryModal({
  customer,
  orders,
  onClose,
  onCreateNewOrder,
  onEditCustomer,
}: CustomerHistoryModalProps) {
  const customerOrders = useMemo(() => {
    if (!customer) return [];
    return orders
      .filter((o) => o.customerId === customer.id)
      .sort(
        (a, b) =>
          new Date(b.completedAt || b.createdAt).getTime() -
          new Date(a.completedAt || a.createdAt).getTime()
      );
  }, [customer, orders]);

  const metrics = useMemo(() => {
    const completed = customerOrders.filter((o) => o.status === "Completado");
    const active = customerOrders.filter(
      (o) => o.status === "Pendiente" || o.status === "En Ruta"
    );
    const totalBilledEur = completed.reduce(
      (sum, o) => sum + (o.collectedPriceEur ?? o.estimatedPriceEur ?? 0),
      0
    );
    const avgMinutes =
      completed.length > 0
        ? Math.round(
            completed.reduce(
              (sum, o) => sum + (o.actualMinutes ?? o.estimatedMinutes ?? 45),
              0
            ) / completed.length
          )
        : customer?.lastInterventionMinutes ?? 45;

    const lastDateIso =
      completed[0]?.completedAt ||
      customerOrders[0]?.createdAt ||
      customer?.lastServiceDate;

    return {
      totalCount: customerOrders.length,
      completedCount: completed.length,
      activeCount: active.length,
      totalBilledEur,
      avgMinutes,
      lastDateLabel: lastDateIso
        ? new Date(lastDateIso).toLocaleDateString("es-ES")
        : "Sin visitas",
    };
  }, [customerOrders, customer]);

  if (!customer) return null;

  const googleMapsUrl = buildGoogleMapsSingleClientUrl(customer.coordinates);
  const phoneDigits = (customer.phone || "").replace(/\D/g, "");
  const waPhone =
    phoneDigits.length === 9 ? `34${phoneDigits}` : phoneDigits;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-3 sm:p-5">
      <div className="bg-slate-900 border border-white/[0.1] rounded-3xl max-w-2xl w-full max-h-[90vh] flex flex-col text-slate-100 shadow-2xl overflow-hidden">
        {/* CABECERA */}
        <div className="p-5 sm:p-6 border-b border-white/[0.08] flex items-start justify-between gap-3 bg-slate-950/50">
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-400">
              <History className="w-4 h-4" />
              <span>Historial Completo del Cliente</span>
            </div>
            <h2 className="text-xl font-black text-white truncate">
              {customer.name}
            </h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-300">
              <a
                href={googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:text-amber-300 transition"
              >
                <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>{customer.village}</span>
                <ExternalLink className="w-3 h-3 text-slate-500" />
              </a>
              {customer.phone && (
                <div className="inline-flex items-center gap-2">
                  <a
                    href={`tel:${customer.phone}`}
                    className="inline-flex items-center gap-1 text-sky-300 hover:text-sky-200 font-semibold"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>{customer.phone}</span>
                  </a>
                  {waPhone && (
                    <a
                      href={`https://wa.me/${waPhone}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold"
                    >
                      <MessageCircle className="w-3 h-3" />
                      <span>WhatsApp</span>
                    </a>
                  )}
                </div>
              )}
            </div>
            {(customer.equipmentInfo || customer.internalNotes) && (
              <div className="pt-1 flex flex-wrap gap-2 text-xs">
                {customer.equipmentInfo && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/25 font-medium">
                    <Wrench className="w-3 h-3" />
                    {customer.equipmentInfo}
                  </span>
                )}
                {customer.internalNotes && (
                  <span className="px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-white/[0.06]">
                    Acceso: {customer.internalNotes}
                  </span>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition shrink-0"
            aria-label="Cerrar historial"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 4 MINI KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-4 sm:px-6 border-b border-white/[0.06] bg-slate-950/30 text-xs">
          <div className="p-2.5 rounded-xl bg-slate-950/60 border border-white/[0.06]">
            <span className="text-slate-400 block text-[11px]">
              Total partes
            </span>
            <strong className="text-white font-mono text-sm">
              {metrics.totalCount}{" "}
              <span className="text-[11px] font-normal text-slate-400">
                ({metrics.activeCount} act.)
              </span>
            </strong>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950/60 border border-white/[0.06]">
            <span className="text-slate-400 block text-[11px]">
              Total facturado
            </span>
            <strong className="text-emerald-400 font-mono text-sm">
              {metrics.totalBilledEur.toFixed(2)} €
            </strong>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950/60 border border-white/[0.06]">
            <span className="text-slate-400 block text-[11px]">
              Duración media
            </span>
            <strong className="text-amber-400 font-mono text-sm">
              {formatHoursMinutes(metrics.avgMinutes)}
            </strong>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950/60 border border-white/[0.06]">
            <span className="text-slate-400 block text-[11px]">
              Última actividad
            </span>
            <strong className="text-slate-200 font-mono text-sm">
              {metrics.lastDateLabel}
            </strong>
          </div>
        </div>

        {/* CRONOLOGÍA */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
          {customerOrders.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 border border-dashed border-white/[0.08] rounded-2xl">
              Este cliente aún no tiene partes registrados en el historial de la nube.
            </div>
          ) : (
            customerOrders.map((ord) => {
              const meta = getServiceTypeBadgeMeta(
                ord.serviceType,
                ord.priority
              );
              const isDone = ord.status === "Completado";
              const mins = ord.actualMinutes ?? ord.estimatedMinutes;
              const price =
                ord.collectedPriceEur !== undefined
                  ? ord.collectedPriceEur
                  : ord.estimatedPriceEur || 0;

              return (
                <div
                  key={ord.id}
                  className={`p-4 rounded-2xl border space-y-2.5 text-xs ${
                    isDone
                      ? "bg-slate-950/45 border-white/[0.07]"
                      : "bg-slate-950/80 border-amber-500/35"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${meta.badgeClass}`}
                      >
                        {meta.label}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          isDone
                            ? "bg-emerald-500/15 text-emerald-300"
                            : ord.status === "En Ruta"
                            ? "bg-sky-500/15 text-sky-300"
                            : "bg-amber-500/15 text-amber-300"
                        }`}
                      >
                        {ord.status}
                      </span>
                      {ord.scheduledDate && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[11px]">
                          <Calendar className="w-3 h-3 text-amber-400" />
                          {new Date(
                            ord.scheduledDate + "T12:00:00"
                          ).toLocaleDateString("es-ES")}
                          {ord.timeSlot && ord.timeSlot !== "Indiferente"
                            ? ` · ${ord.timeSlot}`
                            : ""}
                        </span>
                      )}
                    </div>

                    <span className="text-[11px] text-slate-400 font-mono">
                      {isDone && ord.completedAt
                        ? `Cerrado: ${new Date(ord.completedAt).toLocaleString(
                            "es-ES",
                            {
                              dateStyle: "short",
                              timeStyle: "short",
                            }
                          )}`
                        : `Creado: ${new Date(ord.createdAt).toLocaleDateString(
                            "es-ES"
                          )}`}
                    </span>
                  </div>

                  {ord.equipmentInfo && (
                    <div className="text-slate-200 font-semibold flex items-center gap-1.5">
                      <Wrench className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span>{ord.equipmentInfo}</span>
                    </div>
                  )}

                  {ord.technicalNotes && (
                    <p className="text-slate-400 italic">
                      Nota aviso: “{ord.technicalNotes}”
                    </p>
                  )}

                  {ord.resolutionNote && (
                    <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-200 flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span>
                        <strong>Trabajo realizado:</strong> {ord.resolutionNote}
                      </span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-slate-300">
                    <span className="inline-flex items-center gap-1 font-mono text-amber-300">
                      <Clock className="w-3.5 h-3.5" />
                      {mins} min {ord.actualMinutes ? "(real)" : "(est.)"}
                    </span>
                    <span className="inline-flex items-center gap-1 font-mono text-emerald-300">
                      <Banknote className="w-3.5 h-3.5" />
                      {price.toFixed(2)} €{" "}
                      {ord.collectedPriceEur !== undefined
                        ? "(cobrado)"
                        : "(presup.)"}
                    </span>
                    {ord.assignedTechName && (
                      <span className="inline-flex items-center gap-1 text-slate-300">
                        <UserCheck className="w-3.5 h-3.5 text-sky-400" />
                        {ord.assignedTechName}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* PIE CON ACCIONES RÁPIDAS */}
        <div className="p-4 sm:p-5 border-t border-white/[0.08] bg-slate-950/60 flex flex-wrap items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={() => {
              onEditCustomer(customer);
              onClose();
            }}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-white/[0.08] flex items-center gap-1.5 transition"
          >
            <Pencil className="w-3.5 h-3.5" />
            <span>Editar GPS / Ficha</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onCreateNewOrder(customer);
              onClose();
            }}
            className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black flex items-center gap-1.5 transition shadow-lg shadow-amber-500/20"
          >
            <Plus className="w-4 h-4" />
            <span>Nuevo aviso para {customer.name}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
