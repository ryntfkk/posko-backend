// src/modules/providers/controller.js
const Provider = require('./model');
const User = require('../../models/User');
const Service = require('../services/model');
const Order = require('../orders/model');

const { Types } = require('mongoose');

// [OPTIMIZATION] Gunakan Aggregation untuk ambil tanggal unik langsung dari DB
// Mencegah fetching ribuan dokumen object hanya untuk mapping tanggal
async function getBookedDates(providerId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Sesuaikan timezone dengan kebutuhan project (WIB = +07:00)
  const timezone = '+07:00';

  const result = await Order.aggregate([
    {
      $match: {
        providerId: new Types.ObjectId(providerId),
        status: { $in: ['paid', 'accepted', 'on_the_way', 'working'] },
        scheduledAt: { $gte: today }
      }
    },
    {
      $project: {
        // Konversi tanggal langsung di database
        dateStr: { 
          $dateToString: { format: "%Y-%m-%d", date: "$scheduledAt", timezone } 
        }
      }
    },
    {
      $group: {
        _id: "$dateStr" // Group by date string untuk mendapatkan distinct dates
      }
    }
  ]);

  return result.map(r => r._id);
}

// Helper: Hitung total pesanan selesai (Efficient Count)
async function getCompletedOrdersCount(providerId) {
  return await Order.countDocuments({
    providerId,
    status: 'completed'
  });
}

// Helper: Escape Regex untuk search yang aman
function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

async function listProviders(req, res, next) {
  try {
    const {
      category,
      search,
      sortBy = 'distance',
      limit = 10,
      page = 1,
      lat, 
      lng,
      status 
    } = req.query;

    const { roles = [] } = req.user || {};
    const isAdmin = roles.includes('admin');

    // 1. DETERMINASI LOKASI PUSAT (User DB atau Param GPS)
    let userCoordinates = null;
    let locationSource = 'none';

    if (req.user && req.user.userId) {
        const customer = await User.findById(req.user.userId).select('location');
        if (customer?.location?.coordinates?.length === 2) {
            const [cLng, cLat] = customer.location.coordinates;
            if (cLng !== 0 || cLat !== 0) {
                userCoordinates = [cLng, cLat];
                locationSource = 'db';
            }
        }
    }

    if (!userCoordinates && lat && lng) {
        const pLat = parseFloat(lat);
        const pLng = parseFloat(lng);
        if (!isNaN(pLat) && !isNaN(pLng)) {
            userCoordinates = [pLng, pLat];
            locationSource = 'gps';
        }
    }

    // 2. BANGUN INITIAL QUERY (Filter Early Strategy)
    let initialMatch = {};

    if (isAdmin) {
        if (status && status !== 'all') {
            initialMatch.verificationStatus = status;
        }
    } else {
        // Customer hanya lihat yang Verified & Online
        initialMatch.verificationStatus = 'verified';
        initialMatch.isOnline = true;
    }

    // [OPTIMIZATION] Pre-fetch Service IDs untuk Category Filter
    // Jika ada filter kategori, cari dulu ID layanannya, lalu filter provider yang punya ID tsb.
    // Ini jauh lebih cepat daripada join tabel Service di dalam pipeline.
    if (category && typeof category === 'string' && category.trim() !== '') {
        const normalizedCategory = decodeURIComponent(category).trim().replace(/-/g, ' ');
        const categoryRegex = new RegExp(`^${escapeRegex(normalizedCategory)}$`, 'i');
        
        // Cari ID service yang relevan
        const matchedServices = await Service.find({ category: categoryRegex }).select('_id').lean();
        const serviceIds = matchedServices.map(s => s._id);

        if (serviceIds.length > 0) {
            initialMatch['services.serviceId'] = { $in: serviceIds };
            // Filter juga agar hanya layanan aktif yang dianggap
            initialMatch['services.isActive'] = true; 
        } else {
            // Jika kategori tidak ada di DB services, return kosong segera
            return res.json({
                messageKey: 'providers.list',
                message: 'Tidak ada mitra untuk kategori ini',
                meta: { locationSource, count: 0 },
                data: []
            });
        }
    }

    const pipeline = [];

    // 3. GEO-SPATIAL STAGE (Wajib paling atas jika dipakai)
    if (userCoordinates) {
      pipeline.push({
        $geoNear: {
          near: { type: "Point", coordinates: userCoordinates },
          key: "location", 
          distanceField: "distance",
          maxDistance: 20000, // 20 KM
          spherical: true,
          query: initialMatch // Filter awal diterapkan DI SINI (Index Scan)
        }
      });
    } else {
      pipeline.push({ $match: initialMatch });
    }

    // 4. LOOKUPS (Join Late Strategy)
    // Join User Info
    pipeline.push({
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'userInfo'
      }
    });
    pipeline.push({ $unwind: '$userInfo' });

    // Join Service Details
    pipeline.push({
      $lookup: {
        from: 'services',
        localField: 'services.serviceId',
        foreignField: '_id',
        as: 'serviceDetails'
      }
    });

    // 5. SEARCH FILTER (Regex Search)
    // Search dilakukan setelah lookup karena kita butuh field nama user/nama service
    if (search && typeof search === 'string' && search.trim() !== '') {
      const searchRegex = new RegExp(escapeRegex(search.trim()), 'i');
      pipeline.push({
        $match: {
          $or: [
            { 'userInfo.fullName': { $regex: searchRegex } },
            { 'location.address.city': { $regex: searchRegex } },
            { 'location.address.district': { $regex: searchRegex } },
            { 'serviceDetails.name': { $regex: searchRegex } },
            { 'serviceDetails.category': { $regex: searchRegex } }
          ]
        }
      });
    }

    // 6. SORTING
    const sortOptions = {};
    if (sortBy === 'distance' && userCoordinates) {
        sortOptions.distance = 1;
    } else if (sortBy === 'rating') {
        sortOptions.rating = -1;
    } else if (sortBy === 'price_asc') {
        sortOptions['services.price'] = 1;
    } else if (sortBy === 'price_desc') {
        sortOptions['services.price'] = -1;
    } else {
        // Default sort
        sortOptions[userCoordinates ? 'distance' : 'rating'] = userCoordinates ? 1 : -1;
    }
    pipeline.push({ $sort: sortOptions });

    // 7. PAGINATION & PROJECTION
    const skip = (parseInt(page) - 1) * parseInt(limit);
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: parseInt(limit) });

    pipeline.push({
      $project: {
        _id: 1, 
        userId: { 
          _id: '$userInfo._id',
          fullName: '$userInfo.fullName',
          email: '$userInfo.email',
          profilePictureUrl: '$userInfo.profilePictureUrl',
          address: '$userInfo.address', 
          location: '$userInfo.location',
          bio: '$userInfo.bio',
          phoneNumber: '$userInfo.phoneNumber'
        },
        services: 1, 
        rating: 1,
        isOnline: 1,
        verificationStatus: 1,
        blockedDates: 1,
        portfolioImages: 1,
        totalCompletedOrders: 1,
        createdAt: 1,
        distance: userCoordinates ? '$distance' : { $literal: null },
        operationalLocation: '$location' 
      }
    });

    const providers = await Provider.aggregate(pipeline);

    // Populate ulang Service Details agar response lengkap (Aggregation project bisa memotong field)
    await Provider.populate(providers, {
      path: 'services.serviceId',
      select: 'name category iconUrl basePrice unit unitLabel displayUnit shortDescription description estimatedDuration includes excludes requirements isPromo promoPrice discountPercent',
      model: Service
    });

    res.json({
      messageKey: 'providers.list',
      message: 'Berhasil memuat data mitra',
      meta: {
          locationSource: locationSource,
          count: providers.length
      },
      data: providers
    });

  } catch (error) {
    console.error('[PROVIDERS ERROR]', error);
    next(error);
  }
}

async function getProviderById(req, res, next) {
  try {
    const { id } = req.params;

    if (!Types.ObjectId.isValid(id)) {
      return res.status(404).json({ message: 'Mitra tidak ditemukan' });
    }

    const provider = await Provider.findById(id)
      .populate({
        path: 'userId',
        select: 'fullName profilePictureUrl address location bio phoneNumber'
      })
      .populate({
        path: 'services.serviceId',
        select: 'name category iconUrl basePrice unit unitLabel displayUnit shortDescription description estimatedDuration includes excludes requirements isPromo promoPrice discountPercent'
      });

    if (!provider) {
      return res.status(404).json({ message: 'Mitra tidak ditemukan' });
    }

    const bookedDates = await getBookedDates(provider._id);
    const totalCompletedOrders = await getCompletedOrdersCount(provider._id);

    const providerData = provider.toObject();
    providerData.bookedDates = bookedDates;
    providerData.totalCompletedOrders = totalCompletedOrders;
    delete providerData.schedule; 

    res.json({
      messageKey: 'providers.detail',
      message: 'Detail mitra ditemukan',
      data: providerData
    });
  } catch (error) {
    next(error);
  }
}

async function getProviderMe(req, res, next) {
  try {
    const userId = req.user.userId;
    const provider = await Provider.findOne({ userId })
      .populate('services.serviceId', 'name category iconUrl basePrice unit unitLabel displayUnit shortDescription description estimatedDuration includes excludes requirements isPromo promoPrice discountPercent');

    if (!provider) {
      return res.status(404).json({ message: 'Profil Mitra belum dibuat' });
    }

    const bookedDates = await getBookedDates(provider._id);
    const totalCompletedOrders = await getCompletedOrdersCount(provider._id);

    const providerData = provider.toObject();
    providerData.bookedDates = bookedDates;
    providerData.totalCompletedOrders = totalCompletedOrders;
    delete providerData.schedule; 

    res.json({
      messageKey: 'providers.me',
      message: 'Profil mitra ditemukan',
      data: providerData
    });
  } catch (error) {
    next(error);
  }
}

async function createProvider(req, res, next) {
  try {
    const { userId, services = [] } = req.body;

    const exist = await Provider.findOne({ userId });
    if (exist) {
      return res.status(400).json({ message: 'User ini sudah terdaftar sebagai provider' });
    }

    const provider = new Provider({ userId, services });
    await provider.save();

    await User.findByIdAndUpdate(userId, {
      $addToSet: { roles: 'provider' },
      activeRole: 'provider'
    });

    res.status(201).json({
      messageKey: 'providers.created',
      message: 'Provider berhasil didaftarkan',
      data: provider
    });
  } catch (error) {
    next(error);
  }
}

async function updateAvailability(req, res, next) {
  try {
    const userId = req.user.userId;
    const { blockedDates } = req.body;

    const provider = await Provider.findOne({ userId });
    if (!provider) {
      return res.status(404).json({ message: 'Profil mitra tidak ditemukan' });
    }

    provider.blockedDates = blockedDates;
    await provider.save();

    res.json({
      messageKey: 'providers.availability.updated',
      message: 'Ketersediaan berhasil diperbarui',
      data: blockedDates
    });
  } catch (error) {
    next(error);
  }
}

async function updatePortfolio(req, res, next) {
  try {
    const userId = req.user.userId;
    const { portfolioImages } = req.body;

    if (!Array.isArray(portfolioImages)) {
      return res.status(400).json({ message: 'Format portfolio tidak valid' });
    }

    const provider = await Provider.findOne({ userId });
    if (!provider) {
      return res.status(404).json({ message: 'Profil mitra tidak ditemukan' });
    }

    provider.portfolioImages = portfolioImages;
    await provider.save();

    res.json({
      messageKey: 'providers.portfolio.updated',
      message: 'Portfolio berhasil diperbarui',
      data: provider
    });
  } catch (error) {
    next(error);
  }
}

async function updateProviderServices(req, res, next) {
  try {
    const userId = req.user.userId;
    const { services } = req.body;

    if (!Array.isArray(services)) {
      return res.status(400).json({ message: 'Format layanan tidak valid' });
    }

    const provider = await Provider.findOne({ userId });
    if (!provider) {
      return res.status(404).json({ message: 'Profil mitra tidak ditemukan' });
    }

    provider.services = services;
    await provider.save();

    const updatedProvider = await Provider.findOne({ userId })
      .populate('services.serviceId', 'name category iconUrl basePrice unit unitLabel');

    res.json({
      messageKey: 'providers.services.updated',
      message: 'Layanan berhasil diperbarui',
      data: updatedProvider
    });
  } catch (error) {
    next(error);
  }
}

async function toggleOnlineStatus(req, res, next) {
  try {
    const userId = req.user.userId;
    const { isOnline } = req.body;

    const provider = await Provider.findOne({ userId });
    if (!provider) {
      return res.status(404).json({ message: 'Profil mitra tidak ditemukan' });
    }

    provider.isOnline = isOnline;
    await provider.save();

    res.json({
      messageKey: 'providers.status.updated',
      message: `Status berhasil diubah menjadi ${isOnline ? 'Online' : 'Offline'}`,
      data: { isOnline: provider.isOnline }
    });
  } catch (error) {
    next(error);
  }
}

async function updateProviderProfile(req, res, next) {
  try {
    const userId = req.user.userId;
    const { bio, fullAddress, province, district, city, postalCode, latitude, longitude, workingHours } = req.body;

    const provider = await Provider.findOne({ userId });
    if (!provider) {
      return res.status(404).json({ message: 'Profil mitra tidak ditemukan' });
    }

    // Update fields sederhana
    if (bio !== undefined) provider.bio = bio;

    // [REFACTOR] Struktur Update Alamat yang Lebih Bersih & Aman
    if (!provider.location) {
        provider.location = { type: 'Point', coordinates: [0, 0], address: {} };
    }

    // Pastikan address object terinisialisasi
    const existingAddress = (provider.location.address && typeof provider.location.address === 'object') 
        ? provider.location.address 
        : { fullAddress: typeof provider.location.address === 'string' ? provider.location.address : '' };

    // Merge data alamat baru
    provider.location.address = {
        fullAddress: fullAddress ?? existingAddress.fullAddress ?? '',
        province: province ?? existingAddress.province ?? '',
        city: city ?? existingAddress.city ?? '',
        district: district ?? existingAddress.district ?? '',
        postalCode: postalCode ?? existingAddress.postalCode ?? ''
    };

    // Update GeoJSON Coordinates
    if (latitude !== undefined && longitude !== undefined) {
        const lat = parseFloat(latitude);
        const lng = parseFloat(longitude);
        
        if (!isNaN(lat) && !isNaN(lng)) {
            provider.location.type = 'Point';
            provider.location.coordinates = [lng, lat]; // [Long, Lat]
        }
    }

    // Update Jam Kerja
    if (workingHours) {
        provider.workingHours = {
            start: workingHours.start || provider.workingHours?.start,
            end: workingHours.end || provider.workingHours?.end
        };
    }

    await provider.save();

    res.json({
      messageKey: 'providers.profile.updated',
      message: 'Profil operasional berhasil diperbarui',
      data: provider
    });
  } catch (error) {
    next(error);
  }
}

async function verifyProvider(req, res, next) {
  try {
    const { id } = req.params;
    const { status, rejectionReason } = req.body;

    if (!['verified', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Status harus verified atau rejected' });
    }

    const provider = await Provider.findById(id);
    if (!provider) return res.status(404).json({ message: 'Mitra tidak ditemukan' });

    provider.verificationStatus = status;
    
    if (status === 'rejected') {
      provider.rejectionReason = rejectionReason || 'Dokumen tidak sesuai';
    } else {
      provider.rejectionReason = '';
    }

    await provider.save();

    if (status === 'verified') {
      await User.findByIdAndUpdate(provider.userId, {
        $addToSet: { roles: 'provider' },
        activeRole: 'provider' 
      });
    }

    res.json({
      message: `Status mitra berhasil diubah menjadi ${status}`,
      data: provider
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listProviders,
  getProviderById,
  getProviderMe,
  createProvider,
  updateAvailability,
  updatePortfolio,
  updateProviderServices,
  toggleOnlineStatus,
  updateProviderProfile,
  verifyProvider
};