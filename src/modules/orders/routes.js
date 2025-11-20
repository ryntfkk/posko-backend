const express = require('express');
const controller = require('./controller');
const { validateCreateOrder } = require('./validators');
const authenticate = require('../../middlewares/auth');

const router = express.Router();

router.use(authenticate);

router.get('/', controller.listOrders);
router.post('/', validateCreateOrder, controller.createOrder);

module.exports = router;