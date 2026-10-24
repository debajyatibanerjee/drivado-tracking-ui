import * as Location from 'expo-location';

export type GpsStatus = 'starting' | 'denied' | 'disabled' | 'waiting' | 'ok' | 'error';

export interface Fix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null; // m/s
  heading: number | null;
  timestamp: number;
}

// Foreground GPS: asks for permission, then keeps `fix` updated. One instance
// (sharedGps) feeds every logged-in driver, so N drivers don't mean N GPS watchers.
export class GpsTracker {
  status: GpsStatus = 'starting';
  fix: Fix | null = null;

  private sub: Location.LocationSubscription | null = null;
  private gen = 0; // bumped by start/stop; a start that is no longer current gives up
  private listeners = new Set<() => void>();
  private users = 0;

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  // Ref-counted: GPS runs while at least one driver needs it.
  acquire() {
    if (this.users++ === 0) this.start();
  }

  release() {
    this.users = Math.max(0, this.users - 1);
    if (this.users === 0) this.stop();
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  async start() {
    this.stop();
    const gen = this.gen;
    const stale = () => gen !== this.gen;
    this.setStatus('starting');
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (stale()) return;
      if (perm.status !== 'granted') return this.setStatus('denied');
      if (!(await Location.hasServicesEnabledAsync())) return stale() ? undefined : this.setStatus('disabled');

      this.setStatus(this.fix ? 'ok' : 'waiting');
      const last = await Location.getLastKnownPositionAsync().catch(() => null);
      if (last && !this.fix) this.accept(last);

      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 0 },
        (loc) => this.accept(loc),
        () => this.setStatus('error'),
      );
      if (stale()) sub.remove();
      else this.sub = sub;
    } catch {
      if (!stale()) this.setStatus('error');
    }
  }

  stop() {
    this.gen++;
    this.sub?.remove();
    this.sub = null;
  }

  private accept(loc: Location.LocationObject) {
    const c = loc.coords;
    this.fix = {
      latitude: c.latitude,
      longitude: c.longitude,
      accuracy: c.accuracy ?? null,
      speed: c.speed ?? null,
      heading: c.heading ?? null,
      timestamp: loc.timestamp,
    };
    this.status = 'ok';
    this.notify();
  }

  private setStatus(s: GpsStatus) {
    this.status = s;
    this.notify();
  }
}

export const sharedGps = new GpsTracker();
