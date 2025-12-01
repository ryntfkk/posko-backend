const express = require('express');
const router = express.Router();
const controller = require('./controller');
const { authenticate } = require('../../middlewares/auth');

// Public access untuk get config (agar frontend bisa mengambil adminFee)
router.get('/', controller.getGlobalConfig);

// Protected access untuk update (hanya untuk admin)
router.put('/', authenticate, controller.updateGlobalConfig);

module.exports = router;