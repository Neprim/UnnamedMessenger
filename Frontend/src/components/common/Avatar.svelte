<script lang="ts">
  import { getCachedAvatarUrl } from '../../lib/avatar-cache';

  export let name = '';
  export let src: string | null | undefined = null;
  export let size = 40;
  export let alt = '';

  let imageFailed = false;
  let resolvedSrc: string | null = null;
  let loadVersion = 0;

  $: initials = (name || '?').trim().charAt(0).toUpperCase();
  $: if (src) {
    imageFailed = false;
    void resolveAvatarSource(src);
  } else {
    resolvedSrc = null;
  }
  $: showImage = Boolean(resolvedSrc) && !imageFailed;

  async function resolveAvatarSource(nextSrc: string) {
    const version = ++loadVersion;

    try {
      const cachedUrl = await getCachedAvatarUrl(nextSrc);
      if (version !== loadVersion || nextSrc !== src) {
        return;
      }

      resolvedSrc = cachedUrl ?? nextSrc;
    } catch {
      if (version !== loadVersion || nextSrc !== src) {
        return;
      }

      resolvedSrc = nextSrc;
    }
  }
</script>

<div
  class="avatar"
  style={`width:${size}px;height:${size}px;font-size:${Math.max(12, Math.round(size * 0.42))}px;`}
  aria-label={alt || name || 'Avatar'}
>
  {#if showImage}
    <img src={resolvedSrc ?? undefined} alt={alt || name} loading="lazy" decoding="async" on:error={() => (imageFailed = true)} />
  {:else}
    <span>{initials}</span>
  {/if}
</div>

<style>
  .avatar {
    border-radius: 50%;
    overflow: hidden;
    background: linear-gradient(135deg, #4caf50, #2e7d32);
    color: white;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    flex-shrink: 0;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
</style>
