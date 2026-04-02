<script lang="ts">
  export let name = '';
  export let src: string | null | undefined = null;
  export let size = 40;
  export let alt = '';

  let imageFailed = false;

  $: initials = (name || '?').trim().charAt(0).toUpperCase();
  $: if (src) {
    imageFailed = false;
  }
  $: showImage = Boolean(src) && !imageFailed;
</script>

<div
  class="avatar"
  style={`width:${size}px;height:${size}px;font-size:${Math.max(12, Math.round(size * 0.42))}px;`}
  aria-label={alt || name || 'Avatar'}
>
  {#if showImage}
    <img src={src ?? undefined} alt={alt || name} on:error={() => (imageFailed = true)} />
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
