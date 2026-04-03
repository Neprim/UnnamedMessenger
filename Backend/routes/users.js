const express = require('express');
const fs = require('fs');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const config = require('../config');
const sse = require('../sse');
const {
  ensureAvatarDir,
  getAvatarFilePath,
  getAvatarUrl,
  removeAvatarFile
} = require('../utils/avatar');
const { mapMessageRow } = require('../utils/message-files');

const router = express.Router();

function createSystemMessage(chatId, eventType, data) {
  const messageId = uuidv4();
  const content = JSON.stringify({ event: eventType, ...data });
  const timestamp = Math.floor(Date.now() / 1000);

  db.prepare(
    'INSERT INTO messages (id, chat_id, sender_id, content, timestamp) VALUES (?, ?, NULL, ?, ?)'
  ).run(messageId, chatId, content, timestamp);

  const message = db.prepare(
    'SELECT id, chat_id, sender_id, content, timestamp, edited_at FROM messages WHERE id = ?'
  ).get(messageId);

  return mapMessageRow(message);
}

function mapUser(user) {
  return {
    id: user.id,
    username: user.username,
    publicKey: user.public_key,
    avatarUpdatedAt: user.avatar_updated_at,
    avatarUrl: getAvatarUrl(user.id, user.avatar_updated_at),
    createdAt: user.created_at
  };
}

async function normalizeAvatar(buffer) {
  if (!buffer?.length) {
    throw new Error('Avatar file is required');
  }

  if (buffer.length > config.limits.avatarMaxBytes) {
    throw new Error('Avatar exceeds 5 MB');
  }

  const image = sharp(buffer, {
    animated: false,
    limitInputPixels: config.limits.avatarMaxSize * config.limits.avatarMaxSize
  });
  const metadata = await image.metadata();

  if (!metadata.format || !['jpeg', 'png', 'webp'].includes(metadata.format)) {
    throw new Error('Only JPEG, PNG, and WebP avatars are supported');
  }

  if (!metadata.width || !metadata.height) {
    throw new Error('Unable to determine image dimensions');
  }

  if (metadata.width < config.limits.avatarMinSize || metadata.height < config.limits.avatarMinSize) {
    throw new Error(`Avatar must be at least ${config.limits.avatarMinSize}x${config.limits.avatarMinSize}`);
  }

  if (metadata.width > config.limits.avatarMaxSize || metadata.height > config.limits.avatarMaxSize) {
    throw new Error(`Avatar must not exceed ${config.limits.avatarMaxSize}x${config.limits.avatarMaxSize}`);
  }

  const ratio = metadata.width / metadata.height;
  if (ratio > config.limits.avatarMaxRatio || ratio < 1 / config.limits.avatarMaxRatio) {
    throw new Error('Avatar aspect ratio is too extreme');
  }

  return sharp(buffer, { animated: false })
    .resize(config.limits.avatarStorageSize, config.limits.avatarStorageSize, { fit: 'cover', position: 'centre' })
    .webp({ quality: 90 })
    .toBuffer();
}

router.get('/me', authenticate, (req, res) => {
  try {
    const user = db.prepare('SELECT id, username, public_key, avatar_updated_at, created_at FROM users WHERE id = ?').get(req.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(mapUser(user));
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

    const user = db.prepare('SELECT id, username, public_key, avatar_updated_at, created_at FROM users WHERE id = ?').get(req.userId);
    res.json(mapUser(user));
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/me/avatar',
  authenticate,
  express.raw({
    type: ['image/jpeg', 'image/png', 'image/webp'],
    limit: `${config.limits.avatarMaxBytes}b`
  }),
  async (req, res) => {
    try {
      ensureAvatarDir();

      const normalizedAvatar = await normalizeAvatar(req.body);
      const avatarUpdatedAt = Math.floor(Date.now() / 1000);
      const avatarPath = getAvatarFilePath(req.userId);

      fs.writeFileSync(avatarPath, normalizedAvatar);
      db.prepare('UPDATE users SET avatar_updated_at = ? WHERE id = ?').run(avatarUpdatedAt, req.userId);

      res.json({
        avatarUpdatedAt,
        avatarUrl: getAvatarUrl(req.userId, avatarUpdatedAt)
      });
    } catch (err) {
      console.error('Upload avatar error:', err);
      const message = err instanceof Error ? err.message : 'Failed to upload avatar';
      res.status(400).json({ error: message });
    }
  }
);

router.delete('/me/avatar', authenticate, (req, res) => {
  try {
    removeAvatarFile(req.userId);
    db.prepare('UPDATE users SET avatar_updated_at = NULL WHERE id = ?').run(req.userId);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete avatar error:', err);
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
      removeAvatarFile(req.userId);

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

    const users = db
      .prepare('SELECT id, username, public_key, avatar_updated_at FROM users WHERE username LIKE ? LIMIT 20')
      .all(`%${q}%`);

    res.json(
      users.map((user) => ({
        id: user.id,
        username: user.username,
        publicKey: user.public_key,
        avatarUpdatedAt: user.avatar_updated_at,
        avatarUrl: getAvatarUrl(user.id, user.avatar_updated_at)
      }))
    );
  } catch (err) {
    console.error('Search users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:userId/avatar', authenticate, (req, res) => {
  try {
    const user = db.prepare('SELECT id, avatar_updated_at FROM users WHERE id = ?').get(req.params.userId);
    if (!user || !user.avatar_updated_at) {
      return res.status(404).json({ error: 'Avatar not found' });
    }

    const avatarPath = getAvatarFilePath(req.params.userId);
    if (!fs.existsSync(avatarPath)) {
      return res.status(404).json({ error: 'Avatar not found' });
    }

    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(avatarPath);
  } catch (err) {
    console.error('Get avatar error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
