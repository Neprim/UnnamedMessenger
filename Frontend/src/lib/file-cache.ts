export interface CachedFileAsset {
  objectUrl: string;
  type: string;
  name: string;
  updatedAt: number;
}

interface StoredFileRecord {
  fileId: string;
  updatedAt: number;
  type: string;
  name: string;
  blob: Blob;
  lastAccessAt: number;
}

const DATABASE_NAME = 'unnamed-messenger-cache';
const DATABASE_VERSION = 1;
const STORE_NAME = 'files';

const runtimeAssets = new Map<string, CachedFileAsset>();
let dbPromise: Promise<IDBDatabase> | null = null;

function cacheKey(fileId: string) {
  return fileId;
}

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'fileId' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open file cache'));
  });

  return dbPromise;
}

function readRecord(fileId: string): Promise<StoredFileRecord | null> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(fileId);

        request.onsuccess = () => resolve((request.result as StoredFileRecord | undefined) ?? null);
        request.onerror = () => reject(request.error ?? new Error('Failed to read cached file'));
      })
  );
}

function writeRecord(record: StoredFileRecord): Promise<void> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.put(record);

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('Failed to cache file'));
      })
  );
}

function deleteRecord(fileId: string): Promise<void> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.delete(fileId);

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('Failed to remove cached file'));
      })
  );
}

function createRuntimeAsset(fileId: string, blob: Blob, type: string, name: string, updatedAt: number): CachedFileAsset {
  const objectUrl = URL.createObjectURL(blob);
  const asset = { objectUrl, type, name, updatedAt };
  runtimeAssets.set(cacheKey(fileId), asset);
  return asset;
}

export async function getCachedFile(fileId: string, updatedAt: number): Promise<CachedFileAsset | null> {
  const key = cacheKey(fileId);
  const runtimeAsset = runtimeAssets.get(key);
  if (runtimeAsset) {
    if (runtimeAsset.updatedAt === updatedAt) {
      return runtimeAsset;
    }

    URL.revokeObjectURL(runtimeAsset.objectUrl);
    runtimeAssets.delete(key);
  }

  const record = await readRecord(fileId);
  if (!record) {
    return null;
  }

  if (record.updatedAt !== updatedAt) {
    await deleteRecord(fileId);
    return null;
  }

  void writeRecord({
    ...record,
    lastAccessAt: Date.now()
  }).catch(() => {});

  return createRuntimeAsset(fileId, record.blob, record.type, record.name, record.updatedAt);
}

export async function cacheFile(
  fileId: string,
  blob: Blob,
  metadata: { type: string; name: string; updatedAt: number }
): Promise<CachedFileAsset> {
  const key = cacheKey(fileId);
  const existingRuntimeAsset = runtimeAssets.get(key);
  if (existingRuntimeAsset) {
    URL.revokeObjectURL(existingRuntimeAsset.objectUrl);
    runtimeAssets.delete(key);
  }

  await writeRecord({
    fileId,
    updatedAt: metadata.updatedAt,
    type: metadata.type,
    name: metadata.name,
    blob,
    lastAccessAt: Date.now()
  });

  return createRuntimeAsset(fileId, blob, metadata.type, metadata.name, metadata.updatedAt);
}

export async function invalidateCachedFile(fileId: string): Promise<void> {
  const key = cacheKey(fileId);
  const runtimeAsset = runtimeAssets.get(key);
  if (runtimeAsset) {
    URL.revokeObjectURL(runtimeAsset.objectUrl);
    runtimeAssets.delete(key);
  }

  await deleteRecord(fileId);
}
