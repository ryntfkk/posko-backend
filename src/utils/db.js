const mongoose = require('mongoose');
const env = require('../config/env');

// Connection state management
let isConnected = false;
let connectionAttempts = 0;
const MAX_RETRY_ATTEMPTS = 5;
const INITIAL_RETRY_DELAY_MS = 1000;

// Mongoose connection options optimized for Vercel serverless
const mongooseOptions = {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  maxPoolSize: 10,
  minPoolSize: 1,
  maxIdleTimeMS: 10000,
  connectTimeoutMS: 10000,
  heartbeatFrequencyMS: 10000,
};

/**
 * Sleep utility for retry delay
 * @param {number} ms - milliseconds to sleep
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calculate exponential backoff delay
 * @param {number} attempt - current attempt number (0-indexed)
 * @returns {number} delay in milliseconds
 */
const getRetryDelay = (attempt) => {
  return INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
};

/**
 * Connect to MongoDB with retry logic and exponential backoff
 * @returns {Promise<boolean>} true if connected successfully
 */
const connectDB = async () => {
  // If already connected, return immediately
  if (isConnected && mongoose.connection.readyState === 1) {
    return true;
  }

  // Reset connection state if disconnected
  if (mongoose.connection.readyState === 0) {
    isConnected = false;
  }

  connectionAttempts = 0;

  while (connectionAttempts < MAX_RETRY_ATTEMPTS) {
    try {
      console.log(`🔄 Attempting MongoDB connection (attempt ${connectionAttempts + 1}/${MAX_RETRY_ATTEMPTS})...`);
      
      await mongoose.connect(env.mongoUri, mongooseOptions);
      
      isConnected = true;
      connectionAttempts = 0;
      console.log('✅ Database connected successfully');
      return true;
    } catch (err) {
      connectionAttempts++;
      const delay = getRetryDelay(connectionAttempts - 1);
      
      console.error(`❌ MongoDB connection failed (attempt ${connectionAttempts}/${MAX_RETRY_ATTEMPTS}):`, {
        name: err.name,
        message: err.message,
        code: err.code,
      });

      if (connectionAttempts < MAX_RETRY_ATTEMPTS) {
        console.log(`⏳ Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  console.error('❌ All MongoDB connection attempts failed');
  isConnected = false;
  return false;
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
    isConnected,
    readyState,
    readyStateText: states[readyState] || 'unknown',
    connectionAttempts,
  };
};

/**
 * Ensure database is connected before proceeding
 * Used as a pre-check before database operations
 * @returns {Promise<boolean>} true if connected
 */
const ensureConnection = async () => {
  if (isConnected && mongoose.connection.readyState === 1) {
    return true;
  }
  return await connectDB();
};

// Set up connection event listeners
mongoose.connection.on('connected', () => {
  isConnected = true;
  console.log('📊 MongoDB connection established');
});

mongoose.connection.on('disconnected', () => {
  isConnected = false;
  console.log('📊 MongoDB connection disconnected');
});

mongoose.connection.on('error', (err) => {
  console.error('📊 MongoDB connection error:', err.message);
});

module.exports = {
  connectDB,
  getConnectionStatus,
  ensureConnection,
};
