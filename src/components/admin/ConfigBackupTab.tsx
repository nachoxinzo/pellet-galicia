"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  AuditLogEntry,
  Customer,
  ServiceOrder,
  StorageQuotaStats,
  TechnicianConfig,
  UserProfile,
  UserRole,
} from "@/types/pelletGalicia";
import {
  Settings,
  Save,
  Shield,
  FileJson,
  Satellite,
  Check,
  Key,
  Search,
  Loader2,
  Fuel,
  Clock,
  HardDrive,
  Users,
  UserPlus,
  Ban,
  CheckCircle2,
  History,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import GaliciaBackupModal from "@/components/admin/GaliciaBackupModal";
import { cloudApi, CloudApiError } from "@/services/cloudApi";
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
      <div className="h-[280px] w-full bg-slate-950 rounded-2xl flex items-center justify-center text-slate-500 text-xs border border-white/[0.08] animate-pulse">
        Cargando mapa satélite de la Base / Taller...
      </div>
    ),
  }
);

interface ConfigBackupTabProps {
  config: TechnicianConfig;
  customers: Customer[];
  orders: ServiceOrder[];
  storageStats: StorageQuotaStats | null;
  users: UserProfile[];
  currentProfile: UserProfile | null;
  canManageAuthUsers: boolean;
  onSaveConfig: (
    updated: Partial<TechnicianConfig> & { clearGoogleMapsApiKey?: boolean }
  ) => Promise<void> | void;
  onRefreshAll: () => Promise<void> | void;
  onShowToast?: (text: string, type?: "success" | "error") => void;
}

export default function ConfigBackupTab({
  config,
  customers,
  orders,
  storageStats,
  users,
  currentProfile,
  canManageAuthUsers,
  onSaveConfig,
  onRefreshAll,
  onShowToast,
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
  const [googleMapsApiKey, setGoogleMapsApiKey] = useState("");
  const [lat, setLat] = useState(config.warehouseCoordinates.lat.toFixed(6));
  const [lng, setLng] = useState(config.warehouseCoordinates.lng.toFixed(6));
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isBackupOpen, setIsBackupOpen] = useState(false);

  // Buscador para la Base / Taller
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GoogleSearchResultItem[]>(
    []
  );
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Gestión de cuota y purga
  const [isPruning, setIsPruning] = useState(false);

  // Gestión de usuarios (3 admins / 2 técnicos)
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<UserRole>("tecnico");
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  // Visor de auditoría
  const [showAuditLogs, setShowAuditLogs] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);

  useEffect(() => {
    setMaxWorkdayMinutes(config.maxWorkdayMinutes);
    setMaxStopsPerRoute(config.maxStopsPerRoute);
    setWorkdayStartTime(config.workdayStartTime || "08:30");
    setConsumoL100(config.consumoL100 ?? 7.5);
    setPrecioCombustible(config.precioCombustible ?? 1.55);
    setHourlyCostEur(config.hourlyCostEur ?? 0);
    setWarehouseName(config.warehouseName);
    setWarehouseVillage(config.warehouseVillage);
    setLat(config.warehouseCoordinates.lat.toFixed(6));
    setLng(config.warehouseCoordinates.lng.toFixed(6));
  }, [config]);

  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchGoogleMapsLive(searchQuery);
        setSearchResults(res);
        setShowDropdown(true);
      } catch (err) {
        console.error("Error buscando ubicación del taller:", err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSelectPlace = (place: GoogleSearchResultItem) => {
    setWarehouseVillage(place.fullAddress);
    setLat(place.lat.toFixed(6));
    setLng(place.lng.toFixed(6));
    setShowDropdown(false);
    setSearchQuery("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingConfig(true);
    try {
      await onSaveConfig({
        maxWorkdayMinutes: Math.max(60, Math.min(960, maxWorkdayMinutes || 480)),
        maxStopsPerRoute: Math.max(1, Math.min(30, maxStopsPerRoute || 12)),
        workdayStartTime: workdayStartTime || "08:30",
        consumoL100: Math.max(2, Number(consumoL100) || 7.5),
        precioCombustible: Math.max(0.1, Number(precioCombustible) || 1.55),
        hourlyCostEur: Math.max(0, Number(hourlyCostEur) || 0),
        warehouseName: warehouseName.trim(),
        warehouseVillage: warehouseVillage.trim(),
        ...(googleMapsApiKey.trim()
          ? { googleMapsApiKey: googleMapsApiKey.trim() }
          : {}),
        warehouseCoordinates: {
          lat: parseFloat(lat) || config.warehouseCoordinates.lat,
          lng: parseFloat(lng) || config.warehouseCoordinates.lng,
        },
      });
      setGoogleMapsApiKey("");
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handlePruneStorage = async (archiveClosedDays?: number) => {
    setIsPruning(true);
    try {
      const res = await cloudApi.pruneStorage({
        auditOlderThanDays: 30,
        keepLatestAuditRows: 1000,
        ...(archiveClosedDays
          ? { archiveCompletedOlderThanDays: archiveClosedDays }
          : {}),
      });
      await onRefreshAll();
      onShowToast?.(
        `Limpieza completada: ${res.deletedLogs} logs y ${res.deletedOrders} partes antiguos purgados`
      );
    } catch (err) {
      const msg =
        err instanceof CloudApiError ? err.message : "Error purgando espacio";
      onShowToast?.(msg, "error");
    } finally {
      setIsPruning(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserEmail.trim() || !newUserName.trim() || newUserPassword.length < 8)
      return;
    setIsCreatingUser(true);
    try {
      await cloudApi.createUser({
        email: newUserEmail.trim(),
        fullName: newUserName.trim(),
        password: newUserPassword,
        role: newUserRole,
      });
      setNewUserName("");
      setNewUserEmail("");
      setNewUserPassword("");
      await onRefreshAll();
      onShowToast?.(`Usuario ${newUserEmail.trim()} creado como ${newUserRole}`);
    } catch (err) {
      const msg =
        err instanceof CloudApiError
          ? err.message
          : "No se pudo crear el usuario";
      onShowToast?.(msg, "error");
    } finally {
      setIsCreatingUser(false);
    }
  };

  const handleToggleUserActive = async (u: UserProfile) => {
    setUpdatingUserId(u.id);
    try {
      await cloudApi.updateUser(u.id, { isActive: !u.isActive });
      await onRefreshAll();
      onShowToast?.(
        u.isActive
          ? `Acceso revocado al instante para ${u.fullName || u.email}`
          : `Acceso reactivado para ${u.fullName || u.email}`
      );
    } catch (err) {
      const msg =
        err instanceof CloudApiError
          ? err.message
          : "Error actualizando estado del usuario";
      onShowToast?.(msg, "error");
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleChangeUserRole = async (u: UserProfile, role: UserRole) => {
    setUpdatingUserId(u.id);
    try {
      await cloudApi.updateUser(u.id, { role });
      await onRefreshAll();
      onShowToast?.(`Rol de ${u.fullName || u.email} cambiado a ${role}`);
    } catch (err) {
      const msg =
        err instanceof CloudApiError ? err.message : "Error cambiando rol";
      onShowToast?.(msg, "error");
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleToggleAuditLogs = async () => {
    const next = !showAuditLogs;
    setShowAuditLogs(next);
    if (next) {
      setIsLoadingAudit(true);
      try {
        const logs = await cloudApi.getAuditLogs();
        setAuditLogs(logs);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoadingAudit(false);
      }
    }
  };

  const usedMb = storageStats
    ? (storageStats.used_bytes / (1024 * 1024)).toFixed(2)
    : "0.00";
  const limitMb = storageStats
    ? (storageStats.limit_bytes / (1024 * 1024)).toFixed(0)
    : "50";
  const usagePct = storageStats
    ? Math.min(100, Math.round(storageStats.usage_ratio * 100))
    : 0;

  const adminCount = users.filter((u) => u.role === "admin" && u.isActive).length;
  const techCount = users.filter((u) => u.role === "tecnico" && u.isActive).length;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* 1. CONTROL ESTRICTO DE ESPACIO EN SUPABASE (50 MB) */}
      <div className="bg-slate-900/65 backdrop-blur-md border border-white/[0.08] p-6 rounded-3xl shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-400">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-black uppercase tracking-wider text-white">
                Almacenamiento Dedicado SATRuta (Tope Duro {limitMb} MB)
              </h2>
              <p className="text-xs text-slate-400">
                Proyecto Supabase independiente (eu-west-1) con bloqueo automático al 100% para proteger tu cuota.
              </p>
            </div>
          </div>

          <span
            className={`text-xs font-mono font-black px-3 py-1 rounded-full border ${
              storageStats?.is_blocked
                ? "bg-rose-500/15 text-rose-300 border-rose-500/40"
                : storageStats?.is_warning
                ? "bg-amber-500/15 text-amber-300 border-amber-500/40"
                : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
            }`}
          >
            {usedMb} MB / {limitMb} MB ({usagePct}%)
          </span>
        </div>

        <div className="w-full h-3 bg-slate-950 rounded-full overflow-hidden border border-white/[0.08]">
          <div
            className={`h-full transition-all duration-300 ${
              storageStats?.is_blocked
                ? "bg-rose-500"
                : storageStats?.is_warning
                ? "bg-amber-500"
                : "bg-emerald-500"
            }`}
            style={{ width: `${Math.max(2, usagePct)}%` }}
          />
        </div>

        {storageStats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
            <div className="p-2.5 rounded-xl bg-slate-950/60 border border-white/[0.06]">
              <span className="text-slate-400 block text-[11px]">Clientes</span>
              <strong className="text-white font-mono text-sm">
                {storageStats.counts.customers}
              </strong>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-950/60 border border-white/[0.06]">
              <span className="text-slate-400 block text-[11px]">
                Partes totales
              </span>
              <strong className="text-white font-mono text-sm">
                {storageStats.counts.orders}
              </strong>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-950/60 border border-white/[0.06]">
              <span className="text-slate-400 block text-[11px]">
                Registros auditoría
              </span>
              <strong className="text-white font-mono text-sm">
                {storageStats.counts.audit_logs}
              </strong>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-950/60 border border-white/[0.06]">
              <span className="text-slate-400 block text-[11px]">Usuarios</span>
              <strong className="text-white font-mono text-sm">
                {storageStats.counts.profiles}
              </strong>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            disabled={isPruning}
            onClick={() => handlePruneStorage()}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-bold text-slate-200 border border-white/[0.08] flex items-center gap-1.5 transition"
          >
            {isPruning ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span>Purgar logs &gt; 30 días</span>
          </button>

          <button
            type="button"
            disabled={isPruning}
            onClick={() => handlePruneStorage(90)}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-bold text-slate-200 border border-white/[0.08] flex items-center gap-1.5 transition"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
            <span>Limpiar partes cerrados &gt; 90 días</span>
          </button>
        </div>
      </div>

      {/* 2. EQUIPO Y PERMISOS (3 ADMINS · 2 TÉCNICOS) */}
      <div className="bg-slate-900/65 backdrop-blur-md border border-white/[0.08] p-6 rounded-3xl shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-black uppercase tracking-wider text-white">
                Equipo y Control de Accesos (RLS)
              </h2>
              <p className="text-xs text-slate-400">
                Activos: {adminCount} administradores · {techCount} técnicos en calle
              </p>
            </div>
          </div>
        </div>

        {/* Lista de usuarios */}
        <div className="space-y-2">
          {users.map((u) => {
            const isSelf = currentProfile?.id === u.id;
            return (
              <div
                key={u.id}
                className={`p-3 rounded-2xl border flex flex-wrap items-center justify-between gap-3 text-xs ${
                  u.isActive
                    ? "bg-slate-950/60 border-white/[0.07]"
                    : "bg-rose-950/20 border-rose-500/25 opacity-75"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <strong className="text-white text-sm">
                      {u.fullName || u.email}
                    </strong>
                    {isSelf && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 font-bold">
                        Tú
                      </span>
                    )}
                    {!u.isActive && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 font-bold">
                        Revocado
                      </span>
                    )}
                  </div>
                  <span className="text-slate-400 text-[11px]">{u.email}</span>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={u.role}
                    disabled={isSelf || updatingUserId === u.id}
                    onChange={(e) =>
                      handleChangeUserRole(u, e.target.value as UserRole)
                    }
                    className="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-white/[0.08] text-xs font-bold text-slate-200 disabled:opacity-50"
                  >
                    <option value="admin">Admin</option>
                    <option value="tecnico">Técnico</option>
                  </select>

                  {!isSelf && (
                    <button
                      type="button"
                      disabled={updatingUserId === u.id}
                      onClick={() => handleToggleUserActive(u)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition ${
                        u.isActive
                          ? "bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border-rose-500/30"
                          : "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                      }`}
                    >
                      {u.isActive ? (
                        <>
                          <Ban className="w-3.5 h-3.5" />
                          <span>Revocar</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Reactivar</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Alta de nuevo miembro */}
        {canManageAuthUsers ? (
          <form
            onSubmit={handleCreateUser}
            className="p-4 rounded-2xl bg-slate-950/60 border border-white/[0.07] space-y-3"
          >
            <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
              <UserPlus className="w-4 h-4" />
              <span>Dar de alta nuevo usuario (sin registro público)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              <input
                type="text"
                required
                placeholder="Nombre completo"
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                className="px-3 py-2 text-xs bg-slate-900 border border-white/[0.08] rounded-xl text-white outline-none focus:border-amber-500"
              />
              <input
                type="email"
                required
                placeholder="Email acceso"
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                className="px-3 py-2 text-xs bg-slate-900 border border-white/[0.08] rounded-xl text-white outline-none focus:border-amber-500"
              />
              <input
                type="password"
                required
                minLength={8}
                placeholder="Contraseña (mín. 8)"
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
                className="px-3 py-2 text-xs bg-slate-900 border border-white/[0.08] rounded-xl text-white outline-none focus:border-amber-500"
              />
              <div className="flex gap-2">
                <select
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                  className="px-2.5 py-2 text-xs bg-slate-900 border border-white/[0.08] rounded-xl text-white font-bold"
                >
                  <option value="tecnico">Técnico</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  type="submit"
                  disabled={isCreatingUser}
                  className="flex-1 px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs transition"
                >
                  {isCreatingUser ? "Creando..." : "Crear"}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-200 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>
              Para crear cuentas directamente desde aquí añade{" "}
              <code className="font-mono text-white">SUPABASE_SERVICE_ROLE_KEY</code>{" "}
              en Vercel / <code className="font-mono text-white">.env.local</code>.
              También puedes invitar o crear los 3 admins y 2 técnicos desde Supabase Dashboard → Authentication → Users.
            </span>
          </div>
        )}

        {/* Visor de auditoría */}
        <div className="pt-1">
          <button
            type="button"
            onClick={handleToggleAuditLogs}
            className="text-xs font-bold text-slate-300 hover:text-amber-400 flex items-center gap-1.5 transition"
          >
            <History className="w-4 h-4" />
            <span>
              {showAuditLogs
                ? "Ocultar registro de auditoría"
                : "Ver últimos eventos de auditoría"}
            </span>
          </button>

          {showAuditLogs && (
            <div className="mt-3 max-h-60 overflow-y-auto rounded-2xl bg-slate-950/70 border border-white/[0.07] p-3 space-y-1.5 text-xs">
              {isLoadingAudit ? (
                <div className="text-slate-400 py-4 text-center">
                  Cargando eventos...
                </div>
              ) : auditLogs.length === 0 ? (
                <div className="text-slate-500 py-4 text-center">
                  Sin eventos registrados aún.
                </div>
              ) : (
                auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-1.5 border-b border-white/[0.05] last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-slate-800 text-amber-300">
                        {log.action}
                      </span>
                      <span className="text-slate-300">{log.actor_email}</span>
                    </div>
                    <span className="text-[11px] text-slate-500 font-mono">
                      {new Date(log.created_at).toLocaleString("es-ES")}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* 3. CONFIGURACIÓN OPERATIVA */}
      <form
        onSubmit={handleSubmit}
        className="bg-slate-900/65 backdrop-blur-md border border-white/[0.08] p-6 rounded-3xl shadow-xl space-y-5"
      >
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-black uppercase tracking-wider text-white">
                Configuración de Jornada SAT, Vehículo y Base
              </h2>
              <p className="text-xs text-slate-400">
                Sincronizada para todos los administradores y técnicos.
              </p>
            </div>
          </div>

          {savedSuccess && (
            <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
              <Check className="w-4 h-4" /> Guardado
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
              className="w-full px-3 py-2 text-sm bg-slate-950/70 border border-white/[0.08] rounded-xl text-white font-bold outline-none focus:border-amber-500"
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
              className="w-full px-3 py-2 text-sm bg-slate-950/70 border border-white/[0.08] rounded-xl text-white font-bold outline-none focus:border-amber-500"
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
              className="w-full px-3 py-2 text-sm bg-slate-950/70 border border-white/[0.08] rounded-xl text-amber-400 font-mono font-black outline-none focus:border-amber-500"
            />
            <span className="text-[11px] text-slate-400 mt-1 block">
              Base para cálculo de ETA de llegada
            </span>
          </div>
        </div>

        {/* Parámetros de Vehículo Taller y Costes */}
        <div className="p-4 rounded-2xl bg-slate-950/70 border border-amber-500/25 space-y-3">
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
                className="w-full px-3 py-2 text-xs bg-slate-900 border border-white/[0.08] rounded-xl text-white font-bold outline-none focus:border-amber-500"
              />
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
                className="w-full px-3 py-2 text-xs bg-slate-900 border border-white/[0.08] rounded-xl text-amber-400 font-black outline-none focus:border-amber-500"
              />
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
                className="w-full px-3 py-2 text-xs bg-slate-900 border border-white/[0.08] rounded-xl text-emerald-400 font-black outline-none focus:border-amber-500"
              />
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
              className="w-full px-3 py-2 text-sm bg-slate-950/70 border border-white/[0.08] rounded-xl text-white outline-none focus:border-amber-500"
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
              className="w-full px-3 py-2 text-sm bg-slate-950/70 border border-white/[0.08] rounded-xl text-white outline-none focus:border-amber-500"
            />
          </div>
        </div>

        {/* Buscador de Ubicación de Base con Google Maps */}
        <div className="relative space-y-1.5 pt-1">
          <label className="block text-xs font-bold text-slate-300 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-amber-400">
              <Search className="w-3.5 h-3.5" />
              Buscar Ubicación de la Base / Taller
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
            className="w-full px-3 py-2 text-xs bg-slate-950/70 border border-white/[0.08] rounded-xl text-white outline-none focus:border-amber-500"
          />

          {showDropdown && searchResults.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-slate-900 border border-amber-500/40 rounded-2xl shadow-2xl z-30 max-h-52 overflow-y-auto p-1.5 space-y-1">
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
              Ubicación Exacta de Salida y Retorno
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

        {/* GOOGLE MAPS API KEY CIFRADA */}
        <div className="p-4 rounded-2xl bg-slate-950/60 border border-white/[0.08] space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-300 flex items-center gap-2">
              <Key className="w-4 h-4 text-amber-400" />
              <span>Google Maps API Key (Opcional, cifrada AES-256)</span>
            </label>
            <span className="text-[10px] text-emerald-400 font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              {config.hasGoogleMapsApiKey ? "Clave guardada" : "Modo gratuito activo"}
            </span>
          </div>

          <input
            type="password"
            placeholder={
              config.hasGoogleMapsApiKey
                ? "•••••••• (Introduce una nueva para reemplazar)"
                : "AIzaSy... (Opcional)"
            }
            value={googleMapsApiKey}
            onChange={(e) => setGoogleMapsApiKey(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-slate-900 border border-white/[0.08] rounded-xl text-white font-mono outline-none focus:border-amber-500"
          />
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={isSavingConfig}
            className="px-6 py-3 rounded-2xl bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 font-black text-xs transition shadow-lg shadow-amber-500/25 flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            <span>{isSavingConfig ? "Guardando..." : "Guardar Configuración"}</span>
          </button>
        </div>
      </form>

      {/* 4. BACKUP PORTABLE JSON */}
      <div className="bg-slate-900/65 backdrop-blur-md border border-white/[0.08] p-6 rounded-3xl shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-400" />
            Copias de Seguridad Portables (JSON)
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Exporta tu cartera completa descifrada a tu PC o restaura desde un archivo JSON.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsBackupOpen(true)}
          className="px-4 py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs border border-white/[0.08] flex items-center gap-1.5 transition shrink-0"
        >
          <FileJson className="w-4 h-4 text-amber-400" />
          <span>Exportar / Importar JSON</span>
        </button>
      </div>

      <GaliciaBackupModal
        isOpen={isBackupOpen}
        onClose={() => setIsBackupOpen(false)}
        onDataRestored={onRefreshAll}
        customers={customers}
        orders={orders}
        config={config}
      />
    </div>
  );
}
