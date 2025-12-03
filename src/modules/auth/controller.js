// src/modules/auth/controller.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const env = require('../../config/env');
const User = require('../../models/User');
const Provider = require('../providers/model');

// [HELPER] Sanitize user object untuk response
function sanitizeUser(userDoc) {
  const user = userDoc.toObject();
  delete user.password;
  delete user.refreshTokens;
  return user;
}

// [HELPER] Generate JWT tokens
function generateTokens(user) {
  const payload = {
    userId: user._id,
    email: user.email,
    roles: user.roles,
    activeRole: user.activeRole,
    role: user.activeRole,
  };

  const accessToken = jwt.sign(payload, env.jwtSecret, { expiresIn: '15m' });
  const refreshToken = jwt.sign(payload, env.jwtRefreshSecret, { expiresIn: '7d' });

  return { accessToken, refreshToken };
}

// [HELPER] Set Cookies untuk Middleware Frontend
function setAuthCookies(res, accessToken, refreshToken) {
  const isProduction = env.nodeEnv === 'production';
  
  // Cookie untuk Access Token (dibaca oleh Middleware)
  res.cookie('posko_token', accessToken, {
    httpOnly: true, // Tidak bisa diakses JS client (aman dari XSS)
    secure: isProduction, // HTTPS only di production
    sameSite: isProduction ? 'none' : 'lax', // Cross-site cookie handling
    maxAge: 15 * 60 * 1000 // 15 menit
  });

  // Cookie untuk Refresh Token
  res.cookie('posko_refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 hari
  });
}

// [HELPER] Clear Cookies saat Logout
function clearAuthCookies(res) {
  const isProduction = env.nodeEnv === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax'
  };

  res.clearCookie('posko_token', cookieOptions);
  res.clearCookie('posko_refresh_token', cookieOptions);
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
      fullName, email, password,
      address, location, profilePictureUrl, bannerPictureUrl,
      bio, birthDate, phoneNumber, balance, status,
    } = req.body;

    // [FIX] Cek email sudah terdaftar sebelum create
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      const messageKey = 'auth.email_already_exists';
      return res.status(409).json({ 
        messageKey, 
        message: req.t ? req.t(messageKey) : 'Email sudah terdaftar. Silakan gunakan email lain atau login.' 
      });
    }

    // [PERBAIKAN] Force role selalu 'customer' untuk pendaftaran publik
    // User tidak boleh mendaftar langsung sebagai provider lewat endpoint ini
    const forcedRoles = ['customer'];
    const forcedActiveRole = 'customer';

    const user = new User({
      fullName, 
      email, 
      password, 
      roles: forcedRoles,
      activeRole: forcedActiveRole,
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
    user.refreshTokens = [refreshToken]; // Reset, hanya simpan token terbaru
    await user.save();
    
    // [NEW] Set Cookies
    setAuthCookies(res, accessToken, refreshToken);

    const messageKey = 'auth.register_success';
    const safeUser = sanitizeUser(user);
    
    res.status(201).json({ 
      messageKey, 
      message: req.t ? req.t(messageKey) : 'Registrasi berhasil!', 
      data: {
        tokens: { accessToken, refreshToken },
        profile: safeUser
      }
    });
  } catch (error) {
    // [FIX] Handle duplicate key error dengan pesan yang user-friendly
    if (isDuplicateKeyError(error)) {
      const field = Object.keys(error.keyPattern)[0];
      const messageKey = 'auth.duplicate_entry';
      return res.status(409).json({
        messageKey,
        message: req.t ? req.t(messageKey, { field }) : `${field} sudah terdaftar.`,
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
    const { email, password } = req.body;
    
    console.log(`Login attempt for: ${email}`); // [DEBUG] Log attempt

    // Case-insensitive email lookup
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      console.warn(`Login failed: User not found (${email})`); // [DEBUG]
      const messageKey = 'auth.user_not_found';
      return res.status(404).json({ 
        messageKey, 
        message: req.t ? req.t(messageKey) : 'Akun tidak ditemukan. Silakan daftar terlebih dahulu.' 
      });
    }

    // [FIX] Cek status akun
    if (user.status === 'inactive') {
      console.warn(`Login failed: Account inactive (${email})`); // [DEBUG]
      const messageKey = 'auth.account_inactive';
      return res.status(403).json({
        messageKey,
        message: req.t ? req.t(messageKey) : 'Akun Anda tidak aktif. Hubungi administrator.'
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      console.warn(`Login failed: Invalid password (${email})`); // [DEBUG]
      const messageKey = 'auth.invalid_password';
      return res.status(401).json({ 
        messageKey, 
        message: req.t ? req.t(messageKey) : 'Password salah. Silakan coba lagi.' 
      });
    }

    const { accessToken, refreshToken } = generateTokens(user);
    
    // [FIX] Batasi jumlah refresh token (max 5 device)
    const MAX_REFRESH_TOKENS = 5;
    if (user.refreshTokens.length >= MAX_REFRESH_TOKENS) {
      user.refreshTokens = user.refreshTokens.slice(-MAX_REFRESH_TOKENS + 1);
    }
    user.refreshTokens.push(refreshToken);
    await user.save();
    
    // [NEW] Set Cookies
    setAuthCookies(res, accessToken, refreshToken);

    console.log(`Login success for: ${email}`); // [DEBUG]

    const messageKey = 'auth.login_success';
    const safeUser = sanitizeUser(user);
    
    res.json({
      messageKey,
      message: req.t ? req.t(messageKey) : 'Login berhasil!',
      data: {
        tokens: { accessToken, refreshToken },
        profile: safeUser,
      },
    });
  } catch (error) {
    console.error('Login error:', error); // [DEBUG]
    next(error);
  }
}

// ===================
// REFRESH TOKEN
// ===================
async function refreshToken(req, res, next) {
  try {
    // Support ambil token dari body atau cookie
    const refreshToken = req.body.refreshToken || req.cookies?.posko_refresh_token;

    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh Token required' });
    }

    // 1. Verify Refresh Token
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, env.jwtRefreshSecret);
    } catch (err) {
      const messageKey = 'auth.invalid_refresh_token';
      return res.status(401).json({ 
        messageKey, 
        message: req.t ? req.t(messageKey) : 'Refresh token tidak valid atau kadaluarsa.' 
      });
    }

    // 2. Check if User Exists
    const user = await User.findById(decoded.userId);
    if (!user) {
      const messageKey = 'auth.user_not_found';
      return res.status(404).json({ messageKey, message: req.t ? req.t(messageKey) : 'User tidak ditemukan.' });
    }

    // 3. Check if Token matches database
    if (!user.refreshTokens.includes(refreshToken)) {
      // Token Reuse Detection (Optional security measure: Clear all tokens)
      // user.refreshTokens = [];
      // await user.save();
      const messageKey = 'auth.token_reuse_detected';
      return res.status(403).json({ 
        messageKey, 
        message: req.t ? req.t(messageKey) : 'Token tidak dikenali. Silakan login ulang.' 
      });
    }

    // 4. Rotate Tokens (Generate new pair)
    const newTokens = generateTokens(user);

    // Replace old refresh token with new one
    const tokenIndex = user.refreshTokens.indexOf(refreshToken);
    if (tokenIndex !== -1) {
      user.refreshTokens[tokenIndex] = newTokens.refreshToken;
    } else {
      user.refreshTokens.push(newTokens.refreshToken);
    }
    
    await user.save();

    // [NEW] Set Cookies
    setAuthCookies(res, newTokens.accessToken, newTokens.refreshToken);

    res.json({
      messageKey: 'auth.token_refreshed',
      message: 'Token berhasil diperbarui.',
      data: {
        tokens: newTokens
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
    const refreshToken = req.body.refreshToken || req.cookies?.posko_refresh_token;
    const userId = req.user.userId;

    const user = await User.findById(userId);
    if (user && refreshToken) {
      // Hapus refresh token dari array
      user.refreshTokens = user.refreshTokens.filter(t => t !== refreshToken);
      await user.save();
    }

    // [NEW] Clear Cookies
    clearAuthCookies(res);

    res.json({
      messageKey: 'auth.logout_success',
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
    const userId = req.user.userId;
    const user = await User.findById(userId);
    if (!user) {
      const messageKey = 'auth.user_not_found';
      return res.status(404).json({ messageKey, message: req.t ? req.t(messageKey) : 'User tidak ditemukan' });
    }

    const safeUser = sanitizeUser(user);
    res.json({
      messageKey: 'auth.profile_success',
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
// UPDATE PROFILE
// ===================
async function updateProfile(req, res, next) {
  try {
    const userId = req.user.userId;
    const updates = { ...req.body };

    // [FIX] Handling Upload File jika ada
    // Middleware Multer di routes akan menaruh file di req.file
    if (req.file) {
      // Simpan URL gambar relatif atau absolut sesuai konfigurasi static file
      // Contoh: /uploads/profile-picture-123.jpg
      updates.profilePictureUrl = `/uploads/${req.file.filename}`;
    }

    // [SECURITY] Filter field yang boleh diupdate
    // Kita hapus field sensitif jika user mencoba mengirimnya
    const forbiddenFields = ['password', 'balance', 'roles', 'activeRole', 'email', 'status', 'refreshTokens'];
    forbiddenFields.forEach(field => delete updates[field]);

    // Update data di database
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({ message: 'User tidak ditemukan' });
    }

    res.json({
      message: 'Profil berhasil diperbarui',
      data: {
        profile: sanitizeUser(user)
      }
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
    const userId = req.user.userId;
    const { role } = req.body;

    // [FIX] Validasi role yang diminta
    const allowedRoles = ['customer', 'provider'];
    if (!role || !allowedRoles.includes(role)) {
      return res.status(400).json({ 
        message: 'Role tidak valid. Pilih customer atau provider.' 
      });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });

    if (!user.roles.includes(role)) {
      return res.status(403).json({ 
        message: `Anda belum terdaftar sebagai ${role}. Daftar terlebih dahulu.` 
      });
    }

    user.activeRole = role;
    await user.save();

    const { accessToken, refreshToken } = generateTokens(user);

    // [NEW] Set Cookies
    setAuthCookies(res, accessToken, refreshToken);

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
    const userId = req.user.userId;
    const user = await User.findById(userId);

    if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });

    if (user.roles.includes('provider')) {
      return res.status(400).json({ message: 'Anda sudah terdaftar sebagai Mitra.' });
    }

    // Tambahkan role provider
    user.roles.push('provider');
    user.activeRole = 'provider';
    await user.save();

    // Buat data Provider (kosongan dulu)
    const existingProvider = await Provider.findOne({ userId });
    if (!existingProvider) {
      const newProvider = new Provider({
        userId,
        services: [],
        rating: 0
      });
      await newProvider.save();
    }

    const { accessToken, refreshToken } = generateTokens(user);

    // [NEW] Set Cookies
    setAuthCookies(res, accessToken, refreshToken);

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
  refreshToken, 
  logout,
  getProfile,
  updateProfile, 
  switchRole,
  registerPartner
};