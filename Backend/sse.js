const db = require('./db');

const clients = new Map();

function isUserOnline(userId) {
  return clients.has(userId) && clients.get(userId).size > 0;
}

function getRelatedUserIds(userId) {
  return db.prepare(`
    SELECT DISTINCT cm.user_id
    FROM chat_members own
    JOIN chat_members cm ON cm.chat_id = own.chat_id
    WHERE own.user_id = ? AND cm.user_id != ?
  `).all(userId, userId).map((row) => row.user_id);
}

function notifyPresenceChange(userId, isOnline) {
  const event = {
    type: isOnline ? 'user_online' : 'user_offline',
    data: {
      userId,
      ...(isOnline ? {} : { lastSeenAt: db.prepare('SELECT last_seen_at FROM users WHERE id = ?').get(userId)?.last_seen_at ?? null })
    }
  };

  getRelatedUserIds(userId).forEach((relatedUserId) => {
    if (isUserOnline(relatedUserId)) {
      broadcast(relatedUserId, event);
    }
  });
}

function subscribe(userId, res) {
  const becameOnline = !isUserOnline(userId);
  if (!clients.has(userId)) {
    clients.set(userId, new Set());
  }
  clients.get(userId).add(res);
  if (becameOnline) {
    notifyPresenceChange(userId, true);
  }
}

function unsubscribe(userId, res) {
  let becameOffline = false;
  if (clients.has(userId)) {
    clients.get(userId).delete(res);
    if (clients.get(userId).size === 0) {
      clients.delete(userId);
      db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), userId);
      becameOffline = true;
    }
  }
  if (becameOffline) {
    notifyPresenceChange(userId, false);
  }
}

function broadcast(userId, event) {
  const userClients = clients.get(userId);
  if (userClients) {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    userClients.forEach(client => client.write(data));
  }
}

function broadcastToChat(chatId, event, excludeUserId = null) {
  clients.forEach((userClients, userId) => {
    if (userId !== excludeUserId) {
      const data = `data: ${JSON.stringify(event)}\n\n`;
      userClients.forEach(client => client.write(data));
    }
  });
}

module.exports = {
  subscribe,
  unsubscribe,
  broadcast,
  broadcastToChat,
  isUserOnline
};
