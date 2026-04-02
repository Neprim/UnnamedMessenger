<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { getSystemMessageContent, parseSystemMessage } from '../../lib/chat-helpers';
  import type { Message } from '../../lib/types';
  import Avatar from '../common/Avatar.svelte';

  interface MessageGroup {
    senderId: string;
    senderUsername: string;
    messages: Message[];
    isSystem: boolean;
  }

  export let groupedMessages: MessageGroup[] = [];
  export let currentUserId: string | undefined;
  export let showPlaceholder = false;
  export let unreadMarkerId: string | null | undefined = null;
  export let container: HTMLDivElement | undefined;
  export let memberAvatarUrls: Record<string, string | null | undefined> = {};
  export let fileDisplayById: Record<
    string,
    {
      status: 'loading' | 'ready' | 'missing' | 'error';
      name?: string;
      type?: string;
      size?: number;
      sizeLabel?: string;
      deletedAt?: number | null;
    }
  > = {};

  const dispatch = createEventDispatcher<{
    scroll: Event;
    messagecontextmenu: { event: MouseEvent; messageId: string; senderId: string | null };
    fileclick: { fileId: string };
  }>();
</script>

<div class="messages" bind:this={container} on:scroll={(event) => dispatch('scroll', event)}>
  {#if showPlaceholder}
    <div class="load-more-placeholder">Загрузка...</div>
  {/if}

  {#each groupedMessages as group}
    {#if group.isSystem}
      {@const systemData = parseSystemMessage(group.messages[0].content || '')}
      <div class="system-message">
        <span class="system-content">{getSystemMessageContent(systemData)}</span>
        <span class="system-time" title={new Date(group.messages[0].timestamp * 1000).toLocaleString()}>
          {new Date(group.messages[0].timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {:else}
      <div class="message-group">
        <div class="message-header">
          <Avatar
            name={group.senderUsername || 'Unknown'}
            src={group.senderId ? memberAvatarUrls[group.senderId] : null}
            size={28}
          />
          <span class="sender-name">{group.senderUsername || 'Unknown'}</span>
        </div>
        {#each group.messages as msg}
          {#if unreadMarkerId && msg.id === unreadMarkerId}
            <div class="unread-divider" role="separator" aria-label="Новые сообщения">
              <span class="unread-line"></span>
              <span class="unread-label">Новые сообщения</span>
              <span class="unread-line"></span>
            </div>
          {/if}
          <div
            class="message"
            class:own={msg.senderId === currentUserId}
            data-message-id={msg.id}
            role="button"
            tabindex="0"
            on:contextmenu={(event) => dispatch('messagecontextmenu', { event, messageId: msg.id, senderId: msg.senderId })}
          >
            <div class="message-content">{msg.content}</div>
            {#if msg.fileIds.length > 0}
              <div class="message-files">
                {#each msg.fileIds as fileId}
                  {@const fileDisplay = fileDisplayById[fileId]}
                  <button
                    type="button"
                    class="file-chip"
                    class:file-chip-missing={fileDisplay?.status === 'missing'}
                    title={fileDisplay?.type || fileId}
                    disabled={fileDisplay?.status !== 'ready'}
                    on:click={() => dispatch('fileclick', { fileId })}
                  >
                    {#if fileDisplay?.status === 'ready'}
                      {fileDisplay.name}
                      {#if fileDisplay.sizeLabel}
                        ({fileDisplay.sizeLabel})
                      {/if}
                    {:else if fileDisplay?.status === 'loading'}
                      Загрузка файла...
                    {:else if fileDisplay?.status === 'missing'}
                      Файл удалён
                    {:else if fileDisplay?.status === 'error'}
                      Ошибка загрузки файла
                    {:else}
                      Файл {fileId.slice(0, 8)}
                    {/if}
                  </button>
                {/each}
              </div>
            {/if}
            <span class="msg-time" title={new Date(msg.timestamp * 1000).toLocaleString()}>
              {new Date(msg.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {#if msg.editedAt}
                <span class="edited" title={new Date(msg.editedAt * 1000).toLocaleString()}>(изменено)</span>
              {/if}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  {/each}
</div>

<style>
  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .load-more-placeholder {
    text-align: center;
    padding: 16px;
    color: #888;
  }

  .system-message {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 8px 16px;
    background: #f0f0f0;
    border-radius: 8px;
    color: #666;
    font-size: 13px;
    margin: 8px 0;
  }

  .system-content {
    flex: 1;
    text-align: center;
  }

  .system-time {
    font-size: 10px;
    color: #999;
    white-space: nowrap;
  }

  .message-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .unread-divider {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 12px 0 8px;
  }

  .unread-line {
    flex: 1;
    height: 2px;
    background: #d32f2f;
    border-radius: 999px;
  }

  .unread-label {
    color: #d32f2f;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .message-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
    padding: 0 4px;
  }

  .sender-name {
    font-weight: 600;
    font-size: 14px;
  }

  .message {
    align-self: flex-start;
    background: #f5f5f5;
    max-width: 55%;
    padding: 10px 14px;
    border-radius: 16px;
    position: relative;
    display: flex;
    align-items: flex-end;
    gap: 8px;
    border: none;
  }

  .message.own {
    background: #e3f2fd;
  }

  .message-content {
    word-wrap: break-word;
    font-size: 15px;
    line-height: 1.4;
    flex: 1;
  }

  .message-files {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }

  .file-chip {
    display: inline-flex;
    align-items: center;
    padding: 4px 8px;
    border-radius: 999px;
    border: none;
    background: rgba(15, 23, 42, 0.08);
    color: #334155;
    font-size: 12px;
    cursor: pointer;
  }

  .file-chip-missing {
    background: rgba(220, 38, 38, 0.08);
    color: #b91c1c;
  }

  .file-chip:disabled {
    cursor: default;
    opacity: 0.85;
  }

  .msg-time {
    font-size: 10px;
    color: #888;
    white-space: nowrap;
  }

  .edited {
    font-style: italic;
    color: #666;
    margin-left: 2px;
  }
</style>
