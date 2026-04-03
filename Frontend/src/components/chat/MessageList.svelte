<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { getSystemMessageContent, parseSystemMessage } from '../../lib/chat-helpers';
  import type { Message } from '../../lib/types';
  import Avatar from '../common/Avatar.svelte';

  interface MessageGroup {
    senderId: string;
    senderUsername: string;
    messages: Message[];
    isSystem: boolean;
  }

  export let groupedMessages: MessageGroup[] = [];
  export let currentUserId: string | undefined;
  export let showPlaceholder = false;
  export let unreadMarkerId: string | null | undefined = null;
  export let container: HTMLDivElement | undefined;
  export let memberAvatarUrls: Record<string, string | null | undefined> = {};
  export let fileDisplayById: Record<
    string,
    {
      status: 'loading' | 'ready' | 'missing' | 'error';
      name?: string;
      type?: string;
      size?: number;
      sizeLabel?: string;
      deletedAt?: number | null;
      previewDataUrl?: string;
      previewWidth?: number;
      previewHeight?: number;
    }
  > = {};
  export let imagePreviewById: Record<
    string,
    {
      objectUrl: string;
      width: number;
      height: number;
      alt: string;
    }
  > = {};
  export let fileAssetById: Record<
    string,
    {
      objectUrl: string;
      type: string;
      name: string;
      updatedAt: number;
    }
  > = {};

  const dispatch = createEventDispatcher<{
    scroll: Event;
    messagecontextmenu: { event: MouseEvent; messageId: string; senderId: string | null };
    fileclick: { fileId: string; messageFileIds: string[] };
    replyclick: { messageId: string };
  }>();

  function getAttachmentPreview(fileIds: string[]) {
    const names = fileIds
      .map((fileId) => fileDisplayById[fileId]?.name?.trim() || '')
      .filter(Boolean);

    if (names.length === 0) {
      return 'Вложение';
    }

    return names.join(', ');
  }

  function getReplyPreviewText(message: Message) {
    if (!message.reply) {
      return '';
    }

    if (message.reply.isDeleted) {
      return 'Сообщение удалено';
    }

    if (message.reply.content?.trim()) {
      return message.reply.content;
    }

    if (message.reply.fileIds.length > 0) {
      return getAttachmentPreview(message.reply.fileIds);
    }

    return 'Сообщение';
  }
</script>

<div class="messages" bind:this={container} on:scroll={(event) => dispatch('scroll', event)}>
  {#if showPlaceholder}
    <div class="load-more-placeholder">Загрузка...</div>
  {/if}

  {#each groupedMessages as group}
    {#if group.isSystem}
      {@const systemData = parseSystemMessage(group.messages[0].content || '')}
      <div class="system-message">
        <span class="system-content">{getSystemMessageContent(systemData)}</span>
        <span class="system-time" title={new Date(group.messages[0].timestamp * 1000).toLocaleString()}>
          {new Date(group.messages[0].timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    {:else}
      <div class="message-group">
        <div class="message-header">
          <Avatar
            name={group.senderUsername || 'Unknown'}
            src={group.senderId ? memberAvatarUrls[group.senderId] : null}
            size={28}
          />
          <span class="sender-name">{group.senderUsername || 'Unknown'}</span>
        </div>

        {#each group.messages as msg}
          {#if unreadMarkerId && msg.id === unreadMarkerId}
            <div class="unread-divider" role="separator" aria-label="Новые сообщения">
              <span class="unread-line"></span>
              <span class="unread-label">Новые сообщения</span>
              <span class="unread-line"></span>
            </div>
          {/if}

          <div class="message-row" class:own={msg.senderId === currentUserId}>
            <div
              class="message"
              class:file-only={!msg.content && msg.fileIds.length > 0}
              data-message-id={msg.id}
              role="button"
              tabindex="0"
              on:contextmenu={(event) => dispatch('messagecontextmenu', { event, messageId: msg.id, senderId: msg.senderId })}
            >
              <div class="message-body" class:own={msg.senderId === currentUserId} class:file-only={!msg.content && msg.fileIds.length > 0}>
                {#if msg.reply}
                  <button
                    type="button"
                    class="reply-preview"
                    class:deleted={msg.reply.isDeleted}
                    on:click|stopPropagation={() => dispatch('replyclick', { messageId: msg.reply!.id })}
                    title="Перейти к сообщению"
                  >
                    <span class="reply-preview-line" class:attachment-only={!msg.reply.isDeleted && !msg.reply.content?.trim() && msg.reply.fileIds.length > 0}>
                      <strong>{msg.reply.senderUsername}:</strong> {getReplyPreviewText(msg)}
                    </span>
                  </button>
                {/if}

                {#if msg.content}
                  <div class="message-text-area">
                    <div class="message-content">{msg.content}</div>
                  </div>
                {/if}

                {#if msg.fileIds.length > 0}
                  <div class="message-files" class:with-text={Boolean(msg.content)}>
                    {#each msg.fileIds as fileId}
                      {@const fileDisplay = fileDisplayById[fileId]}
                      {@const imagePreview = imagePreviewById[fileId]}
                      {@const fileAsset = fileAssetById[fileId]}

                      {#if fileDisplay?.status === 'ready' && imagePreview}
                        <button
                          type="button"
                          class="image-preview-button"
                          on:click={() => dispatch('fileclick', { fileId, messageFileIds: msg.fileIds })}
                          aria-label={`Открыть изображение ${imagePreview.alt}`}
                        >
                          <img
                            class="image-preview"
                            src={imagePreview.objectUrl}
                            alt={imagePreview.alt}
                            width={imagePreview.width}
                            height={imagePreview.height}
                          />
                        </button>
                      {:else if fileDisplay?.status === 'ready' && fileAsset && fileAsset.type.startsWith('video/')}
                        <!-- svelte-ignore a11y_media_has_caption -->
                        <video
                          class="video-preview"
                          controls
                          preload="metadata"
                          src={fileAsset.objectUrl}
                          title={fileDisplay.name || 'Видео'}
                        ></video>
                      {:else if fileDisplay?.status === 'ready' && fileAsset && fileAsset.type.startsWith('audio/')}
                        <audio
                          class="audio-preview"
                          controls
                          preload="metadata"
                          src={fileAsset.objectUrl}
                          title={fileDisplay.name || 'Аудио'}
                        ></audio>
                      {:else if fileDisplay?.type?.startsWith('image/') && fileDisplay.previewDataUrl}
                        <div
                          class="image-preview-fallback-wrap"
                          style={`width:${fileDisplay.previewWidth || 48}px;height:${fileDisplay.previewHeight || 48}px;`}
                        >
                          <img
                            class="image-preview image-preview-fallback"
                            src={fileDisplay.previewDataUrl}
                            alt={fileDisplay.name || 'Мини-превью вложения'}
                            width={fileDisplay.previewWidth || 48}
                            height={fileDisplay.previewHeight || 48}
                            style={`width:${fileDisplay.previewWidth || 48}px;height:${fileDisplay.previewHeight || 48}px;`}
                          />
                        </div>
                      {:else}
                        <button
                          type="button"
                          class="file-chip"
                          class:file-chip-missing={fileDisplay?.status === 'missing'}
                          title={fileDisplay?.type || fileId}
                          disabled={fileDisplay?.status !== 'ready'}
                          on:click={() => dispatch('fileclick', { fileId, messageFileIds: msg.fileIds })}
                        >
                          {#if fileDisplay?.status === 'ready'}
                            {fileDisplay.name}
                            {#if fileDisplay.sizeLabel}
                              ({fileDisplay.sizeLabel})
                            {/if}
                          {:else if fileDisplay?.status === 'loading'}
                            Загрузка файла...
                          {:else if fileDisplay?.status === 'missing'}
                            Файл удалён
                          {:else if fileDisplay?.status === 'error'}
                            Ошибка загрузки файла
                          {:else}
                            Файл {fileId.slice(0, 8)}
                          {/if}
                        </button>
                      {/if}
                    {/each}
                  </div>
                {/if}
              </div>
            </div>

            <span class="msg-time" title={new Date(msg.timestamp * 1000).toLocaleString()}>
              {new Date(msg.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {#if msg.editedAt}
                <span class="edited" title={new Date(msg.editedAt * 1000).toLocaleString()}>(изменено)</span>
              {/if}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  {/each}
</div>

<style>
  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }

  .load-more-placeholder {
    text-align: center;
    padding: 16px;
    color: #888;
  }

  .system-message {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 8px 16px;
    background: #f0f0f0;
    border-radius: 8px;
    color: #666;
    font-size: 13px;
    margin: 8px 0;
  }

  .system-content {
    flex: 1;
    text-align: center;
  }

  .system-time {
    font-size: 10px;
    color: #999;
    white-space: nowrap;
  }

  .message-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .unread-divider {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 12px 0 8px;
  }

  .unread-line {
    flex: 1;
    height: 2px;
    background: #d32f2f;
    border-radius: 999px;
  }

  .unread-label {
    color: #d32f2f;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .message-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
    padding: 0 4px;
  }

  .sender-name {
    font-weight: 600;
    font-size: 14px;
  }

  .message-row {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    align-self: flex-start;
    max-width: 55%;
    min-width: 0;
  }

  .message-row.own {
    align-self: flex-start;
  }

  .message {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
    min-width: 0;
  }

  .message-body {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    background: #f5f5f5;
    border-radius: 16px;
    border: none;
    min-width: 0;
  }

  .message-body.own {
    background: #e3f2fd;
  }

  .message-body.file-only {
    background: transparent;
    border-radius: 0;
  }

  .reply-preview {
    width: 100%;
    box-sizing: border-box;
    padding: 6px 12px 0;
    min-width: 0;
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .reply-preview-line {
    display: block;
    font-size: 11px;
    line-height: 1.25;
    color: #475569;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .reply-preview-line.attachment-only {
    font-style: italic;
  }

  .reply-preview.deleted .reply-preview-line {
    color: #94a3b8;
  }

  .message-text-area {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 14px;
    min-width: 0;
  }

  .message-body:not(.file-only) .message-text-area {
    border-bottom-left-radius: 8px;
    border-bottom-right-radius: 8px;
  }

  .message-content {
    overflow-wrap: anywhere;
    word-break: break-word;
    font-size: 15px;
    line-height: 1.4;
    min-width: 0;
  }

  .message-files {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 0;
  }

  .message-files.with-text {
    padding: 0 8px 8px;
  }

  .file-chip {
    display: inline-flex;
    align-items: center;
    padding: 4px 8px;
    border-radius: 999px;
    border: none;
    background: rgba(15, 23, 42, 0.08);
    color: #334155;
    font-size: 12px;
    cursor: pointer;
  }

  .file-chip-missing {
    background: rgba(220, 38, 38, 0.08);
    color: #b91c1c;
  }

  .file-chip:disabled {
    cursor: default;
    opacity: 0.85;
  }

  .image-preview-button {
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
    line-height: 0;
  }

  .image-preview {
    display: block;
    border-radius: 14px;
    object-fit: cover;
    box-shadow: 0 6px 16px rgba(15, 23, 42, 0.14);
    background: rgba(15, 23, 42, 0.04);
  }

  .image-preview-fallback-wrap {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 14px;
    overflow: hidden;
    background: rgba(15, 23, 42, 0.06);
    box-shadow: 0 6px 16px rgba(15, 23, 42, 0.08);
  }

  .image-preview-fallback {
    box-shadow: none;
    image-rendering: auto;
  }

  .video-preview {
    display: block;
    width: min(320px, 100%);
    max-height: 320px;
    border-radius: 14px;
    background: rgba(15, 23, 42, 0.92);
    box-shadow: 0 6px 16px rgba(15, 23, 42, 0.14);
  }

  .audio-preview {
    display: block;
    width: min(320px, calc(100vw - 120px));
    max-width: 100%;
  }

  .msg-time {
    font-size: 10px;
    color: #888;
    white-space: nowrap;
  }

  .edited {
    font-style: italic;
    color: #666;
    margin-left: 2px;
  }

  @media (max-width: 768px) {
    .messages {
      padding: 12px;
      gap: 12px;
    }

    .message-header {
      margin-bottom: 2px;
      padding: 0 2px;
    }

    .sender-name {
      font-size: 13px;
    }

    .message-row {
      max-width: 88%;
    }

    .message-text-area {
      padding: 9px 12px;
    }

    .message-content {
      font-size: 14px;
    }

    .message-files.with-text {
      padding: 0 6px 6px;
    }

    .image-preview,
    .image-preview-fallback-wrap {
      max-width: min(100%, 280px);
    }

    .video-preview {
      width: min(280px, calc(100vw - 88px));
      max-height: 240px;
    }

    .audio-preview {
      width: min(280px, calc(100vw - 88px));
    }

    .msg-time {
      font-size: 9px;
    }
  }
</style>
