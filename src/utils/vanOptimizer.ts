import { VanOrder, Coordinates } from "@/types/pelletVan";
import { haversineDistanceKm } from "@/utils/osrmRouting";

export interface VanTrip {
  tripNumber: number;
  orders: VanOrder[];
  totalSacks: number;
  totalWeightKg: number;
}

export interface VanOptimizationResult {
  trips: VanTrip[];
  exceededCapacity: boolean;
  totalSacks: number;
  totalOrders: number;
}

/**
 * Ordena las órdenes de un viaje para el furgón usando heurística del vecino más cercano.
 * Trayecto: Almacén -> [Clientes] -> Almacén.
 */
export function solveVanTripOrder(
  orders: VanOrder[],
  warehouseCoords: Coordinates
): VanOrder[] {
  if (orders.length <= 1) return [...orders];

  const remaining = [...orders];
  const sorted: VanOrder[] = [];
  let currentCoords = warehouseCoords;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let minDistance = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const dist = haversineDistanceKm(
        currentCoords,
        remaining[i].client.coordinates
      );
      if (dist < minDistance) {
        minDistance = dist;
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
 * Optimiza y agrupa los pedidos en viajes según la capacidad máxima de sacos del furgón.
 * Si la suma de sacos supera la capacidad (ej. 90 sacos), aplica clustering por cercanía
 * geográfica radial (sweep algorithm) dividiendo en Viaje 1, Viaje 2, etc.
 */
export function optimizeVanTrips(
  orders: VanOrder[],
  vanCapacitySacks: number,
  warehouseCoords: Coordinates
): VanOptimizationResult {
  if (orders.length === 0) {
    return {
      trips: [],
      exceededCapacity: false,
      totalSacks: 0,
      totalOrders: 0,
    };
  }

  // Enriquecer con ángulo geográfico y distancia al almacén para clustering por cercanía
  const enriched = orders.map((order) => {
    const dLat = order.client.coordinates.lat - warehouseCoords.lat;
    const dLng = order.client.coordinates.lng - warehouseCoords.lng;
    const angle = Math.atan2(dLat, dLng);
    const distToBase = haversineDistanceKm(
      warehouseCoords,
      order.client.coordinates
    );

    return {
      order,
      angle,
      distToBase,
    };
  });

  // Ordenar radialmente para formar clusters geográficos naturales
  enriched.sort((a, b) => a.angle - b.angle);

  const rawTrips: VanOrder[][] = [];
  let currentTrip: VanOrder[] = [];
  let currentSacks = 0;

  for (const item of enriched) {
    const ord = item.order;
    if (currentSacks + ord.sacks <= vanCapacitySacks) {
      currentTrip.push(ord);
      currentSacks += ord.sacks;
    } else {
      if (currentTrip.length > 0) {
        rawTrips.push(currentTrip);
      }
      currentTrip = [ord];
      currentSacks = ord.sacks;
    }
  }

  if (currentTrip.length > 0) {
    rawTrips.push(currentTrip);
  }

  // Ordenar cada viaje de forma óptima saliendo del almacén
  const trips: VanTrip[] = rawTrips.map((tripOrders, index) => {
    const ordered = solveVanTripOrder(tripOrders, warehouseCoords);
    const totalSacks = ordered.reduce((sum, o) => sum + o.sacks, 0);
    return {
      tripNumber: index + 1,
      orders: ordered,
      totalSacks,
      totalWeightKg: totalSacks * 15,
    };
  });

  const totalSacks = orders.reduce((sum, o) => sum + o.sacks, 0);

  return {
    trips,
    exceededCapacity: trips.length > 1,
    totalSacks,
    totalOrders: orders.length,
  };
}
