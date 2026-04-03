<script lang="ts">
  import Router, { push } from 'svelte-spa-router';
  import { onDestroy, onMount } from 'svelte';
  import { auth, chats } from './lib/stores';
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
  let lastFaviconState: 'unread' | 'idle' | null = null;

  function ensureFaviconLink() {
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.type = 'image/svg+xml';
    return link;
  }

  function createFaviconDataUrl(fillColor: string) {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r="26" fill="${fillColor}" />
      </svg>
    `.trim();

    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  function updateFavicon(hasUnread: boolean) {
    if (typeof document === 'undefined') return;

    const nextState = hasUnread ? 'unread' : 'idle';
    if (lastFaviconState === nextState) return;

    const link = ensureFaviconLink();
    link.href = createFaviconDataUrl(hasUnread ? '#dc2626' : '#94a3b8');
    lastFaviconState = nextState;
  }

  $: if (typeof document !== 'undefined') {
    document.title = 'Безымянный гонец';
    updateFavicon($chats.some((chat) => (chat.unreadCount ?? 0) > 0));
  }

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
