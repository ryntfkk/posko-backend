const Provider = require('./model');

async function listProviders(req, res, next) {
  try {
    const providers = await Provider.find();
    res.json({ message: 'Daftar penyedia layanan', data: providers });
  } catch (error) {
    next(error);
  }
}

async function createProvider(req, res, next) {
  try {
    const { userId, services = [] } = req.body;
    const provider = new Provider({ userId, services });
    await provider.save();
    res.status(201).json({ message: 'Penyedia layanan terdaftar', data: provider });
  } catch (error) {
    next(error);
  }
}

module.exports = { listProviders, createProvider };