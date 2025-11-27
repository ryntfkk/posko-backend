// src/middlewares/errorHandler.js

function errorHandler(err, req, res, next) {
  // 1. Tampilkan error di Terminal VS Code (PENTING UNTUK DIBACA)
  console.error('❌ ERROR LOG:', err);

  // 2. Handle MongoDB connection errors
  if (err.name === 'MongooseServerSelectionError' || err.name === 'MongoNetworkError') {
    return res.status(503).json({
      messageKey: 'errors.database_unavailable',
      message: 'Database service is temporarily unavailable. Please try again later.',
    });
  }

  // 3. Handle MongoDB timeout errors
  if (err.name === 'MongoTimeoutError' || 
      (err.message && err.message.includes('buffering timed out'))) {
    return res.status(503).json({
      messageKey: 'errors.database_timeout',
      message: 'Database request timed out. Please try again later.',
    });
  }

  // 4. Cek Error Duplicate Key (Kode 11000)
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    return res.status(409).json({
      messageKey: 'validation.duplicate_entry',
      message: `Data untuk ${field} sudah ada. Tidak boleh duplikat.`,
      originalError: err.message // Tampilkan pesan asli
    });
  }

  // 5. Cek Error Validasi Mongoose (Misal: Tipe data salah, field wajib kurang)
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({
      messageKey: 'validation.mongoose_error',
      message: 'Gagal validasi database',
      errors: errors
    });
  }

  // 6. Handle Error Lainnya (JANGAN DISEMBUNYIKAN DULU)
  const status = err.status || 500;
  res.status(status).json({
    messageKey: 'errors.internal',
    message: err.message || 'Terjadi kesalahan pada server', // Tampilkan pesan error asli
    stack: err.stack // Tampilkan stack trace biar jelas baris coding yang error
  });
}

module.exports = errorHandler;