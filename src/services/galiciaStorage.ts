import {
  Customer,
  PendingOrder,
  VanConfig,
  PELLET_GALICIA_RULES,
} from "@/types/pelletGalicia";

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
    orderNotes?: string
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
    const config = this.getConfig();
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
        config,
      },
    };

    return JSON.stringify(payload, null, 2);
  }

  importBackupJson(jsonString: string): boolean {
    try {
      const parsed = JSON.parse(jsonString);
      if (!parsed.data) throw new Error("Formato de backup inválido.");

      if (Array.isArray(parsed.data.customers)) {
        this.write(STORAGE_KEYS.CUSTOMERS, parsed.data.customers);
      }
      if (Array.isArray(parsed.data.orders)) {
        this.write(STORAGE_KEYS.ORDERS, parsed.data.orders);
      }
      if (parsed.data.config) {
        this.write(STORAGE_KEYS.CONFIG, parsed.data.config);
      }

      if (this.isBrowser()) {
        localStorage.setItem(
          STORAGE_KEYS.LAST_BACKUP_AT,
          new Date().toISOString()
        );
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
