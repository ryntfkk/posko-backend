const express = require('express');
const controller = require('./controller');
const { validateLogin, validateRegister } = require('./validators');
const authenticate = require('../../middlewares/auth'); 

const router = express.Router();

router.post('/register', validateRegister, controller.register);
router.post('/login', validateLogin, controller.login);
router.get('/profile', authenticate, controller.getProfile);

// --- TAMBAHAN BARU ---
// Endpoint untuk mengganti role yang sedang aktif (Customer <-> Provider)
router.post('/switch-role', authenticate, controller.switchRole);

// Endpoint untuk mendaftar sebagai mitra (Menambah role 'provider')
router.post('/register-partner', authenticate, controller.registerPartner);

module.exports = router;