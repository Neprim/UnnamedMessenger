const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const config = require('../config');
const sse = require('../sse');

const router = express.Router();

function createSystemMessage(chatId, eventType, data) {
  const messageId = uuidv4();
  const content = JSON.stringify({ event: eventType, ...data });
  const timestamp = Math.floor(Date.now() / 1000);

  db.prepare(
    'INSERT INTO messages (id, chat_id, sender_id, content, timestamp) VALUES (?, ?, NULL, ?, ?)'
  ).run(messageId, chatId, content, timestamp);

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

router.get('/me', authenticate, (req, res) => {
  try {
    const user = db.prepare('SELECT id, username, public_key, created_at FROM users WHERE id = ?').get(req.userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      id: user.id,
      username: user.username,
      publicKey: user.public_key,
      createdAt: user.created_at
    });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/me', authenticate, (req, res) => {
  try {
    const { username } = req.body;
    
    if (!username) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    if (username.length > config.limits.maxUsernameLength) {
      return res.status(400).json({ error: `Username exceeds ${config.limits.maxUsernameLength} characters` });
    }
    
    const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, req.userId);
    if (existing) {
      return res.status(409).json({ error: 'Username already taken' });
    }
    
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, req.userId);
    
    const user = db.prepare('SELECT id, username, public_key FROM users WHERE id = ?').get(req.userId);
    
    res.json({
      id: user.id,
      username: user.username,
      publicKey: user.public_key
    });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/me', authenticate, (req, res) => {
  try {
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const result = db.transaction(() => {
      const memberships = db.prepare(`
        SELECT c.id, c.type, c.created_by
        FROM chat_members cm
        JOIN chats c ON c.id = cm.chat_id
        WHERE cm.user_id = ?
      `).all(req.userId);

      const deletedChats = [];
      const updatedChats = [];

      for (const membership of memberships) {
        const members = db.prepare('SELECT user_id, joined_at FROM chat_members WHERE chat_id = ? ORDER BY joined_at ASC').all(membership.id);
        const otherMemberIds = members.filter((member) => member.user_id !== req.userId).map((member) => member.user_id);
        const shouldDeleteChat = membership.type === 'pm' || members.length === 1;

        if (shouldDeleteChat) {
          db.prepare('DELETE FROM messages WHERE chat_id = ?').run(membership.id);
          db.prepare('DELETE FROM chat_members WHERE chat_id = ?').run(membership.id);
          db.prepare('DELETE FROM chats WHERE id = ?').run(membership.id);

          deletedChats.push({
            chatId: membership.id,
            notifyUserIds: otherMemberIds
          });
          continue;
        }

        db.prepare('DELETE FROM messages WHERE chat_id = ? AND sender_id = ?').run(membership.id, req.userId);
        db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run(membership.id, req.userId);

        if (membership.created_by === req.userId) {
          const nextCreator = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ? ORDER BY joined_at ASC LIMIT 1').get(membership.id);
          if (nextCreator) {
            db.prepare('UPDATE chats SET created_by = ? WHERE id = ?').run(nextCreator.user_id, membership.id);
          }
        }

        const memberCount = db.prepare('SELECT COUNT(*) as count FROM chat_members WHERE chat_id = ?').get(membership.id).count;
        const systemMsg = createSystemMessage(membership.id, 'member_removed', { username: user.username, userId: req.userId });

        updatedChats.push({
          chatId: membership.id,
          notifyUserIds: otherMemberIds,
          memberCount,
          systemMsg
        });
      }

      db.prepare('DELETE FROM users WHERE id = ?').run(req.userId);

      return { deletedChats, updatedChats };
    })();

    result.deletedChats.forEach(({ chatId, notifyUserIds }) => {
      notifyUserIds.forEach((userId) => {
        sse.broadcast(userId, { type: 'chat_deleted', data: { chatId } });
      });
    });

    result.updatedChats.forEach(({ chatId, notifyUserIds, memberCount, systemMsg }) => {
      notifyUserIds.forEach((userId) => {
        sse.broadcast(userId, {
          type: 'member_removed',
          data: {
            message: systemMsg,
            username: user.username,
            userId: req.userId,
            chatId,
            memberCount
          }
        });

        sse.broadcast(userId, {
          type: 'chat_updated',
          data: { chatId }
        });
      });
    });

    res.clearCookie(config.cookie.name);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/search', authenticate, (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.length < 1) {
      return res.status(400).json({ error: 'Query parameter required' });
    }
    
    const users = db.prepare('SELECT id, username, public_key FROM users WHERE username LIKE ? LIMIT 20').all(`%${q}%`);
    
    res.json(users.map(u => ({
      id: u.id,
      username: u.username,
      publicKey: u.public_key
    })));
  } catch (err) {
    console.error('Search users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
