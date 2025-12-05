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
      lat,
      lng,
      category,
      search,
      sortBy = 'distance',
      limit = 10,
      page = 1
    } = req.query;

    const pipeline = [];

    // 1.GEO-SPATIAL FILTER
    if (lat && lng) {
      pipeline.push({
        $geoNear: {
          near: {
            type: "Point",
            coordinates: [parseFloat(lng), parseFloat(lat)]
          },
          distanceField: "distance",
          maxDistance: 20000,
          spherical: true,
          query: {
            roles: { $in: ['provider'] }
          }
        }
      });
    } else {
      pipeline.push({
        $match: {
          roles: { $in: ['provider'] }
        }
      });
    }

    // 2. RELASI KE DATA PROVIDER
    pipeline.push({
      $lookup: {
        from: 'providers',
        localField: '_id',
        foreignField: 'userId',
        as: 'providerInfo'
      }
    });

    pipeline.push({
      $match: {
        'providerInfo': { $ne: [] }
      }
    });

    pipeline.push({ $unwind: '$providerInfo' });

    // 3.RELASI KE LAYANAN
    pipeline.push({
      $lookup: {
        from: 'services',
        localField: 'providerInfo.services.serviceId',
        foreignField: '_id',
        as: 'serviceDetails'
      }
    });

    // 4.LOGIKA FILTER
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

      pipeline.push({
        $addFields: {
          hasMatchingService: {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: '$serviceDetails',
                    as: 'svc',
                    cond: {
                      $eq: [
                        { $toLower: { $trim: { input: '$$svc.category' } } },
                        normalizedCategory
                      ]
                    }
                  }
                }
              },
              0
            ]
          }
        }
      });

      matchConditions.push({ hasMatchingService: true });
    }

    const isValidSearch = search &&
      typeof search === 'string' &&
      search.trim() !== '';

    if (isValidSearch) {
      const searchRegex = new RegExp(search.trim(), 'i');
      matchConditions.push({
        $or: [
          { fullName: { $regex: searchRegex } },
          { 'address.city': { $regex: searchRegex } },
          { 'address.district': { $regex: searchRegex } },
          { 'serviceDetails.name': { $regex: searchRegex } },
          { 'serviceDetails.category': { $regex: searchRegex } }
        ]
      });
    }

    if (matchConditions.length > 0) {
      pipeline.push({ $match: { $and: matchConditions } });
    }

    // 5.SORTING
    const sortOptions = {
      distance: { distance: 1 },
      price_asc: { 'providerInfo.services.price': 1 },
      price_desc: { 'providerInfo.services.price': -1 },
      rating: { 'providerInfo.rating': -1 }
    };
    pipeline.push({ $sort: sortOptions[sortBy] || { distance: 1 } });

    // 6.PAGINATION
    const skip = (parseInt(page) - 1) * parseInt(limit);
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: parseInt(limit) });

    // 7.PROJECT (Format Output)
    pipeline.push({
      $project: {
        _id: '$providerInfo._id',
        userId: {
          _id: '$_id',
          fullName: '$fullName',
          email: '$email',
          profilePictureUrl: '$profilePictureUrl',
          address: '$address',
          location: '$location',
          bio: '$bio',
          phoneNumber: '$phoneNumber'
        },
        services: '$providerInfo.services',
        rating: '$providerInfo.rating',
        isOnline: '$providerInfo.isOnline',
        blockedDates: '$providerInfo.blockedDates',
        portfolioImages: '$providerInfo.portfolioImages',
        totalCompletedOrders: '$providerInfo.totalCompletedOrders',
        // schedule: '$providerInfo.schedule', // [DIHAPUS] Tidak lagi dikirim
        createdAt: '$providerInfo.createdAt',
        distance: '$distance'
      }
    });

    const providers = await User.aggregate(pipeline);

    await Provider.populate(providers, {
      path: 'services.serviceId',
      select: 'name category iconUrl basePrice unit unitLabel displayUnit shortDescription description estimatedDuration includes excludes requirements isPromo promoPrice discountPercent',
      model: Service
    });

    res.json({
      messageKey: 'providers.list',
      message: 'Berhasil memuat data mitra',
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
    delete providerData.schedule; // [DIHAPUS] Membersihkan output

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
    delete providerData.schedule; // [DIHAPUS] Membersihkan output

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
        activeRole: 'provider' // [TAMBAHAN] Paksa switch role agar login berikutnya langsung masuk dashboard
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

// [DIHAPUS] Function updateSchedule sudah dihapus

module.exports = {
  listProviders,
  getProviderById,
  getProviderMe,
  createProvider,
  updateAvailability,
  updatePortfolio,
  updateProviderServices,
  toggleOnlineStatus,
  verifyProvider
};