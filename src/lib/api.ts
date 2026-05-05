/**
 * WhisperBox API Client
 * Handles all HTTP requests with automatic Bearer token injection
 * and transparent token refresh.
 */

const BASE_URL = 'https://whisperbox.koyeb.app';

// ─── Token Store (in-memory + sessionStorage) ───────────────

let accessToken: string | null = null;
let refreshToken: string | null = null;
let tokenExpiresAt: number = 0;

export function setTokens(access: string, refresh: string, expiresIn: number) {
  accessToken = access;
  refreshToken = refresh;
  tokenExpiresAt = Date.now() + expiresIn * 1000;
  sessionStorage.setItem('wb_refresh', refresh);
}

export function getAccessToken() { return accessToken; }
export function getRefreshToken() { return refreshToken || sessionStorage.getItem('wb_refresh'); }

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
  tokenExpiresAt = 0;
  sessionStorage.removeItem('wb_refresh');
}

// ─── Token Refresh ──────────────────────────────────────────

let refreshPromise: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  const rt = getRefreshToken();
  if (!rt) return false;
  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    accessToken = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in || 900) * 1000;
    return true;
  } catch {
    return false;
  }
}

async function ensureFreshToken(): Promise<boolean> {
  if (accessToken && Date.now() < tokenExpiresAt - 60_000) return true; // still valid
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

// ─── Generic Fetch Wrapper ──────────────────────────────────

export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = opts;

  if (auth) {
    const ok = await ensureFreshToken();
    if (!ok) throw new ApiError(401, 'Session expired. Please log in again.');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (auth && accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const errJson = await res.json();
      // FastAPI validation errors return {detail: [{msg, loc, type}, ...]}
      if (Array.isArray(errJson.detail)) {
        detail = errJson.detail.map((d: { msg?: string; loc?: string[] }) => {
          const field = d.loc ? d.loc[d.loc.length - 1] : '';
          return field ? `${field}: ${d.msg}` : (d.msg || '');
        }).join('; ');
      } else {
        detail = errJson.detail || errJson.message || detail;
      }
    } catch { /* ignore parse error */ }
    throw new ApiError(res.status, detail);
  }

  return res.json() as Promise<T>;
}

// ─── Auth Endpoints ─────────────────────────────────────────

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: UserProfile;
}

export interface UserProfile {
  id: string;
  username: string;
  display_name: string;
  public_key: string;
  wrapped_private_key: string;
  pbkdf2_salt: string;
  created_at: string;
}

export interface RegisterBody {
  username: string;
  display_name: string;
  password: string;
  public_key: string;
  wrapped_private_key: string;
  pbkdf2_salt: string;
}

export function register(body: RegisterBody) {
  return request<AuthResponse>('/auth/register', { method: 'POST', body, auth: false });
}

export function login(username: string, password: string) {
  return request<AuthResponse>('/auth/login', { method: 'POST', body: { username, password }, auth: false });
}

export function getMe() {
  return request<UserProfile>('/auth/me');
}

export function logout(refresh_token: string) {
  return request<{ detail: string }>('/auth/logout', { method: 'POST', body: { refresh_token } });
}

// ─── Users ──────────────────────────────────────────────────

export interface UserSearchResult {
  id: string;
  username: string;
  display_name: string;
}

export function searchUsers(query: string) {
  return request<UserSearchResult[]>(`/users/search?q=${encodeURIComponent(query)}`);
}

export function getUserPublicKey(userId: string) {
  return request<{ public_key: string }>(`/users/${userId}/public-key`);
}

// ─── Conversations & Messages ───────────────────────────────

export interface Conversation {
  user_id: string;
  display_name: string;
  username: string;
  last_message_at: string;
}

export interface EncPayload {
  ciphertext: string;
  iv: string;
  encryptedKey: string;
  encryptedKeyForSelf: string;
}

export interface Message {
  id: string;
  from_user_id: string;
  to_user_id: string;
  payload: EncPayload;
  delivered: boolean;
  created_at: string;
}

export function getConversations() {
  return request<Conversation[]>('/conversations');
}

export function getMessages(userId: string, limit = 50, before?: string) {
  let url = `/conversations/${userId}/messages?limit=${limit}`;
  if (before) url += `&before=${encodeURIComponent(before)}`;
  return request<Message[]>(url);
}

export function sendMessageHTTP(to: string, payload: EncPayload) {
  return request<Message>('/messages', { method: 'POST', body: { to, payload } });
}

// ─── WebSocket URL builder ──────────────────────────────────

export function getWSUrl(): string {
  return `wss://whisperbox.koyeb.app/ws?token=${accessToken}`;
}
