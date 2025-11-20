const express = require('express');
const controller = require('./controller');
const { validateCreatePayment } = require('./validators');

const router = express.Router();

router.get('/', controller.listPayments);
const { validateCreatePayment } = require('./validators');

module.exports = router;