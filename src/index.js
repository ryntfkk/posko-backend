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

// Railway memberikan PORT secara otomatis di process.env.PORT
const PORT = process.env.PORT || 3000;

// Izinkan akses dari mana saja
app.use(cors({
  origin: '*',
  credentials: true
}));

app.use(i18nMiddleware);
app.use(express.json());

// Health Check Endpoint (Wajib ada di root '/')
app.get('/', (req, res) => {
  res.status(200).send('Posko Backend API is Running!');
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

// --- BAGIAN YANG DIPERBAIKI ---
// Hapus '0.0.0.0' agar Node.js bisa menerima IPv4 DAN IPv6
server.listen(PORT, () => {
  console.log(`🚀 Server berjalan di port ${PORT}`);
});

// Koneksi Database di Latar Belakang (Non-blocking)
mongoose.connect(env.mongoUri)
  .then(() => console.log('✅ Berhasil terhubung ke MongoDB'))
  .catch((err) => console.error('❌ Gagal koneksi DB:', err));

server.on('error', (err) => console.error('❌ Server Error:', err));