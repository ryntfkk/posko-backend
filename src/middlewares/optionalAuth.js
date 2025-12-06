// src/middlewares/optionalAuth.js
const jwt = require('jsonwebtoken');
const env = require('../config/env');

function optionalAuthenticate(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (token) {
    try {
      const decoded = jwt.verify(token, env.jwtSecret);
      req.user = decoded; // Token valid, set user
    } catch (error) {
      // Token invalid/expired: Biarkan lanjut sebagai Guest (req.user undefined)
      // atau bisa kita log warningnya
      console.warn('[OptionalAuth] Token invalid or expired, proceeding as guest.');
    }
  }
  
  // Lanjut ke controller, baik ada user maupun tidak
  next();
}

module.exports = optionalAuthenticate;