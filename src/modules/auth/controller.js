const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const env = require('../../config/env');
const User = require('../../models/User');
const Provider = require('../providers/model');

// [HELPER] Sanitize user object untuk response
function sanitizeUser(userDoc) {
  const user = userDoc.toObject();
  delete user. password;
  delete user.refreshTokens;
  return user;
}

// [HELPER] Generate JWT tokens
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

// [FIX] Helper untuk handling MongoDB duplicate key error
function isDuplicateKeyError(error) {
  return error.code === 11000 || error.name === 'MongoServerError' && error.message.includes('duplicate key');
}

// ===================
// REGISTER
// ===================
async function register(req, res, next) {
  try {
    const {
      fullName, email, password, roles = ['customer'], activeRole,
      address, location, profilePictureUrl, bannerPictureUrl,
      bio, birthDate, phoneNumber, balance, status,
    } = req.body;

    // [FIX] Cek email sudah terdaftar sebelum create
    const existingUser = await User. findOne({ email: email. toLowerCase() });
    if (existingUser) {
      const messageKey = 'auth.email_already_exists';
      return res.status(409).json({ 
        messageKey, 
        message: req.t ?  req.t(messageKey) : 'Email sudah terdaftar.  Silakan gunakan email lain atau login.' 
      });
    }

    const user = new User({
      fullName, 
      email, 
      password, 
      roles,
      activeRole: activeRole || roles?.[0],
      address, 
      location, 
      profilePictureUrl, 
      bannerPictureUrl,
      bio, 
      birthDate, 
      phoneNumber, 
      balance, 
      status,
    });
    
    await user.save();
    
    // [IMPROVEMENT] Generate tokens agar user langsung login setelah register
    const { accessToken, refreshToken } = generateTokens(user);
    
    // Simpan refresh token
    user. refreshTokens = [refreshToken]; // Reset, hanya simpan token terbaru
    await user.save();
    
    const messageKey = 'auth.register_success';
    const safeUser = sanitizeUser(user);
    
    res.status(201).json({ 
      messageKey, 
      message: req.t ?  req.t(messageKey) : 'Registrasi berhasil! ', 
      data: {
        tokens: { accessToken, refreshToken },
        profile: safeUser
      }
    });
  } catch (error) {
    // [FIX] Handle duplicate key error dengan pesan yang user-friendly
    if (isDuplicateKeyError(error)) {
      const field = Object.keys(error. keyPattern || {})[0] || 'email';
      const messageKey = `auth.${field}_already_exists`;
      return res.status(409). json({
        messageKey,
        message: req.t ? req. t(messageKey) : `${field} sudah terdaftar. `,
      });
    }
    next(error);
  }
}

// ===================
// LOGIN
// ===================
async function login(req, res, next) {
  try {
    const { email, password } = req. body;
    
    // Case-insensitive email lookup
    const user = await User.findOne({ email: email. toLowerCase() });
    if (!user) {
      const messageKey = 'auth.user_not_found';
      return res. status(404).json({ 
        messageKey, 
        message: req.t ? req. t(messageKey) : 'Akun tidak ditemukan.  Silakan daftar terlebih dahulu.' 
      });
    }

    // [FIX] Cek status akun
    if (user.status === 'inactive') {
      const messageKey = 'auth.account_inactive';
      return res.status(403). json({
        messageKey,
        message: req.t ? req. t(messageKey) : 'Akun Anda tidak aktif. Hubungi administrator.'
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      const messageKey = 'auth.invalid_password';
      return res.status(401).json({ 
        messageKey, 
        message: req.t ?  req.t(messageKey) : 'Password salah. Silakan coba lagi.' 
      });
    }

    const { accessToken, refreshToken } = generateTokens(user);
    
    // [FIX] Batasi jumlah refresh token (max 5 device)
    const MAX_REFRESH_TOKENS = 5;
    if (user.refreshTokens. length >= MAX_REFRESH_TOKENS) {
      user.refreshTokens = user.refreshTokens.slice(-MAX_REFRESH_TOKENS + 1);
    }
    user.refreshTokens. push(refreshToken);
    await user.save();
    
    const messageKey = 'auth.login_success';
    const safeUser = sanitizeUser(user);
    
    res. json({
      messageKey,
      message: req.t ? req.t(messageKey) : 'Login berhasil!',
      data: {
        tokens: { accessToken, refreshToken },
        profile: safeUser,
      },
    });
  } catch (error) {
    next(error);
  }
}

// ===================
// REFRESH TOKEN
// ===================
async function refreshToken(req, res, next) {
  try {
    const { refreshToken: oldRefreshToken } = req.body;
    
    if (!oldRefreshToken) {
      return res.status(400).json({
        messageKey: 'auth.refresh_token_required',
        message: 'Refresh token wajib diisi.'
      });
    }

    // Verify refresh token
    let decoded;
    try {
      decoded = jwt.verify(oldRefreshToken, env. jwtRefreshSecret);
    } catch (err) {
      return res.status(401).json({
        messageKey: 'auth.invalid_refresh_token',
        message: 'Refresh token tidak valid atau sudah kadaluarsa.  Silakan login ulang.'
      });
    }

    // Find user dan cek apakah refresh token masih valid di DB
    const user = await User.findById(decoded.userId);
    if (!user || !user.refreshTokens. includes(oldRefreshToken)) {
      return res.status(401).json({
        messageKey: 'auth.refresh_token_revoked',
        message: 'Sesi tidak valid. Silakan login ulang.'
      });
    }

    // Generate new tokens
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);

    // Replace old refresh token dengan yang baru
    const tokenIndex = user.refreshTokens.indexOf(oldRefreshToken);
    if (tokenIndex > -1) {
      user.refreshTokens[tokenIndex] = newRefreshToken;
    } else {
      user.refreshTokens. push(newRefreshToken);
    }
    await user.save();

    res.json({
      messageKey: 'auth.token_refreshed',
      message: 'Token berhasil diperbarui.',
      data: {
        tokens: { accessToken, refreshToken: newRefreshToken }
      }
    });
  } catch (error) {
    next(error);
  }
}

// ===================
// LOGOUT
// ===================
async function logout(req, res, next) {
  try {
    const { refreshToken } = req.body;
    const userId = req.user. userId;

    const user = await User. findById(userId);
    if (user && refreshToken) {
      // Hapus refresh token dari array
      user.refreshTokens = user. refreshTokens.filter(t => t !== refreshToken);
      await user.save();
    }

    res. json({
      messageKey: 'auth. logout_success',
      message: 'Logout berhasil.'
    });
  } catch (error) {
    next(error);
  }
}

// ===================
// GET PROFILE
// ===================
async function getProfile(req, res, next) {
  try {
    const userId = req. user.userId;
    const user = await User.findById(userId);
    if (!user) {
      const messageKey = 'auth.user_not_found';
      return res. status(404).json({ messageKey, message: req.t ? req. t(messageKey) : 'User tidak ditemukan' });
    }

    const safeUser = sanitizeUser(user);
    res.json({
      messageKey: 'auth. profile_success',
      message: 'Profile berhasil dimuat',
      data: {
        profile: safeUser
      },
    });
  } catch (error) {
    next(error);
  }
}

// ===================
// SWITCH ROLE
// ===================
async function switchRole(req, res, next) {
  try {
    const userId = req.user. userId;
    const { role } = req. body;

    // [FIX] Validasi role yang diminta
    const allowedRoles = ['customer', 'provider'];
    if (! role || !allowedRoles.includes(role)) {
      return res.status(400).json({ 
        message: 'Role tidak valid. Pilih customer atau provider.' 
      });
    }

    const user = await User. findById(userId);
    if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });

    if (! user.roles.includes(role)) {
      return res.status(403).json({ 
        message: `Anda belum terdaftar sebagai ${role}. Daftar terlebih dahulu.` 
      });
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

// ===================
// REGISTER PARTNER
// ===================
async function registerPartner(req, res, next) {
  try {
    const userId = req.user. userId;
    const user = await User.findById(userId);
    
    if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });

    // [FIX] Cek apakah sudah jadi provider
    if (user.roles.includes('provider')) {
      // Jika sudah provider, langsung switch role saja
      user.activeRole = 'provider';
      await user.save();
      
      const { accessToken, refreshToken } = generateTokens(user);
      return res.json({
        message: 'Anda sudah terdaftar sebagai Mitra.  Mode diubah ke Provider.',
        data: {
          tokens: { accessToken, refreshToken },
          profile: sanitizeUser(user)
        }
      });
    }

    // Tambahkan role provider
    user.roles.push('provider');
    user.activeRole = 'provider';
    await user.save();

    // Buat dokumen Provider jika belum ada
    const existingProvider = await Provider.findOne({ userId });
    if (! existingProvider) {
      const newProvider = new Provider({
        userId,
        services: [],
        rating: 0
      });
      await newProvider.save();
    }

    const { accessToken, refreshToken } = generateTokens(user);

    res.json({
      message: 'Selamat!  Anda berhasil mendaftar sebagai Mitra.',
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
  refreshToken,  // [NEW]
  logout,        // [NEW]
  getProfile, 
  switchRole,
  registerPartner
};