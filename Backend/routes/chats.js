const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const sse = require('../sse');

const router = express.Router();

function createSystemMessage(chatId, eventType, data) {
  const messageId = uuidv4();
  const content = JSON.stringify({ event: eventType, ...data });
  
  db.prepare(
    'INSERT INTO messages (id, chat_id, sender_id, content) VALUES (?, ?, NULL, ?)'
  ).run(messageId, chatId, content);
  
  const message = db.prepare(
    'SELECT id, chat_id, sender_id, content, file_ids, timestamp, edited_at FROM messages WHERE id = ?'
  ).get(messageId);
  
  return {
    id: message.id,
    chatId: message.chat_id,
    senderId: null,
    content: message.content,
    fileIds: message.file_ids ? JSON.parse(message.file_ids) : [],
    timestamp: message.timestamp,
    editedAt: message.edited_at
  };
}

function broadcastToChatMembers(chatId, eventType, data, excludeUserId = null) {
  const members = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(chatId);
  members.forEach(member => {
    if (member.user_id !== excludeUserId) {
      sse.broadcast(member.user_id, { type: eventType, data });
    }
  });
}

router.get('/', authenticate, (req, res) => {
  try {
    const chats = db.prepare(`
      SELECT c.id, c.type, c.name, c.created_at,
        (SELECT COUNT(*) FROM chat_members WHERE chat_id = c.id) as member_count
      FROM chats c
      JOIN chat_members cm ON c.id = cm.chat_id
      WHERE cm.user_id = ?
      ORDER BY c.created_at DESC
    `).all(req.userId);
    
    const result = chats.map(chat => ({
      id: chat.id,
      type: chat.type,
      name: chat.name,
      memberCount: chat.member_count
    }));
    
    res.json(result);
  } catch (err) {
    console.error('Get chats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authenticate, (req, res) => {
  try {
    const { type, name, members, encryptedKey, memberKeys } = req.body;
    
    if (!type || !['pm', 'gm'].includes(type)) {
      return res.status(400).json({ error: 'Invalid chat type' });
    }
    
    if (!encryptedKey) {
      return res.status(400).json({ error: 'encryptedKey is required' });
    }
    
    if (type === 'pm') {
      if (!members || members.length !== 1) {
        return res.status(400).json({ error: 'Personal chat requires exactly one other member' });
      }
      const otherUserId = members[0];
      if (otherUserId === req.userId) {
        return res.status(400).json({ error: 'Cannot create personal chat with yourself' });
      }
      const existingChat = db.prepare(`
        SELECT c.id FROM chats c
        JOIN chat_members cm1 ON c.id = cm1.chat_id AND cm1.user_id = ?
        JOIN chat_members cm2 ON c.id = cm2.chat_id AND cm2.user_id = ?
        WHERE c.type = 'pm'
      `).get(req.userId, otherUserId);
      
      if (existingChat) {
        return res.status(400).json({ error: 'Personal chat already exists with this user' });
      }
    }
    
    const chatId = uuidv4();
    
    db.prepare('INSERT INTO chats (id, type, name, created_by) VALUES (?, ?, ?, ?)').run(chatId, type, name || null, req.userId);
    
    db.prepare('INSERT INTO chat_members (chat_id, user_id, encrypted_chat_key) VALUES (?, ?, ?)').run(chatId, req.userId, encryptedKey);
    
    if (members && members.length > 0) {
      const creator = db.prepare('SELECT username FROM users WHERE id = ?').get(req.userId);
      
      for (const userId of members) {
        const memberKey = memberKeys?.[userId] || null;
        db.prepare('INSERT INTO chat_members (chat_id, user_id, encrypted_chat_key) VALUES (?, ?, ?)').run(chatId, userId, memberKey);
        
        let systemMsg, eventType, eventData;
        
        if (type === 'pm') {
          systemMsg = createSystemMessage(chatId, 'personal_chat_created', { creatorUsername: creator.username, creatorId: req.userId });
          eventType = 'member_added';
          eventData = { username: creator.username, userId: req.userId };
        } else {
          const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
          systemMsg = createSystemMessage(chatId, 'member_added', { username: user.username, userId });
          eventType = 'member_added';
          eventData = { username: user.username, userId };
        }
        
        const memberCount = db.prepare('SELECT COUNT(*) as count FROM chat_members WHERE chat_id = ?').get(chatId).count;
        
        sse.broadcast(userId, {
          type: eventType,
          data: {
            message: systemMsg,
            ...eventData,
            chatId: chatId,
            memberCount
          }
        });
      }
    }
    
    res.status(201).json({ id: chatId, type, name });
  } catch (err) {
    console.error('Create chat error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:chatId', authenticate, (req, res) => {
  try {
    const chat = db.prepare('SELECT id, type, name, created_by, created_at FROM chats WHERE id = ?').get(req.params.chatId);
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chat.id, req.userId);
    if (!isMember) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const members = db.prepare(`
      SELECT u.id, u.username, cm.encrypted_chat_key
      FROM chat_members cm
      JOIN users u ON cm.user_id = u.id
      WHERE cm.chat_id = ?
    `).all(chat.id);
    
    res.json({
      id: chat.id,
      type: chat.type,
      name: chat.name,
      createdBy: chat.created_by,
      createdAt: chat.created_at,
      members: members.map(m => ({
        id: m.id,
        username: m.username,
        encryptedKey: m.encrypted_chat_key
      }))
    });
  } catch (err) {
    console.error('Get chat error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:chatId', authenticate, (req, res) => {
  try {
    const chat = db.prepare('SELECT created_by, type FROM chats WHERE id = ?').get(req.params.chatId);
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(req.params.chatId, req.userId);
    if (!isMember) {
      return res.status(403).json({ error: 'Not a member of this chat' });
    }
    
    if (chat.type === 'gm') {
      if (chat.created_by !== req.userId) {
        return res.status(403).json({ error: 'Only creator can delete group chat' });
      }
      
      const memberCount = db.prepare('SELECT COUNT(*) as count FROM chat_members WHERE chat_id = ?').get(req.params.chatId);
      if (memberCount.count > 1) {
        return res.status(400).json({ error: 'Cannot delete group chat with multiple members' });
      }
    }
    
    const members = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(req.params.chatId);
    const memberCount = members.length;
    
    db.prepare('DELETE FROM messages WHERE chat_id = ?').run(req.params.chatId);
    db.prepare('DELETE FROM chat_members WHERE chat_id = ?').run(req.params.chatId);
    db.prepare('DELETE FROM chats WHERE id = ?').run(req.params.chatId);
    
    members.forEach(member => {
      sse.broadcast(member.user_id, { type: 'chat_deleted', data: { chatId: req.params.chatId, memberCount } });
    });
    
    res.json({ message: 'Chat deleted' });
  } catch (err) {
    console.error('Delete chat error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:chatId/leave', authenticate, (req, res) => {
  try {
    const chat = db.prepare('SELECT created_by, type FROM chats WHERE id = ?').get(req.params.chatId);
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    if (chat.type === 'pm') {
      return res.status(400).json({ error: 'Cannot leave personal chat' });
    }
    
    const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(req.params.chatId, req.userId);
    if (!isMember) {
      return res.status(403).json({ error: 'Not a member of this chat' });
    }
    
    if (chat.created_by === req.userId && chat.type === 'gm') {
      return res.status(400).json({ error: 'Creator cannot leave group chat' });
    }
    
    db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run(req.params.chatId, req.userId);
    
    const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.userId);
    const systemMsg = createSystemMessage(req.params.chatId, 'member_left', { username: user.username, userId: req.userId });
    
    const memberCount = db.prepare('SELECT COUNT(*) as count FROM chat_members WHERE chat_id = ?').get(req.params.chatId).count;
    broadcastToChatMembers(req.params.chatId, 'member_left', { 
      message: systemMsg, 
      username: user.username, 
      userId: req.userId,
      chatId: req.params.chatId,
      memberCount 
    });
    
    sse.broadcast(req.userId, {
      type: 'member_left',
      data: {
        message: systemMsg,
        username: user.username,
        userId: req.userId,
        chatId: req.params.chatId,
        memberCount,
        removed: true
      }
    });
    
    res.json({ message: 'Left chat' });
  } catch (err) {
    console.error('Leave chat error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:chatId/members/add', authenticate, (req, res) => {
  try {
    const { userId, encryptedKey } = req.body;
    
    if (!userId || !encryptedKey) {
      return res.status(400).json({ error: 'userId and encryptedKey required' });
    }
    
    const chat = db.prepare('SELECT id, type FROM chats WHERE id = ?').get(req.params.chatId);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    if (chat.type === 'pm') {
      return res.status(400).json({ error: 'Cannot add members to personal chat' });
    }
    
    const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(req.params.chatId, req.userId);
    if (!isMember) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const existing = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(req.params.chatId, userId);
    if (existing) {
      return res.status(400).json({ error: 'User already in chat' });
    }
    
    db.prepare('INSERT INTO chat_members (chat_id, user_id, encrypted_chat_key) VALUES (?, ?, ?)').run(req.params.chatId, userId, encryptedKey);
    
    const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
    const systemMsg = createSystemMessage(req.params.chatId, 'member_added', { username: user.username, userId });
    
    const memberCount = db.prepare('SELECT COUNT(*) as count FROM chat_members WHERE chat_id = ?').get(req.params.chatId).count;
    broadcastToChatMembers(req.params.chatId, 'member_added', { 
      message: systemMsg, 
      username: user.username, 
      userId,
      chatId: req.params.chatId,
      memberCount 
    });
    
    res.status(201).json({ message: 'Member added' });
  } catch (err) {
    console.error('Add member error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:chatId/members/remove', authenticate, (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }
    
    const chat = db.prepare('SELECT id FROM chats WHERE id = ?').get(req.params.chatId);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(req.params.chatId, req.userId);
    if (!isMember) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const targetMember = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ? AND user_id = ?').get(req.params.chatId, userId);
    if (!targetMember) {
      return res.status(404).json({ error: 'User not in chat' });
    }
    
    if (userId === req.userId) {
      const chatInfo = db.prepare('SELECT created_by FROM chats WHERE id = ?').get(req.params.chatId);
      if (chatInfo.created_by === req.userId) {
        return res.status(400).json({ error: 'Cannot remove creator' });
      }
    }
    
    db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run(req.params.chatId, userId);
    
    const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
    const systemMsg = createSystemMessage(req.params.chatId, 'member_removed', { username: user.username, userId });
    
    const memberCount = db.prepare('SELECT COUNT(*) as count FROM chat_members WHERE chat_id = ?').get(req.params.chatId).count;
    broadcastToChatMembers(req.params.chatId, 'member_removed', { 
      message: systemMsg, 
      username: user.username, 
      userId,
      chatId: req.params.chatId,
      memberCount 
    });
    
    sse.broadcast(userId, {
      type: 'member_removed',
      data: {
        message: systemMsg,
        username: user.username,
        userId,
        chatId: req.params.chatId,
        memberCount,
        removed: true
      }
    });
    
    res.json({ message: 'Member removed' });
  } catch (err) {
    console.error('Remove member error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:chatId/messages', authenticate, (req, res) => {
  try {
    const chat = db.prepare('SELECT id FROM chats WHERE id = ?').get(req.params.chatId);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(req.params.chatId, req.userId);
    if (!isMember) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const { cursor, limit = 50 } = req.query;
    const limitNum = Math.min(parseInt(limit) || 50, 100);
    
    let query = 'SELECT id, sender_id, content, file_ids, timestamp, edited_at FROM messages WHERE chat_id = ?';
    const params = [req.params.chatId];
    
    if (cursor) {
      query += ' AND timestamp < (SELECT timestamp FROM messages WHERE id = ?)';
      params.push(cursor);
    }
    
    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limitNum + 1);
    
    const messages = db.prepare(query).all(...params);
    
    const hasMore = messages.length > limitNum;
    if (hasMore) {
      messages.pop();
    }
    
    res.json({
      messages: messages.reverse().map(m => ({
        id: m.id,
        senderId: m.sender_id,
        content: m.content,
        fileIds: m.file_ids ? JSON.parse(m.file_ids) : [],
        timestamp: m.timestamp,
        editedAt: m.edited_at
      })),
      nextCursor: hasMore ? messages[messages.length - 1].id : null
    });
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:chatId/messages', authenticate, (req, res) => {
  try {
    const { content, fileIds } = req.body;
    
    const chat = db.prepare('SELECT id FROM chats WHERE id = ?').get(req.params.chatId);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(req.params.chatId, req.userId);
    if (!isMember) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (!content && (!fileIds || fileIds.length === 0)) {
      return res.status(400).json({ error: 'Content or fileIds required' });
    }
    
    if (content && content.length > 10000) {
      return res.status(400).json({ error: 'Message exceeds 10000 characters' });
    }
    
    const messageId = uuidv4();
    
    db.prepare('INSERT INTO messages (id, chat_id, sender_id, content, file_ids) VALUES (?, ?, ?, ?, ?)').run(messageId, req.params.chatId, req.userId, content || null, fileIds ? JSON.stringify(fileIds) : null);
    
    const message = db.prepare('SELECT id, sender_id, content, file_ids, timestamp FROM messages WHERE id = ?').get(messageId);
    
    const response = {
      id: message.id,
      chatId: req.params.chatId,
      senderId: message.sender_id,
      content: message.content,
      fileIds: message.file_ids ? JSON.parse(message.file_ids) : [],
      timestamp: message.timestamp
    };
    
    broadcastToChatMembers(req.params.chatId, 'new_message', response, req.userId);
    
    res.status(201).json(response);
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;