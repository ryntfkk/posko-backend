const Chat = require('./model');

async function listRooms(req, res, next) {
  try {
    const rooms = await Chat.find();
    const messageKey = 'chat.list';
    res.json({ messageKey, message: req.t(messageKey), data: rooms });
  } catch (error) {
    next(error);
  }
}

async function createRoom(req, res, next) {
  try {
    const { participants = [] } = req.body;
    const room = new Chat({ participants });
    await room.save();
    const messageKey = 'chat.created';
    res.status(201).json({ messageKey, message: req.t(messageKey), data: room });
  } catch (error) {
    next(error);
  }
}

module.exports = { listRooms, createRoom };