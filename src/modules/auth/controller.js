// src/modules/auth/controller.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const env = require('../../config/env');
const User = require('../../models/User');
const Provider = require('../providers/model');

function sanitizeUser(userDoc) {
  const user = userDoc.toObject();
  delete user.password;
  delete user.refreshTokens;
  return user;
}

function generateTokens(user) {
  const payload = {
    userId: user._id,
    roles: user.roles,
    activeRole: user.activeRole,
  };

  const accessToken = jwt.sign(payload, env.jwtSecret, { expiresIn: '15m' });
  const refreshToken = jwt.sign(payload, env.jwtRefreshSecret, { expiresIn: '7d' });

  return { accessToken, refreshToken };
}

async function register(req, res, next) {
  try {
    const {
      fullName, email, password, roles = ['customer'], activeRole,
      address, location, profilePictureUrl, bannerPictureUrl,
      bio, birthDate, phoneNumber, balance, status,
    } = req.body;

    const user = new User({
      fullName, email, password, roles,
      activeRole: activeRole || roles?.[0],
      address, location, profilePictureUrl, bannerPictureUrl,
      bio, birthDate, phoneNumber, balance, status,
    });
    await user.save();
    const messageKey = 'auth.register_success';
    const safeUser = sanitizeUser(user);
    res.status(201).json({ messageKey, message: req.t(messageKey), data: safeUser });
  } catch (error) {
    next(error);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      const messageKey = 'auth.user_not_found';
      return res.status(404).json({ messageKey, message: req.t(messageKey) });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      const messageKey = 'auth.invalid_password';
      return res. status(401).json({ messageKey, message: req.t(messageKey) });
    }

    const { accessToken, refreshToken } = generateTokens(user);
    user.refreshTokens.push(refreshToken);
    await user. save();
    const messageKey = 'auth.login_success';
    const safeUser = sanitizeUser(user);
    
    res.json({
      messageKey,
      message: req.t(messageKey),
      data: {
        tokens: { accessToken, refreshToken },
        profile: safeUser,
        userId: user._id. toString(),
      },
    });
  } catch (error) {
    next(error);
  }
}

async function getProfile(req, res, next) {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId);
    if (!user) {
      const messageKey = 'auth.user_not_found';
      return res.status(404).json({ messageKey, message: req.t(messageKey) });
    }

    const safeUser = sanitizeUser(user);
    res.json({
      messageKey: 'auth.profile_success',
      message: 'Profile fetched',
      data: {
        profile: safeUser
      },
    });
  } catch (error) {
    next(error);
  }
}

// --- FITUR BARU: REFRESH ACCESS TOKEN ---
async function refreshAccessToken(req, res, next) {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        messageKey: 'auth.refresh_token_required',
        message: 'Refresh token is required'
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, env.jwtRefreshSecret);
    } catch (error) {
      return res.status(401).json({
        messageKey: 'auth.refresh_token_invalid',
        message: 'Invalid or expired refresh token'
      });
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({
        messageKey: 'auth.user_not_found',
        message: 'User not found'
      });
    }

    // Validasi refresh token ada di database
    if (! user.refreshTokens.includes(refreshToken)) {
      return res.status(401).json({
        messageKey: 'auth. refresh_token_not_found',
        message: 'Refresh token not found or revoked'
      });
    }

    // Generate token baru
    const { accessToken: newAccessToken, refreshToken: newRefreshToken } = generateTokens(user);

    // Update refresh token di database (replace yang lama dengan yang baru)
    user.refreshTokens = user.refreshTokens.filter(token => token !== refreshToken);
    user.refreshTokens.push(newRefreshToken);
    await user.save();

    const safeUser = sanitizeUser(user);

    res.json({
      messageKey: 'auth.token_refreshed',
      message: 'Token refreshed successfully',
      data: {
        tokens: { accessToken: newAccessToken, refreshToken: newRefreshToken },
        profile: safeUser
      }
    });
  } catch (error) {
    next(error);
  }
}

// --- FITUR BARU: SWITCH ROLE ---
async function switchRole(req, res, next) {
  try {
    const userId = req.user.userId;
    const { role } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.roles.includes(role)) {
      return res.status(403).json({ message: `Anda belum terdaftar sebagai ${role}` });
    }

    user.activeRole = role;
    await user.save();

    const { accessToken, refreshToken } = generateTokens(user);

    res.json({
      message: `Berhasil beralih ke mode ${role}`,
      data: {
        tokens: { accessToken, refreshToken },
        profile: sanitizeUser(user)
      }
    });
  } catch (error) {
    next(error);
  }
}

// --- FITUR BARU: DAFTAR JADI MITRA ---
async function registerPartner(req, res, next) {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId);
    
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.roles.includes('provider')) {
      user.roles.push('provider');
    }

    user.activeRole = 'provider';
    await user.save();

    const existingProvider = await Provider.findOne({ userId });
    if (! existingProvider) {
      const newProvider = new Provider({
        userId,
        services: [],
        rating: 0
      });
      await newProvider. save();
    }

    const { accessToken, refreshToken } = generateTokens(user);

    res.json({
      message: 'Selamat! Anda berhasil mendaftar sebagai Mitra.',
      data: {
        tokens: { accessToken, refreshToken },
        profile: sanitizeUser(user)
      }
    });

  } catch (error) {
    next(error);
  }
}

module.exports = { 
  register, 
  login, 
  getProfile,
  refreshAccessToken,
  switchRole,
  registerPartner
};