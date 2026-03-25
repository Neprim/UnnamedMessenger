import { writable } from 'svelte/store';

export interface User {
  id: string;
  username: string;
  publicKey: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  privateKey: CryptoKey | null;
}

async function loadPrivateKeyFromStorage(): Promise<CryptoKey | null> {
  const privateKeyBase64 = localStorage.getItem('privateKey');
  if (!privateKeyBase64) return null;

  try {
    const keyBytes = Uint8Array.from(atob(privateKeyBase64), c => c.charCodeAt(0));
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
      localStorage.setItem('username', user.username);
      localStorage.setItem('publicKey', user.publicKey);
      update(state => ({ ...state, isAuthenticated: true, user, privateKey }));
    },
    setPrivateKey: (privateKey: CryptoKey) => {
      update(state => ({ ...state, privateKey }));
    },
    logout: () => {
      localStorage.removeItem('username');
      localStorage.removeItem('privateKey');
      set({ isAuthenticated: false, user: null, privateKey: null });
    },
    loadFromStorage: async () => {
      const username = localStorage.getItem('username');
      const publicKey = localStorage.getItem('publicKey');
      const privateKey = await loadPrivateKeyFromStorage();
      
      if (username && publicKey) {
        try {
          const response = await fetch('/api/users/me', {
            credentials: 'include'
          });
          if (response.ok) {
            const userData = await response.json();
            update(state => ({
              ...state,
              isLoading: false,
              isAuthenticated: true,
              user: { id: userData.id, username: userData.username, publicKey: userData.publicKey },
              privateKey
            }));
          } else {
            update(state => ({
              ...state,
              isLoading: false,
              user: { id: '', username, publicKey }
            }));
          }
        } catch {
          update(state => ({
            ...state,
            isLoading: false,
            user: { id: '', username, publicKey }
          }));
        }
      } else {
        update(state => ({ ...state, isLoading: false }));
      }
    }
  };
}

export const auth = createAuthStore();

export interface Chat {
  id: string;
  type: 'pm' | 'gm';
  name: string | null;
  memberCount: number;
  chatKey?: CryptoKey;
}

function createChatsStore() {
  const { subscribe, set, update } = writable<Chat[]>([]);

  return {
    subscribe,
    set,
    addChat: (chat: Chat) => update(chats => [...chats, chat]),
    setChatKey: (chatId: string, chatKey: CryptoKey) => {
      update(chats => chats.map(c => c.id === chatId ? { ...c, chatKey } : c));
    }
  };
}

export const chats = createChatsStore();