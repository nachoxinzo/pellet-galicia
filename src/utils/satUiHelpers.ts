import { OrderPriority, ServiceType } from "@/types/pelletGalicia";

export function formatHoursMinutes(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes || 0));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function getServiceTypeBadgeMeta(
  serviceType: ServiceType = "Avería",
  priority: OrderPriority = "Normal"
): {
  emoji: string;
  label: string;
  badgeClass: string;
  mapPinHex: string;
} {
  if (priority === "Urgente") {
    return {
      emoji: "🚨",
      label: `${serviceType} Urgente`,
      badgeClass:
        "bg-rose-600 text-white border border-rose-400 shadow-sm shadow-rose-600/30",
      mapPinHex: "#e11d48",
    };
  }

  if (serviceType === "Avería") {
    return {
      emoji: "🔧",
      label: "Avería",
      badgeClass:
        "bg-amber-500/20 text-amber-300 border border-amber-500/40",
      mapPinHex: "#d97706",
    };
  }

  if (serviceType === "Instalación") {
    return {
      emoji: "⚙️",
      label: "Instalación",
      badgeClass:
        "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
      mapPinHex: "#059669",
    };
  }

  return {
    emoji: "📋",
    label: "Revisión",
    badgeClass: "bg-sky-500/20 text-sky-300 border border-sky-500/40",
    mapPinHex: "#0284c7",
  };
}
