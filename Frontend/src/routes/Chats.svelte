<script lang="ts">
  import { onMount } from 'svelte';
  import { push } from 'svelte-spa-router';
  import { api } from '../lib/api';
  import { auth, chats as chatsStore, type Chat } from '../lib/stores';
  import * as crypto from '../lib/crypto';

  let chatList: Chat[] = [];
  let loading = true;
  let error = '';
  let showCreateModal = false;
  let newChatName = '';
  let newChatType: 'pm' | 'gm' = 'gm';
  let creatingChat = false;

  onMount(async () => {
    try {
      const chats = await api.chats.list();
      chatList = chats;
      
      for (const chat of chats) {
        const chatDetail = await api.chats.get(chat.id);
        const currentMember = chatDetail.members.find(m => m.id === $auth.user?.id);
        if (currentMember && $auth.privateKey) {
          try {
            const chatKey = await crypto.decryptChatKeyWithPrivateKey(currentMember.encryptedKey, $auth.privateKey);
            chatsStore.setChatKey(chat.id, chatKey);
          } catch (e) {
            console.error('Failed to decrypt chat key:', e);
          }
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load chats';
    } finally {
      loading = false;
    }
  });

  async function handleCreateChat() {
    if (creatingChat) return;
    creatingChat = true;
    error = '';

    try {
      const chatKey = await crypto.generateChatKey();
      const exportedChatKey = await crypto.exportChatKey(chatKey);
      
      const publicKey = await crypto.importPublicKey($auth.user!.publicKey);
      const encryptedKey = await crypto.encryptChatKeyWithPublicKey(chatKey, publicKey);

      const result = await api.chats.create({
        type: newChatType,
        name: newChatType === 'gm' ? newChatName : undefined,
        encryptedKey
      });

      const chatDetail = await api.chats.get(result.id);
      const currentMember = chatDetail.members.find(m => m.id === $auth.user?.id);
      if (currentMember && $auth.privateKey) {
        const decryptedKey = await crypto.decryptChatKeyWithPrivateKey(currentMember.encryptedKey, $auth.privateKey);
        chatsStore.setChatKey(result.id, decryptedKey);
      }

      chatList = [...chatList, { id: result.id, type: newChatType, name: newChatName || null, memberCount: 1 }];
      showCreateModal = false;
      newChatName = '';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to create chat';
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

<div class="container">
  <header>
    <h1>Chats</h1>
    <button class="logout" on:click={handleLogout}>Logout</button>
  </header>

  {#if loading}
    <p class="loading">Loading...</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else}
    <div class="chat-list">
      {#each chatList as chat}
        <a href="#/chat/{chat.id}" class="chat-item">
          <div class="chat-icon">{chat.type === 'gm' ? 'G' : 'P'}</div>
          <div class="chat-info">
            <div class="chat-name">{chat.name || 'Personal Chat'}</div>
            <div class="chat-meta">{chat.memberCount} members</div>
          </div>
        </a>
      {/each}
    </div>

    <button class="create-btn" on:click={() => showCreateModal = true}>
      + New Chat
    </button>
  {/if}
</div>

{#if showCreateModal}
  <div class="modal-overlay" on:click={() => showCreateModal = false}>
    <div class="modal" on:click|stopPropagation>
      <h2>Create Chat</h2>
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
          <input type="text" id="chatName" bind:value={newChatName} />
        </div>
      {/if}
      {#if error}
        <p class="error">{error}</p>
      {/if}
      <div class="modal-actions">
        <button on:click={() => showCreateModal = false}>Cancel</button>
        <button class="primary" on:click={handleCreateChat} disabled={creatingChat}>
          {creatingChat ? 'Creating...' : 'Create'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .container {
    max-width: 600px;
    margin: 0 auto;
    padding: 20px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }
  h1 {
    margin: 0;
  }
  .logout {
    padding: 8px 16px;
    background: #f44336;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }
  .loading, .error {
    text-align: center;
    padding: 20px;
  }
  .error {
    color: red;
  }
  .chat-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .chat-item {
    display: flex;
    align-items: center;
    gap: 15px;
    padding: 15px;
    background: #f5f5f5;
    border-radius: 8px;
    text-decoration: none;
    color: inherit;
  }
  .chat-item:hover {
    background: #e8e8e8;
  }
  .chat-icon {
    width: 40px;
    height: 40px;
    background: #4CAF50;
    color: white;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
  }
  .chat-info {
    flex: 1;
  }
  .chat-name {
    font-weight: bold;
  }
  .chat-meta {
    color: #666;
    font-size: 12px;
  }
  .create-btn {
    width: 100%;
    padding: 15px;
    margin-top: 20px;
    background: #4CAF50;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 16px;
    cursor: pointer;
  }
  .create-btn:hover {
    background: #45a049;
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
  }
  .modal {
    background: white;
    padding: 30px;
    border-radius: 8px;
    width: 400px;
    max-width: 90%;
  }
  .modal h2 {
    margin-top: 0;
  }
  .field {
    margin-bottom: 15px;
  }
  .field label {
    display: block;
    margin-bottom: 5px;
    font-weight: bold;
  }
  .field input, .field select {
    width: 100%;
    padding: 10px;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 14px;
  }
  .modal-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    margin-top: 20px;
  }
  .modal-actions button {
    padding: 10px 20px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }
  .modal-actions button.primary {
    background: #4CAF50;
    color: white;
  }
  .modal-actions button:disabled {
    background: #ccc;
  }
</style>