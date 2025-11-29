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
    status: { $in: ['pending', 'accepted', 'in_progress'] },
    orderDate: { $gte: today }
  }). select('orderDate');

  return orders.map(o => o.orderDate. toISOString(). split('T')[0]);
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
    } = req. query;

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
    
    // Filter provider yang belum punya data di collection providers
    pipeline.push({ 
      $match: { 
        'providerInfo': { $ne: [] } 
      } 
    });
    
    pipeline.push({ $unwind: '$providerInfo' });

    // 3.  RELASI KE LAYANAN (FIX: hapus spasi di serviceId)
    pipeline. push({
      $lookup: {
        from: 'services',
        localField: 'providerInfo.services. serviceId',
        foreignField: '_id',
        as: 'serviceDetails'
      }
    });

    // 4. LOGIKA FILTER
    const matchConditions = [];
    
    // [FIX] Filter Kategori - validasi ketat dan case-insensitive yang benar
    const isValidCategory = category && 
                            typeof category === 'string' && 
                            category.trim() !== '' && 
                            category.toLowerCase() !== 'undefined' &&
                            category.toLowerCase() !== 'null';
    
    if (isValidCategory) {
      // Normalize: decode, lowercase, trim, dan replace dash dengan space
      const normalizedCategory = decodeURIComponent(category)
        .toLowerCase()
        .trim()
        .replace(/-/g, ' ');
      
      console.log(`[CATEGORY FILTER] Original: "${category}", Normalized: "${normalizedCategory}"`);
      
      // [FIX] Gunakan $eq dengan $toLower untuk exact case-insensitive matching
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

    // [FIX] Search Filter - validasi ketat
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

    if (matchConditions. length > 0) {
      pipeline. push({ $match: { $and: matchConditions } });
    }

    // 5. SORTING
    const sortOptions = {
      distance: { distance: 1 },
      price_asc: { 'providerInfo.services.price': 1 },
      price_desc: { 'providerInfo. services.price': -1 },
      rating: { 'providerInfo. rating': -1 }
    };
    pipeline.push({ $sort: sortOptions[sortBy] || { distance: 1 } });

    // 6. PAGINATION
    const skip = (parseInt(page) - 1) * parseInt(limit);
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: parseInt(limit) });

    // 7. PROJECT (Format Output) - FIX: hapus spasi di isOnline
    pipeline. push({
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

    // Populate services dengan detail lengkap (FIX: hapus spasi di serviceId)
    await Provider.populate(providers, {
      path: 'services. serviceId',
      select: 'name category iconUrl basePrice unit unitLabel displayUnit shortDescription description estimatedDuration includes excludes requirements isPromo promoPrice discountPercent',
      model: Service
    });

    // [FIX] Log yang lebih informatif
    const filterInfo = isValidCategory ? `category: "${category}"` : 'no category filter';
    console. log(`[PROVIDERS RESULT] Found ${providers.length} providers (${filterInfo})`);

    res. json({ 
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
      return res. status(404).json({ message: 'Mitra tidak ditemukan' });
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
    const provider = await Provider. findOne({ userId })
      .populate('services.serviceId', 'name category iconUrl unit unitLabel displayUnit shortDescription description estimatedDuration includes excludes requirements isPromo promoPrice discountPercent');

    if (!provider) {
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
      return res.status(400). json({ message: 'User ini sudah terdaftar sebagai provider' });
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

    const provider = await Provider.findOne({ userId });
    if (!provider) {
      return res.status(404).json({ message: 'Profil mitra tidak ditemukan' });
    }

    provider.blockedDates = blockedDates;
    await provider.save();

    res.json({ 
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
    const userId = req. user.userId;
    const { portfolioImages } = req.body;

    if (!Array.isArray(portfolioImages) || portfolioImages. length === 0) {
      return res.status(400). json({ message: 'Portfolio harus memiliki minimal 1 gambar' });
    }

    const provider = await Provider.findOne({ userId });
    if (!provider) {
      return res. status(404).json({ message: 'Profil mitra tidak ditemukan' });
    }

    provider.portfolioImages = portfolioImages;
    await provider.save();

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