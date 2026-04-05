const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const swaggerUi = require('swagger-ui-express');
const https = require('https');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');
if (typeof process.loadEnvFile === 'function' && fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const config = require('./config');
const { logServerError, safeConsoleError, safeConsoleInfo } = require('./utils/logger');

console.error = (...args) => safeConsoleError(...args);
console.log = (...args) => safeConsoleInfo(...args);

const app = express();

const isProduction = config.app.isProduction;
const corsOrigin = isProduction ? config.app.corsOrigin : config.app.devFrontendOrigin;

app.use(cors({
  origin: corsOrigin,
  credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true, limit: config.app.bodyParserLimit }));
app.use(cookieParser());

const openApiSpec = JSON.parse(fs.readFileSync(path.join(__dirname, 'openapi.json'), 'utf8'));

// app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

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
  res.setHeader('Access-Control-Allow-Origin', corsOrigin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  try {
    const jwt = require('jsonwebtoken');
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

const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('/*splat', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  logServerError('express.middleware', err, {
    method: req.method,
    url: req.originalUrl
  });
  safeConsoleError(err);
  res.status(500).json({ error: 'Internal server error' });
});

const httpsOptions = {
  key: fs.readFileSync(path.resolve(__dirname, config.ssl.keyPath)),
  cert: fs.readFileSync(path.resolve(__dirname, config.ssl.certPath))
};

const PORT = config.app.port;
process.on('uncaughtException', (error) => {
  logServerError('process.uncaughtException', error);
});

process.on('unhandledRejection', (reason) => {
  logServerError('process.unhandledRejection', reason);
});

if (isProduction) {
  https.createServer(httpsOptions, app).listen(PORT, () => {           
    safeConsoleInfo(`Server running on port ${PORT} (HTTPS)`);             
  }); 
} else {
  app.listen(PORT, () => {
    safeConsoleInfo(`Server running on port ${PORT}`);
  });
}

module.exports = app;
