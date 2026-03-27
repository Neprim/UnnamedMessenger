<script lang="ts">
  import Router, { push } from 'svelte-spa-router';
  import { auth } from './lib/stores';
  import { onMount, onDestroy } from 'svelte';
  import { connectSSE, disconnectSSE } from './lib/sse';

  import Register from './routes/Register.svelte';
  import Login from './routes/Login.svelte';
  import ChatLayout from './routes/ChatLayout.svelte';

  const routes = {
    '/register': Register,
    '/login': Login,
    '/chats': ChatLayout,
    '/chats/:id': ChatLayout,
    '/': ChatLayout,
  };

  let unsubscribe: () => void;

  onMount(async () => {
    await auth.loadFromStorage();
    
    const checkAuth = setInterval(() => {
      if (!$auth.isLoading) {
        clearInterval(checkAuth);
        
        const hasPrivateKey = sessionStorage.getItem('privateKey') !== null;
        const hasEncryptedKey = localStorage.getItem('encryptedPrivateKey') !== null;
        
        if (hasPrivateKey) {
          push('/chats');
        } else if (hasEncryptedKey) {
          push('/login');
        } else {
          push('/register');
        }
      }
    }, 50);
    
    setTimeout(() => {
      clearInterval(checkAuth);
      const hasPrivateKey = localStorage.getItem('privateKey') !== null;
      const hasEncryptedKey = localStorage.getItem('encryptedPrivateKey') !== null;
      if (!hasPrivateKey && !hasEncryptedKey) {
        push('/register');
      }
    }, 3000);
    
    unsubscribe = auth.subscribe(state => {
      if (state.isAuthenticated && state.privateKey) {
        connectSSE();
      } else {
        disconnectSSE();
      }
    });
  });

  onDestroy(() => {
    if (unsubscribe) unsubscribe();
    disconnectSSE();
  });
</script>

<Router {routes} />