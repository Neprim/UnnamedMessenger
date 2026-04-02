<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { ChatFileMetadata } from '../../lib/types';

  type AttachmentBrowserKind = 'images' | 'documents' | 'media';

  interface AttachmentBrowserItem {
    fileId: string;
    previewUrl: string | null;
    metadata: ChatFileMetadata;
    updatedAt: number;
  }

  export let title = 'Вложения';
  export let kind: AttachmentBrowserKind = 'images';
  export let items: AttachmentBrowserItem[] = [];
  export let loading = false;

  const dispatch = createEventDispatcher<{
    close: void;
    open: { fileId: string };
  }>();
</script>

<div class="modal-shell">
  <button class="modal-overlay" type="button" on:click={() => dispatch('close')} aria-label="Закрыть окно"></button>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="attachment-browser-title">
    <div class="modal-header">
      <h3 id="attachment-browser-title">{title}</h3>
      <button class="close-btn" type="button" on:click={() => dispatch('close')}>Закрыть</button>
    </div>

    {#if loading}
      <div class="empty-state">Загрузка...</div>
    {:else if items.length === 0}
      <div class="empty-state">Подходящих вложений пока нет.</div>
    {:else if kind === 'images'}
      <div class="image-grid">
        {#each items as item}
          <button class="image-card" type="button" on:click={() => dispatch('open', { fileId: item.fileId })}>
            {#if item.previewUrl}
              <img src={item.previewUrl} alt={item.metadata.name} />
            {:else}
              <div class="image-fallback">Нет превью</div>
            {/if}
            <span class="file-name">{item.metadata.name}</span>
          </button>
        {/each}
      </div>
    {:else}
      <div class="file-list">
        {#each items as item}
          <button class="file-row" type="button" on:click={() => dispatch('open', { fileId: item.fileId })}>
            <div class="file-icon">{kind === 'media' ? '▶' : '≡'}</div>
            <div class="file-meta">
              <strong>{item.metadata.name}</strong>
              <span>{item.metadata.type}</span>
            </div>
          </button>
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
    z-index: 112;
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    border: none;
    padding: 0;
    background: rgba(15, 23, 42, 0.48);
  }

  .modal {
    position: relative;
    z-index: 1;
    width: min(880px, calc(100vw - 32px));
    max-height: min(86vh, 760px);
    overflow: auto;
    border-radius: 20px;
    padding: 24px;
    background: linear-gradient(180deg, #ffffff, #f8fafc);
    box-shadow: 0 24px 56px rgba(15, 23, 42, 0.24);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 18px;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 21px;
    color: #0f172a;
  }

  .close-btn {
    border: none;
    border-radius: 10px;
    padding: 10px 14px;
    background: #e2e8f0;
    color: #334155;
    cursor: pointer;
    font-weight: 600;
  }

  .image-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
    gap: 10px;
  }

  .image-card,
  .file-row {
    border: 1px solid #dbe4ee;
    background: white;
    cursor: pointer;
  }

  .image-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    border-radius: 16px;
    text-align: left;
  }

  .image-card img,
  .image-fallback {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: 12px;
    background: #e2e8f0;
  }

  .image-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #64748b;
    font-size: 13px;
  }

  .file-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    color: #0f172a;
  }

  .file-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .file-row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 12px 14px;
    border-radius: 14px;
    text-align: left;
  }

  .file-icon {
    width: 38px;
    height: 38px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 12px;
    background: #eef2f7;
    color: #334155;
    font-size: 16px;
    font-weight: 700;
  }

  .file-meta {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .file-meta strong,
  .file-meta span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-meta strong {
    font-size: 14px;
    color: #0f172a;
  }

  .file-meta span {
    font-size: 12px;
    color: #64748b;
  }

  .empty-state {
    padding: 42px 12px;
    text-align: center;
    color: #64748b;
    font-size: 14px;
  }
</style>
