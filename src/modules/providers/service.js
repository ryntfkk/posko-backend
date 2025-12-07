// src/modules/providers/service.js
const mongoose = require('mongoose');
const Provider = require('./model');
const User = require('../../models/User');
const Service = require('../services/model');
const Order = require('../orders/model');
const { Types } = require('mongoose');

// Helper: Escape Regex
function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

class ProviderService {
  
  // [OPTIMIZATION] Helper untuk booked dates dengan batas waktu logis
  async getBookedDates(providerId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sixMonthsFromNow = new Date();
    sixMonthsFromNow.setMonth(today.getMonth() + 6);
    sixMonthsFromNow.setDate(sixMonthsFromNow.getDate() + 1);
    sixMonthsFromNow.setHours(0, 0, 0, 0); 
    
    const timezone = '+07:00';

    const result = await Order.aggregate([
      {
        $match: {
          providerId: new Types.ObjectId(providerId),
          status: { $in: ['paid', 'accepted', 'on_the_way', 'working', 'waiting_approval'] }, 
          scheduledAt: { 
            $gte: today,
            $lte: sixMonthsFromNow
          }
        }
      },
      {
        $project: {
          dateStr: { 
            $dateToString: { format: "%Y-%m-%d", date: "$scheduledAt", timezone } 
          }
        }
      },
      {
        $group: {
          _id: "$dateStr"
        }
      }
    ]);

    return result.map(r => r._id);
  }

  // [OPTIMIZATION] Helper count (bisa di-denormalisasi nanti, tapi sekarang kita isolate dulu)
  async getCompletedOrdersCount(providerId) {
    return await Order.countDocuments({
      providerId,
      status: 'completed'
    });
  }

  // --- MAIN LOGIC ---

  async listProviders(user, query) {
    const {
      category,
      search,
      sortBy = 'distance',
      limit = 10,
      page = 1,
      lat, 
      lng,
      status 
    } = query;

    const { roles = [] } = user || {};
    const isAdmin = roles.includes('admin');

    // 1. DETERMINASI LOKASI PUSAT
    let userCoordinates = null;
    let locationSource = 'none';

    if (user && user.userId) {
        const customer = await User.findById(user.userId).select('location');
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

    // 2. BUILD QUERY (Pre-Calculation Stage)
    let matchStage = {};

    if (isAdmin) {
        if (status && status !== 'all') {
            matchStage.verificationStatus = status;
        }
    } else {
        matchStage.verificationStatus = 'verified';
        matchStage.isOnline = true;
    }

    // [PERFORMANCE FIX] Category Filter: Pre-fetch Service IDs
    if (category && typeof category === 'string' && category.trim() !== '') {
        const normalizedCategory = decodeURIComponent(category).trim().replace(/-/g, ' ');
        const categoryRegex = new RegExp(`^${escapeRegex(normalizedCategory)}$`, 'i');
        
        const matchedServices = await Service.find({ category: categoryRegex }).select('_id').lean();
        const searchServiceIds = matchedServices.map(s => s._id);

        if (searchServiceIds.length > 0) {
            matchStage['services.serviceId'] = { $in: searchServiceIds };
            matchStage['services.isActive'] = true; 
        } else {
            return { data: [], meta: { count: 0, locationSource } };
        }
    }

    // [PERFORMANCE FIX] Text Search: Pre-fetch IDs (User & Service)
    // Strategi: Cari User ID dan Service ID yang cocok dengan kata kunci DI AWAL.
    // Lalu masukkan ID tersebut ke query utama ($match).
    // Ini menghindari Regex search pada field hasil lookup yang membunuh performa.
    if (search && typeof search === 'string' && search.trim() !== '') {
        const searchRegex = new RegExp(escapeRegex(search.trim()), 'i');

        // Parallel Pre-queries
        const [matchingUsers, matchingServices] = await Promise.all([
            User.find({ fullName: { $regex: searchRegex } }).select('_id').lean(),
            Service.find({ 
              $or: [
                { name: { $regex: searchRegex } },
                { category: { $regex: searchRegex } }
              ] 
            }).select('_id').lean()
        ]);

        const searchUserIds = matchingUsers.map(u => u._id);
        const searchServiceIds = matchingServices.map(s => s._id);

        const orConditions = [
            { userId: { $in: searchUserIds } }, // Match by Provider Name
            { 'location.address.city': { $regex: searchRegex } },
            { 'location.address.district': { $regex: searchRegex } }
        ];

        // Jika ada service yang cocok, tambahkan ke kriteria pencarian
        if (searchServiceIds.length > 0) {
            orConditions.push({
                'services': {
                    $elemMatch: {
                        serviceId: { $in: searchServiceIds },
                        isActive: true
                    }
                }
            });
        }

        matchStage.$or = orConditions;
    }

    // 3. BUILD PIPELINE
    const pipeline = [];

    // Stage 1: GeoNear (Wajib Pertama jika ada)
    if (userCoordinates) {
      pipeline.push({
        $geoNear: {
          near: { type: "Point", coordinates: userCoordinates },
          key: "location", 
          distanceField: "distance",
          maxDistance: 20000, // 20 KM
          spherical: true,
          query: matchStage // Index Scan terjadi di sini
        }
      });
    } else {
      pipeline.push({ $match: matchStage });
    }

    // Stage 2: Lookup User Info
    pipeline.push({
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'userInfo'
      }
    });
    pipeline.push({ $unwind: '$userInfo' });

    // Stage 3: Sort
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
        sortOptions[userCoordinates ? 'distance' : 'rating'] = userCoordinates ? 1 : -1;
    }
    pipeline.push({ $sort: sortOptions });

    // Stage 4: Pagination
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, parseInt(limit));
    const skip = (pageNum - 1) * limitNum;

    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: limitNum });

    // Stage 5: Project
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

    // Populate Service Details (Efficiently after aggregation)
    await Provider.populate(providers, {
      path: 'services.serviceId',
      select: 'name category iconUrl basePrice unit unitLabel displayUnit shortDescription description estimatedDuration includes excludes requirements isPromo promoPrice discountPercent',
      model: Service
    });

    return {
      data: providers,
      meta: {
        locationSource,
        count: providers.length, // Note: For total count in pagination, separate query is needed ideally
        page: pageNum,
        limit: limitNum
      }
    };
  }

  async getProviderById(id) {
    if (!Types.ObjectId.isValid(id)) return null;

    const provider = await Provider.findById(id)
      .populate({
        path: 'userId',
        select: 'fullName profilePictureUrl address location bio phoneNumber'
      })
      .populate({
        path: 'services.serviceId',
        select: 'name category iconUrl basePrice unit unitLabel displayUnit shortDescription description estimatedDuration includes excludes requirements isPromo promoPrice discountPercent'
      });

    if (!provider) return null;

    // Parallel Fetching for Extras
    const [bookedDates, totalCompletedOrders] = await Promise.all([
      this.getBookedDates(provider._id),
      this.getCompletedOrdersCount(provider._id)
    ]);

    const providerData = provider.toObject();
    providerData.bookedDates = bookedDates;
    providerData.totalCompletedOrders = totalCompletedOrders;
    delete providerData.schedule; 

    return providerData;
  }

  async getProviderMe(userId) {
    const provider = await Provider.findOne({ userId })
      .populate('services.serviceId', 'name category iconUrl basePrice unit unitLabel displayUnit shortDescription description estimatedDuration includes excludes requirements isPromo promoPrice discountPercent');

    if (!provider) return null;

    const [bookedDates, totalCompletedOrders] = await Promise.all([
        this.getBookedDates(provider._id),
        this.getCompletedOrdersCount(provider._id)
    ]);

    const providerData = provider.toObject();
    providerData.bookedDates = bookedDates;
    providerData.totalCompletedOrders = totalCompletedOrders;
    delete providerData.schedule; 
    
    return providerData;
  }

  async createProvider(userId, services) {
    const exist = await Provider.findOne({ userId });
    if (exist) throw new Error('User ini sudah terdaftar sebagai provider');

    const provider = new Provider({ userId, services });
    await provider.save();

    await User.findByIdAndUpdate(userId, {
      $addToSet: { roles: 'provider' },
      activeRole: 'provider'
    });
    
    return provider;
  }

  async updateAvailability(userId, blockedDates) {
    const provider = await Provider.findOne({ userId });
    if (!provider) throw new Error('Profil mitra tidak ditemukan');

    provider.blockedDates = blockedDates;
    await provider.save();
    return blockedDates;
  }

  async updatePortfolio(userId, portfolioImages) {
    if (!Array.isArray(portfolioImages)) throw new Error('Format portfolio tidak valid');

    const provider = await Provider.findOne({ userId });
    if (!provider) throw new Error('Profil mitra tidak ditemukan');

    provider.portfolioImages = portfolioImages;
    await provider.save();
    return provider;
  }

  async updateProviderServices(userId, services) {
    if (!Array.isArray(services)) throw new Error('Format layanan tidak valid');

    const provider = await Provider.findOne({ userId });
    if (!provider) throw new Error('Profil mitra tidak ditemukan');

    provider.services = services;
    await provider.save();

    return await Provider.findOne({ userId })
      .populate('services.serviceId', 'name category iconUrl basePrice unit unitLabel');
  }

  async toggleOnlineStatus(userId, isOnline) {
    const provider = await Provider.findOne({ userId });
    if (!provider) throw new Error('Profil mitra tidak ditemukan');

    provider.isOnline = isOnline;
    await provider.save();
    return provider.isOnline;
  }

  async updateProviderProfile(userId, data) {
    const { bio, fullAddress, province, district, city, postalCode, latitude, longitude, workingHours } = data;

    const provider = await Provider.findOne({ userId });
    if (!provider) throw new Error('Profil mitra tidak ditemukan');

    // Update fields
    if (bio !== undefined) provider.bio = bio;

    if (!provider.location) {
        provider.location = { type: 'Point', coordinates: [0, 0], address: {} };
    }

    const existingAddress = (provider.location.address && typeof provider.location.address === 'object') 
        ? provider.location.address 
        : { fullAddress: typeof provider.location.address === 'string' ? provider.location.address : '' };

    provider.location.address = {
        fullAddress: fullAddress ?? existingAddress.fullAddress ?? '',
        province: province ?? existingAddress.province ?? '',
        city: city ?? existingAddress.city ?? '',
        district: district ?? existingAddress.district ?? '',
        postalCode: postalCode ?? existingAddress.postalCode ?? ''
    };

    if (latitude !== undefined && longitude !== undefined) {
        const lat = parseFloat(latitude);
        const lng = parseFloat(longitude);
        
        if (!isNaN(lat) && !isNaN(lng)) {
            provider.location.type = 'Point';
            provider.location.coordinates = [lng, lat]; 
        }
    }

    if (workingHours) {
        provider.workingHours = {
            start: workingHours.start || provider.workingHours?.start,
            end: workingHours.end || provider.workingHours?.end
        };
    }

    await provider.save();
    return provider;
  }

  async verifyProvider(id, status, rejectionReason) {
    if (!['verified', 'rejected'].includes(status)) throw new Error('Status harus verified atau rejected');

    const provider = await Provider.findById(id);
    if (!provider) throw new Error('Mitra tidak ditemukan');

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

    return provider;
  }
}

module.exports = new ProviderService();