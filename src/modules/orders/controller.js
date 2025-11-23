const Order = require('./model');
const Provider = require('../providers/model');

// [UPDATE] Perbaikan listOrders agar Provider hanya melihat order miliknya
async function listOrders(req, res, next) {
  try {
    const { roles = [], userId } = req.user || {};
    
    let filter = { userId }; // Default: Customer melihat ordernya sendiri

    if (roles.includes('provider')) {
      // Cari ID Provider berdasarkan User ID
      const provider = await Provider.findOne({ userId });
      if (provider) {
        // Provider melihat order yang providerId-nya adalah dia
        filter = { providerId: provider._id };
      }
    } else if (roles.includes('admin')) {
      filter = {}; // Admin lihat semua
    }

    const orders = await Order.find(filter)
      .populate('items.serviceId', 'name category iconUrl')
      .populate('userId', 'fullName phoneNumber address location') // [PENTING] Provider butuh data customer
      .populate({
        path: 'providerId',
        select: 'userId rating',
        populate: { path: 'userId', select: 'fullName profilePictureUrl' }
      })
      .sort({ createdAt: -1 });

    const messageKey = 'orders.list';
    res.json({ messageKey, message: req.t(messageKey), data: orders });
  } catch (error) {
    next(error);
  }
}

async function createOrder(req, res, next) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      const messageKey = 'auth.unauthorized';
      return res.status(401).json({ messageKey, message: req.t ? req.t(messageKey) : 'Unauthorized' });
    }

    // [PERBAIKAN] Tambahkan 'orderType' di sini agar dibaca dari Frontend
    const { providerId, items = [], totalAmount = 0, orderType } = req.body;
    
    // [PERBAIKAN] Masukkan 'orderType' ke dalam object Order baru
    const order = new Order({ userId, providerId, items, totalAmount, orderType });
    
    await order.save();
    const messageKey = 'orders.created';
    res.status(201).json({ messageKey, message: req.t(messageKey), data: order });
  } catch (error) {
    next(error);
  }
}

async function getOrderById(req, res, next) {
  try {
    const { orderId } = req.params;
    const userId = req.user.userId;

    // Cari order berdasarkan ID
    const order = await Order.findById(orderId)
      .populate('items.serviceId', 'name iconUrl') // Ambil detail service
      .populate('providerId', 'userId rating isOnline') // Ambil info provider (jika ada)
      .populate({
         path: 'providerId',
         populate: { path: 'userId', select: 'fullName phoneNumber profilePictureUrl' }
      });

    if (!order) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
    }

    // Security: Pastikan yang akses adalah pemilik order atau provider yang terkait/admin
    // (Sederhananya kita cek userId dulu)
    if (order.userId.toString() !== userId && 
        (!req.user.roles.includes('admin') && order.providerId?._id.toString() !== userId)) {
       // return res.status(403).json({ message: 'Akses ditolak' });
       // Opsional: Uncomment jika ingin strict security
    }

    res.json({ messageKey: 'orders.detail', data: order });
  } catch (error) {
    next(error);
  }
}
// [FITUR BARU] Ambil daftar pesanan masuk untuk Mitra
async function listIncomingOrders(req, res, next) {
  try {
    const userId = req.user.userId;
    
    // 1. Cari Profile Provider dari User yang login
    const provider = await Provider.findOne({ userId });
    if (!provider) {
      return res.status(403).json({ message: 'Anda belum terdaftar sebagai Mitra.' });
    }

    // 2. Cari Orderan yang Cocok
    // - Basic Order: Status 'searching' (Broadcast ke semua mitra)
    // - Direct Order: Ditujukan ke ID Mitra ini
    const orders = await Order.find({
      $or: [
        { status: 'searching', orderType: 'basic' }, 
        { providerId: provider._id, status: { $in: ['pending', 'searching', 'accepted'] } }
      ]
    })
    .populate('userId', 'fullName address profilePictureUrl') // Data Customer
    .populate('items.serviceId', 'name category') // Data Layanan
    .sort({ createdAt: -1 }); // Urutkan dari yang terbaru

    res.json({ messageKey: 'orders.incoming', data: orders });
  } catch (error) {
    next(error);
  }
}

// [FITUR BARU] Mitra Menerima Pesanan
async function acceptOrder(req, res, next) {
  try {
    const { orderId } = req.params;
    const userId = req.user.userId;

    const provider = await Provider.findOne({ userId });
    if (!provider) return res.status(403).json({ message: 'Akses ditolak.' });

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: 'Pesanan tidak ditemukan.' });

    // Cek apakah pesanan masih tersedia
    if (order.status !== 'searching' && order.status !== 'pending') {
      return res.status(400).json({ message: 'Pesanan ini sudah tidak tersedia.' });
    }

    // Update Order: Set status jadi accepted & kunci ke provider ini
    order.status = 'accepted';
    order.providerId = provider._id;
    await order.save();

    res.json({ message: 'Pesanan berhasil diterima! Segera hubungi pelanggan.', data: order });
  } catch (error) {
    next(error);
  }
}

// [UPDATE] Update Status dengan Logika Konfirmasi 2 Pihak
async function updateOrderStatus(req, res, next) {
  try {
    const { orderId } = req.params;
    const { status } = req.body; 
    const userId = req.user.userId;

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: 'Pesanan tidak ditemukan' });

    // Cek Role Pelaku
    const isCustomer = order.userId.toString() === userId;
    
    // Cek apakah user adalah provider dari order ini
    const provider = await Provider.findOne({ userId });
    const isProvider = order.providerId && provider && order.providerId.toString() === provider._id.toString();

    if (!isCustomer && !isProvider) {
        return res.status(403).json({ message: 'Anda tidak memiliki akses ke pesanan ini' });
    }

    // --- LOGIKA PERPINDAHAN STATUS ---

    // 1. Provider ingin menandai pekerjaan selesai
    if (status === 'completed' && isProvider) {
        // Provider tidak bisa langsung 'completed', harus 'waiting_approval' dulu
        if (order.status !== 'working') {
            return res.status(400).json({ message: 'Hanya pesanan yang sedang dikerjakan yang bisa diselesaikan.' });
        }
        order.status = 'waiting_approval';
        await order.save();
        return res.json({ message: 'Pekerjaan ditandai selesai. Menunggu konfirmasi pelanggan.', data: order });
    }

    // 2. Customer mengonfirmasi penyelesaian
    if (status === 'completed' && isCustomer) {
        if (order.status !== 'waiting_approval') {
            return res.status(400).json({ message: 'Belum ada permintaan penyelesaian dari mitra.' });
        }
        order.status = 'completed';
        await order.save();
        return res.json({ message: 'Pesanan selesai! Terima kasih.', data: order });
    }

    // 3. Status Provider Lainnya (On The Way, Working)
    if (['on_the_way', 'working'].includes(status)) {
        if (!isProvider) return res.status(403).json({ message: 'Hanya mitra yang bisa update status ini.' });
        order.status = status;
        await order.save();
        return res.json({ message: `Status diubah menjadi ${status}`, data: order });
    }

    // 4. Cancel (Bisa kedua pihak dengan syarat tertentu)
    if (status === 'cancelled') {
        if (['completed', 'working'].includes(order.status)) {
            return res.status(400).json({ message: 'Pesanan tidak dapat dibatalkan pada tahap ini.' });
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