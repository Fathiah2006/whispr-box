/**
 * WhisperBox Crypto Engine
 * All client-side encryption/decryption using Web Crypto API.
 * - RSA-OAEP 2048 for key exchange
 * - AES-GCM 256 for message encryption
 * - PBKDF2 + AES-KW for private key wrapping
 */

// ─── Utilities ───────────────────────────────────────────────

export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function fromBase64(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function getRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

// ─── Key Generation ─────────────────────────────────────────

/** Generate an RSA-OAEP 2048-bit keypair */
export async function generateRSAKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true, // extractable
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
  );
}

/** Export public key as base64 (spki) */
export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('spki', key);
  return toBase64(exported);
}

/** Import a base64 public key back to CryptoKey */
export async function importPublicKey(b64: string): Promise<CryptoKey> {
  const keyData = fromBase64(b64);
  return crypto.subtle.importKey(
    'spki',
    keyData,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['encrypt', 'wrapKey']
  );
}

// ─── Key Wrapping (PBKDF2 → AES-KW) ────────────────────────

/** Derive an AES-KW wrapping key from password + salt */
async function deriveWrappingKey(password: string, salt: ArrayBuffer): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  );
}

/** Generate a random 128-bit salt */
export function generateSalt(): Uint8Array {
  return getRandomBytes(16); // 128 bits
}

/** Wrap (encrypt) the private key using password-derived AES-KW */
export async function wrapPrivateKey(
  privateKey: CryptoKey,
  password: string,
  salt: ArrayBuffer
): Promise<ArrayBuffer> {
  const wrappingKey = await deriveWrappingKey(password, salt);
  // Use first 12 bytes of salt as the IV for AES-GCM wrapping
  const iv = salt.slice(0, 12);
  return crypto.subtle.wrapKey('pkcs8', privateKey, wrappingKey, { name: 'AES-GCM', iv });
}

/** Unwrap (decrypt) the private key from stored blob */
export async function unwrapPrivateKey(
  wrappedKey: ArrayBuffer,
  password: string,
  salt: ArrayBuffer
): Promise<CryptoKey> {
  const wrappingKey = await deriveWrappingKey(password, salt);
  const iv = salt.slice(0, 12);
  return crypto.subtle.unwrapKey(
    'pkcs8',
    wrappedKey,
    wrappingKey,
    { name: 'AES-GCM', iv },
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false, // NOT extractable — stays in memory only
    ['decrypt', 'unwrapKey']
  );
}

// ─── Message Encryption ─────────────────────────────────────

export interface EncryptedPayload {
  ciphertext: string;       // base64 AES-GCM ciphertext
  iv: string;               // base64 96-bit IV
  encryptedKey: string;     // base64 RSA-OAEP encrypted AES key (for recipient)
  encryptedKeyForSelf: string; // base64 RSA-OAEP encrypted AES key (for sender)
}

/** Encrypt a plaintext message for a recipient */
export async function encryptMessage(
  plaintext: string,
  recipientPublicKey: CryptoKey,
  senderPublicKey: CryptoKey
): Promise<EncryptedPayload> {
  const encoder = new TextEncoder();

  // 1. Generate random AES-GCM key
  const aesKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // extractable so we can wrap it
    ['encrypt', 'decrypt']
  );

  // 2. Generate 96-bit IV
  const iv = getRandomBytes(12);

  const ivBuffer = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
  const ivSafe = new Uint8Array(ivBuffer);

  // 3. Encrypt plaintext with AES-GCM
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivSafe },
    aesKey,
    encoder.encode(plaintext)
  );

  // 4. Export AES key as raw bytes
  const rawAesKey = await crypto.subtle.exportKey('raw', aesKey);

  // 5. Encrypt AES key with recipient's RSA public key
  const encryptedKey = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    recipientPublicKey,
    rawAesKey
  );

  // 6. Encrypt AES key with sender's own RSA public key
  const encryptedKeyForSelf = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    senderPublicKey,
    rawAesKey
  );

  return {
    ciphertext: toBase64(ciphertext),
    iv: toBase64(ivBuffer),
    encryptedKey: toBase64(encryptedKey),
    encryptedKeyForSelf: toBase64(encryptedKeyForSelf),
  };
}

/** Decrypt a received message */
export async function decryptMessage(
  payload: EncryptedPayload,
  privateKey: CryptoKey,
  isSender: boolean
): Promise<string> {
  const decoder = new TextDecoder();

  // 1. Decrypt the AES key
  const encKeyField = isSender ? payload.encryptedKeyForSelf : payload.encryptedKey;
  const rawAesKey = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    fromBase64(encKeyField)
  );

  // 2. Import AES key
  const aesKey = await crypto.subtle.importKey(
    'raw',
    rawAesKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  // 3. Decrypt ciphertext
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(payload.iv) },
    aesKey,
    fromBase64(payload.ciphertext)
  );

  return decoder.decode(plaintext);
}
