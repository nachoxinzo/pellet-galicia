import {
  Client,
  Order,
  Vehicle,
  DeliveryRoute,
  RouteStop,
  OrderFormInput,
  WarehouseLocation,
  calculateOrderMetrics,
} from "@/types/pellet";

const STORAGE_KEYS = {
  CLIENTS: "pelletroute_clients_v1",
  ORDERS: "pelletroute_orders_v1",
  VEHICLES: "pelletroute_vehicles_v1",
  ROUTES: "pelletroute_routes_v1",
  WAREHOUSE: "pelletroute_warehouse_v1",
  INITIALIZED: "pelletroute_seeded_v1",
} as const;

export const DEFAULT_WAREHOUSE: WarehouseLocation = {
  name: "Almacén Central PelletRoute (Base)",
  address: "Polígono Industrial La Estación, Parcela 12, Collado Villalba, Madrid",
  coordinates: {
    lat: 40.6305,
    lng: -4.0042,
  },
};

/**
 * Interfaz del contrato del repositorio de datos.
 * Diseñada con métodos que permiten migración directa a Supabase / PostgreSQL.
 */
export interface IPelletRepository {
  getOrders(): Order[];
  saveOrderFromForm(input: OrderFormInput): Order;
  deleteOrder(orderId: string): void;
  updateOrderStatus(orderId: string, status: Order["status"]): void;

  getClients(): Client[];

  getVehicles(): Vehicle[];
  saveVehicle(
    vehicleData: Omit<Vehicle, "id" | "createdAt" | "updatedAt"> & { id?: string }
  ): Vehicle;
  deleteVehicle(vehicleId: string): void;
  toggleVehicleAvailability(vehicleId: string): void;

  getRoutes(): DeliveryRoute[];
  saveRoute(route: DeliveryRoute): DeliveryRoute;
  deleteRoute(routeId: string): void;
  updateRouteStop(
    routeId: string,
    stopId: string,
    updates: Partial<RouteStop>
  ): DeliveryRoute | null;

  getWarehouse(): WarehouseLocation;
  saveWarehouse(warehouse: WarehouseLocation): WarehouseLocation;

  resetDemoData(): void;
}

const INITIAL_CLIENTS: Client[] = [
  {
    id: "cli-1",
    name: "Carlos Mendoza (Chalet Sierra)",
    phone: "612 345 678",
    address: "Camino del Robledal 14, La Moraleja / Sierra Norte",
    coordinates: { lat: 40.6352, lng: -3.7021 },
    unloadingNotes: "Acceso estrecho, necesita transpaleta manual. Dejar en garaje.",
    preferredTimeWindow: "Mañana",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "cli-2",
    name: "Hotel Rural Valle del Pino",
    phone: "698 112 233",
    address: "Carretera Comarcal M-601 Km 12.4, Navacerrada",
    coordinates: { lat: 40.7289, lng: -4.0135 },
    unloadingNotes: "Entrada amplia para camión con plataforma. Descargar junto a sala de calderas.",
    preferredTimeWindow: "Mañana",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "cli-3",
    name: "Elena Gómez",
    phone: "655 908 712",
    address: "Calle de las Encinas 8, Urb. Montealegre",
    coordinates: { lat: 40.5891, lng: -3.8912 },
    unloadingNotes: "Rampa con ligera pendiente, avisar 15 min antes por teléfono.",
    preferredTimeWindow: "Tarde",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "cli-4",
    name: "Panadería Artesana Horno de Leña",
    phone: "633 445 566",
    address: "Plaza Mayor 3, Collado Villalba",
    coordinates: { lat: 40.6448, lng: -4.0065 },
    unloadingNotes: "Zona peatonal restringida después de las 11:30h. Necesita transpaleta eléctrica.",
    preferredTimeWindow: "Mañana",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const INITIAL_ORDERS: Order[] = [
  {
    id: "ord-101",
    clientId: "cli-1",
    client: INITIAL_CLIENTS[0],
    pallets: 1,
    looseSacks: 15,
    totalSacksCount: 85,
    totalWeightKg: 1275, // 1050 + 225
    equivalentPallets: 1.21,
    status: "Pendiente",
    requestedDeliveryDate: new Date().toISOString().split("T")[0],
    orderNotes: "Pellets ENplus A1 pino albar.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "ord-102",
    clientId: "cli-2",
    client: INITIAL_CLIENTS[1],
    pallets: 2,
    looseSacks: 0,
    totalSacksCount: 140,
    totalWeightKg: 2100, // 2 * 1050
    equivalentPallets: 2.0,
    status: "Pendiente",
    requestedDeliveryDate: new Date().toISOString().split("T")[0],
    orderNotes: "Urgente para reserva de fin de semana.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "ord-103",
    clientId: "cli-3",
    client: INITIAL_CLIENTS[2],
    pallets: 0,
    looseSacks: 40,
    totalSacksCount: 40,
    totalWeightKg: 600, // 40 * 15
    equivalentPallets: 0.57,
    status: "Pendiente",
    requestedDeliveryDate: new Date().toISOString().split("T")[0],
    orderNotes: "Ayudar a apilar sacos sueltos bajo porche cubierto.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "ord-104",
    clientId: "cli-4",
    client: INITIAL_CLIENTS[3],
    pallets: 1,
    looseSacks: 0,
    totalSacksCount: 70,
    totalWeightKg: 1050,
    equivalentPallets: 1.0,
    status: "Pendiente",
    requestedDeliveryDate: new Date().toISOString().split("T")[0],
    orderNotes: "Entregar factura física firmada.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const INITIAL_VEHICLES: Vehicle[] = [
  {
    id: "veh-1",
    name: "Camión Ligero Iveco Daily Plataforma",
    licensePlate: "4821 MJK",
    maxWeightKg: 3500,
    maxPallets: 3,
    hasTailLift: true,
    isAvailable: true,
    notes: "Equipada con transpaleta eléctrica todoterreno.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "veh-2",
    name: "Camión Rígido MAN TGL (Gran Tonelaje)",
    licensePlate: "9104 LRP",
    maxWeightKg: 6500,
    maxPallets: 6,
    hasTailLift: true,
    isAvailable: true,
    notes: "No apto para calles con giro muy cerrado (< 4m).",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "veh-3",
    name: "Furgón Renault Master Reparto Rápido",
    licensePlate: "2390 KTW",
    maxWeightKg: 1450,
    maxPallets: 1,
    hasTailLift: false,
    isAvailable: true,
    notes: "Ideal para pedidos de sacos sueltos y accesos estrechos.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

class LocalStoragePelletRepository implements IPelletRepository {
  private isBrowser(): boolean {
    return typeof window !== "undefined";
  }

  private ensureSeeded(): void {
    if (!this.isBrowser()) return;
    const seeded = localStorage.getItem(STORAGE_KEYS.INITIALIZED);
    if (!seeded) {
      localStorage.setItem(STORAGE_KEYS.CLIENTS, JSON.stringify(INITIAL_CLIENTS));
      localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(INITIAL_ORDERS));
      localStorage.setItem(STORAGE_KEYS.VEHICLES, JSON.stringify(INITIAL_VEHICLES));
      localStorage.setItem(STORAGE_KEYS.ROUTES, JSON.stringify([]));
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

  getClients(): Client[] {
    return this.read<Client[]>(STORAGE_KEYS.CLIENTS, INITIAL_CLIENTS);
  }

  getOrders(): Order[] {
    return this.read<Order[]>(STORAGE_KEYS.ORDERS, INITIAL_ORDERS);
  }

  saveOrderFromForm(input: OrderFormInput): Order {
    const clients = this.getClients();
    const orders = this.getOrders();
    const now = new Date().toISOString();

    const metrics = calculateOrderMetrics(input.pallets, input.looseSacks);

    // 1. Upsert del Cliente
    const clientId = input.clientId || `cli-${Date.now()}`;
    const clientObj: Client = {
      id: clientId,
      name: input.clientName.trim(),
      phone: input.clientPhone.trim(),
      address: input.clientAddress.trim(),
      coordinates: {
        lat: Number(input.lat) || 40.4168,
        lng: Number(input.lng) || -3.7038,
      },
      unloadingNotes: input.unloadingNotes.trim(),
      preferredTimeWindow: input.preferredTimeWindow,
      createdAt: now,
      updatedAt: now,
    };

    const existingClientIndex = clients.findIndex((c) => c.id === clientId);
    if (existingClientIndex >= 0) {
      clientObj.createdAt = clients[existingClientIndex].createdAt;
      clients[existingClientIndex] = clientObj;
    } else {
      clients.unshift(clientObj);
    }
    this.write(STORAGE_KEYS.CLIENTS, clients);

    // 2. Upsert del Pedido
    const orderId = input.orderId || `ord-${Math.floor(100 + Math.random() * 900)}-${Date.now().toString().slice(-3)}`;
    const existingOrderIndex = orders.findIndex((o) => o.id === orderId);

    const orderObj: Order = {
      id: orderId,
      clientId: clientObj.id,
      client: clientObj,
      pallets: metrics.pallets,
      looseSacks: metrics.looseSacks,
      totalSacksCount: metrics.totalSacksCount,
      totalWeightKg: metrics.totalWeightKg,
      equivalentPallets: metrics.equivalentPallets,
      status:
        existingOrderIndex >= 0 ? orders[existingOrderIndex].status : "Pendiente",
      requestedDeliveryDate:
        input.requestedDeliveryDate || now.split("T")[0],
      orderNotes: input.orderNotes?.trim() || "",
      createdAt:
        existingOrderIndex >= 0 ? orders[existingOrderIndex].createdAt : now,
      updatedAt: now,
    };

    if (existingOrderIndex >= 0) {
      orders[existingOrderIndex] = orderObj;
    } else {
      orders.unshift(orderObj);
    }

    this.write(STORAGE_KEYS.ORDERS, orders);
    return orderObj;
  }

  deleteOrder(orderId: string): void {
    const orders = this.getOrders().filter((o) => o.id !== orderId);
    this.write(STORAGE_KEYS.ORDERS, orders);
  }

  updateOrderStatus(orderId: string, status: Order["status"]): void {
    const orders = this.getOrders().map((o) =>
      o.id === orderId ? { ...o, status, updatedAt: new Date().toISOString() } : o
    );
    this.write(STORAGE_KEYS.ORDERS, orders);
  }

  getVehicles(): Vehicle[] {
    return this.read<Vehicle[]>(STORAGE_KEYS.VEHICLES, INITIAL_VEHICLES);
  }

  saveVehicle(
    vehicleData: Omit<Vehicle, "id" | "createdAt" | "updatedAt"> & { id?: string }
  ): Vehicle {
    const vehicles = this.getVehicles();
    const now = new Date().toISOString();
    const id = vehicleData.id || `veh-${Date.now()}`;
    const existingIdx = vehicles.findIndex((v) => v.id === id);

    const newVehicle: Vehicle = {
      id,
      name: vehicleData.name.trim(),
      licensePlate: vehicleData.licensePlate?.trim() || "",
      maxWeightKg: Number(vehicleData.maxWeightKg) || 3500,
      maxPallets: Number(vehicleData.maxPallets) || 3,
      hasTailLift: Boolean(vehicleData.hasTailLift),
      isAvailable: vehicleData.isAvailable ?? true,
      notes: vehicleData.notes?.trim() || "",
      createdAt: existingIdx >= 0 ? vehicles[existingIdx].createdAt : now,
      updatedAt: now,
    };

    if (existingIdx >= 0) {
      vehicles[existingIdx] = newVehicle;
    } else {
      vehicles.push(newVehicle);
    }

    this.write(STORAGE_KEYS.VEHICLES, vehicles);
    return newVehicle;
  }

  deleteVehicle(vehicleId: string): void {
    const vehicles = this.getVehicles().filter((v) => v.id !== vehicleId);
    this.write(STORAGE_KEYS.VEHICLES, vehicles);
  }

  toggleVehicleAvailability(vehicleId: string): void {
    const vehicles = this.getVehicles().map((v) =>
      v.id === vehicleId
        ? { ...v, isAvailable: !v.isAvailable, updatedAt: new Date().toISOString() }
        : v
    );
    this.write(STORAGE_KEYS.VEHICLES, vehicles);
  }

  getRoutes(): DeliveryRoute[] {
    return this.read<DeliveryRoute[]>(STORAGE_KEYS.ROUTES, []);
  }

  saveRoute(route: DeliveryRoute): DeliveryRoute {
    const routes = this.getRoutes();
    const idx = routes.findIndex((r) => r.id === route.id);
    if (idx >= 0) {
      routes[idx] = route;
    } else {
      routes.unshift(route);
    }
    this.write(STORAGE_KEYS.ROUTES, routes);
    return route;
  }

  deleteRoute(routeId: string): void {
    const routes = this.getRoutes().filter((r) => r.id !== routeId);
    this.write(STORAGE_KEYS.ROUTES, routes);
  }

  updateRouteStop(
    routeId: string,
    stopId: string,
    updates: Partial<RouteStop>
  ): DeliveryRoute | null {
    const routes = this.getRoutes();
    const route = routes.find((r) => r.id === routeId);
    if (!route) return null;

    route.stops = route.stops.map((s) =>
      s.id === stopId ? { ...s, ...updates } : s
    );

    // Si todas las paradas están completadas, marcar la ruta como Completada
    const allDone = route.stops.every((s) => s.completed);
    if (allDone) {
      route.status = "Completada";
    } else {
      route.status = "En Curso";
    }

    route.updatedAt = new Date().toISOString();
    this.write(STORAGE_KEYS.ROUTES, routes);

    // Actualizar también el estado del pedido individual
    const updatedStop = route.stops.find((s) => s.id === stopId);
    if (updatedStop && updates.status) {
      if (updates.status === "Entregado") {
        this.updateOrderStatus(updatedStop.orderId, "Entregado");
      } else if (updates.status === "Incidencia") {
        this.updateOrderStatus(updatedStop.orderId, "Incidencia");
      }
    }

    return route;
  }

  getWarehouse(): WarehouseLocation {
    return this.read<WarehouseLocation>(
      STORAGE_KEYS.WAREHOUSE,
      DEFAULT_WAREHOUSE
    );
  }

  saveWarehouse(warehouse: WarehouseLocation): WarehouseLocation {
    this.write(STORAGE_KEYS.WAREHOUSE, warehouse);
    return warehouse;
  }

  resetDemoData(): void {
    if (!this.isBrowser()) return;
    localStorage.removeItem(STORAGE_KEYS.INITIALIZED);
    localStorage.removeItem(STORAGE_KEYS.WAREHOUSE);
    this.ensureSeeded();
  }
}

export const pelletRepository: IPelletRepository =
  new LocalStoragePelletRepository();
