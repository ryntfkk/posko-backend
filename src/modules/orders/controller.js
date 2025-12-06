// src/modules/orders/controller.js
const mongoose = require('mongoose');
const Order = require('./model');
const Provider = require('../providers/model');
const Service = require('../services/model');
const Settings = require('../settings/model');
const Voucher = require('../vouchers/model');
const UserVoucher = require('../vouchers/userVoucherModel');
const User = require('../../models/User');
const Earnings = require('../earnings/model');
const env = require('../../config/env');
const { getIO } = require('../chat/socket'); 

// [CONFIG] Default Timezone Configuration
const DEFAULT_TIMEZONE = 'Asia/Jakarta';
const DEFAULT_OFFSET = '+07:00'; 
const BROADCAST_RADIUS_KM = 15; // Radius broadcast default (15 KM)

// Helper: Konversi Date ke Date Components berdasarkan Timezone
function getLocalDateComponents(dateInput, timeZone = DEFAULT_TIMEZONE) {
  if (!dateInput) return null;
  
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return null;
  
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    
    const parts = formatter.formatToParts(date);
    const getPart = (type) => parts.find(p => p.type === type)?.value || '';
    
    return {
      dateOnly: `${getPart('year')}-${getPart('month')}-${getPart('day')}`,
      timeStr: `${getPart('hour')}:${getPart('minute')}`,
      fullDate: date 
    };
  } catch (error) {
    console.error(`Invalid Timezone: ${timeZone}`, error);
    return null;
  }
}

// Helper: Cek apakah provider punya order yang sedang berjalan
async function getProviderActiveOrderCount(providerId) {
  const activeStatuses = ['accepted', 'on_the_way', 'working'];
  const count = await Order.countDocuments({
    providerId: providerId,
    status: { $in: activeStatuses }
  });
  return count;
}

// [BARU] HELPER BROADCAST GEO-SPASIAL
async function broadcastBasicOrderToNearbyProviders(order) {
  try {
    const io = getIO();
    if (!io) return;

    // Pastikan order punya lokasi valid
    if (!order.location || !order.location.coordinates || order.location.coordinates.length !== 2) {
        console.warn(`[BROADCAST] Order ${order._id} tidak memiliki lokasi valid.`);
        return;
    }

    const [longitude, latitude] = order.location.coordinates;
    const requiredServiceIds = order.items.map(item => item.serviceId);

    // Cari Provider yang:
    // 1. Lokasinya dalam radius X km
    // 2. Memiliki salah satu layanan yang diminta (dan aktif)
    // 3. Status provider 'isAvailable' (Online)
    // 4. [FIX] Status verifikasi 'verified' (Wajib)
    // 5. Akun User-nya aktif
    const nearbyProviders = await Provider.find({
      location: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [longitude, latitude]
          },
          $maxDistance: BROADCAST_RADIUS_KM * 1000 // Convert km to meters
        }
      },
      isAvailable: true, // Provider sedang "Online" switch-nya
      verificationStatus: 'verified', // [FIX] Hanya Mitra Terverifikasi
      'services': {
        $elemMatch: {
          serviceId: { $in: requiredServiceIds },
          isActive: true
        }
      }
    }).populate('userId', 'fullName fcmToken'); // Populate userId untuk dapatkan socket room ID / FCM Token

    console.log(`[BROADCAST] Found ${nearbyProviders.length} verified providers near order ${order._id}`);

    // Emit ke setiap provider yang memenuhi syarat
    // Asumsi: Room socket provider menggunakan User ID mereka
    let broadcastCount = 0;
    
    for (const provider of nearbyProviders) {
      if (provider.userId) {
        // Cek double check: Apakah provider ini sedang sibuk? (Opsional, bisa di-skip jika ingin agresif)
        // const activeJobs = await getProviderActiveOrderCount(provider._id);
        // if (activeJobs > 0) continue; 

        io.to(provider.userId._id.toString()).emit('order_new', {
          message: 'Ada pesanan baru di sekitar Anda!',
          order: {
            ...order.toObject(),
            distance: 'Dekat lokasi Anda' // Bisa hitung real distance jika perlu
          }
        });
        broadcastCount++;
      }
    }
    
    console.log(`[BROADCAST] Successfully emitted to ${broadcastCount} providers.`);

  } catch (error) {
    console.error('[BROADCAST ERROR]', error);
  }
}

// Helper: Centralized Earnings Logic (TRANSACTION & IDEMPOTENCY FIX)
async function calculateAndProcessEarnings(orderId) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Fetch Order terbaru di dalam session untuk memastikan data atomic
    const order = await Order.findById(orderId).session(session);
    
    if (!order) {
        throw new Error('Pesanan tidak ditemukan saat memproses earnings.');
    }

    // 2. [IDEMPOTENCY CHECK] Cek apakah earnings sudah pernah diproses
    if (order.isEarningsProcessed) {
        console.warn(`[EARNINGS] Order ${order._id} already processed. Skipping.`);
        await session.abortTransaction();
        return {
           alreadyProcessed: true,
           message: 'Earnings already processed for this order.'
        };
    }

    let platformCommissionPercent;
    
    if (order.appliedCommissionPercent != null) {
      platformCommissionPercent = order.appliedCommissionPercent;
    } else {
      const settings = await Settings.findOne({ key: 'global_config' }).session(session);
      platformCommissionPercent = settings ? settings.platformCommissionPercent : 12;
    }
    
    const totalAdditionalFees = order.additionalFees
      ? order.additionalFees
          .filter(fee => fee.status === 'paid')
          .reduce((sum, fee) => sum + fee.amount, 0)
      : 0;

    const serviceRevenue = (order.totalAmount + totalAdditionalFees) - order.adminFee;
    const platformCommissionAmount = (serviceRevenue * platformCommissionPercent) / 100;
    const earningsAmount = serviceRevenue - platformCommissionAmount;

    const providerDoc = await Provider.findById(order.providerId).session(session);
    if (!providerDoc) {
      throw new Error('Data mitra (provider) tidak ditemukan saat memproses earnings.');
    }

    // 3. Update Saldo Mitra
    const providerUser = await User.findByIdAndUpdate(
      providerDoc.userId, 
      { $inc: { balance: earningsAmount } },
      { new: true, session: session }
    );

    if (!providerUser) {
      throw new Error('Data user mitra tidak ditemukan.');
    }

    // 4. Buat Record Earnings
    const earningsRecord = new Earnings({
      providerId: providerDoc._id,
      userId: providerDoc.userId,
      orderId: order._id,
      totalAmount: order.totalAmount,
      additionalFeeAmount: totalAdditionalFees,
      adminFee: order.adminFee,
      platformCommissionPercent: platformCommissionPercent,
      platformCommissionAmount: Math.round(platformCommissionAmount),
      earningsAmount: Math.round(earningsAmount),
      status: 'completed',
      completedAt: new Date()
    });

    await earningsRecord.save({ session });

    // 5. Update Status Order & Lock Earnings
    order.status = 'completed';
    order.waitingApprovalAt = null;
    order.isEarningsProcessed = true; // Lock agar tidak bisa diproses ulang
    await order.save({ session });

    await session.commitTransaction();

    return {
      success: true,
      earnings: {
        totalAmount: order.totalAmount,
        earningsAmount: Math.round(earningsAmount)
      },
      providerBalance: providerUser.balance
    };

  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

// 1. LIST ALL ORDERS
async function listOrders(req, res, next) {
  try {
    const { roles = [], userId } = req.user || {};
    const { view } = req.query; 
    
    let filter = { userId }; 

    if (view === 'provider' && roles.includes('provider')) {
      const provider = await Provider.findOne({ userId }).lean();
      if (provider) {
        filter = { providerId: provider._id };
      } else {
        return res.json({ messageKey: 'orders.list', data: [] });
      }
    } 
    
    if (roles.includes('admin') && !view) {
      filter = {}; 
    }

    const orders = await Order.find(filter)
      .populate('items.serviceId', 'name category iconUrl')
      .populate('userId', 'fullName phoneNumber')
      .populate('voucherId', 'code discountType discountValue')
      .populate({
        path: 'providerId',
        select: 'userId rating',
        populate: { path: 'userId', select: 'fullName profilePictureUrl' }
      })
      .sort({ createdAt: -1 })
      .lean();

    const messageKey = 'orders.list';
    res.json({ messageKey, message: req.t ? req.t(messageKey) : 'List Orders', data: orders });
  } catch (error) {
    next(error);
  }
}

// 2. CREATE ORDER (UPDATED WITH BROADCAST)
async function createOrder(req, res, next) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user?.userId;
    if (!userId) {
      await session.abortTransaction();
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { 
      providerId, 
      items = [], 
      orderType, 
      scheduledAt,
      shippingAddress,
      location,
      customerContact,
      orderNote,
      propertyDetails,
      scheduledTimeSlot,
      attachments,
      voucherCode 
    } = req.body;

    if (items.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Items tidak boleh kosong' });
    }

    let providerData = null;
    let providerSnapshot = {};
    let providerUserId = null; 

    if (orderType === 'direct') {
      if (!providerId) {
        await session.abortTransaction();
        return res.status(400).json({ message: 'Provider ID wajib untuk Direct Order' });
      }

      providerData = await Provider.findById(providerId)
        .populate('userId', 'fullName profilePictureUrl phoneNumber')
        .session(session)
        .lean();

      if (!providerData) {
        await session.abortTransaction();
        return res.status(404).json({ message: 'Mitra tidak ditemukan atau tidak aktif.' });
      }

      // [FIX] Validasi Verifikasi Mitra untuk Order Langsung
      if (providerData.verificationStatus !== 'verified') {
        await session.abortTransaction();
        return res.status(400).json({ message: 'Mitra ini belum terverifikasi dan belum dapat menerima pesanan.' });
      }

      if (providerData.userId) {
        providerUserId = providerData.userId._id;
        providerSnapshot = {
          fullName: providerData.userId.fullName,
          profilePictureUrl: providerData.userId.profilePictureUrl,
          phoneNumber: providerData.userId.phoneNumber,
          rating: providerData.rating || 0
        };
      }
    }

    const serviceIds = items.map(item => item.serviceId).filter(Boolean);
    const foundServices = await Service.find({ _id: { $in: serviceIds } }).session(session);
    
    const serviceMap = new Map(foundServices.map(s => [s._id.toString(), s]));

    let servicesSubtotal = 0;
    const validatedItems = [];

    for (const item of items) {
      if (!item.serviceId) continue;

      const serviceDoc = serviceMap.get(item.serviceId.toString());
      if (!serviceDoc) {
        await session.abortTransaction();
        return res.status(400).json({ message: `Service ID ${item.serviceId} tidak ditemukan.` });
      }

      const quantity = parseInt(item.quantity) || 1;
      let realPrice;

      if (orderType === 'direct' && providerData) {
        const providerService = providerData.services.find(
          ps => ps.serviceId && ps.serviceId.toString() === item.serviceId.toString()
        );

        if (!providerService || !providerService.isActive) {
          await session.abortTransaction();
          return res.status(400).json({ 
            message: `Mitra ini tidak menyediakan layanan "${serviceDoc.name}" atau layanan sedang tidak aktif.` 
          });
        }

        realPrice = providerService.price;
      } else {
        realPrice = serviceDoc.price || serviceDoc.basePrice;
      }

      const subTotal = realPrice * quantity;
      servicesSubtotal += subTotal;

      validatedItems.push({
        serviceId: serviceDoc._id,
        name: serviceDoc.name, 
        price: realPrice,
        quantity: quantity,
        note: item.note || ''
      });
    }
    
    const settings = await Settings.findOne({ key: 'global_config' }).session(session);
    const adminFee = settings ? settings.adminFee : 2500;
    const platformCommissionPercent = settings ? settings.platformCommissionPercent : 12;

    let discountAmount = 0;
    let voucherId = null;
    let lockedUserVoucher = null; 

    if (voucherCode) {
      const masterVoucher = await Voucher.findOne({ 
        code: voucherCode.toUpperCase() 
      }).session(session);

      if (!masterVoucher) {
        await session.abortTransaction();
        return res.status(404).json({ message: 'Kode voucher tidak valid.' });
      }

      const userVoucher = await UserVoucher.findOne({ 
        userId,
        voucherId: masterVoucher._id,
        status: 'active'
      }).populate('voucherId').session(session);

      if (!userVoucher) {
        await session.abortTransaction();
        return res.status(404).json({ message: 'Voucher tidak valid atau belum diklaim.' });
      }

      const voucher = userVoucher.voucherId;
      const now = new Date();
      if (!voucher.isActive || new Date(voucher.expiryDate) < now) {
        await session.abortTransaction();
        return res.status(400).json({ message: 'Voucher sudah kadaluarsa' });
      }

      let eligibleForDiscountTotal = 0;
      const applicableServiceIds = voucher.applicableServices.map(id => id.toString());
      const isGlobalVoucher = applicableServiceIds.length === 0;

      validatedItems.forEach(item => {
        const itemTotal = item.price * item.quantity;
        if (isGlobalVoucher) {
          eligibleForDiscountTotal += itemTotal;
        } else {
          if (applicableServiceIds.includes(item.serviceId.toString())) {
            eligibleForDiscountTotal += itemTotal;
          }
        }
      });

      if (eligibleForDiscountTotal === 0) {
        await session.abortTransaction();
        return res.status(400).json({ 
          message: 'Voucher ini tidak berlaku untuk layanan yang Anda pilih.' 
        });
      }

      if (eligibleForDiscountTotal < voucher.minPurchase) {
        await session.abortTransaction();
        return res.status(400).json({ 
          message: `Minimal pembelian layanan yang valid untuk voucher ini adalah Rp ${voucher.minPurchase.toLocaleString()}` 
        });
      }

      if (voucher.discountType === 'percentage') {
        discountAmount = (eligibleForDiscountTotal * voucher.discountValue) / 100;
        if (voucher.maxDiscount > 0 && discountAmount > voucher.maxDiscount) {
          discountAmount = voucher.maxDiscount;
        }
      } else {
        discountAmount = voucher.discountValue;
      }

      if (discountAmount > eligibleForDiscountTotal) {
        discountAmount = eligibleForDiscountTotal;
      }

      voucherId = voucher._id;

      lockedUserVoucher = await UserVoucher.findOneAndUpdate(
        { 
          _id: userVoucher._id, 
          status: 'active' 
        },
        { 
          status: 'used',
          usageDate: new Date()
        },
        { new: true, session: session }
      );

      if (!lockedUserVoucher) {
        await session.abortTransaction();
        return res.status(400).json({ message: 'Voucher gagal digunakan atau sudah terpakai.' });
      }
    }

    const finalTotalAmount = servicesSubtotal + adminFee - discountAmount;

    if (orderType === 'direct' && providerData) {
      const targetTimeZone = providerData.timeZone || DEFAULT_TIMEZONE;
      const targetOffset = providerData.timeZoneOffset || DEFAULT_OFFSET;

      const scheduled = getLocalDateComponents(scheduledAt, targetTimeZone);
      if (!scheduled) {
        await session.abortTransaction();
        return res.status(400).json({ message: 'Format tanggal kunjungan tidak valid.' });
      }

      const now = new Date();
      const oneHourBefore = new Date(now.getTime() - 60 * 60 * 1000);
      if (scheduled.fullDate < oneHourBefore) {
         await session.abortTransaction();
         return res.status(400).json({ message: 'Tanggal kunjungan tidak boleh di masa lalu.' });
      }

      if (providerData.blockedDates && providerData.blockedDates.length > 0) {
        const isBlocked = providerData.blockedDates.some(blockedDate => {
          const blocked = getLocalDateComponents(blockedDate, targetTimeZone);
          return blocked && blocked.dateOnly === scheduled.dateOnly;
        });
        
        if (isBlocked) {
          await session.abortTransaction();
          return res.status(400).json({
            message: 'Tanggal kunjungan ini diblokir manual oleh Mitra (Libur). Pilih tanggal lain.'
          });
        }
      }

      const dateStart = new Date(`${scheduled.dateOnly}T00:00:00.000${targetOffset}`);
      const dateEnd = new Date(`${scheduled.dateOnly}T23:59:59.999${targetOffset}`);

      const existingOrder = await Order.findOne({
        providerId: providerId,
        status: { $in: ['paid', 'accepted', 'on_the_way', 'working', 'waiting_approval'] }, 
        scheduledAt: {
          $gte: dateStart,
          $lte: dateEnd
        }
      }).session(session);

      if (existingOrder) {
        await session.abortTransaction();
        return res.status(400).json({
          message: 'Mitra sudah penuh/memiliki jadwal lain pada tanggal tersebut. Silakan pilih tanggal lain.'
        });
      }
    }

    const order = new Order({ 
      userId, 
      providerId: orderType === 'direct' ? providerId : null,
      providerSnapshot,
      items: validatedItems,          
      
      totalAmount: Math.floor(finalTotalAmount),
      adminFee: adminFee,
      appliedCommissionPercent: platformCommissionPercent,
      
      discountAmount: Math.floor(discountAmount),
      voucherId: voucherId,

      orderType, 
      scheduledAt,
      shippingAddress,
      location,
      customerContact,
      orderNote: orderNote || '',
      propertyDetails: propertyDetails || {},
      scheduledTimeSlot: scheduledTimeSlot || {},
      attachments: attachments || []
    });
    
    await order.save({ session });
    
    if (lockedUserVoucher) {
      await UserVoucher.findByIdAndUpdate(
        lockedUserVoucher._id, 
        { orderId: order._id }, 
        { session }
      );
    }

    await session.commitTransaction();

    // --- SOCKET NOTIFICATION LOGIC ---
    const io = getIO();
    
    // Skenario 1: Direct Order -> Notify specific provider
    if (io && orderType === 'direct' && providerUserId) {
        io.to(providerUserId.toString()).emit('order_new', {
            message: 'Anda menerima pesanan baru!',
            order: order.toObject()
        });
    }

    // Skenario 2: Basic Order -> Broadcast to nearby providers
    // [PERBAIKAN] Panggil fungsi broadcast yang baru
    if (orderType === 'basic') {
        // Jangan await agar response ke user cepat (Fire & Forget)
        broadcastBasicOrderToNearbyProviders(order);
    }

    res.status(201).json({ 
      message: 'Pesanan berhasil dibuat', 
      data: {
        ...order.toObject(),
        orderNumber: order.orderNumber
      }
    });

  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
}

// 3. GET ORDER BY ID
async function getOrderById(req, res, next) {
  try {
    const { orderId } = req.params;
    
    const order = await Order.findById(orderId)
      .populate('items.serviceId', 'name iconUrl')
      .populate('voucherId', 'code description')
      .populate({
        path: 'providerId',
        select: 'userId rating',
        populate: { path: 'userId', select: 'fullName phoneNumber profilePictureUrl' }
      })
      .populate('userId', 'fullName phoneNumber profilePictureUrl')
      .lean();

    if (!order) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
    }
    res.json({ message: 'Detail pesanan ditemukan', data: order });
  } catch (error) {
    next(error);
  }
}

// 4. LIST INCOMING ORDERS (REVISED)
async function listIncomingOrders(req, res, next) {
  try {
    const userId = req.user.userId;
    
    const provider = await Provider.findOne({ userId }).lean();
    if (!provider) {
      return res.status(403).json({ message: 'Anda belum terdaftar sebagai Mitra.' });
    }

    // [FIX] Cek Status Verifikasi Mitra
    if (provider.verificationStatus !== 'verified') {
        return res.json({ 
            message: 'Akun Anda belum terverifikasi. Mohon tunggu verifikasi admin untuk menerima pesanan.',
            providerStatus: {
                verificationStatus: provider.verificationStatus,
                isBusy: false
            },
            data: [] // Return array kosong, jangan error
        });
    }

    const myServiceIds = provider.services
      .filter(s => s.isActive)
      .map(s => s.serviceId.toString());
    
    const activeOrderCount = await getProviderActiveOrderCount(provider._id);
    
    // QUERY 1: Cari Direct Order atau Order yang sudah dibayar khusus untuk Provider ini
    const directOrdersPromise = Order.find({
        providerId: provider._id,
        status: 'paid'
    })
    .populate('userId', 'fullName profilePictureUrl phoneNumber')
    .populate('items.serviceId', 'name category iconUrl')
    .lean();

    // QUERY 2: Cari Basic Order di sekitar (Marketplace)
    // Hanya dijalankan jika provider sedang TIDAK sibuk (activeOrderCount == 0)
    let basicOrdersPromise = Promise.resolve([]);
    
    if (activeOrderCount === 0) {
        let basicQuery = {
            orderType: 'basic', 
            status: 'searching',
            providerId: null, 
            'items.serviceId': { $in: myServiceIds }
        };

        // Tambahkan filter lokasi ($near) di top-level query (VALID)
        if (provider.location && provider.location.coordinates && provider.location.coordinates.length === 2) {
            basicQuery.location = {
                $near: {
                    $geometry: {
                        type: "Point",
                        coordinates: provider.location.coordinates
                    },
                    $maxDistance: BROADCAST_RADIUS_KM * 1000 // 15 KM
                }
            };
        }
        
        basicOrdersPromise = Order.find(basicQuery)
            .populate('userId', 'fullName profilePictureUrl phoneNumber')
            .populate('items.serviceId', 'name category iconUrl')
            .limit(20) // Limit hasil agar performa terjaga
            .lean();
    }

    // Jalankan kedua query secara paralel
    const [directOrders, basicOrders] = await Promise.all([directOrdersPromise, basicOrdersPromise]);

    // Gabungkan hasil dan urutkan berdasarkan waktu kunjungan (scheduledAt)
    const combinedOrders = [...directOrders, ...basicOrders].sort((a, b) => {
        return new Date(a.scheduledAt) - new Date(b.scheduledAt);
    });

    res.json({ 
      message: 'Daftar order masuk berhasil diambil',
      providerStatus: {
        activeOrderCount: activeOrderCount,
        isBusy: activeOrderCount > 0,
        verificationStatus: provider.verificationStatus
      },
      data: combinedOrders 
    });
  } catch (error) {
    console.error('[Incoming Orders Error]', error);
    next(error);
  }
}

// 5. ACCEPT ORDER
async function acceptOrder(req, res, next) {
  try {
    const { orderId } = req.params;
    const userId = req.user.userId;

    const provider = await Provider.findOne({ userId }).lean();
    if (!provider) {
      return res.status(403).json({ message: 'Akses ditolak.' });
    }

    // [FIX] Validasi Verifikasi saat menerima order
    if (provider.verificationStatus !== 'verified') {
        return res.status(403).json({ message: 'Akun Anda belum terverifikasi.' });
    }

    const orderCheck = await Order.findById(orderId).lean();
    if (!orderCheck) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan.' });
    }

    if (orderCheck.orderType === 'basic') {
      const activeOrderCount = await getProviderActiveOrderCount(provider._id);
      if (activeOrderCount > 0) {
        return res.status(400).json({ 
          message: `Anda masih memiliki ${activeOrderCount} pesanan yang sedang dikerjakan. Selesaikan pesanan tersebut terlebih dahulu sebelum menerima pesanan baru.`,
          activeOrderCount: activeOrderCount
        });
      }
    }
    
    let queryCondition = { _id: orderId };
    
    if (orderCheck.orderType === 'basic') {
        queryCondition.status = 'searching';
        queryCondition.providerId = null;
    } else if (orderCheck.orderType === 'direct') {
        queryCondition.status = 'paid';
        queryCondition.providerId = provider._id;
    } else {
        return res.status(400).json({ message: 'Tipe order tidak valid.' });
    }

    const updatedOrder = await Order.findOneAndUpdate(
        queryCondition,
        { 
            $set: { 
                status: 'accepted',
                providerId: provider._id 
            } 
        },
        { new: true } 
    ).populate('userId', 'fullName');

    if (!updatedOrder) {
        return res.status(409).json({ 
            message: 'Gagal menerima pesanan. Pesanan mungkin sudah diambil mitra lain atau status telah berubah.' 
        });
    }

    const io = getIO();
    if (io) {
        io.to(updatedOrder.userId._id.toString()).emit('order_status_update', {
            orderId: updatedOrder._id,
            status: 'accepted',
            message: 'Mitra telah menerima pesanan Anda!',
            order: updatedOrder
        });
    }

    res.json({ message: 'Pesanan berhasil diterima! Segera hubungi pelanggan.', data: updatedOrder });
  } catch (error) {
    next(error);
  }
}

// 6. UPDATE ORDER STATUS
async function updateOrderStatus(req, res, next) {
  try {
    const { orderId } = req.params;
    const { status } = req.body; 
    const userId = req.user.userId;

    // Gunakan findById biasa dulu untuk pengecekan awal
    const order = await Order.findById(orderId).populate('userId').populate({ path: 'providerId', populate: { path: 'userId' } });
    if (!order) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
    }

    const isCustomer = order.userId._id.toString() === userId;
    const isProvider = order.providerId && order.providerId.userId._id.toString() === userId;

    if (!isCustomer && !isProvider) {
      return res.status(403).json({ message: 'Anda tidak memiliki akses ke pesanan ini' });
    }

    if (status === 'waiting_approval' && isProvider) {
      if (order.status !== 'working') {
        return res.status(400).json({ 
          message: 'Hanya pesanan yang sedang dikerjakan yang bisa diselesaikan.' 
        });
      }
      
      if (!order.completionEvidence || order.completionEvidence.length === 0) {
        return res.status(400).json({ 
          message: 'Wajib mengunggah minimal 1 foto dokumentasi pekerjaan selesai sebelum mengubah status.' 
        });
      }

      order.status = 'waiting_approval';
      order.waitingApprovalAt = new Date();
      await order.save();
      
      const io = getIO();
      if(io) {
          io.to(order.userId._id.toString()).emit('order_status_update', {
              orderId: order._id,
              status: 'waiting_approval',
              message: 'Pekerjaan selesai! Mohon konfirmasi pesanan.',
              order
          });
      }

      return res.json({ 
        message: 'Pekerjaan ditandai selesai. Menunggu konfirmasi pelanggan.', 
        data: order 
      });
    }

    if (status === 'completed' && isCustomer) {
      if (order.status !== 'waiting_approval') {
        return res.status(400).json({ 
          message: 'Belum ada permintaan penyelesaian dari mitra.' 
        });
      }

      try {
        // [UPDATE] Panggil helper atomic earnings
        const result = await calculateAndProcessEarnings(order._id);
        
        // Fetch order ulang untuk mendapatkan status terbaru (terutama isEarningsProcessed)
        const updatedOrder = await Order.findById(order._id);

        const io = getIO();
        if(io && updatedOrder.providerId) {
            // Karena order sudah disimpan di helper, kita perlu ambil data user mitra lagi jika ingin emit socket
            // Namun di helper kita populate providerDoc, tapi di sini 'order' awal masih valid untuk ID
            // Safe bet: ambil user ID mitra dari object 'order' awal
            const providerUserId = order.providerId.userId._id.toString();
            
            io.to(providerUserId).emit('order_status_update', {
                orderId: updatedOrder._id,
                status: 'completed',
                message: 'Pesanan selesai! Dana telah diteruskan ke saldo Anda.',
                order: updatedOrder
            });
        }

        return res.json({ 
          message: 'Pesanan selesai! Terima kasih.', 
          data: {
            order: updatedOrder,
            ...result
          }
        });

      } catch (earningsError) {
        console.error('❌ Error calculating earnings:', earningsError);
        return res.status(500).json({ 
          message: 'Gagal menyelesaikan pesanan. Silakan coba lagi.', 
          error: earningsError.message 
        });
      }
    }

    if (['on_the_way', 'working'].includes(status)) {
      if (!isProvider) {
        return res.status(403).json({ 
          message: 'Hanya mitra yang bisa update status ini.' 
        });
      }
      
      const statusFlow = {
        'on_the_way': ['accepted'],
        'working': ['on_the_way']
      };
      
      if (!statusFlow[status].includes(order.status)) {
        return res.status(400).json({ 
          message: `Tidak bisa mengubah status dari "${order.status}" ke "${status}".` 
        });
      }
      
      order.status = status;
      await order.save();

      const io = getIO();
      if(io) {
          const statusMsg = status === 'on_the_way' ? 'Mitra sedang dalam perjalanan!' : 'Mitra mulai bekerja!';
          io.to(order.userId._id.toString()).emit('order_status_update', {
              orderId: order._id,
              status: status,
              message: statusMsg,
              order
          });
      }

      return res.json({ message: `Status diubah menjadi ${status}`, data: order });
    }

    if (status === 'cancelled') {
      const nonCancellableStatuses = ['completed', 'working', 'waiting_approval'];
      
      if (nonCancellableStatuses.includes(order.status)) {
        return res.status(400).json({ 
          message: 'Pesanan tidak dapat dibatalkan pada tahap ini.' 
        });
      }
      
      order.status = 'cancelled';
      await order.save();

      const io = getIO();
      if(io) {
          const targetId = isProvider ? order.userId._id.toString() : order.providerId?.userId._id.toString();
          if(targetId) {
              io.to(targetId).emit('order_status_update', {
                  orderId: order._id,
                  status: 'cancelled',
                  message: 'Pesanan dibatalkan.',
                  order
              });
          }
      }

      return res.json({ message: 'Pesanan dibatalkan', data: order });
    }

    return res.status(400).json({ message: 'Status atau aksi tidak valid.' });

  } catch (error) {
    next(error);
  }
}

// 7. REQUEST ADDITIONAL FEE
async function requestAdditionalFee(req, res, next) {
  try {
    const { orderId } = req.params;
    const { description, amount } = req.body;
    const userId = req.user.userId;

    if (!description || !amount || amount <= 0) {
      return res.status(400).json({ message: 'Deskripsi dan jumlah biaya harus valid.' });
    }

    const provider = await Provider.findOne({ userId });
    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
    }

    if (!order.providerId || !provider || order.providerId.toString() !== provider._id.toString()) {
      return res.status(403).json({ message: 'Anda tidak memiliki akses untuk request biaya tambahan pada order ini.' });
    }

    if (order.status !== 'working') {
      return res.status(400).json({ message: 'Biaya tambahan hanya bisa diajukan saat status "working".' });
    }

    order.additionalFees.push({
      description,
      amount,
      status: 'pending_approval'
    });

    await order.save();

    res.status(201).json({ 
      message: 'Permintaan biaya tambahan berhasil diajukan.',
      data: order
    });

  } catch (error) {
    next(error);
  }
}

// 8. UPLOAD COMPLETION EVIDENCE
async function uploadCompletionEvidence(req, res, next) {
  try {
    const { orderId } = req.params;
    const userId = req.user.userId;

    if (!req.file) {
      return res.status(400).json({ message: 'File gambar wajib diupload.' });
    }

    const provider = await Provider.findOne({ userId });
    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
    }

    if (!order.providerId || !provider || order.providerId.toString() !== provider._id.toString()) {
      return res.status(403).json({ message: 'Anda tidak memiliki akses untuk upload bukti pekerjaan ini.' });
    }

    if (order.status !== 'working') {
      return res.status(400).json({ message: 'Bukti pekerjaan hanya bisa diupload saat status "working".' });
    }

    const evidence = {
      url: `/uploads/${req.file.filename}`,
      type: 'photo',
      description: req.body.description || 'Bukti penyelesaian pekerjaan',
      uploadedAt: new Date()
    };

    order.completionEvidence.push(evidence);
    await order.save();

    res.status(201).json({ 
      message: 'Bukti pekerjaan berhasil diupload.',
      data: order
    });

  } catch (error) {
    next(error);
  }
}

// 9. REJECT ADDITIONAL FEE
async function rejectAdditionalFee(req, res, next) {
  try {
    const { orderId, feeId } = req.params;
    const userId = req.user.userId;

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    if (order.userId.toString() !== userId) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const fee = order.additionalFees.id(feeId);
    if (!fee) return res.status(404).json({ message: 'Fee not found' });

    if (fee.status !== 'pending_approval') {
      return res.status(400).json({ message: 'Hanya biaya yang statusnya menunggu persetujuan yang bisa ditolak.' });
    }

    fee.status = 'rejected';
    await order.save();

    res.json({ message: 'Biaya tambahan berhasil ditolak.', data: order });
  } catch (error) {
    next(error);
  }
}

// 10. AUTO COMPLETE STUCK ORDERS (CRON JOB)
async function autoCompleteStuckOrders(req, res, next) {
  try {
    const secretKey = req.headers['x-cron-secret'];
    if (secretKey !== env.cronSecret) {
        console.error('[CRON] Unauthorized attempt to trigger auto-complete');
        return res.status(403).json({ message: 'Forbidden: Invalid Cron Secret' });
    }

    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    
    // Cari yang stuck DAN belum diproses earnings-nya
    const stuckOrders = await Order.find({
      status: 'waiting_approval',
      waitingApprovalAt: { $lt: twoDaysAgo },
      isEarningsProcessed: { $ne: true } // Safety check
    });

    console.log(`[CRON] Found ${stuckOrders.length} stuck orders.`);

    let successCount = 0;
    let failCount = 0;

    for (const order of stuckOrders) {
      try {
        console.log(`[CRON] Auto-completing order: ${order._id}`);
        
        // Panggil fungsi atomic yang sudah diperbarui
        await calculateAndProcessEarnings(order._id);
        
        // Tambahkan catatan (dilakukan terpisah tidak masalah karena earnings sudah aman)
        await Order.findByIdAndUpdate(order._id, {
            $set: { 
                orderNote: (order.orderNote || '') + '\n[SYSTEM] Auto-completed due to inactivity.' 
            }
        });
        
        successCount++;
      } catch (err) {
        console.error(`[CRON] Failed to auto-complete order ${order._id}:`, err.message);
        failCount++;
      }
    }

    res.json({
      message: 'Auto-complete process finished',
      stats: {
        found: stuckOrders.length,
        success: successCount,
        failed: failCount
      }
    });

  } catch (error) {
    next(error);
  }
}

module.exports = { 
  listOrders, 
  createOrder, 
  getOrderById, 
  listIncomingOrders,
  acceptOrder,
  updateOrderStatus,
  requestAdditionalFee, 
  uploadCompletionEvidence,
  rejectAdditionalFee,
  autoCompleteStuckOrders
};