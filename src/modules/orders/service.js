// src/modules/orders/service.js
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

// [CONFIG] Constants
const DEFAULT_TIMEZONE = 'Asia/Jakarta';
const DEFAULT_OFFSET = '+07:00';
const BROADCAST_RADIUS_KM = 15;
const CRON_BATCH_SIZE = 50; // Memproses 50 order per batch untuk hemat memori

// [OPTIMIZATION] Cache formatter di luar class untuk performa (Singleton pattern)
const dateFormatterCache = new Map();

function getCachedFormatter(timeZone) {
  if (!dateFormatterCache.has(timeZone)) {
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
      dateFormatterCache.set(timeZone, formatter);
    } catch (error) {
      console.error(`[DATE_FORMAT] Invalid Timezone: ${timeZone}`, error);
      // Fallback ke default timezone jika error
      if (timeZone !== DEFAULT_TIMEZONE) {
        return getCachedFormatter(DEFAULT_TIMEZONE);
      }
      return null;
    }
  }
  return dateFormatterCache.get(timeZone);
}

class OrderService {
  // --- HELPER METHODS ---

  getLocalDateComponents(dateInput, timeZone = DEFAULT_TIMEZONE) {
    if (!dateInput) return null;

    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return null;

    const formatter = getCachedFormatter(timeZone);
    if (!formatter) return null;

    const parts = formatter.formatToParts(date);
    const getPart = (type) => parts.find(p => p.type === type)?.value || '';

    return {
      dateOnly: `${getPart('year')}-${getPart('month')}-${getPart('day')}`,
      timeStr: `${getPart('hour')}:${getPart('minute')}`,
      fullDate: date
    };
  }

  async getProviderActiveOrderCount(providerId) {
    const activeStatuses = ['accepted', 'on_the_way', 'working'];
    return await Order.countDocuments({
      providerId: providerId,
      status: { $in: activeStatuses }
    });
  }

  async broadcastBasicOrderToNearbyProviders(order) {
    try {
      const io = getIO();
      if (!io) return;

      if (!order.location || !order.location.coordinates || order.location.coordinates.length !== 2) {
        console.warn(`[BROADCAST] Order ${order._id} tidak memiliki lokasi valid.`);
        return;
      }

      const [longitude, latitude] = order.location.coordinates;
      const requiredServiceIds = order.items.map(item => item.serviceId);

      const nearbyProviders = await Provider.find({
        location: {
          $near: {
            $geometry: {
              type: "Point",
              coordinates: [longitude, latitude]
            },
            $maxDistance: BROADCAST_RADIUS_KM * 1000
          }
        },
        isAvailable: true,
        verificationStatus: 'verified',
        'services': {
          $elemMatch: {
            serviceId: { $in: requiredServiceIds },
            isActive: true
          }
        }
      }).populate('userId', 'fullName fcmToken');

      console.log(`[BROADCAST] Found ${nearbyProviders.length} verified providers near order ${order._id}`);

      let broadcastCount = 0;
      for (const provider of nearbyProviders) {
        if (provider.userId) {
          io.to(provider.userId._id.toString()).emit('order_new', {
            message: 'Ada pesanan baru di sekitar Anda!',
            order: {
              ...order.toObject(),
              distance: 'Dekat lokasi Anda'
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

  async processOrderCompletion(orderId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const order = await Order.findById(orderId).session(session);

      if (!order) {
        throw new Error('Pesanan tidak ditemukan saat memproses earnings.');
      }

      if (order.isEarningsProcessed) {
        console.warn(`[EARNINGS] Order ${order._id} already processed. Skipping.`);
        await session.abortTransaction();
        return {
          alreadyProcessed: true,
          message: 'Earnings already processed for this order.',
          order // Return order agar tidak perlu fetch ulang
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

      const providerUser = await User.findByIdAndUpdate(
        providerDoc.userId,
        { $inc: { balance: earningsAmount } },
        { new: true, session: session }
      );

      if (!providerUser) {
        throw new Error('Data user mitra tidak ditemukan.');
      }

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

      order.status = 'completed';
      order.waitingApprovalAt = null;
      order.isEarningsProcessed = true;
      await order.save({ session });

      await session.commitTransaction();

      return {
        success: true,
        order, // Kembalikan objek order terbaru agar controller tidak perlu fetch lagi
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

  // --- CORE BUSINESS LOGIC METHODS ---

  async listOrders(user, query) {
    const { roles = [], userId } = user || {};
    const { view } = query;

    let filter = { userId };

    if (view === 'provider' && roles.includes('provider')) {
      const provider = await Provider.findOne({ userId }).lean();
      if (provider) {
        filter = { providerId: provider._id };
      } else {
        return [];
      }
    }

    if (roles.includes('admin') && !view) {
      filter = {};
    }

    return await Order.find(filter)
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
  }

  async createOrder(user, body) {
    const session = await mongoose.startSession();
    
    // Variabel untuk menyimpan hasil operasi DB agar bisa diakses di luar blok try-catch DB
    let createdOrder = null;
    let providerUserIdToNotify = null;
    let shouldBroadcastBasic = false;

    try {
      session.startTransaction();

      const userId = user?.userId;
      if (!userId) throw new Error('Unauthorized');

      const {
        providerId, items = [], orderType, scheduledAt, shippingAddress,
        location, customerContact, orderNote, propertyDetails,
        scheduledTimeSlot, attachments, voucherCode
      } = body;

      if (items.length === 0) throw new Error('Items tidak boleh kosong');

      let providerData = null;
      let providerSnapshot = {};

      if (orderType === 'direct') {
        if (!providerId) throw new Error('Provider ID wajib untuk Direct Order');

        providerData = await Provider.findById(providerId)
          .populate('userId', 'fullName profilePictureUrl phoneNumber')
          .session(session)
          .lean();

        if (!providerData) throw new Error('Mitra tidak ditemukan atau tidak aktif.');
        if (providerData.verificationStatus !== 'verified') throw new Error('Mitra ini belum terverifikasi.');

        if (providerData.userId) {
          providerUserIdToNotify = providerData.userId._id;
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
        if (!serviceDoc) throw new Error(`Service ID ${item.serviceId} tidak ditemukan.`);

        const quantity = parseInt(item.quantity) || 1;
        let realPrice;

        if (orderType === 'direct' && providerData) {
          const providerService = providerData.services.find(
            ps => ps.serviceId && ps.serviceId.toString() === item.serviceId.toString()
          );
          if (!providerService || !providerService.isActive) {
            throw new Error(`Mitra ini tidak menyediakan layanan "${serviceDoc.name}" atau layanan sedang tidak aktif.`);
          }
          realPrice = providerService.price;
        } else {
          realPrice = serviceDoc.price || serviceDoc.basePrice;
        }

        servicesSubtotal += (realPrice * quantity);
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
        const masterVoucher = await Voucher.findOne({ code: voucherCode.toUpperCase() }).session(session);
        if (!masterVoucher) throw new Error('Kode voucher tidak valid.');

        const userVoucher = await UserVoucher.findOne({
          userId,
          voucherId: masterVoucher._id,
          status: 'active'
        }).populate('voucherId').session(session);

        if (!userVoucher) throw new Error('Voucher tidak valid atau belum diklaim.');

        const voucher = userVoucher.voucherId;
        const now = new Date();
        if (!voucher.isActive || new Date(voucher.expiryDate) < now) throw new Error('Voucher sudah kadaluarsa');

        let eligibleForDiscountTotal = 0;
        const applicableServiceIds = voucher.applicableServices.map(id => id.toString());
        const isGlobalVoucher = applicableServiceIds.length === 0;

        validatedItems.forEach(item => {
          const itemTotal = item.price * item.quantity;
          if (isGlobalVoucher || applicableServiceIds.includes(item.serviceId.toString())) {
            eligibleForDiscountTotal += itemTotal;
          }
        });

        if (eligibleForDiscountTotal === 0) throw new Error('Voucher ini tidak berlaku untuk layanan yang Anda pilih.');
        if (eligibleForDiscountTotal < voucher.minPurchase) throw new Error(`Minimal pembelian layanan valid adalah Rp ${voucher.minPurchase.toLocaleString()}`);

        if (voucher.discountType === 'percentage') {
          discountAmount = (eligibleForDiscountTotal * voucher.discountValue) / 100;
          if (voucher.maxDiscount > 0 && discountAmount > voucher.maxDiscount) discountAmount = voucher.maxDiscount;
        } else {
          discountAmount = voucher.discountValue;
        }

        if (discountAmount > eligibleForDiscountTotal) discountAmount = eligibleForDiscountTotal;
        voucherId = voucher._id;

        lockedUserVoucher = await UserVoucher.findOneAndUpdate(
          { _id: userVoucher._id, status: 'active' },
          { status: 'used', usageDate: new Date() },
          { new: true, session: session }
        );
        if (!lockedUserVoucher) throw new Error('Voucher gagal digunakan.');
      }

      const finalTotalAmount = servicesSubtotal + adminFee - discountAmount;

      if (orderType === 'direct' && providerData) {
        const targetTimeZone = providerData.timeZone || DEFAULT_TIMEZONE;
        const targetOffset = providerData.timeZoneOffset || DEFAULT_OFFSET;
        const scheduled = this.getLocalDateComponents(scheduledAt, targetTimeZone);
        
        if (!scheduled) throw new Error('Format tanggal kunjungan tidak valid.');
        
        const now = new Date();
        const oneHourBefore = new Date(now.getTime() - 60 * 60 * 1000);
        if (scheduled.fullDate < oneHourBefore) throw new Error('Tanggal kunjungan tidak boleh di masa lalu.');

        if (providerData.blockedDates && providerData.blockedDates.length > 0) {
          const isBlocked = providerData.blockedDates.some(blockedDate => {
            const blocked = this.getLocalDateComponents(blockedDate, targetTimeZone);
            return blocked && blocked.dateOnly === scheduled.dateOnly;
          });
          if (isBlocked) throw new Error('Tanggal kunjungan ini diblokir manual oleh Mitra (Libur).');
        }

        const dateStart = new Date(`${scheduled.dateOnly}T00:00:00.000${targetOffset}`);
        const dateEnd = new Date(`${scheduled.dateOnly}T23:59:59.999${targetOffset}`);

        const existingOrder = await Order.findOne({
          providerId: providerId,
          status: { $in: ['paid', 'accepted', 'on_the_way', 'working', 'waiting_approval'] },
          scheduledAt: { $gte: dateStart, $lte: dateEnd }
        }).session(session);

        if (existingOrder) throw new Error('Mitra sudah penuh pada tanggal tersebut.');
      }

      const order = new Order({
        userId,
        providerId: orderType === 'direct' ? providerId : null,
        providerSnapshot,
        items: validatedItems,
        totalAmount: Math.floor(finalTotalAmount),
        adminFee,
        appliedCommissionPercent: platformCommissionPercent,
        discountAmount: Math.floor(discountAmount),
        voucherId,
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
        await UserVoucher.findByIdAndUpdate(lockedUserVoucher._id, { orderId: order._id }, { session });
      }

      // [FIX] Commit transaction SEBELUM logic socket/broadcast
      await session.commitTransaction();
      
      createdOrder = order;
      shouldBroadcastBasic = orderType === 'basic';

    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      throw error;
    } finally {
      session.endSession();
    }

    // --- SOCKET & BROADCAST Logic (Di luar Transaction) ---
    // Error di sini tidak akan membatalkan order yang sudah tersimpan
    try {
      const io = getIO();
      if (createdOrder && io) {
        if (createdOrder.orderType === 'direct' && providerUserIdToNotify) {
          io.to(providerUserIdToNotify.toString()).emit('order_new', {
            message: 'Anda menerima pesanan baru!',
            order: createdOrder.toObject()
          });
        }
      }

      if (createdOrder && shouldBroadcastBasic) {
        // [PERFORMANCE] Gunakan await agar async context terjaga, tapi error ditangkap lokal
        await this.broadcastBasicOrderToNearbyProviders(createdOrder);
      }
    } catch (broadcastError) {
      console.error('[ORDER POST-PROCESS ERROR] Notification failed:', broadcastError);
      // Jangan throw error ke controller agar response tetap 201 Created
    }

    return createdOrder;
  }

  async getOrderById(orderId) {
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

    if (!order) throw new Error('Pesanan tidak ditemukan');
    return order;
  }

  async listIncomingOrders(user) {
    const provider = await Provider.findOne({ userId: user.userId }).lean();
    if (!provider) throw new Error('Anda belum terdaftar sebagai Mitra.');

    const activeOrderCount = await this.getProviderActiveOrderCount(provider._id);

    // [QUERY 1] Direct Orders (Prioritas)
    const directOrdersPromise = Order.find({
      providerId: provider._id,
      status: 'paid'
    })
      .populate('userId', 'fullName profilePictureUrl phoneNumber')
      .populate('items.serviceId', 'name category iconUrl')
      .lean();

    // [QUERY 2] Basic Orders (Hanya jika tidak sibuk & terverifikasi)
    let basicOrdersPromise = Promise.resolve([]);

    if (activeOrderCount === 0 && provider.verificationStatus === 'verified') {
      const myServiceIds = provider.services
        .filter(s => s.isActive)
        .map(s => s.serviceId.toString());

      let basicQuery = {
        orderType: 'basic',
        status: 'searching',
        providerId: null,
        'items.serviceId': { $in: myServiceIds }
      };

      // [ROBUSTNESS] Validasi ketat untuk koordinat sebelum query spasial
      if (
        provider.location && 
        provider.location.type === 'Point' && 
        Array.isArray(provider.location.coordinates) && 
        provider.location.coordinates.length === 2 &&
        (provider.location.coordinates[0] !== 0 || provider.location.coordinates[1] !== 0)
      ) {
        basicQuery.location = {
          $near: {
            $geometry: {
              type: "Point",
              coordinates: provider.location.coordinates
            },
            $maxDistance: BROADCAST_RADIUS_KM * 1000
          }
        };

        basicOrdersPromise = Order.find(basicQuery)
          .populate('userId', 'fullName profilePictureUrl phoneNumber')
          .populate('items.serviceId', 'name category iconUrl')
          .limit(20)
          .lean();
      } else {
        // Fallback jika lokasi provider belum diset dengan benar
        // console.warn(`Provider ${provider._id} has invalid location. Skipping proximity search.`);
      }
    }

    const [directOrders, basicOrders] = await Promise.all([directOrdersPromise, basicOrdersPromise]);

    const combinedOrders = [...directOrders, ...basicOrders].sort((a, b) => {
      return new Date(a.scheduledAt) - new Date(b.scheduledAt);
    });

    return {
      providerStatus: {
        activeOrderCount,
        isBusy: activeOrderCount > 0,
        verificationStatus: provider.verificationStatus
      },
      data: combinedOrders
    };
  }

  async acceptOrder(user, orderId) {
    const provider = await Provider.findOne({ userId: user.userId }).lean();
    if (!provider) throw new Error('Akses ditolak.');
    if (provider.verificationStatus !== 'verified') throw new Error('Akun Anda belum terverifikasi.');

    const orderCheck = await Order.findById(orderId).lean();
    if (!orderCheck) throw new Error('Pesanan tidak ditemukan.');

    if (orderCheck.orderType === 'basic') {
      const activeOrderCount = await this.getProviderActiveOrderCount(provider._id);
      if (activeOrderCount > 0) throw new Error(`Selesaikan ${activeOrderCount} pesanan aktif Anda terlebih dahulu.`);
    }

    let queryCondition = { _id: orderId };
    if (orderCheck.orderType === 'basic') {
      queryCondition.status = 'searching';
      queryCondition.providerId = null;
    } else if (orderCheck.orderType === 'direct') {
      queryCondition.status = 'paid';
      queryCondition.providerId = provider._id;
    } else {
      throw new Error('Tipe order tidak valid.');
    }

    const updatedOrder = await Order.findOneAndUpdate(
      queryCondition,
      { $set: { status: 'accepted', providerId: provider._id } },
      { new: true }
    ).populate('userId', 'fullName');

    if (!updatedOrder) throw new Error('Gagal menerima pesanan. Pesanan mungkin sudah diambil mitra lain.');

    const io = getIO();
    if (io) {
      io.to(updatedOrder.userId._id.toString()).emit('order_status_update', {
        orderId: updatedOrder._id,
        status: 'accepted',
        message: 'Mitra telah menerima pesanan Anda!',
        order: updatedOrder
      });
    }

    return updatedOrder;
  }

  async updateOrderStatus(user, orderId, status) {
    // Fetch awal untuk validasi
    const order = await Order.findById(orderId)
      .populate('userId')
      .populate({ path: 'providerId', populate: { path: 'userId' } });

    if (!order) throw new Error('Pesanan tidak ditemukan');

    const isCustomer = order.userId._id.toString() === user.userId;
    const isProvider = order.providerId && order.providerId.userId._id.toString() === user.userId;

    if (!isCustomer && !isProvider) throw new Error('Unauthorized access');

    // 1. Mark as Waiting Approval
    if (status === 'waiting_approval' && isProvider) {
      if (order.status !== 'working') throw new Error('Hanya pesanan "working" yang bisa diselesaikan.');
      if (!order.completionEvidence || order.completionEvidence.length === 0) {
        throw new Error('Wajib upload bukti pekerjaan selesai.');
      }

      order.status = 'waiting_approval';
      order.waitingApprovalAt = new Date();
      await order.save();

      const io = getIO();
      if (io) {
        io.to(order.userId._id.toString()).emit('order_status_update', {
          orderId: order._id,
          status: 'waiting_approval',
          message: 'Pekerjaan selesai! Mohon konfirmasi pesanan.',
          order
        });
      }
      return { message: 'Menunggu konfirmasi pelanggan', data: order };
    }

    // 2. Mark as Completed (Customer Confirmation)
    if (status === 'completed' && isCustomer) {
      if (order.status !== 'waiting_approval') throw new Error('Belum ada permintaan penyelesaian.');

      // [CRITICAL FIX] Menggunakan return value dari processOrderCompletion untuk menghindari fetch ulang
      const result = await this.processOrderCompletion(order._id);
      
      const io = getIO();
      if (io && result.order.providerId) {
        // Karena result.order mungkin tidak populate provider, kita ambil ID dari order awal
        const providerUserId = order.providerId.userId._id.toString();
        io.to(providerUserId).emit('order_status_update', {
          orderId: result.order._id,
          status: 'completed',
          message: 'Pesanan selesai! Dana telah diteruskan.',
          order: result.order
        });
      }

      return { 
        message: 'Pesanan selesai! Terima kasih.', 
        data: { ...result } 
      };
    }

    // 3. Status Updates Lainnya (On The Way / Working)
    if (['on_the_way', 'working'].includes(status)) {
      if (!isProvider) throw new Error('Hanya mitra yang bisa mengubah status ini.');
      
      const statusFlow = {
        'on_the_way': ['accepted'],
        'working': ['on_the_way']
      };

      if (!statusFlow[status].includes(order.status)) {
        throw new Error(`Tidak bisa ubah status dari "${order.status}" ke "${status}".`);
      }

      order.status = status;
      await order.save();

      const io = getIO();
      if (io) {
        const msg = status === 'on_the_way' ? 'Mitra sedang dalam perjalanan!' : 'Mitra mulai bekerja!';
        io.to(order.userId._id.toString()).emit('order_status_update', {
          orderId: order._id,
          status,
          message: msg,
          order
        });
      }
      return { message: `Status diubah menjadi ${status}`, data: order };
    }

    // 4. Cancelled
    if (status === 'cancelled') {
      const nonCancellable = ['completed', 'working', 'waiting_approval'];
      if (nonCancellable.includes(order.status)) throw new Error('Pesanan tidak dapat dibatalkan saat ini.');

      order.status = 'cancelled';
      await order.save();

      const io = getIO();
      if (io) {
        const targetId = isProvider ? order.userId._id.toString() : order.providerId?.userId._id.toString();
        if (targetId) {
          io.to(targetId).emit('order_status_update', {
            orderId: order._id,
            status: 'cancelled',
            message: 'Pesanan dibatalkan.',
            order
          });
        }
      }
      return { message: 'Pesanan dibatalkan', data: order };
    }

    throw new Error('Status atau aksi tidak valid.');
  }

  async requestAdditionalFee(user, orderId, { description, amount }) {
    if (!description || !amount || amount <= 0) throw new Error('Deskripsi dan jumlah biaya harus valid.');
    
    const provider = await Provider.findOne({ userId: user.userId });
    const order = await Order.findById(orderId);

    if (!order) throw new Error('Pesanan tidak ditemukan');
    if (!order.providerId || !provider || order.providerId.toString() !== provider._id.toString()) {
      throw new Error('Unauthorized');
    }
    if (order.status !== 'working') throw new Error('Hanya bisa diajukan saat status "working".');

    order.additionalFees.push({ description, amount, status: 'pending_approval' });
    await order.save();
    return order;
  }

  async uploadCompletionEvidence(user, orderId, file, description) {
    if (!file) throw new Error('File gambar wajib diupload.');
    
    const provider = await Provider.findOne({ userId: user.userId });
    const order = await Order.findById(orderId);

    if (!order) throw new Error('Pesanan tidak ditemukan');
    if (!order.providerId || !provider || order.providerId.toString() !== provider._id.toString()) {
      throw new Error('Unauthorized');
    }
    if (order.status !== 'working') throw new Error('Hanya bisa diupload saat status "working".');

    order.completionEvidence.push({
      url: `/uploads/${file.filename}`,
      type: 'photo',
      description: description || 'Bukti penyelesaian pekerjaan',
      uploadedAt: new Date()
    });
    await order.save();
    return order;
  }

  async rejectAdditionalFee(user, orderId, feeId) {
    const order = await Order.findById(orderId);
    if (!order) throw new Error('Order not found');
    if (order.userId.toString() !== user.userId) throw new Error('Unauthorized');

    const fee = order.additionalFees.id(feeId);
    if (!fee) throw new Error('Fee not found');
    if (fee.status !== 'pending_approval') throw new Error('Status biaya tidak valid untuk ditolak.');

    fee.status = 'rejected';
    await order.save();
    return order;
  }

  async autoCompleteStuckOrders(cronSecret) {
    if (cronSecret !== env.cronSecret) throw new Error('Forbidden: Invalid Cron Secret');

    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    
    // [MEMORY FIX] Fetch data tanpa menumpuk di memori (gunakan cursor atau proses bertahap)
    // Di sini kita gunakan find biasa namun akan kita proses dengan chunking/batching
    const stuckOrders = await Order.find({
      status: 'waiting_approval',
      waitingApprovalAt: { $lt: twoDaysAgo },
      isEarningsProcessed: { $ne: true }
    });

    console.log(`[CRON] Found ${stuckOrders.length} stuck orders.`);

    let successCount = 0;
    let failCount = 0;

    // [BATCH PROCESSING] Proses per batch untuk mencegah Promise.allSettled memakan terlalu banyak memori
    for (let i = 0; i < stuckOrders.length; i += CRON_BATCH_SIZE) {
      const chunk = stuckOrders.slice(i, i + CRON_BATCH_SIZE);
      
      const results = await Promise.allSettled(chunk.map(async (order) => {
        // 1. Process Earnings
        await this.processOrderCompletion(order._id);
        
        // 2. Add System Note
        await Order.findByIdAndUpdate(order._id, {
          $set: { orderNote: (order.orderNote || '') + '\n[SYSTEM] Auto-completed due to inactivity.' }
        });
        return order._id;
      }));

      // Update stats
      successCount += results.filter(r => r.status === 'fulfilled').length;
      failCount += results.filter(r => r.status === 'rejected').length;

      // Log failures detail (opsional, agar log tidak banjir bisa dibatasi)
      results.filter(r => r.status === 'rejected').forEach((r, idx) => {
          console.error(`[CRON] Fail for order ${chunk[idx]._id}:`, r.reason);
      });

      // Sedikit jeda untuk memberi nafas ke Event Loop jika load sangat tinggi
      if (i + CRON_BATCH_SIZE < stuckOrders.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return { found: stuckOrders.length, success: successCount, failed: failCount };
  }
}

module.exports = new OrderService();