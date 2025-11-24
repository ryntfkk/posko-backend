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

// Gunakan PORT dari Railway
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: '*',
  credentials: true
}));

app.use(i18nMiddleware);
app.use(express.json());

// --- HEALTH CHECK SEDERHANA ---
app.get('/', (req, res) => {
  console.log(`[${new Date().toISOString()}] 🔔 PING DITERIMA!`);
  res.status(200).send('Posko Backend OK');
});

// Register Routes
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/providers', providerRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/services', serviceRoutes);

app.use(errorHandler);
initSocket(server);

const startServer = async () => {
  // 1. NYALAKAN SERVER (Tanpa Host Binding Spesifik)
  // Hapus '0.0.0.0' agar support IPv4 & IPv6
  server.listen(PORT, () => {
    console.log(`✅ SERVER AKTIF (Mode Auto-Binding) di Port ${PORT}`);
  });

  // 2. Koneksi Database (Non-Blocking)
  try {
    await mongoose.connect(env.mongoUri);
    console.log('✅ Database Terhubung');
  } catch (err) {
    console.error('❌ Database Gagal:', err.message);
    // Server tetap jalan walau DB error, agar bisa dicek log-nya
  }
};

server.on('error', (err) => console.error('❌ Server Error:', err));

startServer();