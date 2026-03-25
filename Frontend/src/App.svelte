<script lang="ts">
  import Router from 'svelte-spa-router';
  import { auth } from './lib/stores';
  import { onMount } from 'svelte';

  import Register from './routes/Register.svelte';
  import Login from './routes/Login.svelte';
  import Chats from './routes/Chats.svelte';
  import Chat from './routes/Chat.svelte';

  const routes = {
    '/': Register,
    '/register': Register,
    '/login': Login,
    '/chats': Chats,
    '/chat/:id': Chat
  };

  onMount(async () => {
    await auth.loadFromStorage();
  });
</script>

<Router {routes} />