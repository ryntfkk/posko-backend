// src/modules/providers/controller. js
const Provider = require('./model');
const User = require('../../models/User');
const Service = require('../services/model');
const Order = require('../orders/model');

const { Types } = require('mongoose');

// Helper: Ambil tanggal-tanggal yang sudah dibooking (Order Aktif)
async function getBookedDates(providerId) {
  const activeOrders = await Order.find({
    providerId,
    status: { $in: ['accepted', 'on_the_way', 'working', 'waiting_approval'] },
    scheduledAt: { $exists: true, $ne: null }
  }). select('scheduledAt'). lean();

  return activeOrders.map(o => o.scheduledAt. toISOString(). split('T')[0]);
}

// Helper: Hitung total pesanan selesai
async function getCompletedOrdersCount(providerId) {
  return await Order.countDocuments({
    providerId,
    status: 'completed'
  });
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

    // 1. GEO-SPATIAL FILTER
    if (lat && lng) {
      pipeline.push({
        $geoNear: {
          near: { 
            type: "Point", 
            coordinates: [parseFloat(lng), parseFloat(lat)] 
          },
          distanceField: "distance", 
          maxDistance: 10000, 
          spherical: true,
          query: { roles: 'provider', status: 'active' } 
        }
      });
    } else {
      pipeline.push({ 
        $match: { 
          roles: 'provider',
          status: 'active'
        } 
      });
    }

    // 2.  RELASI KE DATA PROVIDER
    pipeline.push({
      $lookup: {
        from: 'providers',
        localField: '_id',
        foreignField: 'userId',
        as: 'providerInfo'
      }
    });
    pipeline.push({ $unwind: '$providerInfo' });

    // 3.  RELASI KE LAYANAN
    pipeline. push({
      $lookup: {
        from: 'services',
        localField: 'providerInfo.services. serviceId',
        foreignField: '_id',
        as: 'serviceDetails'
      }
    });

    // 4.  LOGIKA FILTER
    const matchConditions = [];

    // [PERBAIKAN] Filter Kategori dengan Penanganan yang Lebih Baik
    if (category) {
      // Decode URL parameter dan ganti dash dengan spasi
      const decodedCategory = decodeURIComponent(category). replace(/-/g, ' ');
      
      // Buat regex yang lebih fleksibel (case-insensitive, trim whitespace)
      const categoryRegex = new RegExp(`^\\s*${decodedCategory. trim()}\\s*$`, 'i');
      
      matchConditions.push({
        $or: [
          // Match di serviceDetails. category (string)
          { 'serviceDetails.category': { $regex: categoryRegex } },
          // Juga coba match di providerInfo.services jika ada referensi langsung
          { 'providerInfo. services': { 
            $elemMatch: { 
              isActive: true 
            } 
          }}
        ]
      });
      
      // Filter tambahan: Pastikan provider memiliki layanan aktif di kategori tersebut
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
                      $regexMatch: { 
                        input: '$$svc.category', 
                        regex: categoryRegex 
                      } 
                    }
                  }
                }
              },
              0
            ]
          }
        }
      });
      
      // Hanya ambil provider yang punya layanan matching
      matchConditions.push({ hasMatchingService: true });
    }

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      matchConditions.push({
        $or: [
          { fullName: { $regex: searchRegex } },
          { 'address.city': { $regex: searchRegex } },
          { 'serviceDetails.name': { $regex: searchRegex } }
        ]
      });
    }

    if (matchConditions.length > 0) {
      pipeline.push({ $match: { $and: matchConditions } });
    }

    // 5. SORTING
    const sortOptions = {
      distance: { distance: 1 },
      price_asc: { 'providerInfo.services.price': 1 },
      price_desc: { 'providerInfo. services.price': -1 },
      rating: { 'providerInfo. rating': -1 }
    };
    pipeline.push({ $sort: sortOptions[sortBy] || { distance: 1 } });

    // 6.  PAGINATION
    const skip = (parseInt(page) - 1) * parseInt(limit);
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: parseInt(limit) });

    // 7. PROJECT (Format Output)
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
        totalCompletedOrders: '$providerInfo. totalCompletedOrders',
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
      messageKey: 'providers. list', 
      message: 'Berhasil memuat data mitra', 
      data: providers 
    });

  } catch (error) {
    next(error);
  }
}

async function getProviderById(req, res, next) {
  try {
    const { id } = req.params;

    if (!Types.ObjectId.isValid(id)) {
      return res. status(404).json({ message: 'Mitra tidak ditemukan' });
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
    providerData. bookedDates = bookedDates;
    providerData.totalCompletedOrders = totalCompletedOrders;

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
    const userId = req.user. userId;
    const provider = await Provider.findOne({ userId })
      .populate('services.serviceId', 'name category iconUrl unit unitLabel displayUnit shortDescription description estimatedDuration includes excludes requirements isPromo promoPrice discountPercent');

    if (! provider) {
      return res.status(404).json({ message: 'Profil Mitra belum dibuat' });
    }

    const bookedDates = await getBookedDates(provider._id);
    const totalCompletedOrders = await getCompletedOrdersCount(provider._id);
    
    const providerData = provider.toObject();
    providerData.bookedDates = bookedDates;
    providerData.totalCompletedOrders = totalCompletedOrders;

    res.json({
      message: 'Profil mitra ditemukan',
      data: providerData
    });
  } catch (error) {
    next(error);
  }
}

async function createProvider(req, res, next) {
  try {
    const { userId, services = [] } = req. body;
    
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

    res. status(201).json({ 
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
    const userId = req.user. userId;
    const { blockedDates } = req.body;

    const provider = await Provider.findOneAndUpdate(
      { userId },
      { blockedDates },
      { new: true }
    );

    if (!provider) {
      return res. status(404).json({ message: 'Profil Mitra tidak ditemukan' });
    }

    res.json({
      message: 'Jadwal ketersediaan berhasil diperbarui',
      data: provider
    });
  } catch (error) {
    next(error);
  }
}

// Update Portfolio Images
async function updatePortfolio(req, res, next) {
  try {
    const userId = req. user.userId;
    const { portfolioImages } = req. body;

    if (!Array.isArray(portfolioImages)) {
      return res.status(400).json({ message: 'portfolioImages harus berupa array' });
    }

    const provider = await Provider. findOneAndUpdate(
      { userId },
      { portfolioImages },
      { new: true }
    );

    if (!provider) {
      return res.status(404).json({ message: 'Profil Mitra tidak ditemukan' });
    }

    res.json({
      message: 'Portfolio berhasil diperbarui',
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
    updatePortfolio
};