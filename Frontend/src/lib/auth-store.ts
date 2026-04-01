import { writable } from 'svelte/store';
import { setToken } from './api';
import type { User } from './types';

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  privateKey: CryptoKey | null;
}

async function loadPrivateKeyFromSessionStorage(): Promise<CryptoKey | null> {
  const privateKeyBase64 = sessionStorage.getItem('privateKey');
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
      sessionStorage.setItem('username', user.username);
      sessionStorage.setItem('publicKey', user.publicKey);
      update((state) => ({ ...state, isAuthenticated: true, user, privateKey }));
    },
    setPrivateKey: (privateKey: CryptoKey) => {
      update((state) => ({ ...state, privateKey }));
    },
    updateUser: (updates: Partial<User>) => {
      if (updates.username) {
        sessionStorage.setItem('username', updates.username);
      }

      update((state) => ({
        ...state,
        user: state.user ? { ...state.user, ...updates } : null
      }));
    },
    logout: () => {
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('username');
      sessionStorage.removeItem('publicKey');
      sessionStorage.removeItem('privateKey');
      setToken(null);
      set({ isAuthenticated: false, isLoading: false, user: null, privateKey: null });
    },
    loadFromStorage: async () => {
      const username = sessionStorage.getItem('username');
      const publicKey = sessionStorage.getItem('publicKey');
      const token = sessionStorage.getItem('token');
      const privateKey = await loadPrivateKeyFromSessionStorage();

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
              user: { id: userData.id, username: userData.username, publicKey: userData.publicKey },
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
