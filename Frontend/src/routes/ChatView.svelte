<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { api } from '../lib/api';
  import { auth, chats, type Chat } from '../lib/stores';
  import * as cryptoLib from '../lib/crypto';
  import { cacheFile, getCachedFile, invalidateCachedFile, type CachedFileAsset } from '../lib/file-cache';
  import MessageList from '../components/chat/MessageList.svelte';
  import MessageInput from '../components/chat/MessageInput.svelte';
  import MembersModal from '../components/chat/MembersModal.svelte';
  import { formatFileSize, isSystemMessage, parseFileMetadataJson } from '../lib/chat-helpers';
  import type { ChatMember, Message, SearchUserResult } from '../lib/types';

  export let params: { id: string };
  export let chatDetail: Chat | null = null;

  let error = '';
  let newMessage = '';
  let sending = false;
  let showAddMemberModal = false;
  let showMembersModal = false;
  let userSearch = '';
  let searchResults: SearchUserResult[] = [];
  let searching = false;
  let addingMember = false;
  let contextMenu: { x: number; y: number; messageId: string; senderId: string | null; visible: boolean } = {
    x: 0,
    y: 0,
    messageId: '',
    senderId: null,
    visible: false
  };
  let editingMessage: { id: string; content: string } | null = null;
  let editingText = '';
  let messagesContainer: HTMLDivElement | undefined;
  let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
  let errorTimeout: ReturnType<typeof setTimeout> | null = null;
  let loadedChatId: string | null = null;
  let pendingReadCheckForChatId: string | null = null;
  let shouldStickToBottom = true;
  let previousMessageCount = 0;
  let lastTypingSentAt = 0;
  let lastObservedTypingValue = '';
  let pendingAttachments: PendingAttachment[] = [];
  let fileDisplayById: Record<
    string,
    {
      status: 'loading' | 'ready' | 'missing' | 'error';
      name?: string;
      type?: string;
      size?: number;
      sizeLabel?: string;
      deletedAt?: number | null;
    }
  > = {};
  let fileAssetById: Record<string, CachedFileAsset> = {};
  let chatFileMetadataByChatId: Record<
    string,
    Record<string, Awaited<ReturnType<typeof api.files.downloadChatFilesMetadata>>[number]>
  > = {};
  let metadataLoadedChatIds = new Set<string>();
  let fileMetadataGeneration = 0;

  const TYPING_THROTTLE_MS = 3000;
  const ERROR_TOAST_DURATION_MS = 4000;

  $: selectedChat = $chats.find((chat) => chat.id === params.id) ?? chatDetail;
  $: messages = selectedChat?.messages ?? [];
  $: chatKey = selectedChat?.chatKey ?? null;
  $: otherUserName = selectedChat?.otherUser?.username ?? null;
  $: isCreator = selectedChat?.createdBy === $auth.user?.id;
  $: isOwnMessage = contextMenu.senderId === $auth.user?.id;
  $: typingMemberNames = (selectedChat?.typingUsers ?? [])
    .map((entry) => selectedChat?.members?.find((member) => member.id === entry.userId)?.username)
    .filter((username): username is string => Boolean(username));
  $: memberAvatarUrls = Object.fromEntries((selectedChat?.members ?? []).map((member) => [member.id, member.avatarUrl ?? null]));
  $: visibleFileIds = Array.from(new Set(messages.flatMap((message) => message.fileIds)));

  type MessageGroup = {
    senderId: string;
    senderUsername: string;
    messages: Message[];
    isSystem: boolean;
  };

  type PendingAttachment = {
    id: string;
    name: string;
    size: number;
    file: File;
    estimatedStoredSize: number;
    uploading?: boolean;
  };

  function rememberChatFileMetadata(
    chatId: string,
    metadata: Awaited<ReturnType<typeof api.files.downloadChatFileMetadata>>
  ) {
    const fileId = metadata.fileId;
    if (!fileId) return;

    chatFileMetadataByChatId = {
      ...chatFileMetadataByChatId,
      [chatId]: {
        ...(chatFileMetadataByChatId[chatId] ?? {}),
        [fileId]: metadata
      }
    };
  }

  function forgetChatFileMetadata(chatId: string, fileId: string) {
    const currentChatMetadata = chatFileMetadataByChatId[chatId];
    if (!currentChatMetadata?.[fileId]) return;

    const nextChatMetadata = { ...currentChatMetadata };
    delete nextChatMetadata[fileId];

    chatFileMetadataByChatId = {
      ...chatFileMetadataByChatId,
      [chatId]: nextChatMetadata
    };
  }

  function revokeFileAsset(fileId: string) {
    const nextAssets = { ...fileAssetById };
    delete nextAssets[fileId];
    fileAssetById = nextAssets;
  }

  function resetFileCaches() {
    fileMetadataGeneration += 1;
    fileAssetById = {};
    fileDisplayById = {};
  }

  function handleContainerScroll() {
    if (!messagesContainer || !selectedChat) return;

    const scrollTop = messagesContainer.scrollTop;
    const scrollHeight = messagesContainer.scrollHeight;
    const clientHeight = messagesContainer.clientHeight;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    const unreadCount = selectedChat.unreadCount || 0;
    shouldStickToBottom = isAtBottom;

    if (isAtBottom && unreadCount > 0) {
      chats.markChatAsRead(params.id).catch(() => {});
    }

    if (!selectedChat.isLoadingOlderMessages && !selectedChat.hasReachedBeginning && scrollTop < 100) {
      if (scrollTimeout) clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(async () => {
        if (!messagesContainer) return;

        const scrollHeightBefore = messagesContainer.scrollHeight;
        const scrollTopBefore = messagesContainer.scrollTop;

        try {
          await chats.loadOlderMessages(params.id);
        } catch {
          error = 'Не удалось загрузить более ранние сообщения';
        }

        requestAnimationFrame(() => {
          if (!messagesContainer) return;
          const scrollHeightAfter = messagesContainer.scrollHeight;
          messagesContainer.scrollTop = scrollTopBefore + (scrollHeightAfter - scrollHeightBefore);
        });
      }, 300);
    }
  }

  async function markChatAsReadIfFullyVisible() {
    if (!messagesContainer || !selectedChat || !selectedChat.unreadCount) {
      return;
    }

    const scrollTop = messagesContainer.scrollTop;
    const scrollHeight = messagesContainer.scrollHeight;
    const clientHeight = messagesContainer.clientHeight;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    const fitsWithoutScroll = scrollHeight <= clientHeight + 1;

    if (isAtBottom || fitsWithoutScroll) {
      await chats.markChatAsRead(params.id);
    }
  }

  function handleContextMenu(event: MouseEvent, messageId: string, senderId: string | null) {
    event.preventDefault();
    contextMenu = {
      x: event.clientX,
      y: event.clientY,
      messageId,
      senderId,
      visible: true
    };

    requestAnimationFrame(() => {
      const menuElement = document.querySelector('.context-menu') as HTMLElement | null;
      if (!menuElement) return;

      const rect = menuElement.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        contextMenu = { ...contextMenu, x: window.innerWidth - rect.width - 10 };
      }
      if (rect.bottom > window.innerHeight) {
        contextMenu = { ...contextMenu, y: window.innerHeight - rect.height - 10 };
      }
    });
  }

  function closeContextMenu() {
    contextMenu = { x: 0, y: 0, messageId: '', senderId: null, visible: false };
  }

  function groupMessages(source: Message[], members: ChatMember[] = []): MessageGroup[] {
    const memberMap = new Map(members.map((member) => [member.id, member.username]));
    const groups: MessageGroup[] = [];
    let currentGroup: MessageGroup | null = null;

    for (const message of source) {
      if (isSystemMessage(message)) {
        if (currentGroup) {
          groups.push(currentGroup);
          currentGroup = null;
        }

        groups.push({
          senderId: 'system',
          senderUsername: 'System',
          messages: [message],
          isSystem: true
        });
        continue;
      }

      const senderUsername = message.senderUsername || memberMap.get(message.senderId ?? '') || 'Unknown';
      const timestamp = new Date(message.timestamp).getTime();

      if (currentGroup && currentGroup.senderId === message.senderId) {
        const lastTimestamp = new Date(currentGroup.messages[currentGroup.messages.length - 1].timestamp).getTime();
        if (timestamp - lastTimestamp < 5 * 60 * 1000) {
          currentGroup.messages.push(message);
          continue;
        }
      }

      if (currentGroup) {
        groups.push(currentGroup);
      }

      currentGroup = {
        senderId: message.senderId ?? '',
        senderUsername,
        messages: [message],
        isSystem: false
      };
    }

    if (currentGroup) {
      groups.push(currentGroup);
    }

    return groups;
  }

  $: groupedMessages = groupMessages(messages, selectedChat?.members ?? []);
  $: showPlaceholder = !(selectedChat?.hasReachedBeginning ?? false);
  $: if (messagesContainer) {
    const currentMessageCount = messages.length;
    const shouldScrollToBottom = currentMessageCount > previousMessageCount && shouldStickToBottom;
    previousMessageCount = currentMessageCount;

    if (shouldScrollToBottom) {
      tick().then(() => {
        if (messagesContainer) {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
      });
    }
  }
  $: if (selectedChat?.id && newMessage !== lastObservedTypingValue) {
    lastObservedTypingValue = newMessage;

    if (newMessage.trim()) {
      const now = Date.now();
      if (now - lastTypingSentAt >= TYPING_THROTTLE_MS) {
        lastTypingSentAt = now;
        chats.sendTyping(selectedChat.id).catch(() => {});
      }
    }
  }
  $: if (selectedChat?.id && chatKey && visibleFileIds.length > 0) {
    loadVisibleFileMetadata(selectedChat.id, chatKey, visibleFileIds).catch(() => {});
  }
  $: if (visibleFileIds.length === 0 && Object.keys(fileDisplayById).length > 0) {
    resetFileCaches();
  }

  async function handleDeleteFromMenu() {
    if (contextMenu.messageId) {
      await handleDeleteMessage(contextMenu.messageId);
    }
    closeContextMenu();
  }

  function handleEditFromMenu(message: Message) {
    editingMessage = { id: message.id, content: message.content };
    editingText = message.content;
    closeContextMenu();
  }

  async function handleEditMessage() {
    if (!editingMessage || !editingText.trim()) return;

    try {
      await chats.editMessage(params.id, editingMessage.id, editingText);
      editingMessage = null;
      editingText = '';
    } catch (exception) {
      error = exception instanceof Error ? exception.message : 'Не удалось отредактировать сообщение';
    }
  }

  function cancelEdit() {
    editingMessage = null;
    editingText = '';
  }

  function clearError() {
    if (errorTimeout) {
      clearTimeout(errorTimeout);
      errorTimeout = null;
    }
    error = '';
  }

  $: if (error) {
    if (errorTimeout) {
      clearTimeout(errorTimeout);
    }

    errorTimeout = setTimeout(() => {
      error = '';
      errorTimeout = null;
    }, ERROR_TOAST_DURATION_MS);
  }

  function buildFileMetadata(file: File) {
    return {
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size
    };
  }

  function estimateStoredFileSize(file: File) {
    const metadataBytes = new TextEncoder().encode(JSON.stringify(buildFileMetadata(file)));
    return file.size + metadataBytes.length + 56;
  }

  async function handleSendMessage() {
    clearError();
    if ((!newMessage.trim() && pendingAttachments.length === 0) || sending || !chatKey) return;

    sending = true;
    pendingAttachments = pendingAttachments.map((attachment) => ({ ...attachment, uploading: true }));
    const uploadedFileIds: string[] = [];
    const locallyCachedFileIds: string[] = [];
    try {
      for (const attachment of pendingAttachments) {
        const fileBytes = new Uint8Array(await attachment.file.arrayBuffer());
        const fileMetadata = buildFileMetadata(attachment.file);
        const metadataBytes = new TextEncoder().encode(JSON.stringify(fileMetadata));
        const encryptedContent = await cryptoLib.encryptBinary(chatKey, fileBytes);
        const encryptedMetadata = await cryptoLib.encryptBinary(chatKey, metadataBytes);
        const uploaded = await api.files.uploadChatFile(
          params.id,
          encryptedContent,
          cryptoLib.bytesToBase64(encryptedMetadata)
        );

        uploadedFileIds.push(uploaded.file.id);
        locallyCachedFileIds.push(uploaded.file.id);
        rememberChatFileMetadata(params.id, {
          fileId: uploaded.file.id,
          metadataBase64: cryptoLib.bytesToBase64(encryptedMetadata),
          size: uploaded.file.size,
          updatedAt: uploaded.file.updatedAt,
          createdAt: uploaded.file.createdAt,
          deletedAt: uploaded.file.deletedAt
        });
        await cacheFile(uploaded.file.id, attachment.file, {
          type: fileMetadata.type,
          name: fileMetadata.name,
          updatedAt: uploaded.file.updatedAt
        });
      }

      await chats.sendMessage(params.id, newMessage, uploadedFileIds);
      newMessage = '';
      pendingAttachments = [];
      shouldStickToBottom = true;
      requestAnimationFrame(() => {
        if (messagesContainer) {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        (document.getElementById('messageInput') as HTMLInputElement | null)?.focus();
      });
    } catch (exception) {
      if (uploadedFileIds.length > 0) {
        await Promise.allSettled(uploadedFileIds.map((fileId) => api.files.deleteChatFile(params.id, fileId)));
      }
      await Promise.allSettled(locallyCachedFileIds.map((fileId) => invalidateCachedFile(fileId)));
      locallyCachedFileIds.forEach((fileId) => forgetChatFileMetadata(params.id, fileId));
      pendingAttachments = pendingAttachments.map((attachment) => ({ ...attachment, uploading: false }));
      error = exception instanceof Error ? exception.message : 'Не удалось отправить сообщение';
    } finally {
      sending = false;
    }
  }

  async function handleDeleteMessage(messageId: string) {
    try {
      await chats.deleteMessage(params.id, messageId);
    } catch (exception) {
      error = exception instanceof Error ? exception.message : 'Не удалось удалить сообщение';
    }
  }

  async function handleFilePick(files: File[]) {
    clearError();
    let quota: Awaited<ReturnType<typeof api.files.listMine>>;
    let reservedBytes = pendingAttachments.reduce((total, attachment) => total + attachment.estimatedStoredSize, 0);
    const acceptedAttachments: PendingAttachment[] = [];
    const rejectedFiles: string[] = [];
    if (!selectedChat?.chatKey || !selectedChat.id) {
      error = 'Ключ чата недоступен';
      return;
    }

    try {
      quota = await api.files.listMine();
    } catch (exception) {
      error = exception instanceof Error ? exception.message : 'Не удалось проверить квоту файлов';
      return;
    }

    for (const file of files) {
      const estimatedStoredSize = estimateStoredFileSize(file);
      if (quota.usedBytes + reservedBytes + estimatedStoredSize > quota.quotaBytes) {
        rejectedFiles.push(file.name);
        continue;
      }

      reservedBytes += estimatedStoredSize;
      acceptedAttachments.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        size: file.size,
        file,
        estimatedStoredSize,
        uploading: false
      });
    }

    if (acceptedAttachments.length > 0) {
      pendingAttachments = [...pendingAttachments, ...acceptedAttachments];
    }

    if (rejectedFiles.length > 0) {
      error =
        rejectedFiles.length === 1
          ? `Недостаточно квоты для файла "${rejectedFiles[0]}"`
          : `Недостаточно квоты для файлов: ${rejectedFiles.join(', ')}`;
    }
  }

  function handleRemoveAttachment(attachmentId: string) {
    clearError();
    pendingAttachments = pendingAttachments.filter((attachment) => attachment.id !== attachmentId);
  }

  async function loadVisibleFileMetadata(chatId: string, currentChatKey: CryptoKey, fileIds: string[]) {
    const generation = fileMetadataGeneration;
    const nextMissingIds = fileIds.filter((fileId) => !fileDisplayById[fileId]);
    const allowedIds = new Set(fileIds);

    if (nextMissingIds.length === 0) {
      Object.keys(fileAssetById)
        .filter((fileId) => !allowedIds.has(fileId))
        .forEach((fileId) => revokeFileAsset(fileId));
      fileDisplayById = Object.fromEntries(
        Object.entries(fileDisplayById).filter(([fileId]) => allowedIds.has(fileId))
      );
      return;
    }

    fileDisplayById = {
      ...fileDisplayById,
      ...Object.fromEntries(nextMissingIds.map((fileId) => [fileId, { status: 'loading' as const }]))
    };

    if (
      !metadataLoadedChatIds.has(chatId) &&
      nextMissingIds.some((fileId) => !chatFileMetadataByChatId[chatId]?.[fileId])
    ) {
      try {
        const chatFilesMetadata = await api.files.downloadChatFilesMetadata(chatId);
        if (generation !== fileMetadataGeneration || selectedChat?.id !== chatId) {
          return;
        }

        chatFileMetadataByChatId = {
          ...chatFileMetadataByChatId,
          [chatId]: Object.fromEntries(
            chatFilesMetadata
              .filter((item) => item.fileId)
              .map((item) => [item.fileId as string, item])
          )
        };
        metadataLoadedChatIds = new Set([...metadataLoadedChatIds, chatId]);
      } catch (exception) {
        if (generation !== fileMetadataGeneration || selectedChat?.id !== chatId) {
          return;
        }

        const message = exception instanceof Error ? exception.message : 'Не удалось загрузить файл';
        fileDisplayById = {
          ...fileDisplayById,
          ...Object.fromEntries(
            nextMissingIds.map((fileId) => [fileId, { status: 'error' as const, name: message }])
          )
        };
        return;
      }
    }

    await Promise.all(
      nextMissingIds.map(async (fileId) => {
        try {
          let downloadedMetadata = chatFileMetadataByChatId[chatId]?.[fileId];
          if (!downloadedMetadata) {
            downloadedMetadata = await api.files.downloadChatFileMetadata(chatId, fileId);
            rememberChatFileMetadata(chatId, downloadedMetadata);
          }

          const decryptedMetadataBytes = await cryptoLib.decryptBinary(
            currentChatKey,
            cryptoLib.base64ToBytes(downloadedMetadata.metadataBase64)
          );
          const metadataText = new TextDecoder().decode(decryptedMetadataBytes);
          const metadata = parseFileMetadataJson(metadataText);

          if (generation !== fileMetadataGeneration || selectedChat?.id !== chatId) {
            return;
          }

          if (!metadata) {
            fileDisplayById = {
              ...fileDisplayById,
              [fileId]: { status: 'error', name: 'Некорректные метаданные' }
            };
            return;
          }

          fileDisplayById = {
            ...fileDisplayById,
            [fileId]: {
              status: 'loading',
              name: metadata.name,
              type: metadata.type,
              size: metadata.size,
              sizeLabel: formatFileSize(metadata.size),
              deletedAt: downloadedMetadata.deletedAt
            }
          };

          const currentAsset = fileAssetById[fileId];
          if (currentAsset && currentAsset.updatedAt === downloadedMetadata.updatedAt) {
            fileDisplayById = {
              ...fileDisplayById,
              [fileId]: {
                status: 'ready',
                name: metadata.name,
                type: metadata.type,
                size: metadata.size,
                sizeLabel: formatFileSize(metadata.size),
                deletedAt: downloadedMetadata.deletedAt
              }
            };
            return;
          }

          const cachedAsset = await getCachedFile(fileId, downloadedMetadata.updatedAt);
          if (cachedAsset) {
            if (generation !== fileMetadataGeneration || selectedChat?.id !== chatId) {
              return;
            }

            fileAssetById = {
              ...fileAssetById,
              [fileId]: cachedAsset
            };

            fileDisplayById = {
              ...fileDisplayById,
              [fileId]: {
                status: 'ready',
                name: metadata.name,
                type: metadata.type,
                size: metadata.size,
                sizeLabel: formatFileSize(metadata.size),
                deletedAt: downloadedMetadata.deletedAt
              }
            };
            return;
          }

          const downloadedContent = await api.files.downloadChatFileContent(chatId, fileId);
          const decryptedContent = await cryptoLib.decryptBinary(currentChatKey, downloadedContent.content);

          if (generation !== fileMetadataGeneration || selectedChat?.id !== chatId) {
            return;
          }

          const blob = new Blob([Uint8Array.from(decryptedContent).buffer], {
            type: metadata.type || 'application/octet-stream'
          });
          const cachedFileAsset = await cacheFile(fileId, blob, {
            type: metadata.type || 'application/octet-stream',
            name: metadata.name,
            updatedAt: downloadedContent.updatedAt
          });

          fileAssetById = {
            ...fileAssetById,
            [fileId]: {
              objectUrl: cachedFileAsset.objectUrl,
              type: cachedFileAsset.type,
              name: cachedFileAsset.name,
              updatedAt: cachedFileAsset.updatedAt
            }
          };

          fileDisplayById = {
            ...fileDisplayById,
            [fileId]: {
              status: 'ready',
              name: metadata.name,
              type: metadata.type,
              size: metadata.size,
              sizeLabel: formatFileSize(metadata.size),
              deletedAt: downloadedContent.deletedAt
            }
          };
        } catch (exception) {
          if (generation !== fileMetadataGeneration || selectedChat?.id !== chatId) {
            return;
          }

          if (exception instanceof Error && exception.message === 'File not found') {
            await invalidateCachedFile(fileId).catch(() => {});
            forgetChatFileMetadata(chatId, fileId);
          }

          const message = exception instanceof Error ? exception.message : 'Не удалось загрузить файл';
          fileDisplayById = {
            ...fileDisplayById,
            [fileId]:
              message === 'File not found'
                ? { status: 'missing', name: 'Файл удалён' }
                : { status: 'error', name: 'Ошибка загрузки' }
          };
        }
      })
    );
  }

  function handleOpenFile(fileId: string) {
    const asset = fileAssetById[fileId];
    const display = fileDisplayById[fileId];
    if (!asset || display?.status !== 'ready') {
      return;
    }

    const isPreviewable =
      asset.type.startsWith('image/') ||
      asset.type === 'application/pdf' ||
      asset.type.startsWith('text/');

    if (isPreviewable) {
      window.open(asset.objectUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    const link = document.createElement('a');
    link.href = asset.objectUrl;
    link.download = asset.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function searchUsers() {
    if (!userSearch.trim()) {
      searchResults = [];
      return;
    }

    searching = true;
    try {
      searchResults = await api.users.search(userSearch);
    } catch {
      searchResults = [];
    } finally {
      searching = false;
    }
  }

  async function addMember(userId: string) {
    addingMember = true;
    try {
      const user = searchResults.find((item) => item.id === userId);
      if (!user) return;

      await chats.addMember(params.id, userId, user.publicKey);
      showAddMemberModal = false;
      userSearch = '';
      searchResults = [];
    } catch (exception) {
      error = exception instanceof Error ? exception.message : 'Не удалось добавить участника';
    } finally {
      addingMember = false;
    }
  }

  async function removeMember(userId: string) {
    try {
      await chats.removeMember(params.id, userId);
      showMembersModal = false;
    } catch (exception) {
      error = exception instanceof Error ? exception.message : 'Не удалось удалить участника';
    }
  }

  async function handleLeaveChat() {
    if (!confirm('Вы уверены, что хотите покинуть этот чат?')) return;

    try {
      await chats.leaveChat(params.id);
      window.location.hash = '#/chats';
    } catch (exception) {
      error = exception instanceof Error ? exception.message : 'Не удалось покинуть чат';
    }
  }

  async function handleDeleteChat() {
    if (!confirm('Вы уверены, что хотите удалить этот чат?')) return;

    try {
      await chats.deleteChat(params.id);
      window.location.hash = '#/chats';
    } catch (exception) {
      error = exception instanceof Error ? exception.message : 'Не удалось удалить чат';
    }
  }

  $: if (params.id && params.id !== loadedChatId) {
    loadedChatId = params.id;
    clearError();
    pendingAttachments = [];
    resetFileCaches();
    chats
      .ensureChatLoaded(params.id)
      .then(() => {
        shouldStickToBottom = true;
        requestAnimationFrame(() => {
          if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
          }
        });
      })
      .catch((exception) => {
        error = exception instanceof Error ? exception.message : 'Не удалось загрузить чат';
      });
  }

  $: if (selectedChat?.id && messagesContainer && (selectedChat.unreadCount ?? 0) > 0) {
    pendingReadCheckForChatId = selectedChat.id;
    tick().then(() => {
      if (pendingReadCheckForChatId !== selectedChat?.id) return;
      markChatAsReadIfFullyVisible().catch(() => {});
    });
  }

  onDestroy(() => {
    if (scrollTimeout) clearTimeout(scrollTimeout);
    if (errorTimeout) clearTimeout(errorTimeout);
    resetFileCaches();
  });
</script>

<div class="chat-container">
  <header>
    <h2>
      {#if selectedChat?.type === 'pm' && otherUserName}
        {otherUserName}
      {:else}
        {selectedChat?.name || 'Чат'}
      {/if}
    </h2>
    {#if chatKey}
      <div class="header-actions">
        <button class="icon-btn" type="button" on:click={() => (showMembersModal = true)} title="Участники">👥</button>
        {#if isCreator && selectedChat?.type === 'gm'}
          <button class="icon-btn" type="button" on:click={() => (showAddMemberModal = true)} title="Добавить участника">+</button>
        {:else if selectedChat?.type === 'gm'}
          <button class="icon-btn leave-btn" type="button" on:click={handleLeaveChat} title="Покинуть чат">←</button>
        {/if}
      </div>
    {/if}
  </header>

  {#if !selectedChat?.isHydrated && !messages.length}
    <div class="loading">Загрузка...</div>
  {:else}
    {#if error}
      <div class="error-toast" role="alert" aria-live="assertive">
        <span>{error}</span>
        <button type="button" class="error-toast-close" on:click={clearError} aria-label="Закрыть ошибку">
          ×
        </button>
      </div>
    {/if}

    <MessageList
      bind:container={messagesContainer}
      {groupedMessages}
      currentUserId={$auth.user?.id}
      {showPlaceholder}
      {memberAvatarUrls}
      fileDisplayById={fileDisplayById}
      unreadMarkerId={selectedChat?.unreadMarkerId}
      on:scroll={handleContainerScroll}
      on:fileclick={(event) => handleOpenFile(event.detail.fileId)}
      on:messagecontextmenu={(event) => handleContextMenu(event.detail.event, event.detail.messageId, event.detail.senderId)}
    />

    {#if typingMemberNames.length > 0}
      <div class="typing-indicator" aria-live="polite">
        {#if typingMemberNames.length === 1}
          {typingMemberNames[0]} печатает...
        {:else if typingMemberNames.length === 2}
          {typingMemberNames[0]} и {typingMemberNames[1]} печатают...
        {:else}
          Несколько человек печатают...
        {/if}
      </div>
    {/if}

    <MessageInput
      bind:value={newMessage}
      disabled={sending || !chatKey}
      attachments={pendingAttachments}
      attachmentsDisabled={sending || !chatKey}
      {sending}
      on:submit={handleSendMessage}
      on:pickfiles={(event) => handleFilePick(event.detail.files)}
      on:removeattachment={(event) => handleRemoveAttachment(event.detail.id)}
    />

    {#if editingMessage}
      <div class="edit-area">
        <input
          type="text"
          bind:value={editingText}
          placeholder="Редактировать сообщение..."
          on:keydown={(event) => {
            if (event.key === 'Enter') handleEditMessage();
            if (event.key === 'Escape') cancelEdit();
          }}
        />
        <button class="edit-save" type="button" on:click={handleEditMessage} disabled={!editingText.trim()}>Сохранить</button>
        <button class="edit-cancel" type="button" on:click={cancelEdit}>Отмена</button>
      </div>
    {/if}
  {/if}

  {#if contextMenu.visible}
    <div class="context-menu" style="left: {contextMenu.x}px; top: {contextMenu.y}px;" role="menu">
      <button class="context-menu-item disabled" type="button" disabled>Ответить</button>
      <button class="context-menu-item disabled" type="button" disabled>Закрепить</button>
      <button class="context-menu-item disabled" type="button" disabled>Скопировать</button>
      {#if isOwnMessage}
        <button
          class="context-menu-item"
          type="button"
          on:click={() => {
            const message = messages.find((item) => item.id === contextMenu.messageId);
            if (message) handleEditFromMenu(message);
          }}
        >
          Редактировать
        </button>
        <button class="context-menu-item danger" type="button" on:click={handleDeleteFromMenu}>Удалить</button>
      {/if}
    </div>
    <button class="context-menu-overlay" type="button" on:click={closeContextMenu} aria-label="Закрыть меню"></button>
  {/if}
</div>

{#if showAddMemberModal}
  <div class="modal-shell">
    <button
      class="modal-overlay"
      type="button"
      aria-label="Закрыть окно добавления участника"
      on:click={() => (showAddMemberModal = false)}
    ></button>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="add-member-title">
      <h3 id="add-member-title">Добавить участника</h3>
      <div class="field">
        <label for="userSearch">Поиск пользователей</label>
        <input
          id="userSearch"
          type="text"
          bind:value={userSearch}
          on:input={searchUsers}
          placeholder="Введите имя пользователя..."
        />
      </div>
      {#if searching}
        <p>Поиск...</p>
      {:else if searchResults.length > 0}
        <div class="search-results">
          {#each searchResults as user}
            {@const isAlreadyMember = Boolean(selectedChat?.members?.some((member) => member.id === user.id))}
            <button class="search-result" type="button" disabled={isAlreadyMember || addingMember} on:click={() => addMember(user.id)}>
              {user.username}
              {#if isAlreadyMember}
                (already in chat)
              {/if}
            </button>
          {/each}
        </div>
      {/if}
      <div class="modal-actions">
        <button type="button" on:click={() => (showAddMemberModal = false)}>Отмена</button>
      </div>
    </div>
  </div>
{/if}

{#if showMembersModal}
  <MembersModal
    members={selectedChat?.members ?? []}
    {isCreator}
    chatType={selectedChat?.type ?? 'gm'}
    currentUserId={$auth.user?.id}
    on:close={() => (showMembersModal = false)}
    on:deleteChat={handleDeleteChat}
    on:remove={(event) => removeMember(event.detail.userId)}
  />
{/if}

<style>
  .chat-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  header {
    padding: 16px 24px;
    border-bottom: 1px solid #e0e0e0;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }

  .loading {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #888;
  }

  .error-toast {
    position: absolute;
    top: 72px;
    right: 24px;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: min(420px, calc(100% - 48px));
    padding: 12px 14px;
    border-radius: 10px;
    background: rgba(127, 29, 29, 0.96);
    color: white;
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.18);
    font-size: 14px;
  }

  .error-toast-close {
    width: 28px;
    height: 28px;
    min-width: 28px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.14);
    color: white;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
  }

  .error-toast-close:hover {
    background: rgba(255, 255, 255, 0.24);
  }

  .header-actions {
    display: flex;
    gap: 8px;
    margin-left: auto;
  }

  .icon-btn {
    width: 36px;
    height: 36px;
    border: none;
    border-radius: 8px;
    background: #f0f0f0;
    cursor: pointer;
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .icon-btn:hover {
    background: #e0e0e0;
  }

  .edit-area {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid #e0e0e0;
    background: #f5f5f5;
  }

  .typing-indicator {
    padding: 8px 24px 0;
    font-size: 13px;
    color: #6b7280;
    font-style: italic;
  }

  .edit-area input {
    flex: 1;
    padding: 10px 12px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 15px;
  }

  .edit-save,
  .edit-cancel {
    padding: 10px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    border: none;
  }

  .edit-save {
    background: #4caf50;
    color: white;
  }

  .edit-save:disabled {
    background: #ccc;
    cursor: not-allowed;
  }

  .edit-cancel {
    background: #f5f5f5;
    color: #666;
    border: 1px solid #ddd;
  }

  .context-menu-overlay {
    position: fixed;
    inset: 0;
    z-index: 99;
    background: transparent;
    border: none;
    padding: 0;
  }

  .context-menu {
    position: fixed;
    background: white;
    border: 1px solid #ddd;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 100;
    min-width: 120px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .context-menu-item {
    padding: 10px 16px;
    cursor: pointer;
    font-size: 14px;
    color: #333;
    text-align: left;
    border: none;
    background: white;
  }

  .context-menu-item:hover:not(:disabled) {
    background: #f5f5f5;
  }

  .context-menu-item:disabled {
    color: #999;
    cursor: default;
  }

  .context-menu-item.danger {
    color: #f44336;
  }

  .modal-shell {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    border: none;
    padding: 0;
    cursor: default;
  }

  .modal {
    position: relative;
    background: white;
    padding: 28px;
    border-radius: 14px;
    width: 400px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
    z-index: 1;
  }

  .field {
    margin-bottom: 16px;
  }

  .field label {
    display: block;
    margin-bottom: 8px;
    font-weight: 600;
    font-size: 14px;
  }

  .field input {
    width: 100%;
    padding: 12px;
    border: 1px solid #ddd;
    border-radius: 8px;
    font-size: 15px;
    box-sizing: border-box;
  }

  .search-results {
    max-height: 200px;
    overflow-y: auto;
    border: 1px solid #eee;
    border-radius: 8px;
    margin-top: 12px;
  }

  .search-result {
    width: 100%;
    padding: 12px 16px;
    text-align: left;
    border: none;
    background: white;
    cursor: pointer;
    border-bottom: 1px solid #f0f0f0;
    font-size: 15px;
  }

  .search-result:hover:not(:disabled) {
    background: #f9f9f9;
  }

  .search-result:disabled {
    color: #999;
    cursor: not-allowed;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 20px;
  }
</style>

