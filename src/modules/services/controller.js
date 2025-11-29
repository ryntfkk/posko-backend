const Service = require('./model');

// GET /api/services (Public)
async function listServices(req, res, next) {
  try {
    const { category, isActive } = req.query;
    const filter = {};

    // [FIX] Case-insensitive category filter
    // Normalize: lowercase dan replace dash dengan space untuk matching yang konsisten
    if (category && typeof category === 'string' && category.trim() !== '') {
      const normalizedCategory = decodeURIComponent(category)
        .toLowerCase()
        .trim()
        .replace(/-/g, ' ');
      
      // Gunakan regex case-insensitive untuk matching
      filter.category = { $regex: new RegExp(`^${escapeRegex(normalizedCategory)}$`, 'i') };
    }

    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const services = await Service.find(filter).lean({ virtuals: true });

    res.json({ 
      message: 'Daftar layanan', 
      data: services 
    });
  } catch (error) {
    next(error);
  }
}

// [FIX] Helper function untuk escape regex special characters
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// POST /api/services (Admin Only)
async function createService(req, res, next) {
  try {
    const { roles = [] } = req.user || {};
    if (!roles.includes('admin')) {
      return res.status(403).json({ 
        message: 'Akses ditolak.  Hanya admin yang bisa menambah layanan.' 
      });
    }

    const { name, category, basePrice, unit, unitLabel, description, iconUrl } = req.body;

    const service = new Service({
      name,
      category,
      basePrice,
      unit,
      unitLabel,
      description,
      iconUrl
    });

    await service.save();

    res.status(201).json({ 
      message: 'Layanan berhasil dibuat', 
      data: service.toJSON() 
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { listServices, createService };