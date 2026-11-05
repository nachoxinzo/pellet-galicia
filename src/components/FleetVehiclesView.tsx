"use client";

import React, { useState } from "react";
import { Vehicle, PELLET_RULES } from "@/types/pellet";
import {
  Truck,
  Plus,
  Scale,
  Layers,
  CheckCircle,
  XCircle,
  Trash2,
  Edit3,
  ShieldCheck,
  Info,
} from "lucide-react";

interface FleetVehiclesViewProps {
  vehicles: Vehicle[];
  onSaveVehicle: (
    data: Omit<Vehicle, "id" | "createdAt" | "updatedAt"> & { id?: string }
  ) => void;
  onDeleteVehicle: (id: string) => void;
  onToggleAvailability: (id: string) => void;
}

export default function FleetVehiclesView({
  vehicles,
  onSaveVehicle,
  onDeleteVehicle,
  onToggleAvailability,
}: FleetVehiclesViewProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [name, setName] = useState("");
  const [licensePlate, setLicensePlate] = useState("");
  const [maxWeightKg, setMaxWeightKg] = useState<number>(3500);
  const [maxPallets, setMaxPallets] = useState<number>(3);
  const [hasTailLift, setHasTailLift] = useState<boolean>(true);
  const [notes, setNotes] = useState("");

  const resetForm = () => {
    setEditingId(undefined);
    setName("");
    setLicensePlate("");
    setMaxWeightKg(3500);
    setMaxPallets(3);
    setHasTailLift(true);
    setNotes("");
    setShowForm(false);
  };

  const handleEdit = (v: Vehicle) => {
    setEditingId(v.id);
    setName(v.name);
    setLicensePlate(v.licensePlate || "");
    setMaxWeightKg(v.maxWeightKg);
    setMaxPallets(v.maxPallets);
    setHasTailLift(Boolean(v.hasTailLift));
    setNotes(v.notes || "");
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSaveVehicle({
      id: editingId,
      name,
      licensePlate,
      maxWeightKg,
      maxPallets,
      hasTailLift,
      isAvailable: true,
      notes,
    });
    resetForm();
  };

  const activeVehicles = vehicles.filter((v) => v.isAvailable);
  const totalFleetCapacityKg = activeVehicles.reduce(
    (acc, v) => acc + v.maxWeightKg,
    0
  );
  const totalFleetPallets = activeVehicles.reduce(
    (acc, v) => acc + v.maxPallets,
    0
  );

  return (
    <div className="space-y-6">
      {/* Resumen de Capacidad Operativa */}
      <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
            Capacidad de Flota Activa
          </span>
          <h2 className="text-xl font-bold mt-1">
            {activeVehicles.length} de {vehicles.length} vehículos operativos
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Capacidad combinada por viaje:{" "}
            <strong className="text-white">
              {totalFleetCapacityKg.toLocaleString("es-ES")} kg
            </strong>{" "}
            y{" "}
            <strong className="text-white">
              {totalFleetPallets} posiciones de palé
            </strong>
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            if (showForm) resetForm();
            else setShowForm(true);
          }}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold transition shrink-0"
        >
          <Plus className="w-4 h-4" />
          {showForm ? "Cerrar Formulario" : "Añadir Vehículo"}
        </button>
      </div>

      {/* Formulario Desplegable para Añadir/Editar Vehículo */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-white p-6 rounded-2xl border border-amber-200 shadow-lg space-y-5"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Truck className="w-5 h-5 text-amber-600" />
              {editingId ? "Editar Vehículo" : "Configurar Nuevo Vehículo"}
            </h3>
            <span className="text-xs text-slate-500">
              1 palé completo pesa{" "}
              {PELLET_RULES.PALLET_WEIGHT_KG.toLocaleString("es-ES")} kg
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nombre del Camión / Furgón *
              </label>
              <input
                type="text"
                required
                placeholder="Ej. Camión Iveco Daily 3.5T Plataforma"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none text-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Matrícula (Opcional)
              </label>
              <input
                type="text"
                placeholder="Ej. 4821 MJK"
                value={licensePlate}
                onChange={(e) => setLicensePlate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none text-slate-900 font-mono uppercase"
              />
            </div>

            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2.5 cursor-pointer select-none text-sm font-medium text-slate-800">
                <input
                  type="checkbox"
                  checked={hasTailLift}
                  onChange={(e) => setHasTailLift(e.target.checked)}
                  className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500"
                />
                Tiene plataforma / transpaleta
              </label>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Carga Máxima Útil (kg) *
              </label>
              <input
                type="number"
                min={100}
                step={50}
                required
                value={maxWeightKg}
                onChange={(e) =>
                  setMaxWeightKg(Math.max(100, parseInt(e.target.value, 10) || 0))
                }
                className="w-full px-3 py-2 text-sm font-bold border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none text-slate-900"
              />
              <span className="text-[11px] text-slate-500 mt-1 block">
                Soporta hasta{" "}
                {Math.floor(maxWeightKg / PELLET_RULES.PALLET_WEIGHT_KG)} palés
                por peso
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Capacidad Máxima de Palés *
              </label>
              <input
                type="number"
                min={1}
                max={33}
                required
                value={maxPallets}
                onChange={(e) =>
                  setMaxPallets(Math.max(1, parseInt(e.target.value, 10) || 1))
                }
                className="w-full px-3 py-2 text-sm font-bold border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none text-slate-900"
              />
              <span className="text-[11px] text-slate-500 mt-1 block">
                {maxPallets} palés llenos ={" "}
                {(maxPallets * PELLET_RULES.PALLET_WEIGHT_KG).toLocaleString(
                  "es-ES"
                )}{" "}
                kg
              </span>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Notas Operativas del Vehículo
              </label>
              <input
                type="text"
                placeholder="Ej. Ideal para urbanizaciones estrechas, incluye transpaleta eléctrica..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none text-slate-900"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold"
            >
              {editingId ? "Actualizar Vehículo" : "Guardar Vehículo"}
            </button>
          </div>
        </form>
      )}

      {/* Grid de Tarjetas de Vehículos */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {vehicles.map((vehicle) => {
          const weightOfMaxPallets =
            vehicle.maxPallets * PELLET_RULES.PALLET_WEIGHT_KG;
          const isWeightLimiting = weightOfMaxPallets > vehicle.maxWeightKg;

          return (
            <div
              key={vehicle.id}
              className={`bg-white rounded-2xl border p-5 shadow-sm transition-all flex flex-col justify-between gap-4 ${
                vehicle.isAvailable
                  ? "border-slate-200 hover:border-amber-300"
                  : "border-slate-200 opacity-65 bg-slate-50"
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div
                      className={`p-3 rounded-xl ${
                        vehicle.isAvailable
                          ? "bg-amber-50 text-amber-600"
                          : "bg-slate-200 text-slate-500"
                      }`}
                    >
                      <Truck className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        {vehicle.licensePlate && (
                          <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-slate-900 text-white">
                            {vehicle.licensePlate}
                          </span>
                        )}
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            vehicle.isAvailable
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {vehicle.isAvailable ? "Operativo" : "En Taller / Baja"}
                        </span>
                      </div>
                      <h3 className="text-base font-bold text-slate-900 mt-1">
                        {vehicle.name}
                      </h3>
                    </div>
                  </div>
                </div>

                {/* Especificaciones de Carga */}
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <Scale className="w-3.5 h-3.5 text-amber-600" />
                      Carga Máxima
                    </div>
                    <div className="text-lg font-extrabold text-slate-900 mt-0.5">
                      {vehicle.maxWeightKg.toLocaleString("es-ES")} kg
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <Layers className="w-3.5 h-3.5 text-amber-600" />
                      Capacidad Palés
                    </div>
                    <div className="text-lg font-extrabold text-slate-900 mt-0.5">
                      {vehicle.maxPallets}{" "}
                      {vehicle.maxPallets === 1 ? "palé" : "palés"}
                    </div>
                  </div>
                </div>

                {/* Indicador de equipamiento y avisos de tonelaje */}
                <div className="mt-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <ShieldCheck
                      className={`w-4 h-4 ${
                        vehicle.hasTailLift
                          ? "text-emerald-600"
                          : "text-slate-400"
                      }`}
                    />
                    <span>
                      {vehicle.hasTailLift
                        ? "Con plataforma elevadora y transpaleta"
                        : "Sin plataforma elevadora (descarga manual / sacos)"}
                    </span>
                  </div>

                  {isWeightLimiting && (
                    <div className="flex items-start gap-1.5 text-[11px] text-amber-800 bg-amber-50/90 border border-amber-200 px-2.5 py-1.5 rounded-lg">
                      <Info className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                      <span>
                        Nota: {vehicle.maxPallets} palés completos pesan{" "}
                        {weightOfMaxPallets.toLocaleString("es-ES")} kg (supera
                        en{" "}
                        {(
                          weightOfMaxPallets - vehicle.maxWeightKg
                        ).toLocaleString("es-ES")}{" "}
                        kg la MMA útil).
                      </span>
                    </div>
                  )}

                  {vehicle.notes && (
                    <p className="text-xs text-slate-500 italic bg-slate-50 p-2 rounded-lg">
                      “{vehicle.notes}”
                    </p>
                  )}
                </div>
              </div>

              {/* Acciones */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => onToggleAvailability(vehicle.id)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition"
                >
                  {vehicle.isAvailable ? (
                    <>
                      <XCircle className="w-4 h-4 text-slate-400" />
                      Marcar No Disponible
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4 text-emerald-600" />
                      Reactivar Vehículo
                    </>
                  )}
                </button>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleEdit(vehicle)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-amber-700 hover:bg-amber-50 transition"
                    title="Editar vehículo"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteVehicle(vehicle.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                    title="Eliminar vehículo"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
