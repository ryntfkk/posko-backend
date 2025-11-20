const express = require('express');
const controller = require('./controller');
const { validateCreateOrder } = require('./validators');

const router = express.Router();

router.get('/', controller.listOrders);
router.post('/', validateCreateOrder, controller.createOrder);

module.exports = router;