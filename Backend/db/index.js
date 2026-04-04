const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'messenger.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

function columnExists(tableName, columnName) {
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => column.name === columnName);
}

function tableExists(tableName) {
  return Boolean(
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(tableName)
  );
}

function recreateSchema() {
  db.exec(`
    DROP TABLE IF EXISTS pinned_messages;
    DROP TABLE IF EXISTS message_files;
    DROP TABLE IF EXISTS files;
    DROP TABLE IF EXISTS messages;
    DROP TABLE IF EXISTS chat_members;
    DROP TABLE IF EXISTS chats;
    DROP TABLE IF EXISTS users;
  `);
}

function ensureSchema() {
  const needsReset =
    !tableExists('users') ||
    !tableExists('chats') ||
    !tableExists('chat_members') ||
    !tableExists('messages') ||
    !tableExists('files') ||
    !tableExists('message_files') ||
    !tableExists('pinned_messages') ||
    columnExists('messages', 'file_ids') ||
    !columnExists('chats', 'avatar_file_id') ||
    !columnExists('messages', 'reply_to_message_id');

  if (needsReset) {
    recreateSchema();
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      public_key TEXT NOT NULL,
      salt TEXT NOT NULL,
      registration_ip TEXT,
      avatar_updated_at INTEGER,
      last_seen_at INTEGER,
      file_quota_bytes INTEGER NOT NULL DEFAULT 104857600,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('pm', 'gm')),
      name TEXT,
      created_by TEXT NOT NULL,
      avatar_file_id TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (avatar_file_id) REFERENCES files(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS chat_members (
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      encrypted_chat_key TEXT,
      joined_at INTEGER DEFAULT (strftime('%s', 'now')),
      last_read_at INTEGER DEFAULT 0,
      PRIMARY KEY (chat_id, user_id),
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      sender_id TEXT,
      content BLOB,
      reply_to_message_id TEXT,
      timestamp INTEGER DEFAULT (strftime('%s', 'now')),
      edited_at INTEGER,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      uploaded_by TEXT NOT NULL,
      content BLOB NOT NULL,
      metadata BLOB NOT NULL,
      size INTEGER NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now')),
      deleted_at INTEGER,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
      FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS message_files (
      message_id TEXT NOT NULL,
      file_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (message_id, file_id),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pinned_messages (
      chat_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      pinned_by TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      PRIMARY KEY (chat_id, message_id),
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
      FOREIGN KEY (pinned_by) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS blocked_users (
      blocker_id TEXT NOT NULL,
      blocked_user_id TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      PRIMARY KEY (blocker_id, blocked_user_id),
      FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to_message_id);
    CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_users_registration_ip ON users(registration_ip);
    CREATE INDEX IF NOT EXISTS idx_files_chat_created_at ON files(chat_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_files_uploaded_by ON files(uploaded_by);
    CREATE INDEX IF NOT EXISTS idx_chats_avatar_file_id ON chats(avatar_file_id);
    CREATE INDEX IF NOT EXISTS idx_message_files_file_id ON message_files(file_id);
    CREATE INDEX IF NOT EXISTS idx_pinned_messages_chat ON pinned_messages(chat_id);
    CREATE INDEX IF NOT EXISTS idx_pinned_messages_message ON pinned_messages(message_id);
    CREATE INDEX IF NOT EXISTS idx_blocked_users_blocker ON blocked_users(blocker_id);
    CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked ON blocked_users(blocked_user_id);
  `);

  if (!columnExists('users', 'registration_ip')) {
    db.exec(`
      ALTER TABLE users ADD COLUMN registration_ip TEXT;
      CREATE INDEX IF NOT EXISTS idx_users_registration_ip ON users(registration_ip);
    `);
  }

  if (!columnExists('users', 'last_seen_at')) {
    db.exec(`
      ALTER TABLE users ADD COLUMN last_seen_at INTEGER;
    `);
  }

  if (!columnExists('messages', 'reply_to_message_id')) {
    db.exec(`
      ALTER TABLE messages ADD COLUMN reply_to_message_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to_message_id);
    `);
  }
}

ensureSchema();

module.exports = db;
