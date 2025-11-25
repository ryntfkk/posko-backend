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

// Izinkan akses dari mana saja
app.use(cors({
  origin: '*',
  credentials: true
}));

app.use(i18nMiddleware);
app.use(express.json());

// --- HEALTH CHECK ---
// Ini endpoint yang dicari Railway
app.get('/', (req, res) => {
  console.log('🔔 PING! Railway Health Check Masuk!');
  res.status(200).send('Posko Backend is Running!');
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
  // [PERBAIKAN FINAL]
  // 1. Gunakan '0.0.0.0' agar bisa diakses dari luar container
  // 2. Server menyala DULUAN sebelum Database, biar Railway tidak timeout
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server SIAP (0.0.0.0) di Port ${PORT}`);
    console.log('⏳ Menunggu koneksi Database...');
  });

  try {
    await mongoose.connect(env.mongoUri);
    console.log('✅ Database Terhubung');
  } catch (err) {
    console.error('❌ Database Gagal:', err.message);
  }
};

server.on('error', (err) => console.error('❌ Server Error:', err));

startServer();