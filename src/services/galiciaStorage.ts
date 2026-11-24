import {
  Customer,
  PendingOrder,
  OrderPriority,
  DecodedReturnReceipt,
  VanConfig,
  PELLET_GALICIA_RULES,
} from "@/types/pelletGalicia";
import { extractCashAndTagsFromNotes } from "@/utils/galiciaUrlCodec";

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

const STORAGE_KEYS = {
  CUSTOMERS: "pelletgalicia_customers_v2",
  ORDERS: "pelletgalicia_orders_v2",
  CONFIG: "pelletgalicia_vanconfig_v2",
  INITIALIZED: "pelletgalicia_empty_clean_v2",
  LAST_BACKUP_AT: "pelletgalicia_last_backup_at_v2",
  ORDERS_SINCE_BACKUP: "pelletgalicia_orders_since_backup_v2",
} as const;

export interface BackupAlertStatus {
  lastBackupAt: string | null;
  daysSinceBackup: number | null;
  ordersSinceBackup: number;
  needsBackupAlert: boolean;
}

export const DEFAULT_GALICIA_VAN_CONFIG: VanConfig = {
  vanCapacitySacks: PELLET_GALICIA_RULES.DEFAULT_VAN_CAPACITY_SACKS,
  maxWeightKg:
    PELLET_GALICIA_RULES.DEFAULT_VAN_CAPACITY_SACKS *
    PELLET_GALICIA_RULES.SACK_WEIGHT_KG,
  warehouseName: "Base Central PelletGalicia",
  warehouseVillage: "Polígono San Cibrao das Viñas, Parcela 14, Ourense",
  warehouseCoordinates: { lat: 42.2982, lng: -7.8185 },
  consumoVacioL100: PELLET_GALICIA_RULES.DEFAULT_CONSUMO_VACIO_L100,
  extraConsumoPorTonelada: PELLET_GALICIA_RULES.DEFAULT_EXTRA_CONSUMO_TONELADA,
  precioCombustible: PELLET_GALICIA_RULES.DEFAULT_PRECIO_COMBUSTIBLE,
  precioPorSaco: PELLET_GALICIA_RULES.DEFAULT_PRECIO_POR_SACO,
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

class LocalGaliciaStorageService {
  private isBrowser(): boolean {
    return typeof window !== "undefined";
  }

  private ensureSeeded(): void {
    if (!this.isBrowser()) return;

    // Purgar claves antiguas de prueba v1 si estuvieran guardadas en el navegador
    if (localStorage.getItem("pelletgalicia_seeded_v1")) {
      try {
        localStorage.removeItem("pelletgalicia_customers_v1");
        localStorage.removeItem("pelletgalicia_orders_v1");
        localStorage.removeItem("pelletgalicia_seeded_v1");
      } catch (e) {
        console.warn("Error limpiando v1:", e);
      }
    }

    const seeded = localStorage.getItem(STORAGE_KEYS.INITIALIZED);
    if (!seeded) {
      // BASE DE DATOS TOTALMENTE VACÍA
      localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify([]));
      localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify([]));
      localStorage.setItem(
        STORAGE_KEYS.CONFIG,
        JSON.stringify(DEFAULT_GALICIA_VAN_CONFIG)
      );
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

  // --- CLIENTES ---
  getCustomers(): Customer[] {
    const rawCustomers = this.read<Customer[]>(STORAGE_KEYS.CUSTOMERS, []);
    const allOrders = this.read<PendingOrder[]>(STORAGE_KEYS.ORDERS, []);
    let needsWrite = false;

    const enriched = rawCustomers.map((c) => {
      if (
        c.ultimosSacos !== undefined &&
        c.totalPedidosHistorico !== undefined
      ) {
        return c;
      }

      const custOrders = allOrders
        .filter(
          (o) =>
            o.customerId === c.id ||
            normalizeGaliciaText(o.customer?.name) ===
              normalizeGaliciaText(c.name)
        )
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

      if (custOrders.length > 0) {
        needsWrite = true;
        const latest = custOrders[0];
        return {
          ...c,
          ultimosSacos: c.ultimosSacos ?? latest.sacks,
          fechaUltimoPedido: c.fechaUltimoPedido ?? latest.createdAt,
          totalPedidosHistorico: c.totalPedidosHistorico ?? custOrders.length,
          totalSacosHistorico:
            c.totalSacosHistorico ??
            custOrders.reduce((sum, o) => sum + o.sacks, 0),
          internalNotes: c.internalNotes || latest.orderNotes || "",
        };
      }

      return {
        ...c,
        ultimosSacos: c.ultimosSacos ?? 30,
        fechaUltimoPedido: c.fechaUltimoPedido ?? c.updatedAt,
        totalPedidosHistorico: c.totalPedidosHistorico ?? 0,
        totalSacosHistorico: c.totalSacosHistorico ?? 0,
      };
    });

    if (needsWrite) {
      this.write(STORAGE_KEYS.CUSTOMERS, enriched);
    }

    return enriched;
  }

  /**
   * Busca si ya existe un cliente por ID, nombre normalizado (sin tildes/mayúsculas)
   * o teléfono normalizado (mínimo 6 dígitos) para evitar duplicados.
   */
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

    // Prevención inteligente de duplicados por ID, nombre normalizado o teléfono
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
      internalNotes:
        customerData.internalNotes?.trim() !== undefined &&
        customerData.internalNotes.trim() !== ""
          ? customerData.internalNotes.trim()
          : existing?.internalNotes || "",
      ultimosSacos: customerData.ultimosSacos ?? existing?.ultimosSacos ?? 30,
      fechaUltimoPedido:
        customerData.fechaUltimoPedido ?? existing?.fechaUltimoPedido ?? now,
      totalPedidosHistorico:
        customerData.totalPedidosHistorico ??
        existing?.totalPedidosHistorico ??
        0,
      totalSacosHistorico:
        customerData.totalSacosHistorico ?? existing?.totalSacosHistorico ?? 0,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    if (idx >= 0) {
      list[idx] = customer;
      // Sincronizar snapshot en los pedidos existentes del cliente
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

    // Eliminar también cualquier pedido asociado
    const orders = this.getOrders().filter((o) => o.customerId !== id);
    this.write(STORAGE_KEYS.ORDERS, orders);
  }

  // --- PEDIDOS ---
  getOrders(): PendingOrder[] {
    return this.read<PendingOrder[]>(STORAGE_KEYS.ORDERS, []);
  }

  getPendingOrders(): PendingOrder[] {
    return this.getOrders().filter((o) => o.status === "Pendiente");
  }

  saveOrder(
    customerId: string,
    sacks: number,
    orderNotes?: string,
    priority: OrderPriority = "Normal"
  ): PendingOrder {
    const customers = this.getCustomers();
    const custIdx = customers.findIndex((c) => c.id === customerId);
    if (custIdx === -1) throw new Error("Cliente no encontrado");

    const now = new Date().toISOString();
    const existingCust = customers[custIdx];
    const resolvedNotes =
      orderNotes?.trim() !== undefined && orderNotes.trim() !== ""
        ? orderNotes.trim()
        : existingCust.internalNotes || "";

    const { cashToCollectEur } = extractCashAndTagsFromNotes(resolvedNotes);

    // Actualizar estadísticas históricas de la ficha del cliente
    const updatedCustomer: Customer = {
      ...existingCust,
      ultimosSacos: sacks,
      fechaUltimoPedido: now,
      totalPedidosHistorico: (existingCust.totalPedidosHistorico || 0) + 1,
      totalSacosHistorico: (existingCust.totalSacosHistorico || 0) + sacks,
      internalNotes: resolvedNotes,
      updatedAt: now,
    };

    customers[custIdx] = updatedCustomer;
    this.write(STORAGE_KEYS.CUSTOMERS, customers);

    const orders = this.getOrders().map((o) =>
      o.customerId === customerId ? { ...o, customer: updatedCustomer } : o
    );

    const order: PendingOrder = {
      id: `ord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      customerId,
      customer: updatedCustomer,
      sacks,
      totalWeightKg: sacks * PELLET_GALICIA_RULES.SACK_WEIGHT_KG,
      orderNotes: resolvedNotes,
      priority,
      concello: extractConcelloFromVillage(updatedCustomer.village),
      cashToCollectEur: cashToCollectEur > 0 ? cashToCollectEur : undefined,
      createdAt: now,
      status: "Pendiente",
    };

    orders.unshift(order);
    this.write(STORAGE_KEYS.ORDERS, orders);

    // Incrementar contador de pedidos nuevos desde el último backup
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
      sacks?: number;
      orderNotes?: string;
      priority?: OrderPriority;
      status?: PendingOrder["status"];
    }
  ): PendingOrder | null {
    const orders = this.getOrders();
    const idx = orders.findIndex((o) => o.id === id);
    if (idx === -1) return null;

    const current = orders[idx];
    const sacks =
      updates.sacks !== undefined ? Math.max(1, updates.sacks) : current.sacks;
    const sacksDiff = sacks - current.sacks;
    const updatedNotes =
      updates.orderNotes !== undefined
        ? updates.orderNotes.trim()
        : current.orderNotes;
    const { cashToCollectEur } = extractCashAndTagsFromNotes(updatedNotes);

    // Sincronizar ficha del cliente habitual
    const customers = this.getCustomers();
    const custIdx = customers.findIndex((c) => c.id === current.customerId);
    let updatedCustomer = current.customer;

    if (custIdx >= 0) {
      const c = customers[custIdx];
      updatedCustomer = {
        ...c,
        ultimosSacos: sacks,
        totalSacosHistorico: Math.max(
          sacks,
          (c.totalSacosHistorico || current.sacks) + sacksDiff
        ),
        internalNotes: updatedNotes || c.internalNotes || "",
        updatedAt: new Date().toISOString(),
      };
      customers[custIdx] = updatedCustomer;
      this.write(STORAGE_KEYS.CUSTOMERS, customers);
    }

    const updated: PendingOrder = {
      ...current,
      customer: updatedCustomer,
      sacks,
      totalWeightKg: sacks * PELLET_GALICIA_RULES.SACK_WEIGHT_KG,
      orderNotes: updatedNotes,
      priority: updates.priority ?? current.priority ?? "Normal",
      concello: extractConcelloFromVillage(updatedCustomer.village),
      cashToCollectEur: cashToCollectEur > 0 ? cashToCollectEur : undefined,
      status: updates.status ?? current.status,
    };

    orders[idx] = updated;
    this.write(STORAGE_KEYS.ORDERS, orders);
    return updated;
  }

  updateOrderSacks(
    id: string,
    deltaOrExact: number,
    isDelta = false
  ): PendingOrder | null {
    const orders = this.getOrders();
    const idx = orders.findIndex((o) => o.id === id);
    if (idx === -1) return null;

    const current = orders[idx];
    const sacks = isDelta
      ? Math.max(1, current.sacks + deltaOrExact)
      : Math.max(1, deltaOrExact);
    const sacksDiff = sacks - current.sacks;

    const customers = this.getCustomers();
    const custIdx = customers.findIndex((c) => c.id === current.customerId);
    let updatedCustomer = current.customer;

    if (custIdx >= 0) {
      const c = customers[custIdx];
      updatedCustomer = {
        ...c,
        ultimosSacos: sacks,
        totalSacosHistorico: Math.max(
          sacks,
          (c.totalSacosHistorico || current.sacks) + sacksDiff
        ),
        updatedAt: new Date().toISOString(),
      };
      customers[custIdx] = updatedCustomer;
      this.write(STORAGE_KEYS.CUSTOMERS, customers);
    }

    const updated: PendingOrder = {
      ...current,
      customer: updatedCustomer,
      sacks,
      totalWeightKg: sacks * PELLET_GALICIA_RULES.SACK_WEIGHT_KG,
    };

    orders[idx] = updated;
    this.write(STORAGE_KEYS.ORDERS, orders);
    return updated;
  }

  deleteOrder(id: string): void {
    const orders = this.getOrders().filter((o) => o.id !== id);
    this.write(STORAGE_KEYS.ORDERS, orders);
  }

  updateOrderStatus(id: string, status: PendingOrder["status"]): void {
    const allOrders = this.getOrders();
    const target = allOrders.find((o) => o.id === id);
    if (target && status === "Completado") {
      const customers = this.getCustomers();
      const custIdx = customers.findIndex((c) => c.id === target.customerId);
      if (custIdx >= 0) {
        customers[custIdx] = {
          ...customers[custIdx],
          ultimosSacos: target.sacks,
          fechaUltimoPedido: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        this.write(STORAGE_KEYS.CUSTOMERS, customers);
      }
    }

    const orders = allOrders.map((o) =>
      o.id === id ? { ...o, status } : o
    );
    this.write(STORAGE_KEYS.ORDERS, orders);
  }

  markOrdersDelivered(orderIds: string[]): void {
    const allOrders = this.getOrders();
    const customers = this.getCustomers();
    const now = new Date().toISOString();
    let customersUpdated = false;

    allOrders.forEach((o) => {
      if (orderIds.includes(o.id)) {
        const custIdx = customers.findIndex((c) => c.id === o.customerId);
        if (custIdx >= 0) {
          customers[custIdx] = {
            ...customers[custIdx],
            ultimosSacos: o.sacks,
            fechaUltimoPedido: now,
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
      orderIds.includes(o.id) ? { ...o, status: "Completado" as const } : o
    );
    this.write(STORAGE_KEYS.ORDERS, orders);
  }

  markOrdersAsDelivered(orderIds: string[]): void {
    this.markOrdersDelivered(orderIds);
  }

  /**
   * Marca un conjunto de pedidos como "En Reparto" al despachar el viaje al chofer.
   */
  markOrdersInDelivery(orderIds: string[]): void {
    const now = new Date().toISOString();
    const orders = this.getOrders().map((o) =>
      orderIds.includes(o.id)
        ? { ...o, status: "En Reparto" as const, dispatchedAt: now }
        : o
    );
    this.write(STORAGE_KEYS.ORDERS, orders);
  }

  /**
   * Concilia un recibo de cierre Zero-Cloud (/reparto -> /admin) cruzando los IDs cortos de 6 caracteres.
   */
  reconcileReturnReceipt(receipt: DecodedReturnReceipt): {
    matchedOrderIds: string[];
    totalSacksUpdated: number;
    totalCashRecordedEur: number;
  } {
    const allOrders = this.getOrders();
    const customers = this.getCustomers();
    const now = new Date().toISOString();

    const matchedOrderIds: string[] = [];
    let totalSacksUpdated = 0;
    let totalCashRecordedEur = 0;
    let customersChanged = false;

    const updatedOrders = allOrders.map((ord) => {
      const ordShortId = ord.id.replace(/^(eph-|ord-)/g, "").slice(-6);
      const item = receipt.deliveredItems.find(
        (it) =>
          it.shortId === ordShortId ||
          ord.id.endsWith(it.shortId) ||
          it.shortId.endsWith(ordShortId)
      );

      if (!item) return ord;

      matchedOrderIds.push(ord.id);
      totalSacksUpdated += item.sacks;
      totalCashRecordedEur += item.cashCollectedEur;

      const custIdx = customers.findIndex((c) => c.id === ord.customerId);
      if (custIdx >= 0) {
        customers[custIdx] = {
          ...customers[custIdx],
          ultimosSacos: item.sacks,
          fechaUltimoPedido: now,
          updatedAt: now,
        };
        customersChanged = true;
      }

      return {
        ...ord,
        sacks: item.sacks,
        totalWeightKg: item.sacks * PELLET_GALICIA_RULES.SACK_WEIGHT_KG,
        status: "Completado" as const,
        deliveredAt: now,
        cashCollectedEur: item.cashCollectedEur,
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
      totalSacksUpdated,
      totalCashRecordedEur: Number(totalCashRecordedEur.toFixed(2)),
    };
  }

  // --- CONFIGURACIÓN ---
  getConfig(): VanConfig {
    const raw = this.read<VanConfig>(
      STORAGE_KEYS.CONFIG,
      DEFAULT_GALICIA_VAN_CONFIG
    );
    return {
      ...DEFAULT_GALICIA_VAN_CONFIG,
      ...raw,
      consumoVacioL100:
        raw.consumoVacioL100 ?? PELLET_GALICIA_RULES.DEFAULT_CONSUMO_VACIO_L100,
      extraConsumoPorTonelada:
        raw.extraConsumoPorTonelada ??
        PELLET_GALICIA_RULES.DEFAULT_EXTRA_CONSUMO_TONELADA,
      precioCombustible:
        raw.precioCombustible ??
        PELLET_GALICIA_RULES.DEFAULT_PRECIO_COMBUSTIBLE,
      precioPorSaco:
        raw.precioPorSaco ?? PELLET_GALICIA_RULES.DEFAULT_PRECIO_POR_SACO,
    };
  }

  saveConfig(partial: Partial<VanConfig>): VanConfig {
    const current = this.getConfig();
    const capacity = partial.vanCapacitySacks ?? current.vanCapacitySacks;
    const updated: VanConfig = {
      ...current,
      ...partial,
      vanCapacitySacks: capacity,
      maxWeightKg: capacity * PELLET_GALICIA_RULES.SACK_WEIGHT_KG,
    };
    this.write(STORAGE_KEYS.CONFIG, updated);
    return updated;
  }

  // --- BACKUP SEGURO JSON & ALERTAS DE SEGURIDAD ---
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

    // Alerta si han pasado > 7 días o se han añadido > 10 pedidos nuevos sin exportar
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
      app: "PelletGalicia",
      version: "2.0",
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
        throw new Error("El archivo de backup supera el tamaño máximo permitido (10 MB).");
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
              internalNotes: String(c.internalNotes || "").trim().slice(0, 500),
              ultimosSacos: Math.max(
                1,
                Math.min(500, Math.floor(Number(c.ultimosSacos) || 30))
              ),
              fechaUltimoPedido: String(c.fechaUltimoPedido || now),
              totalPedidosHistorico: Math.max(
                0,
                Math.floor(Number(c.totalPedidosHistorico) || 0)
              ),
              totalSacosHistorico: Math.max(
                0,
                Math.floor(Number(c.totalSacosHistorico) || 0)
              ),
              createdAt: String(c.createdAt || now),
              updatedAt: String(c.updatedAt || now),
            };
          })
          .filter((c: Customer | null): c is Customer => c !== null);

        this.write(STORAGE_KEYS.CUSTOMERS, sanitizedCustomers);
      }

      if (Array.isArray(parsed.data.orders)) {
        const sanitizedOrders: PendingOrder[] = parsed.data.orders
          .slice(0, 10000)
          .map((o: any, idx: number): PendingOrder | null => {
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
            const sacks = Math.max(
              1,
              Math.min(500, Math.floor(Number(o.sacks) || 1))
            );
            const validStatuses: PendingOrder["status"][] = [
              "Pendiente",
              "En Reparto",
              "Completado",
              "Cancelado",
            ];
            const status: PendingOrder["status"] =
              o.status === "En Ruta"
                ? "En Reparto"
                : validStatuses.includes(o.status)
                ? o.status
                : "Pendiente";

            return {
              id: String(o.id || `ord-${Date.now()}-${idx}`).slice(0, 64),
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
                internalNotes: String(o.customer.internalNotes || "")
                  .trim()
                  .slice(0, 500),
                createdAt: String(o.customer.createdAt || now),
                updatedAt: String(o.customer.updatedAt || now),
              },
              sacks,
              totalWeightKg: sacks * PELLET_GALICIA_RULES.SACK_WEIGHT_KG,
              orderNotes: String(o.orderNotes || "").trim().slice(0, 500),
              createdAt: String(o.createdAt || now),
              status,
            };
          })
          .filter((o: PendingOrder | null): o is PendingOrder => o !== null);

        this.write(STORAGE_KEYS.ORDERS, sanitizedOrders);
      }

      if (parsed.data.config && typeof parsed.data.config === "object") {
        const rawCfg = parsed.data.config;
        const currentCfg = this.getConfig();
        const cap = Math.max(
          10,
          Math.min(
            500,
            Math.floor(
              Number(rawCfg.vanCapacitySacks) || currentCfg.vanCapacitySacks
            )
          )
        );
        const whLat = Number(rawCfg.warehouseCoordinates?.lat);
        const whLng = Number(rawCfg.warehouseCoordinates?.lng);

        const safeCfg: VanConfig = {
          ...currentCfg,
          vanCapacitySacks: cap,
          maxWeightKg: cap * PELLET_GALICIA_RULES.SACK_WEIGHT_KG,
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
          consumoVacioL100: Math.max(
            2,
            Math.min(40, Number(rawCfg.consumoVacioL100) || 8.5)
          ),
          extraConsumoPorTonelada: Math.max(
            0,
            Math.min(20, Number(rawCfg.extraConsumoPorTonelada) || 2.2)
          ),
          precioCombustible: Math.max(
            0.3,
            Math.min(10, Number(rawCfg.precioCombustible) || 1.55)
          ),
          precioPorSaco: Math.max(
            0.5,
            Math.min(50, Number(rawCfg.precioPorSaco) || 4.5)
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

  // Vaciar completamente la base de datos (0 clientes y 0 pedidos)
  clearAllData(): void {
    if (!this.isBrowser()) return;
    this.write(STORAGE_KEYS.CUSTOMERS, []);
    this.write(STORAGE_KEYS.ORDERS, []);
  }

  resetDemoData(): void {
    this.clearAllData();
  }
}

export const galiciaStorage = new LocalGaliciaStorageService();
