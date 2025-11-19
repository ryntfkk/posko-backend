const Order = require('./model');

async function listOrders(req, res, next) {
  try {
    const orders = await Order.find();
    const messageKey = 'orders.list';
    res.json({ messageKey, message: req.t(messageKey), data: orders });
  } catch (error) {
    next(error);
  }
}

async function createOrder(req, res, next) {
  try {
    const { userId, items = [], totalAmount = 0 } = req.body;
    const order = new Order({ userId, items, totalAmount });
    await order.save();
    const messageKey = 'orders.created';
    res.status(201).json({ messageKey, message: req.t(messageKey), data: order });
  } catch (error) {
    next(error);
  }
}

module.exports = { listOrders, createOrder };