const express = require('express');
const router = express.Router();

router.get('/me', (req, res) => {
  res.status(200).json({ message: 'Get user files - TODO' });
});

router.delete('/me/:fileId', (req, res) => {
  res.status(200).json({ message: 'Delete file globally - TODO' });
});

router.get('/:chatId/files', (req, res) => {
  res.status(200).json({ message: 'Get chat files - TODO' });
});

router.post('/:chatId/files', (req, res) => {
  res.status(201).json({ message: 'Upload file - TODO' });
});

router.get('/:chatId/files/:fileId', (req, res) => {
  res.status(200).json({ message: 'Download file - TODO' });
});

router.delete('/:chatId/files/:fileId', (req, res) => {
  res.status(200).json({ message: 'Delete file from chat - TODO' });
});

module.exports = router;