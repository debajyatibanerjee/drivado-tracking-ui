import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import BulkAddScreen, { BulkRequest } from './src/screens/BulkAddScreen';
import { confirm } from './src/components/confirm';
import DriversScreen from './src/screens/DriversScreen';
import LoginScreen from './src/screens/LoginScreen';
import TripScreen from './src/screens/TripScreen';
import { generateDrivers, randomTrip } from './src/services/bulkDrivers';
import { sharedGps } from './src/services/gps';
import { loadSessions, LoginForm, newSessionId, saveSessions, Session } from './src/services/session';
import { TrackingEngine } from './src/services/trackingEngine';

type View_ = { name: 'drivers' } | { name: 'login' } | { name: 'bulk' } | { name: 'trip'; id: string };

// Auto-started trips are placed around the phone's position, or here if GPS has no fix yet.
const FALLBACK_CENTER = { latitude: 25.1181, longitude: 55.2006 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Several drivers can be logged in at once. Each has its own TrackingEngine
// (socket, trip, offline cache) that keeps running while another one is on screen.
export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [view, setView] = useState<View_>({ name: 'drivers' });
  const [booting, setBooting] = useState(true);
  const [bulkBusy, setBulkBusy] = useState(false);
  const engines = useRef(new Map<string, TrackingEngine>());
  // Latest list for async handlers (confirm dialogs), which would otherwise see a stale copy.
  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const startEngine = (s: Session) => {
    const e = new TrackingEngine(s);
    engines.current.set(s.id, e);
    e.start();
  };

  useEffect(() => {
    const running = engines.current;
    loadSessions().then((list) => {
      list.forEach(startEngine);
      setSessions(list);
      setView(list.length ? { name: 'drivers' } : { name: 'login' });
      setBooting(false);
    });
    return () => running.forEach((e) => e.stop());
  }, []);

  // Android back button: trip / login -> drivers list.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (view.name === 'drivers' || sessions.length === 0) return false;
      setView({ name: 'drivers' });
      return true;
    });
    return () => sub.remove();
  }, [view, sessions.length]);

  const addDriver = async (form: LoginForm) => {
    const s: Session = { ...form, id: newSessionId() };
    const next = [...sessions, s];
    await saveSessions(next);
    startEngine(s);
    setSessions(next);
    setView({ name: 'trip', id: s.id });
  };

  // Creates N drivers with generated IDs; optionally starts a simulated trip for each.
  const addDrivers = async (req: BulkRequest) => {
    setBulkBusy(true);
    const generated = generateDrivers(req.count, { wsUrl: req.wsUrl, wsKey: req.wsKey }, req.run);
    const created = generated.map((g) => ({ session: { ...g.login, id: newSessionId() } as Session, bookingId: g.bookingId }));
    const next = [...sessions, ...created.map((c) => c.session)];
    await saveSessions(next);
    created.forEach((c) => {
      startEngine(c.session);
      // Network strength chosen on the bulk screen ("mixed" = random fixed 1-4 bars per driver).
      const signalMode = req.signal === 'mixed' ? ((1 + Math.floor(Math.random() * 4)) as 1 | 2 | 3 | 4) : req.signal;
      engines.current.get(c.session.id)?.updateSim({ signalMode });
    });
    setSessions(next);
    setBulkBusy(false);
    setView({ name: 'drivers' });
    if (!req.autoStart) return;

    // Wait briefly for a GPS fix to centre the trips on, then start them one by one
    // (spaced out so the free routing service isn't flooded).
    for (let i = 0; i < 25 && !sharedGps.fix; i++) await sleep(200);
    const center = sharedGps.fix ?? FALLBACK_CENTER;
    for (const [i, c] of created.entries()) {
      const e = engines.current.get(c.session.id);
      if (!e) continue; // logged out meanwhile
      e.updateSim({ locationSource: 'sim', speed: '3x' });
      const { plan, start } = randomTrip(center, c.bookingId, c.session.tripId, i + 1);
      await e.startTrip(plan, start);
      await sleep(400);
    }
  };

  const logoutAll = async () => {
    const all = sessionsRef.current;
    if (!all.length) return;
    const cached = all.reduce((n, x) => n + (engines.current.get(x.id)?.getSnapshot().queueSize ?? 0), 0);
    const ok = await confirm(
      `Logout all ${all.length} drivers?`,
      'Stops tracking every trip and removes all drivers.' +
        (cached ? `

${cached} cached update(s) not sent yet will be deleted.` : ''),
      'Logout all',
    );
    if (!ok) return;
    const running = [...engines.current.values()];
    engines.current.clear();
    await Promise.all(running.map((e) => e.destroy()));
    await saveSessions([]);
    setSessions([]);
    setView({ name: 'login' });
  };


  const removeDriver = async (id: string) => {
    const s = sessionsRef.current.find((x) => x.id === id);
    const e = engines.current.get(id);
    if (!s || !e) return;
    const cached = e.getSnapshot().queueSize;
    const ok = await confirm(
      `Logout ${s.driverId}?`,
      `Stops tracking trip ${s.tripId} and removes this driver.` +
        (cached ? `

${cached} cached update(s) have not been sent yet and will be deleted.` : ''),
      'Logout',
    );
    if (!ok) return;
    engines.current.delete(id);
    await e.destroy();
    const next = sessionsRef.current.filter((x) => x.id !== id);
    await saveSessions(next);
    setSessions(next);
    setView(next.length ? { name: 'drivers' } : { name: 'login' });
  };


  const openEngine = view.name === 'trip' ? engines.current.get(view.id) : undefined;

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {booting ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      ) : view.name === 'login' ? (
        <LoginScreen
          onLogin={addDriver}
          onCancel={sessions.length ? () => setView({ name: 'drivers' }) : undefined}
          onBulk={() => setView({ name: 'bulk' })}
          takenTripIds={sessions.map((s) => s.tripId)}
        />
      ) : view.name === 'bulk' ? (
        <BulkAddScreen
          busy={bulkBusy}
          onCreate={addDrivers}
          onCancel={() => setView(sessions.length ? { name: 'drivers' } : { name: 'login' })}
        />
      ) : view.name === 'trip' && openEngine ? (
        <TripScreen
          key={view.id}
          engine={openEngine}
          onBack={() => setView({ name: 'drivers' })}
          onLogout={() => removeDriver(view.id)}
        />
      ) : (
        <DriversScreen
          sessions={sessions}
          engines={engines.current}
          onOpen={(id) => setView({ name: 'trip', id })}
          onAdd={() => setView({ name: 'login' })}
          onAddMany={() => setView({ name: 'bulk' })}
          onLogout={removeDriver}
          onLogoutAll={logoutAll}
        />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
