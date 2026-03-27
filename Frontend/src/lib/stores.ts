import { writable } from 'svelte/store';
import { setToken } from './api';

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

async function loadPrivateKeyFromSessionStorage(): Promise<CryptoKey | null> {
  const privateKeyBase64 = sessionStorage.getItem('privateKey');
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
      sessionStorage.setItem('username', user.username);
      sessionStorage.setItem('publicKey', user.publicKey);
      update(state => ({ ...state, isAuthenticated: true, user, privateKey }));
    },
    setPrivateKey: (privateKey: CryptoKey) => {
      update(state => ({ ...state, privateKey }));
    },
    updateUser: (updates: Partial<User>) => {
      sessionStorage.setItem('username', updates.username || '');
      update(state => ({
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
      set({ isAuthenticated: false, user: null, privateKey: null });
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
  members?: string[];
  lastMessage?: {
    senderId: string | null;
    content: string;
    senderUsername?: string;
    isSystem: boolean;
  } | null;
  otherUser?: {
    id: string;
    username: string;
  } | null;
}

function createChatsStore() {
  const { subscribe, set, update } = writable<Chat[]>([]);

  return {
    subscribe,
    set,
    addChat: (chat: Chat) => update(chats => [...chats, chat]),
    removeChat: (chatId: string) => update(chats => chats.filter(c => c.id !== chatId)),
    updateChat: (chatId: string, updates: Partial<Chat>) => {
      update(chats => chats.map(c => c.id === chatId ? { ...c, ...updates } : c));
    },
    updateMemberCount: (chatId: string, count: number) => {
      update(chats => chats.map(c => c.id === chatId ? { ...c, memberCount: count } : c));
    },
    setChatKey: (chatId: string, chatKey: CryptoKey) => {
      update(chats => chats.map(c => c.id === chatId ? { ...c, chatKey } : c));
    }
  };
}

export const chats = createChatsStore();