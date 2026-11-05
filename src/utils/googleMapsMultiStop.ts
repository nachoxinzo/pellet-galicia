import { Coordinates } from "@/types/pelletVan";

/**
 * Genera el enlace universal oficial de Google Maps con múltiples paradas (waypoints).
 * 
 * Formato oficial:
 * https://www.google.com/maps/dir/?api=1&origin=LAT_BASE,LNG_BASE&destination=LAT_BASE,LNG_BASE&waypoints=LAT1,LNG1|LAT2,LNG2|...&travelmode=driving
 * 
 * Usar coordenadas puras garantiza que en aldeas o zonas rurales sin número postal oficial
 * Google Maps guíe al conductor al tejado o nave exacto.
 *
 * @param warehouse Coordenadas del Almacén de origen y retorno
 * @param stopsCoords Array de coordenadas ordenadas de las paradas
 */
export function generateGoogleMapsMultiStopUrl(
  warehouse: Coordinates,
  stopsCoords: Coordinates[]
): string {
  if (stopsCoords.length === 0) {
    return `https://www.google.com/maps/dir/?api=1&destination=${warehouse.lat},${warehouse.lng}&travelmode=driving`;
  }

  const originStr = `${warehouse.lat.toFixed(6)},${warehouse.lng.toFixed(6)}`;
  const destinationStr = `${warehouse.lat.toFixed(6)},${warehouse.lng.toFixed(6)}`; // Retorno al almacén

  // Google Maps acepta hasta 9 waypoints intermedios en la URL oficial standard
  // Formato waypoints: LAT1,LNG1|LAT2,LNG2|LAT3,LNG3
  const waypointsStr = stopsCoords
    .map((c) => `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`)
    .join("|");

  const encodedWaypoints = encodeURIComponent(waypointsStr);

  return `https://www.google.com/maps/dir/?api=1&origin=${originStr}&destination=${destinationStr}&waypoints=${encodedWaypoints}&travelmode=driving`;
}

/**
 * Genera el enlace directo a una única parada para navegación inmediata
 */
export function generateGoogleMapsSingleStopUrl(coords: Coordinates): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}&travelmode=driving`;
}
