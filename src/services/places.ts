import * as Location from 'expo-location';

import { LatLng, Place } from '../types';

const UA = { 'User-Agent': 'RNTracking-driver-test/1.0', Accept: 'application/json' };

export function isValidLatLng(p: LatLng | null | undefined): p is LatLng {
  return (
    !!p &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    Math.abs(p.latitude) <= 90 &&
    Math.abs(p.longitude) <= 180 &&
    !(p.latitude === 0 && p.longitude === 0)
  );
}

// Accepts "25.1972, 55.2744" or "25.1972 55.2744".
export function parseLatLng(text: string): LatLng | null {
  const m = text.trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const p = { latitude: Number(m[1]), longitude: Number(m[2]) };
  return isValidLatLng(p) ? p : null;
}

export const formatLatLng = (p: LatLng) => `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`;

async function fetchJson(url: string, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: UA, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const shortName = (displayName: string) => displayName.split(',').slice(0, 3).join(',').trim();

export async function reverseLabel(p: LatLng): Promise<string> {
  try {
    const j = await fetchJson(
      `https://nominatim.openstreetmap.org/reverse?format=json&accept-language=en&zoom=17&lat=${p.latitude}&lon=${p.longitude}`,
    );
    if (j?.display_name) return shortName(j.display_name);
  } catch {}
  return formatLatLng(p);
}

// Address or "lat, lng" -> Place. OpenStreetMap search first, device geocoder as fallback.
export async function searchPlace(text: string): Promise<Place | null> {
  const q = text.trim();
  if (!q) return null;

  const ll = parseLatLng(q);
  if (ll) return { ...ll, label: await reverseLabel(ll) };

  try {
    const j = await fetchJson(
      `https://nominatim.openstreetmap.org/search?format=json&accept-language=en&limit=1&q=${encodeURIComponent(q)}`,
    );
    if (Array.isArray(j) && j[0]) {
      const p = { latitude: Number(j[0].lat), longitude: Number(j[0].lon) };
      if (isValidLatLng(p)) return { ...p, label: shortName(j[0].display_name ?? q) };
    }
  } catch {}

  try {
    const [g] = await Location.geocodeAsync(q);
    if (g && isValidLatLng(g)) return { latitude: g.latitude, longitude: g.longitude, label: q };
  } catch {}

  return null;
}
