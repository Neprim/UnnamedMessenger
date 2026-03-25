const express = require('express');
const router = express.Router();

router.get('/me', (req, res) => {
  res.status(200).json({ message: 'Get current user - TODO' });
});

router.put('/me', (req, res) => {
  res.status(200).json({ message: 'Update current user - TODO' });
});

router.get('/search', (req, res) => {
  res.status(200).json({ message: 'Search users - TODO' });
});

module.exports = router;