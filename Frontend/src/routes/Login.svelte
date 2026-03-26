<script lang="ts">
  import { push } from 'svelte-spa-router';
  import * as crypto from '../lib/crypto';
  import { api, setToken } from '../lib/api';
  import { auth } from '../lib/stores';

  let username = '';
  let password = '';
  let loading = false;
  let error = '';
  let keyFile: File | null = null;

  $: hasEncryptedKey = localStorage.getItem('encryptedPrivateKey') !== null;

  async function handleLogin() {
    if (!username || !password) {
      error = 'Please fill all fields';
      return;
    }

    loading = true;
    error = '';

    try {
      const { salt, id, token, publicKey } = await api.auth.login({ username, password });
      
      setToken(token);
      localStorage.setItem('token', token);
      localStorage.setItem('username', username);
      localStorage.setItem('publicKey', publicKey);

      const encryptedPrivateKey = localStorage.getItem('encryptedPrivateKey');
      if (!encryptedPrivateKey) {
        error = 'No saved keys found. Please register first.';
        loading = false;
        return;
      }

      const saltBytes = Uint8Array.from(atob(salt), c => c.charCodeAt(0));
      const privateKey = await crypto.decryptPrivateKey(encryptedPrivateKey, password, saltBytes);

      const publicKeyObj = await crypto.importPublicKey(publicKey);

      const exportedPrivateKey = await window.crypto.subtle.exportKey('pkcs8', privateKey);
      const privateKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(exportedPrivateKey)));
      localStorage.setItem('privateKey', privateKeyBase64);

      auth.setUser(
        { id, username, publicKey },
        privateKey
      );

      push('/chats');
    } catch (e) {
      error = e instanceof Error ? e.message : 'Login failed';
    } finally {
      loading = false;
    }
  }

  async function handleKeyUpload(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      localStorage.setItem('encryptedPrivateKey', content);
      hasEncryptedKey = true;
    } catch (e) {
      error = 'Failed to load key file';
    }
  }
</script>

<div class="container">
  <h1>Login</h1>
  {#if !hasEncryptedKey}
    <div class="warning-box">
      На этом устройстве не сохранён ключ. Вы можете загрузить ранее сохранённый файл ключа.
    </div>
    <div class="field">
      <label for="keyFile">Загрузить ключ</label>
      <input type="file" id="keyFile" accept=".key" on:change={handleKeyUpload} />
    </div>
  {/if}
  <form on:submit|preventDefault={handleLogin}>
    <div class="field">
      <label for="username">Username</label>
      <input type="text" id="username" bind:value={username} disabled={loading} />
    </div>
    <div class="field">
      <label for="password">Password</label>
      <input type="password" id="password" bind:value={password} disabled={loading} />
    </div>
    {#if error}
      <p class="error">{error}</p>
    {/if}
    <button type="submit" disabled={loading}>
      {loading ? 'Logging in...' : 'Login'}
    </button>
  </form>
  <p class="link">Don't have an account? <a href="#/register">Register</a></p>
</div>

<style>
  .container {
    max-width: 400px;
    margin: 100px auto;
    padding: 40px;
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
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
  }
  input:focus {
    outline: none;
    border-color: #2196F3;
  }
  button {
    width: 100%;
    padding: 14px;
    background: #2196F3;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 16px;
    font-weight: 600;
  }
  button:disabled {
    background: #ccc;
  }
  button:hover:not(:disabled) {
    background: #1976D2;
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
    color: #2196F3;
    font-weight: 600;
  }
  .warning-box {
    background: #fff3cd;
    border: 1px solid #ffc107;
    border-radius: 8px;
    padding: 14px;
    font-size: 14px;
    color: #856404;
    margin-bottom: 20px;
    text-align: center;
  }
</style>