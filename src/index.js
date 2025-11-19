// 1. Import library yang dibutuhkan
const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');

const authRoutes = require('./modules/auth/routes');
const orderRoutes = require('./modules/orders/routes');
const providerRoutes = require('./modules/providers/routes');
const paymentRoutes = require('./modules/payments/routes');
const chatRoutes = require('./modules/chat/routes');
const reviewRoutes = require('./modules/reviews/routes');
const errorHandler = require('./middlewares/errorHandler');

// 2. Konfigurasi environment (membaca file .env)
dotenv.config();

// 3. Inisialisasi aplikasi Express
const app = express();
const PORT = process.env.PORT || 3000;

// 4. Middleware (agar server bisa baca data JSON)
app.use(cors());
app.use(express.json()); // [cite: 109]

// 5. Route Test Sederhana (untuk cek server hidup)
app.get('/', (req, res) => {
  res.send('API Posko Backend Berjalan!'); // [cite: 111]
});

// 6. Registrasi router modular
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/providers', providerRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/reviews', reviewRoutes);

// 7. Middleware error handler
app.use(errorHandler);

// 8. Koneksi ke MongoDB & Menjalankan Server
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ Berhasil terhubung ke MongoDB');

    // Jalankan server hanya jika DB sudah connect
    app.listen(PORT, () => {
      console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ Gagal terhubung ke MongoDB:', err);
  });