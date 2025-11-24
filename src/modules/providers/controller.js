// src/modules/providers/controller.js
const Provider = require('./model');
const User = require('../../models/User');
const Service = require('../services/model');
const Order = require('../orders/model'); // [PENTING] Import Model Order

const { Types } = require('mongoose');

// Helper: Ambil tanggal-tanggal yang sudah dibooking (Order Aktif)
async function getBookedDates(providerId) {
  const activeOrders = await Order.find({
    providerId: providerId,
    status: { $in: ['accepted', 'on_the_way', 'working'] }, // Status yang dianggap "Sibuk"
    scheduledAt: { $gte: new Date() } // Hanya ambil yang hari ini/masa depan
  }).select('scheduledAt');

  // Kembalikan array tanggal (Start of Day)
  return activeOrders.map(o => {
      const d = new Date(o.scheduledAt);
      d.setHours(0,0,0,0);
      return d;
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
          maxDistance: 20000, 
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

    // 2. RELASI KE DATA PROVIDER
    pipeline.push({
      $lookup: {
        from: 'providers', 
        localField: '_id',
        foreignField: 'userId',
        as: 'providerInfo'
      }
    });
    pipeline.push({ $unwind: '$providerInfo' });

    // 3. RELASI KE LAYANAN
    pipeline.push({
      $lookup: {
        from: 'services',
        localField: 'providerInfo.services.serviceId',
        foreignField: '_id',
        as: 'serviceDetails'
      }
    });

    // 4. LOGIKA FILTER
    const matchConditions = [];

    if (category) {
      const categoryRegex = new RegExp(category.replace(/-/g, ' '), 'i');
      matchConditions.push({
        'serviceDetails.category': { $regex: categoryRegex }
      });
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
      pipeline.push({
        $match: { $and: matchConditions }
      });
    }

    // 5. SORTING & PAGINATION
    let sortStage = {};
    if (sortBy === 'rating') {
      sortStage = { 'providerInfo.rating': -1 };
    } else if (sortBy === 'distance' && lat && lng) {
      sortStage = { distance: 1 }; 
    } else {
      sortStage = { createdAt: -1 }; 
    }

    pipeline.push({ $sort: sortStage });
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: parseInt(limit) });

    // 6. PROJECTION
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
        blockedDates: '$providerInfo.blockedDates', // [UPDATE] Tampilkan Blocked Dates
        createdAt: '$providerInfo.createdAt',
        distance: '$distance' 
      }
    });

    const providers = await User.aggregate(pipeline);

    await Provider.populate(providers, {
      path: 'services.serviceId',
      select: 'name category iconUrl basePrice',
      model: Service
    });

    res.json({ 
      messageKey: 'providers.list', 
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
      return res.status(404).json({ message: 'Mitra tidak ditemukan' });
    }

    const provider = await Provider.findById(id)
      .populate({
        path: 'userId',
        select: 'fullName profilePictureUrl address location bio phoneNumber'
      })
      .populate({
        path: 'services.serviceId',
        select: 'name category iconUrl basePrice'
      });

    if (!provider) {
      return res.status(404).json({ message: 'Mitra tidak ditemukan' });
    }

    // [BARU] Ambil juga tanggal yang sudah ter-booking oleh customer lain
    const bookedDates = await getBookedDates(provider._id);

    // Kirim data provider + bookedDates terpisah agar frontend bisa bedakan warna
    // Kita convert object mongoose ke plain object dulu
    const providerData = provider.toObject();
    providerData.bookedDates = bookedDates;

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
      .populate('services.serviceId', 'name category iconUrl');

    if (!provider) {
      return res.status(404).json({ message: 'Profil Mitra belum dibuat' });
    }

    // [BARU] Ambil tanggal booked untuk dilihat sendiri oleh provider
    const bookedDates = await getBookedDates(provider._id);
    const providerData = provider.toObject();
    providerData.bookedDates = bookedDates;

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

// [BARU] Update Ketersediaan (Libur Manual)
async function updateAvailability(req, res, next) {
  try {
    const userId = req.user.userId; 
    // Menerima array blockedDates: ["2024-12-25", "2024-12-31"]
    const { blockedDates } = req.body; 

    const provider = await Provider.findOne({ userId });
    if (!provider) {
        return res.status(404).json({ message: 'Profil Mitra tidak ditemukan' });
    }

    // Update blockedDates
    // Pastikan input adalah array of date yang valid
    provider.blockedDates = blockedDates;
    await provider.save();

    res.json({
        message: 'Ketersediaan kalender berhasil diperbarui',
        data: provider.blockedDates
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
    updateAvailability // Ganti updateSchedule jadi ini
};