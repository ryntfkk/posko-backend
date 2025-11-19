const Chat = require('./model');

async function listRooms(req, res, next) {
  try {
    const rooms = await Chat.find();
    res.json({ message: 'Daftar ruang chat', data: rooms });
  } catch (error) {
    next(error);
  }
}

async function createRoom(req, res, next) {
  try {
    const { participants = [] } = req.body;
    const room = new Chat({ participants });
    await room.save();
    res.status(201).json({ message: 'Ruang chat dibuat', data: room });
  } catch (error) {
    next(error);
  }
}

module.exports = { listRooms, createRoom };