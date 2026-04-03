<script lang="ts">
  import { push } from 'svelte-spa-router';
  import * as crypto from '../lib/crypto';
  import { api, setToken } from '../lib/api';
  import { auth } from '../lib/stores';
  import ProjectInfoModal from '../components/common/ProjectInfoModal.svelte';

  let username = '';
  let password = '';
  let loading = false;
  let error = '';
  let showProjectInfoModal = false;
  let showExportKeyPrompt = false;
  let exportingKey = false;
  let pendingRegisteredUsername = '';

  async function handleRegister() {
    if (!username || !password) {
      error = 'Заполните все поля';
      return;
    }

    loading = true;
    error = '';

    try {
      const { publicKey, privateKey } = await crypto.generateKeyPair();
      const publicKeyExport = await crypto.exportPublicKey(publicKey);

      const { id, salt, token } = await api.auth.register({
        username,
        password,
        publicKey: publicKeyExport
      });

      setToken(token);
      sessionStorage.setItem('token', token);

      const saltBytes = Uint8Array.from(atob(salt), (char) => char.charCodeAt(0));
      const encryptedPrivateKey = await crypto.encryptPrivateKey(privateKey, password, saltBytes);

      localStorage.setItem('encryptedPrivateKey', encryptedPrivateKey);

      const exportedPrivateKey = await window.crypto.subtle.exportKey('pkcs8', privateKey);
      const privateKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(exportedPrivateKey)));
      sessionStorage.setItem('privateKey', privateKeyBase64);
      sessionStorage.setItem('username', username);
      sessionStorage.setItem('publicKey', publicKeyExport);

      auth.setUser({ id, username, publicKey: publicKeyExport }, privateKey);
      pendingRegisteredUsername = username;
      showExportKeyPrompt = true;
    } catch (exception) {
      error = exception instanceof Error ? exception.message : 'Ошибка регистрации';
    } finally {
      loading = false;
    }
  }

  async function handleExportPrivateKey() {
    if (exportingKey) return;

    exportingKey = true;
    try {
      const encryptedPrivateKey = localStorage.getItem('encryptedPrivateKey');
      if (!encryptedPrivateKey) {
        throw new Error('Зашифрованный приватный ключ не найден');
      }

      const blob = new Blob([encryptedPrivateKey], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `private_key_${pendingRegisteredUsername || 'user'}.key`;
      link.click();
      URL.revokeObjectURL(url);

      showExportKeyPrompt = false;
      push('/chats');
    } catch (exception) {
      error = exception instanceof Error ? exception.message : 'Не удалось экспортировать ключ';
      exportingKey = false;
      return;
    }

    exportingKey = false;
  }

  function continueWithoutExport() {
    showExportKeyPrompt = false;
    push('/chats');
  }
</script>

<div class="container">
  <button class="info-btn" type="button" on:click={() => (showProjectInfoModal = true)}>О проекте</button>
  <h1>Регистрация</h1>

  <form on:submit|preventDefault={handleRegister}>
    <div class="field">
      <label for="username">Имя пользователя</label>
      <input type="text" id="username" bind:value={username} maxlength="30" disabled={loading} />
    </div>
    <div class="field">
      <label for="password">Пароль</label>
      <input type="password" id="password" bind:value={password} disabled={loading} />
    </div>
    {#if error}
      <p class="error">{error}</p>
    {/if}
    <button type="submit" disabled={loading}>
      {loading ? 'Регистрация...' : 'Зарегистрироваться'}
    </button>
  </form>

  <p class="link">Уже есть аккаунт? <a href="#/login">Войти</a></p>
</div>

{#if showProjectInfoModal}
  <ProjectInfoModal on:close={() => (showProjectInfoModal = false)} />
{/if}

{#if showExportKeyPrompt}
  <div class="modal-shell">
    <button class="modal-overlay" type="button" aria-label="Закрыть окно" on:click={continueWithoutExport}></button>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="export-key-title">
      <h3 id="export-key-title">Экспорт приватного ключа</h3>
      <p class="modal-copy">
        Регистрация завершена. Рекомендуется сразу сохранить приватный ключ в отдельный файл, чтобы можно было
        восстановить доступ на другом устройстве.
      </p>
      <div class="modal-actions">
        <button type="button" on:click={continueWithoutExport}>Продолжить без экспорта</button>
        <button type="button" class="primary" on:click={handleExportPrivateKey} disabled={exportingKey}>
          {exportingKey ? 'Экспорт...' : 'Экспортировать ключ'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .container {
    position: relative;
    max-width: 400px;
    margin: 100px auto;
    padding: 40px;
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  }

  .info-btn {
    position: absolute;
    top: 16px;
    right: 16px;
    width: auto;
    padding: 8px 12px;
    background: #e2e8f0;
    color: #334155;
    border: none;
    border-radius: 999px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
  }

  h1 {
    text-align: center;
    margin-bottom: 30px;
  }

  .field {
    margin-bottom: 20px;
  }

  label {
    display: block;
    margin-bottom: 8px;
    font-weight: 600;
  }

  input {
    width: 100%;
    padding: 12px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 15px;
    box-sizing: border-box;
  }

  input:focus {
    outline: none;
    border-color: #4caf50;
  }

  button[type='submit'] {
    width: 100%;
    padding: 14px;
    background: #4caf50;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 16px;
    font-weight: 600;
  }

  button[type='submit']:disabled {
    background: #ccc;
  }

  button[type='submit']:hover:not(:disabled) {
    background: #45a049;
  }

  .error {
    color: #f44336;
    margin-bottom: 15px;
    text-align: center;
  }

  .link {
    text-align: center;
    margin-top: 25px;
    color: #666;
  }

  a {
    color: #4caf50;
    font-weight: 600;
  }

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
    background: rgba(15, 23, 42, 0.48);
  }

  .modal {
    position: relative;
    z-index: 1;
    width: min(520px, calc(100vw - 32px));
    padding: 24px;
    border-radius: 18px;
    background: white;
    box-shadow: 0 24px 56px rgba(15, 23, 42, 0.22);
  }

  .modal h3 {
    margin: 0 0 12px;
    font-size: 24px;
  }

  .modal-copy {
    margin: 0 0 18px;
    color: #475569;
    line-height: 1.5;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }

  .modal-actions button {
    width: auto;
    min-width: 0;
    padding: 12px 16px;
    border: none;
    border-radius: 10px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
  }

  .modal-actions button:first-child {
    background: #e2e8f0;
    color: #334155;
  }

  .modal-actions .primary {
    background: #4caf50;
    color: white;
  }
</style>
