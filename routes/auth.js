// routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/config');
const router = express.Router();

const JWT_SECRET = 'ASINRPTPY450BUIPG6QRQ98R54';

router.post('/register', async (req, res) => {
  const { username, email, pswd } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(pswd, 10);
    await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3)',
      [username, email, hashedPassword]
    );
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

router.post('/login', async (req, res) => {
  const { email, pswd } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length > 0) {
      const user = result.rows[0];
      const isMatch = await bcrypt.compare(pswd, user.password_hash);
      if (isMatch) {
        const token = jwt.sign({ userId: user.user_id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
        res.cookie('token', token, { httpOnly: true });
        req.session.userId = user.user_id;
        req.session.username = user.username;
        res.redirect('/dashboard');
      } else {
        res.status(400).send('Invalid credentials');
      }
    } else {
      res.status(400).send('Invalid credentials');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

router.get('/logout', (req, res) => {
  res.clearCookie('token');
  req.session.destroy(err => {
    if (err) {
      return res.status(500).send('Unable to log out');
    }
    res.redirect('/');
  });
});

router.post('/add-funds', async (req, res) => {
  const { amount } = req.body;
  const userId = req.session.userId;

  if (!userId) {
    return res.status(403).send('Not authorized');
  }

  try {
    // Update the user's balance
    await pool.query(
      'UPDATE users SET balance = balance + $1 WHERE user_id = $2',
      [amount, userId]
    );
    res.redirect('/dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;

