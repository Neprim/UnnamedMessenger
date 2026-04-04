const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '..', 'logs');

function ensureLogsDir() {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}

function appendLog(fileName, line) {
  ensureLogsDir();
  fs.appendFileSync(path.join(logsDir, fileName), `${line}\n`, 'utf8');
}

function formatPayload(payload) {
  if (payload instanceof Error) {
    return payload.stack || payload.message;
  }

  if (typeof payload === 'string') {
    return payload;
  }

  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

function logUserRegistration(payload) {
  appendLog(
    'user-registrations.log',
    `[${new Date().toISOString()}] ${formatPayload(payload)}`
  );
}

function logServerError(context, error, extra = null) {
  const parts = [`[${new Date().toISOString()}] ${context}`];
  if (extra) {
    parts.push(`meta=${formatPayload(extra)}`);
  }
  parts.push(formatPayload(error));
  appendLog('server-errors.log', parts.join(' | '));
}

module.exports = {
  logUserRegistration,
  logServerError
};
