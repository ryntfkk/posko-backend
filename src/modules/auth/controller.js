const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const env = require('../../config/env');
const User = require('../../models/User');

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
      fullName,
      email,
      password,
      roles = ['customer'],
      activeRole,
      address,
      location,
      profilePictureUrl,
      bannerPictureUrl,
      bio,
      birthDate,
      phoneNumber,
      balance,
      status,
    } = req.body;

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
        profile: {
          userId: user._id,
          fullName: safeUser.fullName,
          email: safeUser.email,
          roles: safeUser.roles,
          activeRole: safeUser.activeRole,
          profilePictureUrl: safeUser.profilePictureUrl,
          location: safeUser.location,
          address: safeUser.address,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

// TAMBAHKAN FUNGSI INI
async function getProfile(req, res, next) {
  try {
    // req.user didapat dari middleware authenticate (hasil decode token)
    const userId = req.user.userId;

    const user = await User.findById(userId);
    if (!user) {
      const messageKey = 'auth.user_not_found';
      return res.status(404).json({ messageKey, message: req.t(messageKey) });
    }

    const safeUser = sanitizeUser(user);
    const messageKey = 'auth.profile_success'; // Anda bisa tambah key ini di translation.json jika mau, atau biarkan string biasa
    
    // Struktur response disesuaikan dengan ekspektasi Frontend (result.data.profile)
    res.json({
      messageKey,
      message: 'Profile fetched successfully',
      data: {
        profile: {
          userId: user._id,
          fullName: safeUser.fullName,
          email: safeUser.email,
          roles: safeUser.roles,
          activeRole: safeUser.activeRole,
          profilePictureUrl: safeUser.profilePictureUrl,
          location: safeUser.location,
          address: safeUser.address,
          phoneNumber: safeUser.phoneNumber,
          birthDate: safeUser.birthDate,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

// UPDATE EXPORT
module.exports = { register, login, getProfile };