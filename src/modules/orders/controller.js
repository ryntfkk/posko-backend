// src/modules/orders/controller.js
const Order = require('./model');
const Provider = require('../providers/model');

// 1. LIST ALL ORDERS
async function listOrders(req, res, next) {
  try {
    const { roles = [], userId } = req.user || {};
    const { view } = req.query; 
    
    let filter = { userId }; 

    if (view === 'provider' && roles.includes('provider')) {
      const provider = await Provider.findOne({ userId });
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
      .populate('userId', 'fullName phoneNumber address location') 
      .populate({
        path: 'providerId',
        select: 'userId rating',
        populate: { path: 'userId', select: 'fullName profilePictureUrl' }
      })
      .sort({ createdAt: -1 });

    const messageKey = 'orders.list';
    res.json({ messageKey, message: req.t ? req.t(messageKey) : 'List Orders', data: orders });
  } catch (error) {
    next(error);
  }
}

// 2. CREATE ORDER (DENGAN VALIDASI JADWAL LENGKAP)
async function createOrder(req, res, next) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
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

    // --- [PERBAIKAN UTAMA] VALIDASI JADWAL LENGKAP UNTUK DIRECT ORDER ---
    if (orderType === 'direct') {
      if (!providerId) {
        return res.status(400).json({ 
          message: 'Provider ID wajib untuk Direct Order' 
        });
      }

      const provider = await Provider.findById(providerId);
      if (! provider) {
        return res. status(404).json({ 
          message: 'Mitra tidak ditemukan atau tidak aktif.' 
        });
      }

      // [VALIDASI 1] Cek apakah scheduledAt adalah valid date
      let scheduledDate;
      try {
        scheduledDate = new Date(scheduledAt);
        if (isNaN(scheduledDate.getTime())) {
          throw new Error('Invalid date');
        }
      } catch (err) {
        return res.status(400).json({ 
          message: 'Format tanggal kunjungan tidak valid' 
        });
      }

      // [VALIDASI 2] Cek apakah tanggal tidak di masa lalu
      const now = new Date();
      if (scheduledDate < now) {
        return res.status(400). json({ 
          message: 'Tanggal kunjungan tidak boleh di masa lalu' 
        });
      }

      // [VALIDASI 3] Konversi ke zona waktu WIB/Jakarta
      const scheduledWIBString = scheduledDate.toLocaleString('id-ID', { 
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      
      // Parse ulang untuk mendapatkan informasi hari dan jam
      const scheduledWIBDate = new Date(scheduledWIBString);
      const scheduledDayIndex = scheduledWIBDate. getDay(); // 0 = Minggu, 1 = Senin, dst
      const scheduledHours = scheduledWIBDate. getHours();
      const scheduledMinutes = scheduledWIBDate.getMinutes();
      const scheduledTimeStr = `${scheduledHours. toString().padStart(2, '0')}:${scheduledMinutes.toString().padStart(2, '0')}`;

      // [VALIDASI 4] Cek apakah tanggal diblokir manual oleh Provider
      const scheduledDateOnly = scheduledWIBString.split(' ')[0]; // YYYY-MM-DD
      
      const isBlocked = provider.blockedDates && provider.blockedDates.some(blockedDate => {
        const blockedWIBString = blockedDate. toLocaleString('id-ID', {
          timeZone: 'Asia/Jakarta',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
        const blockedDateOnly = blockedWIBString.split(' ')[0];
        return blockedDateOnly === scheduledDateOnly;
      });
      
      if (isBlocked) {
        return res.status(400).json({
          message: 'Tanggal kunjungan ini diblokir manual oleh Mitra. Pilih tanggal lain.',
          blockedDate: scheduledDateOnly
        });
      }

      // [VALIDASI 5] Cek Jadwal Harian (Jam Operasional)
      if (provider.schedule && Array.isArray(provider.schedule) && provider.schedule.length > 0) {
        const daySchedule = provider.schedule.find(s => s.dayIndex === scheduledDayIndex);

        if (daySchedule) {
          // [5a] Cek apakah provider buka pada hari tersebut
          if (daySchedule.isOpen === false) {
            const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
            return res.status(400).json({
              message: `Mitra tutup pada hari ${dayNames[scheduledDayIndex]}. Pilih hari lain.`
            });
          }

          // [5b] Cek jam operasional (jika ada start dan end time)
          if (daySchedule.start && daySchedule.end) {
            if (scheduledTimeStr < daySchedule.start || scheduledTimeStr > daySchedule.end) {
              return res.status(400).json({
                message: `Waktu kunjungan di luar jam operasional Mitra (${daySchedule.start} - ${daySchedule.end} WIB) pada hari tersebut.`,
                operatingHours: {
                  start: daySchedule.start,
                  end: daySchedule.end
                },
                requestedTime: scheduledTimeStr
              });
            }
          }
        } else {
          // Jika tidak ada jadwal untuk hari tersebut, asumsikan provider buka
          console.log(`ℹ️ No schedule found for day ${scheduledDayIndex}, allowing booking`);
        }
      }

      // [VALIDASI 6] Cek jarak geografis (opsional, tergantung requirement)
      if (location && location.coordinates && provider.operatingArea) {
        const userLat = location.coordinates[1];
        const userLng = location.coordinates[0];
        
        // Simple distance check (bisa diganti dengan Haversine formula untuk akurasi lebih baik)
        const providerLat = provider.operatingArea.coordinates[1];
        const providerLng = provider. operatingArea.coordinates[0];
        
        const distance = Math.sqrt(
          Math.pow(userLat - providerLat, 2) + Math.pow(userLng - providerLng, 2)
        );
        
        // Jika jaraknya lebih dari threshold (misal 50km), reject
        const maxDistanceThreshold = 50; // km
        if (distance > maxDistanceThreshold) {
          return res.status(400). json({
            message: `Lokasi kunjungan di luar area operasional Mitra (${distance.toFixed(2)} km). `,
            distance: distance.toFixed(2),
            maxThreshold: maxDistanceThreshold
          });
        }
      }

      console.log(`✅ Direct Order validation passed for Provider: ${providerId}, Date: ${scheduledDateOnly}, Time: ${scheduledTimeStr}`);
    }

    // --- [WORKFLOW PERBAIKAN] BUAT ORDER DENGAN STATUS YANG BENAR ---
    const newOrder = new Order({
      userId,
      providerId: orderType === 'direct' ? providerId : null,
      items,
      totalAmount,
      orderType,
      status: 'pending', // Status awal: pending (menunggu payment)
      scheduledAt: new Date(scheduledAt),
      shippingAddress,
      location
    });

    await newOrder.save();
    
    res.status(201).json({
      message: 'Pesanan berhasil dibuat.  Lanjutkan ke pembayaran.',
      data: newOrder,
      nextStep: {
        action: 'payment',
        orderId: newOrder._id,
        totalAmount: newOrder.totalAmount
      }
    });
  } catch (error) {
    next(error);
  }
}

// 3. GET ORDER BY ID
async function getOrderById(req, res, next) {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId)
      .populate('items.serviceId', 'name iconUrl')
      .populate('providerId', 'userId rating isOnline')
      .populate({
        path: 'providerId',
        populate: { path: 'userId', select: 'fullName phoneNumber profilePictureUrl' }
      })
      .populate('userId', 'fullName phoneNumber profilePictureUrl');

    if (!order) {
      return res.status(404). json({ message: 'Pesanan tidak ditemukan' });
    }
    
    res.json({ message: 'Detail pesanan ditemukan', data: order });
  } catch (error) {
    next(error);
  }
}

// 4. LIST INCOMING ORDERS (untuk provider)
async function listIncomingOrders(req, res, next) {
  try {
    const userId = req.user.userId;
    
    const provider = await Provider.findOne({ userId });
    if (!provider) {
      return res.status(403).json({ message: 'Anda belum terdaftar sebagai Mitra.' });
    }

    const myServiceIds = provider.services
      .filter(s => s.isActive)
      .map(s => s.serviceId);

    const orders = await Order.find({
      $or: [
        // KONDISI A: Basic Order (mencari provider)
        { 
          orderType: 'basic', 
          status: 'searching',
          providerId: null, 
          'items.serviceId': { $in: myServiceIds } 
        },
        // KONDISI B: Direct Order untuk provider ini (sudah dibayar, menunggu konfirmasi)
        { 
          providerId: provider._id,
          status: { $in: ['paid'] } 
        }
      ]
    })
    .populate('userId', 'fullName address location profilePictureUrl phoneNumber') 
    .populate('items.serviceId', 'name category iconUrl')
    .sort({ scheduledAt: 1 });

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

    const provider = await Provider.findOne({ userId });
    if (!provider) return res.status(403).json({ message: 'Akses ditolak.' });

    const order = await Order.findById(orderId);
    if (! order) return res.status(404).json({ message: 'Pesanan tidak ditemukan.' });

    // Validasi order status
    if (! ['searching', 'paid']. includes(order.status)) {
      return res.status(400). json({ 
        message: 'Pesanan ini sudah tidak tersedia atau sudah diambil.',
        currentStatus: order.status
      });
    }

    // Update order
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
    const userId = req.user. userId;

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: 'Pesanan tidak ditemukan' });

    const isCustomer = order.userId. toString() === userId;
    const provider = await Provider.findOne({ userId });
    const isProvider = order.providerId && provider && order.providerId.toString() === provider._id.toString();

    if (!isCustomer && !isProvider) {
      return res.status(403).json({ message: 'Anda tidak memiliki akses ke pesanan ini' });
    }

    // --- LOGIKA STATE MACHINE UNTUK ORDER STATUS ---
    const validTransitions = {
      'pending': ['cancelled'], // Dari pending hanya bisa cancel
      'paid': ['accepted', 'cancelled'], // Dari paid bisa accept atau cancel
      'searching': ['accepted', 'cancelled'],
      'accepted': ['on_the_way', 'cancelled'],
      'on_the_way': ['working', 'cancelled'],
      'working': ['waiting_approval', 'cancelled'],
      'waiting_approval': ['completed', 'cancelled'],
      'completed': [], // Final state
      'cancelled': [], // Final state
      'failed': [] // Final state
    };

    // Validasi transisi status
    if (! validTransitions[order.status] || !validTransitions[order.status]. includes(status)) {
      return res.status(400).json({ 
        message: `Transisi status tidak valid dari ${order.status} ke ${status}`,
        currentStatus: order.status,
        validNextStatuses: validTransitions[order. status]
      });
    }

    // --- PERMISSION CHECK PER STATUS ---
    if (status === 'completed' && isProvider) {
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

    if (status === 'completed' && isCustomer) {
      if (order.status !== 'waiting_approval') {
        return res.status(400).json({ 
          message: 'Belum ada permintaan penyelesaian dari mitra.' 
        });
      }
      order.status = 'completed';
      await order.save();
      return res.json({ 
        message: 'Pesanan selesai! Terima kasih.', 
        data: order 
      });
    }

    // Progress status (on_the_way, working) - hanya provider
    if (['on_the_way', 'working'].includes(status)) {
      if (!isProvider) {
        return res.status(403).json({ 
          message: 'Hanya mitra yang bisa update status ini.' 
        });
      }
      order.status = status;
      await order.save();
      return res.json({ 
        message: `Status diubah menjadi ${status}`, 
        data: order 
      });
    }

    // Accept order
    if (status === 'accepted') {
      if (!isProvider) {
        return res.status(403).json({ 
          message: 'Hanya mitra yang bisa accept order.' 
        });
      }
      order.status = 'accepted';
      order.providerId = provider._id;
      await order.save();
      return res.json({ 
        message: 'Pesanan diterima! ', 
        data: order 
      });
    }

    // Cancel order
    if (status === 'cancelled') {
      if (['completed', 'waiting_approval'].includes(order.status)) {
        return res.status(400).json({ 
          message: 'Pesanan tidak dapat dibatalkan pada tahap ini.' 
        });
      }
      order.status = 'cancelled';
      await order.save();
      return res.json({ 
        message: 'Pesanan dibatalkan', 
        data: order 
      });
    }

    return res.status(400).json({ 
      message: 'Status atau aksi tidak valid.',
      requestedStatus: status
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
  updateOrderStatus
};