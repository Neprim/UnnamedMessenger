<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { push } from 'svelte-spa-router';
  import { api } from '../lib/api';
  import { auth, chats, type Chat } from '../lib/stores';
  import { memberEvent, chatDeletedEvent } from '../lib/sse';
  import * as crypto from '../lib/crypto';
  import ChatView from './ChatView.svelte';

  let loading = true;
  let showCreateModal = false;
  let showSettingsModal = false;
  let showUsernameModal = false;
  let showExportKeyModal = false;
  let showPasswordModal = false;
  let exportConfirmChecked = false;
  let exportingKey = false;
  let newUsername = '';
  let updatingUsername = false;
  let newPassword = '';
  let newPasswordConfirm = '';
  let changingPassword = false;
  let newChatName = '';
  let newChatType: 'pm' | 'gm' = 'gm';
  let creatingChat = false;
  let selectedChatId: string | null = null;

  let userSearch = '';
  let searchResults: { id: string; username: string; publicKey: string }[] = [];
  let searching = false;
  let selectedUserId: string | null = null;

  export let params: { id?: string } = {};

  $: selectedChatId = params.id || null;

  onDestroy(() => {
    if (unsubscribeMemberEvent) unsubscribeMemberEvent();
    if (unsubscribeChatDeleted) unsubscribeChatDeleted();
  });

  async function searchUsers() {
    if (!userSearch.trim()) {
      searchResults = [];
      return;
    }
    searching = true;
    try {
      const results = await api.users.search(userSearch);
      searchResults = results.filter(u => u.id !== $auth.user?.id);
    } catch (e) {
      searchResults = [];
    } finally {
      searching = false;
    }
  }

  function isUserInPersonalChat(userId: string): boolean {
    return $chats.some(c => c.type === 'pm' && c.members?.includes(userId));
  }

  let unsubscribeMemberEvent: () => void;
  let unsubscribeChatDeleted: () => void;

  onMount(async () => {
    const checkAuth = setInterval(() => {
      if (!$auth.isLoading) {
        clearInterval(checkAuth);
        loadChats();
      }
    }, 50);

    setTimeout(() => {
      clearInterval(checkAuth);
      loadChats();
    }, 5000);

    unsubscribeMemberEvent = memberEvent.subscribe(event => {
      if (event) {
        handleMemberEvent(event);
        memberEvent.set(null);
      }
    });

    unsubscribeChatDeleted = chatDeletedEvent.subscribe(chatId => {
      if (chatId) {
        const exists = $chats.find(c => c.id === chatId);
        if (exists) {
          chats.removeChat(chatId);
          if (selectedChatId === chatId) {
            push('/chats');
          }
        }
        chatDeletedEvent.set(null);
      }
    });
  });

  onDestroy(() => {
    if (unsubscribeMemberEvent) unsubscribeMemberEvent();
    if (unsubscribeChatDeleted) unsubscribeChatDeleted();
  });

  async function handleMemberEvent(event: { type: string; chatId: string; userId: string; memberCount: number; removed?: boolean; username?: string }) {
    if (event.type === 'member_added') {
      const exists = $chats.find(c => c.id === event.chatId);
      if (!exists && $auth.user?.id === event.userId) {
        const chatDetail = await api.chats.get(event.chatId);
        const currentMember = chatDetail.members.find((m: any) => m.id === $auth.user?.id);
        
        let otherUser = null;
        if (chatDetail.type === 'pm') {
          const otherMember = chatDetail.members.find((m: any) => m.id !== $auth.user?.id);
          if (otherMember) {
            otherUser = { id: otherMember.id, username: otherMember.username };
          }
        }
        
        let chatKey: CryptoKey | null = null;
        let lastMessage = null;
        
        if (currentMember && $auth.privateKey) {
          try {
            chatKey = await crypto.decryptChatKeyWithPrivateKey(currentMember.encryptedKey, $auth.privateKey);
            chats.setChatKey(event.chatId, chatKey);
          } catch (e) {
            console.error('Не удалось расшифровать ключ чата:', e);
          }
        }
        
        if (chatKey) {
          try {
            const messagesResult = await api.chats.getMessages(event.chatId, 10);
            if (messagesResult.messages && messagesResult.messages.length > 0) {
              const lastMsg = messagesResult.messages[messagesResult.messages.length - 1];
              if (lastMsg.senderId === null) {
                const parsed = JSON.parse(lastMsg.content || '{}');
                const systemContent = parsed.event === 'personal_chat_created' ? 'Личный чат создан' : 
                                      parsed.event === 'member_added' ? `${parsed.username} добавлен в чат` :
                                      parsed.event === 'member_removed' ? `${parsed.username} удалён из чата` :
                                      parsed.event === 'member_left' ? `${parsed.username} покинул чат` : '';
                lastMessage = {
                  senderId: null,
                  content: systemContent,
                  isSystem: true
                };
              } else {
                try {
                  const decrypted = await crypto.decryptMessage(chatKey, lastMsg.content);
                  const sender = chatDetail.members.find((m: any) => m.id === lastMsg.senderId);
                  lastMessage = {
                    senderId: lastMsg.senderId,
                    content: decrypted,
                    senderUsername: sender?.username || 'Unknown',
                    isSystem: false
                  };
                } catch {
                  lastMessage = {
                    senderId: lastMsg.senderId,
                    content: '[Decryption failed]',
                    senderUsername: 'Unknown',
                    isSystem: false
                  };
                }
              }
            }
          } catch (e) {
            console.error('Не удалось загрузить последние сообщения:', e);
          }
        }
        
        chats.addChat({
          id: chatDetail.id, 
          type: chatDetail.type, 
          name: chatDetail.name, 
          memberCount: event.memberCount,
          members: chatDetail.members.map((m: any) => m.id),
          otherUser,
          lastMessage
        });
      } else if (exists) {
        chats.updateChat(event.chatId, { memberCount: event.memberCount });
      }
    } else if (event.type === 'member_removed' || event.type === 'member_left') {
      const removedUser = event.username || 'Пользователь';
      const systemContent = event.type === 'member_removed' ? `${removedUser} удалён из чата` : `${removedUser} покинул чат`;
      
      if ($auth.user?.id === event.userId || event.removed) {
        chats.removeChat(event.chatId);
        if (selectedChatId === event.chatId) {
          push('/chats');
        }
      } else {
        chats.updateChat(event.chatId, { 
          memberCount: event.memberCount,
          lastMessage: {
            senderId: null,
            content: systemContent,
            isSystem: true
          }
        });
      }
    }
  }

  async function loadChats() {
    loading = true;
    try {
      const apiChats = await api.chats.list();
      const loadedChats: any[] = [];
      
      for (const chat of apiChats) {
        const chatDetail = await api.chats.get(chat.id);
        const currentMember = chatDetail.members.find((m: any) => m.id === $auth.user?.id);
        
        let chatKey: CryptoKey | null = null;
        if (currentMember && $auth.privateKey) {
          try {
            chatKey = await crypto.decryptChatKeyWithPrivateKey(currentMember.encryptedKey, $auth.privateKey);
            chats.setChatKey(chat.id, chatKey);
          } catch (e) {
            console.error('Не удалось расшифровать ключ чата:', e);
          }
        }
        
        let otherUser = null;
        if (chatDetail.type === 'pm') {
          const otherMember = chatDetail.members.find((m: any) => m.id !== $auth.user?.id);
          if (otherMember) {
            otherUser = { id: otherMember.id, username: otherMember.username };
          }
        }
        
        let lastMessage = null;
        if (chatKey) {
          try {
            const messagesResult = await api.chats.getMessages(chat.id, 10);
            if (messagesResult.messages && messagesResult.messages.length > 0) {
              const lastMsg = messagesResult.messages[messagesResult.messages.length - 1];
              if (lastMsg.senderId === null) {
                const parsed = JSON.parse(lastMsg.content || '{}');
                const systemContent = parsed.event === 'personal_chat_created' ? 'Личный чат создан' : 
                                      parsed.event === 'member_added' ? `${parsed.username} добавлен в чат` :
                                      parsed.event === 'member_removed' ? `${parsed.username} удалён из чата` :
                                      parsed.event === 'member_left' ? `${parsed.username} покинул чат` : '';
                lastMessage = {
                  senderId: null,
                  content: systemContent,
                  isSystem: true
                };
              } else {
                try {
                  const decrypted = await crypto.decryptMessage(chatKey, lastMsg.content);
                  const sender = chatDetail.members.find((m: any) => m.id === lastMsg.senderId);
                  lastMessage = {
                    senderId: lastMsg.senderId,
                    content: decrypted,
                    senderUsername: sender?.username || 'Unknown',
                    isSystem: false
                  };
                } catch {
                  lastMessage = {
                    senderId: lastMsg.senderId,
                    content: '[Decryption failed]',
                    senderUsername: 'Unknown',
                    isSystem: false
                  };
                }
              }
            }
            } catch (e) {
            console.error('Не удалось загрузить последние сообщения:', e);
          }
        }
        
      loadedChats.push({
        id: chat.id,
        type: chat.type,
        name: chat.name,
        memberCount: chat.memberCount,
        members: chatDetail.members.map((m: any) => m.id),
        otherUser,
        lastMessage
      });
    }
    
    chats.set(loadedChats);
  } catch (e) {
      console.error('Не удалось загрузить чаты:', e);
    } finally {
      loading = false;
    }
  }

  async function handleCreateChat() {
    if (creatingChat) return;
    creatingChat = true;

    try {
      const chatKey = await crypto.generateChatKey();
      const exportedChatKey = await crypto.exportChatKey(chatKey);
      
      const publicKey = await crypto.importPublicKey($auth.user!.publicKey);
      const encryptedKey = await crypto.encryptChatKeyWithPublicKey(chatKey, publicKey);

      let memberKeys: { [userId: string]: string } = {};
      if (newChatType === 'pm' && selectedUserId) {
        const otherUserPublicKey = searchResults.find(u => u.id === selectedUserId)?.publicKey;
        if (otherUserPublicKey) {
          const otherPublicKey = await crypto.importPublicKey(otherUserPublicKey);
          memberKeys[selectedUserId] = await crypto.encryptChatKeyWithPublicKey(chatKey, otherPublicKey);
        }
      }

      const members = newChatType === 'pm' ? [selectedUserId!] : [];

      const result = await api.chats.create({
        type: newChatType,
        name: newChatType === 'gm' ? newChatName : undefined,
        encryptedKey,
        memberKeys,
        members
      });

      const chatDetail = await api.chats.get(result.id);
      const currentMember = chatDetail.members.find((m: any) => m.id === $auth.user?.id);
      if (currentMember && $auth.privateKey) {
        const decryptedKey = await crypto.decryptChatKeyWithPrivateKey(currentMember.encryptedKey, $auth.privateKey);
        chats.setChatKey(result.id, decryptedKey);
      }

      chats.addChat({
        id: result.id, 
        type: newChatType, 
        name: newChatName || null, 
        memberCount: newChatType === 'pm' ? 2 : 1,
        members: [$auth.user?.id!, ...members],
        otherUser: newChatType === 'pm' ? { id: selectedUserId!, username: searchResults.find(u => u.id === selectedUserId)?.username || 'User' } : null,
        lastMessage: null
      });
      showCreateModal = false;
      newChatName = '';
      userSearch = '';
      selectedUserId = null;
      push(`/chats/${result.id}`);
    } catch (e) {
      console.error('Не удалось создать чат:', e);
    } finally {
      creatingChat = false;
    }
  }

  async function handleLogout() {
    await api.auth.logout();
    auth.logout();
    push('/login');
  }

  async function handleUpdateUsername() {
    if (!newUsername.trim() || updatingUsername) return;
    updatingUsername = true;
    try {
      const updatedUser = await api.users.update({ username: newUsername.trim() });
      auth.updateUser({ username: updatedUser.username });
      showUsernameModal = false;
      newUsername = '';
    } catch (e) {
      console.error('Не удалось обновить имя пользователя:', e);
    } finally {
      updatingUsername = false;
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
      const a = document.createElement('a');
      a.href = url;
      a.download = `private_key_${$auth.user?.username || 'user'}.key`;
      a.click();
      URL.revokeObjectURL(url);
      
      showExportKeyModal = false;
      exportConfirmChecked = false;
    } catch (e) {
      console.error('Не удалось экспортировать закрытый ключ:', e);
    } finally {
      exportingKey = false;
    }
  }

  async function handleChangePassword() {
    if (!newPassword || newPassword !== newPasswordConfirm || changingPassword) return;
    changingPassword = true;
    try {
      const { salt } = await api.auth.changePassword(newPassword);
      
      const oldEncryptedKey = localStorage.getItem('encryptedPrivateKey');
      if (oldEncryptedKey && $auth.privateKey) {
        const derivedKey = await crypto.deriveKey(newPassword, Uint8Array.from(atob(salt), c => c.charCodeAt(0)));
        const exportedKey = await window.crypto.subtle.exportKey('pkcs8', $auth.privateKey);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, derivedKey, exportedKey);
        const combined = new Uint8Array(iv.length + encrypted.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(encrypted), iv.length);
        const newEncryptedKey = btoa(String.fromCharCode(...combined));
        localStorage.setItem('encryptedPrivateKey', newEncryptedKey);
      }
      
      showPasswordModal = false;
      newPassword = '';
      newPasswordConfirm = '';
      alert('Пароль изменён. На других устройствах потребуется повторный вход с новым паролем.');
    } catch (e) {
      console.error('Не удалось изменить пароль:', e);
      alert('Не удалось изменить пароль');
    } finally {
      changingPassword = false;
    }
  }
</script>

<div class="layout">
  <aside class="sidebar">
    <header>
      <div class="header-left">
        <button class="icon-btn" on:click={() => showSettingsModal = true} title="Настройки">⚙️</button>
        <h2>Чаты</h2>
      </div>
      <div class="header-actions">
        <button class="icon-btn" on:click={() => showCreateModal = true} title="Новый чат">+</button>
        <button class="icon-btn logout" on:click={handleLogout} title="Выход">↪</button>
      </div>
    </header>

    <div class="chat-list">
      {#if loading}
        <div class="loading">Загрузка...</div>
      {:else if $chats.length === 0}
        <div class="empty">Пока нет чатов</div>
      {:else}
        {#each $chats as chat}
          <a 
            href="#/chats/{chat.id}" 
            class="chat-item"
            class:selected={selectedChatId === chat.id}
          >
            <div class="chat-icon">{chat.type === 'gm' ? 'G' : 'P'}</div>
            <div class="chat-info">
              <div class="chat-name">{chat.type === 'pm' ? (chat.otherUser?.username || 'Личный чат') : (chat.name || 'Групповой чат')}</div>
              <div class="chat-meta">
                {#if chat.lastMessage}
                  {#if chat.lastMessage.isSystem}
                    <span class="last-message-system">{chat.lastMessage.content}</span>
                  {:else}
                    <span class="last-message">{chat.lastMessage.senderUsername}: {chat.lastMessage.content}</span>
                  {/if}
                {:else}
                  {chat.memberCount} участников
                {/if}
              </div>
            </div>
          </a>
        {/each}
      {/if}
    </div>
  </aside>

  <main class="main">
    {#if selectedChatId}
      <ChatView params={{ id: selectedChatId }} />
    {:else}
      <div class="no-chat">
        <p>Выберите чат, чтобы начать общение</p>
      </div>
    {/if}
  </main>
</div>

{#if showCreateModal}
  <div class="modal-overlay" on:click={() => showCreateModal = false}>
    <div class="modal" on:click|stopPropagation>
      <h3>Создать чат</h3>
      <div class="field">
        <label for="chatType">Тип</label>
        <select id="chatType" bind:value={newChatType}>
          <option value="gm">Групповой</option>
          <option value="pm">Личный</option>
        </select>
      </div>
      {#if newChatType === 'gm'}
        <div class="field">
          <label for="chatName">Название</label>
          <input type="text" id="chatName" bind:value={newChatName} placeholder="Название группы" />
        </div>
      {/if}
      {#if newChatType === 'pm'}
        <div class="field">
          <label for="userSearch">Выберите пользователя</label>
          <input 
            type="text" 
            id="userSearch" 
            bind:value={userSearch} 
            on:input={searchUsers}
            placeholder="Поиск пользователей..."
          />
        </div>
        {#if searching}
          <p>Поиск...</p>
        {:else if searchResults.length > 0}
          <div class="search-results">
            {#each searchResults as user}
              {@const hasExistingChat = $chats.some(c => c.type === 'pm' && c.members?.includes(user.id))}
              {@const isSelected = selectedUserId === user.id}
              <div 
                class="search-result"
                class:disabled={hasExistingChat}
                class:selected={isSelected}
                on:click={() => !hasExistingChat && (selectedUserId = user.id)}
              >
                {user.username}
                {hasExistingChat ? '(чат уже существует)' : isSelected ? '(выбрано)' : ''}
              </div>
            {/each}
          </div>
        {/if}
      {/if}
      <div class="modal-actions">
        <button on:click={() => { showCreateModal = false; userSearch = ''; selectedUserId = null; }}>Отмена</button>
        <button 
          class="primary" 
          on:click={handleCreateChat} 
          disabled={creatingChat || (newChatType === 'pm' && !selectedUserId)}
        >
          {creatingChat ? 'Создание...' : 'Создать'}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showSettingsModal}
  <div class="modal-overlay" on:click={() => showSettingsModal = false}>
    <div class="modal" on:click|stopPropagation>
      <h3>Настройки</h3>
      <div class="settings-list">
        <button class="settings-btn" on:click={() => { showUsernameModal = true; showSettingsModal = false; }}>Изменить имя пользователя</button>
        <button class="settings-btn" disabled>Изменить аватар</button>
        <button class="settings-btn" on:click={() => { showPasswordModal = true; showSettingsModal = false; }}>Изменить пароль</button>
        <button class="settings-btn" on:click={() => { showExportKeyModal = true; showSettingsModal = false; }}>Экспорт приватного ключа</button>
        <button class="settings-btn danger" disabled>Удалить аккаунт</button>
      </div>
      <div class="modal-actions">
        <button on:click={() => showSettingsModal = false}>Закрыть</button>
      </div>
    </div>
  </div>
{/if}

{#if showUsernameModal}
  <div class="modal-overlay" on:click={() => showUsernameModal = false}>
    <div class="modal" on:click|stopPropagation>
      <h3>Изменить имя пользователя</h3>
      <div class="field">
        <label for="newUsername">Новое имя</label>
        <input 
          type="text" 
          id="newUsername" 
          bind:value={newUsername} 
          placeholder="Введите новое имя..."
        />
      </div>
      <div class="modal-actions">
        <button on:click={() => { showUsernameModal = false; newUsername = ''; }}>Отмена</button>
        <button 
          class="primary" 
          on:click={handleUpdateUsername}
          disabled={updatingUsername || !newUsername.trim()}
        >
          {updatingUsername ? 'Сохранение...' : 'Сохранить'}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showExportKeyModal}
  <div class="modal-overlay" on:click={() => showExportKeyModal = false}>
    <div class="modal" on:click|stopPropagation>
      <h3>Экспорт приватного ключа</h3>
      <div class="warning-box">
        ⚠️ Сохраните этот ключ в надёжном месте. С его помощью можно получить доступ к вашему аккаунту с другого устройства.
      </div>
      <p class="modal-desc">Этот ключ может использоваться для входа в аккаунт на другом устройстве.</p>
      <label class="checkbox-label">
        <input type="checkbox" bind:checked={exportConfirmChecked} />
        <span>Я понимаю риски и хочу экспортировать ключ</span>
      </label>
      <div class="modal-actions">
        <button on:click={() => { showExportKeyModal = false; exportConfirmChecked = false; }}>Отмена</button>
        <button 
          class="primary" 
          on:click={handleExportPrivateKey}
          disabled={exportingKey || !exportConfirmChecked}
        >
          {exportingKey ? 'Экспорт...' : 'Скачать'}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showPasswordModal}
  <div class="modal-overlay" on:click={() => showPasswordModal = false}>
    <div class="modal" on:click|stopPropagation>
      <h3>Изменить пароль</h3>
      <div class="warning-box">
        ⚠️ Внимание: после смены пароля приватный ключ на других устройствах перестанет работать. Вам нужно будет загрузить новый зашифрованный ключ на других устройствах.
      </div>
      <div class="field">
        <label for="newPassword">Новый пароль</label>
        <input 
          type="password" 
          id="newPassword" 
          bind:value={newPassword} 
          placeholder="Введите новый пароль..."
        />
      </div>
      <div class="field">
        <label for="newPasswordConfirm">Подтвердите пароль</label>
        <input 
          type="password" 
          id="newPasswordConfirm" 
          bind:value={newPasswordConfirm} 
          placeholder="Повторите пароль..."
        />
      </div>
      {#if newPassword && newPasswordConfirm && newPassword !== newPasswordConfirm}
        <p class="error-text">Пароли не совпадают</p>
      {/if}
      <div class="modal-actions">
        <button on:click={() => { showPasswordModal = false; newPassword = ''; newPasswordConfirm = ''; }}>Отмена</button>
        <button 
          class="primary" 
          on:click={handleChangePassword}
          disabled={changingPassword || !newPassword || newPassword !== newPasswordConfirm}
        >
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

  .sidebar {
    width: 320px;
    border-right: 1px solid #e0e0e0;
    display: flex;
    flex-direction: column;
    background: #f8f9fa;
  }

  .sidebar header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid #e0e0e0;
    background: #fff;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .sidebar h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
  }

  .header-actions {
    display: flex;
    gap: 8px;
  }

  .icon-btn {
    width: 36px;
    height: 36px;
    border: none;
    border-radius: 8px;
    background: #f0f0f0;
    cursor: pointer;
    font-size: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
  }

  .icon-btn:hover {
    background: #e0e0e0;
  }

  .icon-btn.logout {
    color: #f44336;
  }

  .chat-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  .chat-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-radius: 10px;
    text-decoration: none;
    color: inherit;
    transition: background 0.2s;
    margin-bottom: 4px;
  }

  .chat-item:hover {
    background: #e8e8e8;
  }

  .chat-item.selected {
    background: #e3f2fd;
  }

  .chat-icon {
    width: 44px;
    height: 44px;
    background: #4CAF50;
    color: white;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 16px;
    flex-shrink: 0;
  }

  .chat-info {
    flex: 1;
    min-width: 0;
  }

  .chat-name {
    font-weight: 600;
    font-size: 15px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chat-meta {
    font-size: 13px;
    color: #888;
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 180px;
  }

  .last-message {
    font-size: 12px;
    color: #666;
  }

  .last-message-system {
    font-size: 12px;
    color: #999;
    font-style: italic;
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

  .loading, .empty {
    padding: 40px 20px;
    text-align: center;
    color: #888;
  }

  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal {
    background: white;
    padding: 28px;
    border-radius: 14px;
    width: 400px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.2);
  }

  .modal h3 {
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

  .field input, .field select {
    width: 100%;
    padding: 12px;
    border: 1px solid #ddd;
    border-radius: 8px;
    font-size: 15px;
  }

  .field input:focus, .field select:focus {
    outline: none;
    border-color: #4CAF50;
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

  .modal-actions button.primary {
    background: #4CAF50;
    color: white;
  }

  .modal-actions button.primary:hover {
    background: #45a049;
  }

  .modal-actions button:disabled {
    background: #ccc;
  }

  .search-results {
    max-height: 200px;
    overflow-y: auto;
    border: 1px solid #eee;
    border-radius: 8px;
    margin-top: 12px;
  }

  .search-result {
    padding: 12px 16px;
    cursor: pointer;
    border-bottom: 1px solid #f0f0f0;
    font-size: 15px;
  }

  .search-result:hover:not(.disabled) {
    background: #f9f9f9;
  }

  .search-result.disabled {
    color: #999;
    cursor: not-allowed;
  }

  .search-result.selected {
    background: #e3f2fd;
    font-weight: 600;
  }

  .settings-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
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

  .settings-btn.danger:hover:not(:disabled) {
    background: #ffebee;
  }

  .modal-desc {
    font-size: 14px;
    color: #666;
    margin-bottom: 16px;
    line-height: 1.4;
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

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    font-size: 14px;
    margin-bottom: 20px;
  }

  .checkbox-label input {
    width: 18px;
    height: 18px;
  }

  .error-text {
    color: #f44336;
    font-size: 14px;
    margin-top: -10px;
    margin-bottom: 10px;
  }
</style>