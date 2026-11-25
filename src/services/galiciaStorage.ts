import {
  Customer,
  ServiceOrder,
  ServiceType,
  OrderPriority,
  DecodedReturnReceipt,
  TechnicianConfig,
  FIELD_SERVICE_RULES,
} from "@/types/pelletGalicia";
import { extractTechTagsFromNotes } from "@/utils/galiciaUrlCodec";

const STORAGE_KEYS = {
  CUSTOMERS: "fieldops_customers_v3",
  ORDERS: "fieldops_orders_v3",
  CONFIG: "fieldops_config_v3",
  INITIALIZED: "fieldops_initialized_v3",
  LAST_BACKUP_AT: "fieldops_last_backup_at_v3",
  ORDERS_SINCE_BACKUP: "fieldops_orders_since_backup_v3",
} as const;

export interface BackupAlertStatus {
  lastBackupAt: string | null;
  daysSinceBackup: number | null;
  ordersSinceBackup: number;
  needsBackupAlert: boolean;
}

export const DEFAULT_TECH_CONFIG: TechnicianConfig = {
  maxWorkdayMinutes: FIELD_SERVICE_RULES.DEFAULT_MAX_WORKDAY_MINUTES,
  maxStopsPerRoute: FIELD_SERVICE_RULES.DEFAULT_MAX_STOPS_PER_ROUTE,
  workdayStartTime: FIELD_SERVICE_RULES.DEFAULT_START_TIME,
  warehouseName: "Base / Taller Central",
  warehouseVillage: "Polígono San Cibrao das Viñas, Parcela 14, Ourense",
  warehouseCoordinates: { lat: 42.2982, lng: -7.8185 },
  consumoL100: FIELD_SERVICE_RULES.DEFAULT_CONSUMO_L100,
  precioCombustible: FIELD_SERVICE_RULES.DEFAULT_PRECIO_COMBUSTIBLE,
  hourlyCostEur: FIELD_SERVICE_RULES.DEFAULT_HOURLY_COST_EUR,
};

export function normalizeGaliciaText(str?: string): string {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizePhoneDigits(phone?: string): string {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
}

export function extractConcelloFromVillage(village?: string): string {
  if (!village) return "Otros";
  const parts = village
    .split(/[,—\-()]/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length > 2 &&
        !/^\d+$/.test(s) &&
        ![
          "ourense",
          "lugo",
          "pontevedra",
          "a coruña",
          "coruña",
          "galicia",
          "españa",
        ].includes(s.toLowerCase())
    );
  return parts[parts.length - 1] || parts[0] || "General";
}

class LocalFieldServiceStorage {
  private isBrowser(): boolean {
    return typeof window !== "undefined";
  }

  /**
   * Inicializa v3 y migra automáticamente la cartera de clientes y coordenadas
   * desde la v2 anterior si existieran, sin perder la geolocalización satelital.
   */
  private ensureSeeded(): void {
    if (!this.isBrowser()) return;

    const seeded = localStorage.getItem(STORAGE_KEYS.INITIALIZED);
    if (!seeded) {
      let migratedCustomers: Customer[] = [];
      let migratedConfig: TechnicianConfig = { ...DEFAULT_TECH_CONFIG };

      try {
        const rawV2Cust = localStorage.getItem("pelletgalicia_customers_v2");
        if (rawV2Cust) {
          const parsedV2 = JSON.parse(rawV2Cust);
          if (Array.isArray(parsedV2)) {
            migratedCustomers = parsedV2
              .filter(
                (c: any) =>
                  c &&
                  typeof c.name === "string" &&
                  Number.isFinite(Number(c.coordinates?.lat)) &&
                  Number.isFinite(Number(c.coordinates?.lng))
              )
              .map((c: any) => ({
                id: String(c.id),
                name: c.name,
                village: String(c.village || ""),
                phone: String(c.phone || ""),
                coordinates: {
                  lat: Number(c.coordinates.lat),
                  lng: Number(c.coordinates.lng),
                },
                equipmentInfo: c.equipmentInfo || "",
                internalNotes: String(c.internalNotes || ""),
                lastServiceType: "Revisión" as ServiceType,
                lastInterventionMinutes:
                  FIELD_SERVICE_RULES.DEFAULT_INTERVENTION_MINUTES,
                lastServiceDate: c.fechaUltimoPedido || c.updatedAt,
                totalServicesHistory: Number(c.totalPedidosHistorico || 0),
                totalBilledHistoryEur: 0,
                createdAt: c.createdAt || new Date().toISOString(),
                updatedAt: c.updatedAt || new Date().toISOString(),
              }));
          }
        }

        const rawV2Cfg = localStorage.getItem("pelletgalicia_vanconfig_v2");
        if (rawV2Cfg) {
          const cfg = JSON.parse(rawV2Cfg);
          if (cfg && typeof cfg === "object") {
            migratedConfig = {
              ...DEFAULT_TECH_CONFIG,
              warehouseName: cfg.warehouseName || DEFAULT_TECH_CONFIG.warehouseName,
              warehouseVillage:
                cfg.warehouseVillage || DEFAULT_TECH_CONFIG.warehouseVillage,
              warehouseCoordinates:
                cfg.warehouseCoordinates || DEFAULT_TECH_CONFIG.warehouseCoordinates,
              googleMapsApiKey: cfg.googleMapsApiKey,
              precioCombustible:
                Number(cfg.precioCombustible) ||
                DEFAULT_TECH_CONFIG.precioCombustible,
            };
          }
        }
      } catch (err) {
        console.warn("Aviso migrando cartera v2 -> v3:", err);
      }

      localStorage.setItem(
        STORAGE_KEYS.CUSTOMERS,
        JSON.stringify(migratedCustomers)
      );
      localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify([]));
      localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(migratedConfig));
      localStorage.setItem(STORAGE_KEYS.INITIALIZED, "true");
    }
  }

  private read<T>(key: string, fallback: T): T {
    if (!this.isBrowser()) return fallback;
    this.ensureSeeded();
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  private write<T>(key: string, data: T): void {
    if (!this.isBrowser()) return;
    localStorage.setItem(key, JSON.stringify(data));
  }

  // --- CLIENTES / INSTALACIONES ---
  getCustomers(): Customer[] {
    return this.read<Customer[]>(STORAGE_KEYS.CUSTOMERS, []);
  }

  findMatchingCustomer(
    name: string,
    phone?: string,
    explicitId?: string
  ): Customer | undefined {
    const list = this.getCustomers();
    if (explicitId) {
      const byId = list.find((c) => c.id === explicitId);
      if (byId) return byId;
    }

    const normName = normalizeGaliciaText(name);
    if (normName) {
      const byName = list.find(
        (c) => normalizeGaliciaText(c.name) === normName
      );
      if (byName) return byName;
    }

    const normPhone = normalizePhoneDigits(phone);
    if (normPhone.length >= 6) {
      const byPhone = list.find(
        (c) => normalizePhoneDigits(c.phone) === normPhone
      );
      if (byPhone) return byPhone;
    }

    return undefined;
  }

  saveCustomer(
    customerData: Omit<Customer, "id" | "createdAt" | "updatedAt"> & {
      id?: string;
    }
  ): Customer {
    const list = this.getCustomers();
    const now = new Date().toISOString();

    const existing = this.findMatchingCustomer(
      customerData.name,
      customerData.phone,
      customerData.id
    );

    const id = existing ? existing.id : customerData.id || `cust-${Date.now()}`;
    const idx = list.findIndex((c) => c.id === id);

    const customer: Customer = {
      id,
      name: customerData.name.trim(),
      village: customerData.village.trim(),
      phone: customerData.phone?.trim() || existing?.phone || "",
      coordinates: customerData.coordinates,
      equipmentInfo:
        customerData.equipmentInfo?.trim() !== undefined &&
        customerData.equipmentInfo.trim() !== ""
          ? customerData.equipmentInfo.trim()
          : existing?.equipmentInfo || "",
      internalNotes:
        customerData.internalNotes?.trim() !== undefined &&
        customerData.internalNotes.trim() !== ""
          ? customerData.internalNotes.trim()
          : existing?.internalNotes || "",
      lastServiceType:
        customerData.lastServiceType ?? existing?.lastServiceType ?? "Revisión",
      lastInterventionMinutes:
        customerData.lastInterventionMinutes ??
        existing?.lastInterventionMinutes ??
        FIELD_SERVICE_RULES.DEFAULT_INTERVENTION_MINUTES,
      lastServiceDate:
        customerData.lastServiceDate ?? existing?.lastServiceDate ?? now,
      totalServicesHistory:
        customerData.totalServicesHistory ?? existing?.totalServicesHistory ?? 0,
      totalBilledHistoryEur:
        customerData.totalBilledHistoryEur ??
        existing?.totalBilledHistoryEur ??
        0,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    if (idx >= 0) {
      list[idx] = customer;
      const orders = this.getOrders().map((o) =>
        o.customerId === id ? { ...o, customer } : o
      );
      this.write(STORAGE_KEYS.ORDERS, orders);
    } else {
      list.unshift(customer);
    }

    this.write(STORAGE_KEYS.CUSTOMERS, list);
    return customer;
  }

  deleteCustomer(id: string): void {
    const list = this.getCustomers().filter((c) => c.id !== id);
    this.write(STORAGE_KEYS.CUSTOMERS, list);

    const orders = this.getOrders().filter((o) => o.customerId !== id);
    this.write(STORAGE_KEYS.ORDERS, orders);
  }

  // --- PARTES / AVISOS DE SERVICIO ---
  getOrders(): ServiceOrder[] {
    return this.read<ServiceOrder[]>(STORAGE_KEYS.ORDERS, []);
  }

  getPendingOrders(): ServiceOrder[] {
    return this.getOrders().filter(
      (o) => o.status === "Pendiente" || o.status === "En Ruta"
    );
  }

  saveOrder(
    customerId: string,
    payload: {
      serviceType?: ServiceType;
      priority?: OrderPriority;
      equipmentInfo?: string;
      estimatedMinutes?: number;
      estimatedPriceEur?: number;
      technicalNotes?: string;
    }
  ): ServiceOrder {
    const customers = this.getCustomers();
    const custIdx = customers.findIndex((c) => c.id === customerId);
    if (custIdx === -1) throw new Error("Cliente no encontrado");

    const now = new Date().toISOString();
    const existingCust = customers[custIdx];

    const serviceType: ServiceType = payload.serviceType ?? "Avería";
    const priority: OrderPriority = payload.priority ?? "Normal";
    const estimatedMinutes = Math.max(
      15,
      Math.min(
        480,
        Math.round(
          payload.estimatedMinutes ||
            FIELD_SERVICE_RULES.DEFAULT_INTERVENTION_MINUTES
        )
      )
    );
    const resolvedNotes =
      payload.technicalNotes?.trim() !== undefined &&
      payload.technicalNotes.trim() !== ""
        ? payload.technicalNotes.trim()
        : existingCust.internalNotes || "";
    const resolvedEquipment =
      payload.equipmentInfo?.trim() || existingCust.equipmentInfo || "";

    const { cashToCollectEur } = extractTechTagsFromNotes(
      resolvedNotes,
      payload.estimatedPriceEur
    );

    const updatedCustomer: Customer = {
      ...existingCust,
      equipmentInfo: resolvedEquipment,
      lastServiceType: serviceType,
      lastInterventionMinutes: estimatedMinutes,
      lastServiceDate: now,
      totalServicesHistory: (existingCust.totalServicesHistory || 0) + 1,
      internalNotes: resolvedNotes,
      updatedAt: now,
    };

    customers[custIdx] = updatedCustomer;
    this.write(STORAGE_KEYS.CUSTOMERS, customers);

    const orders = this.getOrders().map((o) =>
      o.customerId === customerId ? { ...o, customer: updatedCustomer } : o
    );

    const order: ServiceOrder = {
      id: `srv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      customerId,
      customer: updatedCustomer,
      serviceType,
      priority,
      equipmentInfo: resolvedEquipment,
      estimatedMinutes,
      estimatedPriceEur: cashToCollectEur > 0 ? cashToCollectEur : 0,
      technicalNotes: resolvedNotes,
      concello: extractConcelloFromVillage(updatedCustomer.village),
      status: "Pendiente",
      createdAt: now,
    };

    orders.unshift(order);
    this.write(STORAGE_KEYS.ORDERS, orders);

    const currentSinceBackup = this.read<number>(
      STORAGE_KEYS.ORDERS_SINCE_BACKUP,
      0
    );
    this.write(STORAGE_KEYS.ORDERS_SINCE_BACKUP, currentSinceBackup + 1);

    return order;
  }

  updateOrder(
    id: string,
    updates: {
      serviceType?: ServiceType;
      priority?: OrderPriority;
      equipmentInfo?: string;
      estimatedMinutes?: number;
      estimatedPriceEur?: number;
      technicalNotes?: string;
      status?: ServiceOrder["status"];
    }
  ): ServiceOrder | null {
    const orders = this.getOrders();
    const idx = orders.findIndex((o) => o.id === id);
    if (idx === -1) return null;

    const current = orders[idx];
    const estimatedMinutes =
      updates.estimatedMinutes !== undefined
        ? Math.max(15, Math.min(480, Math.round(updates.estimatedMinutes)))
        : current.estimatedMinutes;
    const updatedNotes =
      updates.technicalNotes !== undefined
        ? updates.technicalNotes.trim()
        : current.technicalNotes;
    const updatedEquipment =
      updates.equipmentInfo !== undefined
        ? updates.equipmentInfo.trim()
        : current.equipmentInfo;
    const explicitPrice =
      updates.estimatedPriceEur !== undefined
        ? updates.estimatedPriceEur
        : current.estimatedPriceEur;
    const { cashToCollectEur } = extractTechTagsFromNotes(
      updatedNotes,
      explicitPrice
    );

    const customers = this.getCustomers();
    const custIdx = customers.findIndex((c) => c.id === current.customerId);
    let updatedCustomer = current.customer;

    if (custIdx >= 0) {
      const c = customers[custIdx];
      updatedCustomer = {
        ...c,
        equipmentInfo: updatedEquipment || c.equipmentInfo || "",
        lastServiceType: updates.serviceType ?? current.serviceType,
        lastInterventionMinutes: estimatedMinutes,
        internalNotes: updatedNotes || c.internalNotes || "",
        updatedAt: new Date().toISOString(),
      };
      customers[custIdx] = updatedCustomer;
      this.write(STORAGE_KEYS.CUSTOMERS, customers);
    }

    const updated: ServiceOrder = {
      ...current,
      customer: updatedCustomer,
      serviceType: updates.serviceType ?? current.serviceType,
      priority: updates.priority ?? current.priority,
      equipmentInfo: updatedEquipment,
      estimatedMinutes,
      estimatedPriceEur:
        updates.estimatedPriceEur !== undefined
          ? Math.max(0, updates.estimatedPriceEur)
          : cashToCollectEur > 0
          ? cashToCollectEur
          : current.estimatedPriceEur,
      technicalNotes: updatedNotes,
      concello: extractConcelloFromVillage(updatedCustomer.village),
      status: updates.status ?? current.status,
    };

    orders[idx] = updated;
    this.write(STORAGE_KEYS.ORDERS, orders);
    return updated;
  }

  updateOrderDuration(
    id: string,
    deltaOrExact: number,
    isDelta = false
  ): ServiceOrder | null {
    const orders = this.getOrders();
    const idx = orders.findIndex((o) => o.id === id);
    if (idx === -1) return null;

    const current = orders[idx];
    const estimatedMinutes = isDelta
      ? Math.max(15, Math.min(480, current.estimatedMinutes + deltaOrExact))
      : Math.max(15, Math.min(480, deltaOrExact));

    const updated: ServiceOrder = {
      ...current,
      estimatedMinutes,
    };

    orders[idx] = updated;
    this.write(STORAGE_KEYS.ORDERS, orders);
    return updated;
  }

  deleteOrder(id: string): void {
    const orders = this.getOrders().filter((o) => o.id !== id);
    this.write(STORAGE_KEYS.ORDERS, orders);
  }

  updateOrderStatus(id: string, status: ServiceOrder["status"]): void {
    const now = new Date().toISOString();
    const allOrders = this.getOrders();
    const target = allOrders.find((o) => o.id === id);

    if (target && status === "Completado") {
      const customers = this.getCustomers();
      const custIdx = customers.findIndex((c) => c.id === target.customerId);
      if (custIdx >= 0) {
        const billed =
          target.collectedPriceEur ?? target.estimatedPriceEur ?? 0;
        customers[custIdx] = {
          ...customers[custIdx],
          lastServiceType: target.serviceType,
          lastInterventionMinutes: target.actualMinutes ?? target.estimatedMinutes,
          lastServiceDate: now,
          totalBilledHistoryEur:
            (customers[custIdx].totalBilledHistoryEur || 0) + billed,
          updatedAt: now,
        };
        this.write(STORAGE_KEYS.CUSTOMERS, customers);
      }
    }

    const orders = allOrders.map((o) =>
      o.id === id
        ? {
            ...o,
            status,
            ...(status === "Completado" ? { completedAt: now } : {}),
          }
        : o
    );
    this.write(STORAGE_KEYS.ORDERS, orders);
  }

  markOrdersCompleted(orderIds: string[]): void {
    const allOrders = this.getOrders();
    const customers = this.getCustomers();
    const now = new Date().toISOString();
    let customersUpdated = false;

    allOrders.forEach((o) => {
      if (orderIds.includes(o.id)) {
        const custIdx = customers.findIndex((c) => c.id === o.customerId);
        if (custIdx >= 0) {
          const billed = o.collectedPriceEur ?? o.estimatedPriceEur ?? 0;
          customers[custIdx] = {
            ...customers[custIdx],
            lastServiceType: o.serviceType,
            lastInterventionMinutes: o.actualMinutes ?? o.estimatedMinutes,
            lastServiceDate: now,
            totalBilledHistoryEur:
              (customers[custIdx].totalBilledHistoryEur || 0) + billed,
            updatedAt: now,
          };
          customersUpdated = true;
        }
      }
    });

    if (customersUpdated) {
      this.write(STORAGE_KEYS.CUSTOMERS, customers);
    }

    const orders = allOrders.map((o) =>
      orderIds.includes(o.id)
        ? { ...o, status: "Completado" as const, completedAt: now }
        : o
    );
    this.write(STORAGE_KEYS.ORDERS, orders);
  }

  markOrdersInRoute(orderIds: string[]): void {
    const now = new Date().toISOString();
    const orders = this.getOrders().map((o) =>
      orderIds.includes(o.id)
        ? { ...o, status: "En Ruta" as const, dispatchedAt: now }
        : o
    );
    this.write(STORAGE_KEYS.ORDERS, orders);
  }

  /**
   * Concilia un recibo de cierre Zero-Cloud (/tecnico -> /admin)
   * actualizando estado a Completado, minutos reales, importe cobrado y nota de resolución.
   */
  reconcileReturnReceipt(receipt: DecodedReturnReceipt): {
    matchedOrderIds: string[];
    totalMinutesRecorded: number;
    totalCashRecordedEur: number;
  } {
    const allOrders = this.getOrders();
    const customers = this.getCustomers();
    const now = new Date().toISOString();

    const matchedOrderIds: string[] = [];
    let totalMinutesRecorded = 0;
    let totalCashRecordedEur = 0;
    let customersChanged = false;

    const updatedOrders = allOrders.map((ord) => {
      const ordShortId = ord.id.replace(/^(eph-|ord-|srv-)/g, "").slice(-6);
      const item = receipt.deliveredItems.find(
        (it) =>
          it.shortId === ordShortId ||
          ord.id.endsWith(it.shortId) ||
          it.shortId.endsWith(ordShortId)
      );

      if (!item) return ord;

      matchedOrderIds.push(ord.id);
      totalMinutesRecorded += item.actualMinutes;
      totalCashRecordedEur += item.cashCollectedEur;

      const custIdx = customers.findIndex((c) => c.id === ord.customerId);
      if (custIdx >= 0) {
        customers[custIdx] = {
          ...customers[custIdx],
          lastServiceType: item.serviceType,
          lastInterventionMinutes: item.actualMinutes,
          lastServiceDate: now,
          totalBilledHistoryEur:
            (customers[custIdx].totalBilledHistoryEur || 0) +
            item.cashCollectedEur,
          updatedAt: now,
        };
        customersChanged = true;
      }

      return {
        ...ord,
        serviceType: item.serviceType,
        actualMinutes: item.actualMinutes,
        collectedPriceEur: item.cashCollectedEur,
        resolutionNote: item.resolutionNote || ord.resolutionNote,
        status: "Completado" as const,
        completedAt: now,
      };
    });

    if (matchedOrderIds.length > 0) {
      this.write(STORAGE_KEYS.ORDERS, updatedOrders);
      if (customersChanged) {
        this.write(STORAGE_KEYS.CUSTOMERS, customers);
      }
    }

    return {
      matchedOrderIds,
      totalMinutesRecorded,
      totalCashRecordedEur: Number(totalCashRecordedEur.toFixed(2)),
    };
  }

  /**
   * Cierra un parte directamente desde la terminal del técnico cuando trabaja en Modo Local
   * (mismo navegador), sincronizando al instante con el panel /admin.
   */
  completeOrderFromTech(
    stopId: string,
    data: {
      actualMinutes: number;
      collectedPriceEur: number;
      resolutionNote?: string;
      serviceType?: ServiceType;
    }
  ): boolean {
    const cleanTargetId = stopId.replace(/^eph-/, "");
    const allOrders = this.getOrders();
    const idx = allOrders.findIndex(
      (o) => o.id === cleanTargetId || o.id === stopId || o.id.endsWith(cleanTargetId)
    );
    if (idx === -1) return false;

    const now = new Date().toISOString();
    const current = allOrders[idx];
    const safeMinutes = Math.max(5, Math.min(480, Math.round(data.actualMinutes || 45)));
    const safePrice = Math.max(0, Number(data.collectedPriceEur) || 0);

    const updatedOrder: ServiceOrder = {
      ...current,
      serviceType: data.serviceType ?? current.serviceType,
      actualMinutes: safeMinutes,
      collectedPriceEur: safePrice,
      resolutionNote: data.resolutionNote?.trim() || current.resolutionNote,
      status: "Completado",
      completedAt: now,
    };

    allOrders[idx] = updatedOrder;
    this.write(STORAGE_KEYS.ORDERS, allOrders);

    const customers = this.getCustomers();
    const custIdx = customers.findIndex((c) => c.id === current.customerId);
    if (custIdx >= 0) {
      customers[custIdx] = {
        ...customers[custIdx],
        lastServiceType: updatedOrder.serviceType,
        lastInterventionMinutes: safeMinutes,
        lastServiceDate: now,
        totalBilledHistoryEur:
          (customers[custIdx].totalBilledHistoryEur || 0) + safePrice,
        updatedAt: now,
      };
      this.write(STORAGE_KEYS.CUSTOMERS, customers);
    }

    return true;
  }

  // --- CONFIGURACIÓN ---
  getConfig(): TechnicianConfig {
    const raw = this.read<TechnicianConfig>(
      STORAGE_KEYS.CONFIG,
      DEFAULT_TECH_CONFIG
    );
    return {
      ...DEFAULT_TECH_CONFIG,
      ...raw,
      maxWorkdayMinutes:
        raw.maxWorkdayMinutes ?? FIELD_SERVICE_RULES.DEFAULT_MAX_WORKDAY_MINUTES,
      maxStopsPerRoute:
        raw.maxStopsPerRoute ?? FIELD_SERVICE_RULES.DEFAULT_MAX_STOPS_PER_ROUTE,
      workdayStartTime:
        raw.workdayStartTime || FIELD_SERVICE_RULES.DEFAULT_START_TIME,
      consumoL100: raw.consumoL100 ?? FIELD_SERVICE_RULES.DEFAULT_CONSUMO_L100,
      precioCombustible:
        raw.precioCombustible ?? FIELD_SERVICE_RULES.DEFAULT_PRECIO_COMBUSTIBLE,
      hourlyCostEur:
        raw.hourlyCostEur ?? FIELD_SERVICE_RULES.DEFAULT_HOURLY_COST_EUR,
    };
  }

  saveConfig(partial: Partial<TechnicianConfig>): TechnicianConfig {
    const current = this.getConfig();
    const updated: TechnicianConfig = {
      ...current,
      ...partial,
      maxWorkdayMinutes: Math.max(
        60,
        Math.min(
          960,
          Number(partial.maxWorkdayMinutes ?? current.maxWorkdayMinutes)
        )
      ),
      maxStopsPerRoute: Math.max(
        1,
        Math.min(30, Number(partial.maxStopsPerRoute ?? current.maxStopsPerRoute))
      ),
    };
    this.write(STORAGE_KEYS.CONFIG, updated);
    return updated;
  }

  // --- BACKUP SEGURO JSON & ALERTAS ---
  getBackupAlertStatus(): BackupAlertStatus {
    if (!this.isBrowser()) {
      return {
        lastBackupAt: null,
        daysSinceBackup: null,
        ordersSinceBackup: 0,
        needsBackupAlert: false,
      };
    }

    const lastBackupAt = localStorage.getItem(STORAGE_KEYS.LAST_BACKUP_AT);
    const ordersSinceBackup = this.read<number>(
      STORAGE_KEYS.ORDERS_SINCE_BACKUP,
      0
    );
    const totalOrders = this.getOrders().length;

    let daysSinceBackup: number | null = null;
    if (lastBackupAt) {
      const diffMs = Date.now() - new Date(lastBackupAt).getTime();
      if (!isNaN(diffMs)) {
        daysSinceBackup = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      }
    }

    const needsBackupAlert =
      ordersSinceBackup > 10 ||
      (daysSinceBackup !== null && daysSinceBackup > 7 && totalOrders > 0) ||
      (!lastBackupAt && totalOrders > 10);

    return {
      lastBackupAt,
      daysSinceBackup,
      ordersSinceBackup,
      needsBackupAlert,
    };
  }

  exportBackupJson(): string {
    const customers = this.getCustomers();
    const orders = this.getOrders();
    const { googleMapsApiKey: _omitSecret, ...safeConfig } = this.getConfig();
    const nowIso = new Date().toISOString();

    if (this.isBrowser()) {
      localStorage.setItem(STORAGE_KEYS.LAST_BACKUP_AT, nowIso);
      this.write(STORAGE_KEYS.ORDERS_SINCE_BACKUP, 0);
    }

    const payload = {
      app: "SATRuta",
      version: "3.0",
      exportedAt: nowIso,
      data: {
        customers,
        orders,
        config: safeConfig,
      },
    };

    return JSON.stringify(payload, null, 2);
  }

  importBackupJson(jsonString: string): boolean {
    try {
      if (!jsonString || jsonString.length > 10 * 1024 * 1024) {
        throw new Error(
          "El archivo de backup supera el tamaño máximo permitido (10 MB)."
        );
      }

      const parsed = JSON.parse(jsonString);
      if (!parsed || typeof parsed !== "object" || !parsed.data) {
        throw new Error("Formato de backup inválido.");
      }

      const now = new Date().toISOString();

      if (Array.isArray(parsed.data.customers)) {
        const sanitizedCustomers: Customer[] = parsed.data.customers
          .slice(0, 5000)
          .map((c: any, idx: number): Customer | null => {
            if (!c || typeof c !== "object" || typeof c.name !== "string") {
              return null;
            }
            const lat = Number(c.coordinates?.lat);
            const lng = Number(c.coordinates?.lng);
            if (
              !Number.isFinite(lat) ||
              !Number.isFinite(lng) ||
              Math.abs(lat) > 90 ||
              Math.abs(lng) > 180
            ) {
              return null;
            }
            return {
              id: String(c.id || `cust-${Date.now()}-${idx}`).slice(0, 64),
              name: c.name.trim().slice(0, 140),
              village: String(c.village || "").trim().slice(0, 240),
              phone: String(c.phone || "").trim().slice(0, 40),
              coordinates: { lat, lng },
              equipmentInfo: String(c.equipmentInfo || "").trim().slice(0, 160),
              internalNotes: String(c.internalNotes || "").trim().slice(0, 500),
              lastServiceType:
                c.lastServiceType === "Avería" ||
                c.lastServiceType === "Instalación"
                  ? c.lastServiceType
                  : "Revisión",
              lastInterventionMinutes: Math.max(
                15,
                Math.min(480, Number(c.lastInterventionMinutes) || 45)
              ),
              lastServiceDate: String(
                c.lastServiceDate || c.fechaUltimoPedido || now
              ),
              totalServicesHistory: Math.max(
                0,
                Math.floor(
                  Number(c.totalServicesHistory ?? c.totalPedidosHistorico) || 0
                )
              ),
              totalBilledHistoryEur: Math.max(
                0,
                Number(c.totalBilledHistoryEur) || 0
              ),
              createdAt: String(c.createdAt || now),
              updatedAt: String(c.updatedAt || now),
            };
          })
          .filter((c: Customer | null): c is Customer => c !== null);

        this.write(STORAGE_KEYS.CUSTOMERS, sanitizedCustomers);
      }

      if (Array.isArray(parsed.data.orders)) {
        const validStatuses: ServiceOrder["status"][] = [
          "Pendiente",
          "En Ruta",
          "Completado",
          "Cancelado",
        ];
        const sanitizedOrders: ServiceOrder[] = parsed.data.orders
          .slice(0, 10000)
          .map((o: any, idx: number): ServiceOrder | null => {
            if (!o || typeof o !== "object" || !o.customer) return null;
            const lat = Number(o.customer?.coordinates?.lat);
            const lng = Number(o.customer?.coordinates?.lng);
            if (
              !Number.isFinite(lat) ||
              !Number.isFinite(lng) ||
              Math.abs(lat) > 90 ||
              Math.abs(lng) > 180
            ) {
              return null;
            }
            const status: ServiceOrder["status"] =
              o.status === "En Reparto"
                ? "En Ruta"
                : validStatuses.includes(o.status)
                ? o.status
                : "Pendiente";

            const serviceType: ServiceType =
              o.serviceType === "Avería" || o.serviceType === "Instalación"
                ? o.serviceType
                : "Revisión";

            return {
              id: String(o.id || `srv-${Date.now()}-${idx}`).slice(0, 64),
              customerId: String(o.customerId || o.customer.id || "").slice(
                0,
                64
              ),
              customer: {
                id: String(o.customer.id || `cust-${idx}`).slice(0, 64),
                name: String(o.customer.name || "Cliente").trim().slice(0, 140),
                village: String(o.customer.village || "").trim().slice(0, 240),
                phone: String(o.customer.phone || "").trim().slice(0, 40),
                coordinates: { lat, lng },
                equipmentInfo: String(o.customer.equipmentInfo || "")
                  .trim()
                  .slice(0, 160),
                internalNotes: String(o.customer.internalNotes || "")
                  .trim()
                  .slice(0, 500),
                createdAt: String(o.customer.createdAt || now),
                updatedAt: String(o.customer.updatedAt || now),
              },
              serviceType,
              priority: o.priority === "Urgente" ? "Urgente" : "Normal",
              equipmentInfo: String(
                o.equipmentInfo || o.customer.equipmentInfo || ""
              )
                .trim()
                .slice(0, 160),
              estimatedMinutes: Math.max(
                15,
                Math.min(480, Math.round(Number(o.estimatedMinutes) || 45))
              ),
              actualMinutes: o.actualMinutes
                ? Math.max(5, Math.min(480, Math.round(Number(o.actualMinutes))))
                : undefined,
              estimatedPriceEur: Math.max(
                0,
                Number(o.estimatedPriceEur) || 0
              ),
              collectedPriceEur:
                o.collectedPriceEur !== undefined
                  ? Math.max(0, Number(o.collectedPriceEur) || 0)
                  : undefined,
              technicalNotes: String(
                o.technicalNotes || o.orderNotes || ""
              )
                .trim()
                .slice(0, 500),
              resolutionNote: o.resolutionNote
                ? String(o.resolutionNote).trim().slice(0, 200)
                : undefined,
              concello: extractConcelloFromVillage(o.customer.village),
              createdAt: String(o.createdAt || now),
              status,
            };
          })
          .filter((o: ServiceOrder | null): o is ServiceOrder => o !== null);

        this.write(STORAGE_KEYS.ORDERS, sanitizedOrders);
      }

      if (parsed.data.config && typeof parsed.data.config === "object") {
        const rawCfg = parsed.data.config;
        const currentCfg = this.getConfig();
        const whLat = Number(rawCfg.warehouseCoordinates?.lat);
        const whLng = Number(rawCfg.warehouseCoordinates?.lng);

        const safeCfg: TechnicianConfig = {
          ...currentCfg,
          maxWorkdayMinutes: Math.max(
            60,
            Math.min(
              960,
              Number(rawCfg.maxWorkdayMinutes) || currentCfg.maxWorkdayMinutes
            )
          ),
          maxStopsPerRoute: Math.max(
            1,
            Math.min(
              30,
              Number(rawCfg.maxStopsPerRoute) || currentCfg.maxStopsPerRoute
            )
          ),
          workdayStartTime: String(
            rawCfg.workdayStartTime || currentCfg.workdayStartTime
          ).slice(0, 5),
          warehouseName: String(
            rawCfg.warehouseName || currentCfg.warehouseName
          )
            .trim()
            .slice(0, 140),
          warehouseVillage: String(
            rawCfg.warehouseVillage || currentCfg.warehouseVillage
          )
            .trim()
            .slice(0, 240),
          warehouseCoordinates: {
            lat:
              Number.isFinite(whLat) && Math.abs(whLat) <= 90
                ? whLat
                : currentCfg.warehouseCoordinates.lat,
            lng:
              Number.isFinite(whLng) && Math.abs(whLng) <= 180
                ? whLng
                : currentCfg.warehouseCoordinates.lng,
          },
          consumoL100: Math.max(
            2,
            Math.min(35, Number(rawCfg.consumoL100) || 7.5)
          ),
          precioCombustible: Math.max(
            0.3,
            Math.min(10, Number(rawCfg.precioCombustible) || 1.55)
          ),
          hourlyCostEur: Math.max(
            0,
            Math.min(300, Number(rawCfg.hourlyCostEur) || 0)
          ),
        };
        this.write(STORAGE_KEYS.CONFIG, safeCfg);
      }

      if (this.isBrowser()) {
        localStorage.setItem(STORAGE_KEYS.LAST_BACKUP_AT, now);
        this.write(STORAGE_KEYS.ORDERS_SINCE_BACKUP, 0);
      }

      return true;
    } catch (e) {
      console.error("Error importando backup:", e);
      throw e;
    }
  }

  clearAllData(): void {
    if (!this.isBrowser()) return;
    this.write(STORAGE_KEYS.CUSTOMERS, []);
    this.write(STORAGE_KEYS.ORDERS, []);
  }
}

export const galiciaStorage = new LocalFieldServiceStorage();
