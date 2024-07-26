// index.js
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');
const session = require('express-session');
const axios = require('axios');
const authRoutes = require('./routes/auth');
const orderRoutes = require('./routes/order');
const { router: holdingsRoutes, updateHoldingsData, latestData } = require('./routes/holdings');
const transactionRoutes = require('./routes/transaction');
const authMiddleware = require('./middleware/authMiddleware');
const pool = require('./db/config');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');

app.use(session({
  secret: 'JKAEDWE9R47BZMSZNQAWE[3HGSQ8EQWEYQ',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

app.use('/', authRoutes);
app.use('/', orderRoutes);
app.use('/', holdingsRoutes);
app.use('/', transactionRoutes);

// Endpoint to fetch cryptocurrency prices
app.get('/crypto-prices', async (req, res) => {
  try {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/price');
    const prices = response.data;
    res.json(prices);
  } catch (error) {
    console.error('Error fetching crypto prices:', error);
    res.status(500).send('Server error');
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', authMiddleware, async (req, res) => {
  const userId = req.session.userId;

  if (!userId) {
    return res.status(403).send('Not authorized');
  }

  await updateHoldingsData(userId);

  const data = latestData[userId];
  const username = req.session.username;

  res.render('dashboard', {
    username,
    balance: data.balance,
    totalInvested: data.totalInvested,
    totalCurrent: data.totalCurrent,
    totalReturn: data.totalReturn,
    totalReturnPercentage: data.totalReturnPercentage
  });
});

app.post('/add-funds', authMiddleware, async (req, res) => {
  const { amount } = req.body;
  const userId = req.session.userId;

  if (!userId) {
    return res.status(403).send('Not authorized');
  }

  try {
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

pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Error connecting to the database:', err.stack);
  } else {
    console.log('Database connected:', res.rows[0]);
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
