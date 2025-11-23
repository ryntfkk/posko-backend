const Service = require('./model');

// GET /api/services (Public)
async function listServices(req, res, next) {
  try {
    const { category } = req.query; // 1. Ambil parameter category dari query string

    // 2. Siapkan filter dasar (hanya yang aktif)
    let filter = { isActive: true };

    // 3. Jika ada category, tambahkan ke filter
    if (category) {
      // Menggunakan regex agar pencarian tidak case-sensitive (misal: "ac" cocok dengan "AC")
      // Dan handle slug (jika category dikirim dalam bentuk slug seperti 'service-ac')
      filter.category = { $regex: category.replace(/-/g, ' '), $options: 'i' };
    }

    const services = await Service.find(filter);
    
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