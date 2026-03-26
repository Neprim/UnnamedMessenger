const clients = new Map();

function subscribe(userId, res) {
  if (!clients.has(userId)) {
    clients.set(userId, new Set());
  }
  clients.get(userId).add(res);
}

function unsubscribe(userId, res) {
  if (clients.has(userId)) {
    clients.get(userId).delete(res);
    if (clients.get(userId).size === 0) {
      clients.delete(userId);
    }
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
  broadcastToChat
};