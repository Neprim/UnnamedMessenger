<script lang="ts">
  import Router from 'svelte-spa-router';
  import { auth } from './lib/stores';
  import { onMount, onDestroy } from 'svelte';
  import { connectSSE, disconnectSSE } from './lib/sse';

  import Register from './routes/Register.svelte';
  import Login from './routes/Login.svelte';
  import ChatLayout from './routes/ChatLayout.svelte';

  const routes = {
    '/': Register,
    '/register': Register,
    '/login': Login,
    '/chats': ChatLayout,
    '/chats/:id': ChatLayout,
  };

  let unsubscribe: () => void;

  onMount(async () => {
    await auth.loadFromStorage();
    
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