const ALGORITHM_RSA = 'RSA-OAEP';
const ALGORITHM_AES = 'AES-GCM';
const KEY_LENGTH = 2048;
const AES_KEY_LENGTH = 256;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function concatIvAndCiphertext(iv: Uint8Array, encrypted: ArrayBuffer): Uint8Array {
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return combined;
}

export function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: ALGORITHM_AES, length: AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptPrivateKey(privateKey: CryptoKey, password: string, salt: Uint8Array): Promise<string> {
  const derivedKey = await deriveKey(password, salt);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  const exported = await window.crypto.subtle.exportKey('pkcs8', privateKey);
  
  const encrypted = await window.crypto.subtle.encrypt(
    { name: ALGORITHM_AES, iv },
    derivedKey,
    exported
  );

  return bytesToBase64(concatIvAndCiphertext(iv, encrypted));
}

export async function decryptPrivateKey(encryptedData: string, password: string, salt: Uint8Array): Promise<CryptoKey> {
  const derivedKey = await deriveKey(password, salt);
  const combined = base64ToBytes(encryptedData);
  
  const iv = combined.slice(0, 12);
  const encrypted = combined.slice(12);

  const decrypted = await window.crypto.subtle.decrypt(
    { name: ALGORITHM_AES, iv },
    derivedKey,
    encrypted
  );

  return window.crypto.subtle.importKey(
    'pkcs8',
    decrypted,
    { name: ALGORITHM_RSA, hash: 'SHA-256' },
    true,
    ['decrypt']
  );
}

export async function generateKeyPair(): Promise<{ publicKey: CryptoKey; privateKey: CryptoKey }> {
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: ALGORITHM_RSA,
      modulusLength: KEY_LENGTH,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256'
    },
    true,
    ['encrypt', 'decrypt']
  );

  return { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey };
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey('spki', key);
  return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

export async function importPublicKey(keyData: string): Promise<CryptoKey> {
  const keyBytes = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
  return window.crypto.subtle.importKey(
    'spki',
    keyBytes,
    { name: ALGORITHM_RSA, hash: 'SHA-256' },
    false,
    ['encrypt']
  );
}

export async function encryptWithPublicKey(publicKey: CryptoKey, data: Uint8Array): Promise<string> {
  const encrypted = await window.crypto.subtle.encrypt(
    { name: ALGORITHM_RSA },
    publicKey,
    toArrayBuffer(data)
  );
  return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
}

export async function decryptWithPrivateKey(privateKey: CryptoKey, encryptedData: string): Promise<Uint8Array> {
  const encrypted = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
  const decrypted = await window.crypto.subtle.decrypt(
    { name: ALGORITHM_RSA },
    privateKey,
    encrypted
  );
  return new Uint8Array(decrypted);
}

export async function generateChatKey(): Promise<CryptoKey> {
  return window.crypto.subtle.generateKey(
    { name: ALGORITHM_AES, length: AES_KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );
}

export async function exportChatKey(key: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey('raw', key);
  return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

export async function importChatKey(keyData: string): Promise<CryptoKey> {
  const keyBytes = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
  return window.crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: ALGORITHM_AES, length: AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

function padWithSalt(message: string): string {
  const messageWithNull = message + '\0';
  const currentLength = messageWithNull.length;
  const targetLength = Math.ceil(currentLength / 64) * 64;
  const paddingLength = targetLength - currentLength;
  
  const randomBytes = window.crypto.getRandomValues(new Uint8Array(paddingLength));
  const padding = btoa(String.fromCharCode(...randomBytes));
  
  return padding + '\0' + message;
}

function extractMessage(decrypted: Uint8Array): string {
  const decoder = new TextDecoder();
  const decryptedStr = decoder.decode(decrypted);
  const nullIndex = decryptedStr.indexOf('\0');
  
  if (nullIndex === -1) {
    return decryptedStr;
  }
  
  return decryptedStr.substring(nullIndex + 1);
}

export async function encryptMessage(chatKey: CryptoKey, message: string): Promise<string> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  const paddedMessage = padWithSalt(message);
  const encoder = new TextEncoder();
  
  const encrypted = await window.crypto.subtle.encrypt(
    { name: ALGORITHM_AES, iv },
    chatKey,
    encoder.encode(paddedMessage)
  );

  return bytesToBase64(concatIvAndCiphertext(iv, encrypted));
}

export async function decryptMessage(chatKey: CryptoKey, encryptedData: string): Promise<string> {
  const combined = base64ToBytes(encryptedData);
  const iv = combined.slice(0, 12);
  const encrypted = combined.slice(12);

  const decrypted = await window.crypto.subtle.decrypt(
    { name: ALGORITHM_AES, iv },
    chatKey,
    encrypted
  );

  return extractMessage(new Uint8Array(decrypted));
}

export async function encryptBinary(chatKey: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt(
    { name: ALGORITHM_AES, iv },
    chatKey,
    toArrayBuffer(data)
  );

  return concatIvAndCiphertext(iv, encrypted);
}

export async function decryptBinary(chatKey: CryptoKey, encryptedData: Uint8Array): Promise<Uint8Array> {
  const iv = encryptedData.slice(0, 12);
  const encrypted = encryptedData.slice(12);

  const decrypted = await window.crypto.subtle.decrypt(
    { name: ALGORITHM_AES, iv },
    chatKey,
    encrypted
  );

  return new Uint8Array(decrypted);
}

export async function encryptChatKeyWithPublicKey(chatKey: CryptoKey, publicKey: CryptoKey): Promise<string> {
  const exportedKey = await window.crypto.subtle.exportKey('raw', chatKey);
  const keyBytes = new Uint8Array(exportedKey);
  return encryptWithPublicKey(publicKey, keyBytes);
}

export async function decryptChatKeyWithPrivateKey(encryptedKey: string, privateKey: CryptoKey): Promise<CryptoKey> {
  const keyBytes = await decryptWithPrivateKey(privateKey, encryptedKey);
  return window.crypto.subtle.importKey(
    'raw',
    toArrayBuffer(keyBytes),
    { name: ALGORITHM_AES, length: AES_KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );
}
