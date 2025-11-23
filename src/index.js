// src/index.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http'); // [TAMBAHAN]
const env = require('./config/env');
const { i18nMiddleware } = require('./config/i18n');
const { initSocket } = require('./modules/chat/socket'); // [TAMBAHAN]

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
const server = http.createServer(app); // [TAMBAHAN] Bungkus app dengan HTTP Server

const PORT = env.port;

app.use(cors());
app.use(i18nMiddleware);
app.use(express.json());

app.get('/', (req, res) => {
  const messageKey = 'app.running';
  res.send(req.t(messageKey));
});

app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/providers', providerRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/services', serviceRoutes);

app.use(errorHandler);

// [TAMBAHAN] Inisialisasi Socket.io
initSocket(server);

const startServer = async () => {
  try {
    await mongoose.connect(env.mongoUri);
    console.log('✅ Berhasil terhubung ke MongoDB');

    // [PERBAIKAN] Gunakan server.listen, BUKAN app.listen
    server.listen(PORT, () => {
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