const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const config = require('../config');
const sse = require('../sse');
const {
  validateAttachableFileIds,
  setMessageFileIds,
  mapMessageRow
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
    const { content } = req.body;
    
    const message = db.prepare('SELECT chat_id, sender_id FROM messages WHERE id = ?').get(req.params.messageId);
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
    
    if (content && content.length > config.limits.maxMessageLength) {
      return res.status(400).json({ error: `Message exceeds ${config.limits.maxMessageLength} characters` });
    }
    
    const editedAt = Math.floor(Date.now() / 1000);
    db.prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?').run(
      content || null,
      editedAt,
      req.params.messageId
    );
    setMessageFileIds(req.params.messageId, fileIds);

    const updated = db.prepare('SELECT id, chat_id, sender_id, content, timestamp, edited_at FROM messages WHERE id = ?').get(req.params.messageId);

    const response = mapMessageRow(updated);
    
    broadcastToChatMembers(message.chat_id, 'message_edited', response, req.userId);
    
    res.json(response);
  } catch (err) {
    console.error('Edit message error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:messageId', authenticate, (req, res) => {
  try {
    const message = db.prepare('SELECT chat_id, sender_id FROM messages WHERE id = ?').get(req.params.messageId);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    if (message.sender_id !== req.userId) {
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
    const deletedFileIds = [];

    db.transaction(() => {
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
    
    broadcastToChatMembers(
      message.chat_id,
      'message_deleted',
      { messageId: req.params.messageId, chatId: message.chat_id, deletedFileIds },
      req.userId
    );
    
    res.json({ message: 'Message deleted', deletedFileIds });
  } catch (err) {
    console.error('Delete message error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
