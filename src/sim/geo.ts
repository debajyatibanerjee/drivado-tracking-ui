import { LatLng } from '../types';

const R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function distance(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearing(a: LatLng, b: LatLng): number {
  const f1 = toRad(a.latitude);
  const f2 = toRad(b.latitude);
  const dl = toRad(b.longitude - a.longitude);
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function polylineLength(pts: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += distance(pts[i - 1], pts[i]);
  return total;
}

// Position and heading at `meters` along the polyline (clamped to its ends).
export function pointAlong(pts: LatLng[], meters: number): { point: LatLng; heading: number } {
  let remaining = Math.max(0, meters);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = distance(a, b);
    if (remaining <= seg || i === pts.length - 1) {
      const t = seg === 0 ? 1 : Math.min(1, remaining / seg);
      return {
        point: {
          latitude: a.latitude + (b.latitude - a.latitude) * t,
          longitude: a.longitude + (b.longitude - a.longitude) * t,
        },
        heading: bearing(a, b),
      };
    }
    remaining -= seg;
  }
  return { point: pts[0], heading: 0 };
}

// Point `meters` away from `p` in direction `bearingDeg`.
export function offset(p: LatLng, meters: number, bearingDeg: number): LatLng {
  const b = toRad(bearingDeg);
  return {
    latitude: p.latitude + (meters * Math.cos(b)) / 111320,
    longitude: p.longitude + (meters * Math.sin(b)) / (111320 * Math.cos(toRad(p.latitude))),
  };
}

// Meters along the polyline up to the vertex nearest to `p`.
export function distanceAlong(pts: LatLng[], p: LatLng): number {
  let best = 0;
  let bestD = Infinity;
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) acc += distance(pts[i - 1], pts[i]);
    const d = distance(pts[i], p);
    if (d < bestD) {
      bestD = d;
      best = acc;
    }
  }
  return best;
}

// Distance from `p` to the nearest vertex of the polyline (routes are dense, so this is close enough).
export function distanceToRoute(pts: LatLng[], p: LatLng): number {
  let best = Infinity;
  for (const q of pts) best = Math.min(best, distance(q, p));
  return best;
}

// Random offset of up to `meters`, to mimic GPS noise.
export function jitter(p: LatLng, meters: number): LatLng {
  const r = Math.random() * meters;
  const theta = Math.random() * 2 * Math.PI;
  const dLat = (r * Math.cos(theta)) / 111320;
  const dLng = (r * Math.sin(theta)) / (111320 * Math.cos(toRad(p.latitude)));
  return { latitude: p.latitude + dLat, longitude: p.longitude + dLng };
}
