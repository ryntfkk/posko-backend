const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const env = require('./config/env');
const { i18nMiddleware } = require('./config/i18n');
const { initSocket } = require('./modules/chat/socket');

// Import Routes
const reviewRoutes = require('./modules/reviews/routes');
const serviceRoutes = require('./modules/services/routes');
const authRoutes = require('./modules/auth/routes');
const orderRoutes = require('./modules/orders/routes');
const providerRoutes = require('./modules/providers/routes');
const paymentRoutes = require('./modules/payments/routes');
const chatRoutes = require('./modules/chat/routes');
const errorHandler = require('./middlewares/errorHandler');

const app = express();
const server = http.createServer(app);

// Railway memberikan PORT secara otomatis
const PORT = process.env.PORT || 3000;

// Izinkan akses dari mana saja
app.use(cors({
  origin: '*',
  credentials: true
}));

app.use(i18nMiddleware);
app.use(express.json());

// --- [BAGIAN PENTING] Health Check dengan Log ---
app.get('/', (req, res) => {
  // Log ini akan muncul setiap kali Railway melakukan pengecekan
  console.log('🔔 PING! Railway sedang mengecek kesehatan server...'); 
  
  const dbStatus = mongoose.connection.readyState === 1 ? 'Connected' : 'Connecting/Disconnected';
  res.status(200).send(`Posko Backend is Healthy! DB: ${dbStatus}`);
});

// Register Routes
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/providers', providerRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/services', serviceRoutes);

// Error Handler
app.use(errorHandler);

// Inisialisasi Socket.io
initSocket(server);

const startServer = async () => {
  // --- [STRATEGI BARU] Nyalakan Server DULUAN ---
  // Kita tidak menunggu DB connect dulu, agar Railway langsung mendeteksi server hidup.
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server SIAP & berjalan di port ${PORT} (Host: 0.0.0.0)`);
    console.log(`⏳ Sedang mencoba menghubungkan ke Database...`);
  });

  try {
    // Koneksi Database menyusul di belakang
    await mongoose.connect(env.mongoUri);
    console.log('✅ Berhasil terhubung ke MongoDB');
  } catch (err) {
    console.error('❌ Gagal terhubung ke MongoDB:', err);
    // Server tetap hidup agar Anda bisa melihat log errornya
  }
};

// Menangani error jika port sudah terpakai atau error lain
server.on('error', (err) => {
  console.error('❌ Server Error:', err);
});

startServer();