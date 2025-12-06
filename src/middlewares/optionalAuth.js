// src/middlewares/optionalAuth.js
const jwt = require('jsonwebtoken');
const env = require('../config/env');

function optionalAuthenticate(req, res, next) {
  const authHeader = req.headers.authorization || '';
  // Cek apakah ada header Authorization dengan format Bearer
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (token) {
    try {
      // Jika token dikirim, WAJIB valid.
      const decoded = jwt.verify(token, env.jwtSecret);
      req.user = decoded; // Token valid, set user
    } catch (error) {
      // [FIX CRITICAL]
      // Jangan lanjut sebagai guest jika token ada tapi invalid/expired.
      // Return 401 agar frontend tahu token mati dan bisa melakukan Refresh Token otomatis.
      console.error('[OptionalAuth] Token invalid or expired, rejecting request:', error.message);
      
      return res.status(401).json({
        messageKey: 'auth.invalid_token',
        message: 'Token expired or invalid',
        error: error.message
      });
    }
  }
  
  // Jika tidak ada token sama sekali (Guest murni), lanjut tanpa req.user
  next();
}

module.exports = optionalAuthenticate;