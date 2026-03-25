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
          messages = decryptedMessages.reverse();
        } else {
          messages = result.messages.reverse();
        }
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
    max-width: 600px;
    margin: 0 auto;
    padding: 20px;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    align-items: center;
    gap: 15px;
    margin-bottom: 20px;
  }
  .back {
    padding: 8px 16px;
    background: #f5f5f5;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }
  h1 {
    margin: 0;
  }
  .loading, .error {
    text-align: center;
    padding: 20px;
  }
  .error {
    color: red;
  }
  .messages {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 15px;
    padding-bottom: 20px;
  }
  .message {
    max-width: 70%;
    padding: 10px 15px;
    background: #f5f5f5;
    border-radius: 8px;
    align-self: flex-start;
  }
  .message.own {
    align-self: flex-end;
    background: #e3f2fd;
  }
  .message-content {
    word-wrap: break-word;
  }
  .message-meta {
    font-size: 11px;
    color: #666;
    margin-top: 5px;
  }
  .delete {
    font-size: 11px;
    color: #f44336;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    margin-top: 5px;
  }
  .input-area {
    display: flex;
    gap: 10px;
    padding-top: 15px;
    border-top: 1px solid #eee;
  }
  .input-area input {
    flex: 1;
    padding: 12px;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 14px;
  }
  .input-area button {
    padding: 12px 24px;
    background: #4CAF50;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }
  .input-area button:disabled {
    background: #ccc;
  }
  .field {
    margin-bottom: 15px;
  }
  .field label {
    display: block;
    margin-bottom: 5px;
    font-weight: bold;
  }
  .field input {
    width: 100%;
    padding: 10px;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 14px;
    box-sizing: border-box;
  }
  .add-member {
    padding: 8px 16px;
    background: #2196F3;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
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
    border-radius: 8px;
    width: 400px;
    max-width: 90%;
  }
  .modal h2 {
    margin-top: 0;
  }
  .search-results {
    max-height: 200px;
    overflow-y: auto;
    margin-top: 10px;
    border: 1px solid #ccc;
    border-radius: 4px;
  }
  .search-result {
    padding: 10px;
    cursor: pointer;
    border-bottom: 1px solid #eee;
  }
  .search-result:hover {
    background: #f5f5f5;
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