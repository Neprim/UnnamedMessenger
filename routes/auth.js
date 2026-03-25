const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const config = require('../config');

const router = express.Router();

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
    const userId = uuidv4();
    
    db.prepare('INSERT INTO users (id, username, password_hash, public_key) VALUES (?, ?, ?, ?)').run(userId, username, passwordHash, publicKey);
    
    const token = jwt.sign({ userId }, config.jwt.secret, { expiresIn: config.jwt.maxAge });
    
    res.cookie(config.cookie.name, token, {
      httpOnly: true,
      maxAge: config.cookie.maxAge,
      sameSite: 'strict'
    });
    
    res.status(201).json({ id: userId, username });
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
    
    const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
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
    
    res.json({ id: user.id, username });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(config.cookie.name);
  res.json({ message: 'Logged out' });
});

module.exports = router;