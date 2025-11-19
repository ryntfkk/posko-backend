const Provider = require('./model');

async function listProviders(req, res, next) {
  try {
    const providers = await Provider.find();
    const messageKey = 'providers.list';
    res.json({ messageKey, message: req.t(messageKey), data: providers });
  } catch (error) {
    next(error);
  }
}

async function createProvider(req, res, next) {
  try {
    const { userId, services = [] } = req.body;
    const provider = new Provider({ userId, services });
    await provider.save();
    const messageKey = 'providers.created';
    res.status(201).json({ messageKey, message: req.t(messageKey), data: provider });
  } catch (error) {
    next(error);
  }
}

module.exports = { listProviders, createProvider };