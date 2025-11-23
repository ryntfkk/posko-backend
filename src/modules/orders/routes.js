const express = require('express');
const controller = require('./controller');
const { validateCreateOrder } = require('./validators');
const authenticate = require('../../middlewares/auth');

const router = express.Router();

router.use(authenticate);

router.get('/incoming', controller.listIncomingOrders);
router.patch('/:orderId/accept', controller.acceptOrder); 
router.patch('/:orderId/status', controller.updateOrderStatus);

router.get('/', controller.listOrders);
router.get('/:orderId', controller.getOrderById); 
router.post('/', validateCreateOrder, controller.createOrder);

module.exports = router;