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

// 2. CREATE ORDER
async function createOrder(req, res, next) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { providerId, items = [], totalAmount = 0, orderType } = req.body;
    const order = new Order({ userId, providerId, items, totalAmount, orderType });
    
    await order.save();
    res.status(201).json({ message: 'Pesanan berhasil dibuat', data: order });
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
      .populate('userId', 'fullName phoneNumber address location profilePictureUrl');

    if (!order) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
    }
    res.json({ message: 'Detail pesanan ditemukan', data: order });
  } catch (error) {
    next(error);
  }
}

// 4. [PERBAIKAN] LIST INCOMING ORDERS
// Menampilkan order di tab "Masuk" Provider
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
        // KONDISI A: Basic Order
        { 
          orderType: 'basic', 
          status: 'searching', // Hanya yang sudah dibayar dan mencari mitra
          providerId: null, 
          'items.serviceId': { $in: myServiceIds } 
        },

        // KONDISI B: Direct Order (Khusus Mitra Ini)
        { 
          providerId: provider._id,
          // [FIX] Tampilkan status 'paid' agar Provider bisa konfirmasi (Terima/Tolak)
          status: { $in: ['paid'] } 
        }
      ]
    })
    .populate('userId', 'fullName address location profilePictureUrl phoneNumber') 
    .populate('items.serviceId', 'name category iconUrl')
    .sort({ createdAt: -1 }); 

    res.json({ message: 'Daftar order masuk berhasil diambil', data: orders });
  } catch (error) {
    next(error);
  }
}

// 5. [PERBAIKAN] ACCEPT ORDER
async function acceptOrder(req, res, next) {
  try {
    const { orderId } = req.params;
    const userId = req.user.userId;

    const provider = await Provider.findOne({ userId });
    if (!provider) return res.status(403).json({ message: 'Akses ditolak.' });

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: 'Pesanan tidak ditemukan.' });

    // [FIX] Izinkan provider menerima order yang statusnya 'paid' (Direct) atau 'searching' (Basic)
    // 'pending' diizinkan jika Anda mau fitur COD kedepannya, tapi standard flow payment gateway adalah 'paid'
    if (!['searching', 'pending', 'paid'].includes(order.status)) {
      return res.status(400).json({ message: 'Pesanan ini sudah tidak tersedia atau sudah diambil.' });
    }

    // Update Order
    order.status = 'accepted';
    order.providerId = provider._id; // Pastikan terkunci ke provider ini
    await order.save();

    res.json({ message: 'Pesanan berhasil diterima! Segera hubungi pelanggan.', data: order });
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
    if (!order) return res.status(404).json({ message: 'Pesanan tidak ditemukan' });

    const isCustomer = order.userId.toString() === userId;
    const provider = await Provider.findOne({ userId });
    const isProvider = order.providerId && provider && order.providerId.toString() === provider._id.toString();

    if (!isCustomer && !isProvider) {
        return res.status(403).json({ message: 'Anda tidak memiliki akses ke pesanan ini' });
    }

    // --- LOGIKA PERPINDAHAN STATUS ---

    // 1. Provider Selesai Kerja
    if (status === 'completed' && isProvider) {
        if (order.status !== 'working') {
            return res.status(400).json({ message: 'Hanya pesanan yang sedang dikerjakan yang bisa diselesaikan.' });
        }
        order.status = 'waiting_approval';
        await order.save();
        return res.json({ message: 'Pekerjaan ditandai selesai. Menunggu konfirmasi pelanggan.', data: order });
    }

    // 2. Customer Konfirmasi Selesai
    if (status === 'completed' && isCustomer) {
        if (order.status !== 'waiting_approval') {
            return res.status(400).json({ message: 'Belum ada permintaan penyelesaian dari mitra.' });
        }
        order.status = 'completed';
        await order.save();
        return res.json({ message: 'Pesanan selesai! Terima kasih.', data: order });
    }

    // 3. Status Progres (On The Way, Working)
    if (['on_the_way', 'working'].includes(status)) {
        if (!isProvider) return res.status(403).json({ message: 'Hanya mitra yang bisa update status ini.' });
        order.status = status;
        await order.save();
        return res.json({ message: `Status diubah menjadi ${status}`, data: order });
    }

    // 4. Cancel
    if (status === 'cancelled') {
        if (['completed', 'working', 'waiting_approval'].includes(order.status)) {
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