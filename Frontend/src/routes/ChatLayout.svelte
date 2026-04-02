<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { push } from 'svelte-spa-router';
  import { api } from '../lib/api';
  import { auth, chats, type Chat } from '../lib/stores';
  import { chatDeletedEvent, chatUpdatedEvent, memberEvent, sseMessage, typingEvent } from '../lib/sse';
  import * as crypto from '../lib/crypto';
  import ChatSidebar from '../components/chat/ChatSidebar.svelte';
  import CreateChatModal from '../components/chat/CreateChatModal.svelte';
  import Avatar from '../components/common/Avatar.svelte';
  import AvatarCropModal from '../components/settings/AvatarCropModal.svelte';
  import ChatView from './ChatView.svelte';
  import type { SearchUserResult } from '../lib/types';

  export let params: { id?: string } = {};

  let loading = true;
  let showCreateModal = false;
  let showSettingsModal = false;
  let showUsernameModal = false;
  let showExportKeyModal = false;
  let showPasswordModal = false;
  let showDeleteAccountModal = false;
  let showAvatarModal = false;
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
  let selectedChatId: string | null = null;
  let selectedChatDetail: Chat | null = null;

  let userSearch = '';
  let searchResults: SearchUserResult[] = [];
  let searching = false;
  let selectedUserId: string | null = null;
  let pendingAvatarFile: File | null = null;

  let unsubscribeMemberEvent: (() => void) | undefined;
  let unsubscribeChatDeleted: (() => void) | undefined;
  let unsubscribeSSE: (() => void) | undefined;
  let unsubscribeTypingEvent: (() => void) | undefined;
  let unsubscribeChatUpdated: (() => void) | undefined;
  let previousSelectedChatId: string | null = null;

  $: selectedChatId = params.id ?? null;
  $: selectedChatDetail = selectedChatId ? $chats.find((chat) => chat.id === selectedChatId) ?? null : null;
  $: if (previousSelectedChatId !== selectedChatId) {
    if (previousSelectedChatId) {
      chats.finalizeClosedChat(previousSelectedChatId);
    }
    previousSelectedChatId = selectedChatId;
  }

  function resetCreateState() {
    newChatName = '';
    userSearch = '';
    selectedUserId = null;
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

    let lastProcessedMessageId = '';
    unsubscribeSSE = sseMessage.subscribe(async (event) => {
      if (!event || !event.message || !event.chatId) {
        sseMessage.set(null);
        return;
      }

      if (event.message.id === lastProcessedMessageId) {
        sseMessage.set(null);
        return;
      }

      lastProcessedMessageId = event.message.id;

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

    unsubscribeChatUpdated = chatUpdatedEvent.subscribe((chatId) => {
      if (!chatId) return;
      chats.refreshChat(chatId).finally(() => {
        chatUpdatedEvent.set(null);
      });
    });
  });

  onDestroy(() => {
    unsubscribeMemberEvent?.();
    unsubscribeChatDeleted?.();
    unsubscribeSSE?.();
    unsubscribeTypingEvent?.();
    unsubscribeChatUpdated?.();
  });
</script>

<div class="layout">
  <input id="avatarInput" class="hidden-input" type="file" accept="image/jpeg,image/png,image/webp" on:change={handleAvatarFileChange} />
  <ChatSidebar chats={$chats} {loading} {selectedChatId} on:create={() => (showCreateModal = true)} on:settings={() => (showSettingsModal = true)} />

  <main class="main">
    {#if selectedChatId}
      <ChatView params={{ id: selectedChatId }} chatDetail={selectedChatDetail} />
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
      <h3 id="settings-title">Настройки</h3>
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
    background: #fff;
  }

  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
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
</style>
