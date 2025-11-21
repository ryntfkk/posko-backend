const express = require('express');
const controller = require('./controller');
const { validateCreateProvider } = require('./validators');

const router = express.Router();

// GET /api/providers/ (List semua)
router.get('/', controller.listProviders);

// GET /api/providers/:id (Detail satu provider) <-- TAMBAHKAN INI
router.get('/:id', controller.getProviderById);

// POST /api/providers/ (Daftar jadi provider)
router.post('/', validateCreateProvider, controller.createProvider);

module.exports = router;