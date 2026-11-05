import { Coordinates } from "@/types/pelletVan";

export interface OsrmTableResult {
  durations: number[][]; // durations[i][j] en segundos
  distances?: number[][]; // distances[i][j] en metros
}

export interface OsrmRouteGeometryResult {
  polyline: [number, number][]; // [lat, lng]
  distanceKm: number;
  durationMinutes: number;
}

/**
 * Consulta la API OSRM Table para obtener la matriz exacta de tiempos reales de conducción
 * entre todos los pares de puntos (Almacén + Clientes).
 *
 * @param coordinates Array de coordenadas: [Almacén (índice 0), Cliente 1, Cliente 2, ...]
 */
export async function fetchOsrmTable(
  coordinates: Coordinates[]
): Promise<OsrmTableResult | null> {
  if (coordinates.length < 2) return null;

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
    if (data.code === "Ok" && data.durations) {
      return {
        durations: data.durations, // en segundos
        distances: data.distances, // en metros
      };
    }
  } catch (error) {
    console.error("Fallo conectando a OSRM Table API:", error);
  }

  return null;
}

/**
 * Traza la polilínea real por carretera para una secuencia ordenada de paradas
 * usando la API de OSRM Route.
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
        return {
          polyline,
          distanceKm: Number((route.distance / 1000).toFixed(2)),
          durationMinutes: Math.round(route.duration / 60),
        };
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
