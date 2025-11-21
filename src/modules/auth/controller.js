const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const env = require('../../config/env');
const User = require('../../models/User');
const Provider = require('../providers/model'); // Pastikan import Model Provider

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

// ... (Fungsi register dan login biarkan tetap sama) ...
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
      return res.status(401).json({ messageKey, message: req.t(messageKey) });
    }

    const { accessToken, refreshToken } = generateTokens(user);
    user.refreshTokens.push(refreshToken);
    await user.save();
    const messageKey = 'auth.login_success';
    const safeUser = sanitizeUser(user);
    
    res.json({
      messageKey,
      message: req.t(messageKey),
      data: {
        tokens: { accessToken, refreshToken },
        profile: safeUser, // Kirim full object user agar frontend dapat data lengkap
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
    // Kita kirim structure yang konsisten dengan Login
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

// --- FITUR BARU: SWITCH ROLE ---
async function switchRole(req, res, next) {
  try {
    const userId = req.user.userId;
    const { role } = req.body; // 'customer' atau 'provider'

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Validasi: User harus punya role tersebut sebelum switch
    if (!user.roles.includes(role)) {
      return res.status(403).json({ message: `Anda belum terdaftar sebagai ${role}` });
    }

    // Update activeRole
    user.activeRole = role;
    await user.save();

    // Regenerate Token dengan activeRole baru
    const { accessToken, refreshToken } = generateTokens(user);
    
    // Update refresh token di DB (opsional: replace atau push)
    // user.refreshTokens.push(refreshToken); 
    // await user.save();

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

    // 1. Tambahkan role 'provider' jika belum ada
    if (!user.roles.includes('provider')) {
      user.roles.push('provider');
    }

    // 2. Ubah activeRole langsung ke provider agar user langsung masuk dashboard
    user.activeRole = 'provider';
    await user.save();

    // 3. Buat dokumen Provider (Profile Mitra) jika belum ada
    // Cek apakah data provider sudah ada
    const existingProvider = await Provider.findOne({ userId });
    if (!existingProvider) {
      const newProvider = new Provider({
        userId,
        services: [], // Nanti bisa diupdate lewat menu settings
        rating: 0
      });
      await newProvider.save();
    }

    // 4. Regenerate Token
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
  switchRole,      // Export baru
  registerPartner  // Export baru
};