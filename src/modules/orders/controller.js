const Order = require('./model');
const Provider = require('../providers/model');

// 1. LIST ALL ORDERS (Untuk tab "Pesanan Saya" Customer & history Provider)
async function listOrders(req, res, next) {
  try {
    const { roles = [], userId } = req.user || {};
    const { view } = req.query; // Baca parameter 'view' ('customer' atau 'provider')
    
    let filter = { userId }; // Default: Filter berdasarkan User ID (Mode Customer/Pembeli)

    // Logika: Hanya ubah filter ke Provider ID JIKA view='provider' DAN user punya role provider
    if (view === 'provider' && roles.includes('provider')) {
      // Cari ID Provider berdasarkan User ID
      const provider = await Provider.findOne({ userId });
      
      if (provider) {
        // Mode Provider: Melihat orderan yang masuk ke dia (sebagai penjual)
        filter = { providerId: provider._id };
      } else {
        return res.json({ messageKey: 'orders.list', data: [] });
      }
    } 
    
    // Admin bisa melihat semua jika tidak ada view spesifik
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
    // Cari order berdasarkan ID
    const order = await Order.findById(orderId)
      .populate('items.serviceId', 'name iconUrl') // Ambil detail service
      .populate('providerId', 'userId rating isOnline') // Ambil info provider (jika ada)
      .populate({
         path: 'providerId',
         populate: { path: 'userId', select: 'fullName phoneNumber profilePictureUrl' }
      })
      .populate('userId', 'fullName phoneNumber address location profilePictureUrl'); // Tambahan info customer

    if (!order) {
      return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
    }

    res.json({ message: 'Detail pesanan ditemukan', data: order });
  } catch (error) {
    next(error);
  }
}

// 4. [PERBAIKAN] LIST INCOMING ORDERS (Untuk Dashboard Provider "Masuk")
async function listIncomingOrders(req, res, next) {
  try {
    const userId = req.user.userId;
    
    // a. Cari Data Provider & Services-nya
    const provider = await Provider.findOne({ userId });
    if (!provider) {
      return res.status(403).json({ message: 'Anda belum terdaftar sebagai Mitra.' });
    }

    // b. Ambil daftar ID Service yang dimiliki Provider (Hanya yang statusnya Active)
    const myServiceIds = provider.services
      .filter(s => s.isActive)
      .map(s => s.serviceId);

    // c. Query Order dengan Logika OR
    const orders = await Order.find({
      $or: [
        // KONDISI A: Basic Order (Broadcast ke yang punya skill sesuai)
        { 
          orderType: 'basic', 
          status: { $in: ['searching'] }, // Terima pending & searching
          providerId: null, // Belum diambil siapapun
          'items.serviceId': { $in: myServiceIds } // Filter skill
        },

        // KONDISI B: Direct Order (Khusus ditujukan ke Provider ini)
        { 
          providerId: provider._id, 
          status: { $in: ['on_the_way', 'working', 'waiting_approval'] } 
        }
      ]
    })
    // Populate data Customer & Service agar lengkap di Frontend
    .populate('userId', 'fullName address location profilePictureUrl phoneNumber') 
    .populate('items.serviceId', 'name category iconUrl')
    .sort({ createdAt: -1 }); 

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

// 6. UPDATE ORDER STATUS
async function updateOrderStatus(req, res, next) {
  try {
    const { orderId } = req.params;
    const { status } = req.body; 
    const userId = req.user.userId;

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: 'Pesanan tidak ditemukan' });

    // Cek Role Pelaku
    const isCustomer = order.userId.toString() === userId;
    const provider = await Provider.findOne({ userId });
    const isProvider = order.providerId && provider && order.providerId.toString() === provider._id.toString();

    if (!isCustomer && !isProvider) {
        return res.status(403).json({ message: 'Anda tidak memiliki akses ke pesanan ini' });
    }

    // --- LOGIKA PERPINDAHAN STATUS ---

    // 1. Provider ingin menandai pekerjaan selesai
    if (status === 'completed' && isProvider) {
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

    // 4. Cancel
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