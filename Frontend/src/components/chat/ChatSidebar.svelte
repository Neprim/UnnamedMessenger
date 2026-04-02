<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Chat } from '../../lib/types';
  import Avatar from '../common/Avatar.svelte';

  export let chats: Chat[] = [];
  export let loading = false;
  export let selectedChatId: string | null = null;

  const dispatch = createEventDispatcher<{
    create: void;
    settings: void;
  }>();
</script>

<aside class="sidebar">
  <header>
    <div class="header-left">
      <button class="icon-btn" type="button" on:click={() => dispatch('settings')} title="Настройки">⚙</button>
      <h2>Чаты</h2>
    </div>
    <div class="header-actions">
      <button class="icon-btn" type="button" on:click={() => dispatch('create')} title="Новый чат">+</button>
    </div>
  </header>

  <div class="chat-list">
    {#if loading}
      <div class="loading">Загрузка...</div>
    {:else if chats.length === 0}
      <div class="empty">Пока нет чатов</div>
    {:else}
      {#each chats as chat}
        <a href="#/chats/{chat.id}" class="chat-item" class:selected={selectedChatId === chat.id}>
          {#if chat.type === 'pm'}
            {#key `${chat.id}:${chat.otherUser?.avatarUrl ?? ''}`}
              <Avatar name={chat.otherUser?.username || 'Личный чат'} src={chat.otherUser?.avatarUrl} size={44} />
            {/key}
          {:else}
            {#key `${chat.id}:${chat.avatarUrl ?? ''}`}
              <Avatar name={chat.name || 'Групповой чат'} src={chat.avatarUrl} size={44} />
            {/key}
          {/if}

          <div class="chat-info">
            <div class="chat-name">
              {chat.type === 'pm' ? (chat.otherUser?.username || 'Личный чат') : (chat.name || 'Групповой чат')}
              {#if chat.unreadCount && chat.unreadCount > 0}
                <span class="unread-badge">{chat.unreadCount}</span>
              {/if}
            </div>

            <div class="chat-meta">
              {#if chat.lastMessage}
                {#if chat.lastMessage.isSystem}
                  <span class="last-message-system">{chat.lastMessage.content}</span>
                {:else}
                  <span class="last-message">{chat.lastMessage.senderUsername ? `${chat.lastMessage.senderUsername}: ` : ''}{chat.lastMessage.content}</span>
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

<style>
  .sidebar {
    width: 320px;
    border-right: 1px solid #e0e0e0;
    display: flex;
    flex-direction: column;
    background: #f8f9fa;
  }

  header {
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

  h2 {
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
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .unread-badge {
    background: #f44336;
    color: white;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 10px;
    min-width: 18px;
    text-align: center;
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

  .loading,
  .empty {
    padding: 40px 20px;
    text-align: center;
    color: #888;
  }
</style>
