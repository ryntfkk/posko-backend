const express = require('express');
const controller = require('./controller');
const { validateCreateProvider, validateUpdateSchedule } = require('./validators');
const authenticate = require('../../middlewares/auth'); // Import Middleware Auth

const router = express.Router();

// GET /api/providers/ (List semua - Public)
router.get('/', controller.listProviders);

// PUT /api/providers/schedule (Update Jadwal - Private Provider)
// Wajib ditaruh SEBELUM /:id agar tidak dianggap sebagai ID "schedule"
router.put('/schedule', authenticate, validateUpdateSchedule, controller.updateSchedule);

// GET /api/providers/:id (Detail satu provider - Public)
router.get('/:id', controller.getProviderById);

// POST /api/providers/ (Daftar jadi provider - Public/Private logic di controller)
router.post('/', validateCreateProvider, controller.createProvider);

module.exports = router;