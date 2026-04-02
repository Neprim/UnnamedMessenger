<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';

  export let file: File;
  export let uploading = false;

  const dispatch = createEventDispatcher<{
    close: void;
    save: { blob: Blob };
  }>();

  const OUTPUT_SIZE = 512;

  let imageUrl = '';
  let currentFile: File | null = null;
  let sourceImage: HTMLImageElement | null = null;
  let loadVersion = 0;

  let frameElement: HTMLDivElement | null = null;
  let frameSize = 0;
  let naturalWidth = 0;
  let naturalHeight = 0;

  let zoom = 1;
  let previousZoom = 1;
  let panX = 0;
  let panY = 0;
  let error = '';

  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragOriginX = 0;
  let dragOriginY = 0;

  let baseWidth = 0;
  let baseHeight = 0;
  let renderedWidth = 0;
  let renderedHeight = 0;
  let maxPanX = 0;
  let maxPanY = 0;
  let left = 0;
  let top = 0;

  $: if (file && file !== currentFile) {
    if (imageUrl) {
      URL.revokeObjectURL(imageUrl);
    }

    currentFile = file;
    imageUrl = URL.createObjectURL(file);
    sourceImage = null;
    naturalWidth = 0;
    naturalHeight = 0;
    zoom = 1;
    previousZoom = 1;
    panX = 0;
    panY = 0;
    error = '';

    void loadImage(imageUrl);
  }

  $: if (zoom !== previousZoom) {
    const zoomRatio = zoom / previousZoom;
    panX *= zoomRatio;
    panY *= zoomRatio;
    previousZoom = zoom;
  }

  $: {
    if (!frameSize || !naturalWidth || !naturalHeight) {
      baseWidth = 0;
      baseHeight = 0;
      renderedWidth = 0;
      renderedHeight = 0;
      maxPanX = 0;
      maxPanY = 0;
      left = 0;
      top = 0;
    } else {
      const coverScale = Math.max(frameSize / naturalWidth, frameSize / naturalHeight);
      baseWidth = naturalWidth * coverScale;
      baseHeight = naturalHeight * coverScale;
      renderedWidth = baseWidth * zoom;
      renderedHeight = baseHeight * zoom;
      maxPanX = Math.max(0, (renderedWidth - frameSize) / 2);
      maxPanY = Math.max(0, (renderedHeight - frameSize) / 2);
      panX = clamp(panX, -maxPanX, maxPanX);
      panY = clamp(panY, -maxPanY, maxPanY);
      left = (frameSize - renderedWidth) / 2 + panX;
      top = (frameSize - renderedHeight) / 2 + panY;
    }
  }

  onDestroy(() => {
    loadVersion += 1;
    if (imageUrl) {
      URL.revokeObjectURL(imageUrl);
    }
  });

  function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
  }

  async function loadImage(url: string) {
    const version = ++loadVersion;

    try {
      const image = new Image();
      image.decoding = 'async';
      image.src = url;

      if (typeof image.decode === 'function') {
        await image.decode();
      } else {
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('load failed'));
        });
      }

      if (version !== loadVersion || url !== imageUrl) {
        return;
      }

      sourceImage = image;
      naturalWidth = image.naturalWidth;
      naturalHeight = image.naturalHeight;
    } catch {
      if (version !== loadVersion || url !== imageUrl) {
        return;
      }

      error = 'Не удалось загрузить изображение';
    }
  }

  function handlePointerDown(event: PointerEvent) {
    if (!frameElement || !renderedWidth || !renderedHeight) return;

    isDragging = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragOriginX = panX;
    dragOriginY = panY;
    frameElement.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent) {
    if (!isDragging) return;

    panX = dragOriginX + (event.clientX - dragStartX);
    panY = dragOriginY + (event.clientY - dragStartY);
  }

  function handlePointerUp(event: PointerEvent) {
    if (!frameElement) return;

    isDragging = false;
    if (frameElement.hasPointerCapture(event.pointerId)) {
      frameElement.releasePointerCapture(event.pointerId);
    }
  }

  async function handleSave() {
    if (!sourceImage || !frameSize || !renderedWidth || !renderedHeight) {
      error = 'Не удалось подготовить изображение';
      return;
    }

    const scaleX = naturalWidth / renderedWidth;
    const scaleY = naturalHeight / renderedHeight;
    const sourceX = Math.max(0, -left * scaleX);
    const sourceY = Math.max(0, -top * scaleY);
    const sourceWidth = Math.min(naturalWidth - sourceX, frameSize * scaleX);
    const sourceHeight = Math.min(naturalHeight - sourceY, frameSize * scaleY);

    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;

    const context = canvas.getContext('2d');
    if (!context) {
      error = 'Не удалось подготовить изображение';
      return;
    }

    context.drawImage(sourceImage, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/webp', 0.92);
    });

    if (!blob) {
      error = 'Не удалось подготовить изображение';
      return;
    }

    dispatch('save', { blob });
  }
</script>

<div class="modal-shell">
  <button class="modal-overlay" type="button" on:click={() => dispatch('close')} aria-label="Закрыть окно"></button>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="avatar-crop-title">
    <h3 id="avatar-crop-title">Обрезать аватар</h3>

    <div class="crop-stage">
      <div
        class="crop-frame"
        bind:this={frameElement}
        bind:clientWidth={frameSize}
        class:dragging={isDragging}
        role="application"
        aria-label="Область кадрирования аватара"
        on:pointerdown={handlePointerDown}
        on:pointermove={handlePointerMove}
        on:pointerup={handlePointerUp}
        on:pointercancel={handlePointerUp}
        on:lostpointercapture={() => (isDragging = false)}
      >
        <img
          class="preview-image"
          src={imageUrl}
          alt="Предпросмотр аватара"
          draggable="false"
          style={`width:${renderedWidth}px;height:${renderedHeight}px;left:${left}px;top:${top}px;`}
        />
        <div class="crop-mask"></div>
      </div>
    </div>

    <div class="controls">
      <label>
        Масштаб
        <input type="range" min="1" max="3" step="0.01" bind:value={zoom} />
      </label>
      <p class="hint">Перетащите изображение внутри круга, чтобы выбрать нужную область.</p>
    </div>

    {#if error}
      <p class="error">{error}</p>
    {/if}

    <div class="modal-actions">
      <button type="button" on:click={() => dispatch('close')}>Отмена</button>
      <button type="button" class="primary" on:click={handleSave} disabled={uploading}>
        {uploading ? 'Сохранение...' : 'Сохранить'}
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
    z-index: 110;
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    border: none;
    padding: 0;
  }

  .modal {
    position: relative;
    z-index: 1;
    width: min(92vw, 520px);
    background: white;
    border-radius: 16px;
    padding: 24px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.22);
  }

  h3 {
    margin: 0 0 20px;
    font-size: 20px;
  }

  .crop-stage {
    display: flex;
    justify-content: center;
    margin-bottom: 20px;
  }

  .crop-frame {
    position: relative;
    width: min(72vw, 320px);
    aspect-ratio: 1;
    overflow: hidden;
    border-radius: 24px;
    background: #eef2f7;
    cursor: grab;
    touch-action: none;
    user-select: none;
  }

  .crop-frame.dragging {
    cursor: grabbing;
  }

  .preview-image {
    position: absolute;
    max-width: none;
    max-height: none;
    pointer-events: none;
    user-select: none;
  }

  .crop-mask {
    position: absolute;
    inset: 10px;
    border-radius: 50%;
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.28);
    pointer-events: none;
    border: 2px solid rgba(255, 255, 255, 0.9);
  }

  .controls {
    display: grid;
    gap: 12px;
  }

  label {
    display: grid;
    gap: 6px;
    font-size: 14px;
    font-weight: 600;
    color: #374151;
  }

  input[type='range'] {
    width: 100%;
  }

  .hint {
    margin: 0;
    font-size: 13px;
    color: #6b7280;
  }

  .error {
    color: #d32f2f;
    margin: 16px 0 0;
    font-size: 14px;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 22px;
  }

  .modal-actions button {
    padding: 10px 18px;
    border: none;
    border-radius: 10px;
    cursor: pointer;
  }

  .primary {
    background: #4caf50;
    color: white;
  }
</style>
