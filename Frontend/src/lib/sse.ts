import { writable } from 'svelte/store';
import type { Message } from './api';

export interface SSEEvent {
  type: 'new_message' | 'message_deleted' | 'message_edited' | 'member_added' | 'member_removed' | 'member_left' | 'chat_deleted';
  data: any;
}

export const sseEvents = writable<SSEEvent | null>(null);

export const sseMessage = writable<{ chatId: string; message: Message } | null>(null);

export const memberEvents = writable<{ type: string; chatId: string; userId: string; memberCount: number; removed?: boolean }[]>([]);

export const chatDeletedEvents = writable<string[]>([]);

let eventSource: EventSource | null = null;

export function connectSSE() {
  if (eventSource) return;

  const token = sessionStorage.getItem('token');
  if (!token) {
    console.log('No token, skipping SSE connection');
    return;
  }

  console.log('Connecting to SSE with token:', token.substring(0, 20) + '...');
  
  eventSource = new EventSource(`/api/events?token=${token}`);

  eventSource.onopen = () => {
    console.log('SSE connected successfully');
  };

  eventSource.onmessage = (event) => {
    console.log('SSE message received:', event.data);
    try {
      const data = JSON.parse(event.data);
      sseEvents.set(data);
      handleSSEEvent(data);
    } catch (e) {
      console.error('Failed to parse SSE event:', e);
    }
  };

  eventSource.onerror = (err) => {
    console.error('SSE error:', err);
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    setTimeout(connectSSE, 5000);
  };
}

export function disconnectSSE() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

function handleSSEEvent(event: SSEEvent) {
  switch (event.type) {
    case 'new_message': {
      const message: Message = event.data;
      sseMessage.set({ chatId: message.chatId, message });
      break;
    }
    case 'message_deleted': {
      sseMessage.set({ chatId: '', message: { id: event.data.messageId } as Message });
      break;
    }
    case 'message_edited': {
      const message: Message = event.data;
      sseMessage.set({ chatId: message.chatId, message });
      break;
    }
    case 'member_added':
    case 'member_removed':
    case 'member_left': {
      const data = event.data;
      console.log('SSE member event received:', event.type, data);
      sseMessage.set({ chatId: data.message.chatId, message: data.message });
      memberEvents.update(events => [...events, { 
        type: event.type, 
        chatId: data.chatId, 
        userId: data.userId,
        memberCount: data.memberCount,
        removed: data.removed
      }]);
      break;
    }
    case 'chat_deleted': {
      chatDeletedEvents.update(events => [...events, event.data.chatId]);
      break;
    }
  }
}