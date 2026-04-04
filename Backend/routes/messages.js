const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const config = require('../config');
const sse = require('../sse');
const {
  validateAttachableFileIds,
  setMessageFileIds,
  getMessageFileIdsMap,
  getReplyPreviewByMessageId,
  mapMessageRow,
  encodeEncryptedMessageContent
} = require('../utils/message-files');

const router = express.Router();

function broadcastToChatMembers(chatId, eventType, data, excludeUserId = null) {
  const members = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(chatId);
  members.forEach(member => {
    if (member.user_id !== excludeUserId) {
      sse.broadcast(member.user_id, { type: eventType, data });
    }
  });
}

function getMessageFileIds(messageId) {
  return db
    .prepare('SELECT file_id FROM message_files WHERE message_id = ? ORDER BY position ASC')
    .all(messageId)
    .map((row) => row.file_id);
}

router.put('/:messageId', authenticate, (req, res) => {
  try {
    const { content, contentLength = 0, replyToMessageId } = req.body;
    
    const message = db.prepare(`
      SELECT m.chat_id, m.sender_id, c.type AS chat_type, c.created_by
      FROM messages m
      JOIN chats c ON c.id = m.chat_id
      WHERE m.id = ?
    `).get(req.params.messageId);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    if (message.sender_id !== req.userId) {
      return res.status(403).json({ error: 'Cannot edit other\'s messages' });
    }
    
    const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(message.chat_id, req.userId);
    if (!isMember) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const fileValidation = validateAttachableFileIds(message.chat_id, req.body.fileIds);
    if (!fileValidation.ok) {
      return res.status(400).json({
        error: fileValidation.error,
        invalidFileIds: fileValidation.invalidFileIds
      });
    }
    const fileIds = fileValidation.fileIds;
    
    if (!content && (!fileIds || fileIds.length === 0)) {
      return res.status(400).json({ error: 'Content or fileIds required' });
    }
    
    const normalizedContentLength = Number(contentLength || 0);
    if (normalizedContentLength > 0 && normalizedContentLength > config.limits.maxMessageLength) {
      return res.status(400).json({ error: `Message exceeds ${config.limits.maxMessageLength} characters` });
    }

    let encodedContent = null;
    if (content) {
      try {
        encodedContent = encodeEncryptedMessageContent(content);
      } catch {
        return res.status(400).json({ error: 'Invalid encrypted message payload' });
      }
    }

    if (replyToMessageId !== undefined && replyToMessageId !== null) {
      if (typeof replyToMessageId !== 'string' || !replyToMessageId.trim()) {
        return res.status(400).json({ error: 'replyToMessageId must be a non-empty string or null' });
      }

      const replyTarget = db.prepare('SELECT id FROM messages WHERE id = ? AND chat_id = ?').get(replyToMessageId, message.chat_id);
      if (!replyTarget) {
        return res.status(400).json({ error: 'Reply target message not found in this chat' });
      }
    }
    
    const editedAt = Math.floor(Date.now() / 1000);
    db.prepare('UPDATE messages SET content = ?, reply_to_message_id = ?, edited_at = ? WHERE id = ?').run(
      encodedContent,
      replyToMessageId || null,
      editedAt,
      req.params.messageId
    );
    setMessageFileIds(req.params.messageId, fileIds);

    const updated = db.prepare('SELECT id, chat_id, sender_id, content, reply_to_message_id, timestamp, edited_at FROM messages WHERE id = ?').get(req.params.messageId);

    const response = mapMessageRow(
      updated,
      getMessageFileIdsMap([updated.id]),
      getReplyPreviewByMessageId([updated])
    );
    
    broadcastToChatMembers(message.chat_id, 'message_edited', response, req.userId);
    
    res.json(response);
  } catch (err) {
    console.error('Edit message error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:messageId', authenticate, (req, res) => {
  try {
    const message = db.prepare(`
      SELECT m.chat_id, m.sender_id, c.type AS chat_type, c.created_by
      FROM messages m
      JOIN chats c ON c.id = m.chat_id
      WHERE m.id = ?
    `).get(req.params.messageId);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    const canDeleteOwn = message.sender_id === req.userId;
    const canDeleteAsCreator = message.chat_type === 'gm' && message.created_by === req.userId;

    if (!canDeleteOwn && !canDeleteAsCreator) {
      return res.status(403).json({ error: 'Cannot delete other\'s messages' });
    }
    
    const isMember = db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(message.chat_id, req.userId);
    if (!isMember) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const fileIds = getMessageFileIds(req.params.messageId);
    const deleteMessage = db.prepare('DELETE FROM messages WHERE id = ?');
    const countFileLinks = db.prepare('SELECT COUNT(*) as count FROM message_files WHERE file_id = ?');
    const avatarUsage = db.prepare('SELECT 1 FROM chats WHERE avatar_file_id = ? LIMIT 1');
    const deleteFile = db.prepare('DELETE FROM files WHERE id = ?');
    const deletePins = db.prepare('DELETE FROM pinned_messages WHERE message_id = ?');
    const deletedFileIds = [];

    db.transaction(() => {
      deletePins.run(req.params.messageId);
      deleteMessage.run(req.params.messageId);

      for (const fileId of fileIds) {
        const referencesCount = countFileLinks.get(fileId)?.count ?? 0;
        if (referencesCount > 0) {
          continue;
        }

        const isAvatarInUse = avatarUsage.get(fileId);
        if (isAvatarInUse) {
          continue;
        }

        deleteFile.run(fileId);
        deletedFileIds.push(fileId);
      }
    })();
    
    const pinnedMessages = db.prepare(`
      SELECT pm.chat_id, pm.message_id, pm.pinned_by, pm.created_at,
        u.username AS pinned_by_username,
        m.id, m.chat_id, m.sender_id, m.content, m.reply_to_message_id, m.timestamp, m.edited_at
      FROM pinned_messages pm
      JOIN messages m ON m.id = pm.message_id
      LEFT JOIN users u ON u.id = pm.pinned_by
      WHERE pm.chat_id = ?
      ORDER BY pm.created_at ASC
    `).all(message.chat_id);
    const pinnedFileIdsByMessage = getMessageFileIdsMap(pinnedMessages.map((row) => row.id));
    const pinnedReplyPreviewByMessageId = getReplyPreviewByMessageId(pinnedMessages);

    broadcastToChatMembers(
      message.chat_id,
      'message_deleted',
      {
        messageId: req.params.messageId,
        chatId: message.chat_id,
        deletedFileIds,
        pinnedMessages: pinnedMessages.map((row) => ({
          chatId: row.chat_id,
          pinnedBy: row.pinned_by,
          pinnedByUsername: row.pinned_by_username ?? 'Unknown',
          pinnedAt: row.created_at,
          message: mapMessageRow(row, pinnedFileIdsByMessage, pinnedReplyPreviewByMessageId)
        }))
      },
      req.userId
    );
    
    res.json({ message: 'Message deleted', deletedFileIds, pinnedMessages: pinnedMessages.map((row) => ({
      chatId: row.chat_id,
      pinnedBy: row.pinned_by,
      pinnedByUsername: row.pinned_by_username ?? 'Unknown',
      pinnedAt: row.created_at,
      message: mapMessageRow(row, pinnedFileIdsByMessage, pinnedReplyPreviewByMessageId)
    })) });
  } catch (err) {
    console.error('Delete message error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
