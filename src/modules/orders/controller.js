const Order = require('./model');

async function listOrders(req, res, next) {
  try {
    const orders = await Order.find();
    res.json({ message: 'Daftar pesanan', data: orders });
  } catch (error) {
    next(error);
  }
}

async function createOrder(req, res, next) {
  try {
    const { userId, items = [], totalAmount = 0 } = req.body;
    const order = new Order({ userId, items, totalAmount });
    await order.save();
    res.status(201).json({ message: 'Pesanan dibuat', data: order });
  } catch (error) {
    next(error);
  }
}

module.exports = { listOrders, createOrder };