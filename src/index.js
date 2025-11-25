const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http'); // Tetap butuh untuk local dev
const env = require('./config/env');
const { i18nMiddleware } = require('./config/i18n');
// Socket tetap diimport supaya tidak error, walau tidak jalan di Vercel
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

// Konfigurasi CORS (Penting agar Frontend Vercel bisa akses)
app.use(cors({
  origin: '*', // Di production sebaiknya ganti dengan URL Frontend
  credentials: true
}));

app.use(i18nMiddleware);
app.use(express.json());

// Health Check
app.get('/', (req, res) => {
  res.status(200).send('Posko Backend Vercel is Running!');
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

// --- LOGIKA KONEKSI DATABASE (SERVERLESS FRIENDLY) ---
// Di Vercel, kita taruh koneksi di luar handler agar bisa di-cache (reuse)
let isConnected = false;

const connectDB = async () => {
  if (isConnected) return;
  try {
    await mongoose.connect(env.mongoUri);
    isConnected = true;
    console.log('✅ Database Terhubung (Vercel/Local)');
  } catch (err) {
    console.error('❌ Gagal koneksi DB:', err);
  }
};

// Panggil koneksi DB
connectDB();

// --- EKSPOR APLIKASI UNTUK VERCEL ---
module.exports = app;

// --- JALANKAN SERVER UNTUK LOCALHOST SAJA ---
// Kode di bawah ini HANYA jalan kalau dijalankan di laptop (node src/index.js)
// Di Vercel, kode di bawah ini akan diabaikan (karena require.main !== module)
if (require.main === module) {
  const server = http.createServer(app);
  const PORT = process.env.PORT || 3000;
  
  // Socket hanya jalan di local
  initSocket(server);

  server.listen(PORT, () => {
    console.log(`🚀 Server Local berjalan di port ${PORT}`);
  });
}