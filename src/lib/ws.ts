/**
 * WhisperBox WebSocket Manager
 * Handles real-time messaging with auto-reconnect on token expiry.
 */

import { getWSUrl, getAccessToken } from './api';

export type WSEvent =
  | { event: 'message.receive'; id: string; from_user_id: string; to_user_id: string; payload: { ciphertext: string; iv: string; encryptedKey: string; encryptedKeyForSelf: string }; created_at: string }
  | { event: 'user.online'; user_id: string }
  | { event: 'user.offline'; user_id: string }
  | { event: 'error'; detail: string };

type Listener = (event: WSEvent) => void;
type StatusListener = (connected: boolean) => void;

let ws: WebSocket | null = null;
let listeners: Listener[] = [];
let statusListeners: StatusListener[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let intentionalClose = false;

export function addWSListener(fn: Listener) {
  listeners.push(fn);
  return () => { listeners = listeners.filter(l => l !== fn); };
}

export function addStatusListener(fn: StatusListener) {
  statusListeners.push(fn);
  return () => { statusListeners = statusListeners.filter(l => l !== fn); };
}

function notifyStatus(connected: boolean) {
  statusListeners.forEach(fn => fn(connected));
}

export function connectWS(onTokenExpired: () => Promise<boolean>) {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  if (!getAccessToken()) return;

  intentionalClose = false;
  const url = getWSUrl();
  ws = new WebSocket(url);

  ws.onopen = () => {
    notifyStatus(true);
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  };

  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data) as WSEvent;
      listeners.forEach(fn => fn(data));
    } catch {
      // ignore malformed frames
    }
  };

  ws.onclose = async (ev) => {
    notifyStatus(false);
    if (intentionalClose) return;

    if (ev.code === 4001) {
      // Token expired — refresh and reconnect
      const ok = await onTokenExpired();
      if (ok) {
        scheduleReconnect(onTokenExpired, 500);
      }
    } else if (ev.code === 4003) {
      // Invalid token — user must log in again; don't reconnect
    } else {
      // Unexpected close — retry with backoff
      scheduleReconnect(onTokenExpired, 2000);
    }
  };

  ws.onerror = () => {
    // onerror is always followed by onclose
  };
}

function scheduleReconnect(onTokenExpired: () => Promise<boolean>, delay: number) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => connectWS(onTokenExpired), delay);
}

export function sendWSMessage(to: string, payload: { ciphertext: string; iv: string; encryptedKey: string; encryptedKeyForSelf: string }) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error('WebSocket not connected');
  }
  ws.send(JSON.stringify({
    event: 'message.send',
    to,
    payload,
  }));
}

export function disconnectWS() {
  intentionalClose = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) { ws.close(); ws = null; }
  listeners = [];
  statusListeners = [];
}

export function isWSConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}
