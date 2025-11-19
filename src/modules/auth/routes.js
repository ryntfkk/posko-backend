const express = require('express');
const { validateBody } = require('../../middlewares/validator');
const controller = require('./controller');

const router = express.Router();

router.post('/register', validateBody(['fullName', 'email', 'password']), controller.register);
router.post('/login', validateBody(['email', 'password']), controller.login);

module.exports = router;