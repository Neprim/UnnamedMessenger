<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { ChatMember, ChatType } from '../../lib/types';
  import Avatar from '../common/Avatar.svelte';

  export let members: ChatMember[] = [];
  export let isCreator = false;
  export let chatType: ChatType = 'gm';
  export let currentUserId: string | undefined;
  export let createdById: string | undefined;
  export let chatName = 'Чат';
  export let chatAvatarUrl: string | null | undefined = null;
  export let canAddMembers = false;
  export let attachmentCounts: { images: number; documents: number; media: number } = {
    images: 0,
    documents: 0,
    media: 0
  };
  export let blockedUserIds: string[] = [];

  const dispatch = createEventDispatcher<{
    close: void;
    remove: { userId: string };
    deleteChat: void;
    leaveChat: void;
    addMember: void;
    editAvatar: void;
    editName: void;
    exporthistory: void;
    openattachments: { kind: 'images' | 'documents' | 'media' };
    toggleblock: { userId: string };
  }>();

  $: chatKindLabel = chatType === 'pm' ? 'Личный чат' : 'Групповой чат';
  $: canEditChat = isCreator && chatType === 'gm';

  function formatLastSeen(value?: number | null) {
    if (!value) {
      return 'Последний раз в сети: неизвестно';
    }

    return `Последний раз в сети: ${new Date(value * 1000).toLocaleString('ru-RU')}`;
  }

  function getMemberRole(member: ChatMember) {
    if (member.id === createdById) {
      return 'Создатель';
    }

    if (member.id === currentUserId) {
      return 'Вы';
    }

    return 'Участник';
  }
</script>

<div class="modal-shell">
  <button class="modal-overlay" type="button" on:click={() => dispatch('close')} aria-label="Закрыть окно"></button>

  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="chat-details-title">
    <div class="chat-summary">
      {#if canEditChat}
        <button
          class="chat-avatar-trigger editable"
          type="button"
          aria-label="Изменить аватар чата"
          on:click={() => dispatch('editAvatar')}
        >
          <Avatar name={chatName} src={chatAvatarUrl} size={72} />
          <span class="edit-hint avatar-hint" aria-hidden="true">✎</span>
        </button>
      {:else}
        <div class="chat-avatar-trigger">
          <Avatar name={chatName} src={chatAvatarUrl} size={72} />
        </div>
      {/if}

      <div class="chat-summary-text">
        {#if canEditChat}
          <button
            class="chat-name-trigger editable"
            type="button"
            aria-label="Изменить название чата"
            on:click={() => dispatch('editName')}
          >
            <span id="chat-details-title" class="chat-title-text">{chatName}</span>
            <span class="edit-hint name-hint" aria-hidden="true">✎</span>
          </button>
        {:else}
          <div class="chat-name-trigger">
            <span id="chat-details-title" class="chat-title-text">{chatName}</span>
          </div>
        {/if}
        <p>
          {chatKindLabel}
          {#if chatType === 'gm'}
            · {members.length}
            {members.length === 1 ? ' участник' : members.length < 5 ? ' участника' : ' участников'}
          {/if}
        </p>
      </div>
    </div>

    <section class="section">
      <div class="section-header">
        <h4>Все вложения чата</h4>
      </div>

      <div class="media-grid">
        <button type="button" class="media-tile" on:click={() => dispatch('openattachments', { kind: 'images' })}>
          <strong>Изображения</strong>
          <span>{attachmentCounts.images}</span>
        </button>
        <button type="button" class="media-tile" on:click={() => dispatch('openattachments', { kind: 'documents' })}>
          <strong>Документы</strong>
          <span>{attachmentCounts.documents}</span>
        </button>
        <button type="button" class="media-tile" on:click={() => dispatch('openattachments', { kind: 'media' })}>
          <strong>Аудио и видео</strong>
          <span>{attachmentCounts.media}</span>
        </button>
      </div>
    </section>

    <section class="section">
      <div class="section-header">
        <h4>Участники</h4>
        {#if canAddMembers}
          <button class="link-action" type="button" on:click={() => dispatch('addMember')}>Добавить</button>
        {/if}
      </div>

      <div class="members-list">
        {#each members as member}
          <div class="member-item">
            <div class="member-main">
              <Avatar name={member.username} src={member.avatarUrl} size={40} />
              <div class="member-meta">
                <span class="member-name">{member.username}</span>
                <span class="member-role member-role-online">
                  <span class="member-status-dot" class:online={member.isOnline}></span>
                  <span>{member.isOnline ? 'В сети' : 'Не в сети'}</span>
                  <span>·</span>
                  <span>{getMemberRole(member)}</span>
                </span>
                <span class="member-last-seen">{member.isOnline ? 'Последний раз в сети: сейчас' : formatLastSeen(member.lastSeenAt)}</span>
              </div>
            </div>

            {#if isCreator && chatType === 'gm' && member.id !== currentUserId}
              <div class="member-actions">
                <button class="neutral-btn" type="button" on:click={() => dispatch('toggleblock', { userId: member.id })}>
                  {blockedUserIds.includes(member.id) ? 'Разблокировать' : 'Заблокировать'}
                </button>
                <button class="remove-btn" type="button" on:click={() => dispatch('remove', { userId: member.id })}>
                  Удалить
                </button>
              </div>
            {:else if member.id !== currentUserId}
              <button class="neutral-btn" type="button" on:click={() => dispatch('toggleblock', { userId: member.id })}>
                {blockedUserIds.includes(member.id) ? 'Разблокировать' : 'Заблокировать'}
              </button>
            {/if}
          </div>
        {/each}
      </div>
    </section>

    <section class="section">
      <div class="section-header">
        <h4>Действия</h4>
      </div>

      <div class="action-list">
        <button class="secondary-action" type="button" on:click={() => dispatch('exporthistory')}>Экспортировать историю</button>
        {#if chatType === 'gm' && !isCreator}
          <button class="secondary-action" type="button" on:click={() => dispatch('leaveChat')}>Покинуть чат</button>
        {/if}

        {#if chatType === 'pm'}
          <button class="danger-action" type="button" on:click={() => dispatch('deleteChat')}>Удалить чат</button>
        {:else if isCreator}
          <button class="danger-action" type="button" on:click={() => dispatch('deleteChat')}>Удалить чат</button>
        {/if}
      </div>
    </section>

    <div class="modal-actions">
      <button type="button" class="close-btn" on:click={() => dispatch('close')}>Закрыть</button>
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
    z-index: 100;
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.48);
    border: none;
    padding: 0;
    cursor: default;
  }

  .modal {
    position: relative;
    z-index: 1;
    width: min(740px, calc(100vw - 32px));
    max-height: min(88vh, 760px);
    overflow: auto;
    border-radius: 22px;
    padding: 28px;
    background:
      radial-gradient(circle at top right, rgba(14, 165, 233, 0.12), transparent 32%),
      radial-gradient(circle at bottom left, rgba(251, 191, 36, 0.1), transparent 30%),
      linear-gradient(180deg, #ffffff, #f8fafc);
    box-shadow: 0 24px 56px rgba(15, 23, 42, 0.24);
  }

  .chat-summary {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 24px;
  }

  .chat-avatar-trigger,
  .chat-name-trigger {
    border: none;
    background: transparent;
    padding: 0;
    margin: 0;
  }

  .chat-avatar-trigger {
    position: relative;
    display: inline-flex;
    border-radius: 50%;
    flex: none;
  }

  .chat-avatar-trigger.editable,
  .chat-name-trigger.editable {
    cursor: pointer;
  }

  .chat-summary-text {
    min-width: 0;
    flex: 1;
  }

  .chat-name-trigger {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
  }

  .chat-title-text {
    display: block;
    font-size: 24px;
    font-weight: 700;
    line-height: 1.1;
    color: #0f172a;
    overflow-wrap: anywhere;
    text-align: left;
  }

  .chat-summary-text p {
    margin: 8px 0 0;
    font-size: 14px;
    color: #64748b;
  }

  .edit-hint {
    opacity: 0;
    transform: translateY(2px);
    transition:
      opacity 0.16s ease,
      transform 0.16s ease;
  }

  .avatar-hint {
    position: absolute;
    right: 2px;
    bottom: 2px;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.88);
    color: white;
    font-size: 13px;
  }

  .name-hint {
    flex: none;
    font-size: 15px;
    color: #64748b;
  }

  .chat-avatar-trigger.editable:hover .edit-hint,
  .chat-name-trigger.editable:hover .edit-hint,
  .chat-avatar-trigger.editable:focus-visible .edit-hint,
  .chat-name-trigger.editable:focus-visible .edit-hint {
    opacity: 1;
    transform: translateY(0);
  }

  .section {
    margin-bottom: 24px;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .section-header h4 {
    margin: 0;
    font-size: 15px;
    color: #0f172a;
  }

  .media-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 12px;
  }

  .media-tile {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    min-height: 116px;
    padding: 16px;
    border-radius: 18px;
    border: 1px solid #dbe4ee;
    background:
      linear-gradient(135deg, rgba(255, 255, 255, 0.92), rgba(241, 245, 249, 0.96)),
      radial-gradient(circle at top right, rgba(148, 163, 184, 0.18), transparent 60%);
    color: #334155;
    text-align: left;
    cursor: pointer;
  }

  .media-tile strong {
    font-size: 15px;
  }

  .media-tile span {
    font-size: 28px;
    line-height: 1;
    font-weight: 700;
    color: #64748b;
  }

  .media-tile:hover {
    border-color: #bfdbfe;
    background:
      linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(219, 234, 254, 0.88)),
      radial-gradient(circle at top right, rgba(59, 130, 246, 0.16), transparent 60%);
  }

  .link-action {
    border: none;
    padding: 0;
    background: transparent;
    color: #2563eb;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
  }

  .members-list {
    border: 1px solid #e2e8f0;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.82);
    overflow: hidden;
  }

  .member-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border-bottom: 1px solid #eef2f7;
  }

  .member-item:last-child {
    border-bottom: none;
  }

  .member-main {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex: 1;
  }

  .member-meta {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .member-name {
    font-size: 15px;
    color: #0f172a;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .member-role-online {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    font-size: 12px;
    color: #64748b;
  }

  .member-last-seen {
    font-size: 12px;
    color: #94a3b8;
  }

  .member-status-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: #dc2626;
    flex: none;
  }

  .member-status-dot.online {
    background: #16a34a;
  }

  .remove-btn {
    border: none;
    border-radius: 10px;
    padding: 8px 12px;
    background: #fee2e2;
    color: #b91c1c;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    flex: none;
  }

  .member-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .neutral-btn {
    border: none;
    border-radius: 10px;
    padding: 8px 12px;
    background: #e2e8f0;
    color: #334155;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    flex: none;
  }

  .neutral-btn:hover {
    background: #cbd5e1;
  }

  .remove-btn:hover {
    background: #fecaca;
  }

  .action-list {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .secondary-action,
  .danger-action,
  .close-btn {
    border: none;
    border-radius: 12px;
    padding: 11px 16px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
  }

  .secondary-action {
    background: #e2e8f0;
    color: #334155;
  }

  .secondary-action:hover {
    background: #cbd5e1;
  }

  .danger-action {
    background: #fee2e2;
    color: #b91c1c;
  }

  .danger-action:hover {
    background: #fecaca;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 28px;
  }

  .close-btn {
    background: #0f172a;
    color: white;
  }

  .close-btn:hover {
    background: #1e293b;
  }

  @media (max-width: 768px) {
    .modal-shell {
      align-items: flex-end;
      padding: 16px;
    }

    .modal {
      width: min(100%, 560px);
      max-height: calc(100dvh - 32px);
      padding: 20px;
      border-radius: 18px;
    }

    .chat-summary {
      align-items: flex-start;
    }

    .chat-title-text {
      font-size: 21px;
    }

    .media-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .media-tile {
      min-height: 96px;
      padding: 14px;
    }

    .media-tile span {
      font-size: 24px;
    }

    .member-item {
      flex-direction: column;
      align-items: stretch;
    }

    .remove-btn,
    .neutral-btn {
      width: 100%;
      min-height: 42px;
    }

    .action-list > button,
    .modal-actions > button {
      width: 100%;
      min-height: 44px;
    }
  }

  @media (max-width: 480px) {
    .chat-summary {
      flex-direction: column;
      gap: 12px;
    }

    .chat-avatar-trigger {
      align-self: flex-start;
    }

    .media-grid {
      grid-template-columns: 1fr;
    }

    .section-header {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
