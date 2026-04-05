const MUTED_CHATS_EVENT = 'unnamed-messenger:muted-chats-changed';

function getMutedChatsStorageKey(userId: string | null | undefined) {
  return userId ? `unnamed-messenger:muted-chats:${userId}` : null;
}

export function loadMutedChatIds(userId: string | null | undefined) {
  const storageKey = getMutedChatsStorageKey(userId);
  if (!storageKey || typeof localStorage === 'undefined') {
    return [];
  }

  try {
    const rawValue = localStorage.getItem(storageKey);
    if (!rawValue) {
      return [];
    }

    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((value): value is string => typeof value === 'string');
  } catch {
    return [];
  }
}

export function saveMutedChatIds(userId: string | null | undefined, chatIds: string[]) {
  const storageKey = getMutedChatsStorageKey(userId);
  if (!storageKey || typeof localStorage === 'undefined') {
    return;
  }

  const uniqueChatIds = [...new Set(chatIds)];

  try {
    localStorage.setItem(storageKey, JSON.stringify(uniqueChatIds));
  } catch {
    return;
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(MUTED_CHATS_EVENT, {
        detail: {
          userId,
          mutedChatIds: uniqueChatIds
        }
      })
    );
  }
}

export function subscribeMutedChatIds(
  userId: string | null | undefined,
  callback: (mutedChatIds: string[]) => void
) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<{ userId?: string; mutedChatIds?: string[] }>;
    if ((customEvent.detail?.userId ?? null) !== (userId ?? null)) {
      return;
    }

    callback(Array.isArray(customEvent.detail?.mutedChatIds) ? customEvent.detail!.mutedChatIds! : []);
  };

  window.addEventListener(MUTED_CHATS_EVENT, handler as EventListener);
  return () => window.removeEventListener(MUTED_CHATS_EVENT, handler as EventListener);
}
