<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Chat } from '../../lib/types';
  import Avatar from '../common/Avatar.svelte';

  export let chats: Chat[] = [];
  export let loading = false;
  export let selectedChatId: string | null = null;
  export let pinnedChatIds: string[] = [];

  const dispatch = createEventDispatcher<{
    create: void;
    settings: void;
    togglepin: { chatId: string };
  }>();

  let contextMenu:
    | {
        x: number;
        y: number;
        chatId: string;
        visible: boolean;
      }
    | null = null;

  function openContextMenu(event: MouseEvent, chatId: string) {
    event.preventDefault();
    contextMenu = {
      x: event.clientX,
      y: event.clientY,
      chatId,
      visible: true
    };

    requestAnimationFrame(() => {
      const menuElement = document.querySelector('.sidebar-context-menu') as HTMLElement | null;
      if (!menuElement || !contextMenu) {
        return;
      }

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
    contextMenu = null;
  }

  function togglePinnedFromContextMenu() {
    if (!contextMenu?.chatId) {
      return;
    }

    dispatch('togglepin', { chatId: contextMenu.chatId });
    closeContextMenu();
  }
</script>

<svelte:window on:click={closeContextMenu} on:keydown={(event) => event.key === 'Escape' && closeContextMenu()} />

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
        {@const chatTitle = chat.type === 'pm' ? (chat.otherUser?.username || 'Личный чат') : (chat.name || 'Групповой чат')}
        {@const isPinned = pinnedChatIds.includes(chat.id)}

        <div class="chat-item-wrap" class:selected={selectedChatId === chat.id}>
          <a href="#/chats/{chat.id}" class="chat-item" on:contextmenu={(event) => openContextMenu(event, chat.id)}>
            {#if chat.type === 'pm'}
              {#key `${chat.id}:${chat.otherUser?.avatarUrl ?? ''}`}
                <Avatar name={chatTitle} src={chat.otherUser?.avatarUrl} size={44} />
              {/key}
            {:else}
              {#key `${chat.id}:${chat.avatarUrl ?? ''}`}
                <Avatar name={chatTitle} src={chat.avatarUrl} size={44} />
              {/key}
            {/if}

            <div class="chat-info">
              <div class="chat-name">
                <span class="chat-name-text" title={chatTitle}>{chatTitle}</span>
                {#if isPinned}
                  <span class="pin-indicator" aria-label="Чат закреплён" title="Чат закреплён">📌</span>
                {/if}
                {#if chat.unreadCount && chat.unreadCount > 0}
                  <span class="unread-badge">{chat.unreadCount}</span>
                {/if}
              </div>

              <div class="chat-meta">
                {#if chat.lastMessage}
                  {#if chat.lastMessage.isSystem}
                    <span class="last-message-system">{chat.lastMessage.content}</span>
                  {:else if !chat.lastMessage.content.trim() && chat.lastMessage.hasAttachments}
                    <span class="last-message">
                      {#if chat.lastMessage.senderUsername}
                        {chat.lastMessage.senderUsername}:
                      {/if}
                      <em class="attachment-marker" title={chat.lastMessage.attachmentNames?.join(', ') || 'Вложения'}>
                        {chat.lastMessage.attachmentNames?.length ? chat.lastMessage.attachmentNames.join(', ') : '<вложение>'}
                      </em>
                    </span>
                  {:else if chat.lastMessage.hasAttachments && chat.lastMessage.attachmentNames?.length && chat.lastMessage.content === chat.lastMessage.attachmentNames.join(', ')}
                    <span class="last-message">
                      {#if chat.lastMessage.senderUsername}
                        {chat.lastMessage.senderUsername}:
                      {/if}
                      <em class="attachment-marker" title={chat.lastMessage.content}>{chat.lastMessage.content}</em>
                    </span>
                  {:else}
                    <span class="last-message">
                      {chat.lastMessage.senderUsername ? `${chat.lastMessage.senderUsername}: ` : ''}{chat.lastMessage.content}
                    </span>
                  {/if}
                {:else}
                  {chat.memberCount} участников
                {/if}
              </div>
            </div>
          </a>
        </div>
      {/each}
    {/if}
  </div>

  {#if contextMenu?.visible}
    <div
      class="sidebar-context-menu"
      style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
      role="menu"
      tabindex="-1"
      aria-label="Действия с чатом"
      on:mousedown|stopPropagation
    >
      <button class="context-menu-item" type="button" role="menuitem" on:click={togglePinnedFromContextMenu}>
        {pinnedChatIds.includes(contextMenu.chatId) ? 'Открепить чат' : 'Закрепить чат'}
      </button>
    </div>
  {/if}
</aside>

<style>
  .sidebar {
    width: 320px;
    min-width: 320px;
    border-right: 1px solid #e0e0e0;
    display: flex;
    flex-direction: column;
    background: #f8f9fa;
    min-height: 0;
    position: relative;
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
    min-height: 0;
  }

  .chat-item-wrap {
    position: relative;
    margin-bottom: 4px;
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
  }

  .chat-item-wrap:hover .chat-item {
    background: #e8e8e8;
  }

  .chat-item-wrap.selected .chat-item {
    background: #e3f2fd;
  }

  .chat-info {
    flex: 1;
    min-width: 0;
  }

  .chat-name {
    font-weight: 600;
    font-size: 15px;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .chat-name-text {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pin-indicator {
    flex-shrink: 0;
    color: #f59e0b;
    font-size: 12px;
    line-height: 1;
  }

  .unread-badge {
    flex-shrink: 0;
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

  .attachment-marker {
    font-style: italic;
  }

  .last-message-system {
    font-size: 12px;
    color: #999;
    font-style: italic;
  }

  .sidebar-context-menu {
    position: fixed;
    z-index: 40;
    min-width: 176px;
    background: #fff;
    border: 1px solid #d7dce5;
    border-radius: 12px;
    box-shadow: 0 18px 40px rgba(15, 23, 42, 0.18);
    padding: 6px;
  }

  .context-menu-item {
    width: 100%;
    border: none;
    background: transparent;
    text-align: left;
    padding: 10px 12px;
    border-radius: 8px;
    font-size: 14px;
    cursor: pointer;
  }

  .context-menu-item:hover {
    background: #f3f6fb;
  }

  .loading,
  .empty {
    padding: 40px 20px;
    text-align: center;
    color: #888;
  }

  @media (max-width: 768px) {
    .sidebar {
      width: 100%;
      min-width: 0;
      border-right: none;
    }

    header {
      padding: 14px 16px;
    }

    h2 {
      font-size: 18px;
    }

    .chat-list {
      padding: 6px;
    }

    .chat-item {
      padding: 10px 12px;
      gap: 10px;
    }

    .chat-name {
      font-size: 14px;
    }

    .chat-meta {
      max-width: none;
      font-size: 12px;
    }
  }
</style>
