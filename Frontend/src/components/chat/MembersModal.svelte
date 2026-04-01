<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { ChatMember, ChatType } from '../../lib/types';

  export let members: ChatMember[] = [];
  export let isCreator = false;
  export let chatType: ChatType = 'gm';
  export let currentUserId: string | undefined;

  const dispatch = createEventDispatcher<{
    close: void;
    remove: { userId: string };
    deleteChat: void;
  }>();
</script>

<div class="modal-shell">
  <button class="modal-overlay" type="button" on:click={() => dispatch('close')} aria-label="Закрыть окно"></button>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="members-title">
    <h3 id="members-title">Участники</h3>
    <div class="members-list">
      {#each members as member}
        <div class="member-item">
          <span class="member-name">{member.username}</span>
          {#if isCreator && chatType === 'gm' && member.id !== currentUserId}
            <button class="remove-btn" type="button" on:click={() => dispatch('remove', { userId: member.id })}>Удалить</button>
          {/if}
        </div>
      {/each}
    </div>
    <div class="modal-actions">
      {#if chatType === 'pm'}
        <button class="delete-chat-btn" type="button" on:click={() => dispatch('deleteChat')}>Удалить чат</button>
      {:else if isCreator && members.length === 1}
        <button class="delete-chat-btn" type="button" on:click={() => dispatch('deleteChat')}>Удалить чат</button>
      {/if}
      <button type="button" on:click={() => dispatch('close')}>Закрыть</button>
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
    background: rgba(0, 0, 0, 0.5);
    border: none;
    padding: 0;
    cursor: default;
  }

  .modal {
    position: relative;
    background: white;
    padding: 28px;
    border-radius: 14px;
    width: 400px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
    z-index: 1;
  }

  h3 {
    margin: 0 0 20px;
    font-size: 18px;
  }

  .members-list {
    max-height: 300px;
    overflow-y: auto;
  }

  .member-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px;
    border-bottom: 1px solid #eee;
  }

  .member-name {
    font-size: 15px;
  }

  .remove-btn {
    padding: 6px 12px;
    background: #f44336;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
  }

  .remove-btn:hover {
    background: #d32f2f;
  }

  .modal-actions {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    margin-top: 20px;
  }

  button {
    padding: 10px 20px;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
  }

  .delete-chat-btn {
    background: #f44336;
    color: white;
    margin-right: auto;
  }
</style>
