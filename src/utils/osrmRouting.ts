import { Coordinates } from "@/types/pellet";

export interface OsrmRouteResult {
  polyline: [number, number][]; // Coordenadas [lat, lng] para Leaflet
  distanceKm: number;
  durationDrivingMinutes: number;
}

/**
 * Calcula la distancia ortodrómica en kilómetros entre dos coordenadas (Fórmula Haversine).
 */
export function haversineDistanceKm(
  coord1: Coordinates,
  coord2: Coordinates
): number {
  const R = 6371; // Radio de la Tierra en km
  const dLat = ((coord2.lat - coord1.lat) * Math.PI) / 180;
  const dLng = ((coord2.lng - coord1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((coord1.lat * Math.PI) / 180) *
      Math.cos((coord2.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Consulta la API pública gratuita de OSRM (Open Source Routing Machine)
 * para obtener la ruta exacta por carretera, distancia real y tiempo de conducción.
 *
 * @param coordinates Array ordenado de paradas (ej. [Base, Cliente1, Cliente2, Base])
 */
export async function fetchOsrmRoute(
  coordinates: Coordinates[]
): Promise<OsrmRouteResult> {
  if (coordinates.length < 2) {
    return {
      polyline: coordinates.map((c) => [c.lat, c.lng]),
      distanceKm: 0,
      durationDrivingMinutes: 0,
    };
  }

  // OSRM espera las coordenadas en formato: {lng},{lat};{lng},{lat}
  const coordsString = coordinates
    .map((c) => `${c.lng.toFixed(6)},${c.lat.toFixed(6)}`)
    .join(";");

  const url = `https://router.project-osrm.org/route/v1/driving/${coordsString}?overview=full&geometries=geojson&steps=false`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout de seguridad

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`OSRM error: ${response.status}`);
    }

    const data = await response.json();

    if (data.code === "Ok" && data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      // En GeoJSON las coordenadas vienen [lng, lat], Leaflet necesita [lat, lng]
      const polyline: [number, number][] = route.geometry.coordinates.map(
        (pt: [number, number]) => [pt[1], pt[0]]
      );
      const distanceKm = Number((route.distance / 1000).toFixed(2));
      const durationDrivingMinutes = Math.round(route.duration / 60);

      return {
        polyline,
        distanceKm,
        durationDrivingMinutes,
      };
    }
  } catch (error) {
    console.warn("Fallo o timeout en OSRM. Usando fallback Haversine:", error);
  }

  // Fallback euclidiano / Haversine por carretera (+25% de factor de curvatura de carretera)
  let totalDistanceKm = 0;
  for (let i = 0; i < coordinates.length - 1; i++) {
    totalDistanceKm += haversineDistanceKm(coordinates[i], coordinates[i + 1]);
  }
  totalDistanceKm = Number((totalDistanceKm * 1.25).toFixed(2));
  // Velocidad media estimada en reparto comarcal/urbano: ~45 km/h
  const durationDrivingMinutes = Math.round((totalDistanceKm / 45) * 60);

  return {
    polyline: coordinates.map((c) => [c.lat, c.lng]),
    distanceKm: totalDistanceKm,
    durationDrivingMinutes,
  };
}
