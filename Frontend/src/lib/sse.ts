import { writable } from 'svelte/store';
import type { Message, PinnedMessage } from './types';

export interface SSEEvent {
  type: 'new_message' | 'message_deleted' | 'message_edited' | 'member_added' | 'member_removed' | 'member_left' | 'chat_deleted' | 'typing' | 'chat_updated' | 'pins_updated' | 'user_online' | 'user_offline' | 'read_state_updated';
  data: any;
}

export const sseEvents = writable<SSEEvent | null>(null);

export const sseMessage = writable<{ chatId: string; eventType: 'new_message' | 'message_deleted' | 'message_edited'; message: Message } | null>(null);
export const deletedFilesEvent = writable<{ chatId: string; fileIds: string[] } | null>(null);

export const memberEvent = writable<{ type: string; chatId: string; userId: string; memberCount: number; removed?: boolean } | null>(null);

export const chatDeletedEvent = writable<string | null>(null);
export const chatUpdatedEvent = writable<string | null>(null);
export const typingEvent = writable<{ chatId: string; userId: string } | null>(null);
export const pinsUpdatedEvent = writable<{ chatId: string; pinnedMessages: PinnedMessage[] } | null>(null);
export const userPresenceEvent = writable<{ userId: string; isOnline: boolean; lastSeenAt?: number | null } | null>(null);
export const readStateEvent = writable<{ chatId: string; userId: string; lastReadAt: number } | null>(null);

let eventSource: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectSSE();
  }, 5000);
}

export function connectSSE() {
  if (eventSource && eventSource.readyState !== EventSource.CLOSED) return;

  const token = sessionStorage.getItem('token');
  if (!token) {
    return;
  }
  
  eventSource = new EventSource(`/api/events?token=${token}`);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      sseEvents.set(data);
      handleSSEEvent(data);
    } catch (e) {
      
    }
  };

  eventSource.onerror = (err) => {
    
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    scheduleReconnect();
  };
}

export function disconnectSSE() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

export function isSSEConnected() {
  return Boolean(eventSource && eventSource.readyState === EventSource.OPEN);
}

export function ensureSSEConnection() {
  if (!eventSource) {
    connectSSE();
    return;
  }

  if (eventSource.readyState !== EventSource.OPEN) {
    eventSource.close();
    eventSource = null;
    connectSSE();
  }
}

function handleSSEEvent(event: SSEEvent) {
  switch (event.type) {
    case 'new_message': {
      const message: Message = event.data;
      if (message.chatId) {
        sseMessage.set({ chatId: message.chatId, eventType: 'new_message', message });
      }
      break;
    }
    case 'message_deleted': {
      const deletedFileIds = Array.isArray(event.data.deletedFileIds) ? event.data.deletedFileIds : [];
      sseMessage.set({
        chatId: event.data.chatId,
        eventType: 'message_deleted',
        message: { id: event.data.messageId, deletedFileIds } as Message
      });
      if (deletedFileIds.length > 0) {
        deletedFilesEvent.set({ chatId: event.data.chatId, fileIds: deletedFileIds });
      }
      if (Array.isArray(event.data.pinnedMessages)) {
        pinsUpdatedEvent.set({
          chatId: event.data.chatId,
          pinnedMessages: event.data.pinnedMessages
        });
      }
      break;
    }
    case 'message_edited': {
      const message: Message = event.data;
      if (message.chatId) {
        sseMessage.set({ chatId: message.chatId, eventType: 'message_edited', message });
      }
      break;
    }
    case 'member_added':
    case 'member_removed':
    case 'member_left': {
      const data = event.data;
      memberEvent.set({ 
        type: event.type, 
        chatId: data.chatId, 
        userId: data.userId,
        memberCount: data.memberCount,
        removed: data.removed
      });
      sseMessage.set({ chatId: data.message.chatId, eventType: 'new_message', message: data.message });
      break;
    }
    case 'chat_deleted': {
      chatDeletedEvent.set(event.data.chatId);
      break;
    }
    case 'chat_updated': {
      chatUpdatedEvent.set(event.data.chatId);
      break;
    }
    case 'typing': {
      const data = event.data;
      typingEvent.set({
        chatId: data.chatId,
        userId: data.userId
      });
      break;
    }
    case 'pins_updated': {
      pinsUpdatedEvent.set({
        chatId: event.data.chatId,
        pinnedMessages: event.data.pinnedMessages ?? []
      });
      break;
    }
    case 'user_online': {
      userPresenceEvent.set({
        userId: event.data.userId,
        isOnline: true,
        lastSeenAt: null
      });
      break;
    }
    case 'user_offline': {
      userPresenceEvent.set({
        userId: event.data.userId,
        isOnline: false,
        lastSeenAt: event.data.lastSeenAt ?? null
      });
      break;
    }
    case 'read_state_updated': {
      readStateEvent.set({
        chatId: event.data.chatId,
        userId: event.data.userId,
        lastReadAt: event.data.lastReadAt
      });
      break;
    }
  }
}
