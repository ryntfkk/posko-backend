// src/middlewares/errorHandler.js

function errorHandler(err, req, res, next) {
  // 1. Tampilkan error di Terminal VS Code (PENTING UNTUK DIBACA)
  console.error('❌ ERROR LOG:', err);

  // 2. Cek Error Duplicate Key (Kode 11000)
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    return res.status(409).json({
      messageKey: 'validation.duplicate_entry',
      message: `Data untuk ${field} sudah ada. Tidak boleh duplikat.`,
      originalError: err.message // Tampilkan pesan asli
    });
  }

  // 3. Cek Error Validasi Mongoose (Misal: Tipe data salah, field wajib kurang)
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({
      messageKey: 'validation.mongoose_error',
      message: 'Gagal validasi database',
      errors: errors
    });
  }

  // 4. Handle Error Lainnya (JANGAN DISEMBUNYIKAN DULU)
  const status = err.status || 500;
  res.status(status).json({
    messageKey: 'errors.internal',
    message: err.message || 'Terjadi kesalahan pada server', // Tampilkan pesan error asli
    stack: err.stack // Tampilkan stack trace biar jelas baris coding yang error
  });
}

module.exports = errorHandler;