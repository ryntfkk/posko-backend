const express = require('express');
const controller = require('./controller');
const { validateCreateRoom } = require('./validators');
const authenticate = require('../../middlewares/auth');

const router = express.Router();

router.use(authenticate);

router.get('/', controller.listRooms);
router.get('/:roomId', controller.getChatDetail);
router.post('/', validateCreateRoom, controller.createRoom);

module.exports = router;