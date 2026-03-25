const express = require('express');
const router = express.Router();

router.get('/:chatId/messages', (req, res) => {
  res.status(200).json({ message: 'Get messages - TODO' });
});

router.post('/:chatId/messages', (req, res) => {
  res.status(201).json({ message: 'Send message - TODO' });
});

router.put('/:messageId', (req, res) => {
  res.status(200).json({ message: 'Edit message - TODO' });
});

router.delete('/:messageId', (req, res) => {
  res.status(200).json({ message: 'Delete message - TODO' });
});

module.exports = router;