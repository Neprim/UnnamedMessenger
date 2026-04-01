<script lang="ts">
  import Router, { push } from 'svelte-spa-router';
  import { onDestroy, onMount } from 'svelte';
  import { auth } from './lib/stores';
  import { connectSSE, disconnectSSE } from './lib/sse';

  import Register from './routes/Register.svelte';
  import Login from './routes/Login.svelte';
  import ChatLayout from './routes/ChatLayout.svelte';

  const routes = {
    '/register': Register,
    '/login': Login,
    '/chats': ChatLayout,
    '/chats/:id': ChatLayout,
    '/': ChatLayout
  };

  let unsubscribe: (() => void) | undefined;

  onMount(async () => {
    await auth.loadFromStorage();

    const hasPrivateKey = sessionStorage.getItem('privateKey') !== null;
    const hasEncryptedKey = localStorage.getItem('encryptedPrivateKey') !== null;

    if (hasPrivateKey) {
      push('/chats');
    } else if (hasEncryptedKey) {
      push('/login');
    } else {
      push('/register');
    }

    unsubscribe = auth.subscribe((state) => {
      if (state.isAuthenticated && state.privateKey) {
        connectSSE();
      } else {
        disconnectSSE();
      }
    });
  });

  onDestroy(() => {
    unsubscribe?.();
    disconnectSSE();
  });
</script>

<Router {routes} />
