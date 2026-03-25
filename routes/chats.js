const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.status(200).json({ message: 'Get chats - TODO' });
});

router.post('/', (req, res) => {
  res.status(201).json({ message: 'Create chat - TODO' });
});

router.get('/:chatId', (req, res) => {
  res.status(200).json({ message: 'Get chat - TODO' });
});

router.delete('/:chatId', (req, res) => {
  res.status(200).json({ message: 'Delete chat - TODO' });
});

router.post('/:chatId/members/add', (req, res) => {
  res.status(201).json({ message: 'Add member - TODO' });
});

router.post('/:chatId/members/remove', (req, res) => {
  res.status(200).json({ message: 'Remove member - TODO' });
});

module.exports = router;