<script lang="ts">
  import { push } from 'svelte-spa-router';
  import * as crypto from '../lib/crypto';
  import { api } from '../lib/api';
  import { auth } from '../lib/stores';

  let username = '';
  let password = '';
  let loading = false;
  let error = '';

  async function handleLogin() {
    if (!username || !password) {
      error = 'Please fill all fields';
      return;
    }

    loading = true;
    error = '';

    try {
      const { salt, id } = await api.auth.login({ username, password });
      
      const encryptedPrivateKey = localStorage.getItem('encryptedPrivateKey');
      if (!encryptedPrivateKey) {
        error = 'No saved keys found. Please register first.';
        loading = false;
        return;
      }

      const saltBytes = Uint8Array.from(atob(salt), c => c.charCodeAt(0));
      const privateKey = await crypto.decryptPrivateKey(encryptedPrivateKey, password, saltBytes);

      const user = await api.users.me();
      const publicKey = await crypto.importPublicKey(user.publicKey);

      const exportedPrivateKey = await window.crypto.subtle.exportKey('pkcs8', privateKey);
      const privateKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(exportedPrivateKey)));
      localStorage.setItem('privateKey', privateKeyBase64);

      auth.setUser(
        { id: user.id, username: user.username, publicKey: user.publicKey },
        privateKey
      );

      push('/chats');
    } catch (e) {
      error = e instanceof Error ? e.message : 'Login failed';
    } finally {
      loading = false;
    }
  }
</script>

<div class="container">
  <h1>Login</h1>
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
    margin: 50px auto;
    padding: 20px;
  }
  h1 {
    text-align: center;
    margin-bottom: 30px;
  }
  .field {
    margin-bottom: 15px;
  }
  label {
    display: block;
    margin-bottom: 5px;
    font-weight: bold;
  }
  input {
    width: 100%;
    padding: 10px;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 14px;
  }
  button {
    width: 100%;
    padding: 12px;
    background: #2196F3;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 16px;
  }
  button:disabled {
    background: #ccc;
  }
  button:hover:not(:disabled) {
    background: #1976D2;
  }
  .error {
    color: red;
    margin-bottom: 10px;
  }
  .link {
    text-align: center;
    margin-top: 20px;
  }
  a {
    color: #2196F3;
  }
</style>