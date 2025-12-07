const mongoose = require('mongoose');
const env = require('../config/env');

// Global cache variable for Serverless environment
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

// Mongoose connection options optimized for Vercel serverless but flexible for others
const mongooseOptions = {
  bufferCommands: false, // Fail fast if not connected
  serverSelectionTimeoutMS: 10000, // Lower timeout to fail faster (10s)
  socketTimeoutMS: 45000,
  // [ARCHITECTURAL FIX] Menggunakan Environment Variable atau Default yang lebih masuk akal (10)
  maxPoolSize: process.env.MONGO_MAX_POOL_SIZE ? parseInt(process.env.MONGO_MAX_POOL_SIZE) : 10,
  minPoolSize: 0, // Set to 0 to prevent stale connections in serverless
  maxIdleTimeMS: 10000,
  connectTimeoutMS: 10000, // Lower connection timeout
  heartbeatFrequencyMS: 10000,
};

/**
 * Connect to MongoDB using Cached Promise Pattern
 * @returns {Promise<any>} Mongoose connection
 */
const connectDB = async () => {
  // Check if connection is actually alive (readyState === 1)
  if (cached.conn) {
    if (mongoose.connection.readyState === 1) {
      return cached.conn;
    }
    console.log('⚠️ Stale connection detected (State: ' + mongoose.connection.readyState + '). Reconnecting...');
    cached.conn = null;
    cached.promise = null;
  }

  if (!cached.promise) {
    console.log('🔄 Initializing new MongoDB connection...');

    // Fix: Handle Mongoose deprecation warnings if any
    mongoose.set('strictQuery', false);

    cached.promise = mongoose.connect(env.mongoUri, mongooseOptions)
      .then((mongoose) => {
        console.log('✅ Database connected successfully');
        return mongoose;
      })
      .catch((err) => {
        console.error('❌ MongoDB connection failed:', err.message);
        cached.promise = null; // Reset promise on failure so we can retry
        throw err;
      }); 
  }

  try {
    cached.conn = await cached.promise;
    return cached.conn;
  } catch (e) {
    cached.promise = null;
    throw e;
  }
};

/**
 * Get current connection status
 * @returns {object} connection status details
 */
const getConnectionStatus = () => {
  const readyState = mongoose.connection.readyState;
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };

  return {
    isConnected: readyState === 1,
    readyState,
    readyStateText: states[readyState] || 'unknown',
    isCached: !!cached.conn
  };
};

/**
 * Ensure database is connected before proceeding
 * Used as a pre-check before database operations
 * @returns {Promise<boolean>} true if connected
 */
const ensureConnection = async () => {
  try {
    await connectDB();
    return true;
  } catch (error) {
    console.error('❌ Failed to ensure database connection:', error.message);
    return false;
  }
};

// Event listeners for monitoring
if (mongoose.connection.listeners('connected').length === 0) {
  mongoose.connection.on('connected', () => {
    console.log('📊 MongoDB connection established');
  });

  mongoose.connection.on('disconnected', () => {
    console.log('📊 MongoDB connection disconnected');
    // Clear cache on explicit disconnect
    cached.conn = null;
  });

  mongoose.connection.on('error', (err) => {
    console.error('📊 MongoDB connection error:', err.message);
  });
}

module.exports = {
  connectDB,
  getConnectionStatus,
  ensureConnection,
};