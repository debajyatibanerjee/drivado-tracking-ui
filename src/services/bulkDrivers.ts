import { offset } from '../sim/geo';
import { LatLng, Place, TripPlan } from '../types';
import { LoginForm } from './session';

export const MAX_BULK_DRIVERS = 50;

// Short code that makes every generated ID unique to this run, e.g. "K3F9".
export const newRunCode = () => Date.now().toString(36).slice(-4).toUpperCase();

const pad = (n: number) => String(n).padStart(3, '0');

export interface GeneratedDriver {
  login: LoginForm;
  bookingId: string;
}

// N drivers sharing the endpoint and key; every ID is generated:
//   Booking B-K3F9-001 · Trip T-K3F9-001 · Driver DR-K3F9-001 · Device DEV-K3F9-001
export function generateDrivers(
  count: number,
  shared: { wsUrl: string; wsKey: string },
  run = newRunCode(),
): GeneratedDriver[] {
  return Array.from({ length: count }, (_, i) => {
    const n = pad(i + 1);
    return {
      bookingId: `B-${run}-${n}`,
      login: {
        email: `driver${n}.${run.toLowerCase()}@test.local`,
        driverId: `DR-${run}-${n}`,
        tripId: `T-${run}-${n}`,
        deviceId: `DEV-${run}-${n}`,
        wsUrl: shared.wsUrl,
        wsKey: shared.wsKey,
      },
    };
  });
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const place = (p: LatLng, label: string): Place => ({ ...p, label });

// Random trip around `center`: driver starts 0.5-2 km from the pickup,
// drop-off is 2-6 km beyond it, all in random directions.
export function randomTrip(center: LatLng, bookingId: string, tripId: string, n: number) {
  const pickup = offset(center, rand(300, 2500), rand(0, 360));
  const start = offset(pickup, rand(500, 2000), rand(0, 360));
  const dropoff = offset(pickup, rand(2000, 6000), rand(0, 360));
  const plan: TripPlan = {
    bookingId,
    tripId,
    pickup: place(pickup, `Pickup #${n}`),
    dropoff: place(dropoff, `Drop-off #${n}`),
  };
  return { plan, start };
}
