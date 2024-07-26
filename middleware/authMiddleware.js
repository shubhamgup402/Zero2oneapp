const jwt = require('jsonwebtoken');
const JWT_SECRET = 'ASINRPTPY450BUIPG6QRQ98R54';

const authMiddleware = (req, res, next) => {
  const token = req.cookies.token;

  if (!token) {
    return res.redirect('/');
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; 
    next();
  } catch (err) {
    console.error(err);
    return res.redirect('/');
  }
};

module.exports = authMiddleware;
