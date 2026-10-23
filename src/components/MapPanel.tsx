import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

import { LatLng } from '../types';

// Leaflet + OpenStreetMap (CARTO tiles) inside a WebView: no API key needed,
// works in Expo Go. Data goes in via injected JS, map taps come back as messages.

const HTML = `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"/>
<style>
  html, body, #map { margin: 0; height: 100%; background: #e2e8f0; }
  .car { width: 24px; height: 24px; border-radius: 50%; background: #0f172a; border: 3px solid #fff;
         box-shadow: 0 1px 4px rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center;
         color: #fff; font-size: 11px; line-height: 1; }
  #err { position: absolute; inset: 0; display: none; align-items: center; justify-content: center;
         font: 14px sans-serif; color: #475569; text-align: center; padding: 20px; }
</style>
</head><body>
<div id="map"></div><div id="err">Map could not load.<br/>Check the phone's internet connection.</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script>
  (function () {
    function post(m) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
    if (!window.L) { document.getElementById('err').style.display = 'flex'; return; }
    var map = L.map('map', { zoomControl: false }).setView([20, 0], 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19, subdomains: 'abcd', attribution: '&copy; OpenStreetMap &copy; CARTO'
    }).addTo(map);
    var legA = L.polyline([], { color: '#2563eb', weight: 5 }).addTo(map);
    var legB = L.polyline([], { color: '#7c3aed', weight: 5 }).addTo(map);
    var pins = [], car = null, acc = null, scene = {}, lastCar = null, centered = false;

    function pin(p, color, label) {
      return L.circleMarker(p, { radius: 8, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1 })
        .bindTooltip(label, { permanent: true, direction: 'top', offset: [0, -8] }).addTo(map);
    }
    function fitAll() {
      var pts = [].concat(scene.legA || [], scene.legB || []);
      if (scene.pickup) pts.push(scene.pickup);
      if (scene.dropoff) pts.push(scene.dropoff);
      if (lastCar) pts.push(lastCar);
      if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 16 });
      else if (pts.length === 1) map.setView(pts[0], 15);
    }
    window.fitAll = fitAll;

    window.setScene = function (s) {
      scene = s;
      legA.setLatLngs(s.legA || []);
      legA.setStyle({ color: s.pickupDone ? '#94a3b8' : '#2563eb' });
      legB.setLatLngs(s.legB || []);
      pins.forEach(function (m) { map.removeLayer(m); });
      pins = [];
      if (s.pickup) pins.push(pin(s.pickup, '#16a34a', 'Pickup'));
      if (s.dropoff) pins.push(pin(s.dropoff, '#dc2626', 'Drop-off'));
      if (s.fit) fitAll();
    };

    window.updateCar = function (s) {
      if (!s) return;
      lastCar = [s.lat, s.lng];
      if (!car) {
        car = L.marker(lastCar, {
          icon: L.divIcon({ className: '', html: '<div id="car" class="car">&#9650;</div>', iconSize: [30, 30], iconAnchor: [15, 15] }),
          zIndexOffset: 1000
        }).addTo(map);
      } else car.setLatLng(lastCar);
      var el = document.getElementById('car');
      if (el) el.style.transform = 'rotate(' + s.heading + 'deg)';
      if (s.accuracy) {
        if (!acc) acc = L.circle(lastCar, { radius: s.accuracy, color: '#2563eb', weight: 1, fillOpacity: 0.08 }).addTo(map);
        else acc.setLatLng(lastCar).setRadius(s.accuracy);
      } else if (acc) { map.removeLayer(acc); acc = null; }
      if (s.follow) map.setView(lastCar, Math.max(map.getZoom(), 15), { animate: true });
      else if (!centered) { centered = true; fitAll(); }
    };

    map.on('click', function (e) { post({ type: 'tap', lat: e.latlng.lat, lng: e.latlng.lng }); });
    post({ type: 'ready' });
  })();
</script>
</body></html>`;

const pair = (p: LatLng | null | undefined) => (p ? [p.latitude, p.longitude] : null);

interface Props {
  car: LatLng | null;
  heading: number;
  accuracy: number | null;
  pickup: LatLng | null;
  dropoff: LatLng | null;
  legA?: LatLng[] | null;
  legB?: LatLng[] | null;
  pickupDone?: boolean;
  onTap?: (p: LatLng) => void;
  hint?: string;
}

export default function MapPanel({
  car,
  heading,
  accuracy,
  pickup,
  dropoff,
  legA,
  legB,
  pickupDone = false,
  onTap,
  hint,
}: Props) {
  const webRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [follow, setFollow] = useState(false);

  const inject = (js: string) => webRef.current?.injectJavaScript(`${js}; true;`);

  useEffect(() => {
    if (!ready) return;
    const s = {
      legA: legA?.map(pair) ?? [],
      legB: legB?.map(pair) ?? [],
      pickup: pair(pickup),
      dropoff: pair(dropoff),
      pickupDone,
      fit: true,
    };
    webRef.current?.injectJavaScript(`window.setScene && window.setScene(${JSON.stringify(s)}); true;`);
  }, [ready, legA, legB, pickup, dropoff, pickupDone]);

  useEffect(() => {
    if (!ready || !car) return;
    const s = { lat: car.latitude, lng: car.longitude, heading, accuracy, follow };
    webRef.current?.injectJavaScript(`window.updateCar && window.updateCar(${JSON.stringify(s)}); true;`);
  }, [ready, car, heading, accuracy, follow]);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const m = JSON.parse(e.nativeEvent.data);
      if (m.type === 'ready') setReady(true);
      if (m.type === 'tap') onTap?.({ latitude: m.lat, longitude: m.lng });
    } catch {}
  };

  return (
    <View style={styles.wrap}>
      <WebView
        ref={webRef}
        style={styles.web}
        originWhitelist={['*']}
        source={{ html: HTML }}
        onMessage={onMessage}
        onLoadStart={() => setReady(false)}
        scrollEnabled={false}
        overScrollMode="never"
        javaScriptEnabled
      />

      <View style={styles.overlay}>
        <Pressable style={[styles.chip, follow && styles.chipOn]} onPress={() => setFollow((f) => !f)}>
          <Text style={[styles.chipText, follow && styles.chipTextOn]}>Follow car</Text>
        </Pressable>
        <Pressable
          style={styles.chip}
          onPress={() => {
            setFollow(false);
            inject('window.fitAll && window.fitAll()');
          }}
        >
          <Text style={styles.chipText}>Fit all</Text>
        </Pressable>
      </View>

      {!!hint && (
        <View style={styles.hint} pointerEvents="none">
          <Text style={styles.hintText}>{hint}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: '40%', backgroundColor: '#e2e8f0' },
  web: { flex: 1, backgroundColor: '#e2e8f0' },
  overlay: { position: 'absolute', top: 10, right: 10, flexDirection: 'row', gap: 8 },
  chip: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  chipOn: { backgroundColor: '#0f172a' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#0f172a' },
  chipTextOn: { color: '#fff' },
  hint: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    backgroundColor: 'rgba(15,23,42,0.85)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  hintText: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
