const Voucher = require('./model');
const UserVoucher = require('./userVoucherModel');
const Service = require('../services/model');
const jwt = require('jsonwebtoken');
const env = require('../../config/env');

// 1. LIST AVAILABLE VOUCHERS (MARKETPLACE)
// Menampilkan voucher global yang BELUM diklaim user (Support Guest & Logged User)
async function listAvailableVouchers(req, res, next) {
  try {
    let userId = null;
    const now = new Date();

    // [LOGIKA BARU] Cek Token Manual (Optional Auth)
    // Kita tidak pakai middleware 'authenticate' di route ini agar Guest tetap bisa akses.
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
       const token = authHeader.split(' ')[1];
       try {
          const decoded = jwt.verify(token, env.jwtSecret);
          userId = decoded.userId;
       } catch (err) {
          // Token invalid/expired -> Anggap sebagai Guest (ignore error)
          userId = null;
       }
    }

    // Filter ID voucher yang sudah diklaim (hanya jika user login)
    let claimedVoucherIds = [];
    if (userId) {
      const claimedVouchers = await UserVoucher.find({ userId }).select('voucherId');
      // Convert ke string agar mudah dicocokkan nanti
      claimedVoucherIds = claimedVouchers.map(uv => uv.voucherId.toString());
    }

    // Cari voucher master yang:
    // 1. Aktif
    // 2. Kuota > 0
    // 3. Belum expired
    // NOTE: Kita TIDAK lagi mengecualikan claimedVoucherIds dari query database
    // agar voucher tetap muncul di list meski sudah diklaim.
    const query = {
      isActive: true,
      quota: { $gt: 0 },
      expiryDate: { $gt: now }
    };

    // Gunakan .lean() agar hasil query berupa Plain JS Object (bukan Mongoose Document)
    // sehingga kita bisa memodifikasinya (menambah property isClaimed)
    const vouchers = await Voucher.find(query)
    .populate('applicableServices', 'name')
    .sort({ createdAt: -1 })
    .lean();

    // Map data untuk menambahkan flag isClaimed
    const formattedVouchers = vouchers.map(voucher => ({
        ...voucher,
        isClaimed: claimedVoucherIds.includes(voucher._id.toString())
    }));

    res.json({ 
      message: 'Daftar voucher tersedia berhasil diambil', 
      data: formattedVouchers 
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

    // A. Cek Apakah User Sudah Klaim? (Cek di UserVoucher dulu agar hemat query)
    // Kita perlu cari voucherId berdasarkan kode dulu sebenarnya, tapi karena UserVoucher
    // menyimpan referensi ObjectId, kita harus cari Master Voucher dulu untuk dapat _id nya.
    
    // Cari Master Voucher yang cocok kodenya
    const voucherCheck = await Voucher.findOne({ 
      code: code.toUpperCase(), 
      isActive: true 
    });

    if (!voucherCheck) {
      return res.status(404).json({ message: 'Voucher tidak ditemukan atau tidak aktif' });
    }

    // Cek kepemilikan duplikat
    const existingClaim = await UserVoucher.findOne({
      userId,
      voucherId: voucherCheck._id
    });

    if (existingClaim) {
      return res.status(400).json({ message: 'Anda sudah mengklaim voucher ini sebelumnya' });
    }

    // B. Cek Expiry Date
    const now = new Date();
    if (new Date(voucherCheck.expiryDate) < now) {
      return res.status(400).json({ message: 'Voucher sudah kadaluarsa' });
    }

    // C. [FIXED] ATOMIC UPDATE QUOTA (Mencegah Race Condition)
    // Gunakan findOneAndUpdate dengan kondisi quota > 0
    // Ini memastikan jika 2 user klaim sisa 1 kuota bersamaan, hanya 1 yang berhasil.
    const voucher = await Voucher.findOneAndUpdate(
      { 
        _id: voucherCheck._id, 
        quota: { $gt: 0 } // Syarat: Quota harus > 0
      },
      { 
        $inc: { quota: -1 } // Kurangi 1
      },
      { new: true }
    );

    if (!voucher) {
      return res.status(400).json({ message: 'Kuota voucher sudah habis' });
    }

    // D. Simpan ke UserVoucher
    try {
      await UserVoucher.create({
        userId,
        voucherId: voucher._id,
        status: 'active'
      });
    } catch (createError) {
      // Rollback quota jika gagal create UserVoucher (misal karena constraint unique lolos pengecekan awal)
      await Voucher.findByIdAndUpdate(voucher._id, { $inc: { quota: 1 } });
      throw createError;
    }

    res.status(201).json({ 
      message: 'Voucher berhasil diklaim!',
      data: {
        code: voucher.code,
        validUntil: voucher.expiryDate
      }
    });

  } catch (error) {
    // Handle duplicate key error mongodb (E11000)
    if (error.code === 11000) {
       return res.status(400).json({ message: 'Anda sudah mengklaim voucher ini.' });
    }
    next(error);
  }
}

// 4. CHECK VOUCHER (LOGIKA BARU DENGAN LAYANAN SPESIFIK & SECURITY FIX)
async function checkVoucher(req, res, next) {
  try {
    const userId = req.user.userId;
    const { code, items = [] } = req.body; 
    // items format: [{ serviceId, quantity }, ...] -> Price dari client kita ABAIKAN demi keamanan

    if (!code) {
      return res.status(400).json({ message: 'Kode voucher wajib diisi' });
    }

    // [FIXED LOGIC] 
    // 1. Cari Master Voucher dulu berdasarkan kode untuk mendapatkan ID-nya
    const masterVoucher = await Voucher.findOne({ 
        code: code.toUpperCase() 
    });

    if (!masterVoucher) {
        // Jika kode voucher sama sekali tidak ada di sistem
        return res.status(404).json({ message: 'Kode voucher tidak valid.' });
    }

    // 2. Cari di UserVoucher apakah user memiliki klaim AKTIF untuk voucher ID tersebut
    // Kita harus spesifik mencari berdasarkan voucherId dari masterVoucher yang ditemukan
    const userVoucher = await UserVoucher.findOne({ 
      userId,
      voucherId: masterVoucher._id,
      status: 'active'
    }).populate('voucherId');

    if (!userVoucher) {
      return res.status(404).json({ message: 'Voucher belum diklaim atau sudah terpakai.' });
    }

    const voucher = userVoucher.voucherId;

    // B. Validasi Dasar Master Voucher
    const now = new Date();
    if (!voucher.isActive || new Date(voucher.expiryDate) < now) {
      return res.status(400).json({ message: 'Voucher sudah kadaluarsa atau dinonaktifkan' });
    }

    // C. [FIXED] FETCH HARGA ASLI DARI DB & HITUNG ELIGIBLE AMOUNT
    // Kita tidak mempercayai harga dari req.body
    let eligibleTotal = 0;
    const applicableServiceIds = voucher.applicableServices.map(id => id.toString());
    const isGlobalVoucher = applicableServiceIds.length === 0;

    // Loop items dari request, tapi ambil harga dari DB
    for (const item of items) {
      if (!item.serviceId) continue;
      
      const service = await Service.findById(item.serviceId).select('price basePrice');
      if (!service) continue;

      const realPrice = service.price || service.basePrice || 0;
      const quantity = Number(item.quantity) || 1;
      const itemTotal = realPrice * quantity;

      if (isGlobalVoucher) {
        eligibleTotal += itemTotal;
      } else {
        if (applicableServiceIds.includes(item.serviceId.toString())) {
          eligibleTotal += itemTotal;
        }
      }
    }

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
        userVoucherId: userVoucher._id, 
        code: voucher.code,
        discountType: voucher.discountType,
        discountValue: voucher.discountValue,
        estimatedDiscount: Math.floor(discount),
        eligibleTotal: eligibleTotal 
      }
    });

  } catch (error) {
    next(error);
  }
}
// [BARU] ADMIN: List Semua Voucher (Tanpa filter kuota/expired)
async function listAllVouchers(req, res, next) {
  try {
    const { roles = [] } = req.user || {};
    if (!roles.includes('admin')) return res.status(403).json({ message: 'Forbidden' });

    const vouchers = await Voucher.find().sort({ createdAt: -1 });
    res.json({ message: 'All vouchers', data: vouchers });
  } catch (error) {
    next(error);
  }
}

// [BARU] ADMIN: Create Voucher
async function createVoucher(req, res, next) {
  try {
    const { roles = [] } = req.user || {};
    if (!roles.includes('admin')) return res.status(403).json({ message: 'Forbidden' });

    const voucher = new Voucher(req.body);
    await voucher.save();
    res.status(201).json({ message: 'Voucher created', data: voucher });
  } catch (error) {
    next(error);
  }
}

// [BARU] ADMIN: Update Voucher
async function updateVoucher(req, res, next) {
  try {
    const { roles = [] } = req.user || {};
    if (!roles.includes('admin')) return res.status(403).json({ message: 'Forbidden' });

    const { id } = req.params;
    const voucher = await Voucher.findByIdAndUpdate(id, req.body, { new: true });
    if (!voucher) return res.status(404).json({ message: 'Voucher not found' });

    res.json({ message: 'Voucher updated', data: voucher });
  } catch (error) {
    next(error);
  }
}

// [BARU] ADMIN: Delete Voucher
async function deleteVoucher(req, res, next) {
  try {
    const { roles = [] } = req.user || {};
    if (!roles.includes('admin')) return res.status(403).json({ message: 'Forbidden' });

    const { id } = req.params;
    await Voucher.findByIdAndDelete(id);
    res.json({ message: 'Voucher deleted' });
  } catch (error) {
    next(error);
  }
}
module.exports = { 
  listAvailableVouchers, 
  listMyVouchers, 
  claimVoucher, 
  checkVoucher,
  listAllVouchers,
  createVoucher,
  updateVoucher,
  deleteVoucher
};