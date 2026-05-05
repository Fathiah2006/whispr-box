import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import * as api from '../lib/api';
import * as cryptoLib from '../lib/crypto';
import { connectWS, disconnectWS } from '../lib/ws';
import { requestNotificationPermission } from '../lib/notifications';
import { clearCache } from '../lib/cache';

interface AuthState {
  user: api.UserProfile | null;
  privateKey: CryptoKey | null;
  publicKey: CryptoKey | null;
  loading: boolean;
}

interface AuthContextType extends AuthState {
  register: (username: string, displayName: string, password: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    privateKey: null,
    publicKey: null,
    loading: false,
  });
  const passwordRef = useRef<string>('');

  const initWS = useCallback(() => {
    connectWS(async () => {
      // Token expired callback — attempt refresh
      try {
        // Try to refresh using the api module's ensureFreshToken
        const res = await fetch('https://whisperbox.koyeb.app/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: api.getRefreshToken() }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        api.setTokens(data.access_token, api.getRefreshToken()!, data.expires_in || 900);
        return true;
      } catch {
        return false;
      }
    });
  }, []);

  const doRegister = useCallback(async (username: string, displayName: string, password: string) => {
    // 1. Generate keypair
    const keyPair = await cryptoLib.generateRSAKeyPair();

    // 2. Generate salt
    const salt = cryptoLib.generateSalt();

    // 3. Wrap private key (use slice to ensure exact buffer size)
    const saltBuffer = salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength);
    const wrappedPrivKey = await cryptoLib.wrapPrivateKey(keyPair.privateKey, password, saltBuffer);

    // 4. Export public key
    const pubKeyB64 = await cryptoLib.exportPublicKey(keyPair.publicKey);

    // 5. Register
    const res = await api.register({
      username,
      display_name: displayName,
      password,
      public_key: pubKeyB64,
      wrapped_private_key: cryptoLib.toBase64(wrappedPrivKey),
      pbkdf2_salt: cryptoLib.toBase64(saltBuffer),
    });

    api.setTokens(res.access_token, res.refresh_token, res.expires_in);
    passwordRef.current = password;

    setState({
      user: res.user,
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      loading: false,
    });

    requestNotificationPermission();
    initWS();
  }, [initWS]);

  const doLogin = useCallback(async (username: string, password: string) => {
    const res = await api.login(username, password);
    api.setTokens(res.access_token, res.refresh_token, res.expires_in);
    passwordRef.current = password;

    // Unwrap private key
    const privateKey = await cryptoLib.unwrapPrivateKey(
      cryptoLib.fromBase64(res.user.wrapped_private_key),
      password,
      cryptoLib.fromBase64(res.user.pbkdf2_salt)
    );

    // Import public key
    const publicKey = await cryptoLib.importPublicKey(res.user.public_key);

    setState({
      user: res.user,
      privateKey,
      publicKey,
      loading: false,
    });

    requestNotificationPermission();
    initWS();
  }, [initWS]);

  const doLogout = useCallback(async () => {
    const rt = api.getRefreshToken();
    try {
      if (rt) await api.logout(rt);
    } catch { /* best effort */ }
    disconnectWS();
    api.clearTokens();
    passwordRef.current = '';
    await clearCache();
    setState({ user: null, privateKey: null, publicKey: null, loading: false });
  }, []);

  return (
    <AuthContext.Provider value={{
      ...state,
      register: doRegister,
      login: doLogin,
      logout: doLogout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
