const express = require('express');
const controller = require('./controller');
const authenticate = require('../../middlewares/auth');

const router = express.Router();

// Semua route di bawah ini membutuhkan login (Provider)
router.use(authenticate);

// GET /api/earnings/summary - Ambil ringkasan statistik
router.get('/summary', controller.getEarningsSummary);

// GET /api/earnings - Ambil list riwayat
router.get('/', controller.listEarnings);

router.get('/platform-stats', authenticate, controller.getPlatformStats);
module.exports = router;