import type {
  Chat,
  ChatMessagesResponse,
  ChatFileRecord,
  CreateChatRequest,
  Message,
  PinnedMessage,
  SearchUserResult
} from './types';

const API_BASE = '/api';

let authToken: string | null = null;

export function setToken(token: string | null) {
  authToken = token;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      ...options.headers
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }

  return response.json();
}

async function rawRequest(
  path: string,
  options: RequestInit & { contentType?: string; acceptJson?: boolean } = {}
): Promise<Response> {
  const { contentType, acceptJson = false, ...fetchOptions } = options;
  const response = await fetch(`${API_BASE}${path}`, {
    ...fetchOptions,
    headers: {
      ...(contentType ? { 'Content-Type': contentType } : {}),
      ...(acceptJson ? { Accept: 'application/json' } : {}),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...fetchOptions.headers
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }

  return response;
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
  token: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  id: string;
  username: string;
  salt: string;
  publicKey: string;
  avatarUpdatedAt?: number | null;
  avatarUrl?: string | null;
  token: string;
}

export interface UserResponse {
  id: string;
  username: string;
  publicKey: string;
  avatarUpdatedAt?: number | null;
  avatarUrl?: string | null;
  createdAt: string;
}

export interface UserFilesResponse {
  quotaBytes: number;
  usedBytes: number;
  files: Array<ChatFileRecord & { isAvatar?: boolean }>;
}

export interface DownloadedChatFileBase {
  size: number;
  updatedAt: number;
  createdAt: number;
  deletedAt: number | null;
}

export interface DownloadedChatFileMetadata extends DownloadedChatFileBase {
  fileId?: string;
  metadataBase64: string;
}

export interface DownloadedChatFileContent extends DownloadedChatFileBase {
  content: Uint8Array;
}

export const api = {
  auth: {
    register: (data: RegisterRequest) => 
      request<RegisterResponse>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
    
    login: (data: LoginRequest) => 
      request<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
    
    logout: () => 
      request<{ message: string }>('/auth/logout', { method: 'POST' }),
    
    changePassword: (newPassword: string) => 
      request<{ salt: string }>('/auth/change-password', { method: 'POST', body: JSON.stringify({ newPassword }) })
  },

  users: {
    me: () => request<UserResponse>('/users/me'),
    
    update: (data: { username: string }) => 
      request<UserResponse>('/users/me', { method: 'PATCH', body: JSON.stringify(data) }),

    deleteMe: () =>
      request<{ success: boolean }>('/users/me', { method: 'DELETE' }),

    uploadAvatar: async (avatar: Blob) => {
      const response = await fetch(`${API_BASE}/users/me/avatar`, {
        method: 'POST',
        headers: {
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          'Content-Type': avatar.type
        },
        body: avatar
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || 'Request failed');
      }

      return response.json() as Promise<{ avatarUpdatedAt: number; avatarUrl: string }>;
    },

    deleteAvatar: () =>
      request<{ success: boolean }>('/users/me/avatar', { method: 'DELETE' }),
    
    search: (query: string) => 
      request<SearchUserResult[]>('/users/search?q=' + encodeURIComponent(query))
  },

  chats: {
    list: () => request<Chat[]>('/chats'),
    
    create: (data: CreateChatRequest) => 
      request<Chat>('/chats', { method: 'POST', body: JSON.stringify(data) }),
    
    get: (chatId: string) => request<Chat>(`/chats/${chatId}`),

    update: (chatId: string, data: { name: string; nameLength: number }) =>
      request<Chat>(`/chats/${chatId}`, { method: 'PATCH', body: JSON.stringify(data) }),

    updateAvatar: (chatId: string, fileId: string | null) =>
      request<Chat>(`/chats/${chatId}/avatar`, { method: 'PUT', body: JSON.stringify({ fileId }) }),
    
    delete: (chatId: string) => 
      request<{ message: string }>(`/chats/${chatId}`, { method: 'DELETE' }),
    
    leave: (chatId: string, options?: { deleteMessages?: boolean; deleteFiles?: boolean }) => 
      request<{ message: string }>(`/chats/${chatId}/leave`, { method: 'POST', body: JSON.stringify(options ?? {}) }),
    
    addMember: (chatId: string, userId: string, encryptedKey: string) => 
      request<{ message: string }>(`/chats/${chatId}/members/add`, { 
        method: 'POST', 
        body: JSON.stringify({ userId, encryptedKey }) 
      }),
    
    removeMember: (chatId: string, userId: string, options?: { deleteMessages?: boolean; deleteFiles?: boolean }) => 
      request<{ message: string }>(`/chats/${chatId}/members/remove`, { 
        method: 'POST', 
        body: JSON.stringify({ userId, ...(options ?? {}) }) 
      }),
    
    getMessages: (chatId: string, options: { limit?: number; cursor?: string; beforeCnt?: number; afterCnt?: number } = {}) => {
      const params = new URLSearchParams();
      if (options.limit) params.set('limit', String(options.limit));
      if (options.cursor) params.set('cursor', options.cursor);
      if (options.beforeCnt) params.set('beforeCnt', String(options.beforeCnt));
      if (options.afterCnt) params.set('afterCnt', String(options.afterCnt));
      const url = `/chats/${chatId}/messages?${params.toString()}`;
      return request<ChatMessagesResponse>(url);
    },
    
    markAsRead: (chatId: string) =>
      request<{ success: boolean; lastReadAt: number }>(`/chats/${chatId}/read`, { method: 'PATCH' }),

    sendTyping: (chatId: string) =>
      request<{ success: boolean }>(`/chats/${chatId}/typing`, { method: 'POST' }),
    
    getPins: (chatId: string) => request<PinnedMessage[]>(`/chats/${chatId}/pins`),

    pinMessage: (chatId: string, messageId: string) =>
      request<PinnedMessage[]>(`/chats/${chatId}/pins`, {
        method: 'POST',
        body: JSON.stringify({ messageId })
      }),

    unpinMessage: (chatId: string, messageId: string) =>
      request<PinnedMessage[]>(`/chats/${chatId}/pins/${messageId}`, {
        method: 'DELETE'
      }),

    sendMessage: (chatId: string, content: string, contentLength?: number, fileIds?: string[], replyToMessageId?: string | null) => 
      request<Message>(`/chats/${chatId}/messages`, { 
        method: 'POST', 
        body: JSON.stringify({ content, contentLength, fileIds, replyToMessageId }) 
      })
  },

  messages: {
    edit: (messageId: string, content: string, contentLength?: number, fileIds?: string[], replyToMessageId?: string | null) => 
      request<Message>(`/messages/${messageId}`, { 
        method: 'PUT', 
        body: JSON.stringify({ content, contentLength, fileIds, replyToMessageId }) 
      }),
    
    delete: (messageId: string) => 
      request<{ message: string; deletedFileIds?: string[]; pinnedMessages?: PinnedMessage[] }>(`/messages/${messageId}`, { method: 'DELETE' })
  },

  files: {
    listMine: () => request<UserFilesResponse>('/files/me'),

    uploadChatFile: async (chatId: string, content: Uint8Array, metadataBase64: string) => {
      const bodyBytes = Uint8Array.from(content);
      const response = await rawRequest(`/files/${chatId}/files`, {
        method: 'POST',
        contentType: 'application/octet-stream',
        headers: {
          'x-file-metadata': metadataBase64
        },
        body: new Blob([bodyBytes.buffer], { type: 'application/octet-stream' })
      });

      return response.json() as Promise<{
        file: ChatFileRecord;
        quotaBytes: number;
        usedBytes: number;
      }>;
    },

    deleteChatFile: (chatId: string, fileId: string) =>
      request<{ success: boolean; fileId: string; quotaBytes: number; usedBytes: number }>(
        `/files/${chatId}/files/${fileId}`,
        { method: 'DELETE' }
      ),

    replaceMineWithPlaceholder: async (fileId: string, content: Uint8Array, metadataBase64: string) => {
      const response = await rawRequest(`/files/me/${fileId}/placeholder`, {
        method: 'PUT',
        contentType: 'application/octet-stream',
        headers: {
          'x-file-metadata': metadataBase64
        },
        body: new Blob([Uint8Array.from(content).buffer], { type: 'application/octet-stream' })
      });

      return response.json() as Promise<{
        file: ChatFileRecord;
        quotaBytes: number;
        usedBytes: number;
      }>;
    },

    downloadChatFileMetadata: async (chatId: string, fileId: string): Promise<DownloadedChatFileMetadata> => {
      const response = await request<{
        fileId: string;
        metadata: string;
        size: number;
        updatedAt: number;
        createdAt: number;
        deletedAt: number | null;
      }>(`/files/${chatId}/files/${fileId}/metadata`);

      return {
        fileId: response.fileId,
        metadataBase64: response.metadata,
        size: response.size,
        updatedAt: response.updatedAt,
        createdAt: response.createdAt,
        deletedAt: response.deletedAt
      };
    },

    downloadChatFilesMetadata: async (chatId: string): Promise<DownloadedChatFileMetadata[]> => {
      const response = await request<
        Array<{
          fileId: string;
          metadata: string;
          size: number;
          updatedAt: number;
          createdAt: number;
          deletedAt: number | null;
        }>
      >(`/files/${chatId}/files/metadata`);

      return response.map((item) => ({
        fileId: item.fileId,
        metadataBase64: item.metadata,
        size: item.size,
        updatedAt: item.updatedAt,
        createdAt: item.createdAt,
        deletedAt: item.deletedAt
      }));
    },

    downloadChatFileContent: async (chatId: string, fileId: string): Promise<DownloadedChatFileContent> => {
      const response = await rawRequest(`/files/${chatId}/files/${fileId}`, {
        method: 'GET'
      });

      const size = Number(response.headers.get('x-file-size') ?? '0');
      const updatedAt = Number(response.headers.get('x-file-updated-at') ?? '0');
      const createdAt = Number(response.headers.get('x-file-created-at') ?? '0');
      const deletedAtHeader = response.headers.get('x-file-deleted-at');
      const content = new Uint8Array(await response.arrayBuffer());

      return {
        content,
        size,
        updatedAt,
        createdAt,
        deletedAt: deletedAtHeader ? Number(deletedAtHeader) : null
      };
    }
  }
};
