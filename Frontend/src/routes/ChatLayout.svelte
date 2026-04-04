<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { push } from 'svelte-spa-router';
  import { api } from '../lib/api';
  import { auth, chats, type Chat } from '../lib/stores';
  import { chatDeletedEvent, chatUpdatedEvent, deletedFilesEvent, memberEvent, readStateEvent, sseMessage, typingEvent, userPresenceEvent } from '../lib/sse';
  import * as crypto from '../lib/crypto';
  import ChatSidebar from '../components/chat/ChatSidebar.svelte';
  import CreateChatModal from '../components/chat/CreateChatModal.svelte';
  import Avatar from '../components/common/Avatar.svelte';
  import AvatarCropModal from '../components/settings/AvatarCropModal.svelte';
  import UserFilesModal from '../components/settings/UserFilesModal.svelte';
  import ProjectInfoModal from '../components/common/ProjectInfoModal.svelte';
  import ChatView from './ChatView.svelte';
  import { cacheFile, getCachedFile } from '../lib/file-cache';
  import { formatFileSize, isPersonalChatWithUser, parseFileMetadataJson } from '../lib/chat-helpers';
  import type { ChatFileMetadata, SearchUserResult } from '../lib/types';

  export let params: { id?: string } = {};

  let loading = true;
  let showCreateModal = false;
  let showSettingsModal = false;
  let showUsernameModal = false;
  let showExportKeyModal = false;
  let showPasswordModal = false;
  let showDeleteAccountModal = false;
  let showProjectInfoModal = false;
  let showAvatarModal = false;
  let showUserFilesModal = false;
  let error = '';
  let errorTimeout: ReturnType<typeof setTimeout> | null = null;
  let exportConfirmChecked = false;
  let exportingKey = false;
  let uploadingAvatar = false;
  let newUsername = '';
  let updatingUsername = false;
  let newPassword = '';
  let newPasswordConfirm = '';
  let changingPassword = false;
  let deletingAccount = false;
  let deleteAccountConfirmation = '';
  let newChatName = '';
  let newChatType: 'pm' | 'gm' = 'gm';
  let creatingChat = false;
  let creatingSidebarPm = false;
  let selectedChatId: string | null = null;
  let selectedChatDetail: Chat | null = null;
  let sidebarSearch = '';
  let sidebarUserResults: SearchUserResult[] = [];
  let sidebarSearching = false;
  let showSidebarUserModal = false;
  let selectedSidebarUser: SearchUserResult | null = null;

  let userSearch = '';
  let searchResults: SearchUserResult[] = [];
  let searching = false;
  let selectedUserId: string | null = null;
  let pendingAvatarFile: File | null = null;
  let loadingUserFiles = false;
  let userFilesQuotaBytes = 0;
  let userFilesUsedBytes = 0;
  let inaccessibleUserFilesBytes = 0;
  let inaccessibleUserFiles: Array<{ fileId: string; chatId: string }> = [];
  let deletingInaccessibleUserFiles = false;
  let deletingOwnedFile = false;
  let filePendingDeletion: (typeof userFileGroups)[number]['files'][number] & { chatId: string } | null = null;
  let showDeleteOwnedFileModal = false;
  let imageDeletePreviewLoading = false;
  let selectedDeleteMode: 'smooth' | 'nearest' | 'none' = 'smooth';
  let imageDeletePreviews: {
    smooth: { objectUrl: string; width: number; height: number } | null;
    nearest: { objectUrl: string; width: number; height: number } | null;
  } = {
    smooth: null,
    nearest: null
  };
  let userFileGroups: Array<{
    chatId: string;
    chatName: string;
    totalSizeLabel: string;
    totalSizeBytes: number;
    fileCount: number;
    files: Array<{
      id: string;
      name: string;
      type: string;
      size: number;
      sizeLabel: string;
      updatedAt: number;
      deletedAt: number | null;
      isAvatar?: boolean;
      previewDataUrl?: string;
    }>;
  }> = [];

  let unsubscribeMemberEvent: (() => void) | undefined;
  let unsubscribeChatDeleted: (() => void) | undefined;
  let unsubscribeSSE: (() => void) | undefined;
  let unsubscribeTypingEvent: (() => void) | undefined;
  let unsubscribeDeletedFiles: (() => void) | undefined;
  let unsubscribeChatUpdated: (() => void) | undefined;
  let unsubscribeUserPresence: (() => void) | undefined;
  let unsubscribeReadState: (() => void) | undefined;
  let previousSelectedChatId: string | null = null;
  let pinnedChatIds: string[] = [];
  let pinnedChatStorageKey: string | null = null;
  let loadedPinnedChatStorageKey: string | null = null;

  $: selectedChatId = params.id ?? null;
  $: selectedChatDetail = selectedChatId ? $chats.find((chat) => chat.id === selectedChatId) ?? null : null;
  $: pinnedChatStorageKey = $auth.user?.id ? `unnamed-messenger:pinned-chats:${$auth.user.id}` : null;
  $: displayedChats = [
    ...$chats.filter((chat) => pinnedChatIds.includes(chat.id)),
    ...$chats.filter((chat) => !pinnedChatIds.includes(chat.id))
  ];
  $: normalizedSidebarSearch = sidebarSearch.trim().toLocaleLowerCase();
  $: searchedChats = normalizedSidebarSearch
    ? displayedChats.filter((chat) => {
        const chatName = (chat.type === 'pm' ? chat.otherUser?.username : chat.name) ?? '';
        return chatName.toLocaleLowerCase().includes(normalizedSidebarSearch);
      })
    : [];
  $: if (previousSelectedChatId !== selectedChatId) {
    if (previousSelectedChatId) {
      chats.finalizeClosedChat(previousSelectedChatId);
    }
    previousSelectedChatId = selectedChatId;
  }
  $: if (typeof localStorage !== 'undefined' && pinnedChatStorageKey !== loadedPinnedChatStorageKey) {
    loadedPinnedChatStorageKey = pinnedChatStorageKey;
    pinnedChatIds = loadPinnedChatIds(pinnedChatStorageKey);
  }

  function loadPinnedChatIds(storageKey: string | null) {
    if (!storageKey || typeof localStorage === 'undefined') {
      return [];
    }

    try {
      const rawValue = localStorage.getItem(storageKey);
      if (!rawValue) {
        return [];
      }

      const parsed = JSON.parse(rawValue);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter((value): value is string => typeof value === 'string');
    } catch {
      return [];
    }
  }

  function savePinnedChatIds(nextPinnedChatIds: string[]) {
    pinnedChatIds = [...new Set(nextPinnedChatIds)];

    if (!pinnedChatStorageKey || typeof localStorage === 'undefined') {
      return;
    }

    try {
      localStorage.setItem(pinnedChatStorageKey, JSON.stringify(pinnedChatIds));
    } catch {
      // ignore localStorage write failures
    }
  }

  function togglePinnedChat(event: CustomEvent<{ chatId: string }>) {
    const { chatId } = event.detail;
    if (!chatId) {
      return;
    }

    if (pinnedChatIds.includes(chatId)) {
      savePinnedChatIds(pinnedChatIds.filter((id) => id !== chatId));
      return;
    }

    savePinnedChatIds([...pinnedChatIds, chatId]);
  }

  function resetCreateState() {
    newChatName = '';
    userSearch = '';
    selectedUserId = null;
  }

  function clearError() {
    error = '';
    if (errorTimeout) {
      clearTimeout(errorTimeout);
      errorTimeout = null;
    }
  }

  function showError(message: string) {
    clearError();
    error = message;
    errorTimeout = setTimeout(() => {
      error = '';
      errorTimeout = null;
    }, 4000);
  }

  function getBlockRelatedErrorMessage(exception: unknown, fallback: string) {
    if (!(exception instanceof Error)) {
      return fallback;
    }

    if (exception.message === 'This user blocked you') {
      return 'Этот пользователь вас заблокировал, поэтому создать чат или пригласить его нельзя';
    }

    if (exception.message === 'You blocked this user') {
      return 'Сначала разблокируйте пользователя, чтобы создать чат или пригласить его';
    }

    return exception.message || fallback;
  }

  async function searchUsers() {
    if (!userSearch.trim()) {
      searchResults = [];
      return;
    }

    searching = true;
    try {
      const results = await api.users.search(userSearch);
      searchResults = results.filter((user) => user.id !== $auth.user?.id);
    } catch {
      searchResults = [];
    } finally {
      searching = false;
    }
  }

  async function searchSidebarUsers(query: string) {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      sidebarUserResults = [];
      sidebarSearching = false;
      return;
    }

    sidebarSearching = true;
    try {
      const results = await api.users.search(trimmedQuery);
      if (sidebarSearch.trim() !== trimmedQuery) {
        return;
      }

      sidebarUserResults = results.filter((user) => user.id !== $auth.user?.id);
    } catch {
      if (sidebarSearch.trim() === trimmedQuery) {
        sidebarUserResults = [];
      }
    } finally {
      if (sidebarSearch.trim() === trimmedQuery) {
        sidebarSearching = false;
      }
    }
  }

  function handleSidebarSearchChange(event: CustomEvent<{ value: string }>) {
    sidebarSearch = event.detail.value;

    if (!sidebarSearch.trim()) {
      sidebarUserResults = [];
      sidebarSearching = false;
      return;
    }

    searchSidebarUsers(sidebarSearch);
  }

  function clearSidebarSearch() {
    sidebarSearch = '';
    sidebarUserResults = [];
    sidebarSearching = false;
  }

  function openSidebarUserModal(event: CustomEvent<{ user: SearchUserResult }>) {
    selectedSidebarUser = event.detail.user;
    showSidebarUserModal = true;
  }

  function getExistingPersonalChat(userId: string) {
    return $chats.find((chat) => isPersonalChatWithUser(chat, userId)) ?? null;
  }

  async function handleOpenOrCreateSidebarPm() {
    if (!selectedSidebarUser || creatingSidebarPm) {
      return;
    }

    const sidebarUser = selectedSidebarUser;
    const existingChat = $chats.find((chat) => isPersonalChatWithUser(chat, sidebarUser.id));
    if (existingChat) {
      showSidebarUserModal = false;
      selectedSidebarUser = null;
      clearSidebarSearch();
      push(`/chats/${existingChat.id}`);
      return;
    }

    creatingSidebarPm = true;
    try {
      const chat = await chats.createChat({
        type: 'pm',
        selectedUserId: sidebarUser.id,
        selectedUserPublicKey: sidebarUser.publicKey
      });

      showSidebarUserModal = false;
      selectedSidebarUser = null;
      clearSidebarSearch();
      push(`/chats/${chat.id}`);
    } catch (exception) {
      showError(getBlockRelatedErrorMessage(exception, 'Не удалось создать чат'));
    } finally {
      creatingSidebarPm = false;
    }
  }

  async function handleToggleBlockUser(user: SearchUserResult) {
    if (!$auth.user || !user?.id) {
      return;
    }

    const isBlocked = ($auth.user.blockedUserIds ?? []).includes(user.id);
    const warningText = isBlocked
      ? `Разблокировать пользователя ${user.username}?\n\nПосле этого он снова сможет приглашать вас в чаты и создавать с вами личный чат.`
      : `Заблокировать пользователя ${user.username}?\n\nПоследствия блокировки:\n- личный чат с ним будет удалён;\n- он больше не сможет приглашать вас в чаты и создавать с вами личный чат;\n- все его сообщения и вложения будут скрыты под спойлером до ручного открытия.`;

    if (!window.confirm(warningText)) {
      return;
    }

    try {
      if (isBlocked) {
        const result = await api.users.unblock(user.id);
        auth.updateUser({ blockedUserIds: result.blockedUserIds });
      } else {
        const result = await api.users.block(user.id);
        auth.updateUser({ blockedUserIds: result.blockedUserIds });

        for (const deletedChatId of result.deletedChatIds) {
          chats.handleChatDeleted(deletedChatId);
          if (selectedChatId === deletedChatId) {
            push('/chats');
          }
        }
      }
    } catch (exception) {
      alert(exception instanceof Error ? exception.message : 'Не удалось обновить статус блокировки');
    }
  }

  async function loadChats() {
    loading = true;
    try {
      await chats.loadChats();
    } finally {
      loading = false;
    }
  }

  async function handleCreateChat() {
    if (creatingChat) return;

    creatingChat = true;
    try {
      const selectedUser = searchResults.find((user) => user.id === selectedUserId);
      const chat = await chats.createChat({
        type: newChatType,
        name: newChatType === 'gm' ? newChatName : undefined,
        selectedUserId,
        selectedUserPublicKey: selectedUser?.publicKey
      });

      showCreateModal = false;
      resetCreateState();
      push(`/chats/${chat.id}`);
    } catch (exception) {
      showError(getBlockRelatedErrorMessage(exception, 'Не удалось создать чат'));
    } finally {
      creatingChat = false;
    }
  }

  async function handleLogout() {
    await api.auth.logout();
    auth.logout();
    chats.clear();
    push('/login');
  }

  async function handleDeleteAccount() {
    if (deletingAccount || deleteAccountConfirmation !== 'Точно удалить') return;

    deletingAccount = true;
    try {
      await api.users.deleteMe();
      localStorage.removeItem('encryptedPrivateKey');
      auth.logout();
      chats.clear();
      showDeleteAccountModal = false;
      deleteAccountConfirmation = '';
      push('/register');
    } finally {
      deletingAccount = false;
    }
  }

  async function handleUpdateUsername() {
    if (!newUsername.trim() || updatingUsername) return;

    updatingUsername = true;
    try {
      const updatedUser = await api.users.update({ username: newUsername.trim() });
      auth.updateUser({ username: updatedUser.username });
      showUsernameModal = false;
      newUsername = '';
    } finally {
      updatingUsername = false;
    }
  }

  function openAvatarPicker() {
    document.getElementById('avatarInput')?.click();
  }

  function handleAvatarFileChange(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';

    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      alert('Поддерживаются только JPEG, PNG и WebP.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      alert('Размер файла не должен превышать 5 МБ.');
      return;
    }

    pendingAvatarFile = file;
    showAvatarModal = true;
    showSettingsModal = false;
  }

  async function handleAvatarSave(event: CustomEvent<{ blob: Blob }>) {
    uploadingAvatar = true;
    try {
      const { avatarUrl, avatarUpdatedAt } = await api.users.uploadAvatar(event.detail.blob);
      auth.updateUser({ avatarUrl, avatarUpdatedAt });
      showAvatarModal = false;
      pendingAvatarFile = null;
    } catch (exception) {
      alert(exception instanceof Error ? exception.message : 'Не удалось обновить аватар');
    } finally {
      uploadingAvatar = false;
    }
  }

  async function handleDeleteAvatar() {
    try {
      await api.users.deleteAvatar();
      auth.updateUser({ avatarUrl: null, avatarUpdatedAt: null });
    } catch (exception) {
      alert(exception instanceof Error ? exception.message : 'Не удалось удалить аватар');
    }
  }

  async function handleExportPrivateKey() {
    if (exportingKey || !exportConfirmChecked) return;

    exportingKey = true;
    try {
      const encryptedPrivateKey = localStorage.getItem('encryptedPrivateKey');
      if (!encryptedPrivateKey) {
        throw new Error('Encrypted private key not found');
      }

      const blob = new Blob([encryptedPrivateKey], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `private_key_${$auth.user?.username || 'user'}.key`;
      link.click();
      URL.revokeObjectURL(url);

      showExportKeyModal = false;
      exportConfirmChecked = false;
    } finally {
      exportingKey = false;
    }
  }

  async function handleChangePassword() {
    if (!newPassword || newPassword !== newPasswordConfirm || changingPassword) return;

    changingPassword = true;
    try {
      const { salt } = await api.auth.changePassword(newPassword);
      if ($auth.privateKey) {
        const derivedKey = await crypto.deriveKey(newPassword, Uint8Array.from(atob(salt), (char) => char.charCodeAt(0)));
        const exportedKey = await window.crypto.subtle.exportKey('pkcs8', $auth.privateKey);
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, derivedKey, exportedKey);
        const combined = new Uint8Array(iv.length + encrypted.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(encrypted), iv.length);
        localStorage.setItem('encryptedPrivateKey', btoa(String.fromCharCode(...combined)));
      }

      showPasswordModal = false;
      newPassword = '';
      newPasswordConfirm = '';
      alert('Пароль изменён. На других устройствах потребуется повторный вход с новым паролем.');
    } catch {
      alert('Не удалось изменить пароль');
    } finally {
      changingPassword = false;
    }
  }

  function getChatDisplayName(chat: Chat) {
    return chat.type === 'pm' ? chat.otherUser?.username || 'Личный чат' : chat.name || 'Групповой чат';
  }

  async function openUserFilesModal() {
    showSettingsModal = false;
    showUserFilesModal = true;
    loadingUserFiles = true;
    inaccessibleUserFilesBytes = 0;
    inaccessibleUserFiles = [];
    userFileGroups = [];

    try {
      const result = await api.files.listMine();
      userFilesQuotaBytes = result.quotaBytes;
      userFilesUsedBytes = result.usedBytes;

      const availableChats = new Map($chats.map((chat) => [chat.id, chat]));
      const filesByChat = new Map<string, typeof result.files>();

      for (const file of result.files) {
        if (!availableChats.has(file.chatId)) {
          inaccessibleUserFilesBytes += file.size;
          inaccessibleUserFiles.push({ fileId: file.id, chatId: file.chatId });
          continue;
        }

        const bucket = filesByChat.get(file.chatId) ?? [];
        bucket.push(file);
        filesByChat.set(file.chatId, bucket);
      }

      const nextGroups = await Promise.all(
        Array.from(filesByChat.entries()).map(async ([chatId, files]) => {
          const knownChat = availableChats.get(chatId);
          const hydratedChat = knownChat?.chatKey ? knownChat : await chats.ensureChatLoaded(chatId, { limit: 1 });
          const chatKey = hydratedChat?.chatKey ?? null;
          const metadataEntries = await api.files.downloadChatFilesMetadata(chatId);
          const metadataById = new Map(metadataEntries.filter((item) => item.fileId).map((item) => [item.fileId as string, item]));

          const decoratedFiles = await Promise.all(
            files.map(async (file) => {
              const metadataEntry = metadataById.get(file.id);
              let metadata: ChatFileMetadata | null = null;

              if (metadataEntry && chatKey) {
                try {
                  const decryptedMetadataBytes = await crypto.decryptBinary(
                    chatKey,
                    crypto.base64ToBytes(metadataEntry.metadataBase64)
                  );
                  metadata = parseFileMetadataJson(new TextDecoder().decode(decryptedMetadataBytes));
                } catch {
                  metadata = null;
                }
              }

              return {
                id: file.id,
                name: metadata?.name || `Файл ${file.id.slice(0, 8)}`,
                type: metadata?.type || 'application/octet-stream',
                size: file.size,
                sizeLabel: formatFileSize(file.size),
                updatedAt: file.updatedAt,
                deletedAt: file.deletedAt,
                isAvatar: file.isAvatar,
                previewDataUrl: metadata?.previewDataUrl
              };
            })
          );

          decoratedFiles.sort((left, right) => right.updatedAt - left.updatedAt);

          return {
            chatId,
            chatName: getChatDisplayName(hydratedChat ?? knownChat!),
            totalSizeLabel: formatFileSize(files.reduce((sum, file) => sum + file.size, 0)),
            totalSizeBytes: files.reduce((sum, file) => sum + file.size, 0),
            fileCount: files.length,
            files: decoratedFiles
          };
        })
      );

      userFileGroups = nextGroups.sort((left, right) => left.chatName.localeCompare(right.chatName, 'ru'));
    } catch (exception) {
      alert(exception instanceof Error ? exception.message : 'Не удалось загрузить список файлов');
      showUserFilesModal = false;
    } finally {
      loadingUserFiles = false;
    }
  }

  async function handleOpenOwnedFile(event: CustomEvent<{ fileId: string }>) {
    const file = userFileGroups.flatMap((group) => group.files.map((item) => ({ ...item, chatId: group.chatId }))).find((item) => item.id === event.detail.fileId);
    if (!file) {
      return;
    }

    const chat = $chats.find((item) => item.id === file.chatId) ?? (await chats.ensureChatLoaded(file.chatId, { limit: 1 }));
    if (!chat?.chatKey) {
      alert('Ключ чата недоступен');
      return;
    }

    let asset = await getCachedFile(file.id, file.updatedAt);
    if (!asset) {
      const contentResponse = await api.files.downloadChatFileContent(file.chatId, file.id);
      const decryptedContent = await crypto.decryptBinary(chat.chatKey, contentResponse.content);
      const blob = new Blob([Uint8Array.from(decryptedContent).buffer], {
        type: file.type || 'application/octet-stream'
      });
      asset = await cacheFile(file.id, blob, {
        type: file.type || 'application/octet-stream',
        name: file.name,
        updatedAt: contentResponse.updatedAt
      });
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

  function findOwnedFile(fileId: string) {
    return userFileGroups
      .flatMap((group) => group.files.map((file) => ({ ...file, chatId: group.chatId })))
      .find((file) => file.id === fileId) ?? null;
  }

  function revokeImageDeletePreviews() {
    imageDeletePreviews.smooth?.objectUrl && URL.revokeObjectURL(imageDeletePreviews.smooth.objectUrl);
    imageDeletePreviews.nearest?.objectUrl && URL.revokeObjectURL(imageDeletePreviews.nearest.objectUrl);
    imageDeletePreviews = { smooth: null, nearest: null };
  }

  async function openOwnedFileDeleteModal(event: CustomEvent<{ fileId: string }>) {
    const file = findOwnedFile(event.detail.fileId);
    if (!file) {
      return;
    }

    revokeImageDeletePreviews();
    filePendingDeletion = file;
    showDeleteOwnedFileModal = true;
    selectedDeleteMode = 'smooth';

    if (!file.type.startsWith('image/')) {
      return;
    }

    imageDeletePreviewLoading = true;
    try {
      const { asset } = await loadOwnedFileAsset(file);
      const smoothBlob = await createImagePlaceholder(asset.objectUrl, file.type, 'smooth');
      const nearestBlob = await createImagePlaceholder(asset.objectUrl, file.type, 'nearest');
      imageDeletePreviews = {
        smooth: {
          objectUrl: URL.createObjectURL(smoothBlob),
          width: 48,
          height: 48
        },
        nearest: {
          objectUrl: URL.createObjectURL(nearestBlob),
          width: 48,
          height: 48
        }
      };
    } catch {
      imageDeletePreviews = { smooth: null, nearest: null };
    } finally {
      imageDeletePreviewLoading = false;
    }
  }

  async function loadOwnedFileAsset(file: NonNullable<typeof filePendingDeletion>) {
    const chat = $chats.find((item) => item.id === file.chatId) ?? (await chats.ensureChatLoaded(file.chatId, { limit: 1 }));
    if (!chat?.chatKey) {
      throw new Error('Ключ чата недоступен');
    }

    let asset = await getCachedFile(file.id, file.updatedAt);
    if (!asset) {
      const contentResponse = await api.files.downloadChatFileContent(file.chatId, file.id);
      const decryptedContent = await crypto.decryptBinary(chat.chatKey, contentResponse.content);
      const blob = new Blob([Uint8Array.from(decryptedContent).buffer], {
        type: file.type || 'application/octet-stream'
      });
      asset = await cacheFile(file.id, blob, {
        type: file.type || 'application/octet-stream',
        name: file.name,
        updatedAt: contentResponse.updatedAt
      });
    }

    return { asset, chatKey: chat.chatKey };
  }

  function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Не удалось создать заглушку'));
        }
      }, type, quality);
    });
  }

  async function createImagePlaceholder(
    sourceUrl: string,
    outputType: string,
    mode: 'smooth' | 'nearest'
  ): Promise<Blob> {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Не удалось обработать изображение'));
      img.src = sourceUrl;
    });

    const maxSide = 48;
    const scale = Math.min(maxSide / image.naturalWidth, maxSide / image.naturalHeight, 1);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Не удалось создать заглушку');
    }

    context.imageSmoothingEnabled = mode === 'smooth';
    context.imageSmoothingQuality = mode === 'smooth' ? 'medium' : 'low';
    context.drawImage(image, 0, 0, width, height);

    const safeType = ['image/png', 'image/jpeg', 'image/webp'].includes(outputType) ? outputType : 'image/webp';
    return canvasBlob(canvas, safeType, safeType === 'image/png' ? undefined : 0.72);
  }

  async function deleteOwnedFileCompletely() {
    if (!filePendingDeletion || deletingOwnedFile) return;

    deletingOwnedFile = true;
    try {
      await api.files.deleteChatFile(filePendingDeletion.chatId, filePendingDeletion.id);
      showDeleteOwnedFileModal = false;
      filePendingDeletion = null;
      revokeImageDeletePreviews();
      await openUserFilesModal();
    } catch (exception) {
      alert(exception instanceof Error ? exception.message : 'Не удалось удалить файл');
    } finally {
      deletingOwnedFile = false;
    }
  }

  async function replaceOwnedImageWithPlaceholder(mode: 'smooth' | 'nearest') {
    if (!filePendingDeletion || deletingOwnedFile) return;

    deletingOwnedFile = true;
    try {
      const { asset, chatKey } = await loadOwnedFileAsset(filePendingDeletion);
      const placeholderBlob = await createImagePlaceholder(asset.objectUrl, filePendingDeletion.type, mode);
      const metadata: ChatFileMetadata = {
        name: filePendingDeletion.name,
        type: placeholderBlob.type || filePendingDeletion.type,
        size: placeholderBlob.size,
        previewDataUrl: asset.type.startsWith('image/') ? filePendingDeletion.previewDataUrl : undefined
      };

      const encryptedContent = await crypto.encryptBinary(chatKey, new Uint8Array(await placeholderBlob.arrayBuffer()));
      const encryptedMetadata = await crypto.encryptBinary(chatKey, new TextEncoder().encode(JSON.stringify(metadata)));
      await api.files.replaceMineWithPlaceholder(filePendingDeletion.id, encryptedContent, crypto.bytesToBase64(encryptedMetadata));

      showDeleteOwnedFileModal = false;
      filePendingDeletion = null;
      revokeImageDeletePreviews();
      await openUserFilesModal();
    } catch (exception) {
      alert(exception instanceof Error ? exception.message : 'Не удалось заменить файл заглушкой');
    } finally {
      deletingOwnedFile = false;
    }
  }

  async function handleDeleteOwnedFile() {
    if (!filePendingDeletion || deletingOwnedFile) return;

    if (filePendingDeletion.type.startsWith('image/')) {
      if (selectedDeleteMode === 'none') {
        await deleteOwnedFileCompletely();
        return;
      }

      await replaceOwnedImageWithPlaceholder(selectedDeleteMode);
      return;
    }

    await deleteOwnedFileCompletely();
  }

  async function handleDeleteInaccessibleUserFiles() {
    if (deletingInaccessibleUserFiles || inaccessibleUserFiles.length === 0) {
      return;
    }

    if (!confirm('Удалить все ваши файлы из чатов, где вы больше не состоите?')) {
      return;
    }

    deletingInaccessibleUserFiles = true;
    try {
      await Promise.all(
        inaccessibleUserFiles.map((file) => api.files.deleteChatFile(file.chatId, file.fileId))
      );
      await openUserFilesModal();
    } catch (exception) {
      alert(exception instanceof Error ? exception.message : 'Не удалось удалить недоступные файлы');
    } finally {
      deletingInaccessibleUserFiles = false;
    }
  }

  onMount(() => {
    loadChats();

    unsubscribeMemberEvent = memberEvent.subscribe(async (event) => {
      if (!event) return;

      const result = await chats.handleMemberEvent(event);
      if (result.removedCurrentUser && selectedChatId === event.chatId) {
        push('/chats');
      }

      memberEvent.set(null);
    });

    unsubscribeChatDeleted = chatDeletedEvent.subscribe((chatId) => {
      if (!chatId) return;

      const wasRemoved = chats.handleChatDeleted(chatId);
      if (wasRemoved && selectedChatId === chatId) {
        push('/chats');
      }

      chatDeletedEvent.set(null);
    });

    let lastProcessedMessageKey = '';
    unsubscribeSSE = sseMessage.subscribe(async (event) => {
      if (!event || !event.message || !event.chatId) {
        sseMessage.set(null);
        return;
      }

      const messageKey = `${event.eventType}:${event.message.id}`;
      if (messageKey === lastProcessedMessageKey) {
        sseMessage.set(null);
        return;
      }

      lastProcessedMessageKey = messageKey;

      try {
        await chats.applyIncomingEvent(event.chatId, event.message, selectedChatId);
      } finally {
        sseMessage.set(null);
      }
    });

    unsubscribeTypingEvent = typingEvent.subscribe((event) => {
      if (!event) return;
      chats.handleTypingEvent(event.chatId, event.userId);
      typingEvent.set(null);
    });

    unsubscribeDeletedFiles = deletedFilesEvent.subscribe((event) => {
      if (!event) return;
      deletedFilesEvent.set(null);
    });

    unsubscribeChatUpdated = chatUpdatedEvent.subscribe((chatId) => {
      if (!chatId) return;
      chats.refreshChat(chatId).finally(() => {
        chatUpdatedEvent.set(null);
      });
    });

    unsubscribeUserPresence = userPresenceEvent.subscribe((event) => {
      if (!event) return;
      chats.handlePresenceEvent(event.userId, event.isOnline, event.lastSeenAt ?? null);
      userPresenceEvent.set(null);
    });

    unsubscribeReadState = readStateEvent.subscribe((event) => {
      if (!event) return;
      chats.handleReadStateEvent(event.chatId, event.userId, event.lastReadAt);
      readStateEvent.set(null);
    });
  });

  onDestroy(() => {
    revokeImageDeletePreviews();
    unsubscribeMemberEvent?.();
    unsubscribeChatDeleted?.();
    unsubscribeSSE?.();
    unsubscribeTypingEvent?.();
    unsubscribeDeletedFiles?.();
    unsubscribeChatUpdated?.();
    unsubscribeUserPresence?.();
    unsubscribeReadState?.();
  });
</script>

<div class="layout" class:chat-open={Boolean(selectedChatId)}>
  <input id="avatarInput" class="hidden-input" type="file" accept="image/jpeg,image/png,image/webp" on:change={handleAvatarFileChange} />
  {#if error}
    <div class="error-toast" role="alert" aria-live="assertive">
      <span>{error}</span>
      <button type="button" class="error-toast-close" on:click={clearError} aria-label="Закрыть ошибку">×</button>
    </div>
  {/if}
  <div class="sidebar-wrap">
    <ChatSidebar
      chats={displayedChats}
      {loading}
      {selectedChatId}
      {pinnedChatIds}
      blockedUserIds={$auth.user?.blockedUserIds ?? []}
      searchQuery={sidebarSearch}
      {searchedChats}
      searchedUsers={sidebarUserResults}
      searchingUsers={sidebarSearching}
      on:create={() => (showCreateModal = true)}
      on:settings={() => (showSettingsModal = true)}
      on:togglepin={togglePinnedChat}
      on:searchchange={handleSidebarSearchChange}
      on:clearsearch={clearSidebarSearch}
      on:openuser={openSidebarUserModal}
      on:toggleblockuser={(event) => handleToggleBlockUser(event.detail.user)}
    />
  </div>

  <main class="main">
    {#if selectedChatId}
      <ChatView
        params={{ id: selectedChatId }}
        chatDetail={selectedChatDetail}
        showBackButton={true}
        on:back={() => push('/chats')}
      />
    {:else}
      <div class="no-chat">
        <p>Выберите чат, чтобы начать общение</p>
      </div>
    {/if}
  </main>
</div>

{#if showCreateModal}
  <CreateChatModal
    bind:chatType={newChatType}
    bind:chatName={newChatName}
    bind:userSearch
    bind:selectedUserId
    {searchResults}
    {searching}
    creating={creatingChat}
    chats={$chats}
    on:close={() => {
      showCreateModal = false;
      resetCreateState();
    }}
    on:create={handleCreateChat}
    on:search={searchUsers}
    on:selectUser={(event) => {
      selectedUserId = event.detail.userId;
    }}
  />
{/if}

{#if showSidebarUserModal && selectedSidebarUser}
  {@const existingChat = getExistingPersonalChat(selectedSidebarUser.id)}
  <div class="modal-shell">
    <button
      class="modal-overlay"
      type="button"
      on:click={() => {
        showSidebarUserModal = false;
        selectedSidebarUser = null;
      }}
      aria-label="Закрыть окно"
    ></button>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="sidebar-user-modal-title">
      <h3 id="sidebar-user-modal-title">{existingChat ? 'Открыть личный чат' : 'Создать личный чат'}</h3>
      <p class="modal-copy">
        {existingChat
          ? `Личный чат с пользователем ${selectedSidebarUser.username} уже существует.`
          : `Создать личный чат с пользователем ${selectedSidebarUser.username}?`}
      </p>
      <div class="modal-actions">
        <button
          type="button"
          on:click={() => {
            showSidebarUserModal = false;
            selectedSidebarUser = null;
          }}
          disabled={creatingSidebarPm}
        >
          Отмена
        </button>
        <button type="button" class="primary" on:click={handleOpenOrCreateSidebarPm} disabled={creatingSidebarPm}>
          {creatingSidebarPm ? 'Загрузка...' : existingChat ? 'Открыть чат' : 'Создать чат'}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showAvatarModal && pendingAvatarFile}
  <AvatarCropModal
    file={pendingAvatarFile}
    uploading={uploadingAvatar}
    on:close={() => {
      showAvatarModal = false;
      pendingAvatarFile = null;
    }}
    on:save={handleAvatarSave}
  />
{/if}

{#if showSettingsModal}
  <div class="modal-shell">
    <button class="modal-overlay" type="button" on:click={() => (showSettingsModal = false)} aria-label="Закрыть окно"></button>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div class="settings-header">
        <h3 id="settings-title">Настройки</h3>
        <button class="settings-info-btn" type="button" on:click={() => (showProjectInfoModal = true)}>О проекте</button>
      </div>
      <div class="profile-preview">
        <Avatar name={$auth.user?.username || 'U'} src={$auth.user?.avatarUrl} size={72} />
        <div class="profile-meta">
          <strong>{$auth.user?.username}</strong>
          <div class="profile-actions">
            <button class="settings-btn" type="button" on:click={openAvatarPicker}>Изменить аватар</button>
            <button class="settings-btn" type="button" disabled={!$auth.user?.avatarUrl} on:click={handleDeleteAvatar}>Удалить аватар</button>
          </div>
        </div>
      </div>
      <div class="settings-list">
        <button class="settings-btn" on:click={openUserFilesModal}>Мои файлы</button>
        <button class="settings-btn" on:click={() => { showUsernameModal = true; showSettingsModal = false; }}>Изменить имя пользователя</button>
        <button class="settings-btn" on:click={() => { showPasswordModal = true; showSettingsModal = false; }}>Изменить пароль</button>
        <button class="settings-btn" on:click={() => { showExportKeyModal = true; showSettingsModal = false; }}>Экспорт приватного ключа</button>
        <button class="settings-btn" on:click={handleLogout}>Выйти из аккаунта</button>
        <button class="settings-btn danger" on:click={() => { showDeleteAccountModal = true; showSettingsModal = false; }}>Удалить аккаунт</button>
      </div>
      <div class="modal-actions">
        <button on:click={() => (showSettingsModal = false)}>Закрыть</button>
      </div>
    </div>
  </div>
{/if}

{#if showUserFilesModal}
  <UserFilesModal
    loading={loadingUserFiles}
    quotaBytes={userFilesQuotaBytes}
    usedBytes={userFilesUsedBytes}
    inaccessibleBytes={inaccessibleUserFilesBytes}
    deletingInaccessible={deletingInaccessibleUserFiles}
    groups={userFileGroups}
    on:close={() => (showUserFilesModal = false)}
    on:openfile={handleOpenOwnedFile}
    on:deletefile={openOwnedFileDeleteModal}
    on:deleteinaccessible={handleDeleteInaccessibleUserFiles}
    on:openchat={(event) => {
      showUserFilesModal = false;
      push(`/chats/${event.detail.chatId}`);
    }}
  />
{/if}

{#if showDeleteOwnedFileModal && filePendingDeletion}
  <div class="modal-shell delete-file-shell">
    <button
      class="modal-overlay"
      type="button"
      aria-label="Закрыть окно удаления файла"
      on:click={() => {
        if (!deletingOwnedFile) {
          showDeleteOwnedFileModal = false;
          filePendingDeletion = null;
          revokeImageDeletePreviews();
        }
      }}
    ></button>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="delete-file-title">
      <h3 id="delete-file-title">Удалить файл</h3>
      {#if filePendingDeletion.type.startsWith('image/')}
        <p class="modal-copy">
          Выберите заглушку для удаляемого файла <strong>{filePendingDeletion.name}</strong>.
        </p>
        <div class="delete-options-row">
          <label class="delete-option" class:selected={selectedDeleteMode === 'smooth'}>
            <input type="radio" name="deleteMode" value="smooth" bind:group={selectedDeleteMode} disabled={deletingOwnedFile || imageDeletePreviewLoading} />
            <span class="preview-thumb large">
              {#if imageDeletePreviews.smooth}
                <img src={imageDeletePreviews.smooth.objectUrl} alt="Превью сглаженной заглушки" width="144" height="144" />
              {:else if imageDeletePreviewLoading}
                <span class="preview-loading">...</span>
              {:else}
                <span class="preview-loading">Нет</span>
              {/if}
            </span>
          </label>
          <label class="delete-option" class:selected={selectedDeleteMode === 'nearest'}>
            <input type="radio" name="deleteMode" value="nearest" bind:group={selectedDeleteMode} disabled={deletingOwnedFile || imageDeletePreviewLoading} />
            <span class="preview-thumb large">
              {#if imageDeletePreviews.nearest}
                <img src={imageDeletePreviews.nearest.objectUrl} alt="Превью пиксельной заглушки" width="144" height="144" />
              {:else if imageDeletePreviewLoading}
                <span class="preview-loading">...</span>
              {:else}
                <span class="preview-loading">Нет</span>
              {/if}
            </span>
          </label>
          <label class="delete-option text-option" class:selected={selectedDeleteMode === 'none'}>
            <input type="radio" name="deleteMode" value="none" bind:group={selectedDeleteMode} disabled={deletingOwnedFile} />
            <span class="text-option-label">Удалить без заглушки</span>
          </label>
        </div>
        <div class="modal-actions">
          <button
            type="button"
            on:click={() => {
              showDeleteOwnedFileModal = false;
              filePendingDeletion = null;
              revokeImageDeletePreviews();
            }}
            disabled={deletingOwnedFile}
          >
            Отмена
          </button>
          <button type="button" class="danger-action" disabled={deletingOwnedFile || imageDeletePreviewLoading} on:click={handleDeleteOwnedFile}>
            {deletingOwnedFile ? 'Удаление...' : 'Удалить'}
          </button>
        </div>
      {:else}
        <p class="modal-copy">
          Файл <strong>{filePendingDeletion.name}</strong> будет удалён полностью.
        </p>
        <div class="modal-actions">
          <button
            type="button"
            on:click={() => {
              showDeleteOwnedFileModal = false;
              filePendingDeletion = null;
              revokeImageDeletePreviews();
            }}
            disabled={deletingOwnedFile}
          >
            Отмена
          </button>
          <button type="button" class="danger-action" disabled={deletingOwnedFile} on:click={deleteOwnedFileCompletely}>
            {deletingOwnedFile ? 'Удаление...' : 'Удалить файл'}
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if showDeleteAccountModal}
  <div class="modal-shell">
    <button class="modal-overlay" type="button" on:click={() => (showDeleteAccountModal = false)} aria-label="Закрыть окно"></button>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="delete-account-title">
      <h3 id="delete-account-title">Удалить аккаунт</h3>
      <div class="warning-box danger-box">
        Это действие необратимо. Будут удалены ваши сообщения, личные чаты и локальные ключи на этом устройстве.
      </div>
      <div class="field">
        <label for="deleteAccountConfirm">Введите фразу "Точно удалить"</label>
        <input id="deleteAccountConfirm" type="text" bind:value={deleteAccountConfirmation} placeholder="Точно удалить" />
      </div>
      <div class="modal-actions">
        <button on:click={() => { showDeleteAccountModal = false; deleteAccountConfirmation = ''; }}>Отмена</button>
        <button class="danger-action" on:click={handleDeleteAccount} disabled={deletingAccount || deleteAccountConfirmation !== 'Точно удалить'}>
          {deletingAccount ? 'Удаление...' : 'Удалить аккаунт'}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showProjectInfoModal}
  <ProjectInfoModal on:close={() => (showProjectInfoModal = false)} />
{/if}

{#if showUsernameModal}
  <div class="modal-shell">
    <button class="modal-overlay" type="button" on:click={() => (showUsernameModal = false)} aria-label="Закрыть окно"></button>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="username-title">
      <h3 id="username-title">Изменить имя пользователя</h3>
      <div class="field">
        <label for="newUsername">Новое имя</label>
        <input id="newUsername" type="text" bind:value={newUsername} maxlength="30" placeholder="Введите новое имя..." />
      </div>
      <div class="modal-actions">
        <button on:click={() => { showUsernameModal = false; newUsername = ''; }}>Отмена</button>
        <button class="primary" on:click={handleUpdateUsername} disabled={updatingUsername || !newUsername.trim()}>
          {updatingUsername ? 'Сохранение...' : 'Сохранить'}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showExportKeyModal}
  <div class="modal-shell">
    <button class="modal-overlay" type="button" on:click={() => (showExportKeyModal = false)} aria-label="Закрыть окно"></button>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="export-key-title">
      <h3 id="export-key-title">Экспорт приватного ключа</h3>
      <div class="warning-box">
        Сохраните этот ключ в надёжном месте. С его помощью можно получить доступ к вашему аккаунту с другого устройства.
      </div>
      <p class="modal-desc">Этот ключ можно использовать для входа в аккаунт на другом устройстве.</p>
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={exportConfirmChecked} />
        <span>Я понимаю риски и хочу экспортировать ключ</span>
      </label>
      <div class="modal-actions">
        <button on:click={() => { showExportKeyModal = false; exportConfirmChecked = false; }}>Отмена</button>
        <button class="primary" on:click={handleExportPrivateKey} disabled={exportingKey || !exportConfirmChecked}>
          {exportingKey ? 'Экспорт...' : 'Скачать'}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showPasswordModal}
  <div class="modal-shell">
    <button class="modal-overlay" type="button" on:click={() => (showPasswordModal = false)} aria-label="Закрыть окно"></button>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="password-title">
      <h3 id="password-title">Изменить пароль</h3>
      <div class="warning-box">
        После смены пароля приватный ключ на других устройствах перестанет работать. Там потребуется загрузить новый зашифрованный ключ.
      </div>
      <div class="field">
        <label for="newPassword">Новый пароль</label>
        <input id="newPassword" type="password" bind:value={newPassword} placeholder="Введите новый пароль..." />
      </div>
      <div class="field">
        <label for="newPasswordConfirm">Подтвердите пароль</label>
        <input id="newPasswordConfirm" type="password" bind:value={newPasswordConfirm} placeholder="Повторите пароль..." />
      </div>
      {#if newPassword && newPasswordConfirm && newPassword !== newPasswordConfirm}
        <p class="error-text">Пароли не совпадают</p>
      {/if}
      <div class="modal-actions">
        <button on:click={() => { showPasswordModal = false; newPassword = ''; newPasswordConfirm = ''; }}>Отмена</button>
        <button class="primary" on:click={handleChangePassword} disabled={changingPassword || !newPassword || newPassword !== newPasswordConfirm}>
          {changingPassword ? 'Смена...' : 'Изменить'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .layout {
    display: flex;
    height: 100vh;
    height: 100dvh;
    background: #fff;
  }

  .sidebar-wrap {
    display: flex;
    min-height: 0;
  }

  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: #fff;
  }

  .no-chat {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #888;
    font-size: 16px;
  }

  .modal-shell {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .delete-file-shell {
    z-index: 120;
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

  h3 {
    margin: 0 0 24px;
    font-size: 20px;
  }

  .field {
    margin-bottom: 18px;
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

  .modal-actions {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    margin-top: 24px;
  }

  .modal-actions button {
    padding: 12px 20px;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
  }

  .primary {
    background: #4caf50;
    color: white;
  }

  .settings-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 18px;
  }

  .settings-header h3 {
    margin: 0;
  }

  .settings-info-btn {
    width: auto;
    min-width: 0;
    padding: 8px 12px;
    border: none;
    border-radius: 999px;
    background: #e2e8f0;
    color: #334155;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
  }

  .settings-info-btn:hover {
    background: #d8e1eb;
  }

  .profile-preview {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 14px;
    border-radius: 14px;
    background: #f7faf7;
    margin-bottom: 18px;
  }

  .profile-meta {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .profile-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .settings-btn {
    padding: 14px 18px;
    border: 1px solid #e0e0e0;
    border-radius: 10px;
    background: #fafafa;
    cursor: pointer;
    font-size: 15px;
    text-align: left;
    transition: background 0.2s;
    color: #666;
  }

  .settings-btn:hover:not(:disabled) {
    background: #f0f0f0;
  }

  .settings-btn:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .settings-btn.danger {
    color: #f44336;
    border-color: #ffcdd2;
  }

  .warning-box {
    background: #fff3cd;
    border: 1px solid #ffc107;
    border-radius: 8px;
    padding: 14px;
    font-size: 14px;
    color: #856404;
    margin-bottom: 16px;
  }

  .danger-box {
    background: #fdecea;
    border-color: #ef9a9a;
    color: #b71c1c;
  }

  .modal-desc {
    font-size: 14px;
    color: #666;
    margin-bottom: 16px;
    line-height: 1.4;
  }

  .modal-copy {
    font-size: 14px;
    color: #475569;
    margin: 0 0 16px;
    line-height: 1.45;
  }

  .delete-options-row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: stretch;
    margin-bottom: 18px;
  }

  .delete-option {
    flex: 1 1 180px;
    min-width: 0;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 12px;
    border: 1px solid #dbe4ee;
    border-radius: 14px;
    background: #f8fafc;
    cursor: pointer;
  }

  .delete-option.selected {
    border-color: #2563eb;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14);
    background: #eff6ff;
  }

  .delete-option input {
    margin: 0;
  }

  .preview-thumb {
    width: 96px;
    height: 96px;
    flex: none;
    border-radius: 12px;
    overflow: hidden;
    background: #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .preview-thumb.large {
    width: min(144px, 100%);
    aspect-ratio: 1;
    height: auto;
  }

  .preview-thumb img {
    width: 96px;
    height: 96px;
    object-fit: cover;
    display: block;
  }

  .preview-thumb.large img {
    width: 100%;
    height: 100%;
  }

  .preview-loading {
    font-size: 12px;
    color: #64748b;
  }

  .text-option {
    justify-content: center;
  }

  .text-option-label {
    text-align: center;
    font-size: 14px;
    font-weight: 600;
    color: #0f172a;
    line-height: 1.35;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    font-size: 14px;
    margin-bottom: 20px;
  }

  .error-text {
    color: #f44336;
    font-size: 14px;
    margin-top: -10px;
    margin-bottom: 10px;
  }

  .danger-action {
    background: #d32f2f;
    color: white;
  }

  .hidden-input {
    display: none;
  }

  .error-toast {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 160;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(420px, calc(100vw - 32px));
    padding: 12px 14px;
    border-radius: 12px;
    background: rgba(127, 29, 29, 0.96);
    color: #fff;
    box-shadow: 0 16px 40px rgba(15, 23, 42, 0.24);
  }

  .error-toast-close {
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    padding: 0;
  }

  @media (max-width: 768px) {
    .layout {
      display: block;
      position: relative;
    }

    .sidebar-wrap,
    .main {
      width: 100%;
      height: 100%;
    }

    .layout.chat-open .sidebar-wrap {
      display: none;
    }

    .layout:not(.chat-open) .main {
      display: none;
    }

    .no-chat {
      padding: 24px;
      text-align: center;
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
    }

    .modal-actions button {
      flex: 1 1 140px;
      min-height: 44px;
    }

    .settings-header {
      align-items: flex-start;
    }

    .profile-preview {
      align-items: flex-start;
      flex-direction: column;
    }

    .profile-meta {
      width: 100%;
    }
  }
</style>
