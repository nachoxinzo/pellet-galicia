import { Coordinates, PELLET_GALICIA_RULES } from "@/types/pelletGalicia";
import { fetchOsrmTable } from "./osrmTableService";

export interface RoutableOrder {
  id: string;
  sacks: number;
  totalWeightKg?: number;
  customer?: { name?: string; coordinates: Coordinates; [key: string]: any };
  client?: { name?: string; coordinates: Coordinates; [key: string]: any };
  [key: string]: any;
}

export interface FuelOptimizationParams {
  consumoVacioL100: number; // Ej. 8.5 L/100km
  extraConsumoPorTonelada: number; // Ej. +2.2 L/100km por 1.000 kg
  precioCombustible: number; // Ej. 1.55 €/L
}

export interface StopFuelLegDetail {
  orderId: string;
  distanceFromPrevKm: number;
  drivingMinutesFromPrev: number;
  carriedWeightKgBeforeUnload: number;
  carriedSacksBeforeUnload: number;
  legBaseFuelLiters: number;
  legWeightExtraFuelLiters: number;
  legFuelLiters: number;
  legFuelCostEur: number;
}

export interface OptimizedGaliciaTrip<T = any> {
  tripNumber: number;
  orders: T[];
  totalSacks: number;
  occupancyPercent: number;
  totalWeightKg: number;
  totalDistanceKm: number;
  estimatedDrivingSeconds: number;
  estimatedDrivingMinutes: number;
  baseFuelLiters: number;
  weightExtraFuelLiters: number;
  totalFuelLiters: number;
  reverseDirectionFuelLiters: number;
  heavyFirstSavedLiters: number;
  totalFuelCostEur: number;
  costPerSackEur: number;
  isHighCostPerSack: boolean;
  highCostWarningReason?: string;
  legDetails: StopFuelLegDetail[];
  returnLeg: {
    distanceKm: number;
    drivingMinutes: number;
    fuelLiters: number;
    fuelCostEur: number;
  };
}

export interface GaliciaRoutingResult<T = any> {
  trips: OptimizedGaliciaTrip<T>[];
  exceededCapacity: boolean;
  totalSacks: number;
  totalOrders: number;
  usedRealOsrmTable: boolean;
  totalDistanceKm: number;
  totalDrivingMinutes: number;
  totalBaseFuelLiters: number;
  totalWeightExtraFuelLiters: number;
  totalFuelLiters: number;
  totalHeavyFirstSavedLiters: number;
  totalFuelCostEur: number;
  averageCostPerSackEur: number;
  interRouteSwapsApplied: number;
}

export const DEFAULT_FUEL_PARAMS: FuelOptimizationParams = {
  consumoVacioL100: PELLET_GALICIA_RULES.DEFAULT_CONSUMO_VACIO_L100,
  extraConsumoPorTonelada:
    PELLET_GALICIA_RULES.DEFAULT_EXTRA_CONSUMO_TONELADA,
  precioCombustible: PELLET_GALICIA_RULES.DEFAULT_PRECIO_COMBUSTIBLE,
};

function getOrderCoordinates(order: RoutableOrder): Coordinates {
  if (order.customer?.coordinates) return order.customer.coordinates;
  if (order.client?.coordinates) return order.client.coordinates;
  return { lat: 42.2982, lng: -7.8185 };
}

/**
 * Distancia Haversine multiplicada por factor de sinuosidad vial gallego (1.32)
 * como contingencia si OSRM no devuelve distancias.
 */
export function estimateRoadDistanceKm(a: Coordinates, b: Coordinates): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinDLng *
      sinDLng;
  const straightKm = 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return straightKm * 1.32;
}

function buildFallbackMatrices(allCoords: Coordinates[]): {
  distKm: number[][];
  durSec: number[][];
} {
  const n = allCoords.length;
  const distKm: number[][] = Array.from({ length: n }, () =>
    new Array(n).fill(0)
  );
  const durSec: number[][] = Array.from({ length: n }, () =>
    new Array(n).fill(0)
  );

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const d = estimateRoadDistanceKm(allCoords[i], allCoords[j]);
      distKm[i][j] = d;
      // Velocidad media rural en Galicia ~48 km/h
      durSec[i][j] = (d / 48) * 3600;
    }
  }

  return { distKm, durSec };
}

/**
 * 3. FUNCIÓN DE COSTE DE COMBUSTIBLE CON PESO DINÁMICO ("Heavy-First Fuel Cost Function")
 *
 * En cada tramo A -> B, el furgón transporta `pesoActualKg` (sacos pendientes de descargar en ese viaje).
 * LitrosTramo = (DistanciaTramoKm / 100) * (consumoVacioL100 + (pesoActualKg / 1000) * extraConsumoPorTonelada)
 */
function evaluateRouteDynamicFuel<T extends RoutableOrder>(
  routeMatrixIndices: number[], // Índices en matriz (1..N)
  orders: T[],
  distMatrixKm: number[][],
  durMatrixSec: number[][],
  fuelParams: FuelOptimizationParams
): {
  totalDistanceKm: number;
  totalDrivingSeconds: number;
  baseFuelLiters: number;
  weightExtraFuelLiters: number;
  totalFuelLiters: number;
  legDetails: StopFuelLegDetail[];
  returnLeg: {
    distanceKm: number;
    drivingMinutes: number;
    fuelLiters: number;
    fuelCostEur: number;
  };
} {
  if (routeMatrixIndices.length === 0) {
    return {
      totalDistanceKm: 0,
      totalDrivingSeconds: 0,
      baseFuelLiters: 0,
      weightExtraFuelLiters: 0,
      totalFuelLiters: 0,
      legDetails: [],
      returnLeg: {
        distanceKm: 0,
        drivingMinutes: 0,
        fuelLiters: 0,
        fuelCostEur: 0,
      },
    };
  }

  let remainingSacks = routeMatrixIndices.reduce(
    (sum, idx) => sum + orders[idx - 1].sacks,
    0
  );
  let pesoActualKg = remainingSacks * PELLET_GALICIA_RULES.SACK_WEIGHT_KG;

  let totalDistanceKm = 0;
  let totalDrivingSeconds = 0;
  let baseFuelLiters = 0;
  let weightExtraFuelLiters = 0;
  const legDetails: StopFuelLegDetail[] = [];

  let prevNode = 0; // Sale del Almacén (nodo 0)

  for (let i = 0; i < routeMatrixIndices.length; i++) {
    const currNode = routeMatrixIndices[i];
    const order = orders[currNode - 1];

    const distKm = Math.max(0, distMatrixKm[prevNode]?.[currNode] ?? 0);
    const durSec = Math.max(0, durMatrixSec[prevNode]?.[currNode] ?? 0);

    const legBase = (distKm / 100) * fuelParams.consumoVacioL100;
    const legWeightExtra =
      (distKm / 100) *
      (pesoActualKg / 1000) *
      fuelParams.extraConsumoPorTonelada;
    const legTotalLiters = legBase + legWeightExtra;

    totalDistanceKm += distKm;
    totalDrivingSeconds += durSec;
    baseFuelLiters += legBase;
    weightExtraFuelLiters += legWeightExtra;

    legDetails.push({
      orderId: order.id,
      distanceFromPrevKm: Number(distKm.toFixed(2)),
      drivingMinutesFromPrev: Math.max(1, Math.round(durSec / 60)),
      carriedWeightKgBeforeUnload: pesoActualKg,
      carriedSacksBeforeUnload: remainingSacks,
      legBaseFuelLiters: Number(legBase.toFixed(3)),
      legWeightExtraFuelLiters: Number(legWeightExtra.toFixed(3)),
      legFuelLiters: Number(legTotalLiters.toFixed(3)),
      legFuelCostEur: Number(
        (legTotalLiters * fuelParams.precioCombustible).toFixed(2)
      ),
    });

    // Descargar los sacos del cliente en esta parada
    remainingSacks = Math.max(0, remainingSacks - order.sacks);
    pesoActualKg = remainingSacks * PELLET_GALICIA_RULES.SACK_WEIGHT_KG;
    prevNode = currNode;
  }

  // Tramo de retorno al Almacén con el furgón ya descargado (pesoActualKg = 0)
  const lastNode = routeMatrixIndices[routeMatrixIndices.length - 1];
  const returnDistKm = Math.max(0, distMatrixKm[lastNode]?.[0] ?? 0);
  const returnDurSec = Math.max(0, durMatrixSec[lastNode]?.[0] ?? 0);
  const returnFuelLiters = (returnDistKm / 100) * fuelParams.consumoVacioL100;

  totalDistanceKm += returnDistKm;
  totalDrivingSeconds += returnDurSec;
  baseFuelLiters += returnFuelLiters;

  const totalFuelLiters = baseFuelLiters + weightExtraFuelLiters;

  return {
    totalDistanceKm,
    totalDrivingSeconds,
    baseFuelLiters,
    weightExtraFuelLiters,
    totalFuelLiters,
    legDetails,
    returnLeg: {
      distanceKm: Number(returnDistKm.toFixed(2)),
      drivingMinutes: Math.max(1, Math.round(returnDurSec / 60)),
      fuelLiters: Number(returnFuelLiters.toFixed(3)),
      fuelCostEur: Number(
        (returnFuelLiters * fuelParams.precioCombustible).toFixed(2)
      ),
    },
  };
}

/**
 * Optimiza la secuencia interna de un viaje minimizando los Litros Totales de Gasoil
 * (teniendo en cuenta el peso dinámico que se descarga en cada parada).
 *
 * Incluye:
 * - Semilla Nearest-Neighbor + Semilla Heavy-First (descargar sacos pesados antes)
 * - 2-Opt guiado por consumo de combustible
 * - Or-Opt / Relocate de paradas individuales (para adelantar paradas muy pesadas si ahorra gasoil)
 * - Evaluación de inversión del sentido completo del bucle (A->B->C vs C->B->A)
 */
function optimizeSingleTripForMinimumFuel<T extends RoutableOrder>(
  clientIndices: number[],
  orders: T[],
  distMatrixKm: number[][],
  durMatrixSec: number[][],
  fuelParams: FuelOptimizationParams
): number[] {
  if (clientIndices.length <= 1) return [...clientIndices];

  const getFuelCost = (seq: number[]) =>
    evaluateRouteDynamicFuel(seq, orders, distMatrixKm, durMatrixSec, fuelParams)
      .totalFuelLiters;

  // Semilla 1: Nearest Neighbor por distancia
  const buildNearestNeighborSeed = (): number[] => {
    const rem = new Set(clientIndices);
    const route: number[] = [];
    let curr = 0;
    while (rem.size > 0) {
      let best = -1;
      let bestDist = Infinity;
      for (const cand of rem) {
        const d = distMatrixKm[curr][cand];
        if (d < bestDist) {
          bestDist = d;
          best = cand;
        }
      }
      if (best === -1) break;
      route.push(best);
      rem.delete(best);
      curr = best;
    }
    return route;
  };

  // Semilla 2: Heavy-First ponderado (prioriza descargar muchos sacos pronto sin desviarse en exceso)
  const buildHeavyFirstSeed = (): number[] => {
    const rem = new Set(clientIndices);
    const route: number[] = [];
    let curr = 0;
    while (rem.size > 0) {
      let best = -1;
      let bestScore = Infinity;
      for (const cand of rem) {
        const d = Math.max(0.2, distMatrixKm[curr][cand]);
        const sacks = Math.max(1, orders[cand - 1].sacks);
        // Menor distancia y mayor cantidad de sacos -> mejor puntuación
        const score = d / Math.pow(sacks, 0.35);
        if (score < bestScore) {
          bestScore = score;
          best = cand;
        }
      }
      if (best === -1) break;
      route.push(best);
      rem.delete(best);
      curr = best;
    }
    return route;
  };

  const candidates: number[][] = [
    [...clientIndices],
    [...clientIndices].reverse(),
    buildNearestNeighborSeed(),
    buildHeavyFirstSeed(),
  ];

  let bestGlobalRoute = [...clientIndices];
  let bestGlobalFuel = getFuelCost(bestGlobalRoute);

  for (const seed of candidates) {
    let route = [...seed];
    let currentFuel = getFuelCost(route);
    let improved = true;
    let iter = 0;

    while (improved && iter < 40) {
      improved = false;
      iter++;

      // 1) Inversión completa del bucle (crucial para peso dinámico: ir en sentido horario vs antihorario)
      const reversedLoop = [...route].reverse();
      const reversedFuel = getFuelCost(reversedLoop);
      if (reversedFuel < currentFuel - 0.0001) {
        route = reversedLoop;
        currentFuel = reversedFuel;
        improved = true;
      }

      // 2) 2-Opt guiado por Litros de Combustible
      for (let i = 0; i < route.length - 1; i++) {
        for (let k = i + 1; k < route.length; k++) {
          const candidate = [
            ...route.slice(0, i),
            ...route.slice(i, k + 1).reverse(),
            ...route.slice(k + 1),
          ];
          const candFuel = getFuelCost(candidate);
          if (candFuel < currentFuel - 0.0001) {
            route = candidate;
            currentFuel = candFuel;
            improved = true;
            break;
          }
        }
        if (improved) break;
      }

      // 3) Or-Opt (Reubicar una parada pesada a una posición anterior o posterior)
      if (!improved && route.length >= 3) {
        for (let fromIdx = 0; fromIdx < route.length; fromIdx++) {
          for (let toIdx = 0; toIdx < route.length; toIdx++) {
            if (fromIdx === toIdx) continue;
            const candidate = [...route];
            const [moved] = candidate.splice(fromIdx, 1);
            candidate.splice(toIdx, 0, moved);
            const candFuel = getFuelCost(candidate);
            if (candFuel < currentFuel - 0.0001) {
              route = candidate;
              currentFuel = candFuel;
              improved = true;
              break;
            }
          }
          if (improved) break;
        }
      }
    }

    if (currentFuel < bestGlobalFuel) {
      bestGlobalFuel = currentFuel;
      bestGlobalRoute = route;
    }
  }

  return bestGlobalRoute;
}

/**
 * 2b. ALGORITMO DE AHORROS DE CLARKE-WRIGHT (Capacitated Vehicle Routing Problem - CVRP)
 *
 * Calcula S(i, j) = Dist(Almacen, i) + Dist(Almacen, j) - Dist(i, j)
 * Ordena los ahorros de mayor a menor y fusiona progresivamente los pedidos en rutas
 * respetando la capacidad máxima de sacos del furgón.
 */
function clarkeWrightSavingsClustering<T extends RoutableOrder>(
  orders: T[],
  distMatrixKm: number[][],
  vanCapacitySacks: number
): number[][] {
  const n = orders.length;
  if (n === 0) return [];

  // Inicialmente cada pedido i (1..n) está en su propia ruta individual
  let routes: { stops: number[]; sacks: number }[] = orders.map((o, idx) => ({
    stops: [idx + 1],
    sacks: o.sacks,
  }));

  // Calcular matriz de ahorros S(i, j) para todos los pares (i, j)
  interface SavingPair {
    i: number;
    j: number;
    savingKm: number;
  }

  const savingsList: SavingPair[] = [];
  for (let i = 1; i <= n; i++) {
    for (let j = i + 1; j <= n; j++) {
      const dist0i = distMatrixKm[0][i];
      const dist0j = distMatrixKm[0][j];
      const distij = distMatrixKm[i][j];
      // Promedio simétrico para carreteras con sentidos únicos
      const distji = distMatrixKm[j][i];
      const avgBetween = (distij + distji) / 2;
      const savingKm = dist0i + dist0j - avgBetween;
      savingsList.push({ i, j, savingKm });
    }
  }

  // Ordenar ahorros de mayor a menor
  savingsList.sort((a, b) => b.savingKm - a.savingKm);

  // Fase 1: Fusión paralela de extremos Clarke-Wright
  for (const { i, j, savingKm } of savingsList) {
    if (savingKm <= 0) break;

    const rIdxI = routes.findIndex((r) => r.stops.includes(i));
    const rIdxJ = routes.findIndex((r) => r.stops.includes(j));

    if (rIdxI === -1 || rIdxJ === -1 || rIdxI === rIdxJ) continue;

    const routeI = routes[rIdxI];
    const routeJ = routes[rIdxJ];

    if (routeI.sacks + routeJ.sacks > vanCapacitySacks) continue;

    const iIsFirst = routeI.stops[0] === i;
    const iIsLast = routeI.stops[routeI.stops.length - 1] === i;
    const jIsFirst = routeJ.stops[0] === j;
    const jIsLast = routeJ.stops[routeJ.stops.length - 1] === j;

    // En Clarke-Wright clásico, fusionamos cuando ambos nodos son extremos exteriores de sus rutas
    if ((iIsFirst || iIsLast) && (jIsFirst || jIsLast)) {
      const orientedI = iIsLast ? [...routeI.stops] : [...routeI.stops].reverse();
      const orientedJ = jIsFirst ? [...routeJ.stops] : [...routeJ.stops].reverse();

      const mergedStops = [...orientedI, ...orientedJ];
      const mergedSacks = routeI.sacks + routeJ.sacks;

      routes[rIdxI] = { stops: mergedStops, sacks: mergedSacks };
      routes.splice(rIdxJ, 1);
    }
  }

  // Fase 2: Compactación adicional si quedan dos rutas pequeñas que caben juntas y ahorran viaje al almacén
  let compacted = true;
  while (compacted && routes.length > 1) {
    compacted = false;
    let bestMerge: { a: number; b: number; gain: number } | null = null;

    for (let a = 0; a < routes.length; a++) {
      for (let b = a + 1; b < routes.length; b++) {
        if (routes[a].sacks + routes[b].sacks <= vanCapacitySacks) {
          const lastA = routes[a].stops[routes[a].stops.length - 1];
          const firstB = routes[b].stops[0];
          const gain =
            distMatrixKm[lastA][0] +
            distMatrixKm[0][firstB] -
            distMatrixKm[lastA][firstB];
          if (gain > 0 && (!bestMerge || gain > bestMerge.gain)) {
            bestMerge = { a, b, gain };
          }
        }
      }
    }

    if (bestMerge) {
      const { a, b } = bestMerge;
      routes[a] = {
        stops: [...routes[a].stops, ...routes[b].stops],
        sacks: routes[a].sacks + routes[b].sacks,
      };
      routes.splice(b, 1);
      compacted = true;
    }
  }

  return routes.map((r) => r.stops);
}

/**
 * 2c. MEJORA INTER-ROUTE SWAP & RELOCATE (Intercambio 2-Opt entre Viajes)
 *
 * Comprueba si intercambiar un pedido fronterizo del Viaje A con otro del Viaje B
 * (o mover un pedido de un viaje a otro respetando vanCapacitySacks)
 * reduce el consumo total de combustible y los kilómetros combinados.
 */
function applyInterRouteSwapImprovement<T extends RoutableOrder>(
  initialTrips: number[][],
  orders: T[],
  distMatrixKm: number[][],
  durMatrixSec: number[][],
  vanCapacitySacks: number,
  fuelParams: FuelOptimizationParams
): { improvedTrips: number[][]; swapsCount: number } {
  if (initialTrips.length <= 1) {
    return { improvedTrips: initialTrips, swapsCount: 0 };
  }

  const trips = initialTrips.map((t) => [...t]);
  const getTripSacks = (t: number[]) =>
    t.reduce((sum, idx) => sum + orders[idx - 1].sacks, 0);
  const getTripFuel = (t: number[]) => {
    const opt = optimizeSingleTripForMinimumFuel(
      t,
      orders,
      distMatrixKm,
      durMatrixSec,
      fuelParams
    );
    return {
      seq: opt,
      liters: evaluateRouteDynamicFuel(
        opt,
        orders,
        distMatrixKm,
        durMatrixSec,
        fuelParams
      ).totalFuelLiters,
    };
  };

  let swapsCount = 0;
  let improved = true;
  let pass = 0;

  while (improved && pass < 15) {
    improved = false;
    pass++;

    for (let rA = 0; rA < trips.length; rA++) {
      for (let rB = rA + 1; rB < trips.length; rB++) {
        const tripA = trips[rA];
        const tripB = trips[rB];
        const sacksA = getTripSacks(tripA);
        const sacksB = getTripSacks(tripB);

        const baseEvalA = getTripFuel(tripA);
        const baseEvalB = getTripFuel(tripB);
        const currentCombinedFuel = baseEvalA.liters + baseEvalB.liters;

        // 1) Probar Intercambio 1-a-1 (Swap) entre un pedido de tripA y otro de tripB
        for (let i = 0; i < tripA.length; i++) {
          for (let j = 0; j < tripB.length; j++) {
            const nodeA = tripA[i];
            const nodeB = tripB[j];
            const sA = orders[nodeA - 1].sacks;
            const sB = orders[nodeB - 1].sacks;

            const newSacksA = sacksA - sA + sB;
            const newSacksB = sacksB - sB + sA;

            if (
              newSacksA <= vanCapacitySacks &&
              newSacksB <= vanCapacitySacks
            ) {
              const candA = [...tripA];
              const candB = [...tripB];
              candA[i] = nodeB;
              candB[j] = nodeA;

              const evalCandA = getTripFuel(candA);
              const evalCandB = getTripFuel(candB);

              if (
                evalCandA.liters + evalCandB.liters <
                currentCombinedFuel - 0.005
              ) {
                trips[rA] = evalCandA.seq;
                trips[rB] = evalCandB.seq;
                swapsCount++;
                improved = true;
                break;
              }
            }
          }
          if (improved) break;
        }

        if (improved) break;

        // 2) Probar Reubicación 1-a-0 (Mover un pedido de tripA a tripB o viceversa si cabe y ahorra gasoil)
        if (tripA.length > 1) {
          for (let i = 0; i < tripA.length; i++) {
            const nodeA = tripA[i];
            const sA = orders[nodeA - 1].sacks;
            if (sacksB + sA <= vanCapacitySacks) {
              const candA = tripA.filter((_, idx) => idx !== i);
              const candB = [...tripB, nodeA];
              const evalCandA = getTripFuel(candA);
              const evalCandB = getTripFuel(candB);

              if (
                evalCandA.liters + evalCandB.liters <
                currentCombinedFuel - 0.005
              ) {
                trips[rA] = evalCandA.seq;
                trips[rB] = evalCandB.seq;
                swapsCount++;
                improved = true;
                break;
              }
            }
          }
        }

        if (!improved && tripB.length > 1) {
          for (let j = 0; j < tripB.length; j++) {
            const nodeB = tripB[j];
            const sB = orders[nodeB - 1].sacks;
            if (sacksA + sB <= vanCapacitySacks) {
              const candA = [...tripA, nodeB];
              const candB = tripB.filter((_, idx) => idx !== j);
              const evalCandA = getTripFuel(candA);
              const evalCandB = getTripFuel(candB);

              if (
                evalCandA.liters + evalCandB.liters <
                currentCombinedFuel - 0.005
              ) {
                trips[rA] = evalCandA.seq;
                trips[rB] = evalCandB.seq;
                swapsCount++;
                improved = true;
                break;
              }
            }
          }
        }

        if (improved) break;
      }
      if (improved) break;
    }
  }

  return {
    improvedTrips: trips.filter((t) => t.length > 0),
    swapsCount,
  };
}

/**
 * Construye el objeto completo de métricas de un viaje (incluyendo comparativa de sentido inverso
 * y alertas de coste por saco).
 */
function buildTripMetricsObject<T extends RoutableOrder>(
  tripNumber: number,
  sortedOrders: T[],
  sortedMatrixIndices: number[],
  allOrders: T[],
  distMatrixKm: number[][],
  durMatrixSec: number[][],
  vanCapacitySacks: number,
  fuelParams: FuelOptimizationParams
): OptimizedGaliciaTrip<T> {
  const forwardEval = evaluateRouteDynamicFuel(
    sortedMatrixIndices,
    allOrders,
    distMatrixKm,
    durMatrixSec,
    fuelParams
  );

  const reverseIndices = [...sortedMatrixIndices].reverse();
  const reverseEval = evaluateRouteDynamicFuel(
    reverseIndices,
    allOrders,
    distMatrixKm,
    durMatrixSec,
    fuelParams
  );

  const tripSacks = sortedOrders.reduce((sum, o) => sum + o.sacks, 0);
  const occupancyPercent = Math.round((tripSacks / vanCapacitySacks) * 100);
  const totalFuelCostEur =
    forwardEval.totalFuelLiters * fuelParams.precioCombustible;
  const costPerSackEur = tripSacks > 0 ? totalFuelCostEur / tripSacks : 0;
  const heavyFirstSavedLiters = Math.max(
    0,
    reverseEval.totalFuelLiters - forwardEval.totalFuelLiters
  );

  // Detectar si este viaje dispara el coste por saco (pocos sacos o muy lejano)
  let isHighCostPerSack = false;
  let highCostWarningReason: string | undefined;

  if (costPerSackEur > 0.25 || (occupancyPercent < 45 && forwardEval.totalDistanceKm > 25)) {
    isHighCostPerSack = true;
    if (occupancyPercent < 45) {
      highCostWarningReason = `Viaje al ${occupancyPercent}% de carga (${tripSacks}/${vanCapacitySacks} sacos) para recorrer ${forwardEval.totalDistanceKm.toFixed(
        1
      )} km (${costPerSackEur.toFixed(
        2
      )} €/saco). Valora combinar estos pedidos otro día.`;
    } else {
      highCostWarningReason = `Distancia elevada (${forwardEval.totalDistanceKm.toFixed(
        1
      )} km) con coste de ${costPerSackEur.toFixed(2)} € de gasoil por saco.`;
    }
  }

  return {
    tripNumber,
    orders: sortedOrders,
    totalSacks: tripSacks,
    occupancyPercent,
    totalWeightKg: tripSacks * PELLET_GALICIA_RULES.SACK_WEIGHT_KG,
    totalDistanceKm: Number(forwardEval.totalDistanceKm.toFixed(2)),
    estimatedDrivingSeconds: Math.round(forwardEval.totalDrivingSeconds),
    estimatedDrivingMinutes: Math.max(
      1,
      Math.round(forwardEval.totalDrivingSeconds / 60)
    ),
    baseFuelLiters: Number(forwardEval.baseFuelLiters.toFixed(2)),
    weightExtraFuelLiters: Number(forwardEval.weightExtraFuelLiters.toFixed(2)),
    totalFuelLiters: Number(forwardEval.totalFuelLiters.toFixed(2)),
    reverseDirectionFuelLiters: Number(reverseEval.totalFuelLiters.toFixed(2)),
    heavyFirstSavedLiters: Number(heavyFirstSavedLiters.toFixed(3)),
    totalFuelCostEur: Number(totalFuelCostEur.toFixed(2)),
    costPerSackEur: Number(costPerSackEur.toFixed(2)),
    isHighCostPerSack,
    highCostWarningReason,
    legDetails: forwardEval.legDetails,
    returnLeg: forwardEval.returnLeg,
  };
}

/**
 * Recalcula en tiempo real el consumo de gasoil y métricas de un viaje cuando el Admin
 * reordena paradas manualmente (Drag & Drop) o invierte el sentido de la ruta.
 */
export function recalculateSingleTripMetricsSync<T extends RoutableOrder>(
  tripOrders: T[],
  tripNumber: number,
  warehouseCoords: Coordinates,
  vanCapacitySacks: number,
  fuelParams: FuelOptimizationParams = DEFAULT_FUEL_PARAMS
): OptimizedGaliciaTrip<T> {
  const allCoords = [
    warehouseCoords,
    ...tripOrders.map((o) => getOrderCoordinates(o)),
  ];
  const { distKm, durSec } = buildFallbackMatrices(allCoords);
  const indices = tripOrders.map((_, i) => i + 1);

  return buildTripMetricsObject(
    tripNumber,
    tripOrders,
    indices,
    tripOrders,
    distKm,
    durSec,
    vanCapacitySacks,
    fuelParams
  );
}

/**
 * MOTOR PRINCIPAL DE OPTIMIZACIÓN AVANZADA DE MÍNIMO CONSUMO DE COMBUSTIBLE
 * (Clarke-Wright Savings CVRP + Inter-Route 2-Opt Swap + Peso Dinámico Heavy-First)
 */
export async function optimizeGaliciaRoutes<T extends RoutableOrder>(
  orders: T[],
  warehouseCoords: Coordinates,
  vanCapacitySacks: number,
  fuelParams: FuelOptimizationParams = DEFAULT_FUEL_PARAMS
): Promise<GaliciaRoutingResult<T>> {
  const totalSacks = orders.reduce((sum, o) => sum + o.sacks, 0);

  if (orders.length === 0) {
    return {
      trips: [],
      exceededCapacity: false,
      totalSacks: 0,
      totalOrders: 0,
      usedRealOsrmTable: false,
      totalDistanceKm: 0,
      totalDrivingMinutes: 0,
      totalBaseFuelLiters: 0,
      totalWeightExtraFuelLiters: 0,
      totalFuelLiters: 0,
      totalHeavyFirstSavedLiters: 0,
      totalFuelCostEur: 0,
      averageCostPerSackEur: 0,
      interRouteSwapsApplied: 0,
    };
  }

  // Lista de coordenadas: Índice 0 = Almacén, Índices 1..N = Clientes
  const allCoords = [
    warehouseCoords,
    ...orders.map((o) => getOrderCoordinates(o)),
  ];

  // 2a. Matriz real de distancias (m -> km) y tiempos (s) usando OSRM Table API
  const osrmTable = await fetchOsrmTable(allCoords);
  const fallback = buildFallbackMatrices(allCoords);

  let distMatrixKm = fallback.distKm;
  let durMatrixSec = fallback.durSec;
  let usedRealOsrm = false;

  if (
    osrmTable &&
    osrmTable.durations &&
    osrmTable.durations.length === allCoords.length
  ) {
    usedRealOsrm = true;
    durMatrixSec = osrmTable.durations.map((row, i) =>
      row.map((val, j) =>
        typeof val === "number" && val >= 0 ? val : fallback.durSec[i][j]
      )
    );

    if (
      osrmTable.distances &&
      osrmTable.distances.length === allCoords.length
    ) {
      distMatrixKm = osrmTable.distances.map((row, i) =>
        row.map((val, j) =>
          typeof val === "number" && val >= 0
            ? val / 1000
            : fallback.distKm[i][j]
        )
      );
    } else {
      // Estimar km desde duración OSRM si no viniera matriz de distancias
      distMatrixKm = durMatrixSec.map((row) =>
        row.map((sec) => (sec / 3600) * 50)
      );
    }
  }

  // 2b. Algoritmo de Ahorros de Clarke-Wright (CVRP)
  const cwTrips = clarkeWrightSavingsClustering(
    orders,
    distMatrixKm,
    vanCapacitySacks
  );

  // Optimización inicial intra-ruta por Peso Dinámico
  const initialOptimizedTrips = cwTrips.map((tripIndices) =>
    optimizeSingleTripForMinimumFuel(
      tripIndices,
      orders,
      distMatrixKm,
      durMatrixSec,
      fuelParams
    )
  );

  // 2c. Fase de mejora Inter-Route Swap (Intercambio entre viajes para reducir km y litros globales)
  const { improvedTrips, swapsCount } = applyInterRouteSwapImprovement(
    initialOptimizedTrips,
    orders,
    distMatrixKm,
    durMatrixSec,
    vanCapacitySacks,
    fuelParams
  );

  // 3. Optimización final por Peso Dinámico ("Heavy-First Fuel Cost Function") en cada viaje
  const finalTripsUnsorted: OptimizedGaliciaTrip<T>[] = improvedTrips.map(
    (tripClientIndices, idx) => {
      const bestOrderIndices = optimizeSingleTripForMinimumFuel(
        tripClientIndices,
        orders,
        distMatrixKm,
        durMatrixSec,
        fuelParams
      );
      const sortedOrders = bestOrderIndices.map(
        (matrixIdx) => orders[matrixIdx - 1]
      );

      return buildTripMetricsObject(
        idx + 1,
        sortedOrders,
        bestOrderIndices,
        orders,
        distMatrixKm,
        durMatrixSec,
        vanCapacitySacks,
        fuelParams
      );
    }
  );

  // Ordenar viajes para hacer primero los viajes más llenos/eficientes
  finalTripsUnsorted.sort((a, b) => b.totalSacks - a.totalSacks);
  const trips = finalTripsUnsorted.map((t, idx) => ({
    ...t,
    tripNumber: idx + 1,
  }));

  const totalDistanceKm = Number(
    trips.reduce((sum, t) => sum + t.totalDistanceKm, 0).toFixed(2)
  );
  const totalDrivingMinutes = trips.reduce(
    (sum, t) => sum + t.estimatedDrivingMinutes,
    0
  );
  const totalBaseFuelLiters = Number(
    trips.reduce((sum, t) => sum + t.baseFuelLiters, 0).toFixed(2)
  );
  const totalWeightExtraFuelLiters = Number(
    trips.reduce((sum, t) => sum + t.weightExtraFuelLiters, 0).toFixed(2)
  );
  const totalFuelLiters = Number(
    trips.reduce((sum, t) => sum + t.totalFuelLiters, 0).toFixed(2)
  );
  const totalHeavyFirstSavedLiters = Number(
    trips.reduce((sum, t) => sum + t.heavyFirstSavedLiters, 0).toFixed(3)
  );
  const totalFuelCostEur = Number(
    (totalFuelLiters * fuelParams.precioCombustible).toFixed(2)
  );
  const averageCostPerSackEur =
    totalSacks > 0 ? Number((totalFuelCostEur / totalSacks).toFixed(2)) : 0;

  return {
    trips,
    exceededCapacity: totalSacks > vanCapacitySacks,
    totalSacks,
    totalOrders: orders.length,
    usedRealOsrmTable: usedRealOsrm,
    totalDistanceKm,
    totalDrivingMinutes,
    totalBaseFuelLiters,
    totalWeightExtraFuelLiters,
    totalFuelLiters,
    totalHeavyFirstSavedLiters,
    totalFuelCostEur,
    averageCostPerSackEur,
    interRouteSwapsApplied: swapsCount,
  };
}
