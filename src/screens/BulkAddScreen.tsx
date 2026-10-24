import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Chips } from '../components/ui';
import { DEFAULT_WS_URL, ENV_WS_URL } from '../config';
import { generateDrivers, MAX_BULK_DRIVERS, newRunCode } from '../services/bulkDrivers';
import { loadLastLogin } from '../services/session';

const WS_RE = /^wss?:\/\/.+/i;

// Network strength for the new drivers: auto (varies), fixed 0-4 bars, or a random fixed 1-4 per driver.
export type BulkSignal = 'auto' | 0 | 1 | 2 | 3 | 4 | 'mixed';
const SIGNAL_OPTIONS: BulkSignal[] = ['auto', 'mixed', 4, 3, 2, 1, 0];
const SIGNAL_HINT: Record<string, string> = {
  auto: 'Each driver’s signal varies on its own between 1 and 4 bars.',
  mixed: 'Each driver gets a random fixed strength from 1 to 4 bars.',
  0: 'No signal: drivers stay offline and cache every update, then bulk-send when you raise the signal.',
};

export interface BulkRequest {
  count: number;
  wsUrl: string;
  wsKey: string;
  run: string;
  autoStart: boolean;
  signal: BulkSignal;
}

interface Props {
  onCreate: (req: BulkRequest) => void;
  onCancel?: () => void;
  busy: boolean;
}

// Enter a number: Booking/Trip/Driver/Device IDs are generated for each driver.
export default function BulkAddScreen({ onCreate, onCancel, busy }: Props) {
  const [count, setCount] = useState('5');
  const [wsUrl, setWsUrl] = useState(DEFAULT_WS_URL);
  const [wsKey, setWsKey] = useState('');
  const [autoStart, setAutoStart] = useState(true);
  const [signal, setSignal] = useState<BulkSignal>('auto');
  const [run] = useState(newRunCode);
  const [error, setError] = useState('');

  useEffect(() => {
    loadLastLogin().then((last) => {
      if (last.wsKey) setWsKey(last.wsKey);
      setWsUrl(ENV_WS_URL || last.wsUrl || DEFAULT_WS_URL);
    });
  }, []);

  const n = Number(count);
  const valid = Number.isInteger(n) && n >= 1 && n <= MAX_BULK_DRIVERS;
  const preview = valid ? generateDrivers(Math.min(n, 3), { wsUrl, wsKey }, run) : [];

  const submit = () => {
    if (!valid) return setError(`Enter a number from 1 to ${MAX_BULK_DRIVERS}`);
    if (!WS_RE.test(wsUrl.trim())) return setError('WebSocket URL must start with ws:// or wss://');
    if (!wsKey.trim()) return setError('Enter X-WS-Key');
    setError('');
    onCreate({ count: n, wsUrl: wsUrl.trim(), wsKey: wsKey.trim(), run, autoStart, signal });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Add multiple drivers</Text>
          <Text style={styles.subtitle}>
            Enter how many. Booking ID, Trip ID, Driver ID and Device ID are generated for each one.
          </Text>

          <Text style={styles.label}>Number of drivers (1–{MAX_BULK_DRIVERS})</Text>
          <TextInput
            style={[styles.input, styles.count]}
            value={count}
            onChangeText={setCount}
            keyboardType="number-pad"
            maxLength={2}
          />

          <Text style={styles.label}>WebSocket endpoint (all drivers)</Text>
          <TextInput style={styles.input} value={wsUrl} onChangeText={setWsUrl} autoCapitalize="none" autoCorrect={false} />

          <Text style={styles.label}>X-WS-Key (all drivers)</Text>
          <TextInput
            style={styles.input}
            value={wsKey}
            onChangeText={setWsKey}
            placeholder="1234"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>Network strength (all drivers)</Text>
          <Chips
            options={SIGNAL_OPTIONS}
            value={signal}
            onChange={setSignal}
            format={(v) => (v === 'auto' ? 'Auto' : v === 'mixed' ? 'Mixed' : `${v}/4`)}
          />
          <Text style={styles.signalHint}>
            {SIGNAL_HINT[String(signal)] ?? `Fixed ${signal}/4 bars for every driver.`} You can still change it per driver later.
          </Text>

          <View style={styles.toggle}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Start trips automatically</Text>
              <Text style={styles.toggleHint}>
                Random pickup and drop-off around your location. Drivers move on their own (Simulated
                location) through ENROUTE → ARRIVED → POB → COMPLETED.
              </Text>
            </View>
            <Switch value={autoStart} onValueChange={setAutoStart} />
          </View>

          {valid && (
            <View style={styles.preview}>
              <Text style={styles.previewTitle}>Generated IDs (run {run})</Text>
              {preview.map((d) => (
                <Text key={d.login.tripId} style={styles.previewRow}>
                  {d.bookingId} · {d.login.tripId} · {d.login.driverId} · {d.login.deviceId}
                </Text>
              ))}
              {n > 3 && <Text style={styles.previewRow}>… up to {String(n).padStart(3, '0')}</Text>}
            </View>
          )}

          {!!error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            style={({ pressed }) => [styles.button, (pressed || busy) && { opacity: 0.7 }]}
            onPress={submit}
            disabled={busy}
          >
            <Text style={styles.buttonText}>{busy ? 'Creating…' : `Create ${valid ? n : ''} drivers`}</Text>
          </Pressable>
          {onCancel && (
            <Pressable style={styles.cancel} onPress={onCancel} disabled={busy}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 26, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  subtitle: { textAlign: 'center', color: '#64748b', marginTop: 6, marginBottom: 24 },
  label: { fontSize: 13, fontWeight: '600', color: '#334155', marginBottom: 6 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 14,
    color: '#0f172a',
  },
  count: { fontSize: 24, fontWeight: '800', textAlign: 'center' },
  signalHint: { fontSize: 12, color: '#64748b', marginTop: 8, marginBottom: 14 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  toggleLabel: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  toggleHint: { fontSize: 12, color: '#64748b', marginTop: 2 },
  preview: { backgroundColor: '#eef2ff', borderRadius: 10, padding: 12, marginBottom: 14 },
  previewTitle: { fontSize: 12, fontWeight: '800', color: '#3730a3', marginBottom: 4 },
  previewRow: { fontSize: 12, color: '#1e1b4b', fontFamily: 'monospace' },
  error: { color: '#dc2626', marginBottom: 12 },
  button: { backgroundColor: '#0f172a', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  cancel: { alignItems: 'center', paddingVertical: 14 },
  cancelText: { color: '#64748b', fontSize: 15, fontWeight: '600' },
});
