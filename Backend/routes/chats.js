const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const sse = require('../sse');
const { getAvatarUrl } = require('../utils/avatar');
const {
  validateAttachableFileIds,
  setMessageFileIds,
  getMessageFileIdsMap,
  getReplyPreviewByMessageId,
  mapMessageRow
} = require('../utils/message-files');

const router = express.Router();

function createSystemMessage(chatId, eventType, data) {
  const messageId = uuidv4();
  const content = JSON.stringify({ event: eventType, ...data });
  const timestamp = Math.floor(Date.now() / 1000);
  
  db.prepare(
    'INSERT INTO messages (id, chat_id, sender_id, content, timestamp) VALUES (?, ?, NULL, ?, ?)'
  ).run(messageId, chatId, content, timestamp);
  
  const message = db.prepare(
    'SELECT id, chat_id, sender_id, content, reply_to_message_id, timestamp, edited_at FROM messages WHERE id = ?'
  ).get(messageId);

  return mapMessageRow(message);
}

function broadcastToChatMembers(chatId, eventType, data, excludeUserId = null) {
  const members = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(chatId);
  members.forEach(member => {
    if (member.user_id !== excludeUserId) {
      sse.broadcast(member.user_id, { type: eventType, data });
    }
  });
}

function mapChatRow(chat) {
  return {
    id: chat.id,
    type: chat.type,
    name: chat.name,
    createdBy: chat.created_by,
    createdAt: chat.created_at,
    memberCount: chat.member_count,
    avatarFileId: chat.avatar_file_id ?? null,
    avatarUpdatedAt: chat.avatar_updated_at ?? null
  };
}

function getPinnedMessages(chatId) {
  const pinnedRows = db.prepare(`
    SELECT pm.chat_id, pm.message_id, pm.pinned_by, pm.created_at,
      u.username AS pinned_by_username,
      m.id, m.chat_id, m.sender_id, m.content, m.reply_to_message_id, m.timestamp, m.edited_at
    FROM pinned_messages pm
    JOIN messages m ON m.id = pm.message_id
    LEFT JOIN users u ON u.id = pm.pinned_by
    WHERE pm.chat_id = ?
    ORDER BY pm.created_at ASC
  `).all(chatId);

  const fileIdsByMessage = getMessageFileIdsMap(pinnedRows.map((row) => row.id));
  const replyPreviewByMessageId = getReplyPreviewByMessageId(pinnedRows);

  return pinnedRows.map((row) => ({
    chatId: row.chat_id,
    pinnedBy: row.pinned_by,
    pinnedByUsername: row.pinned_by_username ?? 'Unknown',
    pinnedAt: row.created_at,
    message: mapMessageRow(row, fileIdsByMessage, replyPreviewByMessageId)
  }));
}

function removeUserMessagesFromChat(chatId, userId) {
  db.prepare(`
    DELETE FROM pinned_messages
    WHERE chat_id = ?
      AND message_id IN (
        SELECT id FROM messages WHERE chat_id = ? AND sender_id = ?
      )
  `).run(chatId, chatId, userId);
  db.prepare('DELETE FROM messages WHERE chat_id = ? AND sender_id = ?').run(chatId, userId);
}

function removeUserFilesFromChat(chatId, userId) {
  db.prepare(
    `UPDATE chats
     SET avatar_file_id = NULL
     WHERE id = ? AND avatar_file_id IN (
       SELECT id FROM files WHERE chat_id = ? AND uploaded_by = ?
     )`
  ).run(chatId, chatId, userId);

  db.prepare('DELETE FROM files WHERE chat_id = ? AND uploaded_by = ?').run(chatId, userId);
}

router.get('/', authenticate, (req, res) => {
  try {
    const chats = db.prepare(`
      SELECT c.id, c.type, c.name, c.created_by, c.created_at, c.avatar_file_id,
        f.updated_at AS avatar_updated_at,
        (SELECT COUNT(*) FROM chat_members WHERE chat_id = c.id) as member_count,
        cm.last_read_at
      FROM chats c
      JOIN chat_members cm ON c.id = cm.chat_id
      LEFT JOIN files f ON f.id = c.avatar_file_id
      WHERE cm.user_id = ?
      ORDER BY c.created_at DESC
    `).all(req.userId);
    
    const result = chats.map(chat => {
      let unreadCount = 0;
      let firstUnreadId = null;
      
      if (chat.last_read_at > 0) {
        const unreadInfo = db.prepare(`
          SELECT id FROM messages 
          WHERE chat_id = ? AND timestamp > ?
          ORDER BY timestamp ASC LIMIT 1
        `).get(chat.id, chat.last_read_at);
        
        if (unreadInfo) {
          firstUnreadId = unreadInfo.id;
          unreadCount = db.prepare('SELECT COUNT(*) as count FROM messages WHERE chat_id = ? AND timestamp > ?').get(chat.id, chat.last_read_at).count;
        }
      }
      
      return {
        ...mapChatRow(chat),
        unreadCount,
        firstUnreadId
      };
    });
    
    res.json(result);
  } catch (err) {
    console.error('Get chats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authenticate, (req, res) => {
  try {
    let { type, name, members, encryptedKey, memberKeys } = req.body;
    
    if (!type || !['pm', 'gm'].includes(type)) {
      return res.status(400).json({ error: 'Invalid chat type' });
    }
    
    if (!encryptedKey) {
      return res.status(400).json({ error: 'encryptedKey is required' });
    }

    const providedNameLength = Number(req.body.nameLength ?? 0);
    if (type === 'gm' && (!name || !providedNameLength)) {
      return res.status(400).json({ error: 'Encrypted group chat name is required' });
    }

    if (providedNameLength > 30) {
      return res.status(400).json({ error: 'Chat name exceeds 30 characters' });
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
    
    db.prepare('INSERT INTO chat_members (chat_id, user_id, encrypted_chat_key, last_read_at) VALUES (?, ?, ?, 0)').run(chatId, req.userId, encryptedKey);
    
    if (members && members.length > 0) {
      const creator = db.prepare('SELECT username FROM users WHERE id = ?').get(req.userId);
      
      for (const userId of members) {
        const memberKey = memberKeys?.[userId] || null;
        db.prepare('INSERT INTO chat_members (chat_id, user_id, encrypted_chat_key, last_read_at) VALUES (?, ?, ?, 0)').run(chatId, userId, memberKey);
        
        let systemMsg, eventType, eventData;
        
        const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
        systemMsg = createSystemMessage(chatId, 'member_added', { username: user.username, userId });
        eventType = 'member_added';
        eventData = { username: user.username, userId };
        
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
    
    createSystemMessage(chatId, 'chat_created', {});
    
    members = db.prepare(`
      SELECT u.id, u.username, u.avatar_updated_at, cm.encrypted_chat_key
      FROM chat_members cm
      JOIN users u ON cm.user_id = u.id
      WHERE cm.chat_id = ?
    `).all(chatId);
    
    res.status(201).json({
      id: chatId,
      type,
      name,
      createdBy: req.userId,
      createdAt: Math.floor(Date.now() / 1000),
      avatarFileId: null,
      avatarUpdatedAt: null,
      members: members.map(m => ({
        id: m.id,
        username: m.username,
        avatarUrl: getAvatarUrl(m.id, m.avatar_updated_at),
        encryptedKey: m.encrypted_chat_key
      })),
      pinnedMessages: []
    });
  } catch (err) {
    console.error('Create chat error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:chatId', authenticate, (req, res) => {
  try {
    const chat = db.prepare(`
      SELECT c.id, c.type, c.name, c.created_by, c.created_at, c.avatar_file_id,
        f.updated_at AS avatar_updated_at
      FROM chats c
      LEFT JOIN files f ON f.id = c.avatar_file_id
      WHERE c.id = ?
    `).get(req.params.chatId);
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chat.id, req.userId);
    if (!isMember) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const members = db.prepare(`
      SELECT u.id, u.username, u.avatar_updated_at, cm.encrypted_chat_key
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
      avatarFileId: chat.avatar_file_id ?? null,
      avatarUpdatedAt: chat.avatar_updated_at ?? null,
      members: members.map(m => ({
        id: m.id,
        username: m.username,
        avatarUrl: getAvatarUrl(m.id, m.avatar_updated_at),
        encryptedKey: m.encrypted_chat_key
      })),
      pinnedMessages: getPinnedMessages(chat.id)
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
    
    const deleteOwnMessages = Boolean(req.body?.deleteMessages);
    const deleteOwnFiles = Boolean(req.body?.deleteFiles);

    if (deleteOwnMessages) {
      removeUserMessagesFromChat(req.params.chatId, req.userId);
    }

    if (deleteOwnFiles) {
      removeUserFilesFromChat(req.params.chatId, req.userId);
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
    
    db.prepare('INSERT INTO chat_members (chat_id, user_id, encrypted_chat_key, last_read_at) VALUES (?, ?, ?, 0)').run(req.params.chatId, userId, encryptedKey);
    
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
    const { userId, deleteMessages, deleteFiles } = req.body;
    
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
    
    if (Boolean(deleteMessages)) {
      removeUserMessagesFromChat(req.params.chatId, userId);
    }

    if (Boolean(deleteFiles)) {
      removeUserFilesFromChat(req.params.chatId, userId);
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
    
    const isMember = db.prepare('SELECT last_read_at FROM chat_members WHERE chat_id = ? AND user_id = ?').get(req.params.chatId, req.userId);
    if (!isMember) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const lastReadAt = isMember.last_read_at || 0;
    
    const { cursor, limit = 50, beforeCnt, afterCnt } = req.query;
    const limitNum = Math.min(parseInt(limit) || 50, 100);
    const beforeCntNum = parseInt(beforeCnt) || 0;
    const afterCntNum = parseInt(afterCnt) || 0;
    
    let messages = [];
    let hasMoreBefore = false;
    let hasMoreAfter = false;
    
    if (beforeCntNum > 0 && cursor) {
      // Load N messages BEFORE cursor
      const cursorMsg = db.prepare('SELECT timestamp FROM messages WHERE id = ?').get(cursor);
      if (cursorMsg) {
        const query = 'SELECT id, chat_id, sender_id, content, reply_to_message_id, timestamp, edited_at FROM messages WHERE chat_id = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?';
        messages = db.prepare(query).all(req.params.chatId, cursorMsg.timestamp, beforeCntNum + 1);
        hasMoreBefore = messages.length > beforeCntNum;
        if (hasMoreBefore) messages.pop();
        messages = messages.reverse();
      }
    } else if (afterCntNum > 0 && cursor) {
      // Load N messages AFTER cursor
      const cursorMsg = db.prepare('SELECT timestamp FROM messages WHERE id = ?').get(cursor);
      if (cursorMsg) {
        const query = 'SELECT id, chat_id, sender_id, content, reply_to_message_id, timestamp, edited_at FROM messages WHERE chat_id = ? AND timestamp > ? ORDER BY timestamp ASC LIMIT ?';
        messages = db.prepare(query).all(req.params.chatId, cursorMsg.timestamp, afterCntNum + 1);
        hasMoreAfter = messages.length > afterCntNum;
        if (hasMoreAfter) messages.pop();
      }
    } else {
      // Default: load last N messages
      let query = 'SELECT id, chat_id, sender_id, content, reply_to_message_id, timestamp, edited_at FROM messages WHERE chat_id = ?';
      const params = [req.params.chatId];
      
      if (cursor) {
        query += ' AND timestamp < (SELECT timestamp FROM messages WHERE id = ?)';
        params.push(cursor);
      }
      
      query += ' ORDER BY timestamp DESC LIMIT ?';
      params.push(limitNum + 1);
      
      messages = db.prepare(query).all(...params);
      
      const hasMore = messages.length > limitNum;
      if (hasMore) {
        messages.pop();
      }
      hasMoreAfter = hasMore;
      messages = messages.reverse();
    }
    
    // Get first unread info
    let firstUnreadId = null;
    let unreadCount = 0;
    
    if (lastReadAt > 0) {
      const unreadInfo = db.prepare(`
        SELECT id, timestamp FROM messages 
        WHERE chat_id = ? AND timestamp > ?
        ORDER BY timestamp ASC LIMIT 1
      `).get(req.params.chatId, lastReadAt);
      
      if (unreadInfo) {
        firstUnreadId = unreadInfo.id;
        unreadCount = db.prepare('SELECT COUNT(*) as count FROM messages WHERE chat_id = ? AND timestamp > ?').get(req.params.chatId, lastReadAt).count;
      }
    }
    
    const fileIdsByMessage = getMessageFileIdsMap(messages.map((message) => message.id));
    const replyPreviewByMessageId = getReplyPreviewByMessageId(messages);

    res.json({
      messages: messages.map((message) => mapMessageRow(message, fileIdsByMessage, replyPreviewByMessageId)),
      hasMoreBefore,
      hasMoreAfter,
      firstUnreadId,
      unreadCount
    });
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:chatId/typing', authenticate, (req, res) => {
  try {
    const chat = db.prepare('SELECT id FROM chats WHERE id = ?').get(req.params.chatId);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(req.params.chatId, req.userId);
    if (!isMember) {
      return res.status(403).json({ error: 'Access denied' });
    }

    broadcastToChatMembers(
      req.params.chatId,
      'typing',
      {
        chatId: req.params.chatId,
        userId: req.userId
      },
      req.userId
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Typing event error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:chatId', authenticate, (req, res) => {
  try {
    const { name, nameLength } = req.body;

    const chat = db.prepare('SELECT id, type, created_by FROM chats WHERE id = ?').get(req.params.chatId);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    if (chat.type !== 'gm') {
      return res.status(400).json({ error: 'Only group chats can be updated' });
    }

    if (chat.created_by !== req.userId) {
      return res.status(403).json({ error: 'Only creator can update group chat' });
    }

    if (typeof name !== 'string' || !name) {
      return res.status(400).json({ error: 'Encrypted chat name is required' });
    }

    const normalizedNameLength = Number(nameLength ?? 0);
    if (!normalizedNameLength || normalizedNameLength > 30) {
      return res.status(400).json({ error: 'Chat name exceeds 30 characters' });
    }

    db.prepare('UPDATE chats SET name = ? WHERE id = ?').run(name, req.params.chatId);

    const updatedChat = db.prepare(`
      SELECT c.id, c.type, c.name, c.created_by, c.created_at, c.avatar_file_id,
        f.updated_at AS avatar_updated_at,
        (SELECT COUNT(*) FROM chat_members WHERE chat_id = c.id) as member_count
      FROM chats c
      LEFT JOIN files f ON f.id = c.avatar_file_id
      WHERE c.id = ?
    `).get(req.params.chatId);

    broadcastToChatMembers(req.params.chatId, 'chat_updated', {
      chatId: req.params.chatId,
      changes: ['name']
    });

    res.json(mapChatRow(updatedChat));
  } catch (err) {
    console.error('Update chat error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:chatId/avatar', authenticate, (req, res) => {
  try {
    const { fileId } = req.body;

    const chat = db.prepare('SELECT id, type, created_by FROM chats WHERE id = ?').get(req.params.chatId);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    if (chat.type !== 'gm') {
      return res.status(400).json({ error: 'Only group chats can have avatar' });
    }

    if (chat.created_by !== req.userId) {
      return res.status(403).json({ error: 'Only creator can update group chat avatar' });
    }

    let avatarFileId = null;
    if (fileId !== null && fileId !== undefined) {
      if (typeof fileId !== 'string' || !fileId) {
        return res.status(400).json({ error: 'fileId must be a non-empty string or null' });
      }

      const file = db.prepare(`
        SELECT id, chat_id, uploaded_by, deleted_at
        FROM files
        WHERE id = ?
      `).get(fileId);

      if (!file || file.chat_id !== req.params.chatId) {
        return res.status(404).json({ error: 'File not found' });
      }

      if (file.uploaded_by !== req.userId) {
        return res.status(403).json({ error: 'Only own file can be used as chat avatar' });
      }

      if (file.deleted_at) {
        return res.status(400).json({ error: 'Placeholder file cannot be used as chat avatar' });
      }

      avatarFileId = file.id;
    }

    db.prepare('UPDATE chats SET avatar_file_id = ? WHERE id = ?').run(avatarFileId, req.params.chatId);

    const updatedChat = db.prepare(`
      SELECT c.id, c.type, c.name, c.created_by, c.created_at, c.avatar_file_id,
        f.updated_at AS avatar_updated_at,
        (SELECT COUNT(*) FROM chat_members WHERE chat_id = c.id) as member_count
      FROM chats c
      LEFT JOIN files f ON f.id = c.avatar_file_id
      WHERE c.id = ?
    `).get(req.params.chatId);

    broadcastToChatMembers(req.params.chatId, 'chat_updated', {
      chatId: req.params.chatId,
      changes: ['avatar']
    });

    res.json(mapChatRow(updatedChat));
  } catch (err) {
    console.error('Update chat avatar error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:chatId/messages', authenticate, (req, res) => {
  try {
    const { content, replyToMessageId } = req.body;
    const fileValidation = validateAttachableFileIds(req.params.chatId, req.body.fileIds);
    if (!fileValidation.ok) {
      return res.status(400).json({
        error: fileValidation.error,
        invalidFileIds: fileValidation.invalidFileIds
      });
    }
    const fileIds = fileValidation.fileIds;
    
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

    if (replyToMessageId !== undefined && replyToMessageId !== null) {
      if (typeof replyToMessageId !== 'string' || !replyToMessageId.trim()) {
        return res.status(400).json({ error: 'replyToMessageId must be a non-empty string or null' });
      }

      const replyTarget = db.prepare('SELECT id FROM messages WHERE id = ? AND chat_id = ?').get(replyToMessageId, req.params.chatId);
      if (!replyTarget) {
        return res.status(400).json({ error: 'Reply target message not found in this chat' });
      }
    }
    
    const messageId = uuidv4();
    
    db.prepare('INSERT INTO messages (id, chat_id, sender_id, content, reply_to_message_id) VALUES (?, ?, ?, ?, ?)').run(
      messageId,
      req.params.chatId,
      req.userId,
      content || null,
      replyToMessageId || null
    );
    setMessageFileIds(messageId, fileIds);

    const message = db.prepare('SELECT id, chat_id, sender_id, content, reply_to_message_id, timestamp, edited_at FROM messages WHERE id = ?').get(messageId);
    
    // Mark sender's messages as read
    db.prepare('UPDATE chat_members SET last_read_at = ? WHERE chat_id = ? AND user_id = ?').run(message.timestamp, req.params.chatId, req.userId);
    
    const response = mapMessageRow(
      message,
      getMessageFileIdsMap([messageId]),
      getReplyPreviewByMessageId([message])
    );
    
    broadcastToChatMembers(req.params.chatId, 'new_message', response, req.userId);
    
    res.status(201).json(response);
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:chatId/pins', authenticate, (req, res) => {
  try {
    const chat = db.prepare('SELECT id FROM chats WHERE id = ?').get(req.params.chatId);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(req.params.chatId, req.userId);
    if (!isMember) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(getPinnedMessages(req.params.chatId));
  } catch (err) {
    console.error('Get pinned messages error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:chatId/pins', authenticate, (req, res) => {
  try {
    const { messageId } = req.body;
    if (typeof messageId !== 'string' || !messageId.trim()) {
      return res.status(400).json({ error: 'messageId is required' });
    }

    const chat = db.prepare('SELECT id FROM chats WHERE id = ?').get(req.params.chatId);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(req.params.chatId, req.userId);
    if (!isMember) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const message = db.prepare('SELECT id FROM messages WHERE id = ? AND chat_id = ?').get(messageId, req.params.chatId);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    db.prepare(`
      INSERT INTO pinned_messages (chat_id, message_id, pinned_by, created_at)
      VALUES (?, ?, ?, strftime('%s', 'now'))
      ON CONFLICT(chat_id, message_id) DO NOTHING
    `).run(req.params.chatId, messageId, req.userId);

    const pinnedMessages = getPinnedMessages(req.params.chatId);
    broadcastToChatMembers(req.params.chatId, 'pins_updated', {
      chatId: req.params.chatId,
      pinnedMessages
    });

    res.status(201).json(pinnedMessages);
  } catch (err) {
    console.error('Pin message error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:chatId/pins/:messageId', authenticate, (req, res) => {
  try {
    const chat = db.prepare('SELECT id FROM chats WHERE id = ?').get(req.params.chatId);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(req.params.chatId, req.userId);
    if (!isMember) {
      return res.status(403).json({ error: 'Access denied' });
    }

    db.prepare('DELETE FROM pinned_messages WHERE chat_id = ? AND message_id = ?').run(req.params.chatId, req.params.messageId);

    const pinnedMessages = getPinnedMessages(req.params.chatId);
    broadcastToChatMembers(req.params.chatId, 'pins_updated', {
      chatId: req.params.chatId,
      pinnedMessages
    });

    res.json(pinnedMessages);
  } catch (err) {
    console.error('Unpin message error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:chatId/read', authenticate, (req, res) => {
  try {
    const chat = db.prepare('SELECT id FROM chats WHERE id = ?').get(req.params.chatId);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(req.params.chatId, req.userId);
    if (!isMember) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const lastMessage = db.prepare('SELECT MAX(timestamp) as max FROM messages WHERE chat_id = ?').get(req.params.chatId);
    const lastReadAt = lastMessage.max || 0;
    
    db.prepare('UPDATE chat_members SET last_read_at = ? WHERE chat_id = ? AND user_id = ?').run(lastReadAt, req.params.chatId, req.userId);
    
    res.json({ success: true, lastReadAt });
  } catch (err) {
    console.error('Mark as read error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
