const db = require('../db');
const MAX_ATTACHMENTS_PER_MESSAGE = 10;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isValidBase64Payload(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 || !BASE64_RE.test(value)) {
    return false;
  }

  try {
    const normalized = value.replace(/=+$/u, '');
    return Buffer.from(value, 'base64').toString('base64').replace(/=+$/u, '') === normalized;
  } catch {
    return false;
  }
}

function encodeEncryptedMessageContent(content) {
  if (!content) {
    return null;
  }

  if (!isValidBase64Payload(content)) {
    throw new Error('Invalid encrypted message payload');
  }

  return Buffer.from(content, 'base64');
}

function encodeSystemMessageContent(content) {
  if (!content) {
    return null;
  }

  return Buffer.from(content, 'utf8');
}

function decodeStoredMessageContent(content, isSystemMessage = false) {
  if (content === null || content === undefined) {
    return '';
  }

  if (Buffer.isBuffer(content)) {
    return isSystemMessage ? content.toString('utf8') : content.toString('base64');
  }

  if (content instanceof Uint8Array) {
    return Buffer.from(content).toString(isSystemMessage ? 'utf8' : 'base64');
  }

  if (typeof content === 'string') {
    return content;
  }

  return '';
}

function normalizeFileIds(fileIds) {
  if (!Array.isArray(fileIds)) {
    return [];
  }

  return fileIds
    .filter((fileId) => typeof fileId === 'string' && fileId.trim().length > 0)
    .map((fileId) => fileId.trim());
}

function setMessageFileIds(messageId, fileIds) {
  const normalizedFileIds = normalizeFileIds(fileIds);

  const deleteStmt = db.prepare('DELETE FROM message_files WHERE message_id = ?');
  const insertStmt = db.prepare(
    'INSERT INTO message_files (message_id, file_id, position) VALUES (?, ?, ?)'
  );

  const transaction = db.transaction(() => {
    deleteStmt.run(messageId);

    normalizedFileIds.forEach((fileId, index) => {
      insertStmt.run(messageId, fileId, index);
    });
  });

  transaction();
}

function validateAttachableFileIds(chatId, fileIds) {
  const normalizedFileIds = normalizeFileIds(fileIds);
  if (normalizedFileIds.length === 0) {
    return { ok: true, fileIds: [] };
  }

  if (normalizedFileIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return {
      ok: false,
      error: `Message can contain at most ${MAX_ATTACHMENTS_PER_MESSAGE} file attachments`,
      invalidFileIds: normalizedFileIds.slice(MAX_ATTACHMENTS_PER_MESSAGE)
    };
  }

  const uniqueFileIds = Array.from(new Set(normalizedFileIds));
  const placeholders = uniqueFileIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT id
       FROM files
       WHERE chat_id = ? AND id IN (${placeholders})`
    )
    .all(chatId, ...uniqueFileIds);

  const foundIds = new Set(rows.map((row) => row.id));
  const invalidFileIds = uniqueFileIds.filter((fileId) => !foundIds.has(fileId));

  if (invalidFileIds.length > 0) {
    return {
      ok: false,
      error: 'Some fileIds do not exist or do not belong to this chat',
      invalidFileIds
    };
  }

  return {
    ok: true,
    fileIds: normalizedFileIds
  };
}

function getMessageFileIdsMap(messageIds) {
  const normalizedMessageIds = Array.from(
    new Set(messageIds.filter((messageId) => typeof messageId === 'string' && messageId.length > 0))
  );

  const result = new Map();
  normalizedMessageIds.forEach((messageId) => result.set(messageId, []));

  if (normalizedMessageIds.length === 0) {
    return result;
  }

  const placeholders = normalizedMessageIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT message_id, file_id
       FROM message_files
       WHERE message_id IN (${placeholders})
       ORDER BY position ASC`
    )
    .all(...normalizedMessageIds);

  rows.forEach((row) => {
    const fileIds = result.get(row.message_id) || [];
    fileIds.push(row.file_id);
    result.set(row.message_id, fileIds);
  });

  return result;
}

function getMessageFileIds(messageId) {
  return getMessageFileIdsMap([messageId]).get(messageId) || [];
}

function getReplyPreviewMap(messages) {
  const result = new Map();
  const replyIds = Array.from(
    new Set(
      messages
        .map((message) => message.reply_to_message_id)
        .filter((replyId) => typeof replyId === 'string' && replyId.length > 0)
    )
  );

  if (replyIds.length === 0) {
    return result;
  }

  const placeholders = replyIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT m.id, m.sender_id, m.content, u.username AS sender_username
       FROM messages m
       LEFT JOIN users u ON u.id = m.sender_id
       WHERE m.id IN (${placeholders})`
    )
    .all(...replyIds);

  const fileIdsByMessage = getMessageFileIdsMap(rows.map((row) => row.id));
  const rowMap = new Map(rows.map((row) => [row.id, row]));

  replyIds.forEach((replyId) => {
    const row = rowMap.get(replyId);
    if (!row) {
      result.set(replyId, {
        id: replyId,
        senderId: null,
        senderUsername: 'Удалённое сообщение',
        content: '',
        fileIds: [],
        isDeleted: true
      });
      return;
    }

      result.set(replyId, {
        id: row.id,
        senderId: row.sender_id,
        senderUsername: row.sender_username ?? 'Unknown',
        content: decodeStoredMessageContent(row.content, row.sender_id === null || row.sender_id === undefined),
        fileIds: fileIdsByMessage.get(row.id) || [],
        isDeleted: false
      });
  });

  return result;
}

function getReplyPreviewByMessageId(messages) {
  const previewByReplyId = getReplyPreviewMap(messages);
  const result = new Map();

  messages.forEach((message) => {
    const replyId = message.reply_to_message_id;
    if (!replyId) {
      result.set(message.id, null);
      return;
    }

    result.set(message.id, previewByReplyId.get(replyId) || null);
  });

  return result;
}

function mapMessageRow(message, fileIdsByMessage = null, replyPreviewByMessageId = null) {
  const fileIds = fileIdsByMessage
    ? fileIdsByMessage.get(message.id) || []
    : getMessageFileIds(message.id);

  const replyToMessageId = message.reply_to_message_id ?? null;
  const reply =
    replyToMessageId && replyPreviewByMessageId
      ? replyPreviewByMessageId.get(message.id) || null
      : null;

  return {
    id: message.id,
    chatId: message.chat_id,
    senderId: message.sender_id,
    content: decodeStoredMessageContent(message.content, message.sender_id === null || message.sender_id === undefined),
    replyToMessageId,
    reply,
    fileIds,
    timestamp: message.timestamp,
    editedAt: message.edited_at
  };
}

module.exports = {
  normalizeFileIds,
  setMessageFileIds,
  validateAttachableFileIds,
  getMessageFileIdsMap,
  getMessageFileIds,
  getReplyPreviewMap,
  getReplyPreviewByMessageId,
  mapMessageRow,
  isValidBase64Payload,
  encodeEncryptedMessageContent,
  encodeSystemMessageContent,
  decodeStoredMessageContent
};
