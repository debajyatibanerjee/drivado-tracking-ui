import AsyncStorage from '@react-native-async-storage/async-storage';

// Several drivers can be logged in at once (for testing); each is one Session.
const SESSIONS_KEY = '@driver_sessions_v1';
const LEGACY_SESSION_KEY = '@driver_session_v3'; // single-login builds

export interface Session {
  id: string; // local ID; namespaces this driver's stored trip and offline cache
  email: string;
  driverId: string;
  wsUrl: string;
  // Connection headers, typed at login:
  wsKey: string; // X-WS-Key
  tripId: string; // X-Trip-ID (also the tripID in every message)
  deviceId: string; // X-Device-ID
}

export type LoginForm = Omit<Session, 'id'>;

const isComplete = (s: Partial<Session> | null | undefined): s is Session =>
  !!(s?.id && s.email && s.driverId && s.wsUrl && s.wsKey && s.tripId && s.deviceId);

export const newSessionId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function loadSessions(): Promise<Session[]> {
  try {
    const raw = await AsyncStorage.getItem(SESSIONS_KEY);
    if (raw) return (JSON.parse(raw) as Session[]).filter(isComplete);

    // Carry over the login from the single-login version, keeping its stored data.
    const legacy = await AsyncStorage.getItem(LEGACY_SESSION_KEY);
    const s = legacy ? { ...JSON.parse(legacy), id: 'legacy' } : null;
    if (isComplete(s)) {
      await saveSessions([s]);
      await AsyncStorage.removeItem(LEGACY_SESSION_KEY);
      return [s];
    }
  } catch {}
  return [];
}

export async function saveSessions(sessions: Session[]) {
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

// Remembered separately so the login form is pre-filled for the next driver.
const LAST_KEY = '@driver_last_login_v1';

export async function loadLastLogin(): Promise<Partial<LoginForm>> {
  try {
    const raw = await AsyncStorage.getItem(LAST_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function saveLastLogin(s: LoginForm) {
  await AsyncStorage.setItem(LAST_KEY, JSON.stringify(s));
}
