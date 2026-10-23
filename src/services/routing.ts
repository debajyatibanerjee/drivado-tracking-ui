import { distance } from '../sim/geo';
import { LatLng } from '../types';

export interface Route {
  points: LatLng[];
  kind: 'road' | 'straight';
  meters: number; // driving distance
  seconds: number; // driving time
}

const FALLBACK_SPEED_MPS = 30 / 3.6; // assumed city speed for straight-line ETAs

// Driving route from the public OSRM server; a straight line if it's unreachable.
export async function fetchRoute(from: LatLng, to: LatLng): Promise<Route> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: ctrl.signal });
    const j = await res.json();
    const r = j?.routes?.[0];
    const coords: [number, number][] | undefined = r?.geometry?.coordinates;
    if (!coords || coords.length < 2) throw new Error('no route');
    // Make the line start and end exactly at the requested points.
    return {
      points: [from, ...coords.map(([lng, lat]) => ({ latitude: lat, longitude: lng })), to],
      kind: 'road',
      meters: r.distance,
      seconds: r.duration,
    };
  } catch {
    const meters = distance(from, to);
    return { points: [from, to], kind: 'straight', meters, seconds: meters / FALLBACK_SPEED_MPS };
  } finally {
    clearTimeout(t);
  }
}
