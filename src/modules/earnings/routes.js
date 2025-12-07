// src/modules/earnings/routes.js
const express = require('express');
const controller = require('./controller');
const authenticate = require('../../middlewares/auth');
const { validatePayoutRequest } = require('./validators'); // [BARU]
const { runValidation } = require('../../middlewares/validator'); // [BARU]

const router = express.Router();

router.use(authenticate);

// Provider Routes
router.get('/summary', controller.getEarningsSummary);
router.get('/', controller.listEarnings); // Ini history earning per order

// [BARU] Payout Routes
router.post('/payout', validatePayoutRequest, runValidation, controller.requestPayout);
router.get('/payout/history', controller.listPayoutHistory);

// Admin Routes (Harus ada validasi role di controller atau middleware tambahan)
router.get('/platform-stats', controller.getPlatformStats);
router.get('/all', controller.listAllEarnings);
router.patch('/:id/payout', controller.processPayout); // Legacy manual payout per order (opsional, bisa dipertahankan atau diganti logic baru)

module.exports = router;