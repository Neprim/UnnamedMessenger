import * as crypto from './crypto';
import type { Chat, ChatMember, LastMessage, Message } from './types';

type SystemMessagePayload = {
  event?: string;
  username?: string;
  raw?: string;
};

export function isSystemMessage(message: Pick<Message, 'senderId'>): boolean {
  return message.senderId === null || message.senderId === undefined;
}

export function parseSystemMessage(content: string): SystemMessagePayload {
  try {
    return JSON.parse(content) as SystemMessagePayload;
  } catch {
    return { raw: content };
  }
}

export function getSystemMessageContent(payload: SystemMessagePayload): string {
  if (payload.event === 'chat_created') return 'Чат создан';
  if (payload.event === 'member_added') return `${payload.username ?? 'Пользователь'} добавлен в чат`;
  if (payload.event === 'member_removed') return `${payload.username ?? 'Пользователь'} удалён из чата`;
  if (payload.event === 'member_left') return `${payload.username ?? 'Пользователь'} покинул чат`;
  return payload.raw ?? '';
}

export function getMemberMap(members: ChatMember[] = []): Map<string, string> {
  return new Map(members.map((member) => [member.id, member.username]));
}

export function getOtherUser(chat: Pick<Chat, 'type' | 'members'>, currentUserId?: string): { id: string; username: string } | null {
  if (chat.type !== 'pm' || !chat.members) {
    return null;
  }

  const otherMember = chat.members.find((member) => member.id !== currentUserId);
  return otherMember ? { id: otherMember.id, username: otherMember.username } : null;
}

export function isPersonalChatWithUser(chat: Chat, userId: string): boolean {
  return chat.type === 'pm' && Boolean(chat.members?.some((member) => member.id === userId));
}

export async function decryptMessageForDisplay(
  message: Message,
  chatKey: CryptoKey | null,
  memberMap: Map<string, string>
): Promise<Message> {
  if (isSystemMessage(message) || !chatKey) {
    return {
      ...message,
      senderUsername: message.senderId ? memberMap.get(message.senderId) ?? 'Unknown' : message.senderUsername
    };
  }

  const senderUsername = memberMap.get(message.senderId ?? '') ?? 'Unknown';

  try {
    const content = await crypto.decryptMessage(chatKey, message.content);
    return { ...message, content, senderUsername };
  } catch {
    return { ...message, content: '[Decryption failed]', senderUsername };
  }
}

export async function decryptMessagesForDisplay(
  messages: Message[],
  chatKey: CryptoKey | null,
  members: ChatMember[] = []
): Promise<Message[]> {
  const memberMap = getMemberMap(members);
  return Promise.all(messages.map((message) => decryptMessageForDisplay(message, chatKey, memberMap)));
}

export function buildLastMessage(messages: Message[], members: ChatMember[] = []): LastMessage | null {
  const lastMessage = messages[messages.length - 1];

  if (!lastMessage) {
    return null;
  }

  if (isSystemMessage(lastMessage)) {
    return {
      senderId: null,
      content: getSystemMessageContent(parseSystemMessage(lastMessage.content)),
      isSystem: true
    };
  }

  const sender = members.find((member) => member.id === lastMessage.senderId);

  return {
    senderId: lastMessage.senderId,
    content: lastMessage.content,
    senderUsername: lastMessage.senderUsername ?? sender?.username ?? 'Unknown',
    isSystem: false
  };
}
