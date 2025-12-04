const express = require('express');
const controller = require('./controller');
const { validateCreateService } = require('./validators');
const authenticate = require('../../middlewares/auth');

const router = express.Router();

// Public: Siapa saja bisa lihat daftar layanan
router.get('/', controller.listServices);

// Private (Admin): Harus login & punya role admin untuk buat layanan
router.post('/', authenticate, validateCreateService, controller.createService);
router.put('/:id', authenticate, controller.updateService);
router.delete('/:id', authenticate, controller.deleteService);
module.exports = router;