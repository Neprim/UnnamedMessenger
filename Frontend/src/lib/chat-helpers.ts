import * as crypto from './crypto';
import type { Chat, ChatFileMetadata, ChatMember, LastMessage, Message } from './types';

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

export function getOtherUser(
  chat: Pick<Chat, 'type' | 'members'>,
  currentUserId?: string
): { id: string; username: string; avatarUrl?: string | null } | null {
  if (chat.type !== 'pm' || !chat.members) {
    return null;
  }

  const otherMember = chat.members.find((member) => member.id !== currentUserId);
  return otherMember ? { id: otherMember.id, username: otherMember.username, avatarUrl: otherMember.avatarUrl } : null;
}

export function isPersonalChatWithUser(chat: Chat, userId: string): boolean {
  return chat.type === 'pm' && Boolean(chat.members?.some((member) => member.id === userId));
}

export async function decryptChatName(
  chat: Pick<Chat, 'type' | 'name'>,
  chatKey: CryptoKey | null
): Promise<string | null> {
  if (chat.type !== 'gm' || !chat.name) {
    return chat.name ?? null;
  }

  if (!chatKey) {
    return chat.name;
  }

  try {
    return await crypto.decryptMessage(chatKey, chat.name);
  } catch {
    return chat.name;
  }
}

export async function decryptMessageForDisplay(
  message: Message,
  chatKey: CryptoKey | null,
  memberMap: Map<string, string>
): Promise<Message> {
  const isLikelyEncryptedPayload = (value: string) => {
    if (!value || typeof value !== 'string') {
      return false;
    }

    try {
      return crypto.base64ToBytes(value).length > 12;
    } catch {
      return false;
    }
  };

  const decryptReply = async () => {
    if (!message.reply) {
      return null;
    }

    if (message.reply.isDeleted || !chatKey || !message.reply.content) {
      return {
        ...message.reply,
        senderUsername: message.reply.senderUsername || memberMap.get(message.reply.senderId ?? '') || 'Unknown'
      };
    }

    try {
      return {
        ...message.reply,
        senderUsername: message.reply.senderUsername || memberMap.get(message.reply.senderId ?? '') || 'Unknown',
        content: await crypto.decryptMessage(chatKey, message.reply.content)
      };
    } catch {
      return {
        ...message.reply,
        senderUsername: message.reply.senderUsername || memberMap.get(message.reply.senderId ?? '') || 'Unknown',
        content: isLikelyEncryptedPayload(message.reply.content) ? '[Decryption failed]' : message.reply.content
      };
    }
  };

  if (isSystemMessage(message) || !chatKey) {
    return {
      ...message,
      content: message.content ?? '',
      reply: await decryptReply(),
      fileIds: message.fileIds ?? [],
      senderUsername: message.senderId ? memberMap.get(message.senderId) ?? 'Unknown' : message.senderUsername
    };
  }

  if (!message.content) {
    return {
      ...message,
      content: '',
      reply: await decryptReply(),
      fileIds: message.fileIds ?? [],
      senderUsername: message.senderId ? memberMap.get(message.senderId) ?? 'Unknown' : message.senderUsername
    };
  }

  const senderUsername = memberMap.get(message.senderId ?? '') ?? 'Unknown';

  try {
    const content = await crypto.decryptMessage(chatKey, message.content);
    return { ...message, content, reply: await decryptReply(), senderUsername };
  } catch {
    return {
      ...message,
      content: isLikelyEncryptedPayload(message.content) ? '[Decryption failed]' : message.content,
      reply: await decryptReply(),
      senderUsername
    };
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
    isSystem: false,
    hasAttachments: Array.isArray(lastMessage.fileIds) && lastMessage.fileIds.length > 0
  };
}

export function formatAttachmentNamesPreview(names: string[]): string {
  return names
    .map((name) => name.trim())
    .filter(Boolean)
    .join(', ');
}

export function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size < 0) {
    return 'Unknown size';
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function parseFileMetadataJson(content: string): ChatFileMetadata | null {
  try {
    const parsed = JSON.parse(content) as Partial<ChatFileMetadata>;
    if (
      typeof parsed.name !== 'string' ||
      typeof parsed.type !== 'string' ||
      typeof parsed.size !== 'number'
    ) {
      return null;
    }

    return {
      name: parsed.name,
      type: parsed.type,
      size: parsed.size,
      width: typeof parsed.width === 'number' ? parsed.width : undefined,
      height: typeof parsed.height === 'number' ? parsed.height : undefined,
      duration: typeof parsed.duration === 'number' ? parsed.duration : undefined,
      previewDataUrl: typeof parsed.previewDataUrl === 'string' ? parsed.previewDataUrl : undefined
    };
  } catch {
    return null;
  }
}
