<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte';

  export let value = '';
  export let disabled = false;
  export let sending = false;
  export let attachments: Array<{ id: string; name: string; size: number; uploading?: boolean }> = [];
  export let attachmentsDisabled = false;
  export let dragActive = false;
  export let resetToken = 0;
  export let maxLength = 8000;

  const dispatch = createEventDispatcher<{
    submit: void;
    pickfiles: { files: File[] };
    removeattachment: { id: string };
    openlibrary: void;
  }>();

  let fileInput: HTMLInputElement | null = null;
  let textareaElement: HTMLTextAreaElement | null = null;
  let showCharacterCount = false;
  let lastResetToken = 0;

  function getMaxTextareaHeight() {
    if (typeof window === 'undefined') {
      return 320;
    }

    return Math.max(200, Math.floor(window.innerHeight * 0.5));
  }

  function openFilePicker() {
    if (attachmentsDisabled) return;
    fileInput?.click();
  }

  function openLibrary() {
    if (attachmentsDisabled) return;
    dispatch('openlibrary');
  }

  function handleFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length > 0) {
      dispatch('pickfiles', { files });
    }
    input.value = '';
  }

  function handlePaste(event: ClipboardEvent) {
    if (attachmentsDisabled) return;

    const clipboardFiles = Array.from(event.clipboardData?.files ?? []);
    if (clipboardFiles.length > 0) {
      event.preventDefault();
      dispatch('pickfiles', { files: clipboardFiles });
    }
  }

  function submitMessage() {
    dispatch('submit');
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitMessage();
    }
  }

  function resizeTextarea() {
    if (!textareaElement) return;

    const maxHeight = getMaxTextareaHeight();
    textareaElement.style.height = 'auto';
    const reachedLimit = textareaElement.scrollHeight > maxHeight;
    textareaElement.style.height = `${Math.min(textareaElement.scrollHeight, maxHeight)}px`;
    textareaElement.style.overflowY = reachedLimit ? 'auto' : 'hidden';
    showCharacterCount = reachedLimit;
  }

  function resetTextarea() {
    showCharacterCount = false;
    if (!textareaElement) return;
    textareaElement.style.height = 'auto';
    textareaElement.style.overflowY = 'hidden';
  }

  $: if (resetToken !== lastResetToken) {
    lastResetToken = resetToken;
    tick().then(resetTextarea);
  }

  $: tick().then(resizeTextarea);
</script>

<form class="input-area" class:drag-active={dragActive} on:submit|preventDefault={submitMessage}>
  <input bind:this={fileInput} class="file-input" type="file" multiple on:change={handleFileChange} />
  <button class="attach-btn" type="button" on:click={openFilePicker} disabled={attachmentsDisabled} title="Прикрепить файл">+</button>
  <button class="library-btn" type="button" on:click={openLibrary} disabled={attachmentsDisabled} title="Выбрать из файлов чата">
    <span class="library-icon" aria-hidden="true">🖼</span>
    <span class="library-label">Из чата</span>
  </button>
  <textarea
    id="messageInput"
    bind:this={textareaElement}
    bind:value
    class="message-textarea"
    rows="1"
    placeholder="Введите сообщение..."
    disabled={disabled}
    on:paste={handlePaste}
    on:keydown={handleKeyDown}
    on:input={resizeTextarea}
  ></textarea>
  <button type="submit" disabled={disabled || (!value.trim() && attachments.length === 0)}>
    {sending ? '...' : 'Отправить'}
  </button>
</form>

{#if showCharacterCount}
  <div class="character-count" class:over-limit={value.length > maxLength}>{value.length}/{maxLength}</div>
{/if}

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
    align-items: flex-end;
    gap: 12px;
    padding: 16px 24px;
    border-top: 1px solid #e0e0e0;
    transition:
      background 0.18s ease,
      box-shadow 0.18s ease;
  }

  .input-area.drag-active {
    background: linear-gradient(180deg, rgba(219, 234, 254, 0.92), rgba(239, 246, 255, 0.98));
    box-shadow: inset 0 0 0 2px rgba(37, 99, 235, 0.22);
  }

  .attach-btn,
  .library-btn {
    width: 44px;
    min-width: 44px;
    height: 44px;
    border-radius: 22px;
    border: none;
    background: #eef2f7;
    color: #334155;
    cursor: pointer;
    line-height: 1;
    transition:
      background 0.18s ease,
      color 0.18s ease,
      transform 0.18s ease;
  }

  .input-area.drag-active .attach-btn,
  .input-area.drag-active .library-btn {
    background: #dbeafe;
    color: #1d4ed8;
    transform: translateY(-1px);
  }

  .attach-btn {
    font-size: 22px;
  }

  .library-btn {
    width: auto;
    min-width: 98px;
    padding: 0 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
  }

  .library-icon {
    font-size: 18px;
    line-height: 1;
  }

  .library-label {
    line-height: 1;
  }

  .message-textarea {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    max-height: 50vh;
    padding: 11px 20px;
    border: 1px solid #ddd;
    border-radius: 24px;
    font-size: 15px;
    line-height: 1.4;
    resize: none;
    overflow-y: hidden;
    font-family: inherit;
    transition:
      border-color 0.18s ease,
      box-shadow 0.18s ease,
      background 0.18s ease;
  }

  .message-textarea:focus {
    outline: none;
    border-color: #4caf50;
  }

  .input-area.drag-active .message-textarea {
    border-color: #2563eb;
    background: white;
    box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.12);
  }

  button[type='submit'] {
    padding: 14px 28px;
    min-height: 44px;
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

  .attach-btn:disabled,
  .library-btn:disabled {
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

  .character-count {
    padding: 6px 28px 0;
    text-align: right;
    font-size: 12px;
    line-height: 1;
    color: #64748b;
  }

  .character-count.over-limit {
    color: #dc2626;
    font-weight: 600;
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

  @media (max-width: 768px) {
    .input-area {
      gap: 8px;
      padding: 12px;
    }

    .attach-btn,
    .library-btn,
    .message-textarea,
    button[type='submit'] {
      min-height: 40px;
    }

    .attach-btn,
    .library-btn {
      width: 40px;
      height: 40px;
      min-width: 40px;
      border-radius: 20px;
    }

    .library-btn {
      padding: 0;
      gap: 0;
    }

    .library-label {
      display: none;
    }

    .library-icon {
      font-size: 17px;
    }

    .message-textarea {
      padding: 10px 16px;
      font-size: 14px;
      max-height: 50vh;
    }

    button[type='submit'] {
      padding: 12px 18px;
      font-size: 14px;
    }

    .attachments {
      gap: 6px;
      padding: 0 12px 12px;
    }

    .character-count {
      padding: 4px 16px 0;
      font-size: 11px;
    }

    .attachment-chip {
      max-width: 100%;
      padding: 7px 10px;
    }

    .attachment-name {
      max-width: 180px;
    }
  }
</style>
