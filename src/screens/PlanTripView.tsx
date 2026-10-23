import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import MapPanel from '../components/MapPanel';
import { Card, Chips, GpsBanner } from '../components/ui';
import { MIN_TRIP_METERS, TRIP_TYPE_BEFORE_POB, TRIP_TYPE_FROM_POB } from '../config';
import { formatLatLng, isValidLatLng, reverseLabel, searchPlace } from '../services/places';
import { Snapshot, TrackingEngine } from '../services/trackingEngine';
import { distance } from '../sim/geo';
import { LatLng, LocationSource, Place } from '../types';

type Field = 'pickup' | 'dropoff';

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

const FIELD_META: Record<Field, { title: string; color: string }> = {
  pickup: { title: 'PICKUP', color: '#16a34a' },
  dropoff: { title: 'DROP-OFF', color: '#dc2626' },
};

const SOURCE_OPTIONS: LocationSource[] = ['gps', 'sim'];

export default function PlanTripView({ engine, s }: { engine: TrackingEngine; s: Snapshot }) {
  const [places, setPlaces] = useState<Record<Field, Place | null>>({ pickup: null, dropoff: null });
  const [texts, setTexts] = useState<Record<Field, string>>({ pickup: '', dropoff: '' });
  const [active, setActive] = useState<Field>('pickup');
  const [busy, setBusy] = useState<Field | null>(null);
  const [error, setError] = useState('');
  const [bookingId, setBookingId] = useState('');

  const setPlace = (f: Field, p: Place) => {
    setPlaces((prev) => ({ ...prev, [f]: p }));
    setTexts((prev) => ({ ...prev, [f]: p.label }));
    setError('');
    if (f === 'pickup' && !places.dropoff) setActive('dropoff');
  };

  const onType = (f: Field, t: string) => {
    setTexts((prev) => ({ ...prev, [f]: t }));
    setPlaces((prev) => ({ ...prev, [f]: null })); // must search again after editing
  };

  const search = async (f: Field) => {
    const q = texts[f].trim();
    if (!q) return setError(`Enter the ${f === 'pickup' ? 'pickup' : 'drop-off'} address or lat, lng`);
    setBusy(f);
    setError('');
    const p = await searchPlace(q);
    setBusy(null);
    if (p) setPlace(f, p);
    else setError(`Couldn't find "${q}". Try another address, or enter coordinates like 25.19720, 55.27440`);
  };

  const fromPoint = async (f: Field, pt: LatLng) => {
    if (!isValidLatLng(pt)) return setError('That is not a valid location');
    setBusy(f);
    const label = await reverseLabel(pt);
    setBusy(null);
    setPlace(f, { ...pt, label });
  };

  const setToMyLocation = (f: Field) => {
    if (!s.gpsFix) return setError('No GPS fix yet, wait a moment and try again');
    fromPoint(f, s.gpsFix);
  };

  const validation = (): string | null => {
    if (!bookingId.trim()) return 'Enter the Booking ID';
    if (!places.pickup) return 'Set the pickup location';
    if (!places.dropoff) return 'Set the drop-off location';
    if (distance(places.pickup, places.dropoff) < MIN_TRIP_METERS) {
      return `Pickup and drop-off must be at least ${MIN_TRIP_METERS} m apart`;
    }
    if (s.sim.locationSource === 'gps' && !s.gpsFix) return 'Waiting for a GPS fix (or choose Simulated below)';
    return null;
  };
  const invalid = validation();

  const start = async () => {
    if (invalid || !places.pickup || !places.dropoff) return setError(invalid ?? '');
    const err = await engine.startTrip({
      bookingId: bookingId.trim(),
      tripId: s.loginTripId,
      pickup: places.pickup,
      dropoff: places.dropoff,
    });
    if (err) setError(err);
  };

  return (
    <>
      <MapPanel
        car={s.gpsFix}
        heading={s.heading}
        accuracy={s.sim.locationSource === 'gps' ? s.accuracy : null}
        pickup={places.pickup}
        dropoff={places.dropoff}
        onTap={(p) => fromPoint(active, p)}
        hint={`Tap the map to set ${FIELD_META[active].title}`}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <GpsBanner status={s.gpsStatus} onRetry={engine.retryGps} />

        <Card title="Trip details">
          <View style={styles.idRow}>
            <Text style={styles.idLabel}>Trip ID</Text>
            <Text style={styles.idFixed}>{s.loginTripId}  (from login)</Text>
          </View>
          <View style={styles.idRow}>
            <Text style={styles.idLabel}>Booking ID</Text>
            <TextInput
              style={[styles.input, styles.idInput]}
              value={bookingId}
              onChangeText={setBookingId}
              placeholder="B-D-0002"
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </View>
          <View style={styles.idRow}>
            <Text style={styles.idLabel}>Trip Type</Text>
            <Text style={styles.idFixed}>
              {TRIP_TYPE_BEFORE_POB} → {TRIP_TYPE_FROM_POB} at POB (automatic)
            </Text>
          </View>
        </Card>

        <Card title="Pickup & drop-off">
          {(['pickup', 'dropoff'] as Field[]).map((f) => {
            const meta = FIELD_META[f];
            const place = places[f];
            const on = active === f;
            return (
              <Pressable
                key={f}
                onPress={() => setActive(f)}
                style={[styles.field, on && { borderColor: meta.color }]}
              >
                <View style={styles.fieldHead}>
                  <View style={[styles.dot, { backgroundColor: meta.color }]} />
                  <Text style={[styles.fieldTitle, { color: meta.color }]}>{meta.title}</Text>
                  {on && <Text style={styles.activeTag}>map taps set this</Text>}
                </View>
                <View style={styles.inputRow}>
                  <TextInput
                    style={styles.input}
                    value={texts[f]}
                    onChangeText={(t) => onType(f, t)}
                    onFocus={() => setActive(f)}
                    onSubmitEditing={() => search(f)}
                    placeholder="Address, place or lat, lng"
                    returnKeyType="search"
                    autoCorrect={false}
                  />
                  <Pressable style={styles.smallBtn} onPress={() => search(f)} disabled={busy === f}>
                    {busy === f ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.smallBtnText}>Find</Text>
                    )}
                  </Pressable>
                </View>
                <View style={styles.fieldFoot}>
                  <Text style={[styles.coords, !place && { color: '#94a3b8' }]} numberOfLines={1}>
                    {place ? `✓ ${formatLatLng(place)}` : 'Not set'}
                  </Text>
                  <Pressable onPress={() => setToMyLocation(f)} hitSlop={6}>
                    <Text style={styles.link}>◎ My location</Text>
                  </Pressable>
                </View>
              </Pressable>
            );
          })}

          {(s.gpsFix && places.pickup) || (places.pickup && places.dropoff) ? (
            <View style={styles.dists}>
              {s.gpsFix && places.pickup && (
                <Text style={styles.distText}>
                  Driver → Pickup: <Text style={styles.distVal}>{km(distance(s.gpsFix, places.pickup))}</Text>
                </Text>
              )}
              {places.pickup && places.dropoff && (
                <Text style={styles.distText}>
                  Pickup → Drop-off: <Text style={styles.distVal}>{km(distance(places.pickup, places.dropoff))}</Text>
                </Text>
              )}
              <Text style={styles.distNote}>Straight-line; road distance is shown once the trip starts.</Text>
            </View>
          ) : null}

          {!!error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            style={[styles.startBtn, (!!invalid || s.planning) && { opacity: 0.5 }]}
            onPress={start}
            disabled={s.planning}
          >
            {s.planning ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.startText}>Start Trip  →  ENROUTE</Text>
            )}
          </Pressable>
          {!!invalid && !error && <Text style={styles.hint}>{invalid}</Text>}
        </Card>

        <Card title="Location source">
          <Chips
            options={SOURCE_OPTIONS}
            value={s.sim.locationSource}
            onChange={(v) => engine.updateSim({ locationSource: v })}
            format={(v) => (v === 'gps' ? 'Real GPS' : 'Simulated')}
          />
          <Text style={styles.sourceHint}>
            {s.sim.locationSource === 'gps'
              ? 'Your phone’s real position is sent. Drive or walk to the pickup to reach ARRIVED.'
              : 'The car drives along the real road route automatically, for testing at your desk.'}
          </Text>
        </Card>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  idRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  idLabel: { width: 90, fontSize: 13, fontWeight: '600', color: '#334155' },
  idInput: { flex: 1 },
  idFixed: { flex: 1, fontSize: 15, fontWeight: '700', color: '#0f172a', paddingVertical: 8 },
  fieldHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  fieldTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  activeTag: { marginLeft: 'auto', fontSize: 11, color: '#64748b' },
  inputRow: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    color: '#0f172a',
  },
  smallBtn: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    paddingHorizontal: 14,
    justifyContent: 'center',
    minWidth: 60,
    alignItems: 'center',
  },
  smallBtnText: { color: '#fff', fontWeight: '700' },
  fieldFoot: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  coords: { flex: 1, fontSize: 12, color: '#166534', fontVariant: ['tabular-nums'] },
  link: { fontSize: 12, color: '#2563eb', fontWeight: '700' },
  error: { color: '#dc2626', marginBottom: 8 },
  dists: { backgroundColor: '#f8fafc', borderRadius: 8, padding: 10, marginBottom: 10 },
  distText: { fontSize: 13, color: '#334155' },
  distVal: { fontWeight: '800', color: '#0f172a' },
  distNote: { fontSize: 11, color: '#94a3b8', marginTop: 4 },
  startBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  startText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  hint: { textAlign: 'center', fontSize: 12, color: '#64748b', marginTop: 6 },
  sourceHint: { fontSize: 12, color: '#64748b', marginTop: 8 },
});
