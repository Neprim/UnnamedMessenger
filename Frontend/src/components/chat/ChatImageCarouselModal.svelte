<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  interface CarouselItem {
    fileId: string;
    src: string;
    name: string;
  }

  export let items: CarouselItem[] = [];
  export let currentFileId: string | null = null;

  const dispatch = createEventDispatcher<{ close: void }>();

  $: currentIndex = Math.max(
    0,
    currentFileId ? items.findIndex((item) => item.fileId === currentFileId) : 0
  );
  $: activeItem = items[currentIndex] ?? null;

  function close() {
    dispatch('close');
  }

  function showPrevious() {
    if (items.length <= 1) return;
    currentFileId = items[(currentIndex - 1 + items.length) % items.length]?.fileId ?? currentFileId;
  }

  function showNext() {
    if (items.length <= 1) return;
    currentFileId = items[(currentIndex + 1) % items.length]?.fileId ?? currentFileId;
  }
</script>

<svelte:window
  on:keydown={(event) => {
    if (!activeItem) return;
    if (event.key === 'Escape') close();
    if (event.key === 'ArrowLeft') showPrevious();
    if (event.key === 'ArrowRight') showNext();
  }}
/>

{#if activeItem}
  <div class="modal-shell">
    <button class="modal-overlay" type="button" on:click={close} aria-label="Закрыть просмотрщик"></button>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="carousel-title">
      <div class="modal-header">
        <div class="meta">
          <h3 id="carousel-title">{activeItem.name}</h3>
          {#if items.length > 1}
            <span>{currentIndex + 1} / {items.length}</span>
          {/if}
        </div>
        <button class="close-btn" type="button" on:click={close}>Закрыть</button>
      </div>

      <div class="viewer">
        {#if items.length > 1}
          <button class="nav-btn" type="button" on:click={showPrevious} aria-label="Предыдущее изображение">‹</button>
        {/if}
        <div class="image-wrap">
          <img src={activeItem.src} alt={activeItem.name} />
        </div>
        {#if items.length > 1}
          <button class="nav-btn" type="button" on:click={showNext} aria-label="Следующее изображение">›</button>
        {/if}
      </div>

      {#if items.length > 1}
        <div class="thumbs">
          {#each items as item}
            <button
              type="button"
              class="thumb"
              class:active={item.fileId === activeItem.fileId}
              on:click={() => (currentFileId = item.fileId)}
              aria-label={`Открыть ${item.name}`}
            >
              <img src={item.src} alt={item.name} />
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-shell {
    position: fixed;
    inset: 0;
    z-index: 130;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    border: none;
    padding: 0;
    background: rgba(15, 23, 42, 0.84);
  }

  .modal {
    position: relative;
    z-index: 1;
    width: min(1100px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 20px;
    border-radius: 22px;
    background: rgba(15, 23, 42, 0.96);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    color: white;
  }

  .meta {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .meta h3,
  .meta span {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta h3 {
    font-size: 18px;
  }

  .meta span {
    color: rgba(255, 255, 255, 0.68);
    font-size: 13px;
  }

  .close-btn,
  .nav-btn {
    border: none;
    cursor: pointer;
  }

  .close-btn {
    padding: 10px 14px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.12);
    color: white;
    font-weight: 600;
  }

  .viewer {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 12px;
    min-height: 0;
  }

  .nav-btn {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.12);
    color: white;
    font-size: 30px;
    line-height: 1;
  }

  .image-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    max-height: calc(100vh - 220px);
    overflow: hidden;
  }

  .image-wrap img {
    max-width: 100%;
    max-height: calc(100vh - 220px);
    object-fit: contain;
    border-radius: 18px;
  }

  .thumbs {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    padding-bottom: 2px;
  }

  .thumb {
    flex: none;
    width: 72px;
    height: 72px;
    padding: 0;
    overflow: hidden;
    border-radius: 14px;
    border: 2px solid transparent;
    background: rgba(255, 255, 255, 0.08);
    cursor: pointer;
  }

  .thumb.active {
    border-color: #60a5fa;
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  @media (max-width: 720px) {
    .modal {
      padding: 16px;
    }

    .viewer {
      grid-template-columns: 1fr;
    }

    .nav-btn {
      display: none;
    }

    .image-wrap,
    .image-wrap img {
      max-height: calc(100vh - 200px);
    }
  }
</style>
