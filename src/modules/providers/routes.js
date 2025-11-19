const express = require('express');
const { validateBody } = require('../../middlewares/validator');
const controller = require('./controller');

const router = express.Router();

router.get('/', controller.listProviders);
router.post('/', validateBody(['userId']), controller.createProvider);

module.exports = router;