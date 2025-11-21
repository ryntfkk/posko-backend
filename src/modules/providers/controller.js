const Provider = require('./model');
const User = require('../../models/User'); // [PENTING] Import Model User

async function listProviders(req, res, next) {
  try {
    const { lat, lng, limit = 10 } = req.query;
    let filter = {};

    // --- LOGIKA GEO-SPATIAL ---
    if (lat && lng) {
      // 1. Cari User (Provider) di sekitar koordinat (Max 10 KM)
      const nearbyUsers = await User.find({
        location: {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: [parseFloat(lng), parseFloat(lat)], // MongoDB: [Longitude, Latitude]
            },
            $maxDistance: 10000 // 10.000 meter = 10 KM
          }
        },
        roles: 'provider' // Pastikan hanya cari yang role-nya provider
      }).select('_id'); // Kita hanya butuh ID-nya

      // 2. Ambil list ID user yang ditemukan
      const userIds = nearbyUsers.map(u => u._id);

      // 3. Filter Provider berdasarkan list ID tersebut
      filter = { userId: { $in: userIds } };
    }
    // ---------------------------

    // Query Provider dengan Filter
    const providers = await Provider.find(filter)
      .populate({
        path: 'userId',
        select: 'fullName profilePictureUrl address location bio'
      })
      .populate({
        path: 'services.serviceId',
        select: 'name category iconUrl basePrice'
      })
      .limit(parseInt(limit)); // Batasi jumlah hasil (default 10)

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