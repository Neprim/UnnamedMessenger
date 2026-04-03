<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  interface UserFileListItem {
    id: string;
    name: string;
    type: string;
    size: number;
    sizeLabel: string;
    updatedAt: number;
    deletedAt: number | null;
    isAvatar?: boolean;
    previewDataUrl?: string;
  }

  interface UserFileGroup {
    chatId: string;
    chatName: string;
    totalSizeLabel: string;
    fileCount: number;
    totalSizeBytes: number;
    files: UserFileListItem[];
  }

  export let loading = false;
  export let quotaBytes = 0;
  export let usedBytes = 0;
  export let inaccessibleBytes = 0;
  export let deletingInaccessible = false;
  export let groups: UserFileGroup[] = [];

  const dispatch = createEventDispatcher<{
    close: void;
    openfile: { fileId: string };
    openchat: { chatId: string };
    deleteinaccessible: void;
    deletefile: { fileId: string };
  }>();

  let collapsedChatIds = new Set<string>();

  $: collapsedChatIds = new Set(groups.map((group) => group.chatId));

  function formatMegabytes(bytes: number) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  }

  function toggleGroup(chatId: string) {
    const next = new Set(collapsedChatIds);
    if (next.has(chatId)) {
      next.delete(chatId);
    } else {
      next.add(chatId);
    }
    collapsedChatIds = next;
  }
</script>

<div class="modal-shell">
  <button class="modal-overlay" type="button" on:click={() => dispatch('close')} aria-label="Закрыть окно"></button>
  <div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="user-files-title">
    <div class="modal-header">
      <div>
        <h3 id="user-files-title">Мои файлы</h3>
        <p>Все ваши загруженные файлы в чатах, где вы сейчас состоите.</p>
      </div>
      <button class="close-btn" type="button" on:click={() => dispatch('close')}>Закрыть</button>
    </div>

    <div class="quota-card">
      <div class="quota-line">
        <strong>Использовано</strong>
        <span>{formatMegabytes(usedBytes)} / {formatMegabytes(quotaBytes)}</span>
      </div>
      <div class="quota-bar">
        <span class="quota-fill" style={`width:${quotaBytes > 0 ? Math.min(100, (usedBytes / quotaBytes) * 100) : 0}%`}></span>
      </div>
    </div>

    {#if loading}
      <div class="empty-state">Загрузка файлов...</div>
    {:else if groups.length === 0}
      <div class="empty-state">У вас пока нет файлов в доступных чатах.</div>
    {:else}
      <div class="group-list">
        {#each groups as group}
          {@const isCollapsed = collapsedChatIds.has(group.chatId)}
          <section class="group-card">
            <div class="group-header">
              <button class="group-toggle" type="button" on:click={() => toggleGroup(group.chatId)}>
                <span class="group-arrow" class:collapsed={isCollapsed}>⌄</span>
                <div class="group-heading">
                  <h4>{group.chatName}</h4>
                  <p>{group.fileCount} файлов · {group.totalSizeLabel}</p>
                </div>
              </button>
              <button class="link-btn" type="button" on:click={() => dispatch('openchat', { chatId: group.chatId })}>
                Открыть чат
              </button>
            </div>

            {#if !isCollapsed}
              <div class="file-list">
                {#each group.files as file}
                  <div class="file-row">
                    <button class="file-main" type="button" on:click={() => dispatch('openfile', { fileId: file.id })}>
                      <div class="file-preview">
                        {#if file.previewDataUrl && file.type.startsWith('image/')}
                          <img src={file.previewDataUrl} alt={file.name} />
                        {:else}
                          <div class="file-icon">{file.type.startsWith('audio/') || file.type.startsWith('video/') ? '▶' : '≡'}</div>
                        {/if}
                      </div>
                      <div class="file-meta">
                        <div class="file-title-row">
                          <strong>{file.name}</strong>
                          {#if file.isAvatar}
                            <span class="badge">Аватар</span>
                          {/if}
                          {#if file.deletedAt}
                            <span class="badge muted">Заглушка</span>
                          {/if}
                        </div>
                        <span>{file.type} · {file.sizeLabel}</span>
                      </div>
                    </button>
                    <button class="ghost-btn active" type="button" on:click={() => dispatch('deletefile', { fileId: file.id })}>Удалить</button>
                  </div>
                {/each}
              </div>
            {/if}
          </section>
        {/each}
      </div>

      {#if inaccessibleBytes > 0}
        <div class="inaccessible-summary">
          <div class="inaccessible-copy">
            <strong>Файлы в чатах, где вы больше не состоите</strong>
            <span>{formatMegabytes(inaccessibleBytes)}</span>
          </div>
          <button class="danger-btn" type="button" disabled={deletingInaccessible} on:click={() => dispatch('deleteinaccessible')}>
            {deletingInaccessible ? 'Удаление...' : 'Удалить все'}
          </button>
        </div>
      {/if}
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
    z-index: 115;
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    border: none;
    padding: 0;
    background: rgba(15, 23, 42, 0.5);
  }

  .modal.wide {
    position: relative;
    z-index: 1;
    width: min(980px, calc(100vw - 32px));
    max-height: min(88vh, 820px);
    overflow: auto;
    border-radius: 18px;
    background: #fff;
    box-shadow: 0 24px 56px rgba(15, 23, 42, 0.24);
    padding: 24px;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 18px;
  }

  .modal-header h3 {
    margin: 0 0 6px;
    font-size: 24px;
  }

  .modal-header p {
    margin: 0;
    color: #64748b;
    font-size: 14px;
  }

  .close-btn,
  .link-btn,
  .ghost-btn {
    border: none;
    border-radius: 10px;
    cursor: pointer;
    font-weight: 600;
  }

  .close-btn {
    padding: 10px 14px;
    background: #e2e8f0;
    color: #334155;
  }

  .quota-card,
  .inaccessible-summary {
    padding: 16px;
    border-radius: 16px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
  }

  .quota-card {
    margin-bottom: 18px;
  }

  .quota-line,
  .inaccessible-copy {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 14px;
    color: #334155;
  }

  .quota-line {
    margin-bottom: 10px;
  }

  .inaccessible-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .quota-bar {
    height: 10px;
    border-radius: 999px;
    background: #e2e8f0;
    overflow: hidden;
  }

  .quota-fill {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, #3b82f6, #10b981);
  }

  .group-list {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin-bottom: 16px;
  }

  .group-card {
    border: 1px solid #e2e8f0;
    border-radius: 16px;
    padding: 16px;
    background: #fff;
  }

  .group-header {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: center;
  }

  .group-toggle {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0;
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .group-arrow {
    font-size: 18px;
    color: #64748b;
    transition: transform 0.16s ease;
  }

  .group-arrow.collapsed {
    transform: rotate(-90deg);
  }

  .group-heading h4 {
    margin: 0 0 4px;
    font-size: 18px;
    color: #0f172a;
  }

  .group-heading p {
    margin: 0;
    color: #64748b;
    font-size: 13px;
  }

  .link-btn {
    padding: 9px 12px;
    background: #eff6ff;
    color: #1d4ed8;
  }

  .file-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 12px;
  }

  .file-row {
    display: flex;
    gap: 10px;
    align-items: stretch;
    min-width: 0;
  }

  .file-main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    background: #f8fafc;
    cursor: pointer;
    text-align: left;
  }

  .file-main:hover {
    background: #f1f5f9;
  }

  .file-preview,
  .file-icon {
    width: 40px;
    height: 40px;
    flex: none;
    border-radius: 12px;
    overflow: hidden;
    background: #e2e8f0;
  }

  .file-preview {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .file-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .file-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
  }

  .file-meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .file-title-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
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

  .badge {
    padding: 3px 8px;
    border-radius: 999px;
    background: #dbeafe;
    color: #1d4ed8;
    font-size: 11px;
    font-weight: 700;
  }

  .badge.muted {
    background: #e2e8f0;
    color: #475569;
  }

  .ghost-btn {
    flex: 0 0 auto;
    min-width: 92px;
    padding: 0 14px;
    background: #f8fafc;
    color: #94a3b8;
    border: 1px solid #e2e8f0;
    cursor: not-allowed;
  }

  .ghost-btn.active {
    color: #b91c1c;
    border-color: #fecaca;
    background: #fff5f5;
    cursor: pointer;
  }

  .danger-btn {
    border: none;
    border-radius: 10px;
    padding: 10px 14px;
    background: #fee2e2;
    color: #b91c1c;
    cursor: pointer;
    font-weight: 700;
    white-space: nowrap;
  }

  .danger-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .empty-state {
    padding: 48px 12px;
    text-align: center;
    color: #64748b;
    font-size: 14px;
  }

  @media (max-width: 768px) {
    .file-row {
      flex-wrap: wrap;
    }

    .ghost-btn {
      min-height: 42px;
      padding: 10px 14px;
    }

    .file-meta strong,
    .file-meta span {
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
  }
</style>
