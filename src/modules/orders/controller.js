// src/modules/orders/controller.js
const mongoose = require('mongoose'); // [ADDED] Diperlukan untuk Transaction
const Order = require('./model');
const Provider = require('../providers/model');
const Service = require('../services/model');
const Settings = require('../settings/model');
const Voucher = require('../vouchers/model');
const UserVoucher = require('../vouchers/userVoucherModel');

// [CONFIG] Default Timezone Configuration
const DEFAULT_TIMEZONE = 'Asia/Jakarta';
const DEFAULT_OFFSET = '+07:00'; 

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
      fullDate: date // Object Date asli (UTC)
    };
  } catch (error) {
    console.error(`Invalid Timezone: ${timeZone}`, error);
    return null;
  }
}

// 1.LIST ALL ORDERS
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
    
    if (roles.includes('admin') && !  view) {
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
    res.json({ messageKey, message: req.t ?   req.t(messageKey) : 'List Orders', data: orders });
  } catch (error) {
    next(error);
  }
}

// 2.CREATE ORDER
async function createOrder(req, res, next) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user?.userId;
    if (! userId) {
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

    // --- [FIX] FETCH PROVIDER DATA UNTUK DIRECT ORDER ---
    let providerData = null;
    let providerSnapshot = {};

    if (orderType === 'direct') {
      if (! providerId) {
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

      if (providerData.userId) {
        providerSnapshot = {
          fullName: providerData.userId.fullName,
          profilePictureUrl: providerData.userId.profilePictureUrl,
          phoneNumber: providerData.userId.phoneNumber,
          rating: providerData.rating || 0
        };
      }
    }

    // --- [OPTIMIZED] FETCH SERVICES SEKALI JALAN ---
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

      // --- [FIX UTAMA] PRICING LOGIC UNTUK DIRECT ORDER ---
      if (orderType === 'direct' && providerData) {
        const providerService = providerData.services.find(
          ps => ps.serviceId && ps.serviceId.toString() === item.serviceId.toString() && ps.isActive
        );

        if (! providerService) {
          await session.abortTransaction();
          return res.status(400).json({ 
            message: `Mitra ini tidak menyediakan layanan "${serviceDoc.name}".` 
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
    const adminFee = settings ?  settings.adminFee : 2500;

    // --- [FIXED] VOUCHER LOGIC WITH ATOMIC TRANSACTION ---
    let discountAmount = 0;
    let voucherId = null;
    let lockedUserVoucher = null; 

    if (voucherCode) {
      const userVoucher = await UserVoucher.findOne({ 
        userId,
        status: 'active'
      }).populate({
        path: 'voucherId',
        match: { code: voucherCode.toUpperCase() }
      }).session(session);

      if (! userVoucher || !userVoucher.voucherId) {
        await session.abortTransaction();
        return res.status(404).json({ message: 'Voucher tidak valid atau belum diklaim.' });
      }

      const voucher = userVoucher.voucherId;
      const now = new Date();
      if (! voucher.isActive || new Date(voucher.expiryDate) < now) {
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

      if (! lockedUserVoucher) {
        await session.abortTransaction();
        return res.status(400).json({ message: 'Voucher gagal digunakan atau sudah terpakai.' });
      }
    }

    const finalTotalAmount = servicesSubtotal + adminFee - discountAmount;

    // --- VALIDASI JADWAL UNTUK DIRECT ORDER ---
    if (orderType === 'direct' && providerData) {
      const targetTimeZone = providerData.timeZone || DEFAULT_TIMEZONE;
      const targetOffset = providerData.timeZoneOffset || DEFAULT_OFFSET;

      const scheduled = getLocalDateComponents(scheduledAt, targetTimeZone);
      if (!  scheduled) {
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

    // --- CREATE DB DOCUMENT ---
    const order = new Order({ 
      userId, 
      providerId: orderType === 'direct' ? providerId : null,
      providerSnapshot,
      items: validatedItems,          
      
      totalAmount: Math.floor(finalTotalAmount),
      adminFee: adminFee,
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

// 3.GET ORDER BY ID
async function getOrderById(req, res, next) {
  try {
    const { orderId } = req.params;
    
    const order = await Order.findById(orderId)
      .populate('items.serviceId', 'name iconUrl')
      .populate('voucherId', 'code description')
      .populate({
        path: 'providerId',
        select: 'userId rating isOnline',
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

// 4.LIST INCOMING ORDERS
async function listIncomingOrders(req, res, next) {
  try {
    const userId = req.user.userId;
    
    const provider = await Provider.findOne({ userId }).lean();
    if (!provider) {
      return res.status(403).json({ message: 'Anda belum terdaftar sebagai Mitra.' });
    }

    const myServiceIds = provider.services
      .filter(s => s.isActive)
      .map(s => s.serviceId.toString());
    
    const orders = await Order.find({
      $or: [
        { 
          orderType: 'basic', 
          status: 'searching',
          providerId: null, 
          'items.serviceId': { $in: myServiceIds } 
        },
        { 
          providerId: provider._id,
          status: 'paid'
        }
      ]
    })
    .populate('userId', 'fullName profilePictureUrl phoneNumber')
    .populate('items.serviceId', 'name category iconUrl')
    .sort({ scheduledAt: 1 })
    .lean();

    res.json({ message: 'Daftar order masuk berhasil diambil', data: orders });
  } catch (error) {
    next(error);
  }
}

// 5. ACCEPT ORDER
async function acceptOrder(req, res, next) {
  try {
    const { orderId } = req.params;
    const userId = req.user.userId;

    const provider = await Provider.findOne({ userId }).lean();
    if (! provider) {
      return res.status(403).json({ message: 'Akses ditolak.' });
    }

    const order = await Order.findById(orderId);
    if (! order) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan.' });
    }

    const validStatuses = ['searching', 'paid'];
    if (!validStatuses.includes(order.status)) {
      return res.status(400).json({ 
        message: 'Pesanan ini sudah tidak tersedia, sudah diambil, atau belum dibayar.' 
      });
    }

    if (order.orderType === 'basic' && order.status !== 'searching') {
      return res.status(400).json({ 
        message: 'Basic order harus dalam status "searching" untuk diterima.' 
      });
    }

    if (order.orderType === 'direct') {
      if (order.status !== 'paid') {
        return res.status(400).json({ 
          message: 'Direct order harus sudah dibayar untuk diterima.' 
        });
      }
      if (order.providerId && order.providerId.toString() !== provider._id.toString()) {
        return res.status(403).json({ 
          message: 'Order ini ditujukan untuk mitra lain.' 
        });
      }
    }

    order.status = 'accepted';
    order.providerId = provider._id;
    await order.save();

    res.json({ message: 'Pesanan berhasil diterima!  Segera hubungi pelanggan.', data: order });
  } catch (error) {
    next(error);
  }
}

// 6.UPDATE ORDER STATUS
async function updateOrderStatus(req, res, next) {
  try {
    const { orderId } = req.params;
    const { status } = req.body; 
    const userId = req.user.userId;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
    }

    const isCustomer = order.userId.toString() === userId;
    const provider = await Provider.findOne({ userId }).lean();
    const isProvider = order.providerId && provider && 
                       order.providerId.toString() === provider._id.toString();

    if (!isCustomer && !isProvider) {
      return res.status(403).json({ message: 'Anda tidak memiliki akses ke pesanan ini' });
    }

    if (status === 'waiting_approval' && isProvider) {
      if (order.status !== 'working') {
        return res.status(400).json({ 
          message: 'Hanya pesanan yang sedang dikerjakan yang bisa diselesaikan.' 
        });
      }
      order.status = 'waiting_approval';
      await order.save();
      return res.json({ 
        message: 'Pekerjaan ditandai selesai.Menunggu konfirmasi pelanggan.', 
        data: order 
      });
    }

    if (status === 'completed' && isCustomer) {
      if (order.status !== 'waiting_approval') {
        return res.status(400).json({ 
          message: 'Belum ada permintaan penyelesaian dari mitra.' 
        });
      }
      order.status = 'completed';
      await order.save();
      return res.json({ message: 'Pesanan selesai! Terima kasih.', data: order });
    }

    if (['on_the_way', 'working'].includes(status)) {
      if (! isProvider) {
        return res.status(403).json({ 
          message: 'Hanya mitra yang bisa update status ini.' 
        });
      }
      
      const statusFlow = {
        'on_the_way': ['accepted'],
        'working': ['on_the_way']
      };
      
      if (!  statusFlow[status].includes(order.status)) {
        return res.status(400).json({ 
          message: `Tidak bisa mengubah status dari "${order.status}" ke "${status}".` 
        });
      }
      
      order.status = status;
      await order.save();
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
      return res.json({ message: 'Pesanan dibatalkan', data: order });
    }

    return res.status(400).json({ message: 'Status atau aksi tidak valid.' });

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
  updateOrderStatus
};