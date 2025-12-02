const Settings = require('./model');

// Mengambil konfigurasi global (termasuk admin fee dan komisi platform)
async function getGlobalConfig(req, res, next) {
  try {
    // [FIXED] Gunakan Atomic Upsert untuk mencegah Race Condition saat inisialisasi awal
    // Jika belum ada, buat default. Jika ada, kembalikan yang ada.
    const config = await Settings.findOneAndUpdate(
      { key: 'global_config' },
      { 
        $setOnInsert: { 
          key: 'global_config', 
          adminFee: 2500,
          platformCommissionPercent: 12,
          isActive: true
        } 
      },
      { 
        new: true, // Return dokumen setelah update/insert
        upsert: true, // Buat jika belum ada
        setDefaultsOnInsert: true 
      }
    );
    
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
    const { adminFee, platformCommissionPercent, isActive } = req.body;
    
    // [FIXED] Validasi Input Dasar
    if (adminFee !== undefined && adminFee < 0) {
      return res.status(400).json({ message: 'Biaya admin tidak boleh negatif.' });
    }

    if (platformCommissionPercent !== undefined) {
      if (platformCommissionPercent < 0 || platformCommissionPercent > 100) {
        return res.status(400).json({ message: 'Komisi platform harus antara 0-100%.' });
      }
    }
    
    const updateData = {};
    if (adminFee !== undefined) updateData.adminFee = adminFee;
    if (platformCommissionPercent !== undefined) updateData.platformCommissionPercent = platformCommissionPercent;
    if (isActive !== undefined) updateData.isActive = isActive;

    const config = await Settings.findOneAndUpdate(
      { key: 'global_config' },
      updateData,
      { new: true, upsert: true }
    );
    
    res. json({ 
      message: 'Settings updated successfully', 
      data: config 
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getGlobalConfig, updateGlobalConfig };