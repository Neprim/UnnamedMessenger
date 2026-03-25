module.exports = {
  app: require('./index.js'),
  config: {
    swagger: {
      info: {
        title: 'UnnamedMessenger API',
        version: '1.0.0'
      },
      apis: ['./openapi.json']
    }
  }
};