const STORAGE_KEY = 'chat-image-favorites';

type FavoriteMap = Record<string, string[]>;

function readFavorites(): FavoriteMap {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as FavoriteMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeFavorites(value: FavoriteMap) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function getFavoriteChatImageIds(chatId: string): string[] {
  return readFavorites()[chatId] ?? [];
}

export function toggleFavoriteChatImage(chatId: string, fileId: string): string[] {
  const favorites = readFavorites();
  const current = new Set(favorites[chatId] ?? []);

  if (current.has(fileId)) {
    current.delete(fileId);
  } else {
    current.add(fileId);
  }

  favorites[chatId] = Array.from(current);
  writeFavorites(favorites);
  return favorites[chatId];
}
