interface StoredAvatarRecord {
  src: string;
  blob: Blob;
  cachedAt: number;
}

const DATABASE_NAME = 'unnamed-messenger-cache';
const DATABASE_VERSION = 2;
const STORE_NAME = 'avatars';

const runtimeAvatarUrls = new Map<string, string>();
const pendingLoads = new Map<string, Promise<string>>();

let dbPromise: Promise<IDBDatabase> | null = null;

function isDirectSource(src: string) {
  return src.startsWith('blob:') || src.startsWith('data:');
}

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'fileId' });
      }

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'src' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open avatar cache'));
  });

  return dbPromise;
}

function readAvatar(src: string): Promise<StoredAvatarRecord | null> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(src);

        request.onsuccess = () => resolve((request.result as StoredAvatarRecord | undefined) ?? null);
        request.onerror = () => reject(request.error ?? new Error('Failed to read cached avatar'));
      })
  );
}

function writeAvatar(record: StoredAvatarRecord): Promise<void> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.put(record);

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('Failed to cache avatar'));
      })
  );
}

function createRuntimeUrl(src: string, blob: Blob): string {
  const existing = runtimeAvatarUrls.get(src);
  if (existing) {
    return existing;
  }

  const objectUrl = URL.createObjectURL(blob);
  runtimeAvatarUrls.set(src, objectUrl);
  return objectUrl;
}

export async function getCachedAvatarUrl(src: string | null | undefined): Promise<string | null> {
  if (!src) {
    return null;
  }

  if (isDirectSource(src)) {
    return src;
  }

  const runtimeUrl = runtimeAvatarUrls.get(src);
  if (runtimeUrl) {
    return runtimeUrl;
  }

  const pending = pendingLoads.get(src);
  if (pending) {
    return pending;
  }

  const loadPromise = (async () => {
    const cached = await readAvatar(src);
    if (cached) {
      return createRuntimeUrl(src, cached.blob);
    }

    const response = await fetch(src, {
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error('Failed to load avatar');
    }

    const blob = await response.blob();
    await writeAvatar({
      src,
      blob,
      cachedAt: Date.now()
    });

    return createRuntimeUrl(src, blob);
  })();

  pendingLoads.set(src, loadPromise);

  try {
    return await loadPromise;
  } finally {
    pendingLoads.delete(src);
  }
}
