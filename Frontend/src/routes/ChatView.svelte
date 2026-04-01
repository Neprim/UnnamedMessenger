<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { api } from '../lib/api';
  import { auth, chats, type Chat } from '../lib/stores';
  import MessageList from '../components/chat/MessageList.svelte';
  import MessageInput from '../components/chat/MessageInput.svelte';
  import MembersModal from '../components/chat/MembersModal.svelte';
  import { isSystemMessage } from '../lib/chat-helpers';
  import type { ChatMember, Message, SearchUserResult } from '../lib/types';

  export let params: { id: string };
  export let chatDetail: Chat | null = null;

  let error = '';
  let newMessage = '';
  let sending = false;
  let showAddMemberModal = false;
  let showMembersModal = false;
  let userSearch = '';
  let searchResults: SearchUserResult[] = [];
  let searching = false;
  let addingMember = false;
  let contextMenu: { x: number; y: number; messageId: string; senderId: string | null; visible: boolean } = {
    x: 0,
    y: 0,
    messageId: '',
    senderId: null,
    visible: false
  };
  let editingMessage: { id: string; content: string } | null = null;
  let editingText = '';
  let messagesContainer: HTMLDivElement | undefined;
  let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
  let loadedChatId: string | null = null;
  let pendingReadCheckForChatId: string | null = null;
  let shouldStickToBottom = true;
  let previousMessageCount = 0;
  let lastTypingSentAt = 0;
  let lastObservedTypingValue = '';

  const TYPING_THROTTLE_MS = 3000;

  $: selectedChat = $chats.find((chat) => chat.id === params.id) ?? chatDetail;
  $: messages = selectedChat?.messages ?? [];
  $: chatKey = selectedChat?.chatKey ?? null;
  $: otherUserName = selectedChat?.otherUser?.username ?? null;
  $: isCreator = selectedChat?.createdBy === $auth.user?.id;
  $: isOwnMessage = contextMenu.senderId === $auth.user?.id;
  $: typingMemberNames = (selectedChat?.typingUsers ?? [])
    .map((entry) => selectedChat?.members?.find((member) => member.id === entry.userId)?.username)
    .filter((username): username is string => Boolean(username));

  type MessageGroup = {
    senderId: string;
    senderUsername: string;
    messages: Message[];
    isSystem: boolean;
  };

  function handleContainerScroll() {
    if (!messagesContainer || !selectedChat) return;

    const scrollTop = messagesContainer.scrollTop;
    const scrollHeight = messagesContainer.scrollHeight;
    const clientHeight = messagesContainer.clientHeight;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    const unreadCount = selectedChat.unreadCount || 0;
    shouldStickToBottom = isAtBottom;

    if (isAtBottom && unreadCount > 0) {
      chats.markChatAsRead(params.id).catch(() => {});
    }

    if (!selectedChat.isLoadingOlderMessages && !selectedChat.hasReachedBeginning && scrollTop < 100) {
      if (scrollTimeout) clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(async () => {
        if (!messagesContainer) return;

        const scrollHeightBefore = messagesContainer.scrollHeight;
        const scrollTopBefore = messagesContainer.scrollTop;

        try {
          await chats.loadOlderMessages(params.id);
        } catch {
          error = 'Не удалось загрузить более ранние сообщения';
        }

        requestAnimationFrame(() => {
          if (!messagesContainer) return;
          const scrollHeightAfter = messagesContainer.scrollHeight;
          messagesContainer.scrollTop = scrollTopBefore + (scrollHeightAfter - scrollHeightBefore);
        });
      }, 300);
    }
  }

  async function markChatAsReadIfFullyVisible() {
    if (!messagesContainer || !selectedChat || !selectedChat.unreadCount) {
      return;
    }

    const scrollTop = messagesContainer.scrollTop;
    const scrollHeight = messagesContainer.scrollHeight;
    const clientHeight = messagesContainer.clientHeight;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    const fitsWithoutScroll = scrollHeight <= clientHeight + 1;

    if (isAtBottom || fitsWithoutScroll) {
      await chats.markChatAsRead(params.id);
    }
  }

  function handleContextMenu(event: MouseEvent, messageId: string, senderId: string | null) {
    event.preventDefault();
    contextMenu = {
      x: event.clientX,
      y: event.clientY,
      messageId,
      senderId,
      visible: true
    };

    requestAnimationFrame(() => {
      const menuElement = document.querySelector('.context-menu') as HTMLElement | null;
      if (!menuElement) return;

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
    contextMenu = { x: 0, y: 0, messageId: '', senderId: null, visible: false };
  }

  function groupMessages(source: Message[], members: ChatMember[] = []): MessageGroup[] {
    const memberMap = new Map(members.map((member) => [member.id, member.username]));
    const groups: MessageGroup[] = [];
    let currentGroup: MessageGroup | null = null;

    for (const message of source) {
      if (isSystemMessage(message)) {
        if (currentGroup) {
          groups.push(currentGroup);
          currentGroup = null;
        }

        groups.push({
          senderId: 'system',
          senderUsername: 'System',
          messages: [message],
          isSystem: true
        });
        continue;
      }

      const senderUsername = message.senderUsername || memberMap.get(message.senderId ?? '') || 'Unknown';
      const timestamp = new Date(message.timestamp).getTime();

      if (currentGroup && currentGroup.senderId === message.senderId) {
        const lastTimestamp = new Date(currentGroup.messages[currentGroup.messages.length - 1].timestamp).getTime();
        if (timestamp - lastTimestamp < 5 * 60 * 1000) {
          currentGroup.messages.push(message);
          continue;
        }
      }

      if (currentGroup) {
        groups.push(currentGroup);
      }

      currentGroup = {
        senderId: message.senderId ?? '',
        senderUsername,
        messages: [message],
        isSystem: false
      };
    }

    if (currentGroup) {
      groups.push(currentGroup);
    }

    return groups;
  }

  $: groupedMessages = groupMessages(messages, selectedChat?.members ?? []);
  $: showPlaceholder = !(selectedChat?.hasReachedBeginning ?? false);
  $: if (messagesContainer) {
    const currentMessageCount = messages.length;
    const shouldScrollToBottom = currentMessageCount > previousMessageCount && shouldStickToBottom;
    previousMessageCount = currentMessageCount;

    if (shouldScrollToBottom) {
      tick().then(() => {
        if (messagesContainer) {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
      });
    }
  }
  $: if (selectedChat?.id && newMessage !== lastObservedTypingValue) {
    lastObservedTypingValue = newMessage;

    if (newMessage.trim()) {
      const now = Date.now();
      if (now - lastTypingSentAt >= TYPING_THROTTLE_MS) {
        lastTypingSentAt = now;
        chats.sendTyping(selectedChat.id).catch(() => {});
      }
    }
  }

  async function handleDeleteFromMenu() {
    if (contextMenu.messageId) {
      await handleDeleteMessage(contextMenu.messageId);
    }
    closeContextMenu();
  }

  function handleEditFromMenu(message: Message) {
    editingMessage = { id: message.id, content: message.content };
    editingText = message.content;
    closeContextMenu();
  }

  async function handleEditMessage() {
    if (!editingMessage || !editingText.trim()) return;

    try {
      await chats.editMessage(params.id, editingMessage.id, editingText);
      editingMessage = null;
      editingText = '';
    } catch (exception) {
      error = exception instanceof Error ? exception.message : 'Не удалось отредактировать сообщение';
    }
  }

  function cancelEdit() {
    editingMessage = null;
    editingText = '';
  }

  async function handleSendMessage() {
    if (!newMessage.trim() || sending) return;

    sending = true;
    try {
      await chats.sendMessage(params.id, newMessage);
      newMessage = '';
      shouldStickToBottom = true;
      requestAnimationFrame(() => {
        if (messagesContainer) {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        (document.getElementById('messageInput') as HTMLInputElement | null)?.focus();
      });
    } catch (exception) {
      error = exception instanceof Error ? exception.message : 'Не удалось отправить сообщение';
    } finally {
      sending = false;
    }
  }

  async function handleDeleteMessage(messageId: string) {
    try {
      await chats.deleteMessage(params.id, messageId);
    } catch (exception) {
      error = exception instanceof Error ? exception.message : 'Не удалось удалить сообщение';
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
    } catch {
      searchResults = [];
    } finally {
      searching = false;
    }
  }

  async function addMember(userId: string) {
    addingMember = true;
    try {
      const user = searchResults.find((item) => item.id === userId);
      if (!user) return;

      await chats.addMember(params.id, userId, user.publicKey);
      showAddMemberModal = false;
      userSearch = '';
      searchResults = [];
    } catch (exception) {
      error = exception instanceof Error ? exception.message : 'Не удалось добавить участника';
    } finally {
      addingMember = false;
    }
  }

  async function removeMember(userId: string) {
    try {
      await chats.removeMember(params.id, userId);
      showMembersModal = false;
    } catch (exception) {
      error = exception instanceof Error ? exception.message : 'Не удалось удалить участника';
    }
  }

  async function handleLeaveChat() {
    if (!confirm('Вы уверены, что хотите покинуть этот чат?')) return;

    try {
      await chats.leaveChat(params.id);
      window.location.hash = '#/chats';
    } catch (exception) {
      error = exception instanceof Error ? exception.message : 'Не удалось покинуть чат';
    }
  }

  async function handleDeleteChat() {
    if (!confirm('Вы уверены, что хотите удалить этот чат?')) return;

    try {
      await chats.deleteChat(params.id);
      window.location.hash = '#/chats';
    } catch (exception) {
      error = exception instanceof Error ? exception.message : 'Не удалось удалить чат';
    }
  }

  $: if (params.id && params.id !== loadedChatId) {
    loadedChatId = params.id;
    chats
      .ensureChatLoaded(params.id)
      .then(() => {
        shouldStickToBottom = true;
        requestAnimationFrame(() => {
          if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
          }
        });
      })
      .catch((exception) => {
        error = exception instanceof Error ? exception.message : 'Не удалось загрузить чат';
      });
  }

  $: if (selectedChat?.id && messagesContainer && (selectedChat.unreadCount ?? 0) > 0) {
    pendingReadCheckForChatId = selectedChat.id;
    tick().then(() => {
      if (pendingReadCheckForChatId !== selectedChat?.id) return;
      markChatAsReadIfFullyVisible().catch(() => {});
    });
  }

  onDestroy(() => {
    if (scrollTimeout) clearTimeout(scrollTimeout);
  });
</script>

<div class="chat-container">
  <header>
    <h2>
      {#if selectedChat?.type === 'pm' && otherUserName}
        {otherUserName}
      {:else}
        {selectedChat?.name || 'Чат'}
      {/if}
    </h2>
    {#if chatKey}
      <div class="header-actions">
        <button class="icon-btn" type="button" on:click={() => (showMembersModal = true)} title="Участники">👥</button>
        {#if isCreator && selectedChat?.type === 'gm'}
          <button class="icon-btn" type="button" on:click={() => (showAddMemberModal = true)} title="Добавить участника">+</button>
        {:else if selectedChat?.type === 'gm'}
          <button class="icon-btn leave-btn" type="button" on:click={handleLeaveChat} title="Покинуть чат">⇦</button>
        {/if}
      </div>
    {/if}
  </header>

  {#if !selectedChat?.isHydrated && !messages.length}
    <div class="loading">Загрузка...</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else}
    <MessageList
      bind:container={messagesContainer}
      {groupedMessages}
      currentUserId={$auth.user?.id}
      {showPlaceholder}
      unreadMarkerId={selectedChat?.unreadMarkerId}
      on:scroll={handleContainerScroll}
      on:messagecontextmenu={(event) => handleContextMenu(event.detail.event, event.detail.messageId, event.detail.senderId)}
    />

    {#if typingMemberNames.length > 0}
      <div class="typing-indicator" aria-live="polite">
        {#if typingMemberNames.length === 1}
          {typingMemberNames[0]} печатает...
        {:else if typingMemberNames.length === 2}
          {typingMemberNames[0]} и {typingMemberNames[1]} печатают...
        {:else}
          Несколько человек печатают...
        {/if}
      </div>
    {/if}

    <MessageInput bind:value={newMessage} disabled={sending || !chatKey} {sending} on:submit={handleSendMessage} />

    {#if editingMessage}
      <div class="edit-area">
        <input
          type="text"
          bind:value={editingText}
          placeholder="Редактировать сообщение..."
          on:keydown={(event) => {
            if (event.key === 'Enter') handleEditMessage();
            if (event.key === 'Escape') cancelEdit();
          }}
        />
        <button class="edit-save" type="button" on:click={handleEditMessage} disabled={!editingText.trim()}>Сохранить</button>
        <button class="edit-cancel" type="button" on:click={cancelEdit}>Отмена</button>
      </div>
    {/if}
  {/if}

  {#if contextMenu.visible}
    <div class="context-menu" style="left: {contextMenu.x}px; top: {contextMenu.y}px;" role="menu">
      <button class="context-menu-item disabled" type="button" disabled>Ответить</button>
      <button class="context-menu-item disabled" type="button" disabled>Закрепить</button>
      <button class="context-menu-item disabled" type="button" disabled>Скопировать</button>
      {#if isOwnMessage}
        <button
          class="context-menu-item"
          type="button"
          on:click={() => {
            const message = messages.find((item) => item.id === contextMenu.messageId);
            if (message) handleEditFromMenu(message);
          }}
        >
          Редактировать
        </button>
        <button class="context-menu-item danger" type="button" on:click={handleDeleteFromMenu}>Удалить</button>
      {/if}
    </div>
    <button class="context-menu-overlay" type="button" on:click={closeContextMenu} aria-label="Закрыть меню"></button>
  {/if}
</div>

{#if showAddMemberModal}
  <div class="modal-shell">
    <button
      class="modal-overlay"
      type="button"
      aria-label="Закрыть окно добавления участника"
      on:click={() => (showAddMemberModal = false)}
    ></button>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="add-member-title">
      <h3 id="add-member-title">Добавить участника</h3>
      <div class="field">
        <label for="userSearch">Поиск пользователей</label>
        <input
          id="userSearch"
          type="text"
          bind:value={userSearch}
          on:input={searchUsers}
          placeholder="Введите имя пользователя..."
        />
      </div>
      {#if searching}
        <p>Поиск...</p>
      {:else if searchResults.length > 0}
        <div class="search-results">
          {#each searchResults as user}
            {@const isAlreadyMember = Boolean(selectedChat?.members?.some((member) => member.id === user.id))}
            <button class="search-result" type="button" disabled={isAlreadyMember || addingMember} on:click={() => addMember(user.id)}>
              {user.username}
              {#if isAlreadyMember}
                (already in chat)
              {/if}
            </button>
          {/each}
        </div>
      {/if}
      <div class="modal-actions">
        <button type="button" on:click={() => (showAddMemberModal = false)}>Отмена</button>
      </div>
    </div>
  </div>
{/if}

{#if showMembersModal}
  <MembersModal
    members={selectedChat?.members ?? []}
    {isCreator}
    chatType={selectedChat?.type ?? 'gm'}
    currentUserId={$auth.user?.id}
    on:close={() => (showMembersModal = false)}
    on:deleteChat={handleDeleteChat}
    on:remove={(event) => removeMember(event.detail.userId)}
  />
{/if}

<style>
  .chat-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  header {
    padding: 16px 24px;
    border-bottom: 1px solid #e0e0e0;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }

  .loading,
  .error {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #888;
  }

  .error {
    color: #f44336;
  }

  .header-actions {
    display: flex;
    gap: 8px;
    margin-left: auto;
  }

  .icon-btn {
    width: 36px;
    height: 36px;
    border: none;
    border-radius: 8px;
    background: #f0f0f0;
    cursor: pointer;
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .icon-btn:hover {
    background: #e0e0e0;
  }

  .edit-area {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid #e0e0e0;
    background: #f5f5f5;
  }

  .typing-indicator {
    padding: 8px 24px 0;
    font-size: 13px;
    color: #6b7280;
    font-style: italic;
  }

  .edit-area input {
    flex: 1;
    padding: 10px 12px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 15px;
  }

  .edit-save,
  .edit-cancel {
    padding: 10px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    border: none;
  }

  .edit-save {
    background: #4caf50;
    color: white;
  }

  .edit-save:disabled {
    background: #ccc;
    cursor: not-allowed;
  }

  .edit-cancel {
    background: #f5f5f5;
    color: #666;
    border: 1px solid #ddd;
  }

  .context-menu-overlay {
    position: fixed;
    inset: 0;
    z-index: 99;
    background: transparent;
    border: none;
    padding: 0;
  }

  .context-menu {
    position: fixed;
    background: white;
    border: 1px solid #ddd;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 100;
    min-width: 120px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .context-menu-item {
    padding: 10px 16px;
    cursor: pointer;
    font-size: 14px;
    color: #333;
    text-align: left;
    border: none;
    background: white;
  }

  .context-menu-item:hover:not(:disabled) {
    background: #f5f5f5;
  }

  .context-menu-item:disabled {
    color: #999;
    cursor: default;
  }

  .context-menu-item.danger {
    color: #f44336;
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

  .field {
    margin-bottom: 16px;
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

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 20px;
  }
</style>
