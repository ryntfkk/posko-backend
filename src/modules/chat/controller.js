// src/modules/chat/controller.js
const Chat = require('./model');
const User = require('../../models/User'); // Pastikan path sesuai

// List semua room chat milik user
async function listRooms(req, res, next) {
  try {
    const userId = req.user.userId;
    
    // Cari chat di mana user menjadi salah satu participant
    const rooms = await Chat.find({ participants: userId })
      .populate('participants', 'fullName profilePictureUrl activeRole') // Ambil info lawan bicara
      .sort({ updatedAt: -1 }); // Urutkan dari yang terbaru

    res.json({ messageKey: 'chat.list', message: 'List chat berhasil', data: rooms });
  } catch (error) {
    next(error);
  }
}

// Buat Room Baru (atau kembalikan yang sudah ada)
async function createRoom(req, res, next) {
  try {
    const userId = req.user.userId;
    const { targetUserId } = req.body; // ID Lawan Bicara

    if (!targetUserId) return res.status(400).json({ message: 'Target User ID required' });

    // Cek apakah sudah ada chat room antara dua orang ini
    let chat = await Chat.findOne({
      participants: { $all: [userId, targetUserId] }
    }).populate('participants', 'fullName profilePictureUrl');

    if (!chat) {
      chat = new Chat({ participants: [userId, targetUserId], messages: [] });
      await chat.save();
      await chat.populate('participants', 'fullName profilePictureUrl');
    }

    res.status(201).json({ messageKey: 'chat.created', message: 'Room siap', data: chat });
  } catch (error) {
    next(error);
  }
}

// [TAMBAHAN] Ambil detail pesan dalam satu room
async function getChatDetail(req, res, next) {
  try {
    const { roomId } = req.params;
    const chat = await Chat.findById(roomId)
        .populate('participants', 'fullName profilePictureUrl')
        .populate('messages.sender', 'fullName'); // Populate pengirim pesan
    
    if (!chat) return res.status(404).json({ message: 'Chat not found' });

    res.json({ message: 'Detail chat', data: chat });
  } catch (error) {
    next(error);
  }
}

module.exports = { listRooms, createRoom, getChatDetail };