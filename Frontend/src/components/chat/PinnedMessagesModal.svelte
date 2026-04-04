<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { PinnedMessage } from '../../lib/types';

  export let items: PinnedMessage[] = [];
  export let activeMessageId: string | null = null;
  export let fileDisplayById: Record<string, { name?: string }> = {};
  export let blockedUserIds: string[] = [];

  const dispatch = createEventDispatcher<{
    close: void;
    open: { messageId: string };
    unpin: { messageId: string };
  }>();

  function getPreview(item: PinnedMessage) {
    if (item.message.senderId && blockedUserIds.includes(item.message.senderId)) {
      return 'Сообщение скрыто';
    }

    if (item.message.content?.trim()) {
      return item.message.content;
    }

    if (item.message.fileIds.length > 0) {
      const names = item.message.fileIds
        .map((fileId) => fileDisplayById[fileId]?.name?.trim() || '')
        .filter(Boolean);
      return names.length > 0 ? names.join(', ') : 'Вложение';
    }

    return 'Сообщение';
  }

  function isAttachmentOnly(item: PinnedMessage) {
    return !item.message.content?.trim() && item.message.fileIds.length > 0;
  }
</script>

<div class="modal-shell">
  <button class="modal-overlay" type="button" aria-label="Закрыть список закрепов" on:click={() => dispatch('close')}></button>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="pins-title">
    <div class="modal-header">
      <h3 id="pins-title">Закреплённые сообщения</h3>
      <span class="pins-count">{items.length}</span>
    </div>

    {#if items.length === 0}
      <div class="empty-state">Пока нет закреплённых сообщений</div>
    {:else}
      <div class="pin-list">
        {#each items as item}
          <div class="pin-card" class:active={item.message.id === activeMessageId}>
            <button class="pin-main" type="button" on:click={() => dispatch('open', { messageId: item.message.id })}>
              <div class="pin-meta">
                <span class="pin-author">{item.message.senderUsername || 'Unknown'}</span>
                <span class="pin-time">{new Date(item.pinnedAt * 1000).toLocaleString()}</span>
              </div>
              <div class="pin-preview" class:attachment-only={isAttachmentOnly(item)}>{getPreview(item)}</div>
            </button>
            <button class="pin-unpin" type="button" on:click={() => dispatch('unpin', { messageId: item.message.id })}>
              Снять
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .modal-shell {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 120;
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    border: none;
    background: rgba(0, 0, 0, 0.5);
    padding: 0;
  }

  .modal {
    position: relative;
    z-index: 1;
    width: min(560px, calc(100vw - 32px));
    max-height: min(70vh, 720px);
    overflow: auto;
    padding: 24px;
    border-radius: 18px;
    background: white;
    box-shadow: 0 16px 48px rgba(15, 23, 42, 0.22);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }

  h3 {
    margin: 0;
    font-size: 20px;
  }

  .pins-count {
    min-width: 28px;
    padding: 4px 10px;
    border-radius: 999px;
    background: #e8f0fe;
    color: #1d4ed8;
    font-size: 13px;
    font-weight: 700;
    text-align: center;
  }

  .empty-state {
    padding: 28px 12px;
    text-align: center;
    color: #64748b;
  }

  .pin-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .pin-card {
    display: flex;
    align-items: stretch;
    gap: 8px;
    border-radius: 14px;
    background: #f8fafc;
    border: 1px solid transparent;
    padding: 8px;
  }

  .pin-card.active {
    border-color: #93c5fd;
    background: #eff6ff;
  }

  .pin-main {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
    padding: 6px 8px;
  }

  .pin-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 4px;
  }

  .pin-author {
    min-width: 0;
    font-size: 13px;
    font-weight: 700;
    color: #1d4ed8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pin-time {
    flex-shrink: 0;
    font-size: 11px;
    color: #64748b;
  }

  .pin-preview {
    font-size: 14px;
    color: #334155;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pin-preview.attachment-only {
    font-style: italic;
  }

  .pin-unpin {
    flex-shrink: 0;
    align-self: center;
    min-width: 74px;
    padding: 10px 12px;
    border: none;
    border-radius: 10px;
    background: #fee2e2;
    color: #b91c1c;
    cursor: pointer;
    font-weight: 600;
  }

  @media (max-width: 768px) {
    .modal-shell {
      padding: 16px;
      align-items: flex-end;
    }

    .modal {
      width: min(100%, 560px);
      max-height: calc(100dvh - 32px);
      padding: 18px;
      border-radius: 18px;
    }

    .pin-card {
      flex-direction: column;
    }

    .pin-unpin {
      width: 100%;
      align-self: stretch;
    }
  }
</style>
