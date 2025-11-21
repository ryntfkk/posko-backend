const Service = require('./model');

// GET /api/services (Public)
async function listServices(req, res, next) {
  try {
    // Ambil hanya yang statusnya Aktif
    const services = await Service.find({ isActive: true });
    
    // Kita bisa gunakan message key umum atau buat baru
    res.json({ 
      message: 'Daftar layanan berhasil diambil', 
      data: services 
    });
  } catch (error) {
    next(error);
  }
}

// POST /api/services (Admin Only)
async function createService(req, res, next) {
  try {
    // Cek apakah user punya role 'admin'
    const { roles = [] } = req.user || {};
    if (!roles.includes('admin')) {
      return res.status(403).json({ 
        message: 'Akses ditolak. Hanya admin yang bisa menambah layanan.' 
      });
    }

    const { name, category, basePrice, description, iconUrl } = req.body;

    const service = new Service({
      name,
      category,
      basePrice,
      description,
      iconUrl
    });

    await service.save();

    res.status(201).json({ 
      message: 'Layanan berhasil dibuat', 
      data: service 
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { listServices, createService };