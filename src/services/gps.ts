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

// Foreground GPS: asks for permission, then keeps `fix` updated.
export class GpsTracker {
  status: GpsStatus = 'starting';
  fix: Fix | null = null;
  onChange?: () => void;

  private sub: Location.LocationSubscription | null = null;
  private stopped = true;

  async start() {
    this.stop();
    this.stopped = false;
    this.setStatus('starting');
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (this.stopped) return;
      if (perm.status !== 'granted') return this.setStatus('denied');
      if (!(await Location.hasServicesEnabledAsync())) return this.setStatus('disabled');

      this.setStatus(this.fix ? 'ok' : 'waiting');
      const last = await Location.getLastKnownPositionAsync().catch(() => null);
      if (last && !this.fix) this.accept(last);

      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 0 },
        (loc) => this.accept(loc),
        () => this.setStatus('error'),
      );
      if (this.stopped) sub.remove();
      else this.sub = sub;
    } catch {
      if (!this.stopped) this.setStatus('error');
    }
  }

  stop() {
    this.stopped = true;
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
    this.onChange?.();
  }

  private setStatus(s: GpsStatus) {
    this.status = s;
    this.onChange?.();
  }
}
