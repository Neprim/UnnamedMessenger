<script lang="ts">
  import ChatLayout from './ChatLayout.svelte';

  export let params: { id?: string } = {};
</script>

<ChatLayout {params} />
