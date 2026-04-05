import { getStoredAuthValue } from './auth-store';

const runtimeAvatarUrls = new Map<string, string>();
const pendingLoads = new Map<string, Promise<string>>();

function isDirectSource(src: string) {
  return src.startsWith('blob:') || src.startsWith('data:');
}

function getAuthHeaders() {
  const token = getStoredAuthValue('token');
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
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
    const response = await fetch(src, {
      headers: {
        ...getAuthHeaders()
      }
    });

    if (!response.ok) {
      throw new Error('Failed to load avatar');
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    runtimeAvatarUrls.set(src, objectUrl);
    return objectUrl;
  })();

  pendingLoads.set(src, loadPromise);

  try {
    return await loadPromise;
  } finally {
    pendingLoads.delete(src);
  }
}
