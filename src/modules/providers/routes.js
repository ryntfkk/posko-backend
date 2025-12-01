// src/modules/providers/routes.js
const express = require('express');
const controller = require('./controller');
const { validateCreateProvider, validateUpdateAvailability } = require('./validators');
const authenticate = require('../../middlewares/auth');

const router = express.Router();

// PUT /api/providers/services (Update Services)
router.put('/services', authenticate, controller.updateProviderServices);

// --- TAMBAHKAN BARIS INI ---
// PUT /api/providers/online-status (Toggle Online/Offline)
router.put('/online-status', authenticate, controller.toggleOnlineStatus);

// GET /api/providers/ (List semua - Public)
router.get('/', controller.listProviders);

// GET /api/providers/me (Profil Saya - Private Provider)
router.get('/me', authenticate, controller.getProviderMe);

// PUT /api/providers/availability (Update Kalender Libur)
router.put('/availability', authenticate, validateUpdateAvailability, controller.updateAvailability);

// PUT /api/providers/portfolio (Update Portfolio Images)
router.put('/portfolio', authenticate, controller.updatePortfolio);

// PUT /api/providers/services (Update Services)
router.put('/services', authenticate, controller.updateProviderServices);

// GET /api/providers/:id (Detail satu provider - Public)
router.get('/:id', controller.getProviderById);

// POST /api/providers/ (Daftar jadi provider)
router.post('/', validateCreateProvider, controller.createProvider);

module.exports = router;