# WhisperBox — End-to-End Encrypted Messaging

A secure, real-time messaging web application where **all encryption and decryption happens exclusively on the client**. The server never sees plaintext — it only stores and forwards encrypted blobs.

Built with **React**, **TypeScript**, **Vite**, and the **Web Crypto API**.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                     CLIENT (Browser)                │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │  React   │  │ Web      │  │   IndexedDB       │  │
│  │  UI      │──│ Crypto   │──│   Message Cache   │  │
│  │          │  │ API      │  │                   │  │
│  └────┬─────┘  └──────────┘  └───────────────────┘  │
│       │                                             │
│  ┌────┴─────────────────────────────────┐           │
│  │  API Client    │    WebSocket Mgr    │           │
│  │  (REST + JWT)  │    (Real-time)      │           │
│  └────────────────┴─────────────────────┘           │
│           │ HTTPS              │ WSS                │
└───────────┼────────────────────┼────────────────────┘
            │  Only ciphertext   │  Only ciphertext
            ▼                    ▼
┌─────────────────────────────────────────────────────┐
│              WhisperBox Backend (Koyeb)              │
│                                                     │
│  • Stores encrypted blobs (ciphertext, wrapped keys)│
│  • Manages user identities & JWT auth               │
│  • Relays encrypted WebSocket frames                │
│  • NEVER has access to plaintext or private keys    │
│                                                     │
│  Endpoints: /auth, /users, /conversations, /ws      │
└─────────────────────────────────────────────────────┘
```

---

## Encryption Flow

### Registration

```
1. Client generates RSA-OAEP 2048-bit keypair
2. Client generates 128-bit PBKDF2 salt
3. Client derives AES-KW wrapping key from (password + salt)
4. Client wraps (encrypts) the RSA private key with AES-KW
5. Client exports RSA public key as base64
6. POST /auth/register sends:
   - public_key (base64)
   - wrapped_private_key (base64, encrypted)
   - pbkdf2_salt (base64)
   Server stores these blobs verbatim. Private key is never plaintext on the server.
```

### Login & Key Restoration

```
1. POST /auth/login → returns wrapped_private_key + pbkdf2_salt
2. Client re-derives AES-KW key from password + salt
3. Client unwraps private key into memory (non-extractable CryptoKey)
4. Private key exists ONLY in browser memory — never in storage
```

### Sending a Message

```
1. Fetch recipient's RSA-OAEP public key from server
2. Generate random AES-GCM 256-bit key + 96-bit IV
3. Encrypt plaintext with AES-GCM → ciphertext
4. Encrypt AES key with recipient's RSA public key → encryptedKey
5. Encrypt AES key with sender's RSA public key → encryptedKeyForSelf
6. Send {ciphertext, iv, encryptedKey, encryptedKeyForSelf} via WebSocket or REST
```

### Receiving a Message

```
1. Receive encrypted payload from WebSocket or REST API
2. Decrypt encryptedKey with own RSA private key → AES-GCM key
3. Decrypt ciphertext with AES-GCM key + IV → plaintext
4. Cache decrypted message in IndexedDB for fast loading
```

---

## Key Management

| Key | Storage | Lifetime |
|-----|---------|----------|
| RSA Public Key | Server (base64) | Permanent |
| RSA Private Key (wrapped) | Server (AES-KW encrypted blob) | Permanent |
| RSA Private Key (unwrapped) | Browser memory only (`CryptoKey`, non-extractable) | Session only |
| PBKDF2 Salt | Server (base64) | Permanent |
| AES-KW Wrapping Key | Derived in memory from password+salt | Transient |
| AES-GCM Session Key | Generated per message, encrypted for recipient | Per-message |

### Critical Security Properties

- **Private key never leaves the client in plaintext** — it is wrapped with a password-derived AES-KW key before being sent to the server.
- **Unwrapped private key is non-extractable** — the Web Crypto API flags it as `extractable: false`, preventing any JavaScript from reading the raw key material.
- **Password never stored** — the password is used only to derive the wrapping key and is then discarded.
- **Per-message AES keys** — each message gets a fresh 256-bit AES-GCM key, ensuring one compromised key doesn't affect other messages.

---

## Security Trade-offs & Known Limitations

### Trade-offs

1. **No Forward Secrecy**: We use static RSA keypairs rather than ephemeral Diffie-Hellman exchanges. If a private key is compromised, all past messages encrypted for that key can be decrypted. Implementing the Signal Protocol's Double Ratchet would provide forward secrecy but adds significant complexity.

2. **Password-based Key Wrapping**: The security of the wrapped private key depends on the strength of the user's password. Weak passwords could be brute-forced against the wrapped key blob.

3. **Session-only Private Key**: The unwrapped private key lives only in browser memory. Closing the tab or browser requires re-entering the password. This is a security feature (no persistent plaintext key storage) but reduces convenience.

4. **Trust-on-First-Use (TOFU)**: We trust that the public key returned by the server on first request is genuine. A compromised server could substitute a different public key. Key fingerprint verification between users would mitigate this.

### Known Limitations

- **No multi-device support** — the private key is tied to a single session. Opening a new tab requires re-login.
- **No message deletion** — once sent, encrypted blobs persist on the server.
- **No group messaging** — only 1:1 conversations are supported.
- **No file/media sharing** — text messages only.
- **No key rotation** — the RSA keypair is generated once at registration and never rotated.
- **Refresh token in sessionStorage** — while the private key is memory-only, the refresh token is stored in sessionStorage for session persistence. This is acceptable for short-lived sessions but could be improved.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 + TypeScript |
| Bundler | Vite 8 |
| Routing | React Router v7 |
| Cryptography | Web Crypto API (native browser) |
| Local Cache | IndexedDB via `idb` |
| Real-time | WebSocket (native browser) |
| Styling | Vanilla CSS (dark theme, glassmorphism) |
| Backend | WhisperBox API (Koyeb-hosted) |

---

## Project Structure

```
src/
├── lib/
│   ├── crypto.ts          # Web Crypto API — keygen, wrapping, encryption, decryption
│   ├── api.ts             # REST API client with auto token refresh
│   ├── ws.ts              # WebSocket manager with reconnect logic
│   ├── cache.ts           # IndexedDB message caching
│   └── notifications.ts   # Browser notifications & sound alerts
├── context/
│   └── AuthContext.tsx     # Auth state, session management, in-memory private key
├── components/
│   ├── Sidebar.tsx/.css    # Conversation list, avatars, online status
│   ├── ChatView.tsx/.css   # Message bubbles, input, E2EE badge
│   └── SearchModal.tsx/.css# User search overlay
├── pages/
│   ├── LoginPage.tsx       # Login form
│   ├── RegisterPage.tsx    # Registration with password strength
│   ├── DashboardPage.tsx   # Main layout orchestrator
│   ├── Auth.css            # Shared auth page styles
│   └── Dashboard.css       # Dashboard layout styles
├── App.tsx                 # Router + auth guards
├── main.tsx                # Entry point
└── index.css               # Design system & global styles
```

---

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

---

## API Reference

Base URL: `https://whisperbox.koyeb.app`
Interactive docs: `https://whisperbox.koyeb.app/docs`

See the full API guide in the project brief for endpoint details.
