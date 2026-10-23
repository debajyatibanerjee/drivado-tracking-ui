import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@driver_session_v3';

export interface Session {
  email: string;
  driverId: string;
  wsUrl: string;
  // Connection headers, typed at login:
  wsKey: string; // X-WS-Key
  tripId: string; // X-Trip-ID (also the tripID in every message)
  deviceId: string; // X-Device-ID
}

export async function loadSession(): Promise<Session | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const s = raw ? JSON.parse(raw) : null;
    return s?.email && s?.driverId && s?.wsUrl && s?.wsKey && s?.tripId && s?.deviceId ? s : null;
  } catch {
    return null;
  }
}

export async function saveSession(s: Session) {
  await AsyncStorage.setItem(KEY, JSON.stringify(s));
}

export async function clearSession() {
  await AsyncStorage.removeItem(KEY);
}

// Remembered separately so the login fields stay filled in after logout.
const LAST_KEY = '@driver_last_login_v1';

export async function loadLastLogin(): Promise<Partial<Session>> {
  try {
    const raw = await AsyncStorage.getItem(LAST_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function saveLastLogin(s: Session) {
  await AsyncStorage.setItem(LAST_KEY, JSON.stringify(s));
}
