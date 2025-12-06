// src/modules/providers/routes.js
const express = require('express');
const controller = require('./controller');
const { validateCreateProvider, validateUpdateAvailability } = require('./validators');
const authenticate = require('../../middlewares/auth');

const router = express.Router();

// PUT /api/providers/services (Update Services)
router.put('/services', authenticate, controller.updateProviderServices);

// PUT /api/providers/online-status (Toggle Online/Offline)
router.put('/online-status', authenticate, controller.toggleOnlineStatus);

// [BARU] PUT /api/providers/profile (Update Alamat Operasional & Bio)
router.put('/profile', authenticate, controller.updateProviderProfile);

// GET /api/providers/ (List semua - Public)
router.get('/', controller.listProviders);

// GET /api/providers/me (Profil Saya - Private Provider)
router.get('/me', authenticate, controller.getProviderMe);

// PUT /api/providers/availability (Update Kalender Libur)
router.put('/availability', authenticate, validateUpdateAvailability, controller.updateAvailability);

// PUT /api/providers/portfolio (Update Portfolio Images)
router.put('/portfolio', authenticate, controller.updatePortfolio);

// GET /api/providers/:id (Detail satu provider - Public)
router.get('/:id', controller.getProviderById);

// POST /api/providers/ (Daftar jadi provider)
router.post('/', validateCreateProvider, controller.createProvider);

router.put('/:id/verify', authenticate, controller.verifyProvider);
module.exports = router;