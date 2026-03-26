const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

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