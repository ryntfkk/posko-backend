const { ensureConnection, getConnectionStatus } = require('../utils/db');

/**
 * Middleware to ensure database connection before processing requests
 * that require database access
 */
const requireDbConnection = async (req, res, next) => {
  try {
    const connected = await ensureConnection();
    
    if (!connected) {
      const status = getConnectionStatus();
      console.error('❌ Database connection check failed:', status);
      
      return res.status(503).json({
        messageKey: 'errors.database_unavailable',
        message: 'Database service is temporarily unavailable. Please try again later.',
      });
    }
    
    next();
  } catch (err) {
    console.error('❌ Database health check error:', err.message);
    
    return res.status(503).json({
      messageKey: 'errors.database_unavailable',
      message: 'Database service is temporarily unavailable. Please try again later.',
    });
  }
};

module.exports = requireDbConnection;
