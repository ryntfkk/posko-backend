const Voucher = require('./model');
const UserVoucher = require('./userVoucherModel');
const Service = require('../services/model');

// 1. LIST AVAILABLE VOUCHERS (MARKETPLACE)
// Menampilkan voucher global yang BELUM diklaim user
async function listAvailableVouchers(req, res, next) {
  try {
    const userId = req.user.userId;
    const now = new Date();

    // Ambil ID voucher yang sudah diklaim user ini
    const claimedVouchers = await UserVoucher.find({ userId }).select('voucherId');
    const claimedVoucherIds = claimedVouchers.map(uv => uv.voucherId);

    // Cari voucher master yang:
    // 1. Aktif
    // 2. Kuota > 0
    // 3. Belum expired
    // 4. ID-nya TIDAK ada di daftar claimedVoucherIds
    const vouchers = await Voucher.find({
      isActive: true,
      quota: { $gt: 0 },
      expiryDate: { $gt: now },
      _id: { $nin: claimedVoucherIds } // Exclude yang sudah punya
    })
    .populate('applicableServices', 'name') // Opsional: Tampilkan nama service jika spesifik
    .sort({ createdAt: -1 });

    res.json({ 
      message: 'Daftar voucher tersedia berhasil diambil', 
      data: vouchers 
    });
  } catch (error) {
    next(error);
  }
}

// 2. LIST MY VOUCHERS
// Menampilkan voucher yang SUDAH diklaim user
async function listMyVouchers(req, res, next) {
  try {
    const userId = req.user.userId;

    const myVouchers = await UserVoucher.find({ 
      userId,
      status: 'active' // Hanya tampilkan yang belum dipakai
    })
    .populate({
      path: 'voucherId', // Ambil detail voucher aslinya
      populate: { path: 'applicableServices', select: 'name' }
    })
    .sort({ claimedAt: -1 });

    // Transformasi data agar frontend lebih mudah bacanya
    // Kita "flatten" strukturnya sedikit
    const formattedVouchers = myVouchers
      .filter(item => item.voucherId) // Jaga-jaga jika master voucher terhapus
      .map(item => {
        const v = item.voucherId;
        return {
          _id: v._id,
          userVoucherId: item._id, // ID referensi klaim
          code: v.code,
          description: v.description,
          discountType: v.discountType,
          discountValue: v.discountValue,
          minPurchase: v.minPurchase,
          expiryDate: v.expiryDate,
          applicableServices: v.applicableServices, // Array service
          claimedAt: item.claimedAt
        };
      });

    res.json({ 
      message: 'Voucher saya berhasil diambil', 
      data: formattedVouchers 
    });
  } catch (error) {
    next(error);
  }
}

// 3. CLAIM VOUCHER
async function claimVoucher(req, res, next) {
  try {
    const userId = req.user.userId;
    const { code } = req.body;

    // A. Cek Master Voucher
    const voucher = await Voucher.findOne({ 
      code: code.toUpperCase(), 
      isActive: true 
    });

    if (!voucher) {
      return res.status(404).json({ message: 'Voucher tidak ditemukan atau tidak aktif' });
    }

    const now = new Date();
    if (new Date(voucher.expiryDate) < now) {
      return res.status(400).json({ message: 'Voucher sudah kadaluarsa' });
    }

    if (voucher.quota <= 0) {
      return res.status(400).json({ message: 'Kuota voucher sudah habis' });
    }

    // B. Cek Apakah User Sudah Klaim?
    const existingClaim = await UserVoucher.findOne({
      userId,
      voucherId: voucher._id
    });

    if (existingClaim) {
      return res.status(400).json({ message: 'Anda sudah mengklaim voucher ini sebelumnya' });
    }

    // C. Proses Klaim (Simpan ke UserVoucher & Kurangi Quota)
    // Idealnya menggunakan Transaction jika pakai MongoDB Replica Set.
    // Untuk simplifikasi, kita pakai sequential await.
    
    await UserVoucher.create({
      userId,
      voucherId: voucher._id,
      status: 'active'
    });

    // Kurangi kuota global
    voucher.quota -= 1;
    await voucher.save();

    res.status(201).json({ 
      message: 'Voucher berhasil diklaim!',
      data: {
        code: voucher.code,
        validUntil: voucher.expiryDate
      }
    });

  } catch (error) {
    next(error);
  }
}

// 4. CHECK VOUCHER (LOGIKA BARU DENGAN LAYANAN SPESIFIK)
async function checkVoucher(req, res, next) {
  try {
    const userId = req.user.userId;
    const { code, items = [] } = req.body; 
    // items expected format: [{ serviceId, price, quantity }, ...]
    
    if (!code) {
      return res.status(400).json({ message: 'Kode voucher wajib diisi' });
    }

    // A. Validasi Kepemilikan (Cek di UserVoucher)
    // Kita cari UserVoucher yang join ke Voucher master untuk cek kode
    const userVoucher = await UserVoucher.findOne({ 
      userId,
      status: 'active'
    }).populate({
      path: 'voucherId',
      match: { code: code.toUpperCase() } // Filter populate hanya yang kodenya cocok
    });

    // Jika userVoucher null ATAU voucherId null (artinya punya userVoucher tapi kodenya beda)
    if (!userVoucher || !userVoucher.voucherId) {
      return res.status(404).json({ message: 'Voucher tidak valid atau belum diklaim.' });
    }

    const voucher = userVoucher.voucherId;

    // B. Validasi Dasar Master Voucher
    const now = new Date();
    if (!voucher.isActive || new Date(voucher.expiryDate) < now) {
      return res.status(400).json({ message: 'Voucher sudah kadaluarsa atau dinonaktifkan' });
    }

    // C. Validasi Layanan Spesifik & Hitung Eligible Amount
    let eligibleTotal = 0;
    const applicableServiceIds = voucher.applicableServices.map(id => id.toString());
    const isGlobalVoucher = applicableServiceIds.length === 0;

    // Hitung total belanja dari item yang VALID saja
    items.forEach(item => {
      const itemTotal = (Number(item.price) || 0) * (Number(item.quantity) || 1);
      
      if (isGlobalVoucher) {
        // Jika voucher global, semua item dihitung
        eligibleTotal += itemTotal;
      } else {
        // Jika voucher spesifik, cek apakah serviceId item ada di daftar applicable
        if (applicableServiceIds.includes(item.serviceId)) {
          eligibleTotal += itemTotal;
        }
      }
    });

    // Jika tidak ada item yang cocok sama sekali
    if (eligibleTotal === 0 && items.length > 0) {
      return res.status(400).json({ 
        message: 'Voucher ini tidak berlaku untuk layanan yang Anda pilih.' 
      });
    }

    // D. Validasi Minimal Belanja (Berdasarkan Eligible Total)
    if (eligibleTotal < voucher.minPurchase) {
      return res.status(400).json({ 
        message: `Minimal pembelian produk yang valid adalah Rp ${voucher.minPurchase.toLocaleString()}` 
      });
    }

    // E. Hitung Diskon
    let discount = 0;
    if (voucher.discountType === 'percentage') {
      discount = (eligibleTotal * voucher.discountValue) / 100;
      if (voucher.maxDiscount > 0 && discount > voucher.maxDiscount) {
        discount = voucher.maxDiscount;
      }
    } else {
      // Fixed
      discount = voucher.discountValue;
    }
    
    // Cap diskon max sebesar eligibleTotal
    if (discount > eligibleTotal) {
      discount = eligibleTotal;
    }

    res.json({ 
      message: 'Voucher valid', 
      data: {
        _id: voucher._id,
        userVoucherId: userVoucher._id, // Penting untuk update status nanti
        code: voucher.code,
        discountType: voucher.discountType,
        discountValue: voucher.discountValue,
        estimatedDiscount: Math.floor(discount),
        eligibleTotal: eligibleTotal // Info tambahan debug
      }
    });

  } catch (error) {
    next(error);
  }
}

module.exports = { 
  listAvailableVouchers, 
  listMyVouchers, 
  claimVoucher, 
  checkVoucher 
};