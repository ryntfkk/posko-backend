// src/modules/chat/socket.js
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const Chat = require('./model');
const env = require('../../config/env');

let io;

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: "*", // Sesuaikan dengan URL frontend Anda di production
      methods: ["GET", "POST"]
    }
  });

  // Middleware Autentikasi Socket
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));

    try {
      const decoded = jwt.verify(token, env.jwtSecret);
      socket.user = decoded; // Simpan data user di socket
      next();
    } catch (err) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`⚡ User connected: ${socket.user.userId}`);

    // 1. Join Room (Setiap user punya room sendiri berdasarkan ID-nya untuk notifikasi pribadi)
    socket.join(socket.user.userId);

    // 2. Join Chat Room Spesifik
    socket.on('join_chat', (roomId) => {
      socket.join(roomId);
      console.log(`User ${socket.user.userId} joined room ${roomId}`);
    });

    // 3. Kirim Pesan
    socket.on('send_message', async (data) => {
      // data: { roomId, content, receiverId }
      try {
        const { roomId, content } = data;
        const senderId = socket.user.userId;

        // [FIX POINT 2] Validasi Kepemilikan Room (Security)
        // Cek apakah room ada DAN pengirim adalah partisipan yang sah
        const chatCheck = await Chat.findById(roomId);
        if (!chatCheck) {
          return console.error(`Chat room ${roomId} not found.`);
        }

        // Convert ID ke string untuk perbandingan yang aman
        const isParticipant = chatCheck.participants.some(
          p => p.toString() === senderId
        );

        if (!isParticipant) {
          console.error(`Unauthorized message attempt by ${senderId} to room ${roomId}`);
          // Opsional: Emit error event ke pengirim
          return socket.emit('error_message', { message: 'Anda bukan anggota percakapan ini.' });
        }

        // Simpan ke Database (Aman)
        const chat = await Chat.findByIdAndUpdate(
          roomId, 
          { 
            $push: { messages: { sender: senderId, content } } 
          },
          { new: true }
        ).populate('participants', 'fullName profilePictureUrl');

        // Broadcast pesan ke semua orang di room tersebut
        const newMessage = chat.messages[chat.messages.length - 1];
        
        // Kirim event 'receive_message' ke room
        io.to(roomId).emit('receive_message', {
          roomId,
          message: newMessage,
          senderName: socket.user.fullName // Opsional jika ada di token
        });

      } catch (error) {
        console.error("Error sending message:", error);
      }
    });

    socket.on('disconnect', () => {
      console.log('User disconnected');
    });
  });
}

module.exports = { initSocket };