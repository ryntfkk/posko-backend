const AuthUser = require('./model');

async function register(req, res, next) {
  try {
    const { fullName, email, password, roles = ['customer'] } = req.body;
    const user = new AuthUser({ fullName, email, password, roles });
    await user.save();
    const messageKey = 'auth.register_success';
    res.status(201).json({ messageKey, message: req.t(messageKey), data: user });  } catch (error) {
    next(error);
  }
}

async function login(req, res, next) {
  try {
    const { email } = req.body;
    const user = await AuthUser.findOne({ email });
    if (!user) {
      const messageKey = 'auth.user_not_found';
      return res.status(404).json({ messageKey, message: req.t(messageKey) });
        }

    const messageKey = 'auth.login_success';
    res.json({ messageKey, message: req.t(messageKey), data: { userId: user._id } });
    } catch (error) {
    next(error);
  }
}

module.exports = { register, login };