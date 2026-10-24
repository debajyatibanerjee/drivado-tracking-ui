import { useSyncExternalStore } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { WEB_HEADERS_WARNING } from '../components/confirm';
import { STATUS_COLORS } from '../components/ui';
import { Session } from '../services/session';
import { TrackingEngine } from '../services/trackingEngine';

interface Props {
  sessions: Session[];
  engines: Map<string, TrackingEngine>;
  onOpen: (id: string) => void;
  onAdd: () => void;
  onAddMany: () => void;
  onLogout: (id: string) => void;
  onLogoutAll: () => void;
}

// Home screen: every logged-in driver, each tracking independently.
export default function DriversScreen({ sessions, engines, onOpen, onAdd, onAddMany, onLogout, onLogoutAll }: Props) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.page}>
          <Text style={styles.title}>Drivers</Text>
          <Text style={styles.subtitle}>
            {sessions.length} logged in · each has its own connection, trip and offline cache
          </Text>
          <View style={styles.actions}>
            <Pressable style={({ pressed }) => [styles.btn, styles.btnDark, pressed && styles.pressed]} onPress={onAdd}>
              <Text style={styles.btnTextLight}>+ Add driver</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.btn, styles.btnBlue, pressed && styles.pressed]} onPress={onAddMany}>
              <Text style={styles.btnTextLight}>+ Add multiple</Text>
            </Pressable>
            {sessions.length > 0 && (
              <Pressable style={({ pressed }) => [styles.btn, styles.btnDanger, pressed && styles.pressed]} onPress={onLogoutAll}>
                <Text style={styles.btnTextDanger}>Logout all</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
      <ScrollView contentContainerStyle={[styles.page, { padding: 12, paddingBottom: 24 }]}>
        {Platform.OS === 'web' && (
          <View style={styles.webBanner}>
            <Text style={styles.webBannerText}>{WEB_HEADERS_WARNING}</Text>
          </View>
        )}
        {sessions.map((s) => {
          const e = engines.get(s.id);
          return e ? (
            <DriverRow key={s.id} session={s} engine={e} onOpen={() => onOpen(s.id)} onLogout={() => onLogout(s.id)} />
          ) : null;
        })}

        <Text style={styles.hint}>
          Use a different X-Trip-ID for each driver: the server allows only one connection per trip. With
          real GPS all drivers on this phone report the same position. Set Location source to Simulated
          to move them independently.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function DriverRow({
  session,
  engine,
  onOpen,
  onLogout,
}: {
  session: Session;
  engine: TrackingEngine;
  onOpen: () => void;
  onLogout: () => void;
}) {
  const s = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const pill =
    s.connState === 'connected'
      ? { text: 'CONNECTED', bg: '#dcfce7', fg: '#166534' }
      : s.connState === 'connecting'
        ? { text: 'CONNECTING…', bg: '#fef9c3', fg: '#854d0e' }
        : { text: s.trip && s.trip.status !== 'COMPLETED' ? 'OFFLINE' : 'IDLE', bg: '#f1f5f9', fg: '#475569' };
  const status = s.trip?.status;

  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && { opacity: 0.9 }]} onPress={onOpen}>
      <View style={styles.rowTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.driver} numberOfLines={1}>
            {session.driverId} · {session.email}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            Trip {session.tripId} · Device {session.deviceId}
          </Text>
        </View>
        <View style={[styles.pill, { backgroundColor: pill.bg }]}>
          <Text style={[styles.pillText, { color: pill.fg }]}>{pill.text}</Text>
        </View>
      </View>

      <View style={styles.rowBottom}>
        {status ? (
          <Text style={[styles.status, { color: STATUS_COLORS[status] }]}>{status}</Text>
        ) : (
          <Text style={[styles.status, { color: '#64748b' }]}>No trip yet</Text>
        )}
        <Text style={styles.counts}>
          {s.sim.locationSource === 'gps' ? 'GPS' : 'Sim'} · live {s.liveSent} · bulk {s.bulkSent} · cache {s.queueSize}
        </Text>
      </View>
      {s.connState !== 'connected' && !!s.connError && (
        <Text style={styles.error} numberOfLines={2}>
          {s.connError}
        </Text>
      )}

      <View style={styles.rowActions}>
        <Pressable style={({ pressed }) => [styles.btn, styles.btnOutline, pressed && styles.pressed]} onPress={onOpen}>
          <Text style={styles.btnTextBlue}>Open ›</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.btn, styles.btnDanger, pressed && styles.pressed]} onPress={onLogout}>
          <Text style={styles.btnTextDanger}>Logout & delete</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f1f5f9' },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  btn: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, alignItems: 'center' },
  btnDark: { backgroundColor: '#0f172a' },
  btnBlue: { backgroundColor: '#2563eb' },
  btnOutline: { borderWidth: 1, borderColor: '#bfdbfe', backgroundColor: '#eff6ff' },
  btnDanger: { borderWidth: 1, borderColor: '#fecaca', backgroundColor: '#fef2f2' },
  btnTextLight: { color: '#fff', fontWeight: '800', fontSize: 14 },
  btnTextBlue: { color: '#2563eb', fontWeight: '800', fontSize: 14 },
  btnTextDanger: { color: '#dc2626', fontWeight: '800', fontSize: 14 },
  pressed: { opacity: 0.8 },
  webBanner: { backgroundColor: '#fef3c7', borderRadius: 10, padding: 12, marginBottom: 12 },
  webBannerText: { color: '#92400e', fontSize: 13 },
  title: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  subtitle: { fontSize: 12, color: '#64748b', marginTop: 2 },
  row: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  driver: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  meta: { fontSize: 11, color: '#64748b', marginTop: 2 },
  pill: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, marginLeft: 8 },
  pillText: { fontSize: 11, fontWeight: '800' },
  rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  status: { fontSize: 14, fontWeight: '800' },
  counts: { fontSize: 11, color: '#64748b' },
  error: { fontSize: 11, color: '#dc2626', marginTop: 6 },
  rowActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  hint: { fontSize: 12, color: '#64748b', marginTop: 12, lineHeight: 17 },
});
