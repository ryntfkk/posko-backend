const express = require('express');
const controller = require('./controller');
const { validateCreateRoom } = require('./validators');

const router = express.Router();

router.get('/', controller.listRooms);
router.post('/', validateCreateRoom, controller.createRoom);

module.exports = router;