const API_BASE = '/api';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    credentials: 'include'
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }

  return response.json();
}

export interface RegisterRequest {
  username: string;
  password: string;
  publicKey: string;
}

export interface RegisterResponse {
  id: string;
  username: string;
  salt: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  id: string;
  username: string;
  salt: string;
}

export interface UserResponse {
  id: string;
  username: string;
  publicKey: string;
  createdAt: string;
}

export interface Chat {
  id: string;
  type: 'pm' | 'gm';
  name: string | null;
  memberCount: number;
}

export interface ChatDetail {
  id: string;
  type: 'pm' | 'gm';
  name: string | null;
  createdBy: string;
  createdAt: string;
  members: {
    id: string;
    username: string;
    encryptedKey: string;
  }[];
}

export interface Message {
  id: string;
  senderId: string;
  content: string;
  fileIds: string[];
  timestamp: string;
  editedAt: string | null;
}

export const api = {
  auth: {
    register: (data: RegisterRequest) => 
      request<RegisterResponse>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
    
    login: (data: LoginRequest) => 
      request<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
    
    logout: () => 
      request<{ message: string }>('/auth/logout', { method: 'POST' })
  },

  users: {
    me: () => request<UserResponse>('/users/me'),
    
    update: (data: { publicKey?: string }) => 
      request<UserResponse>('/users/me', { method: 'PUT', body: JSON.stringify(data) }),
    
    search: (query: string) => 
      request<{ id: string; username: string; publicKey: string }[]>('/users/search?q=' + encodeURIComponent(query))
  },

  chats: {
    list: () => request<Chat[]>('/chats'),
    
    create: (data: { type: 'pm' | 'gm'; name?: string; members?: string[]; encryptedKey: string }) => 
      request<{ id: string }>('/chats', { method: 'POST', body: JSON.stringify(data) }),
    
    get: (chatId: string) => request<ChatDetail>(`/chats/${chatId}`),
    
    delete: (chatId: string) => 
      request<{ message: string }>(`/chats/${chatId}`, { method: 'DELETE' }),
    
    addMember: (chatId: string, userId: string, encryptedKey: string) => 
      request<{ message: string }>(`/chats/${chatId}/members/add`, { 
        method: 'POST', 
        body: JSON.stringify({ userId, encryptedKey }) 
      }),
    
    removeMember: (chatId: string, userId: string) => 
      request<{ message: string }>(`/chats/${chatId}/members/remove`, { 
        method: 'POST', 
        body: JSON.stringify({ userId }) 
      }),
    
    getMessages: (chatId: string, cursor?: string) => {
      const url = cursor 
        ? `/chats/${chatId}/messages?cursor=${encodeURIComponent(cursor)}&limit=50`
        : `/chats/${chatId}/messages?limit=50`;
      return request<{ messages: Message[]; nextCursor: string | null }>(url);
    },
    
    sendMessage: (chatId: string, content: string, fileIds?: string[]) => 
      request<Message>(`/chats/${chatId}/messages`, { 
        method: 'POST', 
        body: JSON.stringify({ content, fileIds }) 
      })
  },

  messages: {
    edit: (messageId: string, content: string, fileIds?: string[]) => 
      request<Message>(`/messages/${messageId}`, { 
        method: 'PUT', 
        body: JSON.stringify({ content, fileIds }) 
      }),
    
    delete: (messageId: string) => 
      request<{ message: string }>(`/messages/${messageId}`, { method: 'DELETE' })
  }
};