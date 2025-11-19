const express = require('express');
const { validateBody } = require('../../middlewares/validator');
const controller = require('./controller');

const router = express.Router();

router.get('/', controller.listRooms);
router.post('/', validateBody(['participants']), controller.createRoom);

module.exports = router;