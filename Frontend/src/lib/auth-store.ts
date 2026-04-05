import { writable } from 'svelte/store';
import { setToken } from './api';
import type { User } from './types';

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  privateKey: CryptoKey | null;
}

const STORAGE_PREFERENCE_KEY = 'logoutOnBrowserClose';

type AuthStoragePreference = 'session' | 'local';

function canUseWebStorage() {
  return typeof window !== 'undefined';
}

export function getLogoutOnBrowserClose() {
  if (!canUseWebStorage()) {
    return true;
  }

  const rawValue = localStorage.getItem(STORAGE_PREFERENCE_KEY);
  if (rawValue === null) {
    return true;
  }

  return rawValue !== 'false';
}

export function persistLogoutOnBrowserClose(value: boolean) {
  if (!canUseWebStorage()) {
    return;
  }

  localStorage.setItem(STORAGE_PREFERENCE_KEY, value ? 'true' : 'false');
}

export function getPreferredAuthStorage(): Storage | null {
  if (!canUseWebStorage()) {
    return null;
  }

  return getLogoutOnBrowserClose() ? sessionStorage : localStorage;
}

export function getAuthStoragePreference(): AuthStoragePreference {
  return getLogoutOnBrowserClose() ? 'session' : 'local';
}

function getAuthStoragesInReadOrder() {
  if (!canUseWebStorage()) {
    return [];
  }

  const preferredStorage = getPreferredAuthStorage();
  if (preferredStorage === sessionStorage) {
    return [sessionStorage, localStorage];
  }

  return [localStorage, sessionStorage];
}

function readAuthValue(key: string) {
  for (const storage of getAuthStoragesInReadOrder()) {
    const value = storage.getItem(key);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

export function getStoredAuthValue(key: string) {
  return readAuthValue(key);
}

function clearAuthStorage(storage: Storage) {
  storage.removeItem('token');
  storage.removeItem('username');
  storage.removeItem('publicKey');
  storage.removeItem('privateKey');
}

function writeAuthSnapshot(values: Record<string, string>) {
  const targetStorage = getPreferredAuthStorage();
  if (!targetStorage) {
    return;
  }

  const otherStorage = targetStorage === sessionStorage ? localStorage : sessionStorage;
  clearAuthStorage(otherStorage);

  for (const [key, value] of Object.entries(values)) {
    targetStorage.setItem(key, value);
  }
}

async function loadPrivateKeyFromStorage(): Promise<CryptoKey | null> {
  const privateKeyBase64 = readAuthValue('privateKey');
  if (!privateKeyBase64) return null;

  try {
    const keyBytes = Uint8Array.from(atob(privateKeyBase64), (char) => char.charCodeAt(0));
    return window.crypto.subtle.importKey(
      'pkcs8',
      keyBytes,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      true,
      ['decrypt']
    );
  } catch {
    return null;
  }
}

function createAuthStore() {
  const { subscribe, set, update } = writable<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    user: null,
    privateKey: null
  });

  return {
    subscribe,
    setUser: (user: User, privateKey: CryptoKey) => {
      const token = readAuthValue('token');
      const privateKeyBase64 = readAuthValue('privateKey');
      if (token && privateKeyBase64) {
        writeAuthSnapshot({
          token,
          username: user.username,
          publicKey: user.publicKey,
          privateKey: privateKeyBase64
        });
      } else {
        const targetStorage = getPreferredAuthStorage();
        targetStorage?.setItem('username', user.username);
        targetStorage?.setItem('publicKey', user.publicKey);
      }
      update((state) => ({ ...state, isAuthenticated: true, user, privateKey }));
    },
    setPrivateKey: (privateKey: CryptoKey) => {
      update((state) => ({ ...state, privateKey }));
    },
    updateUser: (updates: Partial<User>) => {
      if (updates.username) {
        const targetStorage = getPreferredAuthStorage();
        if (targetStorage) {
          targetStorage.setItem('username', updates.username);
        }
      }

      update((state) => ({
        ...state,
        user: state.user ? { ...state.user, ...updates } : null
      }));
    },
    persistAuthSession: (session: { token: string; username: string; publicKey: string; privateKeyBase64: string }) => {
      writeAuthSnapshot({
        token: session.token,
        username: session.username,
        publicKey: session.publicKey,
        privateKey: session.privateKeyBase64
      });
      setToken(session.token);
    },
    setLogoutOnBrowserClose: (value: boolean) => {
      persistLogoutOnBrowserClose(value);
      const token = readAuthValue('token');
      const username = readAuthValue('username');
      const publicKey = readAuthValue('publicKey');
      const privateKey = readAuthValue('privateKey');

      if (token && username && publicKey && privateKey) {
        writeAuthSnapshot({
          token,
          username,
          publicKey,
          privateKey
        });
      } else {
        const preferredStorage = getPreferredAuthStorage();
        const otherStorage = preferredStorage === sessionStorage ? localStorage : sessionStorage;
        clearAuthStorage(otherStorage);
      }
    },
    logout: () => {
      if (canUseWebStorage()) {
        clearAuthStorage(sessionStorage);
        clearAuthStorage(localStorage);
      }
      setToken(null);
      set({ isAuthenticated: false, isLoading: false, user: null, privateKey: null });
    },
    loadFromStorage: async () => {
      const username = readAuthValue('username');
      const publicKey = readAuthValue('publicKey');
      const token = readAuthValue('token');
      const privateKey = await loadPrivateKeyFromStorage();

      if (token) {
        setToken(token);
      }

      if (username && publicKey) {
        try {
          const response = await fetch('/api/users/me', {
            credentials: 'include'
          });

          if (response.ok) {
            const userData = await response.json();
            update((state) => ({
              ...state,
              isLoading: false,
              isAuthenticated: true,
              user: {
                id: userData.id,
                username: userData.username,
                publicKey: userData.publicKey,
                avatarUrl: userData.avatarUrl,
                avatarUpdatedAt: userData.avatarUpdatedAt,
                blockedUserIds: userData.blockedUserIds ?? []
              },
              privateKey
            }));
          } else {
            update((state) => ({
              ...state,
              isLoading: false,
              user: { id: '', username, publicKey }
            }));
          }
        } catch {
          update((state) => ({
            ...state,
            isLoading: false,
            user: { id: '', username, publicKey }
          }));
        }
      } else {
        update((state) => ({ ...state, isLoading: false }));
      }
    }
  };
}

export const auth = createAuthStore();
