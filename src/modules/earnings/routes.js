const express = require('express');
const controller = require('./controller');
const authenticate = require('../../middlewares/auth');

const router = express.Router();

router.use(authenticate);

// Provider Routes
router.get('/summary', controller.getEarningsSummary);
router.get('/', controller.listEarnings);

// Admin Routes
router.get('/platform-stats', authenticate, controller.getPlatformStats);
// [BARU] Route untuk manajemen pencairan
router.get('/all', authenticate, controller.listAllEarnings);
router.patch('/:id/payout', authenticate, controller.processPayout);

module.exports = router;