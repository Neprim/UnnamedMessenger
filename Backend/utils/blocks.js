const db = require('../db');

function getBlockedUserIds(blockerId) {
  return db
    .prepare('SELECT blocked_user_id FROM blocked_users WHERE blocker_id = ? ORDER BY created_at DESC')
    .all(blockerId)
    .map((row) => row.blocked_user_id);
}

function hasBlocked(blockerId, blockedUserId) {
  return Boolean(
    db
      .prepare('SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_user_id = ?')
      .get(blockerId, blockedUserId)
  );
}

function isBlockedEitherDirection(firstUserId, secondUserId) {
  return Boolean(
    db.prepare(`
      SELECT 1
      FROM blocked_users
      WHERE (blocker_id = ? AND blocked_user_id = ?)
         OR (blocker_id = ? AND blocked_user_id = ?)
      LIMIT 1
    `).get(firstUserId, secondUserId, secondUserId, firstUserId)
  );
}

function getPersonalChatIdsBetween(firstUserId, secondUserId) {
  return db.prepare(`
    SELECT c.id
    FROM chats c
    JOIN chat_members cm1 ON cm1.chat_id = c.id AND cm1.user_id = ?
    JOIN chat_members cm2 ON cm2.chat_id = c.id AND cm2.user_id = ?
    WHERE c.type = 'pm'
  `).all(firstUserId, secondUserId).map((row) => row.id);
}

module.exports = {
  getBlockedUserIds,
  hasBlocked,
  isBlockedEitherDirection,
  getPersonalChatIdsBetween
};
