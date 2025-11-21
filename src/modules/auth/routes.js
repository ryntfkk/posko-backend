const express = require('express');
const controller = require('./controller');
const { validateLogin, validateRegister } = require('./validators');
const authenticate = require('../../middlewares/auth'); // IMPOR MIDDLEWARE AUTH

const router = express.Router();

router.post('/register', validateRegister, controller.register);
router.post('/login', validateLogin, controller.login);
router.get('/profile', authenticate, controller.getProfile);
module.exports = router;