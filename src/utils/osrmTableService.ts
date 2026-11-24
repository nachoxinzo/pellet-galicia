import { Coordinates } from "@/types/pelletGalicia";

export interface OsrmTableResult {
  durations: number[][]; // durations[i][j] en segundos
  distances?: number[][]; // distances[i][j] en metros
  fromCache?: boolean;
}

export interface OsrmRouteGeometryResult {
  polyline: [number, number][]; // [lat, lng]
  distanceKm: number;
  durationMinutes: number;
  fromCache?: boolean;
}

const PAIR_CACHE_STORAGE_KEY = "pelletgalicia_osrm_pairs_v1";
const ROUTE_CACHE_STORAGE_KEY = "pelletgalicia_osrm_routes_v1";
const MAX_PAIR_CACHE_ENTRIES = 1600;
const MAX_ROUTE_CACHE_ENTRIES = 35;

interface PairMetrics {
  d: number; // distanceMeters
  t: number; // durationSeconds
}

const memoryPairCache = new Map<string, PairMetrics>();
const memoryRouteCache = new Map<string, OsrmRouteGeometryResult>();
let isPairCacheHydrated = false;

function formatCoordKey(c: Coordinates): string {
  return `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`;
}

function buildPairKey(a: Coordinates, b: Coordinates): string {
  return `${formatCoordKey(a)}>_>${formatCoordKey(b)}`;
}

function buildRouteSequenceKey(coords: Coordinates[]): string {
  return coords.map(formatCoordKey).join("|");
}

function hydratePairCacheFromSession(): void {
  if (isPairCacheHydrated || typeof window === "undefined") return;
  isPairCacheHydrated = true;
  try {
    const raw = sessionStorage.getItem(PAIR_CACHE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, PairMetrics>;
    if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed)) {
        if (v && typeof v.d === "number" && typeof v.t === "number") {
          memoryPairCache.set(k, v);
        }
      }
    }
  } catch {
    // Ignorar fallos de lectura de sessionStorage
  }
}

function persistPairCacheToSession(): void {
  if (typeof window === "undefined") return;
  try {
    // Recortar entradas antiguas si supera el límite LRU
    if (memoryPairCache.size > MAX_PAIR_CACHE_ENTRIES) {
      const excess = memoryPairCache.size - MAX_PAIR_CACHE_ENTRIES;
      let removed = 0;
      for (const key of memoryPairCache.keys()) {
        memoryPairCache.delete(key);
        removed += 1;
        if (removed >= excess) break;
      }
    }
    const obj: Record<string, PairMetrics> = {};
    for (const [k, v] of memoryPairCache.entries()) {
      obj[k] = v;
    }
    sessionStorage.setItem(PAIR_CACHE_STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // Ignorar cuota llena en sessionStorage
  }
}

/**
 * Devuelve la distancia (en metros) y duración (en segundos) real por carretera OSRM
 * entre dos coordenadas si ya se ha consultado en esta sesión.
 */
export function getCachedOsrmPairMetrics(
  a: Coordinates,
  b: Coordinates
): { distanceMeters: number; durationSeconds: number } | null {
  hydratePairCacheFromSession();
  const key = buildPairKey(a, b);
  if (formatCoordKey(a) === formatCoordKey(b)) {
    return { distanceMeters: 0, durationSeconds: 0 };
  }
  const hit = memoryPairCache.get(key);
  if (!hit) return null;
  return { distanceMeters: hit.d, durationSeconds: hit.t };
}

export function clearOsrmSessionCache(): void {
  memoryPairCache.clear();
  memoryRouteCache.clear();
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem(PAIR_CACHE_STORAGE_KEY);
      sessionStorage.removeItem(ROUTE_CACHE_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

/**
 * Consulta la API OSRM Table para obtener la matriz exacta de tiempos y distancias reales
 * de conducción entre todos los pares de puntos (Almacén + Clientes).
 * Si todos los pares ya están en la caché local de sesión, reconstruye la matriz en 0 ms sin llamada de red.
 */
export async function fetchOsrmTable(
  coordinates: Coordinates[]
): Promise<OsrmTableResult | null> {
  if (coordinates.length < 2) return null;

  hydratePairCacheFromSession();
  const n = coordinates.length;

  // 1. Comprobar si todos los pares (i, j) ya están cacheados en memoria/sessionStorage
  const cachedDurations: number[][] = Array.from({ length: n }, () =>
    new Array(n).fill(0)
  );
  const cachedDistances: number[][] = Array.from({ length: n }, () =>
    new Array(n).fill(0)
  );
  let allPairsCached = true;

  for (let i = 0; i < n && allPairsCached; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const hit = getCachedOsrmPairMetrics(coordinates[i], coordinates[j]);
      if (!hit) {
        allPairsCached = false;
        break;
      }
      cachedDurations[i][j] = hit.durationSeconds;
      cachedDistances[i][j] = hit.distanceMeters;
    }
  }

  if (allPairsCached) {
    return {
      durations: cachedDurations,
      distances: cachedDistances,
      fromCache: true,
    };
  }

  // 2. Consultar OSRM Table API y poblar la caché de pares
  const coordsString = coordinates
    .map((c) => `${c.lng.toFixed(6)},${c.lat.toFixed(6)}`)
    .join(";");

  const url = `https://router.project-osrm.org/table/v1/driving/${coordsString}?annotations=duration,distance`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn("Error en respuesta de OSRM Table API:", res.status);
      return null;
    }

    const data = await res.json();
    if (data.code === "Ok" && Array.isArray(data.durations)) {
      const durations: number[][] = data.durations;
      const distances: number[][] | undefined = data.distances;

      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const durSec = durations[i]?.[j];
          const distM = distances?.[i]?.[j];
          if (typeof durSec === "number" && durSec >= 0) {
            const safeDistM =
              typeof distM === "number" && distM >= 0
                ? distM
                : (durSec / 3600) * 50_000;
            memoryPairCache.set(buildPairKey(coordinates[i], coordinates[j]), {
              d: Math.round(safeDistM),
              t: Math.round(durSec),
            });
          }
        }
      }
      persistPairCacheToSession();

      return {
        durations,
        distances,
        fromCache: false,
      };
    }
  } catch (error) {
    console.error("Fallo conectando a OSRM Table API:", error);
  }

  return null;
}

/**
 * Traza la polilínea real por carretera para una secuencia ordenada de paradas
 * usando la API de OSRM Route, con caché local por secuencia de coordenadas.
 */
export async function fetchOsrmTripRoute(
  coordinates: Coordinates[]
): Promise<OsrmRouteGeometryResult> {
  if (coordinates.length < 2) {
    return {
      polyline: coordinates.map((c) => [c.lat, c.lng]),
      distanceKm: 0,
      durationMinutes: 0,
    };
  }

  const seqKey = buildRouteSequenceKey(coordinates);
  const cachedRoute = memoryRouteCache.get(seqKey);
  if (cachedRoute) {
    return { ...cachedRoute, fromCache: true };
  }

  const coordsString = coordinates
    .map((c) => `${c.lng.toFixed(6)},${c.lat.toFixed(6)}`)
    .join(";");

  const url = `https://router.project-osrm.org/route/v1/driving/${coordsString}?overview=full&geometries=geojson&steps=false`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data.code === "Ok" && data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const polyline: [number, number][] = route.geometry.coordinates.map(
          (pt: [number, number]) => [pt[1], pt[0]]
        );
        const result: OsrmRouteGeometryResult = {
          polyline,
          distanceKm: Number((route.distance / 1000).toFixed(2)),
          durationMinutes: Math.round(route.duration / 60),
          fromCache: false,
        };
        if (memoryRouteCache.size >= MAX_ROUTE_CACHE_ENTRIES) {
          const firstKey = memoryRouteCache.keys().next().value;
          if (firstKey) memoryRouteCache.delete(firstKey);
        }
        memoryRouteCache.set(seqKey, result);
        return result;
      }
    }
  } catch (err) {
    console.warn("Fallo en OSRM Route API:", err);
  }

  // Fallback de contingencia (geometría directa)
  return {
    polyline: coordinates.map((c) => [c.lat, c.lng]),
    distanceKm: 0,
    durationMinutes: 0,
  };
}
