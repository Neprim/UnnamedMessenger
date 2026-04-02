<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { ChatFileMetadata } from '../../lib/types';

  interface ReusableChatImageItem {
    fileId: string;
    previewUrl: string | null;
    metadata: ChatFileMetadata;
    updatedAt: number;
    isFavorite: boolean;
  }

  export let items: ReusableChatImageItem[] = [];
  export let selectedFileIds: string[] = [];
  export let loading = false;

  const dispatch = createEventDispatcher<{
    close: void;
    toggle: { fileId: string };
    favorite: { fileId: string };
  }>();

  $: selectedSet = new Set(selectedFileIds);
  $: favoriteItems = items.filter((item) => item.isFavorite);
  $: otherItems = items.filter((item) => !item.isFavorite);
</script>

<div class="modal-shell">
  <button class="modal-overlay" type="button" on:click={() => dispatch('close')} aria-label="Закрыть окно"></button>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="chat-image-library-title">
    <div class="modal-header">
      <div>
        <h3 id="chat-image-library-title">Изображения чата</h3>
      </div>
      <button class="close-btn" type="button" on:click={() => dispatch('close')}>Закрыть</button>
    </div>

    {#if loading}
      <div class="empty-state">Загрузка изображений...</div>
    {:else if items.length === 0}
      <div class="empty-state">В этом чате пока нет изображений для повторного использования.</div>
    {:else}
      {#if favoriteItems.length > 0}
        <section class="section">
          <div class="section-header">
            <h4>Избранное</h4>
          </div>
          <div class="grid">
            {#each favoriteItems as item}
              <div
                class="image-card"
                class:selected={selectedSet.has(item.fileId)}
                role="button"
                tabindex="0"
                on:click={() => dispatch('toggle', { fileId: item.fileId })}
                on:keydown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    dispatch('toggle', { fileId: item.fileId });
                  }
                }}
              >
                <div class="favorite-button-wrap">
                  <button
                    type="button"
                    class="favorite-btn"
                    class:active={item.isFavorite}
                    aria-label="Убрать из избранного"
                    on:click|stopPropagation={() => dispatch('favorite', { fileId: item.fileId })}
                  >
                    ★
                  </button>
                </div>
                {#if item.previewUrl}
                  <img src={item.previewUrl} alt={item.metadata.name} />
                {:else}
                  <div class="image-fallback">Нет превью</div>
                {/if}
                <div class="image-meta">
                  <strong>{item.metadata.name}</strong>
                </div>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <section class="section">
        <div class="section-header">
          <h4>{favoriteItems.length > 0 ? 'Все изображения' : 'Изображения'}</h4>
        </div>
        <div class="grid">
          {#each otherItems as item}
            <div
              class="image-card"
              class:selected={selectedSet.has(item.fileId)}
              role="button"
              tabindex="0"
              on:click={() => dispatch('toggle', { fileId: item.fileId })}
              on:keydown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  dispatch('toggle', { fileId: item.fileId });
                }
              }}
            >
              <div class="favorite-button-wrap">
                <button
                  type="button"
                  class="favorite-btn"
                  class:active={item.isFavorite}
                  aria-label="Добавить в избранное"
                  on:click|stopPropagation={() => dispatch('favorite', { fileId: item.fileId })}
                >
                  ★
                </button>
              </div>
              {#if item.previewUrl}
                <img src={item.previewUrl} alt={item.metadata.name} />
              {:else}
                <div class="image-fallback">Нет превью</div>
              {/if}
              <div class="image-meta">
                <strong>{item.metadata.name}</strong>
              </div>
            </div>
          {/each}
        </div>
      </section>
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
    z-index: 110;
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.48);
    border: none;
    padding: 0;
  }

  .modal {
    position: relative;
    z-index: 1;
    width: min(920px, calc(100vw - 32px));
    max-height: min(88vh, 760px);
    overflow: auto;
    border-radius: 20px;
    padding: 24px;
    background: linear-gradient(180deg, #ffffff, #f8fafc);
    box-shadow: 0 24px 56px rgba(15, 23, 42, 0.24);
  }

  .modal-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 20px;
  }

  .modal-header h3 {
    margin: 0 0 6px;
    font-size: 22px;
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

  .section + .section {
    margin-top: 20px;
  }

  .section-header {
    margin-bottom: 12px;
  }

  .section-header h4 {
    margin: 0;
    font-size: 15px;
    color: #0f172a;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 10px;
  }

  .image-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    border: 1px solid #dbe4ee;
    border-radius: 16px;
    background: white;
    cursor: pointer;
    text-align: left;
  }

  .image-card.selected {
    border-color: #2563eb;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14);
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

  .favorite-button-wrap {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 1;
  }

  .favorite-btn {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.72);
    color: rgba(255, 255, 255, 0.78);
    cursor: pointer;
    font-size: 15px;
    line-height: 1;
  }

  .favorite-btn.active {
    background: rgba(245, 158, 11, 0.92);
    color: white;
  }

  .image-meta {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .image-meta strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .image-meta strong {
    font-size: 13px;
    color: #0f172a;
  }

  .empty-state {
    padding: 42px 12px;
    text-align: center;
    color: #64748b;
    font-size: 14px;
  }
</style>
