import { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { GpsStatus } from '../services/gps';
import { TripStatus } from '../types';

export const STATUS_COLORS: Record<TripStatus, string> = {
  ENROUTE: '#2563eb',
  ARRIVED: '#d97706',
  POB: '#7c3aed',
  COMPLETED: '#16a34a',
};

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      {!!title && <Text style={styles.cardTitle}>{title}</Text>}
      {children}
    </View>
  );
}

export function Chips<T extends string | number>({
  options,
  value,
  onChange,
  format = String,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  format?: (v: T) => string;
}) {
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable key={String(o)} style={[styles.chip, on && styles.chipOn]} onPress={() => onChange(o)}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{format(o)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {!!hint && <Text style={styles.hint}>{hint}</Text>}
      </View>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const GPS_PROBLEMS: Partial<Record<GpsStatus, string>> = {
  denied: 'Location permission denied. Allow location for Expo Go in phone Settings, then tap Retry.',
  disabled: 'Location (GPS) is turned off on this phone. Turn it on, then tap Retry.',
  error: 'GPS error. Tap Retry.',
  waiting: 'Waiting for a GPS fix. Go near a window or outside if it takes long.',
};

export function GpsBanner({ status, onRetry }: { status: GpsStatus; onRetry: () => void }) {
  const text = GPS_PROBLEMS[status];
  if (!text) return null;
  const soft = status === 'waiting';
  return (
    <View style={[styles.banner, soft && styles.bannerSoft]}>
      <Text style={[styles.bannerText, soft && { color: '#854d0e' }]}>{text}</Text>
      {!soft && (
        <Pressable onPress={onRetry} hitSlop={8}>
          <Text style={styles.bannerBtn}>Retry</Text>
        </Pressable>
      )}
    </View>
  );
}

export const ui = StyleSheet.create({
  rowLabel: { fontSize: 13, fontWeight: '600', color: '#334155', marginTop: 10, marginBottom: 6 },
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#fff',
  },
  chipOn: { backgroundColor: '#0f172a', borderColor: '#0f172a' },
  chipText: { fontSize: 13, color: '#0f172a', fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  toggleLabel: { fontSize: 15, color: '#0f172a', fontWeight: '500' },
  hint: { fontSize: 12, color: '#64748b', marginTop: 2 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fee2e2',
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 12,
    marginTop: 12,
  },
  bannerSoft: { backgroundColor: '#fef9c3' },
  bannerText: { flex: 1, color: '#991b1b', fontSize: 13 },
  bannerBtn: { color: '#991b1b', fontWeight: '800' },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  statValue: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  statLabel: { fontSize: 11, color: '#64748b', marginTop: 2 },
});
