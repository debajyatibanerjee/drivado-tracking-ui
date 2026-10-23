import { TRIP_TYPE_BEFORE_POB, TRIP_TYPE_FROM_POB } from './config';

export type TripStatus = 'ENROUTE' | 'ARRIVED' | 'POB' | 'COMPLETED';

export const STATUS_FLOW: TripStatus[] = ['ENROUTE', 'ARRIVED', 'POB', 'COMPLETED'];

export const tripTypeFor = (status: TripStatus) =>
  status === 'POB' || status === 'COMPLETED' ? TRIP_TYPE_FROM_POB : TRIP_TYPE_BEFORE_POB;

export type TrackingEvent = 'location' | 'status_change';

export type LatLng = { latitude: number; longitude: number };

export type LocationSource = 'gps' | 'sim';

export interface Place extends LatLng {
  label: string;
}

export interface TripPlan {
  bookingId: string;
  tripId: string;
  pickup: Place;
  dropoff: Place;
}

// One captured sample. Sent live, or cached offline and sent later in bulk.
// protocol.ts turns it into the backend's wire format.
export interface TrackingPoint {
  seq: number;
  event: TrackingEvent;
  driverId: string;
  bookingId: string;
  tripId: string;
  tripType: string;
  status: TripStatus;
  lat: number;
  lng: number;
  accuracy: number | null; // GPS accuracy in meters (null when simulated)
  locationSource: LocationSource;
  heading: number;
  speedKmh: number;
  remainingMeters: number | null;
  connected: boolean; // socket state at capture time
  batteryLevel: number; // 0-100
  isCharging: boolean;
  networkStrength: number; // 0-4 bars
  networkType: string;
  timestamp: string; // ISO time of capture (not of sending)
  cached: boolean; // true if it was stored offline before sending
}
