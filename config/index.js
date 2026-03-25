module.exports = {
  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    maxAge: 30 * 24 * 60 * 60 * 1000
  },
  cookie: {
    name: 'token',
    maxAge: 30 * 24 * 60 * 60 * 1000
  },
  limits: {
    maxMessageLength: 10000
  }
};