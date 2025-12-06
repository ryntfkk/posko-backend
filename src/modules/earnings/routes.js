// src/modules/earnings/routes.js
const express = require('express');
const controller = require('./controller');
const authenticate = require('../../middlewares/auth');

const router = express.Router();

router.use(authenticate);

// Provider Routes
router.get('/summary', controller.getEarningsSummary);
router.get('/', controller.listEarnings);

// Admin Routes (Harus ada validasi role di controller atau middleware tambahan)
router.get('/platform-stats', controller.getPlatformStats);
router.get('/all', controller.listAllEarnings);
router.patch('/:id/payout', controller.processPayout);

module.exports = router;