<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { push } from 'svelte-spa-router';
  import { api } from '../lib/api';
  import { auth, chats, type Chat } from '../lib/stores';
  import { memberEvents, chatDeletedEvents } from '../lib/sse';
  import * as crypto from '../lib/crypto';
  import ChatView from './ChatView.svelte';

  let chatList: Chat[] = [];
  let loading = true;
  let showCreateModal = false;
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

  const unsubscribeChats = chats.subscribe(data => {
    chatList = data;
  });

  onDestroy(() => {
    unsubscribeChats();
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
    return chatList.some(c => c.type === 'pm' && c.members?.includes(userId));
  }

  let unsubscribeMemberEvents: () => void;
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

    unsubscribeMemberEvents = memberEvents.subscribe(events => {
      for (const event of events) {
        handleMemberEvent(event);
      }
      if (events.length > 0) {
        memberEvents.set([]);
      }
    });

    const unsubscribeChatDeleted = chatDeletedEvents.subscribe(chatIds => {
      for (const chatId of chatIds) {
        const exists = chatList.find(c => c.id === chatId);
        if (exists) {
          chatList = chatList.filter(c => c.id !== chatId);
          chats.removeChat(chatId);
          if (selectedChatId === chatId) {
            push('/chats');
          }
        }
      }
      if (chatIds.length > 0) {
        chatDeletedEvents.set([]);
      }
    });
  });

  onDestroy(() => {
    if (unsubscribeMemberEvents) unsubscribeMemberEvents();
    if (unsubscribeChatDeleted) unsubscribeChatDeleted();
    unsubscribeChats();
  });

  async function handleMemberEvent(event: { type: string; chatId: string; userId: string; memberCount: number; removed?: boolean }) {
    if (event.type === 'member_added') {
      const exists = chatList.find(c => c.id === event.chatId);
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
            console.error('Failed to decrypt chat key:', e);
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
            console.error('Failed to load last messages:', e);
          }
        }
        
        chatList = [...chatList, { 
          id: chatDetail.id, 
          type: chatDetail.type, 
          name: chatDetail.name, 
          memberCount: event.memberCount,
          members: chatDetail.members.map((m: any) => m.id),
          otherUser,
          lastMessage
        }];
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
        chatList = chatList.map(c => c.id === event.chatId ? { ...c, memberCount: event.memberCount } : c);
        chats.updateChat(event.chatId, { memberCount: event.memberCount });
      }
    } else if (event.type === 'member_removed' || event.type === 'member_left') {
      const removedUser = event.username || 'Пользователь';
      const systemContent = event.type === 'member_removed' ? `${removedUser} удалён из чата` : `${removedUser} покинул чат`;
      
      if ($auth.user?.id === event.userId || event.removed) {
        chatList = chatList.filter(c => c.id !== event.chatId);
        chats.removeChat(event.chatId);
        if (selectedChatId === event.chatId) {
          push('/chats');
        }
      } else {
        chatList = chatList.map(c => c.id === event.chatId ? { 
          ...c, 
          memberCount: event.memberCount,
          lastMessage: {
            senderId: null,
            content: systemContent,
            isSystem: true
          }
        } : c);
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
            console.error('Failed to decrypt chat key:', e);
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
            console.error('Failed to load last messages:', e);
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
      
      chatList = loadedChats;
      chats.set(loadedChats);
    } catch (e) {
      console.error('Failed to load chats:', e);
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

      chatList = [...chatList, { 
        id: result.id, 
        type: newChatType, 
        name: newChatName || null, 
        memberCount: newChatType === 'pm' ? 2 : 1,
        members: [$auth.user?.id!, ...members],
        otherUser: newChatType === 'pm' ? { id: selectedUserId!, username: searchResults.find(u => u.id === selectedUserId)?.username || 'User' } : null,
        lastMessage: null
      }];
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
      console.error('Failed to create chat:', e);
    } finally {
      creatingChat = false;
    }
  }

  async function handleLogout() {
    await api.auth.logout();
    auth.logout();
    push('/login');
  }
</script>

<div class="layout">
  <aside class="sidebar">
    <header>
      <h2>Chats</h2>
      <div class="header-actions">
        <button class="icon-btn" on:click={() => showCreateModal = true} title="New Chat">+</button>
        <button class="icon-btn logout" on:click={handleLogout} title="Logout">↪</button>
      </div>
    </header>

    <div class="chat-list">
      {#if loading}
        <div class="loading">Loading...</div>
      {:else if chatList.length === 0}
        <div class="empty">No chats yet</div>
      {:else}
        {#each chatList as chat}
          <a 
            href="#/chats/{chat.id}" 
            class="chat-item"
            class:selected={selectedChatId === chat.id}
          >
            <div class="chat-icon">{chat.type === 'gm' ? 'G' : 'P'}</div>
            <div class="chat-info">
              <div class="chat-name">{chat.type === 'pm' ? (chat.otherUser?.username || 'Personal Chat') : (chat.name || 'Group Chat')}</div>
              <div class="chat-meta">
                {#if chat.lastMessage}
                  {#if chat.lastMessage.isSystem}
                    <span class="last-message-system">{chat.lastMessage.content}</span>
                  {:else}
                    <span class="last-message">{chat.lastMessage.senderUsername}: {chat.lastMessage.content}</span>
                  {/if}
                {:else}
                  {chat.memberCount} members
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
        <p>Select a chat to start messaging</p>
      </div>
    {/if}
  </main>
</div>

{#if showCreateModal}
  <div class="modal-overlay" on:click={() => showCreateModal = false}>
    <div class="modal" on:click|stopPropagation>
      <h3>Create Chat</h3>
      <div class="field">
        <label for="chatType">Type</label>
        <select id="chatType" bind:value={newChatType}>
          <option value="gm">Group</option>
          <option value="pm">Personal</option>
        </select>
      </div>
      {#if newChatType === 'gm'}
        <div class="field">
          <label for="chatName">Name</label>
          <input type="text" id="chatName" bind:value={newChatName} placeholder="Group name" />
        </div>
      {/if}
      {#if newChatType === 'pm'}
        <div class="field">
          <label for="userSearch">Select User</label>
          <input 
            type="text" 
            id="userSearch" 
            bind:value={userSearch} 
            on:input={searchUsers}
            placeholder="Search users..."
          />
        </div>
        {#if searching}
          <p>Searching...</p>
        {:else if searchResults.length > 0}
          <div class="search-results">
            {#each searchResults as user}
              {@const hasExistingChat = chatList.some(c => c.type === 'pm' && c.members?.includes(user.id))}
              {@const isSelected = selectedUserId === user.id}
              <div 
                class="search-result"
                class:disabled={hasExistingChat}
                class:selected={isSelected}
                on:click={() => !hasExistingChat && (selectedUserId = user.id)}
              >
                {user.username}
                {hasExistingChat ? '(already chat exists)' : isSelected ? '(selected)' : ''}
              </div>
            {/each}
          </div>
        {/if}
      {/if}
      <div class="modal-actions">
        <button on:click={() => { showCreateModal = false; userSearch = ''; selectedUserId = null; }}>Cancel</button>
        <button 
          class="primary" 
          on:click={handleCreateChat} 
          disabled={creatingChat || (newChatType === 'pm' && !selectedUserId)}
        >
          {creatingChat ? 'Creating...' : 'Create'}
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
</style>