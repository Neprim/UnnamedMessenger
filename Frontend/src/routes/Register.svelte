<script lang="ts">
  import { push } from 'svelte-spa-router';
  import * as crypto from '../lib/crypto';
  import { api, setToken } from '../lib/api';
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

      const { salt, token } = await api.auth.register({
        username,
        password,
        publicKey: publicKeyExport
      });

      setToken(token);
      sessionStorage.setItem('token', token);

      const saltBytes = Uint8Array.from(atob(salt), c => c.charCodeAt(0));
      const encoder = new TextEncoder();
      const encryptedPrivateKey = await crypto.encryptPrivateKey(privateKey, password, saltBytes);

      localStorage.setItem('encryptedPrivateKey', encryptedPrivateKey);

      const exportedPrivateKey = await window.crypto.subtle.exportKey('pkcs8', privateKey);
      const privateKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(exportedPrivateKey)));
      sessionStorage.setItem('privateKey', privateKeyBase64);
      sessionStorage.setItem('username', username);
      sessionStorage.setItem('publicKey', publicKeyExport);
      
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
    border-color: #4CAF50;
  }
  button {
    width: 100%;
    padding: 14px;
    background: #4CAF50;
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
    color: #4CAF50;
    font-weight: 600;
  }
</style>