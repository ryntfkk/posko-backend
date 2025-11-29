const express = require('express');
const controller = require('./controller');
const { validateLogin, validateRegister, validateRefreshToken } = require('./validators');
const authenticate = require('../../middlewares/auth'); 

const router = express.Router();

// Public routes
router.post('/register', validateRegister, controller.register);
router.post('/login', validateLogin, controller.login);
router.post('/refresh-token', validateRefreshToken, controller.refreshToken); // [NEW]

// Protected routes
router.get('/profile', authenticate, controller.getProfile);
router.post('/logout', authenticate, controller.logout); // [NEW]
router.post('/switch-role', authenticate, controller.switchRole);
router.post('/register-partner', authenticate, controller.registerPartner);

module.exports = router;