// src/modules/orders/controller.js
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
    
    if (roles.includes('admin') && ! view) {
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
    res.json({ messageKey, message: req.t ?  req.t(messageKey) : 'List Orders', data: orders });
  } catch (error) {
    next(error);
  }
}

// 2.CREATE ORDER
async function createOrder(req, res, next) {
  try {
    const userId = req.user?.userId;
    if (! userId) {
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
      voucherCode // [BARU] Menerima kode voucher dari frontend
    } = req.body;

    // --- SECURITY CHECK: CALCULATE PRICE FROM DB ---
    let servicesSubtotal = 0;
    const validatedItems = [];

    if (items.length === 0) {
      return res.status(400).json({ message: 'Items tidak boleh kosong' });
    }

    // Loop through items dan ambil harga asli dari DB
    for (const item of items) {
      if (!item.serviceId) continue;

      const serviceDoc = await Service.findById(item.serviceId);
      if (!serviceDoc) {
        return res.status(400).json({ message: `Service ID ${item.serviceId} tidak ditemukan.` });
      }

      const quantity = parseInt(item.quantity) || 1;
      const realPrice = serviceDoc.price || serviceDoc.basePrice; // Fallback ke basePrice jika price undefined
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
    
    // --- [UPDATED] FETCH ADMIN FEE DARI DB ---
    const settings = await Settings.findOne({ key: 'global_config' });
    // Gunakan 2500 sebagai default jika settings belum diinisialisasi untuk mencegah fee 0
    const adminFee = settings ? settings.adminFee : 2500;

    // --- [FIXED] VOUCHER LOGIC ---
    let discountAmount = 0;
    let voucherId = null;
    let userVoucherIdToUpdate = null; // ID UserVoucher untuk di-update statusnya nanti

    if (voucherCode) {
      // 1. Cek kepemilikan voucher di UserVoucher (Wajib Klaim Dulu)
      const userVoucher = await UserVoucher.findOne({ 
        userId,
        status: 'active'
      }).populate({
        path: 'voucherId',
        match: { code: voucherCode.toUpperCase() }
      });

      // Jika tidak ditemukan atau voucherId null (karena match gagal)
      if (!userVoucher || !userVoucher.voucherId) {
        return res.status(404).json({ message: 'Voucher tidak valid atau belum diklaim.' });
      }

      const voucher = userVoucher.voucherId;

      // 2. Validasi Master Voucher (Aktif & Expiry)
      const now = new Date();
      if (!voucher.isActive || new Date(voucher.expiryDate) < now) {
        return res.status(400).json({ message: 'Voucher sudah kadaluarsa' });
      }

      // 3. Hitung Eligible Total (Hanya item yang sesuai dengan Applicable Services)
      let eligibleForDiscountTotal = 0;
      const applicableServiceIds = voucher.applicableServices.map(id => id.toString());
      const isGlobalVoucher = applicableServiceIds.length === 0;

      validatedItems.forEach(item => {
        const itemTotal = item.price * item.quantity;
        
        if (isGlobalVoucher) {
          // Jika voucher global, semua layanan dihitung
          eligibleForDiscountTotal += itemTotal;
        } else {
          // Jika voucher spesifik, cek apakah serviceId item ini termasuk
          if (applicableServiceIds.includes(item.serviceId.toString())) {
            eligibleForDiscountTotal += itemTotal;
          }
        }
      });

      // 4. Validasi Min Purchase (Berdasarkan Eligible Total)
      if (eligibleForDiscountTotal === 0) {
        return res.status(400).json({ 
          message: 'Voucher ini tidak berlaku untuk layanan yang Anda pilih.' 
        });
      }

      if (eligibleForDiscountTotal < voucher.minPurchase) {
        return res.status(400).json({ 
          message: `Minimal pembelian layanan yang valid untuk voucher ini adalah Rp ${voucher.minPurchase.toLocaleString()}` 
        });
      }

      // 5. Hitung Diskon
      if (voucher.discountType === 'percentage') {
        discountAmount = (eligibleForDiscountTotal * voucher.discountValue) / 100;
        if (voucher.maxDiscount > 0 && discountAmount > voucher.maxDiscount) {
          discountAmount = voucher.maxDiscount;
        }
      } else {
        // Fixed Amount
        discountAmount = voucher.discountValue;
      }

      // Cap diskon tidak boleh melebihi total yang eligible
      if (discountAmount > eligibleForDiscountTotal) {
        discountAmount = eligibleForDiscountTotal;
      }

      voucherId = voucher._id;
      userVoucherIdToUpdate = userVoucher._id;
    }

    // --- [UPDATED] FINAL TOTAL CALCULATION ---
    // Total = Jasa + Admin - Diskon
    const finalTotalAmount = servicesSubtotal + adminFee - discountAmount;

    // ------------------------------------------------

    // --- VALIDASI JADWAL UNTUK DIRECT ORDER ---
    if (orderType === 'direct') {
      if (!providerId) {
        return res.status(400).json({ message: 'Provider ID wajib untuk Direct Order' });
      }

      const provider = await Provider.findById(providerId).lean();
      if (! provider) {
        return res.status(404).json({ message: 'Mitra tidak ditemukan atau tidak aktif.' });
      }
      
      const targetTimeZone = provider.timeZone || DEFAULT_TIMEZONE;
      const targetOffset = provider.timeZoneOffset || DEFAULT_OFFSET;

      const scheduled = getLocalDateComponents(scheduledAt, targetTimeZone);
      if (! scheduled) {
        return res.status(400).json({ message: 'Format tanggal kunjungan tidak valid.' });
      }

      // Validasi 0: Pastikan pesanan tidak Backdated (Masa Lalu)
      const now = new Date();
      // Beri toleransi 1 jam untuk proses booking
      const oneHourBefore = new Date(now.getTime() - 60 * 60 * 1000);
      if (scheduled.fullDate < oneHourBefore) {
         return res.status(400).json({ message: 'Tanggal kunjungan tidak boleh di masa lalu.' });
      }

      // Validasi 1: Cek apakah tanggal diblokir manual oleh Provider (Kalender Libur)
      if (provider.blockedDates && provider.blockedDates.length > 0) {
        const isBlocked = provider.blockedDates.some(blockedDate => {
          const blocked = getLocalDateComponents(blockedDate, targetTimeZone);
          return blocked && blocked.dateOnly === scheduled.dateOnly;
        });
        
        if (isBlocked) {
          return res.status(400).json({
            message: 'Tanggal kunjungan ini diblokir manual oleh Mitra (Libur). Pilih tanggal lain.'
          });
        }
      }

      // Validasi 2: Cek apakah tanggal sudah ada pesanan aktif (Double Booking Prevention)
      const dateStart = new Date(`${scheduled.dateOnly}T00:00:00.000${targetOffset}`);
      const dateEnd = new Date(`${scheduled.dateOnly}T23:59:59.999${targetOffset}`);

      const existingOrder = await Order.findOne({
        providerId: providerId,
        status: { $in: ['paid', 'accepted', 'on_the_way', 'working', 'waiting_approval'] }, 
        scheduledAt: {
          $gte: dateStart,
          $lte: dateEnd
        }
      });

      if (existingOrder) {
        return res.status(400).json({
          message: 'Mitra sudah penuh/memiliki jadwal lain pada tanggal tersebut. Silakan pilih tanggal lain.'
        });
      }
    }

    const order = new Order({ 
      userId, 
      providerId: orderType === 'direct' ? providerId : null,
      items: validatedItems,          
      
      // [UPDATED] Financial Fields
      totalAmount: Math.floor(finalTotalAmount), // Bulatkan agar rapi
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
    
    await order.save();

    // [FIXED] UPDATE STATUS VOUCHER SETELAH ORDER BERHASIL DISIMPAN
    if (userVoucherIdToUpdate) {
      await UserVoucher.findByIdAndUpdate(userVoucherIdToUpdate, {
        status: 'used',
        usageDate: new Date(),
        orderId: order._id
      });
      // Note: Kita TIDAK mengurangi quota master lagi disini, 
      // karena quota master sudah dikurangi saat User melakukan CLAIM.
    }
    
    res.status(201).json({ 
      message: 'Pesanan berhasil dibuat', 
      data: {
        ...order.toObject(),
        orderNumber: order.orderNumber
      }
    });
  } catch (error) {
    next(error);
  }
}

// 3.GET ORDER BY ID
async function getOrderById(req, res, next) {
  try {
    const { orderId } = req.params;
    
    const order = await Order.findById(orderId)
      .populate('items.serviceId', 'name iconUrl')
      .populate('voucherId', 'code description') // [UPDATED] Populate info voucher
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

    // Ambil semua ID Service yang dimiliki Provider dan AKTIF
    const myServiceIds = provider.services
      .filter(s => s.isActive)
      .map(s => s.serviceId.toString());

    // Logic: Order masuk adalah order basic yang BELUM diambil (providerId: null)
    // DAN item di dalam order tersebut HARUS sesuai dengan layanan yang dimiliki provider.
    // Jika order memiliki multiple item, kita cek apakah provider punya SALAH SATU layanan tersebut (bisa disesuaikan jadi 'ALL' jika perlu).
    
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
          status: 'paid' // Direct order yang sudah dibayar masuk sini
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
    if (!order) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan.' });
    }

    // Validasi status order sebelum diterima
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

    res.json({ message: 'Pesanan berhasil diterima! Segera hubungi pelanggan.', data: order });
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

    // [FIXED] PROVIDER FLOW: Completed -> Waiting Approval
    // Provider menekan tombol "Pekerjaan Selesai", mengirim status 'waiting_approval'
    if (status === 'waiting_approval' && isProvider) {
      if (order.status !== 'working') {
        return res.status(400).json({ 
          message: 'Hanya pesanan yang sedang dikerjakan yang bisa diselesaikan.' 
        });
      }
      order.status = 'waiting_approval';
      await order.save();
      return res.json({ 
        message: 'Pekerjaan ditandai selesai. Menunggu konfirmasi pelanggan.', 
        data: order 
      });
    }

    // CUSTOMER FLOW: Confirm Completion
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

    // PROVIDER FLOW: Start Journey & Start Working
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
      
      if (! statusFlow[status].includes(order.status)) {
        return res.status(400).json({ 
          message: `Tidak bisa mengubah status dari "${order.status}" ke "${status}".` 
        });
      }
      
      order.status = status;
      await order.save();
      return res.json({ message: `Status diubah menjadi ${status}`, data: order });
    }

    // CANCEL FLOW
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