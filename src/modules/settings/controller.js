const Settings = require('./model');

// Mengambil konfigurasi global (termasuk admin fee)
async function getGlobalConfig(req, res, next) {
  try {
    // Cari config global, jika tidak ada buat default
    let config = await Settings.findOne({ key: 'global_config' });
    
    if (!config) {
        // Seed default jika belum ada (fallback)
        config = await Settings.create({ 
          key: 'global_config', 
          adminFee: 2500 
        });
    }
    
    res.json({ 
      message: 'Settings retrieved successfully', 
      data: config 
    });
  } catch (error) {
    next(error);
  }
}

// Update konfigurasi (untuk Admin)
async function updateGlobalConfig(req, res, next) {
  try {
    const { adminFee, isActive } = req.body;
    
    const config = await Settings.findOneAndUpdate(
      { key: 'global_config' },
      { adminFee, isActive },
      { new: true, upsert: true }
    );
    
    res.json({ 
      message: 'Settings updated successfully', 
      data: config 
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getGlobalConfig, updateGlobalConfig };