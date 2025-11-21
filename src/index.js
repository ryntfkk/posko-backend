// 1. Import library yang dibutuhkan
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const env = require('./config/env');
const { i18nMiddleware } = require('./config/i18n');
const reviewRoutes = require('./modules/reviews/routes');
const serviceRoutes = require('./modules/services/routes');
const authRoutes = require('./modules/auth/routes');
const orderRoutes = require('./modules/orders/routes');
const providerRoutes = require('./modules/providers/routes');
const paymentRoutes = require('./modules/payments/routes');
const chatRoutes = require('./modules/chat/routes');
const errorHandler = require('./middlewares/errorHandler');

// 3. Inisialisasi aplikasi Express
const app = express();
const PORT = env.port;

// 4. Middleware (agar server bisa baca data JSON)
app.use(cors());
app.use(i18nMiddleware);
app.use(express.json()); // [cite: 109]

// 5. Route Test Sederhana (untuk cek server hidup)
app.get('/', (req, res) => {
  const messageKey = 'app.running';
  res.send(req.t(messageKey)); // [cite: 111]
});

// 6. Registrasi router modular
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/providers', providerRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/services', serviceRoutes);

// 7. Middleware error handler
app.use(errorHandler);

// 8. Koneksi ke MongoDB & Menjalankan Server
const startServer = async () => {
  try {
    await mongoose.connect(env.mongoUri);
    console.log('✅ Berhasil terhubung ke MongoDB');

      const server = app.listen(PORT, () => {
      console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
    });

    server.on('error', (err) => {
      console.error('❌ Server gagal diinisialisasi:', err);
    });
  } catch (err) {
    console.error('❌ Gagal terhubung ke MongoDB:', err);
    process.exit(1);
  }
};

startServer();