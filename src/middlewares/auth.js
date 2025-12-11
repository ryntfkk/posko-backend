const jwt = require('jsonwebtoken');
const env = require('../config/env');

function unauthorizedResponse(req, res, messageKey, defaultMessage, status = 401) {
  return res.status(status).json({
    messageKey,
    message: req.t ? req.t(messageKey) : defaultMessage,
  });
}

function isAuthenticated(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return unauthorizedResponse(req, res, 'auth.unauthorized', 'Authorization token is required');
  }

  try {
    const decoded = jwt.verify(token, env.jwtSecret);
    req.user = decoded;
    return next();
  } catch (error) {
    return unauthorizedResponse(req, res, 'auth.invalid_token', 'Invalid or expired token');
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return unauthorizedResponse(req, res, 'auth.forbidden', 'Admin access required', 403);
  }
  next();
}

module.exports = {
  isAuthenticated,
  requireAdmin
};