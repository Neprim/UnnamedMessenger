<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let fromDate = '';
  export let toDate = '';
  export let includeImages = true;
  export let includeDocuments = true;
  export let includeMedia = true;
  export let exporting = false;

  const dispatch = createEventDispatcher<{
    close: void;
    submit: {
      fromDate: string;
      toDate: string;
      includeImages: boolean;
      includeDocuments: boolean;
      includeMedia: boolean;
    };
  }>();

  function handleSubmit() {
    dispatch('submit', {
      fromDate,
      toDate,
      includeImages,
      includeDocuments,
      includeMedia
    });
  }
</script>

<div class="modal-shell">
  <button class="modal-overlay" type="button" on:click={() => dispatch('close')} aria-label="Закрыть окно экспорта"></button>

  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="export-chat-title">
    <h3 id="export-chat-title">Экспорт истории чата</h3>

    <div class="field-grid">
      <label class="field">
        <span>С даты</span>
        <input type="datetime-local" bind:value={fromDate} />
      </label>

      <label class="field">
        <span>По дату</span>
        <input type="datetime-local" bind:value={toDate} />
      </label>
    </div>

    <div class="file-types">
      <span class="file-types-title">Типы файлов для выгрузки</span>

      <label class="check-row">
        <input type="checkbox" bind:checked={includeImages} />
        <span>Изображения</span>
      </label>

      <label class="check-row">
        <input type="checkbox" bind:checked={includeDocuments} />
        <span>Документы и прочие файлы</span>
      </label>

      <label class="check-row">
        <input type="checkbox" bind:checked={includeMedia} />
        <span>Аудио и видео</span>
      </label>
    </div>

    <p class="hint">Архив будет содержать <code>index.html</code> и папку <code>files</code> с выбранными вложениями.</p>

    <div class="actions">
      <button type="button" on:click={() => dispatch('close')}>Отмена</button>
      <button type="button" class="primary" disabled={exporting} on:click={handleSubmit}>
        {exporting ? 'Подготовка...' : 'Скачать архив'}
      </button>
    </div>
  </div>
</div>

<style>
  .modal-shell {
    position: fixed;
    inset: 0;
    z-index: 120;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    border: none;
    background: rgba(15, 23, 42, 0.52);
    padding: 0;
  }

  .modal {
    position: relative;
    z-index: 1;
    width: min(560px, calc(100vw - 32px));
    max-height: calc(100dvh - 32px);
    overflow: auto;
    border-radius: 18px;
    background: #fff;
    padding: 24px;
    box-shadow: 0 20px 48px rgba(15, 23, 42, 0.28);
  }

  h3 {
    margin: 0 0 18px;
    font-size: 20px;
    color: #0f172a;
  }

  .field-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 14px;
    color: #334155;
  }

  .field input {
    min-height: 42px;
    border: 1px solid #cbd5e1;
    border-radius: 12px;
    padding: 10px 12px;
    font: inherit;
  }

  .file-types {
    margin-top: 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    border-radius: 14px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
  }

  .file-types-title {
    font-size: 14px;
    font-weight: 600;
    color: #0f172a;
  }

  .check-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    color: #334155;
  }

  .hint {
    margin: 16px 0 0;
    font-size: 13px;
    color: #64748b;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 22px;
  }

  .actions button {
    min-height: 42px;
    border: none;
    border-radius: 12px;
    padding: 10px 16px;
    cursor: pointer;
    font: inherit;
    font-weight: 600;
    background: #e2e8f0;
    color: #334155;
  }

  .actions .primary {
    background: #2563eb;
    color: #fff;
  }

  .actions button:disabled {
    cursor: not-allowed;
    opacity: 0.7;
  }

  @media (max-width: 640px) {
    .field-grid {
      grid-template-columns: 1fr;
    }

    .actions {
      flex-direction: column;
    }
  }
</style>
