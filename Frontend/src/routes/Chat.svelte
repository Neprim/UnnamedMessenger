<script lang="ts">
  import { onMount } from 'svelte';
  import { pop } from 'svelte-spa-router';
  import * as crypto from '../lib/crypto';
  import { api, type Message } from '../lib/api';
  import { auth } from '../lib/stores';

  export let params: { id: string };

  let chatDetail: any = null;
  let messages: Message[] = [];
  let loading = true;
  let error = '';
  let newMessage = '';
  let sending = false;
  let chatKey: CryptoKey | null = null;
  let showAddMemberModal = false;
  let userSearch = '';
  let searchResults: { id: string; username: string }[] = [];
  let searching = false;
  let addingMember = false;

  onMount(async () => {
    const checkAuth = setInterval(() => {
      if (!$auth.isLoading && $auth.privateKey) {
        clearInterval(checkAuth);
        loadChat();
      }
    }, 50);

    setTimeout(() => {
      clearInterval(checkAuth);
      if ($auth.isLoading) {
        loadChat();
      }
    }, 5000);

    async function loadChat() {
      try {
        chatDetail = await api.chats.get(params.id);
        
        const currentMember = chatDetail.members.find((m: any) => m.id === $auth.user?.id);
        if (currentMember && $auth.privateKey) {
          chatKey = await crypto.decryptChatKeyWithPrivateKey(currentMember.encryptedKey, $auth.privateKey);
        }

        const result = await api.chats.getMessages(params.id);
        
        if (chatKey) {
          const decryptedMessages = await Promise.all(
            result.messages.map(async (msg) => {
              try {
                return {
                  ...msg,
                  content: await crypto.decryptMessage(chatKey!, msg.content)
                };
              } catch {
                return { ...msg, content: '[Decryption failed]' };
              }
            })
          );
          messages = decryptedMessages;
        } else {
          messages = result.messages;
        }

        setTimeout(() => {
          const container = document.querySelector('.messages');
          if (container) container.scrollTop = container.scrollHeight;
        }, 100);
      } catch (e) {
        error = e instanceof Error ? e.message : 'Failed to load chat';
      } finally {
        loading = false;
      }
    }
  });

  async function handleSendMessage() {
    if (!newMessage.trim() || !chatKey || sending) return;
    sending = true;

    try {
      const encryptedContent = await crypto.encryptMessage(chatKey, newMessage);
      const message = await api.chats.sendMessage(params.id, encryptedContent);
      messages = [...messages, { ...message, content: newMessage }];
      newMessage = '';
      setTimeout(() => {
        const container = document.querySelector('.messages');
        if (container) container.scrollTop = container.scrollHeight;
      }, 50);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to send message';
    } finally {
      sending = false;
    }
  }

  async function handleDeleteMessage(messageId: string) {
    try {
      await api.messages.delete(messageId);
      messages = messages.filter(m => m.id !== messageId);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to delete message';
    }
  }

  async function searchUsers() {
    if (!userSearch.trim()) {
      searchResults = [];
      return;
    }
    searching = true;
    try {
      searchResults = await api.users.search(userSearch);
    } catch (e) {
      searchResults = [];
    } finally {
      searching = false;
    }
  }

  async function addMember(userId: string) {
    if (!chatKey) return;
    addingMember = true;
    try {
      const userData = searchResults.find(u => u.id === userId);
      if (!userData) return;

      const publicKey = await crypto.importPublicKey(userData.publicKey);
      const encryptedKey = await crypto.encryptChatKeyWithPublicKey(chatKey, publicKey);
      
      await api.chats.addMember(params.id, userId, encryptedKey);
      
      chatDetail = await api.chats.get(params.id);
      showAddMemberModal = false;
      userSearch = '';
      searchResults = [];
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to add member';
    } finally {
      addingMember = false;
    }
  }
</script>

<div class="container">
  <header>
    <button class="back" on:click={() => pop()}>&larr;</button>
    <h1>{chatDetail?.name || 'Chat'}</h1>
    {#if chatKey}
      <button class="add-member" on:click={() => showAddMemberModal = true}>+ Add</button>
    {/if}
  </header>

  {#if loading}
    <p class="loading">Loading...</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else}
    <div class="messages">
      {#each messages as message}
        <div class="message" class:own={message.senderId === $auth.user?.id}>
          <div class="message-content">
            {message.content}
          </div>
          <div class="message-meta">
            {new Date(message.timestamp).toLocaleTimeString()}
            {#if message.editedAt}
              (edited)
            {/if}
          </div>
          {#if message.senderId === $auth.user?.id}
            <button class="delete" on:click={() => handleDeleteMessage(message.id)}>Delete</button>
          {/if}
        </div>
      {/each}
    </div>

    <form class="input-area" on:submit|preventDefault={handleSendMessage}>
      <input 
        type="text" 
        bind:value={newMessage} 
        placeholder="Type a message..." 
        disabled={sending || !chatKey}
      />
      <button type="submit" disabled={sending || !newMessage.trim() || !chatKey}>
        {sending ? 'Sending...' : 'Send'}
      </button>
    </form>
  {/if}
</div>

<style>
  .container {
    max-width: 900px;
    margin: 0 auto;
    padding: 30px;
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: white;
  }
  header {
    display: flex;
    align-items: center;
    gap: 20px;
    margin-bottom: 25px;
    padding-bottom: 20px;
    border-bottom: 1px solid #eee;
  }
  .back {
    padding: 10px 18px;
    background: #f5f5f5;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
  }
  .back:hover {
    background: #e8e8e8;
  }
  h1 {
    margin: 0;
    flex: 1;
    font-size: 22px;
  }
  .loading, .error {
    text-align: center;
    padding: 40px;
    color: #666;
  }
  .error {
    color: #f44336;
  }
  .messages {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px 0;
  }
  .message {
    max-width: 60%;
    padding: 14px 18px;
    background: #f5f5f5;
    border-radius: 16px;
    align-self: flex-start;
  }
  .message.own {
    align-self: flex-end;
    background: #e3f2fd;
  }
  .message-content {
    word-wrap: break-word;
    font-size: 15px;
  }
  .message-meta {
    font-size: 12px;
    color: #888;
    margin-top: 6px;
  }
  .delete {
    font-size: 12px;
    color: #f44336;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    margin-top: 6px;
  }
  .input-area {
    display: flex;
    gap: 15px;
    padding-top: 20px;
    border-top: 1px solid #eee;
  }
  .input-area input {
    flex: 1;
    padding: 14px 18px;
    border: 1px solid #ddd;
    border-radius: 24px;
    font-size: 15px;
  }
  .input-area input:focus {
    outline: none;
    border-color: #4CAF50;
  }
  .input-area button {
    padding: 14px 28px;
    background: #4CAF50;
    color: white;
    border: none;
    border-radius: 24px;
    cursor: pointer;
    font-size: 15px;
    font-weight: 500;
  }
  .input-area button:hover:not(:disabled) {
    background: #45a049;
  }
  .input-area button:disabled {
    background: #ccc;
  }
  .field {
    margin-bottom: 20px;
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
    border-radius: 6px;
    font-size: 15px;
    box-sizing: border-box;
  }
  .field input:focus {
    outline: none;
    border-color: #2196F3;
  }
  .add-member {
    padding: 10px 20px;
    background: #2196F3;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
  }
  .add-member:hover {
    background: #1976D2;
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
    padding: 30px;
    border-radius: 12px;
    width: 450px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.2);
  }
  .modal h2 {
    margin: 0 0 25px;
    font-size: 22px;
  }
  .search-results {
    max-height: 250px;
    overflow-y: auto;
    margin-top: 15px;
    border: 1px solid #eee;
    border-radius: 8px;
  }
  .search-result {
    padding: 14px 16px;
    cursor: pointer;
    border-bottom: 1px solid #f0f0f0;
    font-size: 15px;
  }
  .search-result:hover {
    background: #f9f9f9;
  }
  .modal-actions {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    margin-top: 25px;
  }
  .modal-actions button {
    padding: 12px 24px;
    border: none;
    border-radius: 6px;
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
</style>

{#if showAddMemberModal}
  <div class="modal-overlay" on:click={() => showAddMemberModal = false}>
    <div class="modal" on:click|stopPropagation>
      <h2>Add Member</h2>
      <div class="field">
        <label for="userSearch">Search users</label>
        <input 
          type="text" 
          id="userSearch" 
          bind:value={userSearch} 
          on:input={searchUsers}
          placeholder="Enter username..."
        />
      </div>
      {#if searching}
        <p>Searching...</p>
      {:else if searchResults.length > 0}
        <div class="search-results">
          {#each searchResults as user}
            <div 
              class="search-result" 
              on:click={() => addMember(user.id)}
            >
              {user.username}
            </div>
          {/each}
        </div>
      {/if}
      <div class="modal-actions">
        <button on:click={() => showAddMemberModal = false}>Cancel</button>
      </div>
    </div>
  </div>
{/if}