const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '..', 'logs');
const MAX_LOG_FILE_SIZE_BYTES = 10 * 1024 * 1024;
let emergencyShutdownStarted = false;

function ensureLogsDir() {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}

function safeWriteToFd(fd, line) {
  try {
    fs.writeSync(fd, line);
  } catch {
    // Ignore stdio write failures such as EIO on detached stderr/stdout.
  }
}

function emergencyShutdown(reason) {
  if (emergencyShutdownStarted) {
    return;
  }

  emergencyShutdownStarted = true;
  const line = `[${new Date().toISOString()}] logger.emergencyShutdown | ${reason}\n`;
  safeWriteToFd(2, line);

  try {
    process.exit(1);
  } catch {
    try {
      process.abort();
    } catch {
      // Give up quietly if even abort is unavailable.
    }
  }
}

function appendLog(fileName, line) {
  if (emergencyShutdownStarted) {
    return;
  }

  try {
    ensureLogsDir();
    const filePath = path.join(logsDir, fileName);
    const nextLine = `${line}\n`;
    let currentSize = 0;

    try {
      currentSize = fs.statSync(filePath).size;
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        throw error;
      }
    }

    const nextSize = currentSize + Buffer.byteLength(nextLine, 'utf8');
    if (currentSize > MAX_LOG_FILE_SIZE_BYTES || nextSize > MAX_LOG_FILE_SIZE_BYTES) {
      emergencyShutdown(`Log file "${fileName}" exceeded ${MAX_LOG_FILE_SIZE_BYTES} bytes`);
      return;
    }

    fs.appendFileSync(filePath, nextLine, 'utf8');
  } catch (error) {
    const payload = error instanceof Error ? error.stack || error.message : String(error);
    safeWriteToFd(2, `[${new Date().toISOString()}] logger.append.failed | ${payload}\n`);
  }
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

function safeConsoleInfo(...messages) {
  safeWriteToFd(1, `${messages.map((message) => formatPayload(message)).join(' ')}\n`);
}

function safeConsoleError(...errors) {
  safeWriteToFd(2, `${errors.map((error) => formatPayload(error)).join(' ')}\n`);
}

module.exports = {
  logUserRegistration,
  logServerError,
  safeConsoleInfo,
  safeConsoleError,
  MAX_LOG_FILE_SIZE_BYTES
};
