// Drivado tracking endpoint (can be changed on the login screen).
// `npm run start:lt` (local mock server) overrides it via EXPO_PUBLIC_WS_URL.
export const ENV_WS_URL = process.env.EXPO_PUBLIC_WS_URL;
export const DEFAULT_WS_URL = ENV_WS_URL || 'wss://testapi.drivado.com/ws/location';

// tripType sent to the backend: TRIP_S until the passenger is on board
// (ENROUTE, ARRIVED), TRIP_D from POB onwards (POB, COMPLETED).
export const TRIP_TYPE_BEFORE_POB = 'TRIP_S';
export const TRIP_TYPE_FROM_POB = 'TRIP_D';

// Adds "clientTimeUTC" (capture time) to every item, so bulk data can be ordered.
export const SEND_CLIENT_TIME = false;

// How often a location update is captured and sent.
export const SEND_INTERVAL_MS = 3000;

// Max number of cached updates packed into one bulk message.
export const BULK_CHUNK_SIZE = 100;

// With real GPS, the driver counts as "at" pickup/drop-off within this radius.
export const ARRIVAL_RADIUS_M = 50;

// Pickup and drop-off must be at least this far apart.
export const MIN_TRIP_METERS = 100;

// Ticks the driver waits at pickup before auto-advancing ARRIVED -> POB.
export const AUTO_WAIT_TICKS_AT_PICKUP = 3;

// Simulated movement per tick (every SEND_INTERVAL_MS).
export const SPEEDS = {
  '1x': { metersPerTick: 25, label: '1x' },
  '3x': { metersPerTick: 75, label: '3x' },
  '10x': { metersPerTick: 250, label: '10x' },
} as const;
export type SpeedKey = keyof typeof SPEEDS;

export const MAX_LOG_ENTRIES = 80;
