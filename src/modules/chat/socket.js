// src/modules/chat/socket.js
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const Chat = require('./model');
const env = require('../../config/env');

let io;

function initSocket(httpServer) {
  // [UPDATED] Menggunakan env.corsOrigins daripada wildcard "*"
  // Ini memperbaiki error CORS saat withCredentials: true diaktifkan di frontend
  io = new Server(httpServer, {
    cors: {
      origin: env.corsOrigins, // Mengambil array origin yang diizinkan dari env.js
      methods: ["GET", "POST"],
      credentials: true // Wajib true agar sesuai dengan setting frontend
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
      // data: { roomId, content, attachment? }
      try {
        const { roomId, content, attachment } = data; // [UPDATED] Ambil attachment
        const senderId = socket.user.userId;

        // Validasi Kepemilikan Room (Security)
        const chatCheck = await Chat.findById(roomId);
        if (!chatCheck) {
          return console.error(`Chat room ${roomId} not found.`);
        }

        const isParticipant = chatCheck.participants.some(
          p => p.toString() === senderId
        );

        if (!isParticipant) {
          return socket.emit('error_message', { message: 'Anda bukan anggota percakapan ini.' });
        }

        // Siapkan Payload Pesan
        const messagePayload = {
            sender: senderId,
            content: content || '',
            attachment: attachment || null // [UPDATED] Simpan attachment
        };

        // Simpan ke Database
        const chat = await Chat.findByIdAndUpdate(
          roomId, 
          { 
            $push: { messages: messagePayload } 
          },
          { new: true }
        ).populate('participants', 'fullName profilePictureUrl');

        // Broadcast pesan
        const newMessage = chat.messages[chat.messages.length - 1];
        
        io.to(roomId).emit('receive_message', {
          roomId,
          message: newMessage,
          senderName: socket.user.fullName
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

function getIO() {
  if (!io) {
    console.warn("⚠️ Socket.io not initialized!");
    return null;
  }
  return io;
}

module.exports = { initSocket, getIO };