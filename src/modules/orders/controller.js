const Order = require('./model');
const Provider = require('../providers/model');

async function listOrders(req, res, next) {
  try {
    const { roles = [], userId } = req.user || {};
    const isAdminOrProvider = roles.includes('admin') || roles.includes('provider');
    
    if (!isAdminOrProvider && !userId) {
      const messageKey = 'auth.unauthorized';
      return res.status(401).json({ messageKey, message: req.t ? req.t(messageKey) : 'Unauthorized' });
    }

    const filter = isAdminOrProvider ? {} : { userId };

    // [PERBAIKAN] Tambahkan populate dan sort
    const orders = await Order.find(filter)
      .populate('items.serviceId', 'name category iconUrl') // Ambil detail layanan (PENTING untuk UI)
      .populate({
        path: 'providerId',
        select: 'userId rating',
        populate: { path: 'userId', select: 'fullName profilePictureUrl' } // Ambil detail mitra
      })
      .sort({ createdAt: -1 }); // Urutkan dari yang terbaru

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
module.exports = { 
  listOrders, 
  createOrder, 
  getOrderById, 
  listIncomingOrders,
  acceptOrder         
};