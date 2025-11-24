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

// Health Check (Penting!)
app.get('/', (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'Connected' : 'Connecting/Disconnected';
  res.status(200).send(`Posko Backend Running! DB: ${dbStatus}`);
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

// --- PERUBAHAN PENTING DI SINI ---

// 1. Nyalakan Server SEGERA (Jangan tunggu DB)
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server SIAP & berjalan di port ${PORT}`);
});

// 2. Koneksi Database di Latar Belakang
mongoose.connect(env.mongoUri)
  .then(() => console.log('✅ Berhasil terhubung ke MongoDB (Menyusul)'))
  .catch((err) => {
    console.error('❌ Gagal terhubung ke MongoDB:', err);
    // Jangan process.exit(1) agar server tetap hidup untuk debugging
  });

// Handle error server jika ada
server.on('error', (err) => {
  console.error('❌ Server Error:', err);
});