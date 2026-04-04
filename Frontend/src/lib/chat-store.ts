import { get, writable } from 'svelte/store';
import { api } from './api';
import { auth } from './auth-store';
import * as crypto from './crypto';
import { cacheFile, getCachedFile } from './file-cache';
import {
  buildLastMessage,
  decryptChatName,
  decryptMessageForDisplay,
  decryptMessagesForDisplay,
  formatAttachmentNamesPreview,
  getMemberMap,
  getOtherUser,
  isSystemMessage,
  parseFileMetadataJson,
  parseSystemMessage
} from './chat-helpers';
import type { Chat, ChatMessagesResponse, CreateChatRequest, MemberEventPayload, Message, PinnedMessage } from './types';

const INITIAL_CHAT_MESSAGES_LIMIT = 20;
const SIDEBAR_PREVIEW_MESSAGES_LIMIT = 10;
const TYPING_TTL_MS = 5000;

function createChatsStore() {
  const { subscribe, set, update } = writable<Chat[]>([]);

  const getAll = () => get({ subscribe });
  const findChat = (chatId: string) => getAll().find((chat) => chat.id === chatId) ?? null;
  const getChatSortTimestamp = (chat: Chat) => {
    const lastMessagePreviewTimestamp = chat.lastMessage?.timestamp ?? 0;
    const lastMessageTimestamp = chat.messages?.[chat.messages.length - 1]?.timestamp ?? 0;
    return lastMessagePreviewTimestamp || lastMessageTimestamp || chat.createdAt || 0;
  };
  const sortChats = (chatList: Chat[]) =>
    [...chatList].sort((left, right) => getChatSortTimestamp(right) - getChatSortTimestamp(left));

  const updateChatById = (chatId: string, updates: Partial<Chat>) => {
    update((chatList) => sortChats(chatList.map((chat) => (chat.id === chatId ? { ...chat, ...updates } : chat))));
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
        return sortChats([...chatList, nextChat]);
      }

      return sortChats(chatList.map((chat) => (chat.id === nextChat.id ? { ...chat, ...nextChat } : chat)));
    });
  };

  const removeChat = (chatId: string) => {
    update((chatList) => chatList.filter((chat) => chat.id !== chatId));
  };

  const setPinnedMessages = (chatId: string, pinnedMessages: PinnedMessage[]) => {
    updateChatById(chatId, { pinnedMessages });
  };

  const buildReplyPreviewFromMessage = (message: Message) => ({
    id: message.id,
    senderId: message.senderId,
    senderUsername: message.senderUsername ?? 'Unknown',
    content: message.content,
    fileIds: message.fileIds,
    isDeleted: false
  });

  const syncDerivedMessageState = (
    messages: Message[],
    pinnedMessages: PinnedMessage[],
    sourceMessageId: string,
    sourceMessage: Message | null
  ) => {
    const updateReply = (message: Message): Message => {
      if (message.replyToMessageId !== sourceMessageId) {
        return message;
      }

      return {
        ...message,
        reply: sourceMessage
          ? buildReplyPreviewFromMessage(sourceMessage)
          : {
              id: sourceMessageId,
              senderId: message.reply?.senderId ?? null,
              senderUsername: message.reply?.senderUsername ?? 'Удалённое сообщение',
              content: '',
              fileIds: [],
              isDeleted: true
            }
      };
    };

    const nextMessages = messages
      .map((message) => {
        if (sourceMessage && message.id === sourceMessageId) {
          return { ...message, ...sourceMessage };
        }

        return updateReply(message);
      })
      .filter((message) => message.id !== sourceMessageId || Boolean(sourceMessage));

    const nextPinnedMessages = pinnedMessages
      .map((entry) => {
        if (sourceMessage && entry.message.id === sourceMessageId) {
          return {
            ...entry,
            message: { ...entry.message, ...sourceMessage }
          };
        }

        return {
          ...entry,
          message: updateReply(entry.message)
        };
      })
      .filter((entry) => entry.message.id !== sourceMessageId || Boolean(sourceMessage));

    return {
      messages: nextMessages,
      pinnedMessages: nextPinnedMessages
    };
  };

  const replaceMessages = (chatId: string, messages: Message[]) => {
    updateChatById(chatId, {
      messages,
      lastMessage: buildLastMessage(messages, findChat(chatId)?.members ?? [])
    });
  };

  const mergeMessages = (chatId: string, newMessages: Message[], prepend = false) => {
    update((chatList) =>
      sortChats(chatList.map((chat) => {
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
      }))
    );
  };

  const getRequiredAuth = () => {
    const authState = get(auth);
    if (!authState.user) {
      throw new Error('User is not authenticated');
    }

    return authState;
  };

  const resolveAttachmentNames = async (
    chatId: string,
    fileIds: string[],
    chatKey: CryptoKey | null
  ): Promise<string[]> => {
    if (!chatKey || fileIds.length === 0) {
      return [];
    }

    const metadataResults = await Promise.allSettled(
      fileIds.map(async (fileId) => {
        const metadataResponse = await api.files.downloadChatFileMetadata(chatId, fileId);
        const decryptedMetadataBytes = await crypto.decryptBinary(chatKey, crypto.base64ToBytes(metadataResponse.metadataBase64));
        const metadataText = new TextDecoder().decode(decryptedMetadataBytes);
        const metadata = parseFileMetadataJson(metadataText);
        return metadata?.name?.trim() || null;
      })
    );

    return metadataResults
      .map((result) => (result.status === 'fulfilled' ? result.value : null))
      .filter((name): name is string => Boolean(name));
  };

  const enrichLastMessageAttachments = async (
    chatId: string,
    lastMessage: ReturnType<typeof buildLastMessage>,
    sourceMessage: Message | undefined,
    chatKey: CryptoKey | null
  ) => {
    if (
      !lastMessage ||
      lastMessage.isSystem ||
      lastMessage.content.trim() ||
      !lastMessage.hasAttachments ||
      !sourceMessage?.fileIds?.length
    ) {
      return lastMessage;
    }

    const attachmentNames = await resolveAttachmentNames(chatId, sourceMessage.fileIds, chatKey);
    if (attachmentNames.length === 0) {
      return lastMessage;
    }

    return {
      ...lastMessage,
      content: formatAttachmentNamesPreview(attachmentNames),
      attachmentNames
    };
  };

  const resolveChatAvatarUrl = async (
    chatId: string,
    avatarFileId: string | null | undefined,
    avatarUpdatedAt: number | null | undefined,
    chatKey: CryptoKey | null
  ) => {
    if (!avatarFileId || !avatarUpdatedAt || !chatKey) {
      return null;
    }

    const cachedAsset = await getCachedFile(avatarFileId, avatarUpdatedAt);
    if (cachedAsset) {
      return cachedAsset.objectUrl;
    }

    try {
      const metadataResponse = await api.files.downloadChatFileMetadata(chatId, avatarFileId);
      const decryptedMetadataBytes = await crypto.decryptBinary(chatKey, crypto.base64ToBytes(metadataResponse.metadataBase64));
      const metadataText = new TextDecoder().decode(decryptedMetadataBytes);
      const metadata = parseFileMetadataJson(metadataText);

      const contentResponse = await api.files.downloadChatFileContent(chatId, avatarFileId);
      const decryptedContent = await crypto.decryptBinary(chatKey, contentResponse.content);
      const blob = new Blob([Uint8Array.from(decryptedContent).buffer], {
        type: metadata?.type || 'image/webp'
      });

      const asset = await cacheFile(avatarFileId, blob, {
        type: metadata?.type || 'image/webp',
        name: metadata?.name || 'chat-avatar.webp',
        updatedAt: contentResponse.updatedAt
      });

      return asset.objectUrl;
    } catch {
      return null;
    }
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

  const decryptPinnedMessagesForDisplay = async (
    pinnedMessages: PinnedMessage[] = [],
    chatKey: CryptoKey | null,
    members: Chat['members'] = []
  ) => {
    if (!pinnedMessages.length) {
      return [];
    }

    const memberMap = getMemberMap(members ?? []);
    return Promise.all(
      pinnedMessages.map(async (entry) => ({
        ...entry,
        message: await decryptMessageForDisplay(entry.message, chatKey, memberMap)
      }))
    );
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
    const decryptedName = await decryptChatName(chatDetail, chatKey);
    const avatarUrl = await resolveChatAvatarUrl(
      chatDetail.id,
      chatDetail.avatarFileId ?? null,
      chatDetail.avatarUpdatedAt ?? null,
      chatKey
    );
    if (chatKey) {
      try {
        const messagesResult = await api.chats.getMessages(chatDetail.id, { limit: SIDEBAR_PREVIEW_MESSAGES_LIMIT });
        messages = await decryptMessagesForDisplay(messagesResult.messages, chatKey, members);
      } catch {
        messages = currentChat?.messages ?? [];
      }
    }
      const pinnedMessages = chatDetail.pinnedMessages
        ? await decryptPinnedMessagesForDisplay(chatDetail.pinnedMessages, chatKey, members)
        : currentChat?.pinnedMessages ?? [];

    const oldestMessage = messages[0];
    const hasReachedBeginning = Boolean(
      oldestMessage && isSystemMessage(oldestMessage) && parseSystemMessage(oldestMessage.content).event === 'chat_created'
    );

    const lastMessage = await enrichLastMessageAttachments(
      chatDetail.id,
      buildLastMessage(messages, members),
      messages[messages.length - 1],
      chatKey
    );

    return {
      ...currentChat,
      ...chatDetail,
      name: decryptedName,
      memberCount,
      members,
      unreadCount,
      avatarUrl,
      otherUser: getOtherUser(chatDetail, authState.user?.id),
      lastMessage,
      messages,
      chatKey,
      pinnedMessages,
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

    const lastMessage = await enrichLastMessageAttachments(
      chatId,
      buildLastMessage(messages, chatDetail.members ?? []),
      messages[messages.length - 1],
      chatKey
    );

    const nextChat: Chat = {
      ...hydratedBase,
      messages,
      lastMessage,
      unreadCount: messageMeta?.unreadCount ?? existingChat?.unreadCount ?? 0,
      firstUnreadId: messageMeta?.firstUnreadId ?? existingChat?.firstUnreadId ?? null,
      unreadMarkerId:
        (messageMeta?.unreadCount ?? existingChat?.unreadCount ?? 0) > 0
          ? messageMeta?.firstUnreadId ?? existingChat?.unreadMarkerId ?? existingChat?.firstUnreadId ?? null
          : existingChat?.unreadMarkerId ?? null,
      hasReachedBeginning,
      isHydrated: true,
      isLoadingMessages: false,
      isLoadingOlderMessages: false,
      pinnedMessages: hydratedBase.pinnedMessages ?? existingChat?.pinnedMessages ?? []
    };

    upsertChat(nextChat);
    return nextChat;
  };

  const refreshChatInternal = async (chatId: string) => {
    const existingChat = findChat(chatId);
    return ensureChatLoaded(chatId, {
      force: true,
      limit: Math.max(existingChat?.messages?.length ?? 0, INITIAL_CHAT_MESSAGES_LIMIT)
    });
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

      set(sortChats(loadedChats));
      return loadedChats;
    },
    ensureChatLoaded,
    refreshChat: async (chatId: string) => {
      return refreshChatInternal(chatId);
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
      const authState = getRequiredAuth();
      const result = await api.chats.markAsRead(chatId);
      update((chatList) =>
        chatList.map((chat) => {
          if (chat.id !== chatId) return chat;

          return {
            ...chat,
            unreadCount: 0,
            firstUnreadId: null,
            members: (chat.members ?? []).map((member) =>
              member.id === authState.user?.id
                ? {
                    ...member,
                    lastReadAt: result.lastReadAt
                  }
                : member
            )
          };
        })
      );
    },
    setChatReadState: async (chatId: string, lastReadAt: number) => {
      const authState = getRequiredAuth();
      const result = await api.chats.markAsRead(chatId, lastReadAt);
      update((chatList) =>
        chatList.map((chat) => {
          if (chat.id !== chatId) return chat;

          const messages = chat.messages ?? [];
          const unreadMessages = messages.filter((message) => !isSystemMessage(message) && message.timestamp > result.lastReadAt);
          return {
            ...chat,
            unreadCount: unreadMessages.length,
            firstUnreadId: unreadMessages[0]?.id ?? null,
            unreadMarkerId: unreadMessages[0]?.id ?? null,
            members: (chat.members ?? []).map((member) =>
              member.id === authState.user?.id
                ? {
                    ...member,
                    lastReadAt: result.lastReadAt
                  }
                : member
            )
          };
        })
      );
    },
    clearUnreadMarkerOnOpen: (chatId: string) => {
      clearUnreadMarkerIfResolved(chatId);
    },
    finalizeClosedChat: (_chatId: string) => {},
    sendMessage: async (
      chatId: string,
      content: string,
      fileIds: string[] = [],
      attachmentNames: string[] = [],
      replyToMessageId: string | null = null
    ) => {
      const authState = getRequiredAuth();
      const chat = await ensureChatLoaded(chatId);

      if (!chat?.chatKey) {
        throw new Error('Chat key is not available');
      }

      const encryptedContent = content ? await crypto.encryptMessage(chat.chatKey, content) : '';
      const message = await api.chats.sendMessage(chatId, encryptedContent, content.length, fileIds, replyToMessageId);
      const replyMessage = replyToMessageId
        ? chat.messages?.find((item) => item.id === replyToMessageId) ?? null
        : null;
      const nextMessage: Message = {
        ...message,
        content,
        fileIds,
        reply: replyMessage
          ? {
              id: replyMessage.id,
              senderId: replyMessage.senderId,
              senderUsername: replyMessage.senderUsername ?? 'Unknown',
              content: replyMessage.content,
              fileIds: replyMessage.fileIds,
              isDeleted: false
            }
          : message.reply ?? null,
        senderUsername: authState.user?.username || 'Me'
      };

      mergeMessages(chatId, [nextMessage], false);
      update((chatList) =>
        sortChats(chatList.map((item) => {
          if (item.id !== chatId) return item;

          const messages = item.messages ?? [];
          const lastMessage = buildLastMessage(messages, item.members ?? []);
          return {
            ...item,
            unreadMarkerId: null,
            unreadCount: 0,
            firstUnreadId: null,
            typingUsers: [],
            lastMessage:
              lastMessage && !content.trim() && fileIds.length > 0 && attachmentNames.length > 0
                ? {
                    ...lastMessage,
                    content: formatAttachmentNamesPreview(attachmentNames),
                    attachmentNames
                  }
                : lastMessage
          };
        }))
      );
      return nextMessage;
    },
    sendTyping: async (chatId: string) => {
      await api.chats.sendTyping(chatId);
    },
    editMessage: async (chatId: string, messageId: string, content: string, replyToMessageId?: string | null) => {
      const chat = await ensureChatLoaded(chatId);
      if (!chat?.chatKey) {
        throw new Error('Chat key is not available');
      }

      const existingMessage = chat.messages?.find((message) => message.id === messageId);
      const encryptedContent = await crypto.encryptMessage(chat.chatKey, content);
      const updatedMessage = await api.messages.edit(
        messageId,
        encryptedContent,
        content.length,
        existingMessage?.fileIds ?? [],
        replyToMessageId ?? existingMessage?.replyToMessageId ?? null
      );
      const decryptedUpdatedMessage = await decryptMessageForDisplay(
        {
          ...updatedMessage,
          senderUsername: existingMessage?.senderUsername
        },
        chat.chatKey,
        new Map((chat.members ?? []).map((member) => [member.id, member.username]))
      );

      update((chatList) =>
        sortChats(chatList.map((item) => {
          if (item.id !== chatId) return item;

          const baseMessages = (item.messages ?? []).map((message) =>
            message.id === updatedMessage.id ? { ...message, ...decryptedUpdatedMessage } : message
          );
          const sourceMessage = baseMessages.find((message) => message.id === updatedMessage.id) ?? decryptedUpdatedMessage;
          const synced = syncDerivedMessageState(
            baseMessages,
            item.pinnedMessages ?? [],
            updatedMessage.id,
            sourceMessage
          );

          return {
            ...item,
            messages: synced.messages,
            pinnedMessages: synced.pinnedMessages,
            lastMessage: buildLastMessage(synced.messages, item.members ?? [])
          };
        }))
      );

      return updatedMessage;
    },
    deleteMessage: async (chatId: string, messageId: string) => {
      const result = await api.messages.delete(messageId);

      const existingChat = findChat(chatId);
      const decryptedPinnedMessages = existingChat
        ? await decryptPinnedMessagesForDisplay(
            result.pinnedMessages ?? [],
            existingChat.chatKey ?? null,
            existingChat.members ?? []
          )
        : [];

        update((chatList) =>
          chatList.map((item) => {
            if (item.id !== chatId) return item;

            const baseMessages = (item.messages ?? []).filter((message) => message.id !== messageId);
            const synced = syncDerivedMessageState(
              baseMessages,
              result.pinnedMessages ? decryptedPinnedMessages : item.pinnedMessages ?? [],
              messageId,
              null
            );

            return {
              ...item,
              messages: synced.messages,
              pinnedMessages: result.pinnedMessages ? decryptedPinnedMessages : synced.pinnedMessages,
              lastMessage: buildLastMessage(synced.messages, item.members ?? [])
            };
          })
        );

      return {
        deletedFileIds: result.deletedFileIds ?? [],
        pinnedMessages: decryptedPinnedMessages
      };
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
        name: data.type === 'gm' && data.name ? await crypto.encryptMessage(chatKey, data.name.trim()) : undefined,
        nameLength: data.type === 'gm' && data.name ? data.name.trim().length : undefined,
        encryptedKey,
        memberKeys,
        members
      });

      const chatDetail = await api.chats.get(result.id);
      const hydratedChat = await hydrateChat(chatDetail, 0, chatDetail.memberCount ?? members.length + 1);
      upsertChat(hydratedChat);
      return hydratedChat;
    },
    renameChat: async (chatId: string, nextName: string) => {
      const chat = await ensureChatLoaded(chatId);
      if (!chat?.chatKey) {
        throw new Error('Chat key is not available');
      }

      const trimmedName = nextName.trim();
      if (!trimmedName) {
        throw new Error('Название чата не может быть пустым');
      }

      if (trimmedName.length > 30) {
        throw new Error('Название чата не должно превышать 30 символов');
      }

      await api.chats.update(chatId, {
        name: await crypto.encryptMessage(chat.chatKey, trimmedName),
        nameLength: trimmedName.length
      });

      updateChatById(chatId, { name: trimmedName });
      return refreshChatInternal(chatId);
    },
    updateChatAvatar: async (chatId: string, avatarBlob: Blob) => {
      const chat = await ensureChatLoaded(chatId);
      if (!chat?.chatKey) {
        throw new Error('Chat key is not available');
      }

      const metadata = {
        name: 'chat-avatar.webp',
        type: avatarBlob.type || 'image/webp',
        size: avatarBlob.size
      };
      const fileBytes = new Uint8Array(await avatarBlob.arrayBuffer());
      const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
      const encryptedContent = await crypto.encryptBinary(chat.chatKey, fileBytes);
      const encryptedMetadata = await crypto.encryptBinary(chat.chatKey, metadataBytes);

      const uploaded = await api.files.uploadChatFile(chatId, encryptedContent, crypto.bytesToBase64(encryptedMetadata));

      try {
        await cacheFile(uploaded.file.id, avatarBlob, {
          type: metadata.type,
          name: metadata.name,
          updatedAt: uploaded.file.updatedAt
        });
        await api.chats.updateAvatar(chatId, uploaded.file.id);
      } catch (error) {
        await api.files.deleteChatFile(chatId, uploaded.file.id).catch(() => {});
        throw error;
      }

      return refreshChatInternal(chatId);
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
    removeMember: async (chatId: string, userId: string, options?: { deleteMessages?: boolean; deleteFiles?: boolean }) => {
      await api.chats.removeMember(chatId, userId, options);
      return ensureChatLoaded(chatId, { force: true });
    },
    leaveChat: async (chatId: string, options?: { deleteMessages?: boolean; deleteFiles?: boolean }) => {
      await api.chats.leave(chatId, options);
      removeChat(chatId);
    },
    deleteChat: async (chatId: string) => {
      await api.chats.delete(chatId);
      removeChat(chatId);
    },
    loadPins: async (chatId: string) => {
      const chat = await ensureChatLoaded(chatId);
      const pinnedMessages = await decryptPinnedMessagesForDisplay(
        await api.chats.getPins(chatId),
        chat?.chatKey ?? null,
        chat?.members ?? []
      );
      setPinnedMessages(chatId, pinnedMessages);
      return pinnedMessages;
    },
    pinMessage: async (chatId: string, messageId: string) => {
      const chat = await ensureChatLoaded(chatId);
      const pinnedMessages = await decryptPinnedMessagesForDisplay(
        await api.chats.pinMessage(chatId, messageId),
        chat?.chatKey ?? null,
        chat?.members ?? []
      );
      setPinnedMessages(chatId, pinnedMessages);
      return pinnedMessages;
    },
    unpinMessage: async (chatId: string, messageId: string) => {
      const chat = await ensureChatLoaded(chatId);
      const pinnedMessages = await decryptPinnedMessagesForDisplay(
        await api.chats.unpinMessage(chatId, messageId),
        chat?.chatKey ?? null,
        chat?.members ?? []
      );
      setPinnedMessages(chatId, pinnedMessages);
      return pinnedMessages;
    },
    handlePinsUpdated: async (chatId: string, pinnedMessages: PinnedMessage[]) => {
      const chat = findChat(chatId);
      const decryptedPinnedMessages = await decryptPinnedMessagesForDisplay(
        pinnedMessages,
        chat?.chatKey ?? null,
        chat?.members ?? []
      );
      setPinnedMessages(chatId, decryptedPinnedMessages);
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
    handlePresenceEvent: (userId: string, isOnline: boolean, lastSeenAt: number | null = null) => {
      update((chatList) =>
        chatList.map((chat) => {
          let changed = false;
          const members = (chat.members ?? []).map((member) => {
            if (member.id === userId) {
              const shouldUpdate =
                member.isOnline !== isOnline ||
                (!isOnline && (member.lastSeenAt ?? null) !== (lastSeenAt ?? null));

              if (shouldUpdate) {
                changed = true;
                return {
                  ...member,
                  isOnline,
                  lastSeenAt: isOnline ? member.lastSeenAt ?? null : lastSeenAt ?? member.lastSeenAt ?? null
                };
              }
            }

            return member;
          });

          const otherUser =
            chat.otherUser?.id === userId &&
            (
              chat.otherUser.isOnline !== isOnline ||
              (!isOnline && (chat.otherUser.lastSeenAt ?? null) !== (lastSeenAt ?? null))
            )
              ? {
                  ...chat.otherUser,
                  isOnline,
                  lastSeenAt: isOnline ? chat.otherUser.lastSeenAt ?? null : lastSeenAt ?? chat.otherUser.lastSeenAt ?? null
                }
              : chat.otherUser;

          if (otherUser !== chat.otherUser) {
            changed = true;
          }

          return changed
            ? {
                ...chat,
                members,
                otherUser
              }
            : chat;
        })
      );
    },
    handleReadStateEvent: (chatId: string, userId: string, lastReadAt: number) => {
      update((chatList) =>
        chatList.map((chat) => {
          if (chat.id !== chatId) return chat;

          return {
            ...chat,
            members: (chat.members ?? []).map((member) =>
              member.id === userId
                ? {
                    ...member,
                    lastReadAt
                  }
                : member
            )
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
        update((chatList) =>
          chatList.map((item) => {
            if (item.id !== chatId) return item;

            const baseMessages = (item.messages ?? []).filter((message) => message.id !== incomingMessage.id);
            const synced = syncDerivedMessageState(
              baseMessages,
              item.pinnedMessages ?? [],
              incomingMessage.id,
              null
            );

            return {
              ...item,
              messages: synced.messages,
              pinnedMessages: synced.pinnedMessages,
              lastMessage: buildLastMessage(synced.messages, item.members ?? [])
            };
          })
        );
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

            const baseMessages = (item.messages ?? []).map((message) =>
              message.id === incomingMessage.id
                ? {
                    ...message,
                    ...decryptedMessage,
                    content: decryptedMessage.content,
                    fileIds: incomingMessage.fileIds ?? message.fileIds,
                    editedAt: incomingMessage.editedAt
                  }
                : message
            );
            const sourceMessage = baseMessages.find((message) => message.id === incomingMessage.id) ?? decryptedMessage;
            const synced = syncDerivedMessageState(
              baseMessages,
              item.pinnedMessages ?? [],
              incomingMessage.id,
              sourceMessage
            );

            return {
              ...item,
              messages: synced.messages,
              pinnedMessages: synced.pinnedMessages,
              lastMessage: buildLastMessage(synced.messages, item.members ?? [])
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

      const incomingAttachmentNames =
        !nextMessage.content.trim() && nextMessage.fileIds.length > 0
          ? await resolveAttachmentNames(chatId, nextMessage.fileIds, chat.chatKey ?? null)
          : [];

      const isOwnMessage = incomingMessage.senderId === authState.user?.id;
      const canAutoReadActiveChat =
        isActiveChat &&
        (typeof document === 'undefined' || (document.visibilityState === 'visible' && document.hasFocus()));

      update((chatList) =>
        sortChats(chatList.map((item) => {
          if (item.id !== chatId) return item;

          const existingIds = new Set((item.messages ?? []).map((message) => message.id));
          const messages = existingIds.has(nextMessage.id) ? item.messages ?? [] : [...(item.messages ?? []), nextMessage];
          const previousUnreadCount = item.unreadCount ?? 0;
          const nextUnreadCount = canAutoReadActiveChat || isOwnMessage ? previousUnreadCount : previousUnreadCount + 1;
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
            lastMessage:
              !nextMessage.content.trim() && nextMessage.fileIds.length > 0 && incomingAttachmentNames.length > 0
                ? {
                    ...(buildLastMessage(messages, item.members ?? []) ?? {
                      senderId: nextMessage.senderId,
                      senderUsername: nextMessage.senderUsername,
                      content: '',
                      timestamp: nextMessage.timestamp,
                      isSystem: false,
                      hasAttachments: true
                    }),
                    content: formatAttachmentNamesPreview(incomingAttachmentNames),
                    attachmentNames: incomingAttachmentNames
                  }
                : buildLastMessage(messages, item.members ?? [])
          };
        }))
      );
    }
  };
}

export const chats = createChatsStore();
