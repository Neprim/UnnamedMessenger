<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import * as crypto from '../lib/crypto';
  import { api, type Message } from '../lib/api';
  import { auth, chats, type Chat } from '../lib/stores';
  import { sseMessage } from '../lib/sse';

  const INITIAL_LOAD_COUNT = 20;
  const LOAD_MORE_COUNT = 50;

  export let params: { id: string };
  export let chatDetail: any = null;

  let messages: Message[] = [];
  let loading = true;
  let error = '';
  let newMessage = '';
  let sending = false;
  let chatKey: CryptoKey | null = null;
  let showAddMemberModal = false;
  let showMembersModal = false;
  let userSearch = '';
  let searchResults: { id: string; username: string; publicKey: string }[] = [];
  let searching = false;
  let addingMember = false;
  let otherUserName: string | null = null;
  let contextMenu: { x: number; y: number; messageId: string; senderId: string; visible: boolean } = { x: 0, y: 0, messageId: '', senderId: '', visible: false };
  let editingMessage: { id: string; content: string } | null = null;
  let editingText = '';
  let messagesContainer: HTMLElement;
  let placeholderEl: HTMLElement;
  let isLoadingMore = false;
  let hasReachedBeginning = false;
  let showPlaceholder = false;
  let scrollHandlerEnabled = true;
  let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastReadAt = 0;
  $: isCreator = chatDetail?.createdBy === $auth.user?.id;
  $: chatMessages = $chats.find((c: any) => c.id === params.id)?.messages || [];

  function handleContainerScroll() {
    if (!messagesContainer) return;
    
    const scrollTop = messagesContainer.scrollTop;
    const scrollHeight = messagesContainer.scrollHeight;
    const clientHeight = messagesContainer.clientHeight;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    
    // Получить unreadCount напрямую из store
    const chat = $chats.find((c: any) => c.id === params.id);
    const unreadCount = chat?.unreadCount || 0;
    
    // Если внизу и есть непрочитанные - отметить как прочитанные
    if (isAtBottom && unreadCount > 0) {
      api.chats.markAsRead(params.id);
      chats.clearUnread(params.id);
    }
    
    // Load more messages when scrolled to top
    if (scrollHandlerEnabled && !isLoadingMore && !hasReachedBeginning && showPlaceholder && scrollTop < 100) {
      if (scrollTimeout) clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        loadMoreMessages();
      }, 300);
    }
  }

  function handleContextMenu(e: MouseEvent, messageId: string, senderId: string) {
    e.preventDefault();
    let x = e.clientX;
    let y = e.clientY;
    contextMenu = {
      x,
      y,
      messageId,
      senderId,
      visible: true
    };
    requestAnimationFrame(() => {
      const menuEl = document.querySelector('.context-menu') as HTMLElement;
      if (menuEl) {
        const rect = menuEl.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
          contextMenu.x = window.innerWidth - rect.width - 10;
          contextMenu = contextMenu;
        }
        if (rect.bottom > window.innerHeight) {
          contextMenu.y = window.innerHeight - rect.height - 10;
          contextMenu = contextMenu;
        }
      }
    });
  }

  function closeContextMenu() {
    contextMenu = { x: 0, y: 0, messageId: '', senderId: '', visible: false };
  }

  $: isOwnMessage = contextMenu.senderId === $auth.user?.id;

  let groupedMessages: { senderId: string; senderUsername: string; messages: Message[]; isSystem: boolean }[] = [];

  function groupMessages(msgs: Message[], members: any[]): typeof groupedMessages {
    const memberMap = members ? new Map(members.map((m: any) => [m.id, m.username])) : new Map();
    const groups: typeof groupedMessages = [];
    let currentGroup: typeof groupedMessages[0] | null = null;

    for (const msg of msgs) {
      const isSystem = msg.senderId === null || msg.senderId === undefined || msg.senderId === 'null';
      if (isSystem) {
        if (currentGroup) {
          groups.push(currentGroup);
          currentGroup = null;
        }
        groups.push({
          senderId: 'system',
          senderUsername: 'System',
          messages: [msg],
          isSystem: true
        });
        continue;
      }

      // Использовать senderUsername из сообщения (приоритет), затем из members
      const msgSenderUsername = (msg as any).senderUsername;
      const senderUsername = msgSenderUsername || memberMap.get(msg.senderId) || 'Unknown';
      const timestamp = new Date(msg.timestamp).getTime();

      if (currentGroup && currentGroup.senderId === msg.senderId) {
        const lastMsgTime = new Date(currentGroup.messages[currentGroup.messages.length - 1].timestamp).getTime();
        if (timestamp - lastMsgTime < 5 * 60 * 1000) {
          currentGroup.messages.push(msg);
          continue;
        }
      }

      if (currentGroup) {
        groups.push(currentGroup);
      }

      currentGroup = {
        senderId: msg.senderId,
        senderUsername,
        messages: [msg],
        isSystem: false
      };
    }

    if (currentGroup) {
      groups.push(currentGroup);
    }

    return groups;
  }

  $: if (chatDetail?.members) {
    groupedMessages = groupMessages(messages, chatDetail.members);
  }

  async function handleDeleteFromMenu() {
    if (contextMenu.messageId) {
      await handleDeleteMessage(contextMenu.messageId);
    }
    closeContextMenu();
  }

  function handleEditFromMenu(msg: Message) {
    editingMessage = { id: msg.id, content: msg.content };
    editingText = msg.content;
    closeContextMenu();
  }

  async function handleEditMessage() {
    if (!editingMessage || !editingText.trim() || !chatKey) return;
    try {
      const encryptedContent = await crypto.encryptMessage(chatKey, editingText);
      const updated = await api.messages.edit(editingMessage.id, encryptedContent);
      messages = messages.map(m => m.id === updated.id ? { ...m, content: editingText, editedAt: updated.editedAt } : m);
      
      // Update lastMessage if edited message was the last
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.id === updated.id) {
        const sender = chatDetail?.members?.find((m: any) => m.id === lastMsg.senderId);
        chats.updateChat(params.id, {
          lastMessage: {
            senderId: lastMsg.senderId,
            content: editingText,
            senderUsername: sender?.username || '',
            isSystem: false
          }
        });
      }
      
      editingMessage = null;
      editingText = '';
    } catch (e) {
      
    }
  }

  function cancelEdit() {
    editingMessage = null;
    editingText = '';
  }

  async function loadMoreMessages() {
    if (isLoadingMore || hasReachedBeginning || !messagesContainer) return;
    const oldestMsg = messages[0];
    if (!oldestMsg) return;
    
    // Всегда получать актуальный chatKey из store
    let currentChatKey: CryptoKey | null = null;
    const chatFromStore = $chats.find((c: any) => c.id === params.id);
    currentChatKey = chatFromStore?.chatKey || null;
    
    // Также пробуем расшифровать из currentMember если в store нет
    if (!currentChatKey && chatDetail?.members && $auth.privateKey) {
      const currentMember = chatDetail.members.find((m: any) => m.id === $auth.user?.id);
      if (currentMember?.encryptedKey) {
        try {
          currentChatKey = await crypto.decryptChatKeyWithPrivateKey(currentMember.encryptedKey, $auth.privateKey);
        } catch (e) {
          
        }
      }
    }
    
    // Обновить локальную переменную и store
    chatKey = currentChatKey;
    if (chatKey) {
      chats.setChatKey(params.id, chatKey);
    }
    
    isLoadingMore = true;
    scrollHandlerEnabled = false;
    
    const scrollHeightBefore = messagesContainer.scrollHeight;
    const scrollTopBefore = messagesContainer.scrollTop;
    
    try {
      const result = await api.chats.getMessages(params.id, { cursor: oldestMsg.id, limit: LOAD_MORE_COUNT });
      
      if (result.messages.length > 0) {
        // Check if we reached the beginning (chat_created message)
        const newOldest = result.messages[0];
        if (newOldest && newOldest.senderId === null) {
          try {
            const parsed = JSON.parse(newOldest.content || '{}');
            if (parsed.event === 'chat_created') {
              hasReachedBeginning = true;
            }
          } catch {}
        }
        
        if (currentChatKey) {
          const memberMap = new Map(chatDetail?.members?.map((m: any) => [m.id, m.username]) || []);
          const decrypted = await Promise.all(
            result.messages.map(async (msg: any) => {
              const isSystem = msg.senderId === null || msg.senderId === undefined || msg.senderId === 'null';
              if (isSystem) return msg;
              const senderUsername = memberMap.get(msg.senderId) || 'Unknown';
              try {
                const decryptedContent = await crypto.decryptMessage(currentChatKey!, msg.content);
                return { ...msg, content: decryptedContent, senderUsername };
              } catch {
                return { ...msg, content: '[Decryption failed]', senderUsername };
              }
            })
          );
          messages = [...decrypted, ...messages];
          chats.addMessages(params.id, decrypted, true);
        } else {
          const memberMap = new Map(chatDetail?.members?.map((m: any) => [m.id, m.username]) || []);
          const msgsWithUsername = result.messages.map((msg: any) => {
            if (msg.senderId === null) return msg;
            return { ...msg, senderUsername: memberMap.get(msg.senderId) || 'Unknown' };
          });
          messages = [...msgsWithUsername, ...messages];
          chats.addMessages(params.id, msgsWithUsername, true);
        }
        
        // Update placeholder visibility
        showPlaceholder = !hasReachedBeginning;
        
        // Maintain scroll position
        requestAnimationFrame(() => {
          if (messagesContainer) {
            const scrollHeightAfter = messagesContainer.scrollHeight;
            const scrollDiff = scrollHeightAfter - scrollHeightBefore;
            messagesContainer.scrollTop = scrollTopBefore + scrollDiff;
          }
        });
      }
    } catch (e) {
      
    } finally {
      isLoadingMore = false;
      scrollHandlerEnabled = true;
    }
  }

  let initialized = false;

  let unsubscribeSSE: () => void;

  onMount(() => {
    const checkAuth = setInterval(() => {
      if (!$auth.isLoading) {
        initialized = true;
        clearInterval(checkAuth);
      }
    }, 50);

    setTimeout(() => {
      clearInterval(checkAuth);
      initialized = true;
    }, 5000);

    unsubscribeSSE = sseMessage.subscribe(async event => {
      if (!event) return;
      
      if (event.chatId !== params.id) {
        return;
      }
      
      const msg = event.message;
      
      if (msg.editedAt) {
        if (chatKey) {
          crypto.decryptMessage(chatKey, msg.content).then(decrypted => {
            messages = messages.map(m => m.id === msg.id ? { ...m, content: decrypted, editedAt: msg.editedAt } : m);
            
            // Update lastMessage in chat list
            const lastMsg = messages[messages.length - 1];
            if (lastMsg && lastMsg.id === msg.id) {
              const sender = chatDetail?.members?.find((m: any) => m.id === lastMsg.senderId);
              chats.updateChat(params.id, {
                lastMessage: {
                  senderId: lastMsg.senderId,
                  content: decrypted,
                  senderUsername: sender?.username || '',
                  isSystem: false
                }
              });
            }
          }).catch(err => {
            
            messages = messages.map(m => m.id === msg.id ? { ...m, content: '[Decryption failed]', editedAt: msg.editedAt } : m);
          });
        }
      } else {
        // Check if this is a new message or delete
        const existingMsg = messages.find(m => m.id === msg.id);
        if (existingMsg) {
          // Delete message
          const wasLastMessage = messages[messages.length - 1]?.id === msg.id;
          messages = messages.filter(m => m.id !== msg.id);
          
          // Update lastMessage in chat list if deleted message was the last
          if (wasLastMessage) {
            // Load previous message
            if (chatKey) {
              try {
                const result = await api.chats.getMessages(params.id, 20);
                if (result.messages && result.messages.length > 0) {
                  const lastMsg = result.messages[result.messages.length - 1];
                  if (lastMsg.senderId === null) {
                    const parsed = JSON.parse(lastMsg.content || '{}');
                    const systemContent = parsed.event === 'chat_created' ? 'Чат создан' : 
                                          parsed.event === 'member_added' ? `${parsed.username} добавлен в чат` :
                                          parsed.event === 'member_removed' ? `${parsed.username} удалён из чата` :
                                          parsed.event === 'member_left' ? `${parsed.username} покинул чат` : '';
                    chats.updateChat(params.id, {
                      lastMessage: { senderId: null, content: systemContent, isSystem: true }
                    });
                  } else {
                    const decrypted = await crypto.decryptMessage(chatKey, lastMsg.content);
                    const sender = chatDetail?.members?.find((m: any) => m.id === lastMsg.senderId);
                    chats.updateChat(params.id, {
                      lastMessage: { senderId: lastMsg.senderId, content: decrypted, senderUsername: sender?.username || '', isSystem: false }
                    });
                  }
                } else {
                  chats.updateChat(params.id, { lastMessage: null });
                }
              } catch (e) {
                
                chats.updateChat(params.id, { lastMessage: null });
              }
            } else {
              chats.updateChat(params.id, { lastMessage: null });
            }
          }
        } else {
          // New message - use handleNewEvent
          handleNewEvent(msg);
        }
      }
      
      sseMessage.set(null);
    });
  });

  onDestroy(() => {
    if (unsubscribeSSE) unsubscribeSSE();
    if (scrollTimeout) clearTimeout(scrollTimeout);
  });

  function getSystemMessageContent(event: string, data: any): string {
    if (event === 'chat_created') return 'Чат создан';
    if (event === 'member_added') return `${data.username} добавлен в чат`;
    if (event === 'member_removed') return `${data.username} удалён из чата`;
    if (event === 'member_left') return `${data.username} покинул чат`;
    return '';
  }

  async function handleNewEvent(message: Message) {
    // Ensure chatDetail is loaded for username lookup
    if (!chatDetail) {
      chatDetail = await api.chats.get(params.id);
    }
    
    const isSystem = message.senderId === null || message.senderId === undefined || message.senderId === 'null';
    const isOwnMessage = message.senderId === $auth.user?.id;
    
    if (isSystem) {
      const parsed = JSON.parse(message.content || '{}');
      messages = [...messages, message];
      chats.addMessages(params.id, [message], false);
      
      const systemContent = getSystemMessageContent(parsed.event, parsed);
      
      chats.updateChat(params.id, {
        lastMessage: {
          senderId: null,
          content: systemContent,
          isSystem: true
        }
      });
    } else if (chatKey) {
      try {
        const decryptedContent = await crypto.decryptMessage(chatKey, message.content);
        const currentUser = chatDetail?.members?.find((m: any) => m.id === message.senderId);
        const senderUsername = currentUser?.username || 'Unknown';
        const decryptedMessage = { ...message, content: decryptedContent, senderUsername };
        messages = [...messages, decryptedMessage];
        chats.addMessages(params.id, [decryptedMessage], false);
        
        chats.updateChat(params.id, {
          lastMessage: {
            senderId: message.senderId,
            content: decryptedContent,
            senderUsername: senderUsername,
            isSystem: false
          }
        });
      } catch {
        const currentUser = chatDetail?.members?.find((m: any) => m.id === message.senderId);
        const senderUsername = currentUser?.username || 'Unknown';
        const failedMessage = { ...message, content: '[Decryption failed]', senderUsername };
        messages = [...messages, failedMessage];
        chats.addMessages(params.id, [failedMessage], false);
      }
    } else {
      // No chatKey yet, add message as-is with username lookup
      const currentUser = chatDetail?.members?.find((m: any) => m.id === message.senderId);
      const senderUsername = currentUser?.username || 'Unknown';
      const msgWithUsername = { ...message, senderUsername };
      messages = [...messages, msgWithUsername];
      chats.addMessages(params.id, [msgWithUsername], false);
    }
    requestAnimationFrame(() => {
      const container = document.querySelector('.messages') as HTMLElement;
      if (container) container.scrollTop = container.scrollHeight;
    });
  }

  $: if (initialized && params.id) {
    loadChat();
  }

  async function loadChat() {
    loading = true;
    error = '';
    isLoadingMore = false;
    hasReachedBeginning = false;
    
    if (messagesContainer) messagesContainer.scrollTop = 0;

    if (!$auth.privateKey || $auth.isLoading) {
      loading = false;
      return;
    }

    try {
      const chatDetailData = chatDetail || await api.chats.get(params.id);
      chatDetail = chatDetailData;
      
      const currentMember = chatDetailData?.members?.find((m: any) => m.id === $auth.user?.id);
      
      // Use messages from $chats store if available, otherwise load from API
      const chatFromStore = $chats.find((c: any) => c.id === params.id);
      
      // Всегда пытаться получить или расшифровать chatKey
      if (chatFromStore?.chatKey) {
        chatKey = chatFromStore.chatKey;
      } else if (currentMember && $auth.privateKey && currentMember.encryptedKey) {
        // Пробуем расшифровать
        try {
          chatKey = await crypto.decryptChatKeyWithPrivateKey(currentMember.encryptedKey, $auth.privateKey);
          // Сохраняем в store для будущих использований
          if (chatKey) {
            chats.setChatKey(params.id, chatKey);
          }
        } catch (e) {
          
        }
      }
      
      if (chatMessages.length > 0) {
        messages = chatMessages;
      } else {
        const result = await api.chats.getMessages(params.id, { limit: INITIAL_LOAD_COUNT });
        messages = result.messages;
        
        // Decrypt messages only when loading from API (not from store)
        if (chatKey) {
          const memberMap = new Map(chatDetail?.members?.map((m: any) => [m.id, m.username]) || []);
          messages = await Promise.all(
            messages.map(async (msg: any) => {
              const isSystem = msg.senderId === null || msg.senderId === undefined || msg.senderId === 'null';
              if (isSystem) return msg;
              const senderUsername = memberMap.get(msg.senderId) || 'Unknown';
              try {
                return { ...msg, content: await crypto.decryptMessage(chatKey!, msg.content), senderUsername };
              } catch {
                return { ...msg, content: '[Decryption failed]', senderUsername };
              }
            })
          );
        }
      }
      
      lastReadAt = currentMember?.lastReadAt || 0;
      
      // Check if we reached the beginning (chat_created message)
      const oldestMsg = messages[0];
      if (oldestMsg && oldestMsg.senderId === null) {
        try {
          const parsed = JSON.parse(oldestMsg.content || '{}');
          if (parsed.event === 'chat_created') {
            hasReachedBeginning = true;
          }
        } catch {}
      }
      
      // Show placeholder if we haven't reached the beginning
      showPlaceholder = !hasReachedBeginning;
      
      // Update lastMessage in chat list
      if (messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg.senderId === null) {
          const parsed = JSON.parse(lastMsg.content || '{}');
          const systemContent = parsed.event === 'chat_created' ? 'Чат создан' : 
                                parsed.event === 'member_added' ? `${parsed.username} добавлен в чат` :
                                parsed.event === 'member_removed' ? `${parsed.username} удалён из чата` :
                                parsed.event === 'member_left' ? `${parsed.username} покинул чат` : '';
          chats.updateChat(params.id, { lastMessage: { senderId: null, content: systemContent, isSystem: true } });
        } else {
          try {
            const sender = chatDetail?.members?.find((m: any) => m.id === lastMsg.senderId);
            chats.updateChat(params.id, { lastMessage: { senderId: lastMsg.senderId, content: lastMsg.content, senderUsername: sender?.username || 'Unknown', isSystem: false } });
          } catch {
            chats.updateChat(params.id, { lastMessage: { senderId: lastMsg.senderId, content: '[Decryption failed]', senderUsername: 'Unknown', isSystem: false } });
          }
        }
      }
       
      // Scroll to bottom after load
      setTimeout(() => {
        if (messagesContainer) {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
      }, 100);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Не удалось загрузить чат';
    } finally {
      loading = false;
    }
  }

  async function handleSendMessage() {
    if (!newMessage.trim() || !chatKey || sending) return;
    sending = true;

    try {
      const encryptedContent = await crypto.encryptMessage(chatKey, newMessage);
      const message = await api.chats.sendMessage(params.id, encryptedContent);
      const newMsg = { ...message, content: newMessage };
      messages = [...messages, newMsg];
      chats.addMessages(params.id, [newMsg], false);
      
      chats.updateChat(params.id, {
        lastMessage: {
          senderId: $auth.user?.id || '',
          content: newMessage,
          senderUsername: $auth.user?.username || 'Me',
          isSystem: false
        }
      });
      
      newMessage = '';
      requestAnimationFrame(() => {
        const container = document.querySelector('.messages') as HTMLElement;
        if (container) container.scrollTop = container.scrollHeight;
        (document.getElementById('messageInput') as HTMLInputElement)?.focus();
      });
    } catch (e) {
      error = e instanceof Error ? e.message : 'Не удалось отправить сообщение';
    } finally {
      sending = false;
    }
  }

  async function handleDeleteMessage(messageId: string) {
    try {
      await api.messages.delete(messageId);
      const wasLastMessage = messages[messages.length - 1]?.id === messageId;
      messages = messages.filter(m => m.id !== messageId);
      
      // Update lastMessage if deleted message was the last
      if (wasLastMessage) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg) {
          if (lastMsg.senderId === null) {
            const parsed = JSON.parse(lastMsg.content || '{}');
            const systemContent = parsed.event === 'chat_created' ? 'Чат создан' : 
                                  parsed.event === 'member_added' ? `${parsed.username} добавлен в чат` :
                                  parsed.event === 'member_removed' ? `${parsed.username} удалён из чата` :
                                  parsed.event === 'member_left' ? `${parsed.username} покинул чат` : '';
            chats.updateChat(params.id, {
              lastMessage: { senderId: null, content: systemContent, isSystem: true }
            });
          } else {
            const sender = chatDetail?.members?.find((m: any) => m.id === lastMsg.senderId);
            chats.updateChat(params.id, {
              lastMessage: {
                senderId: lastMsg.senderId,
                content: lastMsg.content,
                senderUsername: sender?.username || '',
                isSystem: false
              }
            });
          }
        } else {
          chats.updateChat(params.id, { lastMessage: null });
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Не удалось удалить сообщение';
    }
  }

  async function searchUsers() {
    if (!userSearch.trim()) {
      searchResults = [];
      return;
    }
    searching = true;
    try {
      searchResults = await api.users.search(userSearch);
    } catch (e) {
      searchResults = [];
    } finally {
      searching = false;
    }
  }

  async function addMember(userId: string) {
    if (!chatKey) return;
    addingMember = true;
    try {
      const userData = searchResults.find(u => u.id === userId);
      if (!userData) return;

      const publicKey = await crypto.importPublicKey(userData.publicKey);
      const encryptedKey = await crypto.encryptChatKeyWithPublicKey(chatKey, publicKey);
      
      await api.chats.addMember(params.id, userId, encryptedKey);
      
      chatDetail = await api.chats.get(params.id);
      showAddMemberModal = false;
      userSearch = '';
      searchResults = [];
    } catch (e) {
      error = e instanceof Error ? e.message : 'Не удалось добавить участника';
    } finally {
      addingMember = false;
    }
  }

  async function removeMember(userId: string) {
    try {
      await api.chats.removeMember(params.id, userId);
      chatDetail = await api.chats.get(params.id);
      showMembersModal = false;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Не удалось удалить участника';
    }
  }

  async function handleLeaveChat() {
    if (!confirm('Вы уверены, что хотите покинуть этот чат?')) return;
    try {
      await api.chats.leave(params.id);
      window.location.hash = '#/chats';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Не удалось покинуть чат';
    }
  }

  async function handleDeleteChat() {
    if (!confirm('Вы уверены, что хотите удалить этот чат?')) return;
    try {
      await api.chats.delete(params.id);
      window.location.hash = '#/chats';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Не удалось удалить чат';
    }
  }
</script>

<div class="chat-container">
  <header>
    <h2>
      {#if chatDetail?.type === 'pm' && otherUserName}
        {otherUserName}
      {:else}
        {chatDetail?.name || 'Чат'}
      {/if}
    </h2>
    {#if chatKey}
      <div class="header-actions">
        <button class="icon-btn" on:click={() => showMembersModal = true} title="Участники">👥</button>
        {#if isCreator && chatDetail?.type === 'gm'}
          <button class="icon-btn" on:click={() => showAddMemberModal = true} title="Добавить участника">+</button>
        {:else if chatDetail?.type === 'gm'}
          <button class="icon-btn leave-btn" on:click={handleLeaveChat} title="Покинуть чат">🚪</button>
        {/if}
      </div>
    {/if}
  </header>

  {#if loading}
    <div class="loading">Загрузка...</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else}
    <div class="messages" bind:this={messagesContainer} on:scroll={handleContainerScroll}>
      {#if showPlaceholder}
        <div class="load-more-placeholder" bind:this={placeholderEl}>
          Загрузка...
        </div>
      {/if}
      {#each groupedMessages as group}
        {#if group.isSystem}
          {@const systemData = (() => { try { return JSON.parse(group.messages[0].content || '{}'); } catch { return { event: 'unknown', raw: group.messages[0].content }; } })()}
          <div class="system-message">
            <span class="system-content">
              {systemData.event === 'chat_created' ? 'Чат создан' : 
               systemData.event === 'member_added' ? `${systemData.username} добавлен в чат` : 
               systemData.event === 'member_removed' ? `${systemData.username} удалён из чата` :
               systemData.event === 'member_left' ? `${systemData.username} покинул чат` : systemData.raw || group.messages[0].content}
            </span>
            <span class="system-time" title={new Date(group.messages[0].timestamp * 1000).toLocaleString()}>
              {new Date(group.messages[0].timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        {:else}
           <div class="message-group">
             <div class="message-header">
               <div class="avatar">{(group.senderUsername || '?').charAt(0).toUpperCase()}</div>
               <span class="sender-name">{group.senderUsername || 'Unknown'}</span>
             </div>
                {#each group.messages as msg, i}
                  <div class="message" class:own={msg.senderId === $auth.user?.id} data-message-id={msg.id} on:contextmenu={(e) => handleContextMenu(e, msg.id, msg.senderId)}>
                  <div class="message-content">
                    {msg.content}
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

    <form class="input-area" on:submit|preventDefault={handleSendMessage}>
      <input 
        type="text" 
        bind:value={newMessage} 
        placeholder="Введите сообщение..." 
        disabled={sending || !chatKey}
        id="messageInput"
      />
      <button type="submit" disabled={sending || !newMessage.trim() || !chatKey}>
        {sending ? '...' : 'Отправить'}
      </button>
    </form>

    {#if editingMessage}
      <div class="edit-area">
        <input 
          type="text" 
          bind:value={editingText} 
          placeholder="Редактировать сообщение..."
          on:keydown={(e) => { if (e.key === 'Enter') handleEditMessage(); if (e.key === 'Escape') cancelEdit(); }}
        />
        <button class="edit-save" on:click={handleEditMessage} disabled={!editingText.trim()}>Сохранить</button>
        <button class="edit-cancel" on:click={cancelEdit}>Отмена</button>
      </div>
    {/if}
  {/if}

  {#if contextMenu.visible}
    <div class="context-menu" style="left: {contextMenu.x}px; top: {contextMenu.y}px;" on:click|stopPropagation>
      <div class="context-menu-item disabled">Ответить</div>
      <div class="context-menu-item disabled">Закрепить</div>
      <div class="context-menu-item disabled">Скопировать</div>
      {#if isOwnMessage}
        <div class="context-menu-item" on:click={() => { const msg = messages.find(m => m.id === contextMenu.messageId); if (msg) handleEditFromMenu(msg); }}>Редактировать</div>
        <div class="context-menu-item danger" on:click={handleDeleteFromMenu}>Удалить</div>
      {/if}
    </div>
    <div class="context-menu-overlay" on:click={closeContextMenu}></div>
  {/if}
</div>

{#if showAddMemberModal}
  <div class="modal-overlay" on:click={() => showAddMemberModal = false}>
    <div class="modal" on:click|stopPropagation>
      <h3>Добавить участника</h3>
      <div class="field">
        <label for="userSearch">Поиск пользователей</label>
        <input 
          type="text" 
          id="userSearch" 
          bind:value={userSearch} 
          on:input={searchUsers}
          placeholder="Введите имя пользователя..."
        />
      </div>
      {#if searching}
        <p>Поиск...</p>
      {:else if searchResults.length > 0}
        <div class="search-results">
          {#each searchResults as user}
            {@const isAlreadyMember = chatDetail?.members.some((m: any) => m.id === user.id)}
            <div 
              class="search-result"
              class:disabled={isAlreadyMember}
              on:click={() => !isAlreadyMember && addMember(user.id)}
            >
              {user.username}
              {isAlreadyMember ? '(already in chat)' : ''}
            </div>
          {/each}
        </div>
      {/if}
      <div class="modal-actions">
        <button on:click={() => showAddMemberModal = false}>Отмена</button>
      </div>
    </div>
  </div>
{/if}

{#if showMembersModal}
  <div class="modal-overlay" on:click={() => showMembersModal = false}>
    <div class="modal" on:click|stopPropagation>
      <h3>Участники</h3>
      <div class="members-list">
        {#each chatDetail?.members || [] as member}
          <div class="member-item">
            <span class="member-name">{member.username}</span>
            {#if isCreator && chatDetail?.type === 'gm' && member.id !== $auth.user?.id}
              <button class="remove-btn" on:click={() => removeMember(member.id)}>Удалить</button>
            {/if}
          </div>
        {/each}
      </div>
      <div class="modal-actions">
        {#if chatDetail?.type === 'pm'}
          <button class="delete-chat-btn" on:click={handleDeleteChat}>Удалить чат</button>
        {:else if isCreator && (chatDetail?.members?.length || 0) === 1}
          <button class="delete-chat-btn" on:click={handleDeleteChat}>Удалить чат</button>
        {/if}
        <button on:click={() => showMembersModal = false}>Закрыть</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .chat-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  header {
    padding: 16px 24px;
    border-bottom: 1px solid #e0e0e0;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }

  .loading, .error {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #888;
  }

  .error {
    color: #f44336;
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .load-more-placeholder {
    text-align: center;
    padding: 16px;
    color: #888;
    cursor: pointer;
  }

  .message-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .message {
    align-self: flex-start;
    background: #f5f5f5;
    max-width: 55%;
    padding: 10px 14px;
    border-radius: 16px;
    position: relative;
    display: flex;
    align-items: flex-end;
    gap: 8px;
  }

  .message.own {
    background: #e3f2fd;
  }

  .message-content {
    word-wrap: break-word;
    font-size: 15px;
    line-height: 1.4;
    flex: 1;
  }

  .message .msg-time {
    font-size: 10px;
    color: #888;
    white-space: nowrap;
  }

  .message .msg-time .edited {
    font-style: italic;
    color: #666;
    margin-left: 2px;
  }

  .avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: #4CAF50;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .sender-name {
    font-size: 13px;
    font-weight: 600;
    color: #333;
  }

  .message-time {
    font-size: 11px;
    color: #888;
    margin-left: auto;
  }

  .message-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
    padding: 0 4px;
  }

  .message-header .sender-name {
    font-weight: 600;
    font-size: 14px;
  }

  .message-header .message-time {
    font-size: 12px;
    color: #666;
    cursor: pointer;
  }

  .message-meta {
    font-size: 11px;
    color: #888;
    margin-top: 4px;
    display: flex;
    gap: 4px;
  }

  .message-meta span {
    cursor: default;
  }

  .message-meta .edited {
    font-style: italic;
    color: #666;
  }

  .delete {
    font-size: 12px;
    color: #f44336;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    margin-top: 4px;
  }

  .input-area {
    display: flex;
    gap: 12px;
    padding: 16px 24px;
    border-top: 1px solid #e0e0e0;
  }

  .input-area input {
    flex: 1;
    padding: 14px 20px;
    border: 1px solid #ddd;
    border-radius: 24px;
    font-size: 15px;
  }

  .input-area input:focus {
    outline: none;
    border-color: #4CAF50;
  }

  .input-area button {
    padding: 14px 28px;
    background: #4CAF50;
    color: white;
    border: none;
    border-radius: 24px;
    cursor: pointer;
    font-size: 15px;
    font-weight: 500;
  }

  .input-area button:hover:not(:disabled) {
    background: #45a049;
  }

  .input-area button:disabled {
    background: #ccc;
  }

  .add-member-btn {
    padding: 8px 16px;
    background: #2196F3;
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    margin-left: auto;
  }

  .add-member-btn:hover {
    background: #1976D2;
  }

  .header-actions {
    display: flex;
    gap: 8px;
    margin-left: auto;
  }

  .icon-btn {
    width: 36px;
    height: 36px;
    border: none;
    border-radius: 8px;
    background: #f0f0f0;
    cursor: pointer;
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .icon-btn:hover {
    background: #e0e0e0;
  }

  .members-list {
    max-height: 300px;
    overflow-y: auto;
  }

  .member-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px;
    border-bottom: 1px solid #eee;
  }

  .member-name {
    font-size: 15px;
  }

  .remove-btn {
    padding: 6px 12px;
    background: #f44336;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
  }

  .remove-btn:hover {
    background: #d32f2f;
  }

  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal {
    background: white;
    padding: 28px;
    border-radius: 14px;
    width: 400px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.2);
  }

  .modal h3 {
    margin: 0 0 20px;
    font-size: 18px;
  }

  .modal .field {
    margin-bottom: 16px;
  }

  .modal .field label {
    display: block;
    margin-bottom: 8px;
    font-weight: 600;
    font-size: 14px;
  }

  .modal .field input {
    width: 100%;
    padding: 12px;
    border: 1px solid #ddd;
    border-radius: 8px;
    font-size: 15px;
    box-sizing: border-box;
  }

  .modal .field input:focus {
    outline: none;
    border-color: #2196F3;
  }

  .modal .search-results {
    max-height: 200px;
    overflow-y: auto;
    border: 1px solid #eee;
    border-radius: 8px;
    margin-top: 12px;
  }

  .modal .search-result {
    padding: 12px 16px;
    cursor: pointer;
    border-bottom: 1px solid #f0f0f0;
    font-size: 15px;
  }

  .modal .search-result:hover:not(.disabled) {
    background: #f9f9f9;
  }

  .modal .search-result.disabled {
    color: #999;
    cursor: not-allowed;
  }

  .modal .modal-actions {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    margin-top: 20px;
  }

  .modal .modal-actions button {
    padding: 10px 20px;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
  }

  .modal .modal-actions button:first-child {
    background: #f0f0f0;
  }

  .context-menu-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 99;
  }

  .context-menu {
    position: fixed;
    background: white;
    border: 1px solid #ddd;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 100;
    min-width: 120px;
    overflow: hidden;
  }

  .context-menu-item {
    padding: 10px 16px;
    cursor: pointer;
    font-size: 14px;
    color: #333;
  }

  .context-menu-item:hover:not(.disabled) {
    background: #f5f5f5;
  }

  .context-menu-item.disabled {
    color: #999;
    cursor: default;
  }

  .context-menu-item.danger {
    color: #f44336;
  }

  .context-menu-item.danger:hover:not(.disabled) {
    background: #ffebee;
  }

  .edit-area {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid #e0e0e0;
    background: #f5f5f5;
  }

  .edit-area input {
    flex: 1;
    padding: 10px 12px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 15px;
  }

  .edit-area input:focus {
    outline: none;
    border-color: #2196F3;
  }

  .edit-save {
    padding: 10px 16px;
    background: #4caf50;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
  }

  .edit-save:disabled {
    background: #ccc;
    cursor: not-allowed;
  }

  .edit-cancel {
    padding: 10px 16px;
    background: #f5f5f5;
    color: #666;
    border: 1px solid #ddd;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
  }

  .edit-cancel:hover {
    background: #e0e0e0;
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

  .system-message .system-content {
    flex: 1;
    text-align: center;
  }

  .system-message .system-time {
    font-size: 10px;
    color: #999;
    white-space: nowrap;
  }
</style>