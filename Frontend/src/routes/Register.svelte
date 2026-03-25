<script lang="ts">
  import { push } from 'svelte-spa-router';
  import * as crypto from '../lib/crypto';
  import { api } from '../lib/api';
  import { auth } from '../lib/stores';

  let username = '';
  let password = '';
  let loading = false;
  let error = '';

  async function handleRegister() {
    if (!username || !password) {
      error = 'Please fill all fields';
      return;
    }

    loading = true;
    error = '';

    try {
      const { publicKey, privateKey } = await crypto.generateKeyPair();
      const publicKeyExport = await crypto.exportPublicKey(publicKey);

      const { salt } = await api.auth.register({
        username,
        password,
        publicKey: publicKeyExport
      });

      const saltBytes = Uint8Array.from(atob(salt), c => c.charCodeAt(0));
      const encoder = new TextEncoder();
      const encryptedPrivateKey = await crypto.encryptPrivateKey(privateKey, password, saltBytes);

      localStorage.setItem('encryptedPrivateKey', encryptedPrivateKey);

      const exportedPrivateKey = await window.crypto.subtle.exportKey('pkcs8', privateKey);
      const privateKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(exportedPrivateKey)));
      localStorage.setItem('privateKey', privateKeyBase64);
      
      auth.setUser(
        { id: '', username, publicKey: publicKeyExport },
        privateKey
      );

      push('/chats');
    } catch (e) {
      error = e instanceof Error ? e.message : 'Registration failed';
    } finally {
      loading = false;
    }
  }
</script>

<div class="container">
  <h1>Register</h1>
  <form on:submit|preventDefault={handleRegister}>
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
      {loading ? 'Registering...' : 'Register'}
    </button>
  </form>
  <p class="link">Already have an account? <a href="#/login">Login</a></p>
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
    background: #4CAF50;
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
    background: #45a049;
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
    color: #4CAF50;
  }
</style>