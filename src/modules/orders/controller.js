const Order = require('./model');

async function listOrders(req, res, next) {
  try {
    const { roles = [], userId } = req.user || {};
    const isAdminOrProvider = roles.includes('admin') || roles.includes('provider');
    if (!isAdminOrProvider && !userId) {
      const messageKey = 'auth.unauthorized';
      return res.status(401).json({ messageKey, message: req.t ? req.t(messageKey) : 'Unauthorized' });
    }

    const filter = isAdminOrProvider ? {} : { userId };

    const orders = await Order.find(filter);
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

module.exports = { listOrders, createOrder };