const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const { authenticate } = require('../middleware/auth');
const { getAvatarUrl } = require('../utils/avatar');

const router = express.Router();

function generateSalt() {
  return crypto.randomBytes(32).toString('base64');
}

router.post('/register', async (req, res) => {
  try {
    const { username, password, publicKey } = req.body;
    
    if (!username || !password || !publicKey) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existingUser) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    const salt = generateSalt();
    const userId = uuidv4();
    
    db.prepare('INSERT INTO users (id, username, password_hash, public_key, salt) VALUES (?, ?, ?, ?, ?)').run(userId, username, passwordHash, publicKey, salt);
    
    const token = jwt.sign({ userId }, config.jwt.secret, { expiresIn: config.jwt.maxAge });
    
    res.cookie(config.cookie.name, token, {
      httpOnly: true,
      maxAge: config.cookie.maxAge,
      sameSite: 'strict'
    });

    console.log(`Пользователь "${username}" зарегистрировался.`)
    
    res.status(201).json({ id: userId, username, salt, token });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Missing credentials' });
    }
    
    const user = db.prepare('SELECT id, username, password_hash, salt, public_key, avatar_updated_at FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign({ userId: user.id }, config.jwt.secret, { expiresIn: config.jwt.maxAge });
    
    res.cookie(config.cookie.name, token, {
      httpOnly: true,
      maxAge: config.cookie.maxAge,
      sameSite: 'strict'
    });
    
    res.json({
      id: user.id,
      username,
      salt: user.salt,
      publicKey: user.public_key,
      avatarUpdatedAt: user.avatar_updated_at,
      avatarUrl: getAvatarUrl(user.id, user.avatar_updated_at),
      token
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(config.cookie.name);
  res.json({ message: 'Logged out' });
});

router.post('/change-password', async (req, res) => {
  try {
    const { newPassword } = req.body;
    
    if (!newPassword) {
      return res.status(400).json({ error: 'New password required' });
    }
    
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const newSalt = generateSalt();
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    
    db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').run(newPasswordHash, newSalt, userId);
    
    res.json({ salt: newSalt });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
