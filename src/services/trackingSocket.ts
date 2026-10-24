import { Platform } from 'react-native';

export type ConnState = 'disconnected' | 'connecting' | 'connected';

const CONNECT_TIMEOUT_MS = 10000;
const MAX_RETRY_DELAY_MS = 15000;

// WebSocket wrapper with auto-reconnect (exponential backoff) while enabled.
export class TrackingSocket {
  onStateChange?: (state: ConnState, prev: ConnState) => void;
  onMessage?: (data: string) => void;
  onLog?: (msg: string) => void;

  private ws: WebSocket | null = null;
  private url = '';
  private headers: Record<string, string> = {};
  private enabled = false;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private state: ConnState = 'disconnected';

  get isEnabled() {
    return this.enabled;
  }

  get isConnected() {
    return this.state === 'connected' && this.ws?.readyState === WebSocket.OPEN;
  }

  connect(url: string, headers: Record<string, string> = {}) {
    this.url = url;
    this.headers = headers;
    this.enabled = true;
    this.retry = 0;
    this.open();
  }

  disconnect() {
    this.enabled = false;
    this.clearTimers();
    this.teardown();
    this.setState('disconnected');
  }

  send(msg: object): boolean {
    if (!this.isConnected) return false;
    try {
      this.ws!.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  private open() {
    if (!this.enabled) return;
    this.clearTimers();
    this.teardown();
    this.setState('connecting');

    let ws: WebSocket;
    try {
      // RN's WebSocket takes headers as a 3rd arg (bypass-tunnel-reminder is for localtunnel).
      const RNWebSocket = WebSocket as unknown as new (
        url: string,
        protocols: string[] | null,
        options: { headers: Record<string, string> },
      ) => WebSocket;
      ws =
        Platform.OS === 'web'
          ? new WebSocket(this.url) // browsers can't send custom headers at all
          : new RNWebSocket(this.url, null, { headers: { 'bypass-tunnel-reminder': 'true', ...this.headers } });
    } catch {
      this.onLog?.(`Invalid WebSocket URL: ${this.url}`);
      this.setState('disconnected');
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    this.connectTimer = setTimeout(() => {
      if (this.ws !== ws || this.state !== 'connecting') return;
      this.onLog?.('Connect timed out');
      this.teardown();
      this.setState('disconnected');
      this.scheduleReconnect();
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.clearTimers();
      this.retry = 0;
      this.setState('connected');
    };
    ws.onmessage = (e) => {
      if (this.ws === ws) this.onMessage?.(String(e.data));
    };
    ws.onerror = (e) => {
      // onclose always follows; reconnect is handled there.
      const msg = (e as unknown as { message?: string }).message;
      if (this.ws === ws) {
        const hint = Platform.OS === 'web' ? ' (web browsers cannot send the X-* headers; use the phone app)' : explain(msg);
        this.onLog?.(`Socket error${msg ? `: ${msg}` : ''}${hint}`);
      }
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.onLog?.(`Socket closed (code ${e.code}${e.reason ? `, ${e.reason}` : ''})`);
      this.clearTimers();
      this.ws = null;
      this.setState('disconnected');
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (!this.enabled) return;
    const delay = Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** this.retry);
    this.retry++;
    this.onLog?.(`Reconnecting in ${delay / 1000}s`);
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private teardown() {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onmessage = ws.onerror = ws.onclose = null;
    if (ws.readyState === WebSocket.CONNECTING) {
      // On Android, close() on a socket that is still connecting is silently ignored
      // (RN only registers it natively once open). It would then open later with
      // nothing attached, answer server pings forever and hold the trip (server: 409
      // "trip already connected"). So close it the moment it opens instead. Don't call
      // close() now: that flips readyState to CLOSING and the later close() is skipped.
      ws.onopen = () => {
        try {
          ws.close(1000, 'abandoned');
        } catch {}
      };
      return;
    }
    ws.onopen = null;
    try {
      ws.close(1000, 'client closing');
    } catch {}
  }

  private clearTimers() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.retryTimer = this.connectTimer = null;
  }

  private setState(s: ConnState) {
    if (s === this.state) return;
    const prev = this.state;
    this.state = s;
    this.onStateChange?.(s, prev);
  }
}

// Plain-language hints for handshake failures from the backend.
function explain(msg?: string): string {
  if (!msg) return '';
  if (msg.includes('401')) return ' (unauthorized: check X-WS-Key)';
  if (msg.includes('409')) return ' (trip already connected: another app/Postman holds this X-Trip-ID; retrying)';
  return '';
}
