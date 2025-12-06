// src/modules/providers/controller.js
const Provider = require('./model');
const User = require('../../models/User');
const Service = require('../services/model');
const Order = require('../orders/model');

const { Types } = require('mongoose');

// Helper: Ambil tanggal-tanggal yang sudah dibooking (Order Aktif)
async function getBookedDates(providerId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const orders = await Order.find({
    providerId,
    status: { $in: ['paid', 'accepted', 'on_the_way', 'working'] },
    scheduledAt: { $gte: today }
  }).select('scheduledAt');

  return orders
    .filter(o => o.scheduledAt)
    .map(o => o.scheduledAt.toISOString().split('T')[0]);
}

// Helper: Hitung total pesanan selesai
async function getCompletedOrdersCount(providerId) {
  const count = await Order.countDocuments({
    providerId,
    status: 'completed'
  });
  return count;
}

async function listProviders(req, res, next) {
  try {
    const {
      category,
      search,
      sortBy = 'distance',
      limit = 10,
      page = 1,
      // Parameter GPS opsional (untuk Guest)
      lat, 
      lng
    } = req.query;

    let userCoordinates = null;
    let locationSource = 'none'; // 'db', 'gps', 'none'

    // 1. CEK KOORDINAT USER (PRIORITAS: DATABASE)
    if (req.user && req.user.userId) {
        const customer = await User.findById(req.user.userId).select('location');
        if (customer && customer.location && customer.location.coordinates && customer.location.coordinates.length === 2) {
            const [cLng, cLat] = customer.location.coordinates;
            // Validasi bukan [0,0] default
            if (cLng !== 0 || cLat !== 0) {
                userCoordinates = [cLng, cLat];
                locationSource = 'db';
            }
        }
    }

    // 2. CEK KOORDINAT GPS (FALLBACK: GUEST)
    // Jika tidak dapat dari DB (Guest atau User belum set alamat), coba pakai query params
    if (!userCoordinates && lat && lng) {
        const pLat = parseFloat(lat);
        const pLng = parseFloat(lng);
        if (!isNaN(pLat) && !isNaN(pLng)) {
            userCoordinates = [pLng, pLat];
            locationSource = 'gps';
        }
    }

    const pipeline = [];

    // 3. GEO-SPATIAL FILTER (Jika ada koordinat)
    if (userCoordinates) {
      pipeline.push({
        $geoNear: {
          near: {
            type: "Point",
            coordinates: userCoordinates
          },
          distanceField: "distance", // Output jarak dalam meter
          maxDistance: 20000, // 20 KM
          spherical: true,
          query: {
            verificationStatus: 'verified', // [FIX] Hanya Mitra Terverifikasi
            isOnline: true // [FIX] Hanya Mitra Online
          }
        }
      });
    } else {
      // 3.B. FILTER STANDAR (Jika tidak ada koordinat)
      pipeline.push({
        $match: {
            verificationStatus: 'verified',
            isOnline: true
        }
      });
    }

    // 4. RELASI KE DATA USER (Untuk ambil Nama, Foto, Bio personal mitra)
    pipeline.push({
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'userInfo'
      }
    });

    pipeline.push({ $unwind: '$userInfo' });

    // 5. RELASI KE LAYANAN
    pipeline.push({
      $lookup: {
        from: 'services',
        localField: 'services.serviceId',
        foreignField: '_id',
        as: 'serviceDetails'
      }
    });

    // 6. LOGIKA FILTER (Category & Search)
    const matchConditions = [];

    const isValidCategory = category &&
      typeof category === 'string' &&
      category.trim() !== '' &&
      category.toLowerCase() !== 'undefined' &&
      category.toLowerCase() !== 'null';

    if (isValidCategory) {
      const normalizedCategory = decodeURIComponent(category)
        .toLowerCase()
        .trim()
        .replace(/-/g, ' ');

      matchConditions.push({
        'serviceDetails.category': { 
            $regex: new RegExp(`^${normalizedCategory}$`, 'i') 
        }
      });
    }

    const isValidSearch = search &&
      typeof search === 'string' &&
      search.trim() !== '';

    if (isValidSearch) {
      const searchRegex = new RegExp(search.trim(), 'i');
      matchConditions.push({
        $or: [
          { 'userInfo.fullName': { $regex: searchRegex } },
          { 'location.address.city': { $regex: searchRegex } },
          { 'location.address.district': { $regex: searchRegex } },
          { 'serviceDetails.name': { $regex: searchRegex } },
          { 'serviceDetails.category': { $regex: searchRegex } }
        ]
      });
    }

    if (matchConditions.length > 0) {
      pipeline.push({ $match: { $and: matchConditions } });
    }

    // 7. SORTING
    // Jika ada koordinat, default sort by distance. Jika tidak, sort by rating/terbaru
    const sortOptions = {};
    
    if (sortBy === 'distance') {
        if (userCoordinates) {
            sortOptions.distance = 1;
        } else {
            // Fallback jika user minta sort distance tapi tidak ada lokasi -> Sort by Rating
            sortOptions.rating = -1;
        }
    } else if (sortBy === 'price_asc') {
        sortOptions['services.price'] = 1;
    } else if (sortBy === 'price_desc') {
        sortOptions['services.price'] = -1;
    } else if (sortBy === 'rating') {
        sortOptions.rating = -1;
    } else {
        // Default sort
        sortOptions[userCoordinates ? 'distance' : 'rating'] = userCoordinates ? 1 : -1;
    }

    pipeline.push({ $sort: sortOptions });

    // 8. PAGINATION
    const skip = (parseInt(page) - 1) * parseInt(limit);
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: parseInt(limit) });

    // 9. PROJECTION
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
        blockedDates: 1,
        portfolioImages: 1,
        totalCompletedOrders: 1,
        createdAt: 1,
        // Distance hanya ada jika $geoNear dieksekusi
        distance: userCoordinates ? '$distance' : { $literal: null },
        operationalLocation: '$location' 
      }
    });

    const providers = await Provider.aggregate(pipeline);

    await Provider.populate(providers, {
      path: 'services.serviceId',
      select: 'name category iconUrl basePrice unit unitLabel displayUnit shortDescription description estimatedDuration includes excludes requirements isPromo promoPrice discountPercent',
      model: Service
    });

    res.json({
      messageKey: 'providers.list',
      message: 'Berhasil memuat data mitra',
      meta: {
          locationSource: locationSource, // Info untuk frontend: 'db', 'gps', atau 'none'
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

// Update Ketersediaan (Libur Manual)
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

// Update Portfolio Images
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

// Update Provider Services
async function updateProviderServices(req, res, next) {
  try {
    const userId = req.user.userId;
    const { services } = req.body;

    if (! Array.isArray(services)) {
      return res.status(400).json({ message: 'Format layanan tidak valid' });
    }

    const provider = await Provider.findOne({ userId });
    if (! provider) {
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

// Toggle Online Status
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

// [FIXED] Update Profil Provider (Bio, Alamat Operasional, Jam Kerja)
async function updateProviderProfile(req, res, next) {
  try {
    const userId = req.user.userId;
    // [UPDATE] Menerima semua input field termasuk province
    const { bio, fullAddress, province, district, city, postalCode, latitude, longitude, workingHours } = req.body;

    const provider = await Provider.findOne({ userId });
    if (!provider) {
      return res.status(404).json({ message: 'Profil mitra tidak ditemukan' });
    }

    // Update Bio
    if (bio !== undefined) provider.bio = bio;

    // [FIX] Logika Defensive Update Alamat Detail
    // Pastikan provider.location terinisialisasi
    if (!provider.location) {
        provider.location = { type: 'Point', coordinates: [0, 0], address: {} };
    }

    // 1. Ambil state alamat saat ini (bisa object atau string lama)
    let currentAddr = {};
    const existingAddress = provider.location.address;

    if (existingAddress && typeof existingAddress === 'object') {
        currentAddr = existingAddress; 
    } else if (typeof existingAddress === 'string') {
        // Migrasi data lama (String) ke format baru
        currentAddr = { fullAddress: existingAddress };
    }

    // 2. Susun object alamat baru dengan menimpa data lama jika ada input baru
    const newAddress = {
        fullAddress: fullAddress !== undefined ? fullAddress : (currentAddr.fullAddress || ''),
        province: province !== undefined ? province : (currentAddr.province || ''),
        city: city !== undefined ? city : (currentAddr.city || ''),
        district: district !== undefined ? district : (currentAddr.district || ''),
        postalCode: postalCode !== undefined ? postalCode : (currentAddr.postalCode || '')
    };

    // 3. Timpa sepenuhnya untuk menghindari error casting Mongoose
    provider.location.address = newAddress;

    // Update Koordinat
    if (latitude !== undefined && longitude !== undefined) {
        const lat = parseFloat(latitude);
        const lng = parseFloat(longitude);
        
        if (!isNaN(lat) && !isNaN(lng)) {
            provider.location.type = 'Point';
            provider.location.coordinates = [lng, lat]; // MongoDB: [Long, Lat]
        }
    }

    // Update Jam Kerja
    if (workingHours) {
        if (workingHours.start) provider.workingHours.start = workingHours.start;
        if (workingHours.end) provider.workingHours.end = workingHours.end;
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

// [BARU] Fungsi Verifikasi Mitra (Admin Only)
async function verifyProvider(req, res, next) {
  try {
    const { id } = req.params; // ID Provider
    const { status, rejectionReason } = req.body; // 'verified' | 'rejected'

    if (!['verified', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Status harus verified atau rejected' });
    }

    const provider = await Provider.findById(id);
    if (!provider) return res.status(404).json({ message: 'Mitra tidak ditemukan' });

    provider.verificationStatus = status;
    
    if (status === 'rejected') {
      provider.rejectionReason = rejectionReason || 'Dokumen tidak sesuai';
    } else {
      provider.rejectionReason = ''; // Reset jika verified
    }

    await provider.save();

    // Jika verified, pastikan role user juga 'provider' DAN switch activeRole
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