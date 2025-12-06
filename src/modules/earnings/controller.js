// src/modules/earnings/controller.js
const Earnings = require('./model');
const Provider = require('../providers/model'); // [BARU] Import Provider untuk validasi bank
const mongoose = require('mongoose');

// 1. LIST EARNINGS HISTORY (Provider)
async function listEarnings(req, res, next) {
  try {
    const userId = req.user.userId;
    const { startDate, endDate, status } = req.query;

    const filter = { userId };
    
    // Filter by Status
    if (status) {
        filter.status = status;
    }

    // Filter by Date Range
    if (startDate && endDate) {
        filter.completedAt = {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
        };
    }

    const earnings = await Earnings.find(filter)
      .sort({ completedAt: -1 })
      .lean();

    res.json({
      message: 'Riwayat penghasilan berhasil diambil',
      data: earnings
    });
  } catch (error) {
    next(error);
  }
}

// 2. GET EARNINGS SUMMARY (Provider - FIXED LOGIC)
async function getEarningsSummary(req, res, next) {
  try {
    const userId = req.user.userId;

    const stats = await Earnings.aggregate([
      { 
        $match: { 
          userId: new mongoose.Types.ObjectId(userId),
          status: { $in: ['completed', 'paid_out'] } // [FIX] Ambil yang sudah cair juga
        } 
      },
      {
        $group: {
          _id: null,
          // Total Seumur Hidup (Completed + Paid Out)
          lifetimeEarnings: { $sum: '$earningsAmount' },
          
          // Saldo Aktif (Hanya Completed / Belum Cair)
          currentBalance: {
            $sum: {
              $cond: [{ $eq: ['$status', 'completed'] }, '$earningsAmount', 0]
            }
          },

          // Sudah Dicairkan (Paid Out)
          totalWithdrawn: {
            $sum: {
              $cond: [{ $eq: ['$status', 'paid_out'] }, '$earningsAmount', 0]
            }
          },

          totalPlatformCommission: { $sum: '$platformCommissionAmount' },
          completedOrders: { $sum: 1 }
        }
      }
    ]);

    const result = stats[0] || {
      lifetimeEarnings: 0,
      currentBalance: 0,
      totalWithdrawn: 0,
      totalPlatformCommission: 0,
      completedOrders: 0
    };

    const averageEarningsPerOrder = result.completedOrders > 0 
      ? result.lifetimeEarnings / result.completedOrders 
      : 0;

    res.json({
      message: 'Ringkasan penghasilan berhasil diambil',
      data: {
        ...result,
        averageEarningsPerOrder: Math.round(averageEarningsPerOrder)
      }
    });

  } catch (error) {
    next(error);
  }
}

// 3. ADMIN: Get Platform Financial Stats
async function getPlatformStats(req, res, next) {
  try {
    const { roles = [] } = req.user || {};
    if (!roles.includes('admin')) return res.status(403).json({ message: 'Forbidden' });

    const stats = await Earnings.aggregate([
      { $match: { status: { $in: ['completed', 'paid_out'] } } },
      {
        $group: {
          _id: null,
          totalTransactionValue: { $sum: '$totalAmount' }, // GMV
          totalPlatformRevenue: { $sum: '$platformCommissionAmount' },
          totalAdminFees: { $sum: '$adminFee' },
          totalOrders: { $sum: 1 },
          // Tambahan: Berapa yang belum dibayarkan ke mitra
          pendingPayouts: {
             $sum: {
               $cond: [{ $eq: ['$status', 'completed'] }, '$earningsAmount', 0]
             }
          }
        }
      }
    ]);

    const data = stats[0] || {
      totalTransactionValue: 0,
      totalPlatformRevenue: 0,
      totalAdminFees: 0,
      totalOrders: 0,
      pendingPayouts: 0
    };

    data.netRevenue = data.totalPlatformRevenue + data.totalAdminFees;

    res.json({ message: 'Platform stats retrieved', data });
  } catch (error) {
    next(error);
  }
}

// 4. ADMIN: List All Earnings (Untuk Pencairan)
async function listAllEarnings(req, res, next) {
  try {
    const { roles = [] } = req.user || {};
    if (!roles.includes('admin')) return res.status(403).json({ message: 'Forbidden' });

    const { page = 1, limit = 20, status } = req.query; // status: 'completed' (siap cair), 'paid_out' (sudah)
    const filter = {};
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Populate data Provider & Bank Account
    const earnings = await Earnings.find(filter)
      .populate({
        path: 'providerId',
        select: 'bankAccount userId', // Ambil info bank
        populate: { path: 'userId', select: 'fullName email phoneNumber' }
      })
      .populate('orderId', 'orderNumber') // Tampilkan nomor order
      .sort({ completedAt: 1 }) // Urutkan yang lama dulu (FIFO payout)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Earnings.countDocuments(filter);

    res.json({
      message: 'Data pendapatan mitra berhasil diambil',
      data: earnings,
      meta: {
        page: parseInt(page),
        limit: parseInt(limit),
        total
      }
    });
  } catch (error) {
    next(error);
  }
}

// 5. ADMIN: Process Payout (Tandai Sudah Transfer)
async function processPayout(req, res, next) {
  try {
    const { roles = [] } = req.user || {};
    if (!roles.includes('admin')) return res.status(403).json({ message: 'Forbidden' });

    const { id } = req.params; // ID Earnings

    const earning = await Earnings.findById(id).populate('providerId');
    if (!earning) return res.status(404).json({ message: 'Data pendapatan tidak ditemukan' });

    if (earning.status !== 'completed') {
      return res.status(400).json({ message: 'Hanya status "completed" yang bisa dicairkan.' });
    }

    // [VALIDASI] Cek apakah Mitra punya rekening bank
    const provider = earning.providerId;
    if (!provider || !provider.bankAccount || !provider.bankAccount.accountNumber) {
        return res.status(400).json({ 
            message: 'Gagal mencairkan. Mitra belum mengatur Rekening Bank.' 
        });
    }

    // Update Status
    earning.status = 'paid_out';
    earning.paidOutAt = new Date();
    await earning.save();

    res.json({
      message: 'Status berhasil diubah menjadi Paid Out (Sudah Ditransfer)',
      data: earning
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listEarnings,
  getEarningsSummary,
  getPlatformStats,
  listAllEarnings,
  processPayout
};