import { SEND_CLIENT_TIME } from './config';
import { TrackingPoint } from './types';

// Drivado wire format. Live updates and bulk (offline) uploads use the same
// envelope: { "data": [item, ...] } — one item live, up to BULK_CHUNK_SIZE in bulk.

export const buildHeaders = (wsKey: string, tripId: string, deviceId: string) => ({
  'X-WS-Key': wsKey,
  'X-Trip-ID': tripId,
  'X-Device-ID': deviceId,
});

const toItem = (p: TrackingPoint) => ({
  bookingID: p.bookingId,
  tripID: p.tripId,
  driverID: p.driverId,
  lat: p.lat,
  lng: p.lng,
  tripType: p.tripType,
  driverStatus: p.status,
  battery: p.batteryLevel,
  networkStrength: p.networkStrength,
  ...(SEND_CLIENT_TIME ? { clientTimeUTC: p.timestamp } : {}),
});

export const buildMessage = (points: TrackingPoint[]) => ({ data: points.map(toItem) });
