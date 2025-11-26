// src/modules/auth/routes.js
const express = require('express');
const controller = require('./controller');
const { validateLogin, validateRegister } = require('./validators');
const authenticate = require('../../middlewares/auth');

const router = express.Router();

router.post('/register', validateRegister, controller.register);
router.post('/login', validateLogin, controller.login);
router.get('/profile', authenticate, controller.getProfile);

// --- ENDPOINT BARU: REFRESH ACCESS TOKEN ---
router.post('/refresh', controller.refreshAccessToken);

// --- ENDPOINT BARU: SWITCH ROLE ---
router.post('/switch-role', authenticate, controller.switchRole);

// --- ENDPOINT BARU: REGISTER PARTNER ---
router.post('/register-partner', authenticate, controller. registerPartner);

module.exports = router;