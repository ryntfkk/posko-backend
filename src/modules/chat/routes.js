// src/modules/chat/routes.js
const express = require('express');
const controller = require('./controller');
const authenticate = require('../../middlewares/auth');

const router = express.Router();

// Semua route chat wajib login
router.use(authenticate);

// List semua chat room user
router.get('/', controller.listRooms);

// Detail chat room (Message History)
router.get('/:roomId', controller.getChatDetail);

// Mulai chat baru (Create Room)
router.post('/', controller.createRoom); 

module.exports = router;