const fs = require('fs');
const path = require('path');

const AVATAR_DIR = path.join(__dirname, '..', 'uploads', 'avatars');

function ensureAvatarDir() {
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
}

function getAvatarFilePath(userId) {
  return path.join(AVATAR_DIR, `${userId}.webp`);
}

function getAvatarUrl(userId, avatarUpdatedAt) {
  if (!avatarUpdatedAt) {
    return null;
  }

  return `/api/users/${userId}/avatar?v=${avatarUpdatedAt}`;
}

function removeAvatarFile(userId) {
  const filePath = getAvatarFilePath(userId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

module.exports = {
  AVATAR_DIR,
  ensureAvatarDir,
  getAvatarFilePath,
  getAvatarUrl,
  removeAvatarFile
};
