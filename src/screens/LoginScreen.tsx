import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DEFAULT_WS_URL, ENV_WS_URL } from '../config';
import { loadLastLogin, LoginForm, saveLastLogin } from '../services/session';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WS_RE = /^wss?:\/\/.+/i;

type Form = LoginForm;
const EMPTY: Form = { email: '', driverId: '', wsUrl: DEFAULT_WS_URL, wsKey: '', tripId: '', deviceId: '' };

interface Props {
  onLogin: (form: LoginForm) => void;
  onCancel?: () => void; // shown when other drivers are already logged in
  onBulk: () => void; // switch to "Add multiple drivers"
  takenTripIds: string[]; // X-Trip-IDs already used by logged-in drivers
}

export default function LoginScreen({ onLogin, onCancel, onBulk, takenTripIds }: Props) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [error, setError] = useState('');

  // Pre-fill with the last values used (a tunnel URL from `npm run start:lt` wins).
  useEffect(() => {
    loadLastLogin().then((last) =>
      setForm((f) => ({ ...f, ...last, wsUrl: ENV_WS_URL || last.wsUrl || f.wsUrl })),
    );
  }, []);

  const set = (k: keyof Form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const s: LoginForm = {
      email: form.email.trim().toLowerCase(),
      driverId: form.driverId.trim(),
      wsUrl: form.wsUrl.trim(),
      wsKey: form.wsKey.trim(),
      tripId: form.tripId.trim(),
      deviceId: form.deviceId.trim(),
    };
    if (!EMAIL_RE.test(s.email)) return setError('Enter a valid email address');
    if (!s.driverId) return setError('Enter your Driver ID');
    if (!WS_RE.test(s.wsUrl)) return setError('WebSocket URL must start with ws:// or wss://');
    if (!s.wsKey) return setError('Enter X-WS-Key');
    if (!s.tripId) return setError('Enter X-Trip-ID');
    if (takenTripIds.includes(s.tripId)) {
      return setError(`${s.tripId} is already used by a logged-in driver. Use another X-Trip-ID (one connection per trip).`);
    }
    if (!s.deviceId) return setError('Enter X-Device-ID');
    setError('');
    await saveLastLogin(s);
    onLogin(s);
  };

  const field = (label: string, k: keyof Form, props: TextInputProps = {}) => (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={form[k]}
        onChangeText={set(k)}
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
      />
    </>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.logo}>🚖</Text>
          <Text style={styles.title}>{onCancel ? 'Add driver' : 'Driver Tracker'}</Text>
          <Text style={styles.subtitle}>
            {onCancel
              ? `${takenTripIds.length} driver(s) already logged in. This one runs alongside them.`
              : 'Shares your live location during a trip.'}
          </Text>

          {field('Driver email', 'email', { placeholder: 'driver@example.com', keyboardType: 'email-address' })}
          {field('Driver ID', 'driverId', { placeholder: 'DR123', autoCapitalize: 'characters' })}
          {field('WebSocket endpoint', 'wsUrl', { placeholder: 'wss://your-backend/ws' })}

          <Text style={styles.section}>Connection headers</Text>
          {field('X-WS-Key', 'wsKey', { placeholder: '1234' })}
          {field('X-Trip-ID', 'tripId', { placeholder: 'T-D-0001', autoCapitalize: 'characters' })}
          {field('X-Device-ID', 'deviceId', { placeholder: 'Device / FCM token' })}

          {!!error && <Text style={styles.error}>{error}</Text>}

          <Pressable style={({ pressed }) => [styles.button, pressed && { opacity: 0.8 }]} onPress={submit}>
            <Text style={styles.buttonText}>{onCancel ? 'Login this driver' : 'Login'}</Text>
          </Pressable>
          <Pressable style={styles.cancel} onPress={onBulk}>
            <Text style={styles.bulkText}>Add multiple drivers with generated IDs ›</Text>
          </Pressable>
          {onCancel && (
            <Pressable style={styles.cancel} onPress={onCancel}>
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
  logo: { fontSize: 56, textAlign: 'center' },
  title: { fontSize: 28, fontWeight: '800', textAlign: 'center', color: '#0f172a', marginTop: 8 },
  subtitle: { textAlign: 'center', color: '#64748b', marginTop: 6, marginBottom: 28 },
  section: {
    fontSize: 12,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 4,
    marginBottom: 10,
  },
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
  error: { color: '#dc2626', marginBottom: 12 },
  button: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  cancel: { alignItems: 'center', paddingVertical: 14 },
  cancelText: { color: '#64748b', fontSize: 15, fontWeight: '600' },
  bulkText: { color: '#2563eb', fontSize: 15, fontWeight: '700' },
});
