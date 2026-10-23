import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import LoginScreen from './src/screens/LoginScreen';
import TripScreen from './src/screens/TripScreen';
import { clearSession, loadSession, saveSession, Session } from './src/services/session';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    loadSession().then((s) => {
      setSession(s);
      setBooting(false);
    });
  }, []);

  const login = async (s: Session) => {
    await saveSession(s);
    setSession(s);
  };

  const logout = async () => {
    await clearSession();
    setSession(null);
  };

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {booting ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      ) : session ? (
        <TripScreen key={JSON.stringify(session)} session={session} onLogout={logout} />
      ) : (
        <LoginScreen onLogin={login} />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
