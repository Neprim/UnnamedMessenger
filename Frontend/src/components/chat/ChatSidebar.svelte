<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Chat, SearchUserResult } from '../../lib/types';
  import Avatar from '../common/Avatar.svelte';

  export let chats: Chat[] = [];
  export let loading = false;
  export let selectedChatId: string | null = null;
  export let pinnedChatIds: string[] = [];
  export let mutedChatIds: string[] = [];
  export let searchQuery = '';
  export let searchedChats: Chat[] = [];
  export let searchedUsers: SearchUserResult[] = [];
  export let searchingUsers = false;
  export let blockedUserIds: string[] = [];

  const dispatch = createEventDispatcher<{
    create: void;
    settings: void;
    togglepin: { chatId: string };
    togglemute: { chatId: string };
    searchchange: { value: string };
    clearsearch: void;
    openuser: { user: SearchUserResult };
    toggleblockuser: { user: SearchUserResult };
  }>();

  let chatContextMenu:
    | {
        x: number;
        y: number;
        chatId: string;
        user: SearchUserResult | null;
      }
    | null = null;
  let userContextMenu:
    | {
        x: number;
        y: number;
        user: SearchUserResult;
      }
    | null = null;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;

  function getChatTitle(chat: Chat) {
    return chat.type === 'pm' ? chat.otherUser?.username || 'Личный чат' : chat.name || 'Групповой чат';
  }

  function buildPmUser(chat: Chat): SearchUserResult | null {
    if (chat.type !== 'pm' || !chat.otherUser) {
      return null;
    }

    return {
      id: chat.otherUser.id,
      username: chat.otherUser.username,
      publicKey: '',
      avatarUrl: chat.otherUser.avatarUrl
    };
  }

  function positionMenu(selector: string, type: 'chat' | 'user') {
    requestAnimationFrame(() => {
      const menuElement = document.querySelector(selector) as HTMLElement | null;

      if (type === 'chat') {
        const source = chatContextMenu;
        if (!menuElement || !source) {
          return;
        }
        const rect = menuElement.getBoundingClientRect();
        const nextX = rect.right > window.innerWidth ? window.innerWidth - rect.width - 10 : source.x;
        const nextY = rect.bottom > window.innerHeight ? window.innerHeight - rect.height - 10 : source.y;
        chatContextMenu = { ...source, x: nextX, y: nextY };
      } else {
        const source = userContextMenu;
        if (!menuElement || !source) {
          return;
        }
        const rect = menuElement.getBoundingClientRect();
        const nextX = rect.right > window.innerWidth ? window.innerWidth - rect.width - 10 : source.x;
        const nextY = rect.bottom > window.innerHeight ? window.innerHeight - rect.height - 10 : source.y;
        userContextMenu = { ...source, x: nextX, y: nextY };
      }
    });
  }

  function openChatContextMenu(event: MouseEvent, chat: Chat) {
    event.preventDefault();
    userContextMenu = null;
    chatContextMenu = {
      x: event.clientX,
      y: event.clientY,
      chatId: chat.id,
      user: buildPmUser(chat)
    };
    positionMenu('.sidebar-chat-context-menu', 'chat');
  }

  function openUserContextMenu(event: MouseEvent, user: SearchUserResult) {
    event.preventDefault();
    event.stopPropagation();
    chatContextMenu = null;
    userContextMenu = {
      x: event.clientX,
      y: event.clientY,
      user
    };
    positionMenu('.sidebar-user-context-menu', 'user');
  }

  function closeContextMenus() {
    chatContextMenu = null;
    userContextMenu = null;
  }

  function startChatLongPress(event: TouchEvent, chat: Chat) {
    clearChatLongPress();
    const touch = event.touches[0];
    if (!touch) {
      return;
    }

    longPressTimer = setTimeout(() => {
      userContextMenu = null;
      chatContextMenu = {
        x: touch.clientX,
        y: touch.clientY,
        chatId: chat.id,
        user: buildPmUser(chat)
      };
      positionMenu('.sidebar-chat-context-menu', 'chat');
      longPressTimer = null;
    }, 500);
  }

  function clearChatLongPress() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function togglePinnedFromContextMenu() {
    if (!chatContextMenu?.chatId) {
      return;
    }

    dispatch('togglepin', { chatId: chatContextMenu.chatId });
    closeContextMenus();
  }

  function toggleMutedFromContextMenu() {
    if (!chatContextMenu?.chatId) {
      return;
    }

    dispatch('togglemute', { chatId: chatContextMenu.chatId });
    closeContextMenus();
  }

  function toggleBlockForUser(user: SearchUserResult) {
    dispatch('toggleblockuser', { user });
    closeContextMenus();
  }
</script>

<svelte:window on:click={closeContextMenus} on:keydown={(event) => event.key === 'Escape' && closeContextMenus()} />

<aside class="sidebar">
  <header>
    <div class="header-left">
      <button class="icon-btn" type="button" on:click={() => dispatch('settings')} title="Настройки">⚙</button>
      <input
        class="search-input"
        type="text"
        placeholder="Поиск"
        value={searchQuery}
        on:input={(event) => dispatch('searchchange', { value: (event.currentTarget as HTMLInputElement).value })}
      />
    </div>

    <div class="header-actions">
      {#if searchQuery.trim()}
        <button class="icon-btn" type="button" on:click={() => dispatch('clearsearch')} title="Сбросить поиск">×</button>
      {:else}
        <button class="icon-btn" type="button" on:click={() => dispatch('create')} title="Новый чат">+</button>
      {/if}
    </div>
  </header>

  <div class="chat-list">
    {#if searchQuery.trim()}
      {#if searchedChats.length === 0 && searchedUsers.length === 0 && !searchingUsers}
        <div class="empty">Ничего не найдено</div>
      {:else}
        {#each searchedChats as chat}
          {@const chatTitle = getChatTitle(chat)}
          {@const isPinned = pinnedChatIds.includes(chat.id)}
          <div class="chat-item-wrap" class:selected={selectedChatId === chat.id}>
            <a
              href="#/chats/{chat.id}"
              class="chat-item"
              on:contextmenu={(event) => openChatContextMenu(event, chat)}
              on:touchstart={(event) => startChatLongPress(event, chat)}
              on:touchend={clearChatLongPress}
              on:touchcancel={clearChatLongPress}
              on:touchmove={clearChatLongPress}
            >
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
                  <span class="chat-name-text" class:muted={mutedChatIds.includes(chat.id)} title={chatTitle}>{chatTitle}</span>
                  {#if isPinned}
                    <span class="pin-indicator" aria-label="Чат закреплён" title="Чат закреплён">📌</span>
                  {/if}
                  {#if chat.unreadCount && chat.unreadCount > 0}
                    <span class="unread-badge" class:muted={mutedChatIds.includes(chat.id)}>{chat.unreadCount}</span>
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

        {#if searchedChats.length > 0 && (searchedUsers.length > 0 || searchingUsers)}
          <div class="search-divider" role="separator"></div>
        {/if}

        {#if searchingUsers}
          <div class="loading-inline">Поиск пользователей...</div>
        {:else}
          {#each searchedUsers as user}
            <div class="user-result-wrap">
              <button class="user-result" type="button" on:click={() => dispatch('openuser', { user })} on:contextmenu={(event) => openUserContextMenu(event, user)}>
                <Avatar name={user.username} src={user.avatarUrl} size={40} />
                <span class="user-result-name">{user.username}</span>
              </button>
            </div>
          {/each}
        {/if}
      {/if}
    {:else if loading}
      <div class="loading">Загрузка...</div>
    {:else if chats.length === 0}
      <div class="empty">Пока нет чатов</div>
    {:else}
      {#each chats as chat}
        {@const chatTitle = getChatTitle(chat)}
        {@const isPinned = pinnedChatIds.includes(chat.id)}
        <div class="chat-item-wrap" class:selected={selectedChatId === chat.id}>
          <a
            href="#/chats/{chat.id}"
            class="chat-item"
            on:contextmenu={(event) => openChatContextMenu(event, chat)}
            on:touchstart={(event) => startChatLongPress(event, chat)}
            on:touchend={clearChatLongPress}
            on:touchcancel={clearChatLongPress}
            on:touchmove={clearChatLongPress}
          >
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
                <span class="chat-name-text" class:muted={mutedChatIds.includes(chat.id)} title={chatTitle}>{chatTitle}</span>
                {#if isPinned}
                  <span class="pin-indicator" aria-label="Чат закреплён" title="Чат закреплён">📌</span>
                {/if}
                {#if chat.unreadCount && chat.unreadCount > 0}
                  <span class="unread-badge" class:muted={mutedChatIds.includes(chat.id)}>{chat.unreadCount}</span>
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

  {#if chatContextMenu}
    {@const chatMenuUser = chatContextMenu.user}
    <div
      class="sidebar-context-menu sidebar-chat-context-menu"
      style="left: {chatContextMenu.x}px; top: {chatContextMenu.y}px;"
      role="menu"
      tabindex="-1"
      aria-label="Действия с чатом"
      on:mousedown|stopPropagation
    >
      <button class="context-menu-item" type="button" role="menuitem" on:click={togglePinnedFromContextMenu}>
        {pinnedChatIds.includes(chatContextMenu.chatId) ? 'Открепить чат' : 'Закрепить чат'}
      </button>
      <button class="context-menu-item" type="button" role="menuitem" on:click={toggleMutedFromContextMenu}>
        {mutedChatIds.includes(chatContextMenu.chatId) ? 'Отменить заглушение' : 'Заглушить чат'}
      </button>
      {#if chatMenuUser}
        <button class="context-menu-item" type="button" role="menuitem" on:click={() => toggleBlockForUser(chatMenuUser)}>
          {blockedUserIds.includes(chatMenuUser.id) ? 'Разблокировать' : 'Заблокировать'}
        </button>
      {/if}
    </div>
  {/if}

  {#if userContextMenu}
    {@const menuUser = userContextMenu.user}
    <div
      class="sidebar-context-menu sidebar-user-context-menu"
      style="left: {userContextMenu.x}px; top: {userContextMenu.y}px;"
      role="menu"
      tabindex="-1"
      aria-label="Действия с пользователем"
      on:mousedown|stopPropagation
    >
      <button class="context-menu-item" type="button" role="menuitem" on:click={() => toggleBlockForUser(menuUser)}>
        {blockedUserIds.includes(menuUser.id) ? 'Разблокировать' : 'Заблокировать'}
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
    gap: 12px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    flex: 1;
  }

  .search-input {
    flex: 1;
    min-width: 0;
    height: 38px;
    border: 1px solid #d5dde8;
    border-radius: 10px;
    padding: 0 12px;
    font-size: 14px;
    background: #f8fafc;
  }

  .search-input:focus {
    outline: none;
    border-color: #93c5fd;
    background: #fff;
  }

  .header-actions {
    display: flex;
    gap: 8px;
    flex: none;
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
    flex: none;
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
    transition: color 0.2s ease;
  }

  .chat-name-text.muted {
    color: #8f98a7;
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

  .unread-badge.muted {
    background: #94a3b8;
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

  .search-divider {
    height: 1px;
    margin: 10px 12px;
    background: #dbe3ee;
  }

  .loading-inline {
    padding: 10px 14px;
    color: #64748b;
    font-size: 13px;
  }

  .user-result-wrap {
    display: block;
  }

  .user-result {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    border: none;
    background: transparent;
    text-align: left;
    padding: 10px 12px;
    border-radius: 10px;
    cursor: pointer;
  }

  .user-result:hover {
    background: #eef3f9;
  }

  .user-result-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
    color: #0f172a;
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
