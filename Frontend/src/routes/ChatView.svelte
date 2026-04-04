<script lang="ts">
  import { createEventDispatcher, onDestroy, tick } from 'svelte';
  import { api } from '../lib/api';
  import { auth, chats, type Chat } from '../lib/stores';
  import { deletedFilesEvent, pinsUpdatedEvent } from '../lib/sse';
  import * as cryptoLib from '../lib/crypto';
  import { cacheFile, getCachedFile, invalidateCachedFile, type CachedFileAsset } from '../lib/file-cache';
  import MessageList from '../components/chat/MessageList.svelte';
  import MessageInput from '../components/chat/MessageInput.svelte';
  import ChatImagePickerModal from '../components/chat/ChatImagePickerModal.svelte';
  import ChatAttachmentBrowserModal from '../components/chat/ChatAttachmentBrowserModal.svelte';
  import ChatImageCarouselModal from '../components/chat/ChatImageCarouselModal.svelte';
  import PinnedMessagesModal from '../components/chat/PinnedMessagesModal.svelte';
  import ChatExportModal from '../components/chat/ChatExportModal.svelte';
  import MembersModal from '../components/chat/MembersModal.svelte';
  import AvatarCropModal from '../components/settings/AvatarCropModal.svelte';
  import { getFavoriteChatImageIds, toggleFavoriteChatImage } from '../lib/chat-image-favorites';
  import { createZipBlob } from '../lib/zip';
  import { decryptMessagesForDisplay, formatFileSize, getSystemMessageContent, isSystemMessage, parseFileMetadataJson, parseSystemMessage } from '../lib/chat-helpers';
  import type { ChatFileMetadata, ChatMember, Message, SearchUserResult } from '../lib/types';

  export let params: { id: string };
  export let chatDetail: Chat | null = null;
  export let showBackButton = false;

  const dispatch = createEventDispatcher<{
    back: void;
  }>();

  let error = '';
  let newMessage = '';
  let sending = false;
  let showAddMemberModal = false;
  let showMembersModal = false;
  let showRenameChatModal = false;
  let showChatAvatarModal = false;
  let showImageLibraryModal = false;
  let showAttachmentBrowserModal = false;
  let showImageCarouselModal = false;
  let showPinnedMessagesModal = false;
  let showExportModal = false;
  let showLeaveChatModal = false;
  let showRemoveMemberModal = false;
  let showDeleteMessageModal = false;
  let userSearch = '';
  let searchResults: SearchUserResult[] = [];
  let searching = false;
  let addingMember = false;
  let renamingChat = false;
  let updatingChatAvatar = false;
  let leavingChat = false;
  let removingMember = false;
  let renameChatValue = '';
  let pendingChatAvatarFile: File | null = null;
  let dragDepth = 0;
  let loadingImageLibrary = false;
  let loadingAttachmentBrowser = false;
  let exportingHistory = false;
  let imageLibraryItems: Array<{
    fileId: string;
    previewUrl: string | null;
    metadata: ChatFileMetadata;
    updatedAt: number;
    isFavorite: boolean;
  }> = [];
  let attachmentBrowserKind: 'images' | 'documents' | 'media' = 'images';
  let attachmentBrowserTitle = 'Вложения';
  let attachmentBrowserItems: Array<{
    fileId: string;
    previewUrl: string | null;
    metadata: ChatFileMetadata;
    updatedAt: number;
  }> = [];
  let imageCarouselItems: Array<{ fileId: string; src: string; name: string }> = [];
  let activeCarouselFileId: string | null = null;
  let attachmentCounts = { images: 0, documents: 0, media: 0 };
  let selectedReusableAttachments: Array<{ id: string; fileId: string; name: string; size: number }> = [];
  let memberToRemove: ChatMember | null = null;
  let messagePendingDeletionId: string | null = null;
  let replyTarget: Message | null = null;
  let activePinnedIndex = 0;
  let activePinnedChatId: string | null = null;
  let activePinnedCount = 0;
  let leaveDeleteMessages = false;
  let leaveDeleteFiles = false;
  let removeDeleteMessages = false;
  let removeDeleteFiles = false;
  let exportFromDate = '';
  let exportToDate = '';
  let exportIncludeImages = true;
  let exportIncludeDocuments = true;
  let exportIncludeMedia = true;
  let contextMenu: { x: number; y: number; messageId: string; senderId: string | null; visible: boolean } = {
    x: 0,
    y: 0,
    messageId: '',
    senderId: null,
    visible: false
  };
  let editingMessage: { id: string; content: string; fileIds: string[] } | null = null;
  let editingText = '';
  let messagesContainer: HTMLDivElement | undefined;
  let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
  let errorTimeout: ReturnType<typeof setTimeout> | null = null;
  let loadedChatId: string | null = null;
  let composerResetToken = 0;
  let pendingReadCheckForChatId: string | null = null;
  let shouldStickToBottom = true;
  let previousMessageCount = 0;
  let previousInlinePreviewCount = 0;
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
      previewDataUrl?: string;
      previewWidth?: number;
      previewHeight?: number;
    }
  > = {};
  let fileAssetById: Record<string, CachedFileAsset> = {};
  let imagePreviewById: Record<string, { objectUrl: string; width: number; height: number; alt: string }> = {};
  let chatFileMetadataByChatId: Record<
    string,
    Record<string, Awaited<ReturnType<typeof api.files.downloadChatFilesMetadata>>[number]>
  > = {};
  let decryptedChatFileMetadataByChatId: Record<string, Record<string, ChatFileMetadata>> = {};
  let metadataLoadedChatIds = new Set<string>();
  let fileMetadataGeneration = 0;
  const imagePreviewResolutionInFlight = new Set<string>();

  const TYPING_THROTTLE_MS = 3000;
  const ERROR_TOAST_DURATION_MS = 4000;
  const MAX_ATTACHMENTS_PER_MESSAGE = 10;
  const MAX_MESSAGE_LENGTH = 8000;
  const EXPORT_MESSAGES_PAGE_SIZE = 100;

  $: selectedChat = $chats.find((chat) => chat.id === params.id) ?? chatDetail;
  $: messages = selectedChat?.messages ?? [];
  $: chatKey = selectedChat?.chatKey ?? null;
  $: otherUserName = selectedChat?.otherUser?.username ?? null;
  $: chatDisplayName =
    selectedChat?.type === 'pm' && otherUserName ? otherUserName : selectedChat?.name || 'Чат';
  $: chatDisplayAvatarUrl = selectedChat?.type === 'pm' ? selectedChat?.otherUser?.avatarUrl ?? null : selectedChat?.avatarUrl ?? null;
  $: chatPresenceLabel =
    selectedChat?.type === 'pm'
      ? selectedChat?.otherUser?.isOnline
        ? 'в сети'
        : 'не в сети'
      : '';
  $: onlineMembersCount = (selectedChat?.members ?? []).filter((member) => member.isOnline).length;
  $: canAddMembers = Boolean(isCreator && selectedChat?.type === 'gm');
  $: isCreator = selectedChat?.createdBy === $auth.user?.id;
  $: isOwnMessage = contextMenu.senderId === $auth.user?.id;
  $: canDeleteContextMessage =
    isOwnMessage ||
    Boolean(
      isCreator &&
        selectedChat?.type === 'gm' &&
        contextMenu.senderId &&
        contextMenu.senderId !== $auth.user?.id
    );
  $: isPinnedMessage = Boolean(selectedChat?.pinnedMessages?.some((item) => item.message.id === contextMenu.messageId));
  $: typingMemberNames = (selectedChat?.typingUsers ?? [])
    .map((entry) => selectedChat?.members?.find((member) => member.id === entry.userId)?.username)
    .filter((username): username is string => Boolean(username));
  $: memberAvatarUrls = Object.fromEntries((selectedChat?.members ?? []).map((member) => [member.id, member.avatarUrl ?? null]));
  $: visibleFileIds = Array.from(new Set(messages.flatMap((message) => message.fileIds)));
  $: isDragActive = dragDepth > 0;
  $: pinnedMessages = selectedChat?.pinnedMessages ?? [];
  $: if ((selectedChat?.id ?? null) !== activePinnedChatId) {
    activePinnedChatId = selectedChat?.id ?? null;
    activePinnedIndex = Math.max(0, pinnedMessages.length - 1);
    activePinnedCount = pinnedMessages.length;
  }
  $: if ((selectedChat?.id ?? null) === activePinnedChatId && pinnedMessages.length !== activePinnedCount) {
    if (pinnedMessages.length > activePinnedCount) {
      activePinnedIndex = Math.max(0, pinnedMessages.length - 1);
    } else if (activePinnedIndex >= pinnedMessages.length) {
      activePinnedIndex = Math.max(0, pinnedMessages.length - 1);
    }
    activePinnedCount = pinnedMessages.length;
  }
  $: if (activePinnedIndex >= pinnedMessages.length) {
    activePinnedIndex = Math.max(0, pinnedMessages.length - 1);
  }
  $: currentPinnedMessage = pinnedMessages[activePinnedIndex] ?? null;
  $: pinnedCounterLabel = pinnedMessages.length > 0 ? `📌 ${activePinnedIndex + 1}/${pinnedMessages.length}` : '';
  $: if (replyTarget) {
    const currentReplyTarget = messages.find((message) => message.id === replyTarget?.id) ?? null;
    if (!currentReplyTarget) {
      replyTarget = null;
    } else if (currentReplyTarget !== replyTarget) {
      replyTarget = currentReplyTarget;
    }
  }

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
    metadata: ChatFileMetadata;
    uploading?: boolean;
  };

  $: composerAttachments = [
    ...selectedReusableAttachments.map((attachment) => ({
      id: attachment.id,
      name: `${attachment.name} (из чата)`,
      size: attachment.size,
      uploading: false
    })),
    ...pendingAttachments
  ];

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

  function rememberDecryptedChatFileMetadata(chatId: string, fileId: string, metadata: ChatFileMetadata) {
    decryptedChatFileMetadataByChatId = {
      ...decryptedChatFileMetadataByChatId,
      [chatId]: {
        ...(decryptedChatFileMetadataByChatId[chatId] ?? {}),
        [fileId]: metadata
      }
    };
  }

  function forgetChatFileMetadata(chatId: string, fileId: string) {
    const currentChatMetadata = chatFileMetadataByChatId[chatId];
    const currentDecryptedMetadata = decryptedChatFileMetadataByChatId[chatId];
    if (!currentChatMetadata?.[fileId] && !currentDecryptedMetadata?.[fileId]) return;

    const nextChatMetadata = { ...(currentChatMetadata ?? {}) };
    delete nextChatMetadata[fileId];
    const nextDecryptedMetadata = { ...(currentDecryptedMetadata ?? {}) };
    delete nextDecryptedMetadata[fileId];

    chatFileMetadataByChatId = {
      ...chatFileMetadataByChatId,
      [chatId]: nextChatMetadata
    };
    decryptedChatFileMetadataByChatId = {
      ...decryptedChatFileMetadataByChatId,
      [chatId]: nextDecryptedMetadata
    };
  }

  function revokeFileAsset(fileId: string) {
    const nextAssets = { ...fileAssetById };
    delete nextAssets[fileId];
    fileAssetById = nextAssets;

    const nextImagePreviews = { ...imagePreviewById };
    delete nextImagePreviews[fileId];
    imagePreviewById = nextImagePreviews;
    imagePreviewResolutionInFlight.delete(fileId);
  }

  async function cleanupDeletedFiles(chatId: string, fileIds: string[]) {
    if (fileIds.length === 0) {
      return;
    }

    await Promise.allSettled(fileIds.map((fileId) => invalidateCachedFile(fileId)));
    fileIds.forEach((fileId) => {
      forgetChatFileMetadata(chatId, fileId);
      revokeFileAsset(fileId);
    });

    selectedReusableAttachments = selectedReusableAttachments.filter(
      (attachment) => !fileIds.includes(attachment.fileId)
    );
    imageLibraryItems = imageLibraryItems.filter((item) => !fileIds.includes(item.fileId));
    attachmentBrowserItems = attachmentBrowserItems.filter((item) => !fileIds.includes(item.fileId));
  }

  function resetFileCaches() {
    fileMetadataGeneration += 1;
    fileAssetById = {};
    fileDisplayById = {};
    imagePreviewById = {};
    imagePreviewResolutionInFlight.clear();
  }

  function hasDraggedFiles(dataTransfer: DataTransfer | null) {
    if (!dataTransfer) {
      return false;
    }

    const types = Array.from(dataTransfer.types ?? []);
    return types.includes('Files') || types.includes('application/x-moz-file');
  }

  function extractDroppedFiles(dataTransfer: DataTransfer | null) {
    if (!dataTransfer) {
      return [];
    }

    return Array.from(dataTransfer.files ?? []);
  }

  function handleDragEnter(event: DragEvent) {
    if (!hasDraggedFiles(event.dataTransfer) || sending || !chatKey) {
      return;
    }

    event.preventDefault();
    dragDepth += 1;
  }

  function handleDragOver(event: DragEvent) {
    if (!hasDraggedFiles(event.dataTransfer) || sending || !chatKey) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  function handleDragLeave(event: DragEvent) {
    if (!hasDraggedFiles(event.dataTransfer) || sending || !chatKey) {
      return;
    }

    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
  }

  async function handleDrop(event: DragEvent) {
    const droppedFiles = extractDroppedFiles(event.dataTransfer);
    if (!droppedFiles.length || sending || !chatKey) {
      return;
    }

    event.preventDefault();
    dragDepth = 0;
    await handleFilePick(droppedFiles);
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

  async function handleCopyMessage() {
    const message = messages.find((item) => item.id === contextMenu.messageId);
    closeContextMenu();

    if (!message?.content?.trim()) {
      showSoonToast('В сообщении нет текста для копирования');
      return;
    }

    try {
      await navigator.clipboard.writeText(message.content);
      showSoonToast('Текст сообщения скопирован');
    } catch {
      showSoonToast('Не удалось скопировать текст сообщения');
    }
  }

  function getReplyPreviewText(message: Message | null | undefined) {
    if (!message?.reply) {
      return '';
    }

    if (message.reply.isDeleted) {
      return 'Сообщение удалено';
    }

    if (message.reply.content?.trim()) {
      return message.reply.content;
    }

    if (message.reply.fileIds.length > 0) {
      return 'Вложение';
    }

    return 'Сообщение';
  }

  function getReplyTargetPreviewText(message: Message | null | undefined) {
    if (!message) {
      return '';
    }

    const attachmentNames = message.fileIds
      .map((fileId) => fileDisplayById[fileId]?.name?.trim() || '')
      .filter(Boolean);

    if (message.content?.trim()) {
      return message.content;
    }

    if (message.fileIds.length > 0) {
      return attachmentNames.length > 0 ? attachmentNames.join(', ') : 'Вложение';
    }

    return 'Сообщение';
  }

  function isAttachmentOnlyMessage(message: Message | null | undefined) {
    return Boolean(message && !message.content?.trim() && message.fileIds.length > 0);
  }

  function getPinnedPreviewText(message: Message | null | undefined) {
    if (!message) {
      return '';
    }

    const attachmentNames = message.fileIds
      .map((fileId) => fileDisplayById[fileId]?.name?.trim() || '')
      .filter(Boolean);

    if (message.content?.trim()) {
      return message.content;
    }

    if (message.fileIds.length > 0) {
      return attachmentNames.length > 0 ? attachmentNames.join(', ') : 'Вложение';
    }

    return 'Сообщение';
  }

  function scrollToMessage(messageId: string | null | undefined) {
    if (!messageId || !messagesContainer) {
      return;
    }

    const target = messagesContainer.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null;
    if (!target) {
      return;
    }

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function startReply(message: Message) {
    replyTarget = message;
    closeContextMenu();
    requestAnimationFrame(() => {
      (document.getElementById('messageInput') as HTMLTextAreaElement | null)?.focus();
    });
  }

  async function togglePinFromMenu() {
    const messageId = contextMenu.messageId;
    closeContextMenu();
    if (!messageId || !selectedChat?.id) {
      return;
    }

    try {
      if (isPinnedMessage) {
        await chats.unpinMessage(selectedChat.id, messageId);
      } else {
        const nextPinnedMessages = await chats.pinMessage(selectedChat.id, messageId);
        activePinnedIndex = Math.max(0, nextPinnedMessages.length - 1);
      }
    } catch (exception) {
      showSoonToast(exception instanceof Error ? exception.message : 'Не удалось обновить закреп');
    }
  }

  async function unpinMessage(messageId: string) {
    if (!selectedChat?.id) {
      return;
    }

    try {
      const nextPinnedMessages = await chats.unpinMessage(selectedChat.id, messageId);
      if (nextPinnedMessages.length === 0) {
        showPinnedMessagesModal = false;
        activePinnedIndex = 0;
      } else if (currentPinnedMessage?.message.id === messageId) {
        activePinnedIndex = Math.max(0, Math.min(activePinnedIndex, nextPinnedMessages.length - 1));
      }
    } catch (exception) {
      showSoonToast(exception instanceof Error ? exception.message : 'Не удалось снять закреп');
    }
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
  $: if (messagesContainer) {
    const currentInlinePreviewCount = Object.keys(imagePreviewById).length;
    const shouldScrollToBottom = currentInlinePreviewCount > previousInlinePreviewCount && shouldStickToBottom;
    previousInlinePreviewCount = currentInlinePreviewCount;

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
  $: Object.entries(fileAssetById).forEach(([fileId, asset]) => {
    ensureInlineImagePreview(fileId, asset);
  });
  $: if (visibleFileIds.length === 0 && Object.keys(fileDisplayById).length > 0) {
    resetFileCaches();
  }

  async function handleDeleteFromMenu() {
    if (contextMenu.messageId) {
      messagePendingDeletionId = contextMenu.messageId;
      showDeleteMessageModal = true;
    }
    closeContextMenu();
  }

  function handleEditFromMenu(message: Message) {
    editingMessage = { id: message.id, content: message.content, fileIds: [...message.fileIds] };
    editingText = message.content;
    closeContextMenu();
  }

  async function handleEditMessage() {
    if (!editingMessage || (!editingText.trim() && editingMessage.fileIds.length === 0)) return;
    if (editingText.length > MAX_MESSAGE_LENGTH) {
      error = `Сообщение не должно превышать ${MAX_MESSAGE_LENGTH} символов`;
      return;
    }

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

  function cancelReply() {
    replyTarget = null;
  }

  function clearError() {
    if (errorTimeout) {
      clearTimeout(errorTimeout);
      errorTimeout = null;
    }
    error = '';
  }

  function showSoonToast(message: string) {
    clearError();
    error = message;
  }

  function openChatAvatarPicker() {
    document.getElementById('chatAvatarInput')?.click();
  }

  function handleChatAvatarFileChange(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';

    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      error = 'Поддерживаются только JPEG, PNG и WebP';
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      error = 'Размер файла не должен превышать 5 МБ';
      return;
    }

    pendingChatAvatarFile = file;
    showChatAvatarModal = true;
  }

  function computeInlineImagePreviewSize(width: number, height: number) {
    const minDownscaledPreviewSize = 48;
    const minUpscaledPreviewSize = 128;
    const maxPreviewWidth = Math.max(180, Math.min(360, window.innerWidth - 160));
    const maxPreviewHeight = Math.max(180, Math.min(360, window.innerHeight - 220));

    const downscaleFactor = Math.min(maxPreviewWidth / width, maxPreviewHeight / height, 1);
    const downscaledWidth = Math.round(width * downscaleFactor);
    const downscaledHeight = Math.round(height * downscaleFactor);

    if (downscaledWidth >= minDownscaledPreviewSize && downscaledHeight >= minDownscaledPreviewSize) {
      return { width: downscaledWidth, height: downscaledHeight };
    }

    const upscaleFactor = Math.max(minUpscaledPreviewSize / width, minUpscaledPreviewSize / height);
    const upscaledWidth = Math.round(width * upscaleFactor);
    const upscaledHeight = Math.round(height * upscaleFactor);

    if (upscaledWidth <= maxPreviewWidth && upscaledHeight <= maxPreviewHeight) {
      return { width: upscaledWidth, height: upscaledHeight };
    }

    return null;
  }

  function ensureInlineImagePreview(fileId: string, asset: CachedFileAsset) {
    if (!asset.type.startsWith('image/')) return;
    if (imagePreviewById[fileId] || imagePreviewResolutionInFlight.has(fileId)) return;

    imagePreviewResolutionInFlight.add(fileId);
    const image = new Image();
    image.onload = () => {
      imagePreviewResolutionInFlight.delete(fileId);

      const previewSize = computeInlineImagePreviewSize(image.naturalWidth, image.naturalHeight);
      if (!previewSize) {
        return;
      }

      imagePreviewById = {
        ...imagePreviewById,
        [fileId]: {
          objectUrl: asset.objectUrl,
          width: previewSize.width,
          height: previewSize.height,
          alt: asset.name
        }
      };
    };
    image.onerror = () => {
      imagePreviewResolutionInFlight.delete(fileId);
    };
    image.src = asset.objectUrl;
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

  async function buildFileMetadata(file: File): Promise<ChatFileMetadata> {
    const metadata: ChatFileMetadata = {
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size
    };

    if (!metadata.type.startsWith('image/')) {
      return metadata;
    }

    try {
      const image = await loadImageFromFile(file);
      metadata.width = image.naturalWidth;
      metadata.height = image.naturalHeight;
      metadata.previewDataUrl = createPreviewDataUrl(image, 16);
    } catch {
      return metadata;
    }

    return metadata;
  }

  function loadImageFromFile(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Image load failed'));
      };
      image.src = objectUrl;
    });
  }

  function createPreviewDataUrl(image: HTMLImageElement, size: number) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) {
      return undefined;
    }

    context.clearRect(0, 0, size, size);
    const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
    const targetWidth = Math.max(1, Math.round(image.naturalWidth * scale));
    const targetHeight = Math.max(1, Math.round(image.naturalHeight * scale));
    const offsetX = Math.floor((size - targetWidth) / 2);
    const offsetY = Math.floor((size - targetHeight) / 2);
    context.drawImage(image, offsetX, offsetY, targetWidth, targetHeight);
    return canvas.toDataURL('image/webp', 0.6);
  }

  async function ensureAllChatMetadataLoaded(chatId: string) {
    let allMetadata = chatFileMetadataByChatId[chatId];
    if (allMetadata) {
      return allMetadata;
    }

    const downloadedMetadata = await api.files.downloadChatFilesMetadata(chatId);
    allMetadata = Object.fromEntries(
      downloadedMetadata
        .filter((item) => item.fileId)
        .map((item) => [item.fileId as string, item])
    );

    chatFileMetadataByChatId = {
      ...chatFileMetadataByChatId,
      [chatId]: allMetadata
    };
    metadataLoadedChatIds = new Set([...metadataLoadedChatIds, chatId]);
    return allMetadata;
  }

  async function ensureAllChatMetadataDecrypted(chatId: string, currentChatKey: CryptoKey) {
    const existing = decryptedChatFileMetadataByChatId[chatId];
    const encryptedMetadata = await ensureAllChatMetadataLoaded(chatId);
    const missingEntries = Object.values(encryptedMetadata).filter(
      (entry) => entry.fileId && !entry.deletedAt && !existing?.[entry.fileId]
    );

    if (existing && missingEntries.length === 0) {
      return existing;
    }

    const nextDecrypted = { ...(existing ?? {}) };

    for (const metadataEntry of missingEntries) {
      if (!metadataEntry.fileId) continue;

      const decryptedMetadataBytes = await cryptoLib.decryptBinary(
        currentChatKey,
        cryptoLib.base64ToBytes(metadataEntry.metadataBase64)
      );
      const metadataText = new TextDecoder().decode(decryptedMetadataBytes);
      const metadata = parseFileMetadataJson(metadataText);
      if (metadata) {
        nextDecrypted[metadataEntry.fileId] = metadata;
      }
    }

    decryptedChatFileMetadataByChatId = {
      ...decryptedChatFileMetadataByChatId,
      [chatId]: nextDecrypted
    };

    return nextDecrypted;
  }

  function escapeHtml(value: string) {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function toExportTimestamp(value: string, endOfRange = false) {
    if (!value) {
      return null;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    if (endOfRange && !value.includes('T')) {
      date.setHours(23, 59, 59, 999);
    }

    return Math.floor(date.getTime() / 1000);
  }

  function getExportFileKind(type: string | undefined) {
    if (!type) {
      return 'documents';
    }

    if (type.startsWith('image/')) {
      return 'images';
    }

    if (type.startsWith('audio/') || type.startsWith('video/')) {
      return 'media';
    }

    return 'documents';
  }

  function shouldIncludeExportFile(metadata: ChatFileMetadata) {
    const kind = getExportFileKind(metadata.type);
    return (
      (kind === 'images' && exportIncludeImages) ||
      (kind === 'documents' && exportIncludeDocuments) ||
      (kind === 'media' && exportIncludeMedia)
    );
  }

  function sanitizeExportFileName(fileId: string, fileName: string) {
    const normalized = fileName.trim() || 'file';
    const safeName = normalized.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    return `${fileId} - ${safeName}`;
  }

  async function loadMessagesForExport(chatId: string, currentChatKey: CryptoKey) {
    let cursor: string | undefined;
    let hasMore = true;
    let allMessages: Message[] = [];

    while (hasMore) {
      const batch = await api.chats.getMessages(chatId, {
        limit: EXPORT_MESSAGES_PAGE_SIZE,
        cursor
      });
      const decryptedBatch = await decryptMessagesForDisplay(
        batch.messages,
        currentChatKey,
        selectedChat?.members ?? []
      );

      if (decryptedBatch.length === 0) {
        break;
      }

      allMessages = cursor ? [...decryptedBatch, ...allMessages] : decryptedBatch;
      hasMore = batch.hasMoreAfter;
      cursor = decryptedBatch[0]?.id;

      if (!cursor) {
        break;
      }
    }

    return allMessages;
  }

  function buildExportHtml(
    chatName: string,
    messagesForExport: Message[],
    exportedFilesById: Record<string, { fileName: string; metadata: ChatFileMetadata }>
  ) {
    const messageHtml = messagesForExport
      .map((message) => {
        const timeLabel = new Date(message.timestamp * 1000).toLocaleString();
        const authorLabel = escapeHtml(message.senderUsername || 'Система');

        if (isSystemMessage(message)) {
          const systemText = escapeHtml(getSystemMessageContent(parseSystemMessage(message.content || '')));
          return `<article class="message system"><div class="meta">${timeLabel}</div><div class="content">${systemText}</div></article>`;
        }

        const textHtml = message.content
          ? `<div class="content">${escapeHtml(message.content).replaceAll('\n', '<br>')}</div>`
          : '';

        const attachmentsHtml = message.fileIds.length
          ? `<ul class="attachments">${message.fileIds
              .map((fileId) => {
                const exported = exportedFilesById[fileId];
                const displayName = escapeHtml(
                  exported?.metadata.name ||
                    fileDisplayById[fileId]?.name ||
                    'Вложение'
                );
                return exported
                  ? `<li><a href="files/${encodeURIComponent(exported.fileName)}" download="${escapeHtml(exported.fileName)}">${displayName}</a></li>`
                  : `<li><span>${displayName}</span></li>`;
              })
              .join('')}</ul>`
          : '';

        return `<article class="message"><div class="meta"><strong>${authorLabel}</strong> · ${timeLabel}</div>${textHtml}${attachmentsHtml}</article>`;
      })
      .join('');

    return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(chatName)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 24px; background: #f8fafc; color: #0f172a; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    .subtitle { margin: 0 0 24px; color: #64748b; }
    .message { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 14px 16px; margin-bottom: 12px; }
    .message.system { background: #eff6ff; color: #1e3a8a; }
    .meta { font-size: 12px; color: #64748b; margin-bottom: 8px; }
    .content { white-space: normal; overflow-wrap: anywhere; line-height: 1.45; }
    .attachments { margin: 10px 0 0; padding-left: 18px; }
    .attachments li + li { margin-top: 4px; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>${escapeHtml(chatName)}</h1>
  <p class="subtitle">Экспорт истории чата</p>
  ${messageHtml || '<p>Сообщения за выбранный период не найдены.</p>'}
</body>
</html>`;
  }

  async function handleExportHistory() {
    if (!selectedChat?.id || !chatKey || exportingHistory) {
      return;
    }

    const fromTimestamp = toExportTimestamp(exportFromDate);
    const toTimestamp = toExportTimestamp(exportToDate, true);

    if (fromTimestamp && toTimestamp && fromTimestamp > toTimestamp) {
      error = 'Начальная дата не может быть позже конечной';
      return;
    }

    exportingHistory = true;
    try {
      const allMessages = await loadMessagesForExport(selectedChat.id, chatKey);
      const filteredMessages = allMessages.filter((message) => {
        if (fromTimestamp && message.timestamp < fromTimestamp) return false;
        if (toTimestamp && message.timestamp > toTimestamp) return false;
        return true;
      });

      const metadataById = await ensureAllChatMetadataDecrypted(selectedChat.id, chatKey);
      const fileIdsToExport = Array.from(
        new Set(
          filteredMessages.flatMap((message) =>
            message.fileIds.filter((fileId) => {
              const metadata = metadataById[fileId];
              return Boolean(metadata && shouldIncludeExportFile(metadata));
            })
          )
        )
      );

      const zipEntries: Array<{ name: string; data: Uint8Array }> = [];
      const exportedFilesById: Record<string, { fileName: string; metadata: ChatFileMetadata }> = {};

      for (const fileId of fileIdsToExport) {
        const metadata = metadataById[fileId];
        if (!metadata) continue;

        const contentResponse = await api.files.downloadChatFileContent(selectedChat.id, fileId);
        const decryptedContent = await cryptoLib.decryptBinary(chatKey, contentResponse.content);
        const fileName = sanitizeExportFileName(fileId, metadata.name);

        exportedFilesById[fileId] = { fileName, metadata };
        zipEntries.push({
          name: `files/${fileName}`,
          data: Uint8Array.from(decryptedContent)
        });
      }

      const html = buildExportHtml(chatDisplayName, filteredMessages, exportedFilesById);
      zipEntries.unshift({
        name: 'index.html',
        data: new TextEncoder().encode(html)
      });

      const archive = createZipBlob(zipEntries);
      const archiveName = `${(chatDisplayName || 'chat').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}-export.zip`;
      const objectUrl = URL.createObjectURL(archive);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = archiveName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      showExportModal = false;
    } catch (exception) {
      error = exception instanceof Error ? exception.message : 'Не удалось экспортировать историю чата';
    } finally {
      exportingHistory = false;
    }
  }

  function getAttachmentKind(type: string) {
    if (type.startsWith('image/')) {
      return 'images' as const;
    }

    if (type.startsWith('audio/') || type.startsWith('video/')) {
      return 'media' as const;
    }

    return 'documents' as const;
  }

  async function loadChatAttachmentCounts(chatId: string, currentChatKey: CryptoKey) {
    const allMetadata = await ensureAllChatMetadataDecrypted(chatId, currentChatKey);
    const nextCounts = { images: 0, documents: 0, media: 0 };

    for (const metadata of Object.values(allMetadata)) {
      if (!metadata) {
        continue;
      }

      nextCounts[getAttachmentKind(metadata.type)] += 1;
    }

    attachmentCounts = nextCounts;
  }

  async function buildAttachmentBrowserItems(
    chatId: string,
    currentChatKey: CryptoKey,
    kind: 'images' | 'documents' | 'media'
  ) {
    const allMetadata = await ensureAllChatMetadataLoaded(chatId);
    const decryptedMetadataById = await ensureAllChatMetadataDecrypted(chatId, currentChatKey);
    const nextItems = await Promise.all(
      Object.values(allMetadata).map(async (metadataEntry) => {
        if (!metadataEntry.fileId || metadataEntry.deletedAt) {
          return null;
        }

        const metadata = decryptedMetadataById[metadataEntry.fileId];
        if (!metadata || getAttachmentKind(metadata.type) !== kind) {
          return null;
        }

        let previewUrl: string | null = null;
        if (kind === 'images') {
          const asset = await ensureChatFileAsset(chatId, currentChatKey, metadataEntry.fileId, metadata, metadataEntry.updatedAt).catch(
            () => null
          );
          previewUrl = asset?.objectUrl ?? null;
        }

        return {
          fileId: metadataEntry.fileId,
          previewUrl,
          metadata,
          updatedAt: metadataEntry.updatedAt
        };
      })
    );

    return nextItems
      .filter((item): item is NonNullable<(typeof nextItems)[number]> => Boolean(item))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async function ensureChatFileAsset(
    chatId: string,
    currentChatKey: CryptoKey,
    fileId: string,
    metadata: ChatFileMetadata,
    updatedAt: number
  ) {
    const existingAsset = fileAssetById[fileId];
    if (existingAsset && existingAsset.updatedAt === updatedAt) {
      return existingAsset;
    }

    const cachedAsset = await getCachedFile(fileId, updatedAt);
    if (cachedAsset) {
      fileAssetById = {
        ...fileAssetById,
        [fileId]: cachedAsset
      };
      return cachedAsset;
    }

    const downloadedContent = await api.files.downloadChatFileContent(chatId, fileId);
    const decryptedContent = await cryptoLib.decryptBinary(currentChatKey, downloadedContent.content);
    const blob = new Blob([Uint8Array.from(decryptedContent).buffer], {
      type: metadata.type || 'application/octet-stream'
    });

    const asset = await cacheFile(fileId, blob, {
      type: metadata.type || 'application/octet-stream',
      name: metadata.name,
      updatedAt: downloadedContent.updatedAt
    });

    fileAssetById = {
      ...fileAssetById,
      [fileId]: asset
    };

    return asset;
  }

  function estimateStoredFileSize(metadata: ChatFileMetadata, file: File) {
    const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
    return file.size + metadataBytes.length + 56;
  }

  function getSelectedAttachmentCount() {
    return pendingAttachments.length + selectedReusableAttachments.length;
  }

  function bytesEqual(left: Uint8Array, right: Uint8Array) {
    if (left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) {
        return false;
      }
    }

    return true;
  }

  async function getChatFileContentBytes(
    chatId: string,
    currentChatKey: CryptoKey,
    fileId: string,
    metadata: ChatFileMetadata,
    updatedAt: number
  ) {
    const asset = await ensureChatFileAsset(chatId, currentChatKey, fileId, metadata, updatedAt);
    const response = await fetch(asset.objectUrl);
    return new Uint8Array(await response.arrayBuffer());
  }

  async function findDuplicateChatFile(
    chatId: string,
    currentChatKey: CryptoKey,
    file: File,
    metadata: ChatFileMetadata
  ): Promise<{ fileId: string; metadata: ChatFileMetadata } | null> {
    const encryptedMetadataById = await ensureAllChatMetadataLoaded(chatId);
    const decryptedMetadataById = await ensureAllChatMetadataDecrypted(chatId, currentChatKey);
    const candidateEntries = Object.values(encryptedMetadataById).filter((entry) => {
      if (!entry.fileId || entry.deletedAt) {
        return false;
      }

      const existingMetadata = decryptedMetadataById[entry.fileId];
      return existingMetadata?.type === metadata.type && existingMetadata.size === metadata.size;
    });

    if (candidateEntries.length === 0) {
      return null;
    }

    const sourceBytes = new Uint8Array(await file.arrayBuffer());

    for (const candidateEntry of candidateEntries) {
      if (!candidateEntry.fileId) {
        continue;
      }

      const candidateMetadata = decryptedMetadataById[candidateEntry.fileId];
      if (!candidateMetadata) {
        continue;
      }

      const candidateBytes = await getChatFileContentBytes(
        chatId,
        currentChatKey,
        candidateEntry.fileId,
        candidateMetadata,
        candidateEntry.updatedAt
      );

      if (bytesEqual(sourceBytes, candidateBytes)) {
        return {
          fileId: candidateEntry.fileId,
          metadata: candidateMetadata
        };
      }
    }

    return null;
  }

  async function openImageLibrary() {
    if (!selectedChat?.id || !chatKey) {
      error = 'Ключ чата недоступен';
      return;
    }

    showImageLibraryModal = true;
    loadingImageLibrary = true;

    try {
      const allMetadata = await ensureAllChatMetadataLoaded(selectedChat.id);
      const decryptedMetadataById = await ensureAllChatMetadataDecrypted(selectedChat.id, chatKey);
      const favoriteIds = new Set(getFavoriteChatImageIds(selectedChat.id));
      const nextItems = await Promise.all(
        Object.values(allMetadata).map(async (metadataEntry) => {
          if (!metadataEntry.fileId || metadataEntry.deletedAt) {
            return null;
          }

          const metadata = decryptedMetadataById[metadataEntry.fileId];
          if (!metadata || !metadata.type.startsWith('image/')) {
            return null;
          }

          const asset = await ensureChatFileAsset(
            selectedChat.id,
            chatKey,
            metadataEntry.fileId,
            metadata,
            metadataEntry.updatedAt
          ).catch(() => null);

          return {
            fileId: metadataEntry.fileId,
            previewUrl: asset?.objectUrl ?? null,
            metadata,
            updatedAt: metadataEntry.updatedAt,
            isFavorite: favoriteIds.has(metadataEntry.fileId)
          };
        })
      );

      imageLibraryItems = nextItems
        .filter((item): item is NonNullable<(typeof nextItems)[number]> => Boolean(item))
        .sort((left, right) => Number(right.isFavorite) - Number(left.isFavorite) || right.updatedAt - left.updatedAt);
    } catch (exception) {
      error = exception instanceof Error ? exception.message : 'Не удалось загрузить изображения чата';
    } finally {
      loadingImageLibrary = false;
    }
  }

  function openChatDetails() {
    showMembersModal = true;
    if (selectedChat?.id && chatKey) {
      loadChatAttachmentCounts(selectedChat.id, chatKey).catch(() => {});
    }
  }

  async function openAttachmentBrowser(kind: 'images' | 'documents' | 'media') {
    if (!selectedChat?.id || !chatKey) {
      error = 'Ключ чата недоступен';
      return;
    }

    showMembersModal = false;
    showAttachmentBrowserModal = true;
    loadingAttachmentBrowser = true;
    attachmentBrowserKind = kind;
    attachmentBrowserTitle =
      kind === 'images' ? 'Изображения чата' : kind === 'documents' ? 'Документы чата' : 'Аудио и видео чата';

    try {
      attachmentBrowserItems = await buildAttachmentBrowserItems(selectedChat.id, chatKey, kind);
    } catch (exception) {
      error = exception instanceof Error ? exception.message : 'Не удалось загрузить вложения чата';
      attachmentBrowserItems = [];
    } finally {
      loadingAttachmentBrowser = false;
    }
  }

  async function handleSendMessage() {
    clearError();
    if ((!newMessage.trim() && pendingAttachments.length === 0 && selectedReusableAttachments.length === 0) || sending || !chatKey) return;
    if (newMessage.length > MAX_MESSAGE_LENGTH) {
      error = `Сообщение не должно превышать ${MAX_MESSAGE_LENGTH} символов`;
      return;
    }
    if (getSelectedAttachmentCount() > MAX_ATTACHMENTS_PER_MESSAGE) {
      error = `К сообщению можно прикрепить не более ${MAX_ATTACHMENTS_PER_MESSAGE} вложений`;
      return;
    }

    sending = true;
    pendingAttachments = pendingAttachments.map((attachment) => ({ ...attachment, uploading: true }));
    const uploadedFileIds: string[] = [];
    const locallyCachedFileIds: string[] = [];
    try {
      for (const attachment of pendingAttachments) {
        const fileBytes = new Uint8Array(await attachment.file.arrayBuffer());
        const fileMetadata = attachment.metadata;
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
        rememberDecryptedChatFileMetadata(params.id, uploaded.file.id, fileMetadata);
        await cacheFile(uploaded.file.id, attachment.file, {
          type: fileMetadata.type,
          name: fileMetadata.name,
          updatedAt: uploaded.file.updatedAt
        });
      }

      const reusableAttachmentNames = selectedReusableAttachments.map((attachment) => attachment.name);
      const uploadedAttachmentNames = pendingAttachments.map((attachment) => attachment.metadata.name);
      await chats.sendMessage(
        params.id,
        newMessage,
        [
          ...selectedReusableAttachments.map((attachment) => attachment.fileId),
          ...uploadedFileIds
        ],
        [...reusableAttachmentNames, ...uploadedAttachmentNames],
        replyTarget?.id ?? null
      );
      newMessage = '';
      composerResetToken += 1;
      replyTarget = null;
      pendingAttachments = [];
      selectedReusableAttachments = [];
      shouldStickToBottom = true;
      requestAnimationFrame(() => {
        if (messagesContainer) {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        (document.getElementById('messageInput') as HTMLTextAreaElement | null)?.focus();
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
      const result = await chats.deleteMessage(params.id, messageId);
      if (replyTarget?.id === messageId) {
        replyTarget = null;
      }
      await cleanupDeletedFiles(params.id, result?.deletedFileIds ?? []);
    } catch (exception) {
      error = exception instanceof Error ? exception.message : 'Не удалось удалить сообщение';
    }
  }

  async function handleFilePick(files: File[]) {
    clearError();
    const currentAttachmentCount = getSelectedAttachmentCount();
    if (currentAttachmentCount >= MAX_ATTACHMENTS_PER_MESSAGE) {
      error = `К сообщению можно прикрепить не более ${MAX_ATTACHMENTS_PER_MESSAGE} вложений`;
      return;
    }

    let quota: Awaited<ReturnType<typeof api.files.listMine>>;
    let reservedBytes = pendingAttachments.reduce((total, attachment) => total + attachment.estimatedStoredSize, 0);
    const acceptedAttachments: PendingAttachment[] = [];
    const rejectedFiles: string[] = [];
    let remainingSlots = MAX_ATTACHMENTS_PER_MESSAGE - currentAttachmentCount;
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
      if (remainingSlots <= 0) {
        rejectedFiles.push(file.name);
        continue;
      }

      const metadata = await buildFileMetadata(file);
      const duplicateMatch = await findDuplicateChatFile(selectedChat.id, selectedChat.chatKey, file, metadata);
      if (duplicateMatch) {
        const alreadySelected = selectedReusableAttachments.some((attachment) => attachment.fileId === duplicateMatch.fileId);
        if (!alreadySelected) {
          selectedReusableAttachments = [
            ...selectedReusableAttachments,
            {
              id: `reuse:${duplicateMatch.fileId}`,
              fileId: duplicateMatch.fileId,
              name: duplicateMatch.metadata.name,
              size: duplicateMatch.metadata.size
            }
          ];
          remainingSlots -= 1;
        }
        continue;
      }

      const estimatedStoredSize = estimateStoredFileSize(metadata, file);
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
        metadata,
        uploading: false
      });
      remainingSlots -= 1;
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

  async function confirmDeleteMessage() {
    if (!messagePendingDeletionId) return;

    const messageId = messagePendingDeletionId;
    showDeleteMessageModal = false;
    messagePendingDeletionId = null;
    await handleDeleteMessage(messageId);
  }

  function toggleReusableImage(fileId: string) {
    const item = imageLibraryItems.find((entry) => entry.fileId === fileId);
    if (!item) return;

    const existing = selectedReusableAttachments.find((attachment) => attachment.fileId === fileId);
    if (existing) {
      selectedReusableAttachments = selectedReusableAttachments.filter((attachment) => attachment.fileId !== fileId);
      return;
    }

    if (getSelectedAttachmentCount() >= MAX_ATTACHMENTS_PER_MESSAGE) {
      error = `К сообщению можно прикрепить не более ${MAX_ATTACHMENTS_PER_MESSAGE} вложений`;
      return;
    }

    selectedReusableAttachments = [
      ...selectedReusableAttachments,
      {
        id: `reuse:${fileId}`,
        fileId,
        name: item.metadata.name,
        size: item.metadata.size
      }
    ];
  }

  function toggleFavoriteReusableImage(fileId: string) {
    if (!selectedChat?.id) return;

    const nextFavorites = new Set(toggleFavoriteChatImage(selectedChat.id, fileId));
    imageLibraryItems = imageLibraryItems
      .map((item) => ({
        ...item,
        isFavorite: nextFavorites.has(item.fileId)
      }))
      .sort((left, right) => Number(right.isFavorite) - Number(left.isFavorite) || right.updatedAt - left.updatedAt);
  }

  function handleRemoveAttachment(attachmentId: string) {
    clearError();
    if (attachmentId.startsWith('reuse:')) {
      selectedReusableAttachments = selectedReusableAttachments.filter((attachment) => attachment.id !== attachmentId);
      return;
    }

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
        await ensureAllChatMetadataLoaded(chatId);
        if (generation !== fileMetadataGeneration || selectedChat?.id !== chatId) {
          return;
        }
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

          rememberDecryptedChatFileMetadata(chatId, fileId, metadata);

          fileDisplayById = {
            ...fileDisplayById,
            [fileId]: {
              status: 'loading',
              name: metadata.name,
              type: metadata.type,
              size: metadata.size,
              sizeLabel: formatFileSize(metadata.size),
              deletedAt: downloadedMetadata.deletedAt,
              previewDataUrl: metadata.previewDataUrl,
              previewWidth: metadata.width && metadata.height ? computeInlineImagePreviewSize(metadata.width, metadata.height)?.width : undefined,
              previewHeight: metadata.width && metadata.height ? computeInlineImagePreviewSize(metadata.width, metadata.height)?.height : undefined
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
                deletedAt: downloadedMetadata.deletedAt,
                previewDataUrl: metadata.previewDataUrl,
                previewWidth: metadata.width && metadata.height ? computeInlineImagePreviewSize(metadata.width, metadata.height)?.width : undefined,
                previewHeight: metadata.width && metadata.height ? computeInlineImagePreviewSize(metadata.width, metadata.height)?.height : undefined
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
                deletedAt: downloadedMetadata.deletedAt,
                previewDataUrl: metadata.previewDataUrl,
                previewWidth: metadata.width && metadata.height ? computeInlineImagePreviewSize(metadata.width, metadata.height)?.width : undefined,
                previewHeight: metadata.width && metadata.height ? computeInlineImagePreviewSize(metadata.width, metadata.height)?.height : undefined
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
              deletedAt: downloadedContent.deletedAt,
              previewDataUrl: metadata.previewDataUrl,
              previewWidth: metadata.width && metadata.height ? computeInlineImagePreviewSize(metadata.width, metadata.height)?.width : undefined,
              previewHeight: metadata.width && metadata.height ? computeInlineImagePreviewSize(metadata.width, metadata.height)?.height : undefined
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

    if (asset.type.startsWith('image/')) {
      imageCarouselItems = [
        {
          fileId,
          src: asset.objectUrl,
          name: asset.name
        }
      ];
      activeCarouselFileId = fileId;
      showImageCarouselModal = true;
      return;
    }

    const isPreviewable = asset.type === 'application/pdf' || asset.type.startsWith('text/');

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

  function handleOpenMessageFile(fileId: string, messageFileIds: string[]) {
    const asset = fileAssetById[fileId];
    const display = fileDisplayById[fileId];
    if (!asset || display?.status !== 'ready') {
      return;
    }

    if (asset.type.startsWith('image/')) {
      const imageItems = messageFileIds
        .map((messageFileId) => {
          const relatedAsset = fileAssetById[messageFileId];
          const relatedDisplay = fileDisplayById[messageFileId];
          if (!relatedAsset || relatedDisplay?.status !== 'ready' || !relatedAsset.type.startsWith('image/')) {
            return null;
          }

          return {
            fileId: messageFileId,
            src: relatedAsset.objectUrl,
            name: relatedAsset.name
          };
        })
        .filter(
          (item): item is { fileId: string; src: string; name: string } => Boolean(item)
        );

      imageCarouselItems = imageItems.length > 0 ? imageItems : [{ fileId, src: asset.objectUrl, name: asset.name }];
      activeCarouselFileId = fileId;
      showImageCarouselModal = true;
      return;
    }

    handleOpenFile(fileId);
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
    memberToRemove = selectedChat?.members?.find((item) => item.id === userId) ?? null;
    removeDeleteMessages = false;
    removeDeleteFiles = false;
    showMembersModal = false;
    showRemoveMemberModal = true;
  }

  async function handleConfirmRemoveMember() {
    if (!memberToRemove || removingMember) return;

    removingMember = true;
    try {
      await chats.removeMember(params.id, memberToRemove.id, {
        deleteMessages: removeDeleteMessages,
        deleteFiles: removeDeleteFiles
      });
      showRemoveMemberModal = false;
      memberToRemove = null;
    } catch (exception) {
      error = exception instanceof Error ? exception.message : 'Не удалось удалить участника';
    } finally {
      removingMember = false;
    }
  }

  function openLeaveChatModal() {
    leaveDeleteMessages = false;
    leaveDeleteFiles = false;
    showMembersModal = false;
    showLeaveChatModal = true;
  }

  async function handleLeaveChat() {
    if (leavingChat) return;

    leavingChat = true;
    try {
      await chats.leaveChat(params.id, {
        deleteMessages: leaveDeleteMessages,
        deleteFiles: leaveDeleteFiles
      });
      window.location.hash = '#/chats';
    } catch (exception) {
      error = exception instanceof Error ? exception.message : 'Не удалось покинуть чат';
    } finally {
      leavingChat = false;
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

  async function handleRenameChat() {
    if (!selectedChat?.id || !renameChatValue.trim() || renamingChat) return;

    renamingChat = true;
    try {
      await chats.renameChat(selectedChat.id, renameChatValue);
      showRenameChatModal = false;
    } catch (exception) {
      error = exception instanceof Error ? exception.message : 'Не удалось изменить название чата';
    } finally {
      renamingChat = false;
    }
  }

  async function handleChatAvatarSave(event: CustomEvent<{ blob: Blob }>) {
    if (!selectedChat?.id) return;

    updatingChatAvatar = true;
    try {
      await chats.updateChatAvatar(selectedChat.id, event.detail.blob);
      showChatAvatarModal = false;
      pendingChatAvatarFile = null;
    } catch (exception) {
      error = exception instanceof Error ? exception.message : 'Не удалось обновить аватар чата';
    } finally {
      updatingChatAvatar = false;
    }
  }

  $: if (params.id && params.id !== loadedChatId) {
    loadedChatId = params.id;
    clearError();
    pendingAttachments = [];
    selectedReusableAttachments = [];
    replyTarget = null;
    imageLibraryItems = [];
    showImageLibraryModal = false;
    showAttachmentBrowserModal = false;
    showImageCarouselModal = false;
    attachmentBrowserItems = [];
    imageCarouselItems = [];
    activeCarouselFileId = null;
    attachmentCounts = { images: 0, documents: 0, media: 0 };
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

  const unsubscribeDeletedFilesEvent = deletedFilesEvent.subscribe((event) => {
    if (!event || !selectedChat?.id || event.chatId !== selectedChat.id) {
      return;
    }

    cleanupDeletedFiles(event.chatId, event.fileIds).catch(() => {});
    deletedFilesEvent.set(null);
  });

  const unsubscribePinsUpdatedEvent = pinsUpdatedEvent.subscribe((event) => {
    if (!event) {
      return;
    }

    chats.handlePinsUpdated(event.chatId, event.pinnedMessages).catch(() => {});
    pinsUpdatedEvent.set(null);
  });

  onDestroy(() => {
    if (scrollTimeout) clearTimeout(scrollTimeout);
    if (errorTimeout) clearTimeout(errorTimeout);
    unsubscribeDeletedFilesEvent();
    unsubscribePinsUpdatedEvent();
    resetFileCaches();
  });
</script>

<div
  class="chat-container"
  role="region"
  aria-label="Область чата"
  on:dragenter={handleDragEnter}
  on:dragover={handleDragOver}
  on:dragleave={handleDragLeave}
  on:drop={handleDrop}
>
  <div class="chat-header">
    {#if showBackButton}
      <button
        class="chat-back-btn"
        type="button"
        on:click={() => dispatch('back')}
        aria-label="Назад к чатам"
      >
        ←
      </button>
    {/if}
    <button
      class="chat-header-btn"
      type="button"
      on:click={openChatDetails}
      aria-label="Открыть информацию о чате"
    >
      <div class="chat-header-text">
        <div class="chat-header-title-row">
          <h2>{chatDisplayName}</h2>
          {#if selectedChat?.type === 'pm' && chatPresenceLabel}
            <span class="chat-header-status" class:online={selectedChat?.otherUser?.isOnline}>
              <span class="status-dot"></span>
              <span>{chatPresenceLabel}</span>
            </span>
          {:else if selectedChat?.type === 'gm'}
            <span class="chat-header-status" class:online={onlineMembersCount > 0}>
              <span class="status-dot"></span>
              <span>{onlineMembersCount} в сети</span>
            </span>
          {/if}
        </div>
      </div>
    </button>
  </div>

    {#if currentPinnedMessage}
      <div class="pinned-bar">
        <button
          type="button"
          class="pinned-main"
          on:click={() => scrollToMessage(currentPinnedMessage.message.id)}
          title="Перейти к закреплённому сообщению"
        >
          <span class="pinned-label">{pinnedCounterLabel}</span>
            <span class="pinned-content" class:attachment-only={isAttachmentOnlyMessage(currentPinnedMessage.message)}>
              <strong>{currentPinnedMessage.message.senderUsername || 'Unknown'}:</strong>
              {getPinnedPreviewText(currentPinnedMessage.message)}
            </span>
          </button>
        {#if pinnedMessages.length > 1}
          <div class="pinned-nav">
            <button type="button" class="pinned-nav-btn" on:click={() => (activePinnedIndex = (activePinnedIndex - 1 + pinnedMessages.length) % pinnedMessages.length)} aria-label="Предыдущий закреп">‹</button>
            <button type="button" class="pinned-nav-btn" on:click={() => (activePinnedIndex = (activePinnedIndex + 1) % pinnedMessages.length)} aria-label="Следующий закреп">›</button>
          </div>
        {/if}
        <button type="button" class="pinned-action-btn" on:click={() => (showPinnedMessagesModal = true)}>Все</button>
        <button type="button" class="pinned-action-btn danger" on:click={() => unpinMessage(currentPinnedMessage.message.id)}>Снять</button>
      </div>
    {/if}
  
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
      imagePreviewById={imagePreviewById}
      fileAssetById={fileAssetById}
      unreadMarkerId={selectedChat?.unreadMarkerId}
      on:scroll={handleContainerScroll}
      on:fileclick={(event) => handleOpenMessageFile(event.detail.fileId, event.detail.messageFileIds)}
      on:replyclick={(event) => scrollToMessage(event.detail.messageId)}
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

    {#if replyTarget}
      <div class="reply-bar">
        <button type="button" class="reply-bar-main" on:click={() => scrollToMessage(replyTarget?.id)}>
            <span class="reply-bar-text" class:attachment-only={isAttachmentOnlyMessage(replyTarget)}>
              <strong>{replyTarget.senderUsername || 'Unknown'}:</strong> {getReplyTargetPreviewText(replyTarget)}
            </span>
          </button>
        <button type="button" class="reply-bar-close" on:click={cancelReply} aria-label="Отменить ответ">×</button>
      </div>
    {/if}

    <MessageInput
      bind:value={newMessage}
      disabled={sending || !chatKey}
      attachments={composerAttachments}
      attachmentsDisabled={sending || !chatKey}
      dragActive={isDragActive}
      resetToken={composerResetToken}
      {sending}
      on:submit={handleSendMessage}
      on:pickfiles={(event) => handleFilePick(event.detail.files)}
      on:removeattachment={(event) => handleRemoveAttachment(event.detail.id)}
      on:openlibrary={openImageLibrary}
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
        <button class="edit-save" type="button" on:click={handleEditMessage} disabled={!editingText.trim() && editingMessage.fileIds.length === 0}>Сохранить</button>
        <button class="edit-cancel" type="button" on:click={cancelEdit}>Отмена</button>
      </div>
    {/if}
  {/if}

  {#if contextMenu.visible}
    <div class="context-menu" style="left: {contextMenu.x}px; top: {contextMenu.y}px;" role="menu">
      <button
        class="context-menu-item"
        type="button"
        on:click={() => {
          const message = messages.find((item) => item.id === contextMenu.messageId);
          if (message) startReply(message);
        }}
      >
        Ответить
      </button>
      <button class="context-menu-item" type="button" on:click={togglePinFromMenu}>
        {isPinnedMessage ? 'Снять закреп' : 'Закрепить'}
      </button>
      <button class="context-menu-item" type="button" on:click={handleCopyMessage}>Скопировать</button>
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
      {/if}
      {#if canDeleteContextMessage}
        <button class="context-menu-item danger" type="button" on:click={handleDeleteFromMenu}>Удалить</button>
      {/if}
    </div>
    <button class="context-menu-overlay" type="button" on:click={closeContextMenu} aria-label="Закрыть меню"></button>
  {/if}

  {#if isDragActive}
    <div class="drop-overlay" aria-hidden="true">
      <div class="drop-overlay-card">
        <strong>Отпустите файлы, чтобы прикрепить</strong>
        <span>Файлы будут добавлены во вложения к сообщению</span>
      </div>
    </div>
  {/if}
</div>

<input
  id="chatAvatarInput"
  class="hidden-input"
  type="file"
  accept="image/jpeg,image/png,image/webp"
  on:change={handleChatAvatarFileChange}
/>

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

{#if showImageLibraryModal}
  <ChatImagePickerModal
    items={imageLibraryItems}
    selectedFileIds={selectedReusableAttachments.map((attachment) => attachment.fileId)}
    loading={loadingImageLibrary}
    on:close={() => (showImageLibraryModal = false)}
    on:toggle={(event) => toggleReusableImage(event.detail.fileId)}
    on:favorite={(event) => toggleFavoriteReusableImage(event.detail.fileId)}
  />
{/if}

{#if showChatAvatarModal && pendingChatAvatarFile}
  <AvatarCropModal
    file={pendingChatAvatarFile}
    uploading={updatingChatAvatar}
    on:close={() => {
      showChatAvatarModal = false;
      pendingChatAvatarFile = null;
    }}
    on:save={handleChatAvatarSave}
  />
{/if}

{#if showRenameChatModal}
  <div class="modal-shell">
    <button
      class="modal-overlay"
      type="button"
      aria-label="Закрыть окно изменения названия чата"
      on:click={() => {
        showRenameChatModal = false;
        renameChatValue = chatDisplayName;
      }}
    ></button>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="rename-chat-title">
      <h3 id="rename-chat-title">Изменить название чата</h3>
      <div class="field">
        <label for="renameChatInput">Название</label>
        <input
          id="renameChatInput"
          type="text"
          bind:value={renameChatValue}
          maxlength="30"
          placeholder="Введите название чата"
        />
      </div>
      <div class="modal-actions">
        <button
          type="button"
          on:click={() => {
            showRenameChatModal = false;
            renameChatValue = chatDisplayName;
          }}
        >
          Отмена
        </button>
        <button type="button" class="primary-action" disabled={renamingChat || !renameChatValue.trim()} on:click={handleRenameChat}>
          {renamingChat ? 'Сохранение...' : 'Сохранить'}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showMembersModal}
  <MembersModal
    members={selectedChat?.members ?? []}
    {isCreator}
    {canAddMembers}
    {attachmentCounts}
    chatType={selectedChat?.type ?? 'gm'}
    currentUserId={$auth.user?.id}
    chatName={chatDisplayName}
    chatAvatarUrl={chatDisplayAvatarUrl}
    on:close={() => (showMembersModal = false)}
    on:deleteChat={handleDeleteChat}
    on:leaveChat={openLeaveChatModal}
    on:addMember={() => {
      showMembersModal = false;
      showAddMemberModal = true;
    }}
    on:editAvatar={() => {
      showMembersModal = false;
      openChatAvatarPicker();
    }}
    on:editName={() => {
      renameChatValue = chatDisplayName;
      showMembersModal = false;
      showRenameChatModal = true;
    }}
    on:exporthistory={() => {
      showMembersModal = false;
      showExportModal = true;
    }}
    on:openattachments={(event) => openAttachmentBrowser(event.detail.kind)}
    on:remove={(event) => removeMember(event.detail.userId)}
  />
{/if}

{#if showExportModal}
  <ChatExportModal
    bind:fromDate={exportFromDate}
    bind:toDate={exportToDate}
    bind:includeImages={exportIncludeImages}
    bind:includeDocuments={exportIncludeDocuments}
    bind:includeMedia={exportIncludeMedia}
    exporting={exportingHistory}
    on:close={() => {
      if (!exportingHistory) {
        showExportModal = false;
      }
    }}
    on:submit={handleExportHistory}
  />
{/if}

{#if showAttachmentBrowserModal}
  <ChatAttachmentBrowserModal
    title={attachmentBrowserTitle}
    kind={attachmentBrowserKind}
    items={attachmentBrowserItems}
    loading={loadingAttachmentBrowser}
    on:close={() => (showAttachmentBrowserModal = false)}
    on:open={(event) => handleOpenFile(event.detail.fileId)}
  />
{/if}

{#if showImageCarouselModal}
  <ChatImageCarouselModal
    items={imageCarouselItems}
    currentFileId={activeCarouselFileId}
    on:close={() => {
      showImageCarouselModal = false;
      imageCarouselItems = [];
      activeCarouselFileId = null;
    }}
  />
{/if}

{#if showPinnedMessagesModal}
  <PinnedMessagesModal
      items={pinnedMessages}
      {fileDisplayById}
      activeMessageId={currentPinnedMessage?.message.id ?? null}
    on:close={() => (showPinnedMessagesModal = false)}
    on:open={(event) => {
      const messageId = event.detail.messageId;
      const nextIndex = pinnedMessages.findIndex((item) => item.message.id === messageId);
      if (nextIndex !== -1) {
        activePinnedIndex = nextIndex;
      }
      showPinnedMessagesModal = false;
      tick().then(() => scrollToMessage(messageId));
    }}
    on:unpin={(event) => unpinMessage(event.detail.messageId)}
  />
{/if}

{#if showLeaveChatModal}
  <div class="modal-shell">
    <button class="modal-overlay" type="button" aria-label="Закрыть окно выхода из чата" on:click={() => (showLeaveChatModal = false)}></button>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="leave-chat-title">
      <h3 id="leave-chat-title">Покинуть чат</h3>
      <p class="modal-copy">После выхода чат исчезнет из вашего списка, но историю можно дополнительно очистить перед уходом.</p>
      <label class="option-toggle">
        <input type="checkbox" bind:checked={leaveDeleteFiles} />
        <span>Удалить все мои файлы</span>
      </label>
      <label class="option-toggle">
        <input type="checkbox" bind:checked={leaveDeleteMessages} />
        <span>Удалить все мои сообщения</span>
      </label>
      <div class="modal-actions">
        <button type="button" on:click={() => (showLeaveChatModal = false)}>Отмена</button>
        <button type="button" class="danger-action" disabled={leavingChat} on:click={handleLeaveChat}>
          {leavingChat ? 'Выход...' : 'Покинуть чат'}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showRemoveMemberModal && memberToRemove}
  <div class="modal-shell">
    <button class="modal-overlay" type="button" aria-label="Закрыть окно удаления участника" on:click={() => { showRemoveMemberModal = false; memberToRemove = null; }}></button>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="remove-member-title">
      <h3 id="remove-member-title">Удалить участника</h3>
      <p class="modal-copy">Пользователь <strong>{memberToRemove.username}</strong> будет исключён из чата.</p>
      <label class="option-toggle">
        <input type="checkbox" bind:checked={removeDeleteMessages} />
        <span>Удалить все сообщения пользователя</span>
      </label>
      <label class="option-toggle">
        <input type="checkbox" bind:checked={removeDeleteFiles} />
        <span>Удалить все файлы пользователя</span>
      </label>
      <div class="modal-actions">
        <button type="button" on:click={() => { showRemoveMemberModal = false; memberToRemove = null; }}>Отмена</button>
        <button type="button" class="danger-action" disabled={removingMember} on:click={handleConfirmRemoveMember}>
          {removingMember ? 'Удаление...' : 'Удалить пользователя'}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showDeleteMessageModal}
  <div class="modal-shell">
    <button
      class="modal-overlay"
      type="button"
      aria-label="Закрыть окно удаления сообщения"
      on:click={() => {
        showDeleteMessageModal = false;
        messagePendingDeletionId = null;
      }}
    ></button>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="delete-message-title">
      <h3 id="delete-message-title">Удалить сообщение</h3>
      <p class="modal-copy">Сообщение будет удалено. Если его вложения больше нигде не используются, они тоже будут удалены.</p>
      <div class="modal-actions">
        <button
          type="button"
          on:click={() => {
            showDeleteMessageModal = false;
            messagePendingDeletionId = null;
          }}
        >
          Отмена
        </button>
        <button type="button" class="danger-action" on:click={confirmDeleteMessage}>Удалить</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .chat-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    height: 100%;
    position: relative;
    min-width: 0;
    min-height: 0;
  }

  .drop-overlay {
    position: absolute;
    inset: 0;
    z-index: 30;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 0 24px 104px;
    background: linear-gradient(180deg, rgba(15, 23, 42, 0.08), rgba(15, 23, 42, 0.04));
    pointer-events: none;
  }

  .drop-overlay-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 22px 28px;
    border: 2px dashed #2563eb;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.96);
    color: #0f172a;
    box-shadow: 0 18px 42px rgba(15, 23, 42, 0.16);
    text-align: center;
  }

  .drop-overlay-card strong {
    font-size: 17px;
  }

  .drop-overlay-card span {
    font-size: 13px;
    color: #64748b;
  }

  .chat-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 24px;
    border-bottom: 1px solid #e0e0e0;
    background: white;
  }

  .chat-back-btn {
    display: none;
    width: 38px;
    height: 38px;
    min-width: 38px;
    padding: 0;
    border: none;
    border-radius: 999px;
    background: #eef2f7;
    color: #0f172a;
    cursor: pointer;
    font-size: 20px;
    line-height: 1;
  }

  .chat-header-btn {
    padding: 16px 0;
    display: flex;
    align-items: center;
    width: 100%;
    background: white;
    border: none;
    cursor: pointer;
    text-align: left;
    min-width: 0;
  }

  .chat-header-btn:hover {
    background: #f8fafc;
  }

  .chat-header-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .chat-header-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  h2 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    min-width: 0;
  }

  .chat-header-btn:hover h2 {
    color: #2563eb;
  }

  .chat-header-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: none;
    font-size: 12px;
    line-height: 1.2;
    color: #64748b;
  }

  .chat-header-status.online {
    color: #16a34a;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: #dc2626;
    flex: none;
  }

  .chat-header-status.online .status-dot {
    background: #16a34a;
  }

  .pinned-bar {
    display: flex;
    align-items: stretch;
    gap: 8px;
    padding: 8px 24px 10px;
    border-bottom: 1px solid #eef2f7;
    background: #f8fafc;
  }

  .pinned-main {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border: none;
    border-radius: 12px;
    background: #e8f0fe;
    color: #0f172a;
    text-align: left;
    cursor: pointer;
  }

  .pinned-label {
    font-size: 12px;
    font-weight: 700;
    color: #1d4ed8;
    white-space: nowrap;
  }

  .pinned-content {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 13px;
  }

  .pinned-content.attachment-only {
    font-style: italic;
  }

  .pinned-nav {
    display: flex;
    gap: 6px;
  }

  .pinned-nav-btn {
    width: 36px;
    min-width: 36px;
    border: none;
    border-radius: 10px;
    background: #e2e8f0;
    color: #0f172a;
    cursor: pointer;
    font-size: 18px;
  }

  .pinned-action-btn {
    min-width: 60px;
    padding: 0 14px;
    border: none;
    border-radius: 10px;
    background: #e2e8f0;
    color: #0f172a;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
  }

  .pinned-action-btn.danger {
    background: #fee2e2;
    color: #b91c1c;
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

  .reply-bar {
    display: flex;
    align-items: stretch;
    gap: 8px;
    padding: 10px 24px 8px;
  }

  .reply-bar-main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    padding: 8px 12px;
    border: none;
    border-radius: 12px;
    background: #f1f5f9;
    color: #0f172a;
    text-align: left;
    cursor: pointer;
  }

  .reply-bar-text {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12px;
    color: #475569;
  }

  .reply-bar-text.attachment-only {
    font-style: italic;
  }

  .reply-bar-close {
    width: 36px;
    min-width: 36px;
    border: none;
    border-radius: 10px;
    background: #e2e8f0;
    color: #334155;
    cursor: pointer;
    font-size: 20px;
    line-height: 1;
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

  .modal-actions .primary-action {
    background: #0f172a;
    color: white;
  }

  .modal-actions .danger-action {
    background: #b91c1c;
    color: white;
  }

  .modal-copy {
    margin: 0 0 16px;
    color: #475569;
    line-height: 1.45;
  }

  .option-toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
    color: #334155;
    font-size: 14px;
  }

  .hidden-input {
    display: none;
  }

  @media (max-width: 768px) {
    .chat-header {
      gap: 10px;
      padding: 0 12px;
    }

    .chat-back-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .chat-header-btn {
      padding: 13px 0;
    }

    .chat-header-title-row {
      gap: 8px;
    }

    h2 {
      font-size: 16px;
    }

    .drop-overlay {
      padding: 0 14px 92px;
    }

    .pinned-bar {
      padding: 8px 12px 10px;
      flex-wrap: wrap;
    }

    .pinned-nav {
      order: 2;
    }

    .pinned-action-btn {
      min-height: 36px;
    }

    .reply-bar {
      padding: 10px 12px 8px;
    }

    .drop-overlay-card {
      width: 100%;
      max-width: 360px;
      padding: 18px 20px;
    }

    .error-toast {
      top: 66px;
      right: 12px;
      left: 12px;
      max-width: none;
    }

    .typing-indicator {
      padding: 8px 12px 0;
    }

    .edit-area {
      flex-wrap: wrap;
      padding: 10px 12px;
    }

    .edit-area input {
      min-width: 0;
    }

    .edit-save,
    .edit-cancel {
      flex: 1 1 120px;
    }

    .modal-shell {
      padding: 16px;
      align-items: flex-end;
    }

    .modal {
      width: min(100%, 420px);
      max-height: calc(100dvh - 32px);
      overflow-y: auto;
      padding: 20px;
      border-radius: 18px;
    }

    .modal-actions {
      flex-wrap: wrap;
      gap: 10px;
    }

    .modal-actions button {
      flex: 1 1 140px;
      min-height: 44px;
    }
  }
</style>

