<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { isPersonalChatWithUser } from '../../lib/chat-helpers';
  import type { Chat, ChatType, SearchUserResult } from '../../lib/types';

  export let chatType: ChatType = 'gm';
  export let chatName = '';
  export let userSearch = '';
  export let searchResults: SearchUserResult[] = [];
  export let searching = false;
  export let selectedUserId: string | null = null;
  export let creating = false;
  export let chats: Chat[] = [];

  const dispatch = createEventDispatcher<{
    close: void;
    create: void;
    search: void;
    selectUser: { userId: string };
  }>();

  function handleClose() {
    dispatch('close');
  }
</script>

<div class="modal-shell">
  <button class="modal-overlay" type="button" on:click={handleClose} aria-label="Закрыть окно"></button>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="create-chat-title">
    <h3 id="create-chat-title">Создать чат</h3>

    <div class="field">
      <label for="chatType">Тип</label>
      <select id="chatType" bind:value={chatType}>
        <option value="gm">Групповой</option>
        <option value="pm">Личный</option>
      </select>
    </div>

    {#if chatType === 'gm'}
      <div class="field">
        <label for="chatName">Название</label>
        <input id="chatName" type="text" bind:value={chatName} maxlength="30" placeholder="Название группы" />
      </div>
    {/if}

    {#if chatType === 'pm'}
      <div class="field">
        <label for="userSearch">Выберите пользователя</label>
        <input
          id="userSearch"
          type="text"
          bind:value={userSearch}
          placeholder="Поиск пользователей..."
          on:input={() => dispatch('search')}
        />
      </div>

      {#if searching}
        <p>Поиск...</p>
      {:else if searchResults.length > 0}
        <div class="search-results">
          {#each searchResults as user}
            {@const hasExistingChat = chats.some((chat) => isPersonalChatWithUser(chat, user.id))}
            {@const isSelected = selectedUserId === user.id}
            <button
              type="button"
              class="search-result"
              class:selected={isSelected}
              disabled={hasExistingChat}
              on:click={() => dispatch('selectUser', { userId: user.id })}
            >
              {user.username}
              {#if hasExistingChat}
                (чат уже существует)
              {:else if isSelected}
                (выбрано)
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    {/if}

    <div class="modal-actions">
      <button type="button" on:click={handleClose}>Отмена</button>
      <button
        type="button"
        class="primary"
        disabled={creating || (chatType === 'pm' ? !selectedUserId : !chatName.trim())}
        on:click={() => dispatch('create')}
      >
        {creating ? 'Создание...' : 'Создать'}
      </button>
    </div>
  </div>
</div>

<style>
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

  label {
    display: block;
    margin-bottom: 8px;
    font-weight: 600;
    font-size: 14px;
  }

  input,
  select {
    width: 100%;
    padding: 12px;
    border: 1px solid #ddd;
    border-radius: 8px;
    font-size: 15px;
    box-sizing: border-box;
  }

  input:focus,
  select:focus {
    outline: none;
    border-color: #4caf50;
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

  .search-result.selected {
    background: #e3f2fd;
    font-weight: 600;
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

  .modal-actions .primary {
    background: #4caf50;
    color: white;
  }

  .modal-actions button:disabled {
    background: #ccc;
    cursor: not-allowed;
  }
</style>
