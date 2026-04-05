<script lang="ts">
  import Router, { push } from 'svelte-spa-router';
  import { onDestroy, onMount } from 'svelte';
  import { auth, chats } from './lib/stores';
  import { getStoredAuthValue } from './lib/auth-store';
  import { connectSSE, disconnectSSE, ensureSSEConnection, isSSEConnected } from './lib/sse';
  import { loadMutedChatIds, subscribeMutedChatIds } from './lib/chat-preferences';

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
  let sseWatchdog: ReturnType<typeof setInterval> | undefined;
  let faviconBlinkTimer: ReturnType<typeof setInterval> | undefined;
  let mutedChatIds: string[] = [];
  let mutedChatSubscriber: (() => void) | undefined;
  let trackedMutedUserId: string | null = null;
  let faviconBlinkOn = true;
  let lastFaviconHref: string | null = null;
  let unreadCount = 0;

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

  function updateFavicon(unreadCount: number) {
    if (typeof document === 'undefined') {
      return;
    }

    const fillColor = unreadCount > 0 && faviconBlinkOn ? '#dc2626' : '#94a3b8';
    const nextHref = createFaviconDataUrl(fillColor);
    if (lastFaviconHref === nextHref) {
      return;
    }

    const link = ensureFaviconLink();
    link.href = nextHref;
    lastFaviconHref = nextHref;
  }

  function syncUnreadIndicators() {
    if (typeof document === 'undefined') {
      return;
    }

    document.title = unreadCount > 0 ? `${unreadCount} непрочитанных | Безымянный гонец` : 'Безымянный гонец';
    updateFavicon(unreadCount);
  }

  function startUnreadBlinking() {
    if (faviconBlinkTimer) {
      return;
    }

    faviconBlinkTimer = setInterval(() => {
      faviconBlinkOn = !faviconBlinkOn;
      syncUnreadIndicators();
    }, 1000);
  }

  function stopUnreadBlinking() {
    if (faviconBlinkTimer) {
      clearInterval(faviconBlinkTimer);
      faviconBlinkTimer = undefined;
    }

    faviconBlinkOn = true;
  }

  function refreshMutedChatsSubscription() {
    const userId = $auth.user?.id ?? null;
    if (trackedMutedUserId === userId) {
      return;
    }

    mutedChatSubscriber?.();
    trackedMutedUserId = userId;
    mutedChatIds = loadMutedChatIds(userId);
    mutedChatSubscriber = subscribeMutedChatIds(userId, (nextMutedChatIds) => {
      mutedChatIds = nextMutedChatIds;
    });
  }

  $: if (typeof document !== 'undefined') {
    unreadCount = $chats
      .filter((chat) => !mutedChatIds.includes(chat.id))
      .reduce((sum, chat) => sum + (chat.unreadCount ?? 0), 0);
  }

  $: if (typeof document !== 'undefined') {
    refreshMutedChatsSubscription();
    if (unreadCount > 0) {
      startUnreadBlinking();
    } else {
      stopUnreadBlinking();
    }
    syncUnreadIndicators();
  }

  onMount(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        ensureSSEConnection();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    sseWatchdog = setInterval(() => {
      const hasToken = getStoredAuthValue('token') !== null;
      const hasPrivateKey = getStoredAuthValue('privateKey') !== null;
      if (hasToken && hasPrivateKey && !isSSEConnected()) {
        ensureSSEConnection();
      }
    }, 10000);

    (async () => {
      await auth.loadFromStorage();

      const hasPrivateKey = getStoredAuthValue('privateKey') !== null;
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
    })();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (sseWatchdog) {
        clearInterval(sseWatchdog);
      }
      if (faviconBlinkTimer) {
        clearInterval(faviconBlinkTimer);
      }
      mutedChatSubscriber?.();
    };
  });

  onDestroy(() => {
    unsubscribe?.();
    mutedChatSubscriber?.();
    if (sseWatchdog) {
      clearInterval(sseWatchdog);
    }
    if (faviconBlinkTimer) {
      clearInterval(faviconBlinkTimer);
    }
    disconnectSSE();
  });
</script>

<Router {routes} />
