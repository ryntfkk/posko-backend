const express = require('express');
const controller = require('./controller');
const { validateCreateService } = require('./validators');
const authenticate = require('../../middlewares/auth');

const router = express.Router();

router.get('/seed-demo', controller.seedServices);
// Public: Siapa saja bisa lihat daftar layanan
router.get('/', controller.listServices);

// Private (Admin): Harus login & punya role admin untuk buat layanan
router.post('/', authenticate, validateCreateService, controller.createService);

module.exports = router;