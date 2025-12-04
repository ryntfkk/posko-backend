const Earnings = require('./model');
const mongoose = require('mongoose');

// 1. LIST EARNINGS HISTORY (Provider)
async function listEarnings(req, res, next) {
  try {
    const userId = req.user.userId;

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

// 2. GET EARNINGS SUMMARY (Provider)
async function getEarningsSummary(req, res, next) {
  try {
    const userId = req.user.userId;

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

// 3. ADMIN: Get Platform Financial Stats
async function getPlatformStats(req, res, next) {
  try {
    const { roles = [] } = req.user || {};
    if (!roles.includes('admin')) return res.status(403).json({ message: 'Forbidden' });

    const stats = await Earnings.aggregate([
      { $match: { status: 'completed' } },
      {
        $group: {
          _id: null,
          totalTransactionValue: { $sum: '$totalAmount' },
          totalPlatformRevenue: { $sum: '$platformCommissionAmount' },
          totalAdminFees: { $sum: '$adminFee' },
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

    data.netRevenue = data.totalPlatformRevenue + data.totalAdminFees;

    res.json({ message: 'Platform stats retrieved', data });
  } catch (error) {
    next(error);
  }
}

// [BARU] ADMIN: List All Earnings (Untuk Pencairan)
async function listAllEarnings(req, res, next) {
  try {
    const { roles = [] } = req.user || {};
    if (!roles.includes('admin')) return res.status(403).json({ message: 'Forbidden' });

    const { page = 1, limit = 20, status } = req.query; // status: 'completed' (siap cair), 'paid_out' (sudah)
    const filter = {};
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const earnings = await Earnings.find(filter)
      .populate({
        path: 'providerId',
        select: 'bankAccount userId',
        populate: { path: 'userId', select: 'fullName email' }
      })
      .sort({ completedAt: -1 })
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

// [BARU] ADMIN: Process Payout (Tandai Sudah Transfer)
async function processPayout(req, res, next) {
  try {
    const { roles = [] } = req.user || {};
    if (!roles.includes('admin')) return res.status(403).json({ message: 'Forbidden' });

    const { id } = req.params; // ID Earnings

    const earning = await Earnings.findById(id);
    if (!earning) return res.status(404).json({ message: 'Data tidak ditemukan' });

    if (earning.status !== 'completed') {
      return res.status(400).json({ message: 'Hanya status "completed" yang bisa dicairkan.' });
    }

    earning.status = 'paid_out';
    earning.paidOutAt = new Date();
    await earning.save();

    res.json({
      message: 'Status berhasil diubah menjadi Paid Out',
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