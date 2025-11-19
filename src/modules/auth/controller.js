const User = require('../../models/User');

function sanitizeUser(userDoc) {
  const user = userDoc.toObject();
  delete user.password;
  return user;
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
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      const messageKey = 'auth.user_not_found';
      return res.status(404).json({ messageKey, message: req.t(messageKey) });
        }

    const messageKey = 'auth.login_success';
const safeUser = sanitizeUser(user);
    res.json({
      messageKey,
      message: req.t(messageKey),
      data: {
        userId: user._id,
        roles: safeUser.roles,
        activeRole: safeUser.activeRole,
        location: safeUser.location,
        address: safeUser.address,
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { register, login };