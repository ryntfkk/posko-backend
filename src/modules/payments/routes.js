const express = require('express');
const controller = require('./controller');
const { validateCreatePayment } = require('./validators');

const router = express.Router();

router.get('/', controller.listPayments);
router.post('/', validateCreatePayment, controller.createPayment);

module.exports = router;