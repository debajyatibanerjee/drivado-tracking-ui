import { useSyncExternalStore } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { WEB_HEADERS_WARNING } from '../components/confirm';
import MapPanel from '../components/MapPanel';
import { Card, Chips, GpsBanner, Stat, STATUS_COLORS, ToggleRow, ui } from '../components/ui';
import { ARRIVAL_RADIUS_M, SPEEDS, SpeedKey } from '../config';
import { LogKind, SignalMode, Snapshot, TrackingEngine } from '../services/trackingEngine';
import { LocationSource, STATUS_FLOW, TripStatus, tripTypeFor } from '../types';
import PlanTripView from './PlanTripView';

interface Props {
  engine: TrackingEngine; // owned by App, keeps running when this screen closes
  onBack: () => void;
  onLogout: () => void;
}

export default function TripScreen({ engine, onBack, onLogout }: Props) {
  return <TripView engine={engine} onBack={onBack} onLogout={onLogout} />;
}

const SIGNAL_OPTIONS: SignalMode[] = ['auto', 0, 1, 2, 3, 4];
const SPEED_OPTIONS = Object.keys(SPEEDS) as SpeedKey[];
const SOURCE_OPTIONS: LocationSource[] = ['gps', 'sim'];
const BATTERY_PRESETS = [100, 50, 15, 5] as const;

function TripView({ engine, onBack, onLogout }: Props) {
  const s = useSyncExternalStore(engine.subscribe, engine.getSnapshot);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Header s={s} onBack={onBack} onLogout={onLogout} />
      {Platform.OS === 'web' && (
        <View style={styles.webBanner}>
          <Text style={styles.webBannerText}>{WEB_HEADERS_WARNING}</Text>
        </View>
      )}
      {s.trip ? (
        <ActiveTrip engine={engine} s={s} onLogout={onLogout} />
      ) : (
        <PlanTripView engine={engine} s={s} />
      )}
    </SafeAreaView>
  );
}

function ActiveTrip({ engine, s, onLogout }: { engine: TrackingEngine; s: Snapshot; onLogout: () => void }) {
  const trip = s.trip!;
  const status = trip.status;
  const useGps = s.sim.locationSource === 'gps';

  return (
    <>
      <MapPanel
        car={s.position}
        heading={s.heading}
        accuracy={s.accuracy}
        pickup={trip.plan.pickup}
        dropoff={trip.plan.dropoff}
        legA={status === 'ENROUTE' ? s.legs?.toPickup : null}
        legB={status === 'COMPLETED' ? null : s.legs?.toDropoff}
        pickupDone={status !== 'ENROUTE'}
      />

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {useGps && <GpsBanner status={s.gpsStatus} onRetry={engine.retryGps} />}

        <Card title={`Trip ${trip.tripId} · Booking ${trip.plan.bookingId} · ${tripTypeFor(status)}`}>
          <Text style={styles.route} numberOfLines={1}>
            <Text style={{ color: '#16a34a', fontWeight: '800' }}>● </Text>
            {trip.plan.pickup.label}
          </Text>
          <Text style={[styles.route, { marginBottom: 12 }]} numberOfLines={1}>
            <Text style={{ color: '#dc2626', fontWeight: '800' }}>● </Text>
            {trip.plan.dropoff.label}
          </Text>
          <Stepper status={status} />
          <LegSummary s={s} />
          <ActionButton s={s} onAdvance={engine.advanceStatus} onNewTrip={engine.endTrip} />
        </Card>

        <Card title="Telemetry (sent every 3s)">
          <View style={styles.row}>
            <Stat label="Battery" value={`${s.battery}%${s.charging ? ' ⚡' : ''}`} />
            <Stat label="Signal" value={`${bars(s.signal)} ${s.networkType}`} />
            <Stat label="Speed" value={`${s.speedKmh} km/h`} />
          </View>
          <Text style={styles.coords}>
            {s.position
              ? `${s.position.latitude.toFixed(6)}, ${s.position.longitude.toFixed(6)} · ${Math.round(s.heading)}°`
              : 'No position yet'}
          </Text>
          <Text style={styles.coords}>
            {useGps
              ? `Real GPS${s.accuracy != null ? ` · accuracy ±${Math.round(s.accuracy)} m` : ''}`
              : 'Simulated along the road route'}
            {s.legs?.kind === 'straight' ? ' · straight-line route' : ''}
          </Text>
          <View style={[styles.row, { marginTop: 8 }]}>
            <Stat label="Sent live" value={String(s.liveSent)} />
            <Stat label="Sent in bulk" value={String(s.bulkSent)} />
            <Stat label="In offline cache" value={String(s.queueSize)} />
          </View>
        </Card>

        <Card title={`Last message sent${s.lastSentAt ? ` · ${s.lastSentAt}` : ''}`}>
          <Text style={styles.json} selectable>
            {s.lastSent ?? 'Nothing sent yet'}
          </Text>
        </Card>

        <Card title="Simulate conditions">
          <Text style={[ui.rowLabel, { marginTop: 0 }]}>Location source</Text>
          <Chips
            options={SOURCE_OPTIONS}
            value={s.sim.locationSource}
            onChange={(v) => engine.updateSim({ locationSource: v })}
            format={(v) => (v === 'gps' ? 'Real GPS' : 'Simulated')}
          />
          {!useGps && (
            <>
              <Text style={ui.rowLabel}>Simulated speed</Text>
              <Chips
                options={SPEED_OPTIONS}
                value={s.sim.speed}
                onChange={(v) => engine.updateSim({ speed: v })}
              />
            </>
          )}

          <View style={{ marginTop: 8 }}>
            <ToggleRow
              label="Network down"
              hint="Disconnects the socket. Updates are cached, then sent in bulk on reconnect."
              value={s.sim.networkDown}
              onChange={(v) => engine.updateSim({ networkDown: v })}
            />
            <ToggleRow
              label="Auto-advance status"
              hint={`ARRIVED / COMPLETED set automatically within ${ARRIVAL_RADIUS_M} m of the point; POB after a short wait`}
              value={s.sim.autoAdvance}
              onChange={(v) => engine.updateSim({ autoAdvance: v })}
            />
          </View>

          <Text style={ui.rowLabel}>Network strength (0 = no signal, goes offline)</Text>
          <Chips
            options={SIGNAL_OPTIONS}
            value={s.sim.signalMode}
            onChange={(v) => engine.updateSim({ signalMode: v })}
            format={(v) => (v === 'auto' ? 'Auto' : `${v}/4`)}
          />

          <Text style={ui.rowLabel}>Battery</Text>
          <ToggleRow
            label="Use real device battery"
            value={s.sim.realBattery}
            onChange={(v) => engine.updateSim({ realBattery: v })}
          />
          {!s.sim.realBattery && (
            <>
              <ToggleRow
                label="Charging"
                value={s.sim.charging}
                onChange={(v) => engine.updateSim({ charging: v })}
              />
              <View style={{ marginTop: 4 }}>
                <Chips
                  options={BATTERY_PRESETS}
                  value={-1 as (typeof BATTERY_PRESETS)[number]}
                  onChange={(v) => engine.setSimBattery(v)}
                  format={(v) => `Set ${v}%`}
                />
              </View>
            </>
          )}
        </Card>

        <Card title="Activity log">
          {s.logs.length === 0 && <Text style={styles.empty}>Nothing yet</Text>}
          {s.logs.map((l) => (
            <Text key={l.id} style={styles.log}>
              <Text style={styles.logTime}>{l.time} </Text>
              <Text style={{ color: LOG_COLORS[l.kind], fontWeight: '700' }}>{l.kind.toUpperCase()} </Text>
              {l.text}
            </Text>
          ))}
        </Card>

        <View style={styles.footer}>
          <Pressable style={styles.secondaryBtn} onPress={() => engine.clearCache()}>
            <Text style={styles.secondaryText}>Clear offline cache</Text>
          </Pressable>
          <Pressable style={styles.secondaryBtn} onPress={onLogout}>
            <Text style={[styles.secondaryText, { color: '#dc2626' }]}>Logout</Text>
          </Pressable>
        </View>
      </ScrollView>
    </>
  );
}

function Header({ s, onBack, onLogout }: { s: Snapshot; onBack: () => void; onLogout: () => void }) {
  const pill =
    s.connState === 'connected'
      ? { text: 'CONNECTED', bg: '#dcfce7', fg: '#166534' }
      : s.connState === 'connecting'
        ? { text: 'CONNECTING…', bg: '#fef9c3', fg: '#854d0e' }
        : { text: 'OFFLINE', bg: '#fee2e2', fg: '#991b1b' };
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={10} style={styles.back}>
        <Text style={styles.backText}>‹</Text>
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={styles.email} numberOfLines={1}>
          {s.driverId} · {s.email}
        </Text>
        <Text style={styles.url} numberOfLines={1}>
          Trip {s.loginTripId} · {s.wsUrl}
        </Text>
        {s.connState !== 'connected' && !!s.connError && (
          <Text style={styles.connError} numberOfLines={2}>
            {s.connError}
          </Text>
        )}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <View style={[styles.pill, { backgroundColor: pill.bg }]}>
          <Text style={[styles.pillText, { color: pill.fg }]}>{pill.text}</Text>
        </View>
        <Pressable onPress={onLogout} hitSlop={8}>
          <Text style={styles.changeServer}>Logout</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Stepper({ status }: { status: TripStatus }) {
  const current = STATUS_FLOW.indexOf(status);
  return (
    <View style={styles.stepper}>
      {STATUS_FLOW.map((st, i) => {
        const done = i <= current;
        const color = done ? STATUS_COLORS[st] : '#cbd5e1';
        return (
          <View key={st} style={styles.step}>
            <View style={[styles.dot, { backgroundColor: color }]}>
              <Text style={styles.dotText}>{i + 1}</Text>
            </View>
            <Text style={[styles.stepText, { color: done ? '#0f172a' : '#94a3b8' }]}>{st}</Text>
          </View>
        );
      })}
    </View>
  );
}

const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const fmtEta = (sec: number | null) =>
  sec == null ? '' : sec < 60 ? ' · <1 min' : ` · ~${Math.round(sec / 60)} min`;

// What the current status means, measured from the driver's live position.
function LegSummary({ s }: { s: Snapshot }) {
  const status = s.trip!.status;
  let title = '';
  let value = '';
  let color = STATUS_COLORS[status];
  if (status === 'ENROUTE') {
    title = 'Driver → Pickup';
    value = s.atLegEnd ? 'At pickup' : `${fmtDist(s.remainingMeters)}${fmtEta(s.etaSeconds)}`;
  } else if (status === 'ARRIVED') {
    title = 'At pickup';
    value = 'Waiting for passenger';
  } else if (status === 'POB') {
    title = 'Driver → Drop-off (passenger on board)';
    value = s.atLegEnd ? 'At drop-off' : `${fmtDist(s.remainingMeters)}${fmtEta(s.etaSeconds)}`;
  } else {
    title = 'Trip completed';
    value = 'Passenger dropped off';
    color = STATUS_COLORS.COMPLETED;
  }
  return (
    <View style={[styles.leg, { borderColor: color }]}>
      <Text style={[styles.legTitle, { color }]}>{title}</Text>
      <Text style={styles.legValue}>{value}</Text>
    </View>
  );
}

function ActionButton({
  s,
  onAdvance,
  onNewTrip,
}: {
  s: Snapshot;
  onAdvance: () => void;
  onNewTrip: () => void;
}) {
  const status = s.trip!.status;
  const useGps = s.sim.locationSource === 'gps';
  const dist = fmtDist(s.remainingMeters);
  const early = useGps ? '' : ' (pressing now jumps there)';
  let label = '';
  let hint = '';
  let color = STATUS_COLORS.ENROUTE;
  let onPress = onAdvance;

  if (status === 'ENROUTE') {
    label = 'Mark ARRIVED';
    hint = s.atLegEnd ? 'At pickup point' : `${dist} to pickup${early}`;
    color = STATUS_COLORS.ARRIVED;
  } else if (status === 'ARRIVED') {
    label = 'Passenger On Board  →  POB';
    hint = 'Waiting at pickup';
    color = STATUS_COLORS.POB;
  } else if (status === 'POB') {
    label = 'COMPLETE Trip';
    hint = s.atLegEnd ? 'At drop-off' : `${dist} to drop-off${early}`;
    color = STATUS_COLORS.COMPLETED;
  } else {
    label = 'Plan New Trip';
    hint = 'Trip completed. Tracking paused.';
    onPress = onNewTrip;
  }

  return (
    <View style={{ marginTop: 14 }}>
      <Pressable
        style={({ pressed }) => [styles.actionBtn, { backgroundColor: color }, pressed && { opacity: 0.85 }]}
        onPress={onPress}
      >
        <Text style={styles.actionText}>{label}</Text>
      </Pressable>
      <Text style={styles.actionHint}>{hint}</Text>
    </View>
  );
}

const bars = (n: number) => '▮'.repeat(n) + '▯'.repeat(4 - n);

const LOG_COLORS: Record<LogKind, string> = {
  live: '#16a34a',
  queue: '#d97706',
  bulk: '#7c3aed',
  status: '#2563eb',
  info: '#475569',
  warn: '#dc2626',
  in: '#0891b2',
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f1f5f9' },
  webBanner: { backgroundColor: '#fef3c7', paddingHorizontal: 14, paddingVertical: 8 },
  webBannerText: { color: '#92400e', fontSize: 12 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  back: { paddingRight: 10, paddingVertical: 2 },
  backText: { fontSize: 30, lineHeight: 32, color: '#2563eb', fontWeight: '600' },
  email: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  url: { fontSize: 11, color: '#64748b', marginTop: 2 },
  connError: { fontSize: 11, color: '#dc2626', marginTop: 2 },
  pill: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, marginLeft: 8 },
  pillText: { fontSize: 11, fontWeight: '800' },
  changeServer: { fontSize: 12, color: '#2563eb', fontWeight: '600', marginTop: 6 },
  route: { fontSize: 13, color: '#334155', marginBottom: 2 },
  row: { flexDirection: 'row' },
  coords: { textAlign: 'center', fontSize: 12, color: '#64748b', marginTop: 6, fontVariant: ['tabular-nums'] },
  stepper: { flexDirection: 'row', justifyContent: 'space-between' },
  step: { alignItems: 'center', flex: 1 },
  dot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  dotText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  stepText: { fontSize: 11, fontWeight: '700', marginTop: 4 },
  leg: { borderLeftWidth: 4, paddingLeft: 10, paddingVertical: 4, marginTop: 14 },
  legTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  legValue: { fontSize: 20, fontWeight: '800', color: '#0f172a', marginTop: 2 },
  actionBtn: { borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  actionText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  actionHint: { textAlign: 'center', fontSize: 12, color: '#64748b', marginTop: 6 },
  empty: { color: '#94a3b8' },
  json: { fontSize: 11, color: '#0f172a', fontFamily: 'monospace' },
  log: { fontSize: 12, color: '#0f172a', marginBottom: 4, fontFamily: 'monospace' },
  logTime: { color: '#94a3b8' },
  footer: { flexDirection: 'row', gap: 12, marginHorizontal: 12, marginTop: 12 },
  secondaryBtn: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryText: { fontWeight: '700', color: '#0f172a' },
});
