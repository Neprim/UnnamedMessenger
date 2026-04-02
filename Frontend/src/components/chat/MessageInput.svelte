<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let value = '';
  export let disabled = false;
  export let sending = false;
  export let attachments: Array<{ id: string; name: string; size: number; uploading?: boolean }> = [];
  export let attachmentsDisabled = false;

  const dispatch = createEventDispatcher<{
    submit: void;
    pickfiles: { files: File[] };
    removeattachment: { id: string };
  }>();

  let fileInput: HTMLInputElement | null = null;

  function openFilePicker() {
    if (attachmentsDisabled) return;
    fileInput?.click();
  }

  function handleFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length > 0) {
      dispatch('pickfiles', { files });
    }
    input.value = '';
  }
</script>

<form class="input-area" on:submit|preventDefault={() => dispatch('submit')}>
  <input bind:this={fileInput} class="file-input" type="file" multiple on:change={handleFileChange} />
  <button class="attach-btn" type="button" on:click={openFilePicker} disabled={attachmentsDisabled} title="Прикрепить файл">
    +
  </button>
  <input
    id="messageInput"
    type="text"
    bind:value
    placeholder="Введите сообщение..."
    disabled={disabled}
  />
  <button type="submit" disabled={disabled || (!value.trim() && attachments.length === 0)}>
    {sending ? '...' : 'Отправить'}
  </button>
</form>

{#if attachments.length > 0}
  <div class="attachments">
    {#each attachments as attachment}
      <div class="attachment-chip">
        <span class="attachment-name">
          {attachment.name}
          {#if attachment.uploading}
            ...
          {/if}
        </span>
        <button
          type="button"
          class="attachment-remove"
          on:click={() => dispatch('removeattachment', { id: attachment.id })}
          disabled={attachment.uploading}
          aria-label="Удалить вложение"
        >
          ×
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .file-input {
    display: none;
  }

  .input-area {
    display: flex;
    gap: 12px;
    padding: 16px 24px;
    border-top: 1px solid #e0e0e0;
  }

  .attach-btn {
    width: 44px;
    min-width: 44px;
    border-radius: 22px;
    border: none;
    background: #eef2f7;
    color: #334155;
    cursor: pointer;
    font-size: 22px;
    line-height: 1;
  }

  input {
    flex: 1;
    padding: 14px 20px;
    border: 1px solid #ddd;
    border-radius: 24px;
    font-size: 15px;
  }

  input:focus {
    outline: none;
    border-color: #4caf50;
  }

  button {
    padding: 14px 28px;
    background: #4caf50;
    color: white;
    border: none;
    border-radius: 24px;
    cursor: pointer;
    font-size: 15px;
    font-weight: 500;
  }

  button:hover:not(:disabled) {
    background: #45a049;
  }

  button:disabled {
    background: #ccc;
    cursor: not-allowed;
  }

  .attach-btn:disabled {
    background: #e5e7eb;
    color: #9ca3af;
  }

  .attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 0 24px 12px;
    border-top: 1px solid #f1f5f9;
  }

  .attachment-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    padding: 8px 12px;
    border-radius: 999px;
    background: #eef2f7;
    color: #334155;
    font-size: 13px;
  }

  .attachment-name {
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .attachment-remove {
    width: 22px;
    height: 22px;
    min-width: 22px;
    padding: 0;
    border-radius: 50%;
    border: none;
    background: #dbe4ee;
    color: #334155;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
  }
</style>
