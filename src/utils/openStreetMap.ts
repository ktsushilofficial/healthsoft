/**
 * OpenStreetMap in the browser / WebView (no API key, works on iOS & Android).
 * mlat/mlon shows the default marker pin on osm.org.
 */
export function buildOpenStreetMapMarkerUrl(
  latitude: number,
  longitude: number,
  zoom = 16
): string {
  const lat = latitude.toFixed(6);
  const lon = longitude.toFixed(6);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`;
}
