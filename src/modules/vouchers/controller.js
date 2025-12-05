const Voucher = require('./model');
const UserVoucher = require('./userVoucherModel');
const Service = require('../services/model');
const jwt = require('jsonwebtoken');
const env = require('../../config/env');

// 1. LIST AVAILABLE VOUCHERS (MARKETPLACE)
async function listAvailableVouchers(req, res, next) {
  try {
    let userId = null;
    const now = new Date();

    // Cek Token Manual (Optional Auth)
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
       const token = authHeader.split(' ')[1];
       try {
          const decoded = jwt.verify(token, env.jwtSecret);
          userId = decoded.userId;
       } catch (err) {
          userId = null;
       }
    }

    let claimedVoucherIds = [];
    if (userId) {
      const claimedVouchers = await UserVoucher.find({ userId }).select('voucherId');
      claimedVoucherIds = claimedVouchers.map(uv => uv.voucherId.toString());
    }

    const query = {
      isActive: true,
      quota: { $gt: 0 },
      expiryDate: { $gt: now }
    };

    const vouchers = await Voucher.find(query)
    .populate('applicableServices', 'name')
    .sort({ createdAt: -1 })
    .lean();

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
async function listMyVouchers(req, res, next) {
  try {
    const userId = req.user.userId;

    const myVouchers = await UserVoucher.find({ 
      userId,
      status: 'active'
    })
    .populate({
      path: 'voucherId',
      populate: { path: 'applicableServices', select: 'name' }
    })
    .sort({ claimedAt: -1 });

    const formattedVouchers = myVouchers
      .filter(item => item.voucherId)
      .map(item => {
        const v = item.voucherId;
        return {
          _id: v._id,
          userVoucherId: item._id,
          code: v.code,
          description: v.description,
          discountType: v.discountType,
          discountValue: v.discountValue,
          minPurchase: v.minPurchase,
          expiryDate: v.expiryDate,
          applicableServices: v.applicableServices,
          imageUrl: v.imageUrl, // Tambahkan imageUrl
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

    const voucherCheck = await Voucher.findOne({ 
      code: code.toUpperCase(), 
      isActive: true 
    });

    if (!voucherCheck) {
      return res.status(404).json({ message: 'Voucher tidak ditemukan atau tidak aktif' });
    }

    const existingClaim = await UserVoucher.findOne({
      userId,
      voucherId: voucherCheck._id
    });

    if (existingClaim) {
      return res.status(400).json({ message: 'Anda sudah mengklaim voucher ini sebelumnya' });
    }

    const now = new Date();
    if (new Date(voucherCheck.expiryDate) < now) {
      return res.status(400).json({ message: 'Voucher sudah kadaluarsa' });
    }

    const voucher = await Voucher.findOneAndUpdate(
      { 
        _id: voucherCheck._id, 
        quota: { $gt: 0 }
      },
      { 
        $inc: { quota: -1 }
      },
      { new: true }
    );

    if (!voucher) {
      return res.status(400).json({ message: 'Kuota voucher sudah habis' });
    }

    try {
      await UserVoucher.create({
        userId,
        voucherId: voucher._id,
        status: 'active'
      });
    } catch (createError) {
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
    if (error.code === 11000) {
       return res.status(400).json({ message: 'Anda sudah mengklaim voucher ini.' });
    }
    next(error);
  }
}

// 4. CHECK VOUCHER
async function checkVoucher(req, res, next) {
  try {
    const userId = req.user.userId;
    const { code, items = [] } = req.body; 

    if (!code) {
      return res.status(400).json({ message: 'Kode voucher wajib diisi' });
    }

    const masterVoucher = await Voucher.findOne({ 
        code: code.toUpperCase() 
    });

    if (!masterVoucher) {
        return res.status(404).json({ message: 'Kode voucher tidak valid.' });
    }

    const userVoucher = await UserVoucher.findOne({ 
      userId,
      voucherId: masterVoucher._id,
      status: 'active'
    }).populate('voucherId');

    if (!userVoucher) {
      return res.status(404).json({ message: 'Voucher belum diklaim atau sudah terpakai.' });
    }

    const voucher = userVoucher.voucherId;

    const now = new Date();
    if (!voucher.isActive || new Date(voucher.expiryDate) < now) {
      return res.status(400).json({ message: 'Voucher sudah kadaluarsa atau dinonaktifkan' });
    }

    let eligibleTotal = 0;
    const applicableServiceIds = voucher.applicableServices.map(id => id.toString());
    const isGlobalVoucher = applicableServiceIds.length === 0;

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

    if (eligibleTotal === 0 && items.length > 0) {
      return res.status(400).json({ 
        message: 'Voucher ini tidak berlaku untuk layanan yang Anda pilih.' 
      });
    }

    if (eligibleTotal < voucher.minPurchase) {
      return res.status(400).json({ 
        message: `Minimal pembelian produk yang valid adalah Rp ${voucher.minPurchase.toLocaleString()}` 
      });
    }

    let discount = 0;
    if (voucher.discountType === 'percentage') {
      discount = (eligibleTotal * voucher.discountValue) / 100;
      if (voucher.maxDiscount > 0 && discount > voucher.maxDiscount) {
        discount = voucher.maxDiscount;
      }
    } else {
      discount = voucher.discountValue;
    }
    
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
        eligibleTotal: eligibleTotal,
        imageUrl: voucher.imageUrl // Include image url
      }
    });

  } catch (error) {
    next(error);
  }
}

// ADMIN: List Semua Voucher
async function listAllVouchers(req, res, next) {
  try {
    const { roles = [] } = req.user || {};
    if (!roles.includes('admin')) return res.status(403).json({ message: 'Forbidden' });

    const vouchers = await Voucher.find()
      .populate('applicableServices', 'name')
      .sort({ createdAt: -1 });
      
    res.json({ message: 'All vouchers', data: vouchers });
  } catch (error) {
    next(error);
  }
}

// ADMIN: Create Voucher
async function createVoucher(req, res, next) {
  try {
    const { roles = [] } = req.user || {};
    if (!roles.includes('admin')) return res.status(403).json({ message: 'Forbidden' });

    // Handle Upload Gambar
    let imageUrl = '';
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
    }

    // Karena content-type adalah multipart/form-data, 
    // applicableServices mungkin dikirim sebagai string array atau multiple inputs.
    // Perlu di-parsing jika bentuknya string JSON atau comma-separated.
    let applicableServices = req.body.applicableServices;
    if (typeof applicableServices === 'string') {
        // Coba parse jika string JSON, atau split koma
        try {
            applicableServices = JSON.parse(applicableServices);
        } catch (e) {
            applicableServices = applicableServices.split(',').filter(id => id.trim());
        }
    }

    const voucherData = {
        ...req.body,
        imageUrl: imageUrl, // Simpan path gambar
        applicableServices: applicableServices
    };

    const voucher = new Voucher(voucherData);
    await voucher.save();
    res.status(201).json({ message: 'Voucher created', data: voucher });
  } catch (error) {
    next(error);
  }
}

// ADMIN: Update Voucher
async function updateVoucher(req, res, next) {
  try {
    const { roles = [] } = req.user || {};
    if (!roles.includes('admin')) return res.status(403).json({ message: 'Forbidden' });

    const { id } = req.params;
    const updates = { ...req.body };

    // Handle Upload Gambar Baru
    if (req.file) {
      updates.imageUrl = `/uploads/${req.file.filename}`;
    }

    // Handle parsing array service
    if (typeof updates.applicableServices === 'string') {
        try {
            updates.applicableServices = JSON.parse(updates.applicableServices);
        } catch (e) {
            updates.applicableServices = updates.applicableServices.split(',').filter(id => id.trim());
        }
    }

    const voucher = await Voucher.findByIdAndUpdate(id, updates, { new: true });
    if (!voucher) return res.status(404).json({ message: 'Voucher not found' });

    res.json({ message: 'Voucher updated', data: voucher });
  } catch (error) {
    next(error);
  }
}

// ADMIN: Delete Voucher
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