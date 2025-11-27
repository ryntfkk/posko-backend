const Order = require('./model');
const Provider = require('../providers/model');

// Helper: Konversi Date ke WIB dan ekstrak komponen waktu
function getWIBComponents(dateInput) {
  if (!dateInput) return null;
  
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return null;
  
  // Gunakan Intl.DateTimeFormat untuk akurasi timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  
  const parts = formatter.formatToParts(date);
  const getPart = (type) => parts.find(p => p.type === type)?.value || '';
  
  const dayOfWeek = new Intl.DateTimeFormat('en-US', { 
    timeZone: 'Asia/Jakarta', 
    weekday: 'short' 
  }). format(date);
  
  const dayIndexMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  
  return {
    dateOnly: `${getPart('year')}-${getPart('month')}-${getPart('day')}`,
    timeStr: `${getPart('hour')}:${getPart('minute')}`,
    dayIndex: dayIndexMap[dayOfWeek] ??  0,
  };
}

// 1. LIST ALL ORDERS
async function listOrders(req, res, next) {
  try {
    const { roles = [], userId } = req.user || {};
    const { view } = req.query; 
    
    let filter = { userId }; 

    if (view === 'provider' && roles.includes('provider')) {
      const provider = await Provider. findOne({ userId }). lean();
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
      .populate('items. serviceId', 'name category iconUrl')
      . populate('userId', 'fullName phoneNumber') // Removed address/location - already in order
      . populate({
        path: 'providerId',
        select: 'userId rating',
        populate: { path: 'userId', select: 'fullName profilePictureUrl' }
      })
      . sort({ createdAt: -1 })
      .lean(); // Optimized: Read-only query

    const messageKey = 'orders.list';
    res.json({ messageKey, message: req.t ?  req.t(messageKey) : 'List Orders', data: orders });
  } catch (error) {
    next(error);
  }
}

// 2. CREATE ORDER (DENGAN VALIDASI JADWAL)
async function createOrder(req, res, next) {
  try {
    const userId = req.user?. userId;
    if (! userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { 
      providerId, 
      items = [], 
      totalAmount = 0, 
      orderType, 
      scheduledAt,
      shippingAddress,
      location 
    } = req.body;

    // --- VALIDASI JADWAL UNTUK DIRECT ORDER ---
    if (orderType === 'direct') {
      if (!providerId) {
        return res.status(400).json({ message: 'Provider ID wajib untuk Direct Order' });
      }

      const provider = await Provider.findById(providerId).lean();
      if (! provider) {
        return res.status(404).json({ message: 'Mitra tidak ditemukan atau tidak aktif.' });
      }
      
      // [FIX] Gunakan helper function untuk parsing timezone yang aman
      const scheduled = getWIBComponents(scheduledAt);
      if (!scheduled) {
        return res.status(400).json({ message: 'Format tanggal kunjungan tidak valid.' });
      }

      // Cek apakah tanggal diblokir manual oleh Provider
      if (provider.blockedDates && provider.blockedDates.length > 0) {
        const isBlocked = provider. blockedDates. some(blockedDate => {
          const blocked = getWIBComponents(blockedDate);
          return blocked && blocked.dateOnly === scheduled.dateOnly;
        });
        
        if (isBlocked) {
          return res. status(400).json({
            message: 'Tanggal kunjungan ini diblokir manual oleh Mitra.  Pilih tanggal lain.'
          });
        }
      }
      
      // Cek Jadwal Harian (Jam Operasional)
      if (provider.schedule && provider.schedule. length > 0) {
        const daySchedule = provider.schedule.find(s => s.dayIndex === scheduled.dayIndex);

        if (daySchedule) {
          if (! daySchedule.isOpen) {
            return res.status(400).json({
              message: `Mitra tutup pada hari yang Anda pilih (${daySchedule. dayName}). `
            });
          }

          // [FIX] Perbandingan waktu yang lebih akurat
          if (scheduled.timeStr < daySchedule.start || scheduled.timeStr > daySchedule. end) {
            return res.status(400).json({
              message: `Waktu kunjungan di luar jam operasional Mitra (${daySchedule. start} - ${daySchedule.end} WIB) pada hari tersebut.`
            });
          }
        }
      }
    }

    const order = new Order({ 
      userId, 
      providerId: orderType === 'direct' ? providerId : null, // [FIX] Null untuk basic order
      items, 
      totalAmount, 
      orderType, 
      scheduledAt,
      shippingAddress,
      location
    });
    
    await order.save();
    res.status(201). json({ message: 'Pesanan berhasil dibuat', data: order });
  } catch (error) {
    next(error);
  }
}

// 3. GET ORDER BY ID
async function getOrderById(req, res, next) {
  try {
    const { orderId } = req.params;
    
    // [FIX] Removed duplicate populate for providerId
    const order = await Order.findById(orderId)
      .populate('items.serviceId', 'name iconUrl')
      . populate({
        path: 'providerId',
        select: 'userId rating isOnline',
        populate: { path: 'userId', select: 'fullName phoneNumber profilePictureUrl' }
      })
      .populate('userId', 'fullName phoneNumber profilePictureUrl')
      .lean(); // Optimized for read-only

    if (!order) {
      return res. status(404).json({ message: 'Pesanan tidak ditemukan' });
    }
    res.json({ message: 'Detail pesanan ditemukan', data: order });
  } catch (error) {
    next(error);
  }
}

// 4. LIST INCOMING ORDERS
async function listIncomingOrders(req, res, next) {
  try {
    const userId = req.user. userId;
    
    const provider = await Provider.findOne({ userId }).lean();
    if (!provider) {
      return res.status(403).json({ message: 'Anda belum terdaftar sebagai Mitra.' });
    }

    const myServiceIds = provider.services
      .filter(s => s.isActive)
      .map(s => s. serviceId);

    // [FIX] Gunakan shippingAddress & location dari Order, bukan dari User
    const orders = await Order.find({
      $or: [
        // Basic Order: status searching
        { 
          orderType: 'basic', 
          status: 'searching',
          providerId: null, 
          'items.serviceId': { $in: myServiceIds } 
        },
        // Direct Order: status paid (menunggu konfirmasi provider)
        { 
          providerId: provider._id,
          status: 'paid'
        }
      ]
    })
    .populate('userId', 'fullName profilePictureUrl phoneNumber') // Only basic info
    .populate('items.serviceId', 'name category iconUrl')
    .sort({ scheduledAt: 1 })
    .lean(); // Optimized

    res.json({ message: 'Daftar order masuk berhasil diambil', data: orders });
  } catch (error) {
    next(error);
  }
}

// 5.  ACCEPT ORDER
async function acceptOrder(req, res, next) {
  try {
    const { orderId } = req. params;
    const userId = req.user. userId;

    const provider = await Provider.findOne({ userId }).lean();
    if (! provider) {
      return res.status(403).json({ message: 'Akses ditolak.' });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan.' });
    }

    // [FIX] Hanya izinkan accept untuk order yang sudah dibayar
    // - Direct Order: status 'paid'
    // - Basic Order: status 'searching'
    const validStatuses = ['searching', 'paid'];
    if (!validStatuses. includes(order.status)) {
      return res.status(400).json({ 
        message: 'Pesanan ini sudah tidak tersedia, sudah diambil, atau belum dibayar.' 
      });
    }

    // [FIX] Validasi tambahan untuk basic order
    if (order.orderType === 'basic' && order.status !== 'searching') {
      return res.status(400).json({ 
        message: 'Basic order harus dalam status "searching" untuk diterima.' 
      });
    }

    // [FIX] Validasi untuk direct order
    if (order.orderType === 'direct') {
      if (order.status !== 'paid') {
        return res.status(400).json({ 
          message: 'Direct order harus sudah dibayar untuk diterima.' 
        });
      }
      // Pastikan provider yang accept adalah provider yang dituju
      if (order.providerId && order.providerId. toString() !== provider._id.toString()) {
        return res. status(403).json({ 
          message: 'Order ini ditujukan untuk mitra lain.' 
        });
      }
    }

    order.status = 'accepted';
    order.providerId = provider._id;
    await order.save();

    res.json({ message: 'Pesanan berhasil diterima!  Segera hubungi pelanggan. ', data: order });
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

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404). json({ message: 'Pesanan tidak ditemukan' });
    }

    const isCustomer = order.userId.toString() === userId;
    const provider = await Provider.findOne({ userId }).lean();
    const isProvider = order.providerId && provider && 
                       order.providerId. toString() === provider._id.toString();

    if (!isCustomer && !isProvider) {
      return res.status(403).json({ message: 'Anda tidak memiliki akses ke pesanan ini' });
    }

    // --- LOGIKA PERPINDAHAN STATUS ---

    // 1.  Provider Selesai Kerja -> waiting_approval
    if (status === 'completed' && isProvider) {
      if (order.status !== 'working') {
        return res.status(400).json({ 
          message: 'Hanya pesanan yang sedang dikerjakan yang bisa diselesaikan.' 
        });
      }
      order.status = 'waiting_approval';
      await order.save();
      return res.json({ 
        message: 'Pekerjaan ditandai selesai.  Menunggu konfirmasi pelanggan. ', 
        data: order 
      });
    }

    // 2.  Customer Konfirmasi Selesai
    if (status === 'completed' && isCustomer) {
      // [FIX] Pastikan customer adalah pemilik order yang benar
      if (order.userId.toString() !== userId) {
        return res. status(403).json({ 
          message: 'Anda tidak berhak mengkonfirmasi pesanan ini.' 
        });
      }
      
      if (order.status !== 'waiting_approval') {
        return res.status(400).json({ 
          message: 'Belum ada permintaan penyelesaian dari mitra.' 
        });
      }
      order.status = 'completed';
      await order.save();
      return res.json({ message: 'Pesanan selesai!  Terima kasih.', data: order });
    }

    // 3. Status Progres (On The Way, Working) - Hanya Provider
    if (['on_the_way', 'working'].includes(status)) {
      if (! isProvider) {
        return res.status(403).json({ 
          message: 'Hanya mitra yang bisa update status ini.' 
        });
      }
      
      // [FIX] Validasi urutan status
      const statusFlow = {
        'on_the_way': ['accepted'],
        'working': ['on_the_way']
      };
      
      if (!statusFlow[status]. includes(order.status)) {
        return res.status(400).json({ 
          message: `Tidak bisa mengubah status dari "${order.status}" ke "${status}". ` 
        });
      }
      
      order.status = status;
      await order.save();
      return res. json({ message: `Status diubah menjadi ${status}`, data: order });
    }

    // 4. Cancel
    if (status === 'cancelled') {
      // [FIX] Lebih spesifik tentang siapa yang bisa cancel
      const nonCancellableStatuses = ['completed', 'working', 'waiting_approval'];
      
      if (nonCancellableStatuses.includes(order.status)) {
        return res. status(400).json({ 
          message: 'Pesanan tidak dapat dibatalkan pada tahap ini.' 
        });
      }
      
      order.status = 'cancelled';
      await order. save();
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