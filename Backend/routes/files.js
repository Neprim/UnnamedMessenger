const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const config = require('../config');

const router = express.Router();

const RAW_BODY_TYPES = ['application/octet-stream'];

function mapFileRow(file) {
  return {
    id: file.id,
    chatId: file.chat_id,
    uploadedBy: file.uploaded_by,
    size: file.size,
    createdAt: file.created_at,
    updatedAt: file.updated_at,
    deletedAt: file.deleted_at
  };
}

function getUserQuotaBytes(userId) {
  const user = db
    .prepare('SELECT file_quota_bytes FROM users WHERE id = ?')
    .get(userId);

  return user?.file_quota_bytes ?? config.limits.defaultFileQuotaBytes;
}

function getUsedQuotaBytes(userId) {
  const result = db
    .prepare(
      `SELECT COALESCE(SUM(size), 0) AS total
       FROM files
       WHERE uploaded_by = ? AND deleted_at IS NULL`
    )
    .get(userId);

  return result?.total ?? 0;
}

function parseMetadataHeader(req) {
  const encodedMetadata = req.get('x-file-metadata');
  if (!encodedMetadata) {
    return null;
  }

  try {
    const metadata = Buffer.from(encodedMetadata, 'base64');
    return metadata.length > 0 ? metadata : null;
  } catch {
    return null;
  }
}

function requireChatMembership(chatId, userId) {
  const membership = db
    .prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?')
    .get(chatId, userId);

  return Boolean(membership);
}

function getOwnedFile(fileId, userId) {
  return db
    .prepare(
      `SELECT id, chat_id, uploaded_by, size, created_at, updated_at, deleted_at
       FROM files
       WHERE id = ? AND uploaded_by = ?`
    )
    .get(fileId, userId);
}

router.get('/me', authenticate, (req, res) => {
  try {
    const files = db
      .prepare(
        `SELECT
           f.id,
           f.chat_id,
           f.uploaded_by,
           f.size,
           f.created_at,
           f.updated_at,
           f.deleted_at,
           CASE WHEN c.avatar_file_id = f.id THEN 1 ELSE 0 END AS is_avatar
         FROM files f
         LEFT JOIN chats c ON c.avatar_file_id = f.id
         WHERE f.uploaded_by = ?
         ORDER BY f.updated_at DESC, f.created_at DESC`
      )
      .all(req.userId);

    res.json({
      quotaBytes: getUserQuotaBytes(req.userId),
      usedBytes: getUsedQuotaBytes(req.userId),
      files: files.map((file) => ({
        ...mapFileRow(file),
        isAvatar: Boolean(file.is_avatar)
      }))
    });
  } catch (err) {
    console.error('Get user files error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/me/:fileId', authenticate, (req, res) => {
  try {
    const file = getOwnedFile(req.params.fileId, req.userId);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    db.prepare('DELETE FROM files WHERE id = ?').run(req.params.fileId);

    res.json({
      success: true,
      fileId: req.params.fileId,
      quotaBytes: getUserQuotaBytes(req.userId),
      usedBytes: getUsedQuotaBytes(req.userId)
    });
  } catch (err) {
    console.error('Delete file error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put(
  '/me/:fileId/placeholder',
  authenticate,
  express.raw({
    type: RAW_BODY_TYPES,
    limit: `${config.limits.maxPlaceholderBytes}b`
  }),
  (req, res) => {
    try {
      const file = getOwnedFile(req.params.fileId, req.userId);
      if (!file) {
        return res.status(404).json({ error: 'File not found' });
      }

      const content = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const metadata = parseMetadataHeader(req);

      if (!content.length) {
        return res.status(400).json({ error: 'Placeholder content is required' });
      }

      if (!metadata) {
        return res.status(400).json({ error: 'x-file-metadata header is required' });
      }

      const placeholderSize = content.length + metadata.length;
      if (placeholderSize > config.limits.maxPlaceholderBytes) {
        return res.status(400).json({ error: 'Placeholder exceeds 10 KB' });
      }

      const updatedAt = Math.floor(Date.now() / 1000);

      db.prepare(
        `UPDATE files
         SET content = ?, metadata = ?, size = ?, updated_at = ?, deleted_at = ?
         WHERE id = ?`
      ).run(content, metadata, placeholderSize, updatedAt, updatedAt, req.params.fileId);

      const updatedFile = db
        .prepare(
          `SELECT id, chat_id, uploaded_by, size, created_at, updated_at, deleted_at
           FROM files
           WHERE id = ?`
        )
        .get(req.params.fileId);

      res.json({
        file: mapFileRow(updatedFile),
        quotaBytes: getUserQuotaBytes(req.userId),
        usedBytes: getUsedQuotaBytes(req.userId)
      });
    } catch (err) {
      console.error('Replace file with placeholder error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.get('/:chatId/files', authenticate, (req, res) => {
  try {
    if (!requireChatMembership(req.params.chatId, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const files = db
      .prepare(
        `SELECT id, chat_id, uploaded_by, size, created_at, updated_at, deleted_at
         FROM files
         WHERE chat_id = ?
         ORDER BY updated_at DESC, created_at DESC`
      )
      .all(req.params.chatId);

    res.json(files.map(mapFileRow));
  } catch (err) {
    console.error('Get chat files error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:chatId/files/metadata', authenticate, (req, res) => {
  try {
    if (!requireChatMembership(req.params.chatId, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const files = db
      .prepare(
        `SELECT id, size, metadata, created_at, updated_at, deleted_at
         FROM files
         WHERE chat_id = ?
         ORDER BY updated_at DESC, created_at DESC`
      )
      .all(req.params.chatId);

    res.json(
      files.map((file) => ({
        fileId: file.id,
        metadata: file.metadata.toString('base64'),
        size: file.size,
        createdAt: file.created_at,
        updatedAt: file.updated_at,
        deletedAt: file.deleted_at
      }))
    );
  } catch (err) {
    console.error('Get chat files metadata error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/:chatId/files',
  authenticate,
  express.raw({
    type: RAW_BODY_TYPES,
    limit: `${config.limits.maxUploadBytes}b`
  }),
  (req, res) => {
    try {
      if (!requireChatMembership(req.params.chatId, req.userId)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const content = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const metadata = parseMetadataHeader(req);

      if (!content.length) {
        return res.status(400).json({ error: 'File content is required' });
      }

      if (!metadata) {
        return res.status(400).json({ error: 'x-file-metadata header is required' });
      }

      const storedSize = content.length + metadata.length;
      const quotaBytes = getUserQuotaBytes(req.userId);
      const usedBytes = getUsedQuotaBytes(req.userId);

      if (usedBytes + storedSize > quotaBytes) {
        return res.status(409).json({
          error: 'File quota exceeded',
          quotaBytes,
          usedBytes,
          requiredBytes: storedSize
        });
      }

      const fileId = uuidv4();
      const now = Math.floor(Date.now() / 1000);

      db.prepare(
        `INSERT INTO files (
           id,
           chat_id,
           uploaded_by,
           content,
           metadata,
           size,
           created_at,
           updated_at,
           deleted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      ).run(fileId, req.params.chatId, req.userId, content, metadata, storedSize, now, now);

      res.status(201).json({
        file: {
          id: fileId,
          chatId: req.params.chatId,
          uploadedBy: req.userId,
          size: storedSize,
          createdAt: now,
          updatedAt: now,
          deletedAt: null
        },
        quotaBytes,
        usedBytes: usedBytes + storedSize
      });
    } catch (err) {
      console.error('Upload file error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.get('/:chatId/files/:fileId', authenticate, (req, res) => {
  try {
    if (!requireChatMembership(req.params.chatId, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const file = db
      .prepare(
        `SELECT id, chat_id, uploaded_by, content, metadata, size, created_at, updated_at, deleted_at
         FROM files
         WHERE id = ? AND chat_id = ?`
      )
      .get(req.params.fileId, req.params.chatId);

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', file.content.length);
    res.setHeader('X-File-Size', String(file.size));
    res.setHeader('X-File-Updated-At', String(file.updated_at));
    res.setHeader('X-File-Created-At', String(file.created_at));
    if (file.deleted_at) {
      res.setHeader('X-File-Deleted-At', String(file.deleted_at));
    }

    res.send(file.content);
  } catch (err) {
    console.error('Download file error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:chatId/files/:fileId/metadata', authenticate, (req, res) => {
  try {
    if (!requireChatMembership(req.params.chatId, req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const file = db
      .prepare(
        `SELECT id, size, metadata, created_at, updated_at, deleted_at
         FROM files
         WHERE id = ? AND chat_id = ?`
      )
      .get(req.params.fileId, req.params.chatId);

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.json({
      fileId: file.id,
      metadata: file.metadata.toString('base64'),
      size: file.size,
      createdAt: file.created_at,
      updatedAt: file.updated_at,
      deletedAt: file.deleted_at
    });
  } catch (err) {
    console.error('Get file metadata error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:chatId/files/:fileId', authenticate, (req, res) => {
  try {
    const file = getOwnedFile(req.params.fileId, req.userId);
    if (!file || file.chat_id !== req.params.chatId) {
      return res.status(404).json({ error: 'File not found' });
    }

    db.prepare('DELETE FROM files WHERE id = ?').run(req.params.fileId);

    res.json({
      success: true,
      fileId: req.params.fileId,
      quotaBytes: getUserQuotaBytes(req.userId),
      usedBytes: getUsedQuotaBytes(req.userId)
    });
  } catch (err) {
    console.error('Delete file from chat error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
