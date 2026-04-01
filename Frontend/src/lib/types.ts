export type ChatType = 'pm' | 'gm';

export interface User {
  id: string;
  username: string;
  publicKey: string;
}

export interface ChatMember {
  id: string;
  username: string;
  encryptedKey?: string;
  lastReadAt?: number;
}

export interface LastMessage {
  senderId: string | null;
  content: string;
  senderUsername?: string;
  isSystem: boolean;
}

export interface Message {
  id: string;
  chatId?: string;
  senderId: string | null;
  content: string;
  fileIds: string[];
  timestamp: number;
  editedAt: number | null;
  senderUsername?: string;
}

export interface Chat {
  id: string;
  type: ChatType;
  name: string | null;
  memberCount: number;
  createdBy?: string;
  createdAt?: number;
  members?: ChatMember[];
  messages?: Message[];
  lastMessage?: LastMessage | null;
  otherUser?: {
    id: string;
    username: string;
  } | null;
  unreadCount?: number;
  firstUnreadId?: string | null;
  unreadMarkerId?: string | null;
  chatKey?: CryptoKey | null;
  isHydrated?: boolean;
  hasReachedBeginning?: boolean;
  isLoadingMessages?: boolean;
  isLoadingOlderMessages?: boolean;
  typingUsers?: Array<{
    userId: string;
    expiresAt: number;
  }>;
}

export interface SearchUserResult {
  id: string;
  username: string;
  publicKey: string;
}

export interface ChatMessagesResponse {
  messages: Message[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  firstUnreadId: string | null;
  unreadCount: number;
}

export interface CreateChatRequest {
  type: ChatType;
  name?: string;
  members?: string[];
  encryptedKey: string;
  memberKeys?: Record<string, string>;
}

export interface MemberEventPayload {
  type: string;
  chatId: string;
  userId: string;
  memberCount: number;
  removed?: boolean;
  username?: string;
}
