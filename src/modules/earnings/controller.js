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

module.exports = {
  listEarnings,
  getEarningsSummary
};