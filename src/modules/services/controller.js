const Service = require('./model');

// GET /api/services (Public)
async function listServices(req, res, next) {
  try {
    const { category, isActive } = req.query;
    const filter = {};

    if (category) filter.category = category;
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const services = await Service.find(filter). lean({ virtuals: true });

    res.json({ 
      message: 'Daftar layanan', 
      data: services 
    });
  } catch (error) {
    next(error);
  }
}

// POST /api/services (Admin Only)
async function createService(req, res, next) {
  try {
    const { roles = [] } = req.user || {};
    if (! roles.includes('admin')) {
      return res.status(403).json({ 
        message: 'Akses ditolak.  Hanya admin yang bisa menambah layanan.' 
      });
    }

    const { name, category, basePrice, unit, unitLabel, description, iconUrl } = req. body;

    const service = new Service({
      name,
      category,
      basePrice,
      unit,        // ✅ [BARU]
      unitLabel,   // ✅ [BARU]
      description,
      iconUrl
    });

    await service.save();

    res.status(201).json({ 
      message: 'Layanan berhasil dibuat', 
      data: service. toJSON() 
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { listServices, createService };