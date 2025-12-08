// src/modules/earnings/controller.js
const Earnings = require('./model');
const PayoutRequest = require('./payoutRequestModel'); // [BARU]
const Provider = require('../providers/model'); 
const User = require('../../models/User'); // [BARU] Perlu User model untuk cek/potong saldo
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
          status: { $in: ['completed', 'paid_out'] } 
        } 
      },
      {
        $group: {
          _id: null,
          // Total Seumur Hidup (Completed + Paid Out)
          lifetimeEarnings: { $sum: '$earningsAmount' },
          
          // Saldo Aktif (Hanya Completed / Belum Cair)
          // [REVISI LOGIKA] Saldo aktif sebaiknya diambil dari User.balance (single source of truth)
          // Tapi untuk statistik earning, kita hitung yang statusnya 'completed' (belum paid_out)
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

    // [BARU] Ambil saldo aktual dari User Model untuk akurasi
    const userDoc = await User.findById(userId).select('balance');
    const realBalance = userDoc ? userDoc.balance : 0;

    const averageEarningsPerOrder = result.completedOrders > 0 
      ? result.lifetimeEarnings / result.completedOrders 
      : 0;

    res.json({
      message: 'Ringkasan penghasilan berhasil diambil',
      data: {
        ...result,
        currentBalance: realBalance, // Override dengan saldo real
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

// [BARU] 6. PROVIDER: Request Payout
async function requestPayout(req, res, next) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user.userId;
    const { amount } = req.body;

    // 1. Cek Data Provider & Bank
    const provider = await Provider.findOne({ userId }).session(session);
    if (!provider) {
        throw new Error('Data mitra tidak ditemukan');
    }

    if (!provider.bankAccount || !provider.bankAccount.accountNumber || !provider.bankAccount.bankName) {
        throw new Error('Mohon lengkapi data Rekening Bank di menu Pengaturan Akun sebelum mencairkan dana.');
    }

    // 2. Cek Pending Request Lain (Dipindahkan ke atas untuk efisiensi)
    const existingPending = await PayoutRequest.findOne({ 
        userId, 
        status: 'pending' 
    }).session(session);

    if (existingPending) {
        throw new Error('Anda masih memiliki permintaan pencairan yang sedang diproses.');
    }

    // 3. ATOMIC UPDATE & DEDUCTION (Perbaikan Utama)
    // Menggunakan findOneAndUpdate dengan kondisi balance >= amount
    // Jika saldo cukup, kurangi (-amount). Jika tidak, kembalikan null.
    // Ini atomic operation, aman dari race condition.
    const updatedUser = await User.findOneAndUpdate(
        { 
          _id: userId, 
          balance: { $gte: amount } // Guard clause di level query DB
        },
        { $inc: { balance: -amount } },
        { new: true, session: session }
    );

    if (!updatedUser) {
        // Cek manual untuk memberi pesan error yang jelas (Saldo kurang atau User hilang)
        const userCheck = await User.findById(userId).session(session);
        if (!userCheck) throw new Error('User tidak ditemukan');
        throw new Error(`Saldo tidak mencukupi. Saldo saat ini: Rp ${userCheck.balance.toLocaleString()}`);
    }

    // 4. Buat Record Request
    const payoutRequest = new PayoutRequest({
        providerId: provider._id,
        userId: userId,
        amount: amount,
        bankSnapshot: {
            bankName: provider.bankAccount.bankName,
            accountNumber: provider.bankAccount.accountNumber,
            accountHolderName: provider.bankAccount.accountHolderName || updatedUser.fullName
        },
        status: 'pending'
    });
    
    await payoutRequest.save({ session });

    await session.commitTransaction();
    
    res.status(201).json({
        message: 'Permintaan pencairan berhasil dikirim. Admin akan memproses transfer.',
        data: payoutRequest,
        remainingBalance: updatedUser.balance
    });

  } catch (error) {
    await session.abortTransaction();
    if (error.message.includes('Saldo') || error.message.includes('Bank') || error.message.includes('pending')) {
        return res.status(400).json({ message: error.message });
    }
    next(error);
  } finally {
    session.endSession();
  }
}

// [BARU] 7. PROVIDER: List Payout History
async function listPayoutHistory(req, res, next) {
    try {
        const userId = req.user.userId;
        const history = await PayoutRequest.find({ userId })
            .sort({ createdAt: -1 })
            .lean();

        res.json({
            message: 'Riwayat pencairan berhasil diambil',
            data: history
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
  processPayout,
  requestPayout, // Export baru
  listPayoutHistory // Export baru
};