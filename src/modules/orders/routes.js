const express = require('express');
const { validateBody } = require('../../middlewares/validator');
const controller = require('./controller');

const router = express.Router();

router.get('/', controller.listOrders);
router.post('/', validateBody(['userId']), controller.createOrder);

module.exports = router;