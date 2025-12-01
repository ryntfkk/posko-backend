const Voucher = require('./model');

// List voucher yang tersedia untuk user
async function listAvailableVouchers(req, res, next) {
  try {
    const now = new Date();
    
    // Cari voucher yang aktif, kuota masih ada, dan belum expired
    const vouchers = await Voucher.find({
      isActive: true,
      quota: { $gt: 0 },
      expiryDate: { $gt: now }
    }).sort({ createdAt: -1 });

    res.json({ 
      message: 'Available vouchers retrieved', 
      data: vouchers 
    });
  } catch (error) {
    next(error);
  }
}

// Cek validitas voucher saat checkout
async function checkVoucher(req, res, next) {
  try {
    const { code, purchaseAmount } = req.body;
    
    if (!code) {
      return res.status(400).json({ message: 'Voucher code is required' });
    }

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

    const amount = Number(purchaseAmount) || 0;
    if (amount < voucher.minPurchase) {
      return res.status(400).json({ 
        message: `Minimal pembelian untuk voucher ini adalah Rp ${voucher.minPurchase.toLocaleString()}` 
      });
    }

    // Kalkulasi simulasi diskon
    let discount = 0;
    if (voucher.discountType === 'percentage') {
      discount = (amount * voucher.discountValue) / 100;
      if (voucher.maxDiscount > 0 && discount > voucher.maxDiscount) {
        discount = voucher.maxDiscount;
      }
    } else {
      // Fixed amount
      discount = voucher.discountValue;
    }
    
    // Pastikan diskon tidak melebihi harga beli
    if (discount > amount) {
      discount = amount;
    }

    res.json({ 
      message: 'Voucher valid', 
      data: {
        _id: voucher._id,
        code: voucher.code,
        discountType: voucher.discountType,
        discountValue: voucher.discountValue,
        estimatedDiscount: Math.floor(discount) // Bulatkan ke bawah
      }
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { listAvailableVouchers, checkVoucher };