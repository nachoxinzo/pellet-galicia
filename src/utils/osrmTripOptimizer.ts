import { Coordinates } from "@/types/pelletVan";

export interface OsrmTripOptimizationResult {
  orderedWaypointsIndices: number[]; // Índices ordenados de las coordenadas de entrada
  polyline: [number, number][]; // Polilínea por carretera real
  totalDistanceKm: number;
  totalDurationMinutes: number;
}

/**
 * Consulta la API OSRM Trip con source=first, destination=last y roundtrip=true
 * para optimizar de forma nativa la secuencia de paradas de un viaje por carretera real.
 * 
 * Formato OSRM:
 * https://router.project-osrm.org/trip/v1/driving/{coords}?source=first&destination=last&roundtrip=true&overview=full&geometries=geojson
 * 
 * Nota de OSRM Trip: Para forzar que salga de la Base y regrese a la Base con roundtrip=true,
 * el primer punto debe ser la Base.
 */
export async function optimizeWithOsrmTripApi(
  warehouse: Coordinates,
  ordersCoords: Coordinates[]
): Promise<OsrmTripOptimizationResult | null> {
  if (ordersCoords.length === 0) return null;

  // Si solo hay 1 cliente: Base -> Cliente -> Base
  if (ordersCoords.length === 1) {
    return {
      orderedWaypointsIndices: [0],
      polyline: [
        [warehouse.lat, warehouse.lng],
        [ordersCoords[0].lat, ordersCoords[0].lng],
        [warehouse.lat, warehouse.lng],
      ],
      totalDistanceKm: 0,
      totalDurationMinutes: 0,
    };
  }

  // Lista de puntos para OSRM: Índice 0 = Almacén, Índices 1..N = Clientes
  const allCoords = [warehouse, ...ordersCoords];
  const coordsStr = allCoords
    .map((c) => `${c.lng.toFixed(6)},${c.lat.toFixed(6)}`)
    .join(";");

  // source=first obliga a salir del almacén (índice 0) y roundtrip=true obliga a regresar a él
  const url = `https://router.project-osrm.org/trip/v1/driving/${coordsStr}?source=first&destination=last&roundtrip=true&overview=full&geometries=geojson&steps=false`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data.code === "Ok" && data.trips && data.trips.length > 0) {
        const trip = data.trips[0];
        const waypoints = data.waypoints || [];

        // Los waypoints vienen con waypoint_index correspondiente a su orden en la ruta optimizada
        // Filtramos para extraer el orden de los clientes (excluyendo el almacén inicial/final)
        const sortedWaypoints = [...waypoints].sort(
          (a: any, b: any) => a.waypoint_index - b.waypoint_index
        );

        // Mapeamos los índices de clientes (restando 1 porque el índice 0 era el almacén)
        const orderedClientIndices: number[] = [];
        for (const wp of sortedWaypoints) {
          const originalIdx = wp.location ? allCoords.findIndex(
            (c) => Math.abs(c.lng - wp.location[0]) < 0.0001 && Math.abs(c.lat - wp.location[1]) < 0.0001
          ) : -1;

          if (originalIdx > 0 && !orderedClientIndices.includes(originalIdx - 1)) {
            orderedClientIndices.push(originalIdx - 1);
          }
        }

        // Si por alguna razón no se mapearon todos, rellenar los faltantes
        for (let i = 0; i < ordersCoords.length; i++) {
          if (!orderedClientIndices.includes(i)) {
            orderedClientIndices.push(i);
          }
        }

        const polyline: [number, number][] = trip.geometry.coordinates.map(
          (pt: [number, number]) => [pt[1], pt[0]]
        );

        return {
          orderedWaypointsIndices: orderedClientIndices,
          polyline,
          totalDistanceKm: Number((trip.distance / 1000).toFixed(2)),
          totalDurationMinutes: Math.round(trip.duration / 60),
        };
      }
    }
  } catch (err) {
    console.warn("Fallo o timeout en OSRM Trip API:", err);
  }

  return null;
}
