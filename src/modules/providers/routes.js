// src/modules/providers/routes.js
const express = require('express');
const controller = require('./controller');
const { validateCreateProvider, validateUpdateAvailability } = require('./validators');
const authenticate = require('../../middlewares/auth');
const optionalAuthenticate = require('../../middlewares/optionalAuth'); // [BARU]

const router = express.Router();

// [UPDATE] Gunakan optionalAuthenticate agar Guest bisa akses
// GET /api/providers/ (List semua - Public/Private Hybrid)
router.get('/', optionalAuthenticate, controller.listProviders);

// GET /api/providers/me (Profil Saya - Private Provider)
router.get('/me', authenticate, controller.getProviderMe);

// GET /api/providers/:id (Detail satu provider - Public)
router.get('/:id', controller.getProviderById);

// POST /api/providers/ (Daftar jadi provider)
router.post('/', validateCreateProvider, controller.createProvider);

// PUT /api/providers/services (Update Services)
router.put('/services', authenticate, controller.updateProviderServices);

// PUT /api/providers/online-status (Toggle Online/Offline)
router.put('/online-status', authenticate, controller.toggleOnlineStatus);

// PUT /api/providers/profile (Update Alamat Operasional & Bio)
router.put('/profile', authenticate, controller.updateProviderProfile);

// PUT /api/providers/availability (Update Kalender Libur)
router.put('/availability', authenticate, validateUpdateAvailability, controller.updateAvailability);

// PUT /api/providers/portfolio (Update Portfolio Images)
router.put('/portfolio', authenticate, controller.updatePortfolio);

// PUT /api/providers/:id/verify (Admin Only: Verifikasi Mitra)
router.put('/:id/verify', authenticate, controller.verifyProvider);

module.exports = router;