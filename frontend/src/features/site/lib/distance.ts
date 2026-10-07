export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export interface Located {
  lat: number | null;
  lng: number | null;
}

/**
 * Items sorted by distance from origin. Items without coordinates keep
 * their relative order at the end with a null distance.
 */
export function sortByDistance<T extends Located>(items: T[], origin: LatLng): { item: T; km: number | null }[] {
  const ranked = items.map((item, index) => ({
    item,
    index,
    km: item.lat !== null && item.lng !== null ? haversineKm(origin, { lat: item.lat, lng: item.lng }) : null,
  }));
  ranked.sort((a, b) => {
    if (a.km === null && b.km === null) return a.index - b.index;
    if (a.km === null) return 1;
    if (b.km === null) return -1;
    return a.km - b.km;
  });
  return ranked.map(({ item, km }) => ({ item, km }));
}

/** "1,2 km" or "850 m". */
export function formatKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toLocaleString("id-ID", { maximumFractionDigits: 1 })} km`;
}
