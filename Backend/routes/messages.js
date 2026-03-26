const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const config = require('../config');
const sse = require('../sse');

const router = express.Router();

function broadcastToChatMembers(chatId, eventType, data, excludeUserId = null) {
  const members = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(chatId);
  members.forEach(member => {
    if (member.user_id !== excludeUserId) {
      sse.broadcast(member.user_id, { type: eventType, data });
    }
  });
}

router.put('/:messageId', authenticate, (req, res) => {
  try {
    const { content, fileIds } = req.body;
    
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
    
    if (!content && (!fileIds || fileIds.length === 0)) {
      return res.status(400).json({ error: 'Content or fileIds required' });
    }
    
    if (content && content.length > config.limits.maxMessageLength) {
      return res.status(400).json({ error: `Message exceeds ${config.limits.maxMessageLength} characters` });
    }
    
    db.prepare('UPDATE messages SET content = ?, file_ids = ?, edited_at = datetime(\'now\') WHERE id = ?').run(content || null, fileIds ? JSON.stringify(fileIds) : null, req.params.messageId);
    
    const updated = db.prepare('SELECT id, sender_id, content, file_ids, timestamp, edited_at FROM messages WHERE id = ?').get(req.params.messageId);
    
    const response = {
      id: updated.id,
      senderId: updated.sender_id,
      content: updated.content,
      fileIds: updated.file_ids ? JSON.parse(updated.file_ids) : [],
      timestamp: updated.timestamp,
      editedAt: updated.edited_at
    };
    
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
    
    db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.messageId);
    
    broadcastToChatMembers(message.chat_id, 'message_deleted', { messageId: req.params.messageId }, req.userId);
    
    res.json({ message: 'Message deleted' });
  } catch (err) {
    console.error('Delete message error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;