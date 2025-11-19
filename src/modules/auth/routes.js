const express = require('express');
const controller = require('./controller');
const { validateLogin, validateRegister } = require('./validators');

const router = express.Router();

router.post('/register', validateRegister, controller.register);
router.post('/login', validateLogin, controller.login);

module.exports = router;