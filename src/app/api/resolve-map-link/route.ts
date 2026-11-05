import { NextRequest, NextResponse } from "next/server";

interface CoordinateResult {
  lat: number;
  lng: number;
  source: string;
}

/**
 * Convierte grados, minutos y segundos (DMS) a grados decimales.
 */
function dmsToDecimal(
  deg: number,
  min: number,
  sec: number,
  dir: string
): number {
  let decimal = deg + min / 60 + sec / 3600;
  const upper = dir.toUpperCase();
  if (upper === "S" || upper === "W" || upper === "O") {
    decimal = -decimal;
  }
  return Number(decimal.toFixed(6));
}

/**
 * Parser exhaustivo de coordenadas para Google Maps y formatos directos.
 * Prioridad:
 * 1. !3dLAT!4dLNG (Pin / tejado exacto fijado en Google Maps)
 * 2. @LAT,LNG (Centro de visualización del mapa)
 * 3. ?q=LAT,LNG o query= o ll= o destination=
 * 4. Grados DMS (ej. 42°03'41.4"N 7°43'29.3"W)
 * 5. Coordenadas decimales crudas (ej. 42.0615, -7.7248)
 */
function extractCoordinatesFromText(text: string): CoordinateResult | null {
  if (!text) return null;

  // 1. PRIORITARIO: Patrón !3dLAT!4dLNG (Coordenada exacta del edificio/pin)
  const pinDataRegex = /!3d(-?\d{1,2}(?:\.\d+)?)[^!]*!4d(-?\d{1,3}(?:\.\d+)?)/;
  const pinDataMatch = text.match(pinDataRegex);
  if (pinDataMatch) {
    const lat = parseFloat(pinDataMatch[1]);
    const lng = parseFloat(pinDataMatch[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return {
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
        source: "Pin exacto de Google Maps (!3d!4d)",
      };
    }
  }

  // 2. Patrón @LAT,LNG (Centro de cámara del mapa)
  const atRegex = /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/;
  const atMatch = text.match(atRegex);
  if (atMatch) {
    const lat = parseFloat(atMatch[1]);
    const lng = parseFloat(atMatch[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return {
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
        source: "Centro del mapa (@lat,lng)",
      };
    }
  }

  // 3. Patrón ?q=LAT,LNG o query= o ll= o destination=
  const qRegex = /[?&](?:q|query|ll|destination)=(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/;
  const qMatch = text.match(qRegex);
  if (qMatch) {
    const lat = parseFloat(qMatch[1]);
    const lng = parseFloat(qMatch[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return {
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
        source: "Parámetro de búsqueda (?q=)",
      };
    }
  }

  // 4. Coordenadas en formato DMS (Grados, Minutos, Segundos)
  // Ej: 42°03'41.4"N 7°43'29.3"W o 42°03'41.4"N, 7°43'29.3"O o con espacios
  const dmsRegex =
    /(\d{1,2})[\u00B0\u00BA\s]+(\d{1,2})['\u2032\s]+(\d{1,2}(?:\.\d+)?)["\u2033\s]*([NnSs])[\s,]+(\d{1,3})[\u00B0\u00BA\s]+(\d{1,2})['\u2032\s]+(\d{1,2}(?:\.\d+)?)["\u2033\s]*([EeWwOo])/i;
  const dmsMatch = text.match(dmsRegex);
  if (dmsMatch) {
    const latDeg = parseFloat(dmsMatch[1]);
    const latMin = parseFloat(dmsMatch[2]);
    const latSec = parseFloat(dmsMatch[3]);
    const latDir = dmsMatch[4];

    const lngDeg = parseFloat(dmsMatch[5]);
    const lngMin = parseFloat(dmsMatch[6]);
    const lngSec = parseFloat(dmsMatch[7]);
    const lngDir = dmsMatch[8];

    const lat = dmsToDecimal(latDeg, latMin, latSec, latDir);
    const lng = dmsToDecimal(lngDeg, lngMin, lngSec, lngDir);

    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return {
        lat,
        lng,
        source: "Grados DMS (º ' \")",
      };
    }
  }

  // 5. Coordenadas decimales crudas: "42.0615, -7.7248" o "42.0615 -7.7248"
  const rawRegex = /(-?\d{1,2}\.\d{3,})[\s,]+(-?\d{1,3}\.\d{3,})/;
  const rawMatch = text.match(rawRegex);
  if (rawMatch) {
    const lat = parseFloat(rawMatch[1]);
    const lng = parseFloat(rawMatch[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return {
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
        source: "Coordenadas decimales directas",
      };
    }
  }

  return null;
}

/**
 * Geocodificación inversa mediante Nominatim para devolver la aldea / concello.
 */
async function reverseGeocodeGalicia(
  lat: number,
  lng: number
): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "PelletGalicia-Rural-Logistics/2.0 (admin@pelletgalicia.local)",
        Accept: "application/json",
      },
      next: { revalidate: 86400 }, // Cache 24h
    });

    if (!res.ok) return null;
    const data = await res.json();
    const addr = data.address || {};

    const placeName =
      addr.hamlet ||
      addr.village ||
      addr.isolated_dwelling ||
      addr.place ||
      addr.road ||
      "";
    const parishOrDistrict = addr.city_district || addr.suburb || addr.quarter || "";
    const municipality =
      addr.municipality || addr.city || addr.town || addr.county || "";
    const province = addr.province || addr.state || "";

    const parts: string[] = [];
    if (placeName) parts.push(placeName);
    if (parishOrDistrict && parishOrDistrict !== placeName)
      parts.push(parishOrDistrict);
    if (municipality && municipality !== placeName) parts.push(municipality);
    if (province) parts.push(`(${province})`);

    return parts.length > 0 ? parts.join(", ") : data.display_name?.split(",").slice(0, 3).join(",") || null;
  } catch (err) {
    console.warn("Fallo en geocodificación inversa:", err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input: string = (body.url || body.text || "").trim();

    if (!input) {
      return NextResponse.json(
        { success: false, error: "No se proporcionó ningún enlace o texto." },
        { status: 400 }
      );
    }

    // A) Probar si el texto original ya contiene coordenadas directas (DMS o decimales)
    let extracted = extractCoordinatesFromText(input);

    // B) Buscar si contiene una URL (especialmente enlaces acortados o de Google Maps)
    const urlRegex = /(https?:\/\/[^\s<>"']+)/i;
    const urlMatch = input.match(urlRegex);

    let expandedUrl = "";
    if (urlMatch) {
      const targetUrl = urlMatch[1];

      try {
        const response = await fetch(targetUrl, {
          method: "GET",
          redirect: "follow",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "es-ES,es;q=0.9,gl;q=0.8,en;q=0.7",
          },
        });

        expandedUrl = response.url || targetUrl;

        // 1. Probar en la URL expandida (aquí suele venir !3dLAT!4dLNG o @LAT,LNG)
        const expandedMatch = extractCoordinatesFromText(expandedUrl);
        if (expandedMatch) {
          extracted = expandedMatch;
        } else {
          // 2. Si no viene en la URL final, inspeccionar el HTML devuelto
          const html = await response.text();

          // Buscar en meta refresh o enlaces de redirección en el HTML
          const metaRefreshMatch = html.match(
            /meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["']?\d+;\s*url=([^"'>]+)["']/i
          );
          if (metaRefreshMatch) {
            const redirectUrl = metaRefreshMatch[1];
            const metaCoord = extractCoordinatesFromText(redirectUrl);
            if (metaCoord) {
              extracted = metaCoord;
              expandedUrl = redirectUrl;
            }
          }

          // Buscar patrones directamente en el contenido del HTML
          if (!extracted) {
            const htmlCoord = extractCoordinatesFromText(html);
            if (htmlCoord) {
              extracted = htmlCoord;
            }
          }
        }
      } catch (fetchErr: any) {
        console.warn("Error expandiendo enlace de mapa:", fetchErr?.message);
      }
    }

    if (!extracted) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No se pudieron extraer coordenadas del enlace o texto proporcionado. Comprueba que sea una ubicación válida de Google Maps o coordenadas directas.",
        },
        { status: 422 }
      );
    }

    // Geocodificación inversa opcional para rellenar la aldea/concello
    const resolvedAddress = await reverseGeocodeGalicia(
      extracted.lat,
      extracted.lng
    );

    return NextResponse.json({
      success: true,
      lat: extracted.lat,
      lng: extracted.lng,
      source: extracted.source,
      expandedUrl: expandedUrl || undefined,
      resolvedAddress: resolvedAddress || undefined,
    });
  } catch (error: any) {
    console.error("Error en /api/resolve-map-link:", error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Error procesando el enlace de ubicación.",
      },
      { status: 500 }
    );
  }
}
