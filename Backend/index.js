const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const swaggerUi = require('swagger-ui-express');
const fs = require('fs');
const path = require('path');

const app = express();

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

const openApiSpec = JSON.parse(fs.readFileSync(path.join(__dirname, 'openapi.json'), 'utf8'));

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

app.get('/', (req, res) => {
  res.send('UnnamedMessenger API');
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/chats', require('./routes/chats'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/files', require('./routes/files'));

const sse = require('./sse');

app.get('/api/events', (req, res) => {
  let token = req.cookies.token || req.query.token;
  
  if (!token && req.headers.authorization) {
    const authHeader = req.headers.authorization;
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
  }
  
  if (!token) {
    res.setHeader('Content-Type', 'text/plain');
    res.status(401).end('Unauthorized');
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  try {
    const jwt = require('jsonwebtoken');
    const config = require('./config');
    const decoded = jwt.verify(token, config.jwt.secret);
    const userId = decoded.userId;

    sse.subscribe(userId, res);

    res.on('close', () => {
      sse.unsubscribe(userId, res);
    });
  } catch (err) {
    res.setHeader('Content-Type', 'text/plain');
    res.status(401).end('Unauthorized');
  }
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;