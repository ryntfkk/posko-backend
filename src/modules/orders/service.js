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
  // --- HELPER METHODS (UTILITY) ---

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
    // [UPDATE] Hanya status fisik bekerja yang dianggap "Active/Busy"
    // 'paid' (Direct Order baru) TIDAK masuk sini.
    const activeStatuses = ['accepted', 'on_the_way', 'working'];
    return await Order.countDocuments({
      providerId: providerId,
      status: { $in: activeStatuses }
    });
  }

  // --- PRIVATE HELPERS FOR CREATE ORDER (REFACTORING STEP) ---

  /**
   * Mengambil dan memvalidasi data provider untuk Direct Order
   */
  async _fetchAndValidateProvider(providerId, orderType, session) {
    if (orderType !== 'direct') return null;
    if (!providerId) throw new Error('Provider ID wajib untuk Direct Order');

    const providerData = await Provider.findById(providerId)
      .populate('userId', 'fullName profilePictureUrl phoneNumber')
      .session(session)
      .lean();

    if (!providerData) throw new Error('Mitra tidak ditemukan atau tidak aktif.');
    if (providerData.verificationStatus !== 'verified') throw new Error('Mitra ini belum terverifikasi.');

    return providerData;
  }

  /**
   * Memproses items, validasi layanan, dan hitung subtotal
   */
  async _processOrderItems(items, orderType, providerData, session) {
    if (!items || items.length === 0) throw new Error('Items tidak boleh kosong');

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
      if (quantity <= 0) throw new Error(`Quantity untuk layanan ${serviceDoc.name} harus positif.`);
      
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

    return { validatedItems, servicesSubtotal };
  }

  /**
   * Validasi dan apply voucher logic
   */
  async _applyVoucher(voucherCode, userId, items, session) {
    if (!voucherCode) return { discountAmount: 0, voucherId: null, lockedUserVoucher: null };

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

    items.forEach(item => {
      const itemTotal = item.price * item.quantity;
      if (isGlobalVoucher || applicableServiceIds.includes(item.serviceId.toString())) {
        eligibleForDiscountTotal += itemTotal;
      }
    });

    if (eligibleForDiscountTotal === 0) throw new Error('Voucher ini tidak berlaku untuk layanan yang Anda pilih.');
    if (eligibleForDiscountTotal < voucher.minPurchase) throw new Error(`Minimal pembelian layanan valid adalah Rp ${voucher.minPurchase.toLocaleString()}`);

    let discountAmount = 0;
    if (voucher.discountType === 'percentage') {
      discountAmount = (eligibleForDiscountTotal * voucher.discountValue) / 100;
      if (voucher.maxDiscount > 0 && discountAmount > voucher.maxDiscount) discountAmount = voucher.maxDiscount;
    } else {
      discountAmount = voucher.discountValue;
    }

    if (discountAmount > eligibleForDiscountTotal) discountAmount = eligibleForDiscountTotal;

    const lockedUserVoucher = await UserVoucher.findOneAndUpdate(
      { _id: userVoucher._id, status: 'active' },
      { status: 'used', usageDate: new Date() },
      { new: true, session: session }
    );
    if (!lockedUserVoucher) throw new Error('Voucher gagal digunakan.');

    return { discountAmount, voucherId: voucher._id, lockedUserVoucher };
  }

  /**
   * Validasi jadwal kunjungan (khusus Direct Order)
   */
  async _validateSchedule(scheduledAt, providerData, providerId, session) {
    if (!providerData) return; // Basic order does not validate specific provider schedule yet

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

  // --- CORE BUSINESS LOGIC METHODS ---

  async createOrder(user, body) {
    const session = await mongoose.startSession();
    
    // Variabel state untuk side effects
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

      // 1. Fetch Provider Data (If Direct)
      const providerData = await this._fetchAndValidateProvider(providerId, orderType, session);
      
      // 2. Validate & Calculate Items
      const { validatedItems, servicesSubtotal } = await this._processOrderItems(items, orderType, providerData, session);

      // 3. Fetch Settings (Admin Fee & Commission)
      const settings = await Settings.findOne({ key: 'global_config' }).session(session);
      const adminFee = settings ? settings.adminFee : 2500;
      const platformCommissionPercent = settings ? settings.platformCommissionPercent : 12;

      // 4. Validate & Apply Voucher
      const { discountAmount, voucherId, lockedUserVoucher } = await this._applyVoucher(voucherCode, userId, validatedItems, session);

      // 5. Final Calculation
      const finalTotalAmount = servicesSubtotal + adminFee - discountAmount;

      // 6. Validate Schedule (If Direct)
      if (orderType === 'direct') {
         await this._validateSchedule(scheduledAt, providerData, providerId, session);
      }

      // 7. Prepare Snapshot
      let providerSnapshot = {};
      if (providerData && providerData.userId) {
        providerUserIdToNotify = providerData.userId._id;
        providerSnapshot = {
          fullName: providerData.userId.fullName,
          profilePictureUrl: providerData.userId.profilePictureUrl,
          phoneNumber: providerData.userId.phoneNumber,
          rating: providerData.rating || 0
        };
      }

      // 8. Create Order Document
      const order = new Order({
        userId,
        providerId: orderType === 'direct' ? providerId : null,
        providerSnapshot,
        items: validatedItems,
        totalAmount: Math.floor(finalTotalAmount),
        adminFee,
        appliedCommissionPercent: platformCommissionPercent, // [SNAPSHOT] Important for Step 1 Logic
        discountAmount: Math.floor(discountAmount),
        voucherId,
        orderType,
        // [FIX] Status harus 'pending' agar bisa dibayar via PaymentController
        status: 'pending',
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

      await session.commitTransaction();
      
      createdOrder = order;
      // [FIX] Hapus broadcast di sini. Notifikasi akan dipicu via Webhook setelah pembayaran sukses.
      shouldBroadcastBasic = false;

    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      throw error;
    } finally {
      session.endSession();
    }

    // [FIX] Tidak memanggil _handleOrderNotifications di sini
    // this._handleOrderNotifications(createdOrder, providerUserIdToNotify, shouldBroadcastBasic);

    return createdOrder;
  }

  // [BARU] Fungsi ini dipanggil oleh PaymentController.handleNotification setelah status -> PAID
  async triggerPostPaymentNotifications(orderId) {
    try {
      const order = await Order.findById(orderId)
        .populate({
          path: 'providerId',
          populate: { path: 'userId', select: '_id' } 
        });

      if (!order) return;

      const io = getIO();
      if (!io) return;

      // 1. Notifikasi untuk Direct Order (Ke Provider Tertentu)
      if (order.orderType === 'direct' && order.providerId && order.providerId.userId) {
        const providerUserId = order.providerId.userId._id.toString();
        io.to(providerUserId).emit('order_new', {
          message: 'Anda menerima pesanan baru! (Sudah Dibayar)',
          order: order.toObject()
        });
        console.log(`[NOTIF] Sent direct order notif to ${providerUserId}`);
      }

      // 2. Notifikasi untuk Basic Order (Broadcast ke Sekitar)
      if (order.orderType === 'basic') {
        await this.broadcastBasicOrderToNearbyProviders(order);
      }

    } catch (error) {
      console.error('[POST-PAYMENT NOTIF ERROR]', error);
    }
  }

  // Helper untuk Notification (Side Effect - Legacy / Internal use)
  async _handleOrderNotifications(order, providerUserId, shouldBroadcast) {
    if (!order) return;
    try {
      const io = getIO();
      if (!io) return;

      if (order.orderType === 'direct' && providerUserId) {
        io.to(providerUserId.toString()).emit('order_new', {
          message: 'Anda menerima pesanan baru!',
          order: order.toObject()
        });
      }

      if (shouldBroadcast) {
        await this.broadcastBasicOrderToNearbyProviders(order);
      }
    } catch (error) {
      console.error('[NOTIFICATION ERROR]', error);
    }
  }

  async listOrders(user, query) {
    const { roles = [], userId } = user || {};
    const { view, page = 1, limit = 10 } = query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, parseInt(limit));
    const skip = (pageNum - 1) * limitNum;

    let match = { userId: new mongoose.Types.ObjectId(userId) };

    if (view === 'provider' && roles.includes('provider')) {
      const provider = await Provider.findOne({ userId }).lean();
      if (provider) {
        match = { providerId: new mongoose.Types.ObjectId(provider._id) };
      } else {
        return { data: [], meta: { total: 0, page: pageNum, limit: limitNum } };
      }
    }

    if (roles.includes('admin') && !view) {
      match = {};
    }

    const totalDocs = await Order.countDocuments(match);

    const pipeline = [
      { $match: match },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limitNum },

      // Lookup Customer
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'customerInfo',
        },
      },
      { $unwind: { path: '$customerInfo', preserveNullAndEmptyArrays: true } },

      // Lookup Voucher
      {
        $lookup: {
          from: 'vouchers',
          localField: 'voucherId',
          foreignField: '_id',
          as: 'voucherInfo',
        },
      },
      { $unwind: { path: '$voucherInfo', preserveNullAndEmptyArrays: true } },
      
      // Lookup Provider
      {
        $lookup: {
          from: 'providers',
          localField: 'providerId',
          foreignField: '_id',
          as: 'providerDoc',
        },
      },
      { $unwind: { path: '$providerDoc', preserveNullAndEmptyArrays: true } },

      // Nested Lookup Provider User
      {
        $lookup: {
          from: 'users',
          localField: 'providerDoc.userId',
          foreignField: '_id',
          as: 'providerUserInfo',
        },
      },
      { $unwind: { path: '$providerUserInfo', preserveNullAndEmptyArrays: true } },
      
      // Lookup Services
      {
        $lookup: {
          from: 'services',
          localField: 'items.serviceId',
          foreignField: '_id',
          as: 'serviceDetails',
        },
      },

      // Reconstruct items
      {
        $addFields: {
          items: {
            $map: {
              input: '$items',
              as: 'item',
              in: {
                $mergeObjects: [
                  '$$item',
                  {
                    serviceId: {
                      $arrayElemAt: [
                        {
                          $filter: {
                            input: '$serviceDetails',
                            as: 'service',
                            cond: { $eq: ['$$service._id', '$$item.serviceId'] },
                          },
                        },
                        0,
                      ],
                    },
                  },
                ]
              }
            }
          }
        }
      },
      
      // Project
      {
        $project: {
          _id: 1,
          orderNumber: 1,
          totalAmount: 1,
          status: 1,
          createdAt: 1,
          scheduledAt: 1,
          orderType: 1,
          adminFee: 1,
          appliedCommissionPercent: 1, // [UPDATED FROM STEP 1] Expose snapshot fee
          discountAmount: 1,
          completionEvidence: 1,
          additionalFees: 1,
          items: {
            $map: {
              input: '$items',
              as: 'item',
              in: {
                serviceId: {
                  _id: '$$item.serviceId._id',
                  name: '$$item.serviceId.name',
                  category: '$$item.serviceId.category',
                  iconUrl: '$$item.serviceId.iconUrl',
                },
                name: '$$item.name',
                price: '$$item.price',
                quantity: '$$item.quantity',
                note: '$$item.note',
              }
            }
          },
          userId: {
            _id: '$customerInfo._id',
            fullName: '$customerInfo.fullName',
            phoneNumber: '$customerInfo.phoneNumber',
          },
          voucherId: {
            _id: '$voucherInfo._id',
            code: '$voucherInfo.code',
            discountType: '$voucherInfo.discountType',
            discountValue: '$voucherInfo.discountValue',
          },
          providerId: {
            _id: '$providerDoc._id',
            rating: '$providerDoc.rating',
            userId: {
              _id: '$providerUserInfo._id',
              fullName: '$providerUserInfo.fullName',
              profilePictureUrl: '$providerUserInfo.profilePictureUrl',
            },
          }
        }
      }
    ];

    const data = await Order.aggregate(pipeline);

    return {
      data,
      meta: {
        total: totalDocs,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalDocs / limitNum)
      }
    };
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
        order,
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

  // [UPDATED] LIST INCOMING ORDERS
  async listIncomingOrders(user) {
    const provider = await Provider.findOne({ userId: user.userId }).lean();
    if (!provider) throw new Error('Anda belum terdaftar sebagai Mitra.');

    // 1. Cek Apakah Mitra Sibuk (Active Statuses only)
    const activeOrderCount = await this.getProviderActiveOrderCount(provider._id);

    // 2. Fetch Direct Orders (Order Tembak) - Status 'paid' (Belum diterima)
    // Direct order 'paid' TIDAK menghitung activeOrderCount, jadi mitra tidak dianggap busy.
    const directOrdersPromise = Order.find({
      providerId: provider._id,
      status: 'paid'
    })
      .populate('userId', 'fullName profilePictureUrl phoneNumber')
      .populate('items.serviceId', 'name category iconUrl')
      .lean();

    let basicOrdersPromise = Promise.resolve([]);

    // 3. Logic Fetch Basic Orders (Marketplace)
    // Jika tidak ada job aktif ('accepted', 'working', etc), dan provider verified
    if (activeOrderCount === 0 && provider.verificationStatus === 'verified') {
      
      const myServiceIds = provider.services
        .filter(s => s.isActive)
        .map(s => s.serviceId.toString());

      let basicQuery = {
        orderType: 'basic',
        status: 'searching', // Webhook will set 'pending' -> 'searching' after payment
        providerId: null, 
        'items.serviceId': { $in: myServiceIds },
        rejectedByProviders: { $ne: provider._id } 
      };

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
      }
    }

    const [directOrders, basicOrders] = await Promise.all([directOrdersPromise, basicOrdersPromise]);

    const combinedOrders = [...directOrders, ...basicOrders].sort((a, b) => {
      // Prioritaskan Direct Order di atas
      if (a.orderType === 'direct' && b.orderType !== 'direct') return -1;
      if (a.orderType !== 'direct' && b.orderType === 'direct') return 1;
      return new Date(a.scheduledAt) - new Date(b.scheduledAt);
    });

    return {
      providerStatus: {
        activeOrderCount,
        isBusy: activeOrderCount > 0, // Direct 'paid' order does NOT make provider busy
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

  // [BARU] REJECT ORDER
  async rejectOrder(user, orderId) {
    const provider = await Provider.findOne({ userId: user.userId });
    if (!provider) throw new Error('Provider not found');

    const order = await Order.findById(orderId);
    if (!order) throw new Error('Order not found');

    if (order.orderType === 'direct') {
       // Direct order rejection = Cancellation
       // Pastikan yang reject adalah provider yang dituju
       if (order.providerId && order.providerId.toString() === provider._id.toString()) {
           if (order.status !== 'paid') throw new Error('Status order tidak valid untuk ditolak.');
           
           order.status = 'cancelled';
           // Note: Refund logic should be handled here in production
           await order.save();
           
           const io = getIO();
           if (io) {
               io.to(order.userId.toString()).emit('order_status_update', {
                   orderId: order._id,
                   status: 'cancelled',
                   message: 'Mitra membatalkan/menolak pesanan Anda.',
                   order
               });
           }

           return { message: 'Order rejected and cancelled', order };
       }
       throw new Error('Unauthorized or invalid direct order rejection.');
    } else {
       // Basic order rejection = Hide from list
       if (order.status !== 'searching') throw new Error('Order is no longer available');
       
       await Order.findByIdAndUpdate(orderId, {
           $addToSet: { rejectedByProviders: provider._id }
       });
       return { message: 'Order hidden from your list' };
    }
  }

  async updateOrderStatus(user, orderId, status) {
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

      const result = await this.processOrderCompletion(order._id);
      
      const io = getIO();
      if (io && result.order.providerId) {
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

    // 3. Status Updates Lainnya
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

  // [BARU] 7b. VOID ADDITIONAL FEE
  async voidAdditionalFee(user, orderId, feeId) {
    const provider = await Provider.findOne({ userId: user.userId });
    if (!provider) throw new Error('Unauthorized provider');

    const order = await Order.findById(orderId);
    if (!order) throw new Error('Order not found');

    // Ensure order belongs to provider
    if (!order.providerId || order.providerId.toString() !== provider._id.toString()) {
        throw new Error('Unauthorized order access');
    }

    const fee = order.additionalFees.id(feeId);
    if (!fee) throw new Error('Fee item not found');

    // Only allow voiding if pending
    if (fee.status !== 'pending_approval') {
        throw new Error('Hanya biaya dengan status "menunggu persetujuan" yang bisa dibatalkan.');
    }

    fee.status = 'voided';
    await order.save();
    return order;
  }

  // 8. UPLOAD COMPLETION EVIDENCE
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

  // 9. REJECT ADDITIONAL FEE
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

  // 10. AUTO COMPLETE STUCK ORDERS (CRON JOB)
  async autoCompleteStuckOrders(cronSecret) {
    if (cronSecret !== env.cronSecret) throw new Error('Forbidden: Invalid Cron Secret');

    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    
    const cursor = Order.find({
      status: 'waiting_approval',
      waitingApprovalAt: { $lt: twoDaysAgo },
      isEarningsProcessed: { $ne: true }
    }).cursor();

    console.log(`[CRON] Starting auto-complete process...`);

    let successCount = 0;
    let failCount = 0;
    let processedCount = 0;

    for (let order = await cursor.next(); order != null; order = await cursor.next()) {
      try {
        processedCount++;
        await this.processOrderCompletion(order._id);
        
        await Order.findByIdAndUpdate(order._id, {
          $set: { orderNote: (order.orderNote || '') + '\n[SYSTEM] Auto-completed due to inactivity.' }
        });

        successCount++;
      } catch (error) {
        console.error(`[CRON] Fail for order ${order._id}:`, error.message);
        failCount++;
      }
    }

    return { found: processedCount, success: successCount, failed: failCount };
  }
}

module.exports = new OrderService();