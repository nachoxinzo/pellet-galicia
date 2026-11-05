import { Order, Vehicle, WarehouseLocation } from "@/types/pellet";
import { haversineDistanceKm } from "./osrmRouting";

export interface OptimizedTrip {
  tripNumber: number; // 1, 2...
  orders: Order[];
  totalWeightKg: number;
  totalPallets: number;
  totalSacks: number;
}

export interface OptimizationResult {
  trips: OptimizedTrip[];
  exceededCapacity: boolean;
  totalOrders: number;
  vehicle: Vehicle;
}

/**
 * Ordena las órdenes de un viaje utilizando una heurística de Vecino Más Cercano (Nearest Neighbor)
 * combinada con restricciones de ventana horaria (Mañana prioritario sobre Tarde/Indiferente).
 * Trayecto: Almacén -> [Paradas ordenadas] -> Almacén.
 */
export function solveTspForTrip(
  orders: Order[],
  warehouse: WarehouseLocation
): Order[] {
  if (orders.length <= 1) return [...orders];

  const remaining = [...orders];
  const sorted: Order[] = [];
  let currentCoords = warehouse.coordinates;

  // Clasificamos por ventana horaria para no mezclar mañanas y tardes de forma incoherente
  // Fase 1: Pedidos con preferencia "Mañana"
  // Fase 2: Pedidos con preferencia "Indiferente"
  // Fase 3: Pedidos con preferencia "Tarde"
  const phases = ["Mañana", "Indiferente", "Tarde"] as const;

  for (const phase of phases) {
    while (true) {
      const candidates = remaining.filter(
        (o) => o.client.preferredTimeWindow === phase
      );
      if (candidates.length === 0) break;

      // Buscamos el candidato más cercano al punto actual
      let bestIdx = -1;
      let minDistance = Infinity;

      for (let i = 0; i < candidates.length; i++) {
        const d = haversineDistanceKm(
          currentCoords,
          candidates[i].client.coordinates
        );
        if (d < minDistance) {
          minDistance = d;
          bestIdx = remaining.indexOf(candidates[i]);
        }
      }

      if (bestIdx >= 0) {
        const [nextOrder] = remaining.splice(bestIdx, 1);
        sorted.push(nextOrder);
        currentCoords = nextOrder.client.coordinates;
      } else {
        break;
      }
    }
  }

  // Si queda algún pedido residual sin clasificar
  while (remaining.length > 0) {
    let bestIdx = 0;
    let minDistance = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineDistanceKm(
        currentCoords,
        remaining[i].client.coordinates
      );
      if (d < minDistance) {
        minDistance = d;
        bestIdx = i;
      }
    }
    const [nextOrder] = remaining.splice(bestIdx, 1);
    sorted.push(nextOrder);
    currentCoords = nextOrder.client.coordinates;
  }

  return sorted;
}

/**
 * Motor de optimización y clustering multiviaje con restricciones de capacidad (VRP / Bin Packing geográfico).
 *
 * 1. Calcula la distancia al almacén y el ángulo polar para agrupar clientes por conos geográficos (sweep algorithm).
 * 2. Asigna pedidos al Viaje 1 hasta llenar la capacidad (MMA kg y máx palés).
 * 3. Si se desborda, crea Viaje 2, Viaje 3, etc. volviendo al almacén.
 * 4. Aplica optimización TSP por viaje respetando ventanas horarias.
 */
export function optimizeMultiTripRoutes(
  orders: Order[],
  vehicle: Vehicle,
  warehouse: WarehouseLocation
): OptimizationResult {
  if (orders.length === 0) {
    return {
      trips: [],
      exceededCapacity: false,
      totalOrders: 0,
      vehicle,
    };
  }

  const maxKg = vehicle.maxWeightKg;
  const maxPal = vehicle.maxPallets;

  // Calculamos métricas geográficas respecto al almacén central
  const enriched = orders.map((order) => {
    const dLat = order.client.coordinates.lat - warehouse.coordinates.lat;
    const dLng = order.client.coordinates.lng - warehouse.coordinates.lng;
    const angle = Math.atan2(dLat, dLng); // Ángulo para barrido radial (clustering)
    const distToBase = haversineDistanceKm(
      warehouse.coordinates,
      order.client.coordinates
    );

    return {
      order,
      angle,
      distToBase,
    };
  });

  // Ordenamos por ángulo radial (conos de proximidad geográfica) para formar clusters naturales
  enriched.sort((a, b) => a.angle - b.angle);

  const rawTrips: Order[][] = [];
  let currentTrip: Order[] = [];
  let currentKg = 0;
  let currentPal = 0;

  for (const item of enriched) {
    const ord = item.order;
    const fitsKg = currentKg + ord.totalWeightKg <= maxKg;
    // Margen de 0.10 en palés equivalentes para tolerar sacos sueltos
    const fitsPal = currentPal + ord.equivalentPallets <= maxPal + 0.1;

    if (fitsKg && fitsPal) {
      currentTrip.push(ord);
      currentKg += ord.totalWeightKg;
      currentPal += ord.equivalentPallets;
    } else {
      // Si el viaje actual tiene pedidos, lo cerramos y abrimos uno nuevo
      if (currentTrip.length > 0) {
        rawTrips.push(currentTrip);
      }
      currentTrip = [ord];
      currentKg = ord.totalWeightKg;
      currentPal = ord.equivalentPallets;
    }
  }

  if (currentTrip.length > 0) {
    rawTrips.push(currentTrip);
  }

  // Ahora para cada viaje, optimizamos el orden interno de paradas (TSP con ventanas horarias)
  const trips: OptimizedTrip[] = rawTrips.map((tripOrders, index) => {
    const tspOrdered = solveTspForTrip(tripOrders, warehouse);

    const totalWeightKg = tspOrdered.reduce(
      (sum, o) => sum + o.totalWeightKg,
      0
    );
    const totalPallets = Number(
      tspOrdered.reduce((sum, o) => sum + o.equivalentPallets, 0).toFixed(2)
    );
    const totalSacks = tspOrdered.reduce(
      (sum, o) => sum + o.totalSacksCount,
      0
    );

    return {
      tripNumber: index + 1,
      orders: tspOrdered,
      totalWeightKg,
      totalPallets,
      totalSacks,
    };
  });

  return {
    trips,
    exceededCapacity: trips.length > 1,
    totalOrders: orders.length,
    vehicle,
  };
}
