import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoSubscription } from '@react-native-community/netinfo';
import * as Battery from 'expo-battery';

import {
  ARRIVAL_RADIUS_M,
  AUTO_WAIT_TICKS_AT_PICKUP,
  BULK_CHUNK_SIZE,
  MAX_LOG_ENTRIES,
  SEND_INTERVAL_MS,
  SPEEDS,
  SpeedKey,
} from '../config';
import { buildHeaders, buildMessage } from '../protocol';
import {
  bearing,
  distance,
  distanceAlong,
  distanceToRoute,
  jitter,
  offset,
  pointAlong,
  polylineLength,
} from '../sim/geo';
import {
  LatLng,
  LocationSource,
  TrackingEvent,
  TrackingPoint,
  TripPlan,
  TripStatus,
  tripTypeFor,
} from '../types';
import { GpsStatus, GpsTracker } from './gps';
import { OfflineQueue } from './offlineQueue';
import { Session } from './session';
import { fetchRoute, Route } from './routing';
import { ConnState, TrackingSocket } from './trackingSocket';

const META_KEY = '@driver_trip_meta_v3';

export type SignalMode = 'auto' | 0 | 1 | 2 | 3 | 4;

export interface SimSettings {
  locationSource: LocationSource;
  networkDown: boolean;
  signalMode: SignalMode;
  realBattery: boolean;
  charging: boolean;
  speed: SpeedKey;
  autoAdvance: boolean;
}

export type LogKind = 'live' | 'queue' | 'bulk' | 'status' | 'info' | 'warn' | 'in';

export interface LogEntry {
  id: number;
  time: string;
  kind: LogKind;
  text: string;
}

export interface Trip {
  tripId: string;
  status: TripStatus;
  waitTicks: number;
  plan: TripPlan;
}

// ENROUTE leg: driver -> pickup. POB leg: driver (from pickup) -> drop-off.
// With real GPS both are re-routed from the driver's live position as they move.
export interface Legs {
  toPickup: LatLng[];
  toDropoff: LatLng[];
  toPickupSec: number; // driving time of the full leg
  toDropoffSec: number;
  kind: 'road' | 'straight';
}

// Re-route from the live position at most this often, and only after moving this far...
const REROUTE_EVERY_MS = 30000;
const REROUTE_MIN_MOVE_M = 50;
// ...or sooner when the driver is this far off the drawn route.
const OFF_ROUTE_M = 100;
const OFF_ROUTE_RETRY_MS = 10000;

export interface Snapshot {
  email: string;
  driverId: string;
  deviceId: string;
  wsKey: string;
  loginTripId: string; // X-Trip-ID entered at login
  wsUrl: string;
  connState: ConnState;
  connError: string | null; // last handshake/socket error, cleared once connected
  deviceOnline: boolean;
  gpsStatus: GpsStatus;
  gpsFix: LatLng | null; // latest real GPS position, whatever the location source
  trip: Trip | null;
  legs: Legs | null;
  planning: boolean; // fetching routes for a new trip
  position: LatLng | null; // position being reported (GPS or simulated)
  heading: number;
  speedKmh: number;
  accuracy: number | null;
  remainingMeters: number; // driver -> pickup (ENROUTE) or driver -> drop-off (POB), by road
  etaSeconds: number | null;
  atLegEnd: boolean;
  battery: number;
  charging: boolean;
  signal: number;
  networkType: string;
  queueSize: number;
  liveSent: number;
  lastSent: string | null; // last JSON message sent, for on-screen debugging
  lastSentAt: string | null;
  bulkSent: number;
  logs: LogEntry[];
  sim: SimSettings;
}

interface PersistedMeta {
  email: string;
  trip: Trip | null;
  legs: Legs | null;
  distance: number;
  seq: number;
  simBattery: number;
}

const NEXT_STATUS: Record<TripStatus, TripStatus | null> = {
  ENROUTE: 'ARRIVED',
  ARRIVED: 'POB',
  POB: 'COMPLETED',
  COMPLETED: null,
};

const GPS_STATUS_TEXT: Record<GpsStatus, string> = {
  starting: 'GPS starting',
  denied: 'Location permission denied',
  disabled: 'Location services are turned off',
  waiting: 'Waiting for GPS fix',
  ok: 'GPS fix acquired',
  error: 'GPS error',
};

const BARS_TO_TYPE = ['none', 'EDGE', '3G', '4G', '4G'];

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
const mins = (s: number) => `${Math.max(1, Math.round(s / 60))} min`;

const legsFrom = (toPickup: Route, toDropoff: Route): Legs => ({
  toPickup: toPickup.points,
  toDropoff: toDropoff.points,
  toPickupSec: toPickup.seconds,
  toDropoffSec: toDropoff.seconds,
  kind: toPickup.kind === 'road' && toDropoff.kind === 'road' ? 'road' : 'straight',
});

// Owns everything the driver screen shows: the trip, GPS/simulated position,
// telemetry, the socket and the offline cache. React reads it via subscribe/getSnapshot.
export class TrackingEngine {
  private socket = new TrackingSocket();
  private queue = new OfflineQueue();
  private gps = new GpsTracker();
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private netUnsub: NetInfoSubscription | null = null;
  private batterySubs: { remove(): void }[] = [];
  private stopped = true;
  private restored = false;

  private seq = 0;
  private distance = 0; // simulated meters travelled on the current leg
  private legLen = { toPickup: 0, toDropoff: 0 };
  private routing = false; // a live re-route request is in flight
  private routedFrom: LatLng | null = null;
  private routedAt = 0;
  private tickCount = 0;
  private logId = 0;
  private simBattery = 100;
  private autoSignal = 4;
  private realBatteryLevel = -1;
  private realCharging = false;
  private gpsHeading = 0;
  private prevFix: LatLng | null = null;
  private lastGpsStatus: GpsStatus | null = null;
  private connTripId: string | null = null; // trip ID the socket is connected for
  private snap: Snapshot;

  constructor(session: Session) {
    this.snap = {
      email: session.email,
      driverId: session.driverId,
      deviceId: session.deviceId,
      wsKey: session.wsKey,
      loginTripId: session.tripId,
      wsUrl: session.wsUrl,
      connState: 'disconnected',
      connError: null,
      deviceOnline: true,
      gpsStatus: 'starting',
      gpsFix: null,
      trip: null,
      legs: null,
      planning: false,
      position: null,
      heading: 0,
      speedKmh: 0,
      accuracy: null,
      remainingMeters: 0,
      etaSeconds: null,
      atLegEnd: false,
      battery: 100,
      charging: false,
      signal: 4,
      networkType: '4G',
      queueSize: 0,
      liveSent: 0,
      lastSent: null,
      lastSentAt: null,
      bulkSent: 0,
      logs: [],
      sim: {
        locationSource: 'gps',
        networkDown: false,
        signalMode: 'auto',
        realBattery: false,
        charging: false,
        speed: '3x',
        autoAdvance: true,
      },
    };
    this.socket.onStateChange = this.handleSocketState;
    this.socket.onMessage = this.handleServerMessage;
    this.socket.onLog = (msg) => {
      this.log('warn', msg);
      if (msg.startsWith('Socket error') || msg.startsWith('Connect timed out')) this.set({ connError: msg });
    };
    this.gps.onChange = this.handleGps;
  }

  // ---- React bindings -------------------------------------------------------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = () => this.snap;

  private set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l());
  }

  private log(kind: LogKind, text: string) {
    const entry: LogEntry = {
      id: ++this.logId,
      time: new Date().toLocaleTimeString(),
      kind,
      text,
    };
    this.set({ logs: [entry, ...this.snap.logs].slice(0, MAX_LOG_ENTRIES) });
    console.log(`[tracker] ${kind.toUpperCase()} ${text}`); // also visible in the dev server terminal
  }

  // Sends one wire message and remembers it so the screen can show exactly what went out.
  private sendMessage(points: TrackingPoint[]): boolean {
    const msg = buildMessage(points);
    if (!this.socket.send(msg)) return false;
    const json = JSON.stringify(msg);
    console.log(`[tracker] SENT ${json}`);
    this.set({ lastSent: JSON.stringify(msg, null, 1), lastSentAt: new Date().toLocaleTimeString() });
    return true;
  }

  // ---- Lifecycle ------------------------------------------------------------

  async start() {
    this.stopped = false;
    await this.queue.ready;
    if (!this.restored) {
      this.restored = true;
      await this.restore();
    }
    if (this.stopped || this.timer) return;

    this.set({ queueSize: this.queue.size });
    if (this.queue.size > 0) {
      this.log('info', `${this.queue.size} cached updates found from a previous session`);
    }

    this.netUnsub = NetInfo.addEventListener((s) => {
      const online = s.isConnected !== false;
      if (online === this.snap.deviceOnline) return;
      this.set({ deviceOnline: online });
      this.log(online ? 'info' : 'warn', online ? 'Device internet is back' : 'Device lost internet');
      this.applyConnectivity();
    });

    this.gps.start();
    this.initRealBattery();
    this.updateTelemetry();
    this.updatePosition();
    this.applyConnectivity();
    this.timer = setInterval(this.tick, SEND_INTERVAL_MS);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.netUnsub?.();
    this.netUnsub = null;
    this.batterySubs.forEach((s) => s.remove());
    this.batterySubs = [];
    this.gps.stop();
    this.socket.disconnect();
    this.persist();
  }

  retryGps = () => {
    this.gps.start();
  };

  private async restore() {
    try {
      const raw = await AsyncStorage.getItem(META_KEY);
      if (!raw) return;
      const meta: PersistedMeta = JSON.parse(raw);
      this.seq = meta.seq ?? 0;
      this.simBattery = meta.simBattery ?? 100;
      if (meta.email === this.snap.email && meta.trip && meta.legs && meta.trip.status !== 'COMPLETED') {
        this.distance = meta.distance;
        this.setLegs(meta.legs);
        this.set({ trip: meta.trip });
        this.log('info', `Resumed trip ${meta.trip.tripId} at ${meta.trip.status}`);
      }
    } catch {}
  }

  private persist() {
    const meta: PersistedMeta = {
      email: this.snap.email,
      trip: this.snap.trip,
      legs: this.snap.legs,
      distance: this.distance,
      seq: this.seq,
      simBattery: this.simBattery,
    };
    AsyncStorage.setItem(META_KEY, JSON.stringify(meta)).catch(() => {});
  }

  private async initRealBattery() {
    try {
      this.realBatteryLevel = await Battery.getBatteryLevelAsync();
      const state = await Battery.getBatteryStateAsync();
      this.realCharging =
        state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL;
      this.batterySubs.push(
        Battery.addBatteryLevelListener(({ batteryLevel }) => {
          this.realBatteryLevel = batteryLevel;
        }),
        Battery.addBatteryStateListener(({ batteryState }) => {
          this.realCharging =
            batteryState === Battery.BatteryState.CHARGING ||
            batteryState === Battery.BatteryState.FULL;
        }),
      );
    } catch {
      this.realBatteryLevel = -1;
    }
  }

  // ---- GPS ------------------------------------------------------------------

  private handleGps = () => {
    const { status, fix } = this.gps;
    if (status !== this.lastGpsStatus) {
      this.lastGpsStatus = status;
      const text = GPS_STATUS_TEXT[status];
      this.log(status === 'ok' || status === 'starting' ? 'info' : 'warn', text);
    }
    let gpsFix: LatLng | null = null;
    if (fix) {
      gpsFix = { latitude: fix.latitude, longitude: fix.longitude };
      // Prefer the device heading while moving; otherwise derive it from movement.
      if (fix.heading != null && fix.heading >= 0 && (fix.speed ?? 0) > 0.5) {
        this.gpsHeading = fix.heading;
      } else if (this.prevFix && distance(this.prevFix, gpsFix) > 3) {
        this.gpsHeading = bearing(this.prevFix, gpsFix);
      }
      this.prevFix = gpsFix;
    }
    this.set({ gpsStatus: status, gpsFix });
    this.updatePosition();
  };

  // ---- Driver actions -------------------------------------------------------

  // Builds road routes (driver -> pickup -> drop-off) and starts the trip at ENROUTE.
  startTrip = async (plan: TripPlan): Promise<string | null> => {
    if (this.snap.planning) return 'Already starting a trip';
    const useGps = this.snap.sim.locationSource === 'gps';
    const here = this.snap.gpsFix;
    if (useGps && !here) return 'No GPS fix yet. Wait for GPS, or switch location source to Simulated.';

    // Simulated trips start from the real position if known, else 1.5 km from pickup.
    const start = here ?? offset(plan.pickup, 1500, 225);
    this.set({ planning: true });
    this.log('info', 'Fetching road routes...');
    const [a, b] = await Promise.all([fetchRoute(start, plan.pickup), fetchRoute(plan.pickup, plan.dropoff)]);
    this.set({ planning: false });
    if (this.stopped) return 'Stopped';

    this.setLegs(legsFrom(a, b));
    this.routedFrom = start;
    this.routedAt = Date.now();
    this.log(
      'info',
      `Driver -> pickup ${km(a.meters)} (${mins(a.seconds)}), pickup -> drop-off ${km(b.meters)}` +
        (a.kind === 'road' && b.kind === 'road' ? '' : ' (straight line, routing unavailable)'),
    );

    this.distance = 0;
    this.set({ trip: { tripId: plan.tripId, status: 'ENROUTE', waitTicks: 0, plan } });
    this.updatePosition();
    this.log('status', `Trip ${plan.tripId} (booking ${plan.bookingId}) started -> ENROUTE`);
    this.applyConnectivity(); // opens the socket for this trip ID
    this.record('status_change');
    this.persist();
    return null;
  };

  // Moves to the next status. In simulated mode, pressing early snaps the car
  // to the end of the leg (handy for testing).
  advanceStatus = () => {
    const trip = this.snap.trip;
    if (!trip) return;
    const next = NEXT_STATUS[trip.status];
    if (!next) return;
    if (next === 'ARRIVED') this.distance = this.legLen.toPickup;
    if (next === 'POB') this.distance = 0;
    if (next === 'COMPLETED') this.distance = this.legLen.toDropoff;

    this.set({ trip: { ...trip, status: next, waitTicks: 0 }, speedKmh: 0 });
    this.updatePosition();
    this.log('status', `Status -> ${next}`);
    this.record('status_change');
    this.persist();
    // POB: the drop-off leg now starts from wherever the driver actually is.
    if (next === 'POB') this.reroute(true);
  };

  // GPS mode: recompute the current leg (driver -> pickup, or driver -> drop-off)
  // from the live position when the driver has moved on or left the drawn route.
  private async reroute(force = false) {
    const { trip, legs, gpsFix, sim } = this.snap;
    if (sim.locationSource !== 'gps' || !trip || !legs || !gpsFix || this.routing) return;
    if (trip.status !== 'ENROUTE' && trip.status !== 'POB') return;

    const leg = trip.status === 'ENROUTE' ? legs.toPickup : legs.toDropoff;
    const since = Date.now() - this.routedAt;
    const moved = this.routedFrom ? distance(this.routedFrom, gpsFix) : Infinity;
    const offRoute = distanceToRoute(leg, gpsFix) > OFF_ROUTE_M;
    const due =
      force ||
      (since > REROUTE_EVERY_MS && moved > REROUTE_MIN_MOVE_M) ||
      (offRoute && since > OFF_ROUTE_RETRY_MS);
    if (!due || this.snap.atLegEnd) return;

    const status = trip.status;
    const target = status === 'ENROUTE' ? trip.plan.pickup : trip.plan.dropoff;
    this.routing = true;
    this.routedAt = Date.now();
    this.routedFrom = gpsFix;
    const r = await fetchRoute(gpsFix, target);
    this.routing = false;
    // Ignore if the trip moved on while we were waiting.
    const now = this.snap;
    if (this.stopped || !now.legs || now.trip?.status !== status) return;
    this.setLegs(
      status === 'ENROUTE'
        ? { ...now.legs, toPickup: r.points, toPickupSec: r.seconds }
        : { ...now.legs, toDropoff: r.points, toDropoffSec: r.seconds },
    );
    this.updatePosition();
    this.persist();
  }

  // Clears a completed trip so a new one can be planned.
  endTrip = () => {
    this.distance = 0;
    this.set({ trip: null, legs: null });
    this.updatePosition();
    this.applyConnectivity();
    this.persist();
  };

  updateSim(patch: Partial<SimSettings>) {
    const prevSource = this.snap.sim.locationSource;
    const sim = { ...this.snap.sim, ...patch };
    this.set({ sim });
    if (patch.locationSource && patch.locationSource !== prevSource) {
      this.log('info', `Location source: ${patch.locationSource === 'gps' ? 'real GPS' : 'simulated'}`);
      // Continue the simulation from wherever the real position is on the route.
      const { trip, legs, gpsFix } = this.snap;
      if (patch.locationSource === 'sim' && trip && legs && gpsFix) {
        if (trip.status === 'ENROUTE') this.distance = distanceAlong(legs.toPickup, gpsFix);
        if (trip.status === 'POB') this.distance = distanceAlong(legs.toDropoff, gpsFix);
      }
      this.updatePosition();
    }
    if (patch.networkDown !== undefined) {
      this.log('warn', patch.networkDown ? 'Simulated network DOWN' : 'Simulated network UP');
    }
    if (patch.signalMode !== undefined) {
      if (typeof patch.signalMode === 'number') this.autoSignal = Math.max(1, patch.signalMode);
      this.log('info', `Signal mode: ${patch.signalMode === 'auto' ? 'auto' : `${patch.signalMode}/4`}`);
    }
    if (patch.realBattery && this.realBatteryLevel < 0) {
      this.log('warn', 'Real battery not available on this device, using simulated');
    }
    this.updateTelemetry();
    this.applyConnectivity();
  }

  setSimBattery(level: number) {
    this.simBattery = level;
    this.updateTelemetry();
    this.log('info', `Simulated battery set to ${level}%`);
  }

  clearCache() {
    const n = this.queue.size;
    this.queue.clear();
    this.set({ queueSize: 0 });
    this.log('warn', `Cleared ${n} cached updates`);
  }

  // ---- Main loop ------------------------------------------------------------

  private tick = () => {
    this.tickCount++;
    this.updateTelemetry();
    this.applyConnectivity();

    const trip = this.snap.trip;
    if (!trip || trip.status === 'COMPLETED') return;

    const { autoAdvance, speed, locationSource } = this.snap.sim;
    const moving = trip.status === 'ENROUTE' || trip.status === 'POB';

    if (locationSource === 'sim') {
      if (moving) {
        const len = trip.status === 'ENROUTE' ? this.legLen.toPickup : this.legLen.toDropoff;
        const stillGoing = this.distance < len;
        if (stillGoing) this.distance = Math.min(len, this.distance + SPEEDS[speed].metersPerTick);
        // Realistic-looking city speed rather than the accelerated sim speed.
        this.set({ speedKmh: stillGoing ? Math.round(35 + Math.random() * 25) : 0 });
      }
    } else {
      const fix = this.gps.fix;
      if (!fix) {
        this.log('warn', `${GPS_STATUS_TEXT[this.gps.status]}, update skipped`);
        return;
      }
      const s = fix.speed != null && fix.speed >= 0 ? fix.speed : 0;
      this.set({ speedKmh: Math.round(s * 3.6) });
      this.reroute();
    }

    this.updatePosition();

    let shouldAdvance = false;
    if (moving) {
      shouldAdvance = this.snap.atLegEnd;
    } else if (trip.status === 'ARRIVED') {
      const waitTicks = trip.waitTicks + 1;
      this.set({ trip: { ...trip, waitTicks } });
      shouldAdvance = waitTicks >= AUTO_WAIT_TICKS_AT_PICKUP;
    }

    if (autoAdvance && shouldAdvance) {
      this.advanceStatus();
    } else {
      this.record('location');
      this.persist();
    }
  };

  private currentPose(): { point: LatLng; heading: number } | null {
    const { trip, legs, gpsFix } = this.snap;
    if (this.snap.sim.locationSource === 'gps' || !trip || !legs) {
      return gpsFix ? { point: gpsFix, heading: this.gpsHeading } : null;
    }
    if (trip.status === 'ENROUTE') return pointAlong(legs.toPickup, this.distance);
    if (trip.status === 'ARRIVED') return pointAlong(legs.toPickup, this.legLen.toPickup);
    if (trip.status === 'POB') return pointAlong(legs.toDropoff, this.distance);
    return pointAlong(legs.toDropoff, this.legLen.toDropoff);
  }

  private currentTarget() {
    const trip = this.snap.trip;
    if (trip?.status === 'ENROUTE') return { type: 'pickup' as const, point: trip.plan.pickup };
    if (trip?.status === 'POB') return { type: 'dropoff' as const, point: trip.plan.dropoff };
    return null;
  }

  private updatePosition() {
    const pose = this.currentPose();
    const target = this.currentTarget();
    const useGps = this.snap.sim.locationSource === 'gps';

    let remaining = 0;
    let atLegEnd = false;
    let eta: number | null = null;
    const legs = this.snap.legs;
    if (pose && target && legs) {
      const toPickup = target.type === 'pickup';
      const pts = toPickup ? legs.toPickup : legs.toDropoff;
      const len = toPickup ? this.legLen.toPickup : this.legLen.toDropoff;
      const sec = toPickup ? legs.toPickupSec : legs.toDropoffSec;
      if (useGps) {
        // Road distance left along the route from the driver's position; never less than straight-line.
        const straight = distance(pose.point, target.point);
        remaining = Math.max(straight, len - distanceAlong(pts, pose.point));
        atLegEnd = straight <= ARRIVAL_RADIUS_M;
      } else {
        remaining = Math.max(0, len - this.distance);
        atLegEnd = remaining <= 0;
      }
      if (sec > 0 && len > 0) eta = Math.round((sec * remaining) / len);
      if (atLegEnd) eta = 0;
    }
    if (atLegEnd && !this.snap.atLegEnd && target) {
      this.log('info', target.type === 'pickup' ? 'Reached pickup' : 'Reached drop-off');
    }

    this.set({
      position: pose?.point ?? null,
      heading: pose?.heading ?? this.snap.heading,
      accuracy: useGps ? (this.gps.fix?.accuracy ?? null) : null,
      remainingMeters: remaining,
      etaSeconds: eta,
      atLegEnd,
    });
  }

  private setLegs(legs: Legs) {
    this.legLen = { toPickup: polylineLength(legs.toPickup), toDropoff: polylineLength(legs.toDropoff) };
    this.set({ legs: { ...legs, toPickupSec: legs.toPickupSec ?? 0, toDropoffSec: legs.toDropoffSec ?? 0 } });
  }

  private effectiveSignal(): number {
    const mode = this.snap.sim.signalMode;
    return mode === 'auto' ? this.autoSignal : mode;
  }

  private updateTelemetry() {
    const { sim } = this.snap;

    // Battery: drains 1% every 5 ticks, charges 1% every 2 ticks.
    if (sim.charging) {
      if (this.tickCount % 2 === 0) this.simBattery = Math.min(100, this.simBattery + 1);
    } else if (this.tickCount % 5 === 0) {
      this.simBattery = Math.max(1, this.simBattery - 1);
    }
    const useReal = sim.realBattery && this.realBatteryLevel >= 0;
    const battery = useReal ? Math.round(this.realBatteryLevel * 100) : this.simBattery;
    const charging = useReal ? this.realCharging : sim.charging;

    // Signal: random walk between 1 and 4 bars in auto mode.
    if (sim.signalMode === 'auto' && Math.random() < 0.3) {
      this.autoSignal = Math.min(4, Math.max(1, this.autoSignal + (Math.random() < 0.5 ? -1 : 1)));
    }
    const signal = this.effectiveSignal();
    this.set({ battery, charging, signal, networkType: BARS_TO_TYPE[signal] });
  }

  // ---- Connectivity + sending -----------------------------------------------

  private applyConnectivity() {
    if (this.stopped) return;
    const reasons: string[] = [];
    if (this.snap.sim.networkDown) reasons.push('network down (simulated)');
    if (this.effectiveSignal() === 0) reasons.push('no signal (simulated)');
    if (!this.snap.deviceOnline) reasons.push('device offline');

    // The server takes one connection per trip (X-Trip-ID header), so connect for
    // the oldest cached trip first, otherwise for the active trip.
    const tripId = this.desiredTripId();

    if (reasons.length === 0 && tripId) {
      if (!this.socket.isEnabled || this.connTripId !== tripId) {
        if (this.socket.isEnabled) this.socket.disconnect();
        this.connTripId = tripId;
        this.log('info', `Connecting for trip ${tripId}`);
        this.socket.connect(this.snap.wsUrl, buildHeaders(this.snap.wsKey, tripId, this.snap.deviceId));
      }
    } else if (this.socket.isEnabled) {
      this.log('warn', reasons.length ? `Going offline: ${reasons.join(', ')}` : 'No active trip, socket closed');
      this.connTripId = null;
      this.socket.disconnect();
    }
  }

  private desiredTripId(): string | null {
    const head = this.queue.peek(1)[0];
    if (head) return head.tripId;
    const trip = this.snap.trip;
    return trip && trip.status !== 'COMPLETED' ? trip.tripId : null;
  }

  private handleSocketState = (state: ConnState, prev: ConnState) => {
    this.set({ connState: state });
    if (state === 'connected') {
      this.set({ connError: null });
      this.log('info', `WebSocket connected (trip ${this.connTripId})`);
      this.flushQueue();
    } else if (prev === 'connected') {
      this.log('warn', 'WebSocket disconnected');
    }
  };

  private handleServerMessage = (data: string) => {
    this.log('in', data.length > 140 ? `${data.slice(0, 140)}…` : data);
  };

  private buildPoint(event: TrackingEvent): TrackingPoint | null {
    const pose = this.currentPose();
    const trip = this.snap.trip;
    if (!pose || !trip) return null;
    const useGps = this.snap.sim.locationSource === 'gps';
    // Simulated positions get a little GPS-like noise; real GPS is sent as is.
    const pos = !useGps && event === 'location' ? jitter(pose.point, 4) : pose.point;
    const target = this.currentTarget();
    const signal = this.effectiveSignal();
    return {
      seq: ++this.seq,
      event,
      driverId: this.snap.driverId,
      bookingId: trip.plan.bookingId,
      tripId: trip.plan.tripId,
      tripType: tripTypeFor(trip.status),
      status: trip.status,
      lat: round(pos.latitude, 6),
      lng: round(pos.longitude, 6),
      accuracy: useGps && this.gps.fix?.accuracy != null ? Math.round(this.gps.fix.accuracy) : null,
      locationSource: useGps ? 'gps' : 'sim',
      heading: Math.round(pose.heading),
      speedKmh: this.snap.speedKmh,
      remainingMeters: target ? Math.round(this.snap.remainingMeters) : null,
      connected: this.socket.isConnected,
      batteryLevel: this.snap.battery,
      isCharging: this.snap.charging,
      networkStrength: signal,
      networkType: BARS_TO_TYPE[signal],
      timestamp: new Date().toISOString(),
      cached: false,
    };
  }

  private record(event: TrackingEvent) {
    const point = this.buildPoint(event);
    if (!point) {
      this.log('warn', `No location yet, ${event} not recorded`);
      return;
    }
    const label = `#${point.seq} ${event} ${point.status}`;

    if (
      this.socket.isConnected &&
      this.connTripId === point.tripId &&
      this.flushQueue() &&
      this.sendMessage([point])
    ) {
      this.set({ liveSent: this.snap.liveSent + 1 });
      this.log('live', `${label} sent`);
      return;
    }

    point.cached = true;
    point.connected = false;
    this.queue.push(point);
    this.set({ queueSize: this.queue.size });
    this.log('queue', `${label} cached (${this.queue.size} in cache)`);
  }

  // Sends every cached update in order, in chunks. Returns true if the cache is empty.
  private flushQueue(): boolean {
    if (this.queue.size === 0) return true;
    if (!this.socket.isConnected) return false;

    let sent = 0;
    let batches = 0;
    while (this.queue.size > 0) {
      // Only items of the trip this socket is connected for (X-Trip-ID).
      const head = this.queue.peek(BULK_CHUNK_SIZE);
      const other = head.findIndex((p) => p.tripId !== this.connTripId);
      const chunk = other === -1 ? head : head.slice(0, other);
      if (chunk.length === 0) break;
      if (!this.sendMessage(chunk)) break;
      this.queue.drop(chunk.length);
      sent += chunk.length;
      batches++;
    }
    if (sent > 0) {
      this.set({ bulkSent: this.snap.bulkSent + sent, queueSize: this.queue.size });
      this.log('bulk', `BULK sent ${sent} cached updates in ${batches} message(s)`);
    }
    // Remaining items belong to another trip: reconnect with that trip ID.
    if (this.queue.size > 0 || this.connTripId !== this.desiredTripId()) {
      setTimeout(() => this.applyConnectivity(), 0);
    }
    return this.queue.size === 0;
  }
}
