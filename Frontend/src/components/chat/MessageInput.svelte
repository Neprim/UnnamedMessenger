<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let value = '';
  export let disabled = false;
  export let sending = false;

  const dispatch = createEventDispatcher<{ submit: void }>();
</script>

<form class="input-area" on:submit|preventDefault={() => dispatch('submit')}>
  <input
    id="messageInput"
    type="text"
    bind:value
    placeholder="Введите сообщение..."
    disabled={disabled}
  />
  <button type="submit" disabled={disabled || !value.trim()}>
    {sending ? '...' : 'Отправить'}
  </button>
</form>

<style>
  .input-area {
    display: flex;
    gap: 12px;
    padding: 16px 24px;
    border-top: 1px solid #e0e0e0;
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
</style>
