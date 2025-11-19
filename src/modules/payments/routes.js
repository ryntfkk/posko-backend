const express = require('express');
const { validateBody } = require('../../middlewares/validator');
const controller = require('./controller');

const router = express.Router();

router.get('/', controller.listPayments);
router.post('/', validateBody(['orderId', 'amount']), controller.createPayment);

module.exports = router;