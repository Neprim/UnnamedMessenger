import { get, writable } from 'svelte/store';
import { api } from './api';
import { auth } from './auth-store';
import * as crypto from './crypto';
import {
  buildLastMessage,
  decryptMessageForDisplay,
  decryptMessagesForDisplay,
  getOtherUser,
  isSystemMessage,
  parseSystemMessage
} from './chat-helpers';
import type { Chat, ChatMessagesResponse, CreateChatRequest, MemberEventPayload, Message } from './types';

const INITIAL_CHAT_MESSAGES_LIMIT = 20;
const SIDEBAR_PREVIEW_MESSAGES_LIMIT = 10;
const TYPING_TTL_MS = 5000;

function createChatsStore() {
  const { subscribe, set, update } = writable<Chat[]>([]);

  const getAll = () => get({ subscribe });
  const findChat = (chatId: string) => getAll().find((chat) => chat.id === chatId) ?? null;

  const updateChatById = (chatId: string, updates: Partial<Chat>) => {
    update((chatList) => chatList.map((chat) => (chat.id === chatId ? { ...chat, ...updates } : chat)));
  };

  const clearUnreadMarkerIfResolved = (chatId: string) => {
    update((chatList) =>
      chatList.map((chat) => {
        if (chat.id !== chatId) return chat;
        if ((chat.unreadCount ?? 0) > 0) return chat;
        if (!chat.unreadMarkerId) return chat;

        return {
          ...chat,
          unreadMarkerId: null
        };
      })
    );
  };

  const cleanupExpiredTypingUsers = () => {
    const now = Date.now();
    update((chatList) =>
      chatList.map((chat) => {
        if (!chat.typingUsers?.length) return chat;

        const typingUsers = chat.typingUsers.filter((entry) => entry.expiresAt > now);
        if (typingUsers.length === chat.typingUsers.length) {
          return chat;
        }

        return {
          ...chat,
          typingUsers
        };
      })
    );
  };

  if (typeof window !== 'undefined') {
    window.setInterval(cleanupExpiredTypingUsers, 1000);
  }

  const upsertChat = (nextChat: Chat) => {
    update((chatList) => {
      const existingIndex = chatList.findIndex((chat) => chat.id === nextChat.id);
      if (existingIndex === -1) {
        return [...chatList, nextChat];
      }

      return chatList.map((chat) => (chat.id === nextChat.id ? { ...chat, ...nextChat } : chat));
    });
  };

  const removeChat = (chatId: string) => {
    update((chatList) => chatList.filter((chat) => chat.id !== chatId));
  };

  const replaceMessages = (chatId: string, messages: Message[]) => {
    updateChatById(chatId, {
      messages,
      lastMessage: buildLastMessage(messages, findChat(chatId)?.members ?? [])
    });
  };

  const mergeMessages = (chatId: string, newMessages: Message[], prepend = false) => {
    update((chatList) =>
      chatList.map((chat) => {
        if (chat.id !== chatId) return chat;

        const existingMessages = chat.messages ?? [];
        const existingIds = new Set(existingMessages.map((message) => message.id));
        const uniqueNewMessages = newMessages.filter((message) => !existingIds.has(message.id));

        if (uniqueNewMessages.length === 0) return chat;

        const messages = prepend ? [...uniqueNewMessages, ...existingMessages] : [...existingMessages, ...uniqueNewMessages];
        return {
          ...chat,
          messages,
          lastMessage: buildLastMessage(messages, chat.members ?? [])
        };
      })
    );
  };

  const getRequiredAuth = () => {
    const authState = get(auth);
    if (!authState.user) {
      throw new Error('User is not authenticated');
    }

    return authState;
  };

  const resolveChatKey = async (chatDetail: Chat, existingChatKey?: CryptoKey | null) => {
    if (existingChatKey) {
      return existingChatKey;
    }

    const authState = getRequiredAuth();
    const currentMember = chatDetail.members?.find((member) => member.id === authState.user?.id);

    if (!currentMember?.encryptedKey || !authState.privateKey) {
      return null;
    }

    try {
      return await crypto.decryptChatKeyWithPrivateKey(currentMember.encryptedKey, authState.privateKey);
    } catch {
      return null;
    }
  };

  const hydrateChat = async (
    chatDetail: Chat,
    unreadCount = 0,
    memberCount = chatDetail.memberCount ?? chatDetail.members?.length ?? 0
  ): Promise<Chat> => {
    const authState = getRequiredAuth();
    const members = chatDetail.members ?? [];
    const currentChat = findChat(chatDetail.id);
    const chatKey = await resolveChatKey(chatDetail, currentChat?.chatKey ?? null);

    let messages: Message[] = currentChat?.messages ?? [];
    if (chatKey) {
      try {
        const messagesResult = await api.chats.getMessages(chatDetail.id, { limit: SIDEBAR_PREVIEW_MESSAGES_LIMIT });
        messages = await decryptMessagesForDisplay(messagesResult.messages, chatKey, members);
      } catch {
        messages = currentChat?.messages ?? [];
      }
    }

    const oldestMessage = messages[0];
    const hasReachedBeginning = Boolean(
      oldestMessage && isSystemMessage(oldestMessage) && parseSystemMessage(oldestMessage.content).event === 'chat_created'
    );

    return {
      ...currentChat,
      ...chatDetail,
      memberCount,
      members,
      unreadCount,
      otherUser: getOtherUser(chatDetail, authState.user?.id),
      lastMessage: buildLastMessage(messages, members),
      messages,
      chatKey,
      isHydrated: false,
      hasReachedBeginning,
      typingUsers: currentChat?.typingUsers ?? []
    };
  };

  const ensureChatLoaded = async (chatId: string, options: { force?: boolean; limit?: number } = {}) => {
    const { force = false, limit = INITIAL_CHAT_MESSAGES_LIMIT } = options;
    const authState = getRequiredAuth();
    const existingChat = findChat(chatId);

    if (!force && existingChat?.isHydrated && (existingChat.messages?.length ?? 0) > 0) {
      return existingChat;
    }

    const chatDetail = force || !existingChat?.members ? await api.chats.get(chatId) : existingChat;
    const hydratedBase = await hydrateChat(chatDetail, existingChat?.unreadCount ?? 0, chatDetail.memberCount);
    const chatKey = hydratedBase.chatKey ?? null;

    let messages = hydratedBase.messages ?? [];
    let messageMeta: ChatMessagesResponse | null = null;

    if (chatKey) {
      messageMeta = await api.chats.getMessages(chatId, { limit });
      messages = await decryptMessagesForDisplay(messageMeta.messages, chatKey, chatDetail.members ?? []);
    }

    const oldestMessage = messages[0];
    const hasReachedBeginning = Boolean(
      oldestMessage && isSystemMessage(oldestMessage) && parseSystemMessage(oldestMessage.content).event === 'chat_created'
    );

    const nextChat: Chat = {
      ...hydratedBase,
      messages,
      lastMessage: buildLastMessage(messages, chatDetail.members ?? []),
      unreadCount: messageMeta?.unreadCount ?? existingChat?.unreadCount ?? 0,
      firstUnreadId: messageMeta?.firstUnreadId ?? existingChat?.firstUnreadId ?? null,
      unreadMarkerId:
        (messageMeta?.unreadCount ?? existingChat?.unreadCount ?? 0) > 0
          ? messageMeta?.firstUnreadId ?? existingChat?.unreadMarkerId ?? existingChat?.firstUnreadId ?? null
          : existingChat?.unreadMarkerId ?? null,
      hasReachedBeginning,
      isHydrated: true,
      isLoadingMessages: false,
      isLoadingOlderMessages: false
    };

    upsertChat(nextChat);
    return nextChat;
  };

  return {
    subscribe,
    set,
    findChat,
    updateChat: updateChatById,
    removeChat,
    clear: () => set([]),
    clearUnread: (chatId: string) => updateChatById(chatId, { unreadCount: 0 }),
    setChatKey: (chatId: string, chatKey: CryptoKey) => updateChatById(chatId, { chatKey }),
    addMessages: (chatId: string, newMessages: Message[], prepend = false) => mergeMessages(chatId, newMessages, prepend),
    loadChats: async () => {
      const apiChats = await api.chats.list();
      const loadedChats = await Promise.all(
        apiChats.map(async (chat) => {
          const chatDetail = await api.chats.get(chat.id);
          return hydrateChat(chatDetail, chat.unreadCount || 0, chat.memberCount);
        })
      );

      set(loadedChats);
      return loadedChats;
    },
    ensureChatLoaded,
    refreshChat: async (chatId: string) => {
      const existingChat = findChat(chatId);
      return ensureChatLoaded(chatId, {
        force: true,
        limit: Math.max(existingChat?.messages?.length ?? 0, INITIAL_CHAT_MESSAGES_LIMIT)
      });
    },
    loadOlderMessages: async (chatId: string, limit = 50) => {
      const chat = findChat(chatId);
      if (!chat || !chat.messages?.length || chat.hasReachedBeginning || chat.isLoadingOlderMessages) {
        return chat;
      }

      updateChatById(chatId, { isLoadingOlderMessages: true });

      try {
        const result = await api.chats.getMessages(chatId, { cursor: chat.messages[0].id, limit });
        const decrypted = await decryptMessagesForDisplay(result.messages, chat.chatKey ?? null, chat.members ?? []);

        if (decrypted.length > 0) {
          mergeMessages(chatId, decrypted, true);
        }

        const nextOldest = decrypted[0] ?? findChat(chatId)?.messages?.[0];
        const hasReachedBeginning = Boolean(
          nextOldest && isSystemMessage(nextOldest) && parseSystemMessage(nextOldest.content).event === 'chat_created'
        );
        updateChatById(chatId, { hasReachedBeginning });
      } finally {
        updateChatById(chatId, { isLoadingOlderMessages: false });
      }

      return findChat(chatId);
    },
    markChatAsRead: async (chatId: string) => {
      await api.chats.markAsRead(chatId);
      updateChatById(chatId, { unreadCount: 0, firstUnreadId: null });
    },
    finalizeClosedChat: (chatId: string) => {
      clearUnreadMarkerIfResolved(chatId);
    },
    sendMessage: async (chatId: string, content: string, fileIds: string[] = []) => {
      const authState = getRequiredAuth();
      const chat = await ensureChatLoaded(chatId);

      if (!chat?.chatKey) {
        throw new Error('Chat key is not available');
      }

      const encryptedContent = content ? await crypto.encryptMessage(chat.chatKey, content) : '';
      const message = await api.chats.sendMessage(chatId, encryptedContent, fileIds);
      const nextMessage: Message = {
        ...message,
        content,
        fileIds,
        senderUsername: authState.user?.username || 'Me'
      };

      mergeMessages(chatId, [nextMessage], false);
      updateChatById(chatId, {
        unreadMarkerId: null,
        unreadCount: 0,
        firstUnreadId: null,
        typingUsers: []
      });
      return nextMessage;
    },
    sendTyping: async (chatId: string) => {
      await api.chats.sendTyping(chatId);
    },
    editMessage: async (chatId: string, messageId: string, content: string) => {
      const chat = await ensureChatLoaded(chatId);
      if (!chat?.chatKey) {
        throw new Error('Chat key is not available');
      }

      const existingMessage = chat.messages?.find((message) => message.id === messageId);
      const encryptedContent = await crypto.encryptMessage(chat.chatKey, content);
      const updatedMessage = await api.messages.edit(messageId, encryptedContent, existingMessage?.fileIds ?? []);

      update((chatList) =>
        chatList.map((item) => {
          if (item.id !== chatId) return item;

          const messages = (item.messages ?? []).map((message) =>
            message.id === updatedMessage.id
              ? { ...message, content, fileIds: updatedMessage.fileIds, editedAt: updatedMessage.editedAt }
              : message
          );

          return {
            ...item,
            messages,
            lastMessage: buildLastMessage(messages, item.members ?? [])
          };
        })
      );

      return updatedMessage;
    },
    deleteMessage: async (chatId: string, messageId: string) => {
      await api.messages.delete(messageId);

      update((chatList) =>
        chatList.map((item) => {
          if (item.id !== chatId) return item;

          const messages = (item.messages ?? []).filter((message) => message.id !== messageId);
          return {
            ...item,
            messages,
            lastMessage: buildLastMessage(messages, item.members ?? [])
          };
        })
      );
    },
    createChat: async (data: {
      type: CreateChatRequest['type'];
      name?: string;
      selectedUserId?: string | null;
      selectedUserPublicKey?: string;
    }) => {
      const authState = getRequiredAuth();
      const chatKey = await crypto.generateChatKey();
      const ownPublicKey = await crypto.importPublicKey(authState.user!.publicKey);
      const encryptedKey = await crypto.encryptChatKeyWithPublicKey(chatKey, ownPublicKey);

      const memberKeys: Record<string, string> = {};
      if (data.type === 'pm' && data.selectedUserId && data.selectedUserPublicKey) {
        const otherPublicKey = await crypto.importPublicKey(data.selectedUserPublicKey);
        memberKeys[data.selectedUserId] = await crypto.encryptChatKeyWithPublicKey(chatKey, otherPublicKey);
      }

      const members = data.type === 'pm' && data.selectedUserId ? [data.selectedUserId] : [];
      const result = await api.chats.create({
        type: data.type,
        name: data.type === 'gm' ? data.name : undefined,
        encryptedKey,
        memberKeys,
        members
      });

      const chatDetail = await api.chats.get(result.id);
      const hydratedChat = await hydrateChat(chatDetail, 0, chatDetail.memberCount ?? members.length + 1);
      upsertChat(hydratedChat);
      return hydratedChat;
    },
    addMember: async (chatId: string, userId: string, publicKey: string) => {
      const chat = await ensureChatLoaded(chatId);
      if (!chat?.chatKey) {
        throw new Error('Chat key is not available');
      }

      const importedPublicKey = await crypto.importPublicKey(publicKey);
      const encryptedKey = await crypto.encryptChatKeyWithPublicKey(chat.chatKey, importedPublicKey);
      await api.chats.addMember(chatId, userId, encryptedKey);
      return ensureChatLoaded(chatId, { force: true, limit: Math.max(chat.messages?.length ?? 0, INITIAL_CHAT_MESSAGES_LIMIT) });
    },
    removeMember: async (chatId: string, userId: string) => {
      await api.chats.removeMember(chatId, userId);
      return ensureChatLoaded(chatId, { force: true });
    },
    leaveChat: async (chatId: string) => {
      await api.chats.leave(chatId);
      removeChat(chatId);
    },
    deleteChat: async (chatId: string) => {
      await api.chats.delete(chatId);
      removeChat(chatId);
    },
    handleMemberEvent: async (event: MemberEventPayload) => {
      const authState = getRequiredAuth();

      if (event.type === 'member_added') {
        const existingChat = findChat(event.chatId);

        if (!existingChat && authState.user?.id === event.userId) {
          const chatDetail = await api.chats.get(event.chatId);
          const hydratedChat = await hydrateChat(chatDetail, 0, event.memberCount);
          upsertChat(hydratedChat);
          return { removedCurrentUser: false, chatAdded: true };
        }

        if (existingChat) {
          const refreshed = await ensureChatLoaded(event.chatId, { force: true });
          updateChatById(event.chatId, {
            memberCount: event.memberCount,
            members: refreshed?.members ?? existingChat.members
          });
        }

        return { removedCurrentUser: false, chatAdded: false };
      }

      const removedCurrentUser = authState.user?.id === event.userId || Boolean(event.removed);
      if (removedCurrentUser) {
        removeChat(event.chatId);
        return { removedCurrentUser: true, chatAdded: false };
      }

      const refreshed = await ensureChatLoaded(event.chatId, { force: true });
      updateChatById(event.chatId, {
        memberCount: event.memberCount,
        members: refreshed?.members ?? findChat(event.chatId)?.members
      });

      return { removedCurrentUser: false, chatAdded: false };
    },
    handleChatDeleted: (chatId: string) => {
      if (findChat(chatId)) {
        removeChat(chatId);
        return true;
      }

      return false;
    },
    handleTypingEvent: (chatId: string, userId: string) => {
      const authState = getRequiredAuth();
      if (authState.user?.id === userId) {
        return;
      }

      update((chatList) =>
        chatList.map((chat) => {
          if (chat.id !== chatId) return chat;

          const now = Date.now();
          const typingUsers = (chat.typingUsers ?? []).filter((entry) => entry.userId !== userId && entry.expiresAt > now);
          typingUsers.push({
            userId,
            expiresAt: now + TYPING_TTL_MS
          });

          return {
            ...chat,
            typingUsers
          };
        })
      );
    },
    applyIncomingEvent: async (chatId: string, incomingMessage: Message, activeChatId: string | null) => {
      const authState = getRequiredAuth();
      const existingChat = findChat(chatId);
      if (!existingChat) return;

      const isActiveChat = activeChatId === chatId;
      const chat = isActiveChat
        ? await ensureChatLoaded(chatId, {
            force: !existingChat.members,
            limit: Math.max(existingChat.messages?.length ?? 0, INITIAL_CHAT_MESSAGES_LIMIT)
          })
        : existingChat;

      if (!chat) return;

      if (!incomingMessage.content && (!incomingMessage.fileIds || incomingMessage.fileIds.length === 0)) {
        const messages = (chat.messages ?? []).filter((message) => message.id !== incomingMessage.id);
        replaceMessages(chatId, messages);
        return;
      }

      if (incomingMessage.editedAt && chat.chatKey) {
        const decryptedMessage = await decryptMessageForDisplay(
          incomingMessage,
          chat.chatKey,
          new Map((chat.members ?? []).map((member) => [member.id, member.username]))
        );

        update((chatList) =>
          chatList.map((item) => {
            if (item.id !== chatId) return item;

            const messages = (item.messages ?? []).map((message) =>
              message.id === incomingMessage.id
                ? {
                    ...message,
                    content: decryptedMessage.content,
                    fileIds: incomingMessage.fileIds ?? message.fileIds,
                    editedAt: incomingMessage.editedAt
                  }
                : message
            );

            return {
              ...item,
              messages,
              lastMessage: buildLastMessage(messages, item.members ?? [])
            };
          })
        );
        return;
      }

      const nextMessage = isSystemMessage(incomingMessage)
        ? incomingMessage
        : await decryptMessageForDisplay(
            incomingMessage,
            chat.chatKey ?? null,
            new Map((chat.members ?? []).map((member) => [member.id, member.username]))
          );

      const isOwnMessage = incomingMessage.senderId === authState.user?.id;

      update((chatList) =>
        chatList.map((item) => {
          if (item.id !== chatId) return item;

          const existingIds = new Set((item.messages ?? []).map((message) => message.id));
          const messages = existingIds.has(nextMessage.id) ? item.messages ?? [] : [...(item.messages ?? []), nextMessage];
          const previousUnreadCount = item.unreadCount ?? 0;
          const nextUnreadCount = isActiveChat || isOwnMessage ? previousUnreadCount : previousUnreadCount + 1;
          const unreadMarkerId = isOwnMessage
            ? null
            : nextUnreadCount > 0
              ? item.unreadMarkerId ?? (previousUnreadCount === 0 ? nextMessage.id : null)
              : item.unreadMarkerId;

          return {
            ...item,
            messages,
            unreadCount: nextUnreadCount,
            unreadMarkerId,
            typingUsers: (item.typingUsers ?? []).filter((entry) => entry.userId !== nextMessage.senderId),
            lastMessage: buildLastMessage(messages, item.members ?? [])
          };
        })
      );
    }
  };
}

export const chats = createChatsStore();
