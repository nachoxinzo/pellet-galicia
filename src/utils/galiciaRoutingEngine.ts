import {
  Coordinates,
  FIELD_SERVICE_RULES,
  OrderPriority,
  ServiceType,
} from "@/types/pelletGalicia";
import { fetchOsrmTable, getCachedOsrmPairMetrics } from "./osrmTableService";

export interface RoutableServiceOrder {
  id: string;
  serviceType?: ServiceType;
  priority?: OrderPriority;
  estimatedMinutes?: number;
  estimatedPriceEur?: number;
  collectedPriceEur?: number;
  customer?: { name?: string; coordinates: Coordinates; [key: string]: any };
  [key: string]: any;
}

export interface FieldRoutingParams {
  consumoL100: number; // Ej. 7.5 L/100km
  precioCombustible: number; // Ej. 1.55 €/L
  hourlyCostEur?: number; // Coste/hora opcional del técnico
}

export interface StopRouteLegDetail {
  orderId: string;
  distanceFromPrevKm: number;
  drivingMinutesFromPrev: number;
  interventionMinutes: number;
  cumulativeWorkdayMinutesAfterStop: number;
  legFuelLiters: number;
  legFuelCostEur: number;
}

export interface OptimizedFieldRoute<T = any> {
  tripNumber: number;
  orders: T[];
  totalStops: number;
  totalInterventionMinutes: number;
  estimatedDrivingSeconds: number;
  estimatedDrivingMinutes: number;
  totalWorkdayMinutes: number; // Conducción + Intervenciones
  occupancyPercent: number; // % de jornada máxima
  totalDistanceKm: number;
  totalFuelLiters: number;
  totalFuelCostEur: number;
  totalLaborCostEur: number;
  costPerStopEur: number;
  urgentOrdersCount: number;
  averiaCount: number;
  revisionCount: number;
  instalacionCount: number;
  tripRevenueEur: number;
  tripNetMarginEur: number;
  tripNetMarginPercent: number;
  isOvertimeWarning: boolean;
  warningReason?: string;
  legDetails: StopRouteLegDetail[];
  returnLeg: {
    distanceKm: number;
    drivingMinutes: number;
    fuelLiters: number;
    fuelCostEur: number;
  };
}

export interface FieldRoutingResult<T = any> {
  trips: OptimizedFieldRoute<T>[];
  exceededWorkday: boolean;
  totalOrders: number;
  totalInterventionMinutes: number;
  totalDrivingMinutes: number;
  totalWorkdayMinutes: number;
  usedRealOsrmTable: boolean;
  fromOsrmCache: boolean;
  totalDistanceKm: number;
  totalFuelLiters: number;
  totalFuelCostEur: number;
  totalLaborCostEur: number;
  averageCostPerStopEur: number;
  totalRevenueEur: number;
  totalNetMarginEur: number;
  interRouteSwapsApplied: number;
}

export const DEFAULT_FIELD_ROUTING_PARAMS: FieldRoutingParams = {
  consumoL100: FIELD_SERVICE_RULES.DEFAULT_CONSUMO_L100,
  precioCombustible: FIELD_SERVICE_RULES.DEFAULT_PRECIO_COMBUSTIBLE,
  hourlyCostEur: FIELD_SERVICE_RULES.DEFAULT_HOURLY_COST_EUR,
};

function getOrderCoordinates(order: RoutableServiceOrder): Coordinates {
  if (order.customer?.coordinates) return order.customer.coordinates;
  return { lat: 42.2982, lng: -7.8185 };
}

function getOrderMinutes(order: RoutableServiceOrder): number {
  return Math.max(
    5,
    Math.min(
      480,
      Number(order.estimatedMinutes) ||
        FIELD_SERVICE_RULES.DEFAULT_INTERVENTION_MINUTES
    )
  );
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
      const cachedPair = getCachedOsrmPairMetrics(allCoords[i], allCoords[j]);
      if (cachedPair) {
        distKm[i][j] = cachedPair.distanceMeters / 1000;
        durSec[i][j] = cachedPair.durationSeconds;
      } else {
        const d = estimateRoadDistanceKm(allCoords[i], allCoords[j]);
        distKm[i][j] = d;
        durSec[i][j] = (d / 48) * 3600;
      }
    }
  }

  return { distKm, durSec };
}

/**
 * Evalúa una secuencia de avisos técnicos: km totales, tiempo de conducción,
 * tiempo de intervención y coste de combustible.
 */
function evaluateFieldRoute<T extends RoutableServiceOrder>(
  routeMatrixIndices: number[],
  orders: T[],
  distMatrixKm: number[][],
  durMatrixSec: number[][],
  params: FieldRoutingParams
): {
  totalDistanceKm: number;
  totalDrivingSeconds: number;
  totalInterventionMinutes: number;
  totalWorkdayMinutes: number;
  totalFuelLiters: number;
  legDetails: StopRouteLegDetail[];
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
      totalInterventionMinutes: 0,
      totalWorkdayMinutes: 0,
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

  let prevIdx = 0;
  let totalDistanceKm = 0;
  let totalDrivingSeconds = 0;
  let totalInterventionMinutes = 0;
  let totalFuelLiters = 0;
  let cumulativeWorkMinutes = 0;

  const legDetails: StopRouteLegDetail[] = [];

  for (const currIdx of routeMatrixIndices) {
    const order = orders[currIdx - 1];
    const distKm = distMatrixKm[prevIdx][currIdx] || 0;
    const durSec = durMatrixSec[prevIdx][currIdx] || 0;
    const driveMin = Math.max(1, Math.round(durSec / 60));
    const interventionMin = getOrderMinutes(order);

    const legFuelLiters = (distKm / 100) * params.consumoL100;
    const legFuelCostEur = legFuelLiters * params.precioCombustible;

    totalDistanceKm += distKm;
    totalDrivingSeconds += durSec;
    totalInterventionMinutes += interventionMin;
    totalFuelLiters += legFuelLiters;
    cumulativeWorkMinutes += driveMin + interventionMin;

    legDetails.push({
      orderId: order.id,
      distanceFromPrevKm: Number(distKm.toFixed(2)),
      drivingMinutesFromPrev: driveMin,
      interventionMinutes: interventionMin,
      cumulativeWorkdayMinutesAfterStop: cumulativeWorkMinutes,
      legFuelLiters: Number(legFuelLiters.toFixed(2)),
      legFuelCostEur: Number(legFuelCostEur.toFixed(2)),
    });

    prevIdx = currIdx;
  }

  const returnDistKm = distMatrixKm[prevIdx][0] || 0;
  const returnDurSec = durMatrixSec[prevIdx][0] || 0;
  const returnFuelLiters = (returnDistKm / 100) * params.consumoL100;

  totalDistanceKm += returnDistKm;
  totalDrivingSeconds += returnDurSec;
  totalFuelLiters += returnFuelLiters;

  const totalDrivingMinutes = Math.max(1, Math.round(totalDrivingSeconds / 60));
  const totalWorkdayMinutes = totalDrivingMinutes + totalInterventionMinutes;

  return {
    totalDistanceKm,
    totalDrivingSeconds,
    totalInterventionMinutes,
    totalWorkdayMinutes,
    totalFuelLiters,
    legDetails,
    returnLeg: {
      distanceKm: Number(returnDistKm.toFixed(2)),
      drivingMinutes: Math.max(1, Math.round(returnDurSec / 60)),
      fuelLiters: Number(returnFuelLiters.toFixed(2)),
      fuelCostEur: Number(
        (returnFuelLiters * params.precioCombustible).toFixed(2)
      ),
    },
  };
}

function estimateClusterTimeMinutes<T extends RoutableServiceOrder>(
  indices: number[],
  orders: T[],
  durMatrixSec: number[][]
): number {
  if (indices.length === 0) return 0;
  let driveSec = durMatrixSec[0][indices[0]] || 0;
  let workMin = getOrderMinutes(orders[indices[0] - 1]);
  for (let i = 1; i < indices.length; i++) {
    driveSec += durMatrixSec[indices[i - 1]][indices[i]] || 0;
    workMin += getOrderMinutes(orders[indices[i] - 1]);
  }
  driveSec += durMatrixSec[indices[indices.length - 1]][0] || 0;
  return Math.round(driveSec / 60) + workMin;
}

/**
 * Optimiza el orden de un único turno con 2-Opt respetando estrictamente
 * que los avisos "Urgente" vayan al inicio del turno antes que los "Normal".
 */
function optimizeSingleShiftSequence<T extends RoutableServiceOrder>(
  clusterIndices: number[],
  orders: T[],
  distMatrixKm: number[][],
  durMatrixSec: number[][]
): number[] {
  if (clusterIndices.length <= 1) return [...clusterIndices];

  const urgentIndices = clusterIndices.filter(
    (idx) => orders[idx - 1]?.priority === "Urgente"
  );
  const normalIndices = clusterIndices.filter(
    (idx) => orders[idx - 1]?.priority !== "Urgente"
  );

  // Sub-rutina Nearest Neighbor + 2-Opt desde un punto de partida hasta un punto de fin opcional
  const optimizeBlock = (
    block: number[],
    startNode: number,
    endNode: number | null
  ): number[] => {
    if (block.length <= 1) return [...block];
    const remaining = new Set(block);
    const ordered: number[] = [];
    let current = startNode;

    while (remaining.size > 0) {
      let bestNext = -1;
      let bestCost = Infinity;
      for (const cand of remaining) {
        const cost = durMatrixSec[current][cand] ?? distMatrixKm[current][cand];
        if (cost < bestCost) {
          bestCost = cost;
          bestNext = cand;
        }
      }
      if (bestNext === -1) break;
      ordered.push(bestNext);
      remaining.delete(bestNext);
      current = bestNext;
    }

    // 2-Opt local sobre el bloque
    const blockCost = (seq: number[]): number => {
      let c = durMatrixSec[startNode][seq[0]] || 0;
      for (let i = 0; i < seq.length - 1; i++) {
        c += durMatrixSec[seq[i]][seq[i + 1]] || 0;
      }
      if (endNode !== null) {
        c += durMatrixSec[seq[seq.length - 1]][endNode] || 0;
      }
      return c;
    };

    let improved = true;
    let bestSeq = [...ordered];
    let bestScore = blockCost(bestSeq);
    let iters = 0;

    while (improved && iters < 30) {
      improved = false;
      iters++;
      for (let i = 0; i < bestSeq.length - 1; i++) {
        for (let j = i + 1; j < bestSeq.length; j++) {
          const cand = [
            ...bestSeq.slice(0, i),
            ...bestSeq.slice(i, j + 1).reverse(),
            ...bestSeq.slice(j + 1),
          ];
          const candScore = blockCost(cand);
          if (candScore + 1 < bestScore) {
            bestSeq = cand;
            bestScore = candScore;
            improved = true;
          }
        }
      }
    }

    return bestSeq;
  };

  if (urgentIndices.length > 0 && normalIndices.length > 0) {
    const optUrgent = optimizeBlock(urgentIndices, 0, null);
    const lastUrgent = optUrgent[optUrgent.length - 1];
    const optNormal = optimizeBlock(normalIndices, lastUrgent, 0);
    return [...optUrgent, ...optNormal];
  }

  return optimizeBlock(clusterIndices, 0, 0);
}

/**
 * Agrupación Clarke-Wright Savings basada en Capacidad de Jornada (maxWorkdayMinutes y maxStopsPerRoute)
 * garantizando que las Averías Urgentes entren primero en el Turno #1.
 */
function clarkeWrightTimeClustering<T extends RoutableServiceOrder>(
  orders: T[],
  distMatrixKm: number[][],
  durMatrixSec: number[][],
  maxWorkdayMinutes: number,
  maxStopsPerRoute: number
): number[][] {
  const n = orders.length;
  if (n === 0) return [];
  if (n === 1) return [[1]];

  const routes: number[][] = [];
  const routeOfClient = new Array<number>(n + 1).fill(-1);

  for (let i = 1; i <= n; i++) {
    routes.push([i]);
    routeOfClient[i] = i - 1;
  }

  interface SavingPair {
    i: number;
    j: number;
    saving: number;
  }
  const savings: SavingPair[] = [];

  for (let i = 1; i <= n; i++) {
    for (let j = i + 1; j <= n; j++) {
      // Bonus de ahorro si ambos son Urgentes para agruparlos juntos en el Turno #1
      const bothUrgent =
        orders[i - 1]?.priority === "Urgente" &&
        orders[j - 1]?.priority === "Urgente";
      const s =
        (distMatrixKm[0][i] || 0) +
        (distMatrixKm[0][j] || 0) -
        (distMatrixKm[i][j] || 0) +
        (bothUrgent ? 25 : 0);
      savings.push({ i, j, saving: s });
    }
  }

  savings.sort((a, b) => b.saving - a.saving);

  for (const { i, j, saving } of savings) {
    if (saving <= 0) break;

    const rI = routeOfClient[i];
    const rJ = routeOfClient[j];
    if (rI === rJ) continue;

    const routeI = routes[rI];
    const routeJ = routes[rJ];
    if (routeI.length === 0 || routeJ.length === 0) continue;
    if (routeI.length + routeJ.length > maxStopsPerRoute) continue;

    const iIsStart = routeI[0] === i;
    const iIsEnd = routeI[routeI.length - 1] === i;
    const jIsStart = routeJ[0] === j;
    const jIsEnd = routeJ[routeJ.length - 1] === j;

    if (!(iIsStart || iIsEnd) || !(jIsStart || jIsEnd)) continue;

    const orientedI = iIsEnd ? [...routeI] : [...routeI].reverse();
    const orientedJ = jIsStart ? [...routeJ] : [...routeJ].reverse();
    const merged = [...orientedI, ...orientedJ];

    const mergedTimeMin = estimateClusterTimeMinutes(merged, orders, durMatrixSec);
    if (mergedTimeMin > maxWorkdayMinutes) continue;

    routes[rI] = merged;
    routes[rJ] = [];
    for (const clientIdx of merged) {
      routeOfClient[clientIdx] = rI;
    }
  }

  return routes.filter((r) => r.length > 0);
}

/**
 * Mejora Inter-Ruta (Swap & Relocate) para reducir tiempo total de conducción
 * sin exceder maxWorkdayMinutes ni maxStopsPerRoute.
 */
function applyInterRouteTimeOptimization<T extends RoutableServiceOrder>(
  initialTrips: number[][],
  orders: T[],
  distMatrixKm: number[][],
  durMatrixSec: number[][],
  maxWorkdayMinutes: number,
  maxStopsPerRoute: number
): { improvedTrips: number[][]; swapsCount: number } {
  if (initialTrips.length <= 1) {
    return { improvedTrips: initialTrips, swapsCount: 0 };
  }

  let trips = initialTrips.map((t) => [...t]);
  let swapsCount = 0;

  for (let pass = 0; pass < 3; pass++) {
    let improved = false;

    for (let rA = 0; rA < trips.length; rA++) {
      for (let rB = rA + 1; rB < trips.length; rB++) {
        if (trips[rA].length === 0 || trips[rB].length === 0) continue;

        const baseTimeA = estimateClusterTimeMinutes(
          trips[rA],
          orders,
          durMatrixSec
        );
        const baseTimeB = estimateClusterTimeMinutes(
          trips[rB],
          orders,
          durMatrixSec
        );
        const currentCombined = baseTimeA + baseTimeB;

        // 1. Probar Swap 1-por-1 entre avisos del mismo nivel de prioridad
        for (let idxA = 0; idxA < trips[rA].length; idxA++) {
          for (let idxB = 0; idxB < trips[rB].length; idxB++) {
            const cA = trips[rA][idxA];
            const cB = trips[rB][idxB];
            if (orders[cA - 1]?.priority !== orders[cB - 1]?.priority) continue;

            const candA = [...trips[rA]];
            const candB = [...trips[rB]];
            candA[idxA] = cB;
            candB[idxB] = cA;

            const optA = optimizeSingleShiftSequence(
              candA,
              orders,
              distMatrixKm,
              durMatrixSec
            );
            const optB = optimizeSingleShiftSequence(
              candB,
              orders,
              distMatrixKm,
              durMatrixSec
            );

            const tA = estimateClusterTimeMinutes(optA, orders, durMatrixSec);
            const tB = estimateClusterTimeMinutes(optB, orders, durMatrixSec);

            if (
              tA <= maxWorkdayMinutes &&
              tB <= maxWorkdayMinutes &&
              tA + tB < currentCombined - 2
            ) {
              trips[rA] = optA;
              trips[rB] = optB;
              swapsCount++;
              improved = true;
              break;
            }
          }
          if (improved) break;
        }
      }
    }

    if (!improved) break;
  }

  return {
    improvedTrips: trips.filter((t) => t.length > 0),
    swapsCount,
  };
}

function buildFieldTripMetricsObject<T extends RoutableServiceOrder>(
  tripNumber: number,
  sortedOrders: T[],
  sortedMatrixIndices: number[],
  allOrders: T[],
  distMatrixKm: number[][],
  durMatrixSec: number[][],
  maxWorkdayMinutes: number,
  params: FieldRoutingParams
): OptimizedFieldRoute<T> {
  const evalRes = evaluateFieldRoute(
    sortedMatrixIndices,
    allOrders,
    distMatrixKm,
    durMatrixSec,
    params
  );

  const occupancyPercent = Math.round(
    (evalRes.totalWorkdayMinutes / Math.max(1, maxWorkdayMinutes)) * 100
  );
  const totalFuelCostEur = evalRes.totalFuelLiters * params.precioCombustible;
  const totalLaborCostEur =
    params.hourlyCostEur && params.hourlyCostEur > 0
      ? (evalRes.totalWorkdayMinutes / 60) * params.hourlyCostEur
      : 0;
  const totalCostEur = totalFuelCostEur + totalLaborCostEur;
  const costPerStopEur =
    sortedOrders.length > 0 ? totalCostEur / sortedOrders.length : 0;

  const urgentOrdersCount = sortedOrders.filter(
    (o) => o.priority === "Urgente"
  ).length;
  const averiaCount = sortedOrders.filter(
    (o) => (o.serviceType || "Avería") === "Avería"
  ).length;
  const revisionCount = sortedOrders.filter(
    (o) => o.serviceType === "Revisión"
  ).length;
  const instalacionCount = sortedOrders.filter(
    (o) => o.serviceType === "Instalación"
  ).length;

  const tripRevenueEur = Number(
    sortedOrders
      .reduce(
        (sum, o) => sum + (o.collectedPriceEur ?? o.estimatedPriceEur ?? 0),
        0
      )
      .toFixed(2)
  );
  const tripNetMarginEur = Number((tripRevenueEur - totalCostEur).toFixed(2));
  const tripNetMarginPercent =
    tripRevenueEur > 0
      ? Number(((tripNetMarginEur / tripRevenueEur) * 100).toFixed(1))
      : 0;

  const isOvertimeWarning = evalRes.totalWorkdayMinutes > maxWorkdayMinutes;
  const warningReason = isOvertimeWarning
    ? `Este turno supera la jornada máxima (${evalRes.totalWorkdayMinutes} / ${maxWorkdayMinutes} min) por la duración de las intervenciones.`
    : undefined;

  return {
    tripNumber,
    orders: sortedOrders,
    totalStops: sortedOrders.length,
    totalInterventionMinutes: evalRes.totalInterventionMinutes,
    estimatedDrivingSeconds: Math.round(evalRes.totalDrivingSeconds),
    estimatedDrivingMinutes: Math.max(
      1,
      Math.round(evalRes.totalDrivingSeconds / 60)
    ),
    totalWorkdayMinutes: evalRes.totalWorkdayMinutes,
    occupancyPercent,
    totalDistanceKm: Number(evalRes.totalDistanceKm.toFixed(2)),
    totalFuelLiters: Number(evalRes.totalFuelLiters.toFixed(2)),
    totalFuelCostEur: Number(totalFuelCostEur.toFixed(2)),
    totalLaborCostEur: Number(totalLaborCostEur.toFixed(2)),
    costPerStopEur: Number(costPerStopEur.toFixed(2)),
    urgentOrdersCount,
    averiaCount,
    revisionCount,
    instalacionCount,
    tripRevenueEur,
    tripNetMarginEur,
    tripNetMarginPercent,
    isOvertimeWarning,
    warningReason,
    legDetails: evalRes.legDetails,
    returnLeg: evalRes.returnLeg,
  };
}

/**
 * Recalcula en tiempo real las métricas de un turno cuando el Coordinador
 * reordena avisos (Drag & Drop) o invierte el sentido usando la caché OSRM real.
 */
export function recalculateSingleFieldTripSync<T extends RoutableServiceOrder>(
  tripOrders: T[],
  tripNumber: number,
  warehouseCoords: Coordinates,
  maxWorkdayMinutes: number,
  params: FieldRoutingParams = DEFAULT_FIELD_ROUTING_PARAMS
): OptimizedFieldRoute<T> {
  const allCoords = [
    warehouseCoords,
    ...tripOrders.map((o) => getOrderCoordinates(o)),
  ];
  const { distKm, durSec } = buildFallbackMatrices(allCoords);
  const indices = tripOrders.map((_, i) => i + 1);

  return buildFieldTripMetricsObject(
    tripNumber,
    tripOrders,
    indices,
    tripOrders,
    distKm,
    durSec,
    maxWorkdayMinutes,
    params
  );
}

/**
 * MOTOR PRINCIPAL DE OPTIMIZACIÓN DE JORNADAS TÉCNICAS (SATRuta)
 * (Clarke-Wright por Tiempo de Jornada + Priorización de Urgencias + 2-Opt OSRM)
 */
export async function optimizeFieldServiceRoutes<T extends RoutableServiceOrder>(
  orders: T[],
  warehouseCoords: Coordinates,
  maxWorkdayMinutes: number = FIELD_SERVICE_RULES.DEFAULT_MAX_WORKDAY_MINUTES,
  maxStopsPerRoute: number = FIELD_SERVICE_RULES.DEFAULT_MAX_STOPS_PER_ROUTE,
  params: FieldRoutingParams = DEFAULT_FIELD_ROUTING_PARAMS
): Promise<FieldRoutingResult<T>> {
  if (orders.length === 0) {
    return {
      trips: [],
      exceededWorkday: false,
      totalOrders: 0,
      totalInterventionMinutes: 0,
      totalDrivingMinutes: 0,
      totalWorkdayMinutes: 0,
      usedRealOsrmTable: false,
      fromOsrmCache: false,
      totalDistanceKm: 0,
      totalFuelLiters: 0,
      totalFuelCostEur: 0,
      totalLaborCostEur: 0,
      averageCostPerStopEur: 0,
      totalRevenueEur: 0,
      totalNetMarginEur: 0,
      interRouteSwapsApplied: 0,
    };
  }

  const allCoords = [
    warehouseCoords,
    ...orders.map((o) => getOrderCoordinates(o)),
  ];

  const osrmTable = await fetchOsrmTable(allCoords);
  const fallback = buildFallbackMatrices(allCoords);

  let distMatrixKm = fallback.distKm;
  let durMatrixSec = fallback.durSec;
  let usedRealOsrm = false;
  let fromOsrmCache = false;

  if (
    osrmTable &&
    osrmTable.durations &&
    osrmTable.durations.length === allCoords.length
  ) {
    usedRealOsrm = true;
    fromOsrmCache = Boolean(osrmTable.fromCache);
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
      distMatrixKm = durMatrixSec.map((row) =>
        row.map((sec) => (sec / 3600) * 50)
      );
    }
  }

  const cwClusters = clarkeWrightTimeClustering(
    orders,
    distMatrixKm,
    durMatrixSec,
    maxWorkdayMinutes,
    maxStopsPerRoute
  );

  const initialOptimized = cwClusters.map((cluster) =>
    optimizeSingleShiftSequence(cluster, orders, distMatrixKm, durMatrixSec)
  );

  const { improvedTrips, swapsCount } = applyInterRouteTimeOptimization(
    initialOptimized,
    orders,
    distMatrixKm,
    durMatrixSec,
    maxWorkdayMinutes,
    maxStopsPerRoute
  );

  const finalUnsorted: OptimizedFieldRoute<T>[] = improvedTrips.map(
    (cluster, idx) => {
      const bestSeq = optimizeSingleShiftSequence(
        cluster,
        orders,
        distMatrixKm,
        durMatrixSec
      );
      const sortedOrders = bestSeq.map((matrixIdx) => orders[matrixIdx - 1]);
      return buildFieldTripMetricsObject(
        idx + 1,
        sortedOrders,
        bestSeq,
        orders,
        distMatrixKm,
        durMatrixSec,
        maxWorkdayMinutes,
        params
      );
    }
  );

  // Ordenar turnos: primero los que tienen Averías Urgentes, luego los más completos
  finalUnsorted.sort((a, b) => {
    if (b.urgentOrdersCount !== a.urgentOrdersCount) {
      return b.urgentOrdersCount - a.urgentOrdersCount;
    }
    if (b.averiaCount !== a.averiaCount) {
      return b.averiaCount - a.averiaCount;
    }
    return b.totalWorkdayMinutes - a.totalWorkdayMinutes;
  });

  const trips = finalUnsorted.map((t, idx) => ({
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
  const totalInterventionMinutes = trips.reduce(
    (sum, t) => sum + t.totalInterventionMinutes,
    0
  );
  const totalWorkdayMinutes = totalDrivingMinutes + totalInterventionMinutes;
  const totalFuelLiters = Number(
    trips.reduce((sum, t) => sum + t.totalFuelLiters, 0).toFixed(2)
  );
  const totalFuelCostEur = Number(
    trips.reduce((sum, t) => sum + t.totalFuelCostEur, 0).toFixed(2)
  );
  const totalLaborCostEur = Number(
    trips.reduce((sum, t) => sum + t.totalLaborCostEur, 0).toFixed(2)
  );
  const averageCostPerStopEur =
    orders.length > 0
      ? Number(((totalFuelCostEur + totalLaborCostEur) / orders.length).toFixed(2))
      : 0;
  const totalRevenueEur = Number(
    trips.reduce((sum, t) => sum + t.tripRevenueEur, 0).toFixed(2)
  );
  const totalNetMarginEur = Number(
    trips.reduce((sum, t) => sum + t.tripNetMarginEur, 0).toFixed(2)
  );

  return {
    trips,
    exceededWorkday: trips.length > 1 || totalWorkdayMinutes > maxWorkdayMinutes,
    totalOrders: orders.length,
    totalInterventionMinutes,
    totalDrivingMinutes,
    totalWorkdayMinutes,
    usedRealOsrmTable: usedRealOsrm,
    fromOsrmCache,
    totalDistanceKm,
    totalFuelLiters,
    totalFuelCostEur,
    totalLaborCostEur,
    averageCostPerStopEur,
    totalRevenueEur,
    totalNetMarginEur,
    interRouteSwapsApplied: swapsCount,
  };
}
