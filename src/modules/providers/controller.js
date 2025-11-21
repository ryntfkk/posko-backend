const Provider = require('./model');

async function listProviders(req, res, next) {
  try {
    const providers = await Provider.find()
      .populate({
        path: 'userId',
        select: 'fullName profilePictureUrl address location bio' 
      })
      .populate({
        path: 'services.serviceId',
        select: 'name category iconUrl basePrice' 
      });

    const messageKey = 'providers.list';
    res.json({ messageKey, message: req.t(messageKey), data: providers });
  } catch (error) {
    next(error);
  }
}

// --- TAMBAHKAN FUNGSI INI ---
async function getProviderById(req, res, next) {
  try {
    const { id } = req.params;

    const provider = await Provider.findById(id)
      .populate({
        path: 'userId',
        select: 'fullName profilePictureUrl address location bio'
      })
      .populate({
        path: 'services.serviceId',
        select: 'name category iconUrl basePrice'
      });

    if (!provider) {
      return res.status(404).json({ 
        messageKey: 'providers.not_found', 
        message: 'Mitra tidak ditemukan', 
        data: null 
      });
    }

    // Frontend mengharapkan struktur { data: provider }
    res.json({ 
      messageKey: 'providers.detail', 
      message: 'Detail mitra ditemukan', 
      data: provider 
    });
  } catch (error) {
    next(error);
  }
}
// -----------------------------

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

// Jangan lupa export fungsi barunya
module.exports = { listProviders, getProviderById, createProvider };