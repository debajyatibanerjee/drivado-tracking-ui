// Starts Expo behind a Cloudflare quick tunnel so a phone on any network can open
// the app in Expo Go (office Wi-Fi blocks phone -> PC traffic, and Expo's own
// ngrok tunnel is unreliable). No account needed; the URL is new on every run.
//   npm run start:lt            app only (backend: the real Drivado endpoint)
//   npm run start:lt -- --mock  also tunnel the local mock server on port 8080
const fs = require('fs');
const net = require('net');
const { spawn, execSync } = require('child_process');

const METRO_PORT = 8081;
const WS_PORT = Number(process.env.WS_PORT) || 8080;
const CLOUDFLARED =
  process.env.CLOUDFLARED ||
  (fs.existsSync('D:/android-build/tools/cloudflared.exe') ? 'D:/android-build/tools/cloudflared.exe' : 'cloudflared');

const useMock = process.argv.includes('--mock');
const expoArgs = process.argv.slice(2).filter((a) => a !== '--mock');
const children = [];

function killAll() {
  for (const c of children) {
    try {
      if (process.platform === 'win32') execSync(`taskkill /pid ${c.pid} /T /F`, { stdio: 'ignore' });
      else c.kill();
    } catch {}
  }
}
process.on('SIGINT', () => {
  killAll();
  process.exit(0);
});
process.on('exit', killAll);

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port);
  });
}

// Runs `cloudflared tunnel --url` and resolves with the public https URL.
function startTunnel(port, label) {
  return new Promise((resolve, reject) => {
    const proc = spawn(CLOUDFLARED, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`]);
    children.push(proc);
    let url = null;
    const onData = (buf) => {
      const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !url) {
        url = m[0];
        resolve(url);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (e) => reject(new Error(`cannot run cloudflared (${CLOUDFLARED}): ${e.message}`)));
    proc.on('exit', (code) => {
      if (!url) return reject(new Error(`cloudflared exited (code ${code})`));
      console.log(`\n!!! [tunnel:${label}] stopped (code ${code}). Run "npm run start:lt" again for a new URL.\n`);
      killAll();
      process.exit(1);
    });
  });
}

(async () => {
  if (!(await portFree(METRO_PORT))) {
    console.log(`\nPort ${METRO_PORT} is already in use: another Expo dev server is running.`);
    console.log('Stop it first (Ctrl+C in its terminal), then run this again.\n');
    process.exit(1);
  }

  console.log('Opening Cloudflare tunnel...');
  const metroUrl = await startTunnel(METRO_PORT, 'app');
  const wsUrl = useMock ? (await startTunnel(WS_PORT, 'ws')).replace(/^https:/, 'wss:') : null;
  const host = new URL(metroUrl).host;

  console.log('\n==================================================================');
  console.log(' In Expo Go tap "Enter URL manually" and type:');
  console.log(`     exp://${host}`);
  console.log(' (or scan the QR code below)');
  if (wsUrl) {
    console.log(' Mock WebSocket URL (pre-filled on login):');
    console.log(`     ${wsUrl}`);
    console.log(` (run "npm start" in mock-server so port ${WS_PORT} has a server)`);
  }
  console.log('==================================================================\n');

  const env = { ...process.env, EXPO_PACKAGER_PROXY_URL: metroUrl };
  if (wsUrl) env.EXPO_PUBLIC_WS_URL = wsUrl;
  const expo = spawn('npx', ['expo', 'start', '--port', String(METRO_PORT), ...expoArgs], {
    stdio: 'inherit',
    shell: true,
    env,
  });
  children.push(expo);
  expo.on('exit', (code) => {
    killAll();
    process.exit(code ?? 0);
  });
})().catch((e) => {
  console.error(e.message);
  killAll();
  process.exit(1);
});
