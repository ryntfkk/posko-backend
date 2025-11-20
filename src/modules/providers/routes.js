const express = require('express');
const controller = require('./controller');
const { validateCreateProvider } = require('./validators');

const router = express.Router();

router.get('/', controller.listProviders);
router.post('/', validateCreateProvider, controller.createProvider);

module.exports = router;