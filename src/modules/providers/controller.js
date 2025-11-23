const Provider = require('./model');
const User = require('../../models/User');
const Service = require('../services/model');

// Helper untuk validasi ID MongoDB
const { Types } = require('mongoose');

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

    // ---------------------------------------------------------
    // 1. GEO-SPATIAL FILTER (Wajib di urutan pertama jika ada lat/lng)
    // ---------------------------------------------------------
    if (lat && lng) {
      pipeline.push({
        $geoNear: {
          near: { 
            type: "Point", 
            coordinates: [parseFloat(lng), parseFloat(lat)] // [Longitude, Latitude]
          },
          distanceField: "distance", // Output jarak dalam meter
          maxDistance: 20000, // Cari radius maks 20 KM
          spherical: true,
          // Filter awal: Hanya User yang role-nya provider & aktif
          query: { roles: 'provider', status: 'active' } 
        }
      });
    } else {
      // Jika tidak ada lokasi, ambil semua provider aktif (tanpa hitung jarak)
      pipeline.push({ 
        $match: { 
          roles: 'provider',
          status: 'active'
        } 
      });
    }

    // ---------------------------------------------------------
    // 2. RELASI KE DATA PROVIDER (Lookup ke collection 'providers')
    // ---------------------------------------------------------
    pipeline.push({
      $lookup: {
        from: 'providers', // Nama collection di DB (lowercase + s)
        localField: '_id',
        foreignField: 'userId',
        as: 'providerInfo'
      }
    });
    
    // Ubah array providerInfo menjadi object (Hapus user yang tidak punya data provider)
    pipeline.push({ $unwind: '$providerInfo' });

    // ---------------------------------------------------------
    // 3. RELASI KE LAYANAN (Untuk Filter Kategori & Search)
    // ---------------------------------------------------------
    // Kita perlu detail layanan (nama, kategori) untuk filter
    pipeline.push({
      $lookup: {
        from: 'services',
        localField: 'providerInfo.services.serviceId',
        foreignField: '_id',
        as: 'serviceDetails'
      }
    });

    // ---------------------------------------------------------
    // 4. LOGIKA FILTER (Search & Category)
    // ---------------------------------------------------------
    const matchConditions = [];

    // A. Filter Kategori (misal: "ac" -> cocokkan dengan kategori layanan)
    if (category) {
      const categoryRegex = new RegExp(category.replace(/-/g, ' '), 'i');
      matchConditions.push({
        'serviceDetails.category': { $regex: categoryRegex }
      });
    }

    // B. Filter Search (Cari Nama Mitra ATAU Nama Layanan ATAU Kota)
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

    // Terapkan filter jika ada
    if (matchConditions.length > 0) {
      pipeline.push({
        $match: { $and: matchConditions }
      });
    }

    // ---------------------------------------------------------
    // 5. SORTING & PAGINATION
    // ---------------------------------------------------------
    let sortStage = {};
    if (sortBy === 'rating') {
      sortStage = { 'providerInfo.rating': -1 };
    } else if (sortBy === 'distance' && lat && lng) {
      sortStage = { distance: 1 }; // Jarak terdekat
    } else {
      sortStage = { createdAt: -1 }; // Terbaru
    }

    pipeline.push({ $sort: sortStage });
    
    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: parseInt(limit) });

    // ---------------------------------------------------------
    // 6. PROJECTION (Format Output)
    // ---------------------------------------------------------
    // Membentuk JSON agar strukturnya mirip populate Mongoose biasa
    pipeline.push({
      $project: {
        _id: '$providerInfo._id', // Gunakan ID Provider sebagai ID utama
        userId: {                 // Masukkan detail user ke dalam properti userId
          _id: '$_id',
          fullName: '$fullName',
          email: '$email',
          profilePictureUrl: '$profilePictureUrl',
          address: '$address',
          location: '$location',
          bio: '$bio',
          phoneNumber: '$phoneNumber'
        },
        // Ambil services dari providerInfo
        services: '$providerInfo.services',
        rating: '$providerInfo.rating',
        isOnline: '$providerInfo.isOnline',
        createdAt: '$providerInfo.createdAt',
        distance: '$distance' // Kirim balik jaraknya
      }
    });

    // Jalankan Pipeline
    const providers = await User.aggregate(pipeline);

    // [PENTING] Populate detail Services (Nama & Icon) secara manual
    // Karena aggregation di atas hanya mengembalikan ID services, kita perlu
    // memanggil populate lagi agar Frontend bisa menampilkan ikon/nama layanan.
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

    // Validasi format ID sebelum query agar tidak server error
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

    res.json({ 
      messageKey: 'providers.detail', 
      message: 'Detail mitra ditemukan', 
      data: provider 
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
    
    // Update role user
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

module.exports = { listProviders, getProviderById, createProvider };