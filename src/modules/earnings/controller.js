const Earnings = require('./model');
const mongoose = require('mongoose');

// 1. LIST EARNINGS HISTORY
async function listEarnings(req, res, next) {
  try {
    const userId = req.user.userId;

    // Ambil data earnings berdasarkan userId provider yang sedang login
    // Urutkan dari yang terbaru (completedAt desc)
    const earnings = await Earnings.find({ userId })
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

// 2. GET EARNINGS SUMMARY
async function getEarningsSummary(req, res, next) {
  try {
    const userId = req.user.userId;

    // Gunakan Aggregation untuk menghitung total statistik
    const stats = await Earnings.aggregate([
      { 
        $match: { 
          userId: new mongoose.Types.ObjectId(userId),
          status: 'completed' 
        } 
      },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: '$earningsAmount' },
          platformCommission: { $sum: '$platformCommissionAmount' },
          completedOrders: { $sum: 1 }
        }
      }
    ]);

    const result = stats[0] || {
      totalEarnings: 0,
      platformCommission: 0,
      completedOrders: 0
    };

    // Hitung rata-rata
    const averageEarningsPerOrder = result.completedOrders > 0 
      ? result.totalEarnings / result.completedOrders 
      : 0;

    res.json({
      message: 'Ringkasan penghasilan berhasil diambil',
      data: {
        ...result,
        averageEarningsPerOrder
      }
    });

  } catch (error) {
    next(error);
  }
}
// [BARU] ADMIN: Get Platform Financial Stats
async function getPlatformStats(req, res, next) {
  try {
    const { roles = [] } = req.user || {};
    if (!roles.includes('admin')) return res.status(403).json({ message: 'Forbidden' });

    // Aggregation untuk menghitung total
    const stats = await Earnings.aggregate([
      { $match: { status: 'completed' } }, // Hanya yang sudah selesai
      {
        $group: {
          _id: null,
          totalTransactionValue: { $sum: '$totalAmount' }, // Gekross Transaction Volume
          totalPlatformRevenue: { $sum: '$platformCommissionAmount' }, // Pendapatan Kita
          totalAdminFees: { $sum: '$adminFee' }, // Biaya Admin
          totalOrders: { $sum: 1 }
        }
      }
    ]);

    const data = stats[0] || {
      totalTransactionValue: 0,
      totalPlatformRevenue: 0,
      totalAdminFees: 0,
      totalOrders: 0
    };

    // Total Pendapatan Bersih Platform = Komisi % + Biaya Admin flat
    data.netRevenue = data.totalPlatformRevenue + data.totalAdminFees;

    res.json({ message: 'Platform stats retrieved', data });
  } catch (error) {
    next(error);
  }
}
module.exports = {
  listEarnings,
  getEarningsSummary,
  getPlatformStats
};