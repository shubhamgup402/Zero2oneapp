const express = require('express');
const pool = require('../db/config');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');

async function getMarketPrice(stock_symbol) {
  try {
    const fetch = (await import('node-fetch')).default;
    const apiUrl = `https://api.binance.com/api/v3/ticker/price?symbol=${stock_symbol}`;
    const response = await fetch(apiUrl);
    const data = await response.json();
    return parseFloat(data.price).toFixed(2);
  } catch (error) {
    console.error('Error fetching market price:', error);
    return null;
  }
}

router.post('/order', authMiddleware, async (req, res) => {
  const { stock_symbol, quantity, order_action, order_type, limit_price } = req.body;
  const userId = req.session.userId;

  console.log('Order Action: ', order_action);

  try {
    const price = order_type === 'market' ? await getMarketPrice(stock_symbol) : parseFloat(limit_price);

    const userResult = await pool.query('SELECT balance FROM users WHERE user_id=$1', [userId]);
    const userBalance = parseFloat(userResult.rows[0].balance);

    const totalAmount = parseFloat(price) * parseInt(quantity);

    if (order_action === 'buy' && userBalance < totalAmount) {
      res.status(400).send('Insufficient balance to buy');
      return;
    } else if (order_action === 'sell') {
      const holdings = await pool.query('SELECT * FROM holdings WHERE user_id = $1 AND stock_symbol = $2', [userId, stock_symbol]);
      if (holdings.rowCount === 0 || holdings.rows[0].quantity < quantity) {
        res.status(400).send('Insufficient holdings to sell');
        return;
      }
    }

    const status = order_type === 'market' ? 'success' : 'pending';

    if (order_type === 'market') {
      await processOrder(userId, stock_symbol, quantity, order_action, price, totalAmount);
      res.redirect('/dashboard');
    } else {
      await pool.query(
        'INSERT INTO pending_orders (user_id, stock_symbol, quantity, order_action, order_type, limit_price, status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [userId, stock_symbol, quantity, order_action, order_type, limit_price, status]
      );
      res.redirect('/dashboard');
      checkPendingOrders(userId, stock_symbol, quantity, order_action, limit_price);
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

async function processOrder(userId, stock_symbol, quantity, order_action, price, totalAmount) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (order_action === 'buy') {
      await client.query(
        'INSERT INTO holdings (user_id, stock_symbol, quantity, invested) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, stock_symbol) DO UPDATE SET quantity = holdings.quantity + EXCLUDED.quantity, invested = holdings.invested + EXCLUDED.invested',
        [userId, stock_symbol, quantity, totalAmount]
      );
      await client.query(
        'UPDATE users SET balance = balance - $1 WHERE user_id = $2',
        [totalAmount, userId]
      );
    } else if (order_action === 'sell') {
      const holdings = await client.query(
        'SELECT * FROM holdings WHERE user_id = $1 AND stock_symbol = $2',
        [userId, stock_symbol]
      );

      const currentQuantity = holdings.rows[0].quantity;
      const currentInvested = holdings.rows[0].invested;
      const currentAveragePrice = currentInvested / currentQuantity;

      const sellAmount = currentAveragePrice * quantity;
      const profitLossPerShare = price - currentAveragePrice;
      const totalProfitLoss = profitLossPerShare * quantity;

      await client.query(
        'UPDATE holdings SET quantity = quantity - $1, invested = invested - $2 WHERE user_id = $3 AND stock_symbol = $4',
        [quantity, sellAmount, userId, stock_symbol]
      );

      await client.query(
        'UPDATE users SET balance = balance + $1 WHERE user_id = $2',
        [totalAmount, userId]
      );

      await client.query(
        'INSERT INTO profits_losses (user_id, stock_symbol, profit_loss) VALUES ($1, $2, $3)',
        [userId, stock_symbol, totalProfitLoss]
      );

      const updatedHoldings = await client.query(
        'SELECT quantity FROM holdings WHERE user_id = $1 AND stock_symbol = $2',
        [userId, stock_symbol]
      );

      if (updatedHoldings.rows[0].quantity === 0) {
        await client.query(
          'DELETE FROM holdings WHERE user_id = $1 AND stock_symbol = $2',
          [userId, stock_symbol]
        );
      }
    }

    await client.query(
      'INSERT INTO transactions (user_id, stock_symbol, quantity, order_action, order_type, limit_price, status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [userId, stock_symbol, quantity, order_action, 'market', price, 'success']
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error processing order:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function checkPendingOrders(userId, stock_symbol, quantity, order_action, limit_price) {
  const checkOrderStatus = async () => {
    try {
      const currentPrice = await getMarketPrice(stock_symbol);

      if ((order_action === 'buy' && currentPrice <= limit_price) || (order_action === 'sell' && currentPrice >= limit_price)) {
        await processOrder(userId, stock_symbol, quantity, order_action, limit_price, limit_price * quantity);
        await pool.query(
          'DELETE FROM pending_orders WHERE user_id = $1 AND stock_symbol = $2 AND order_action = $3 AND quantity = $4 AND order_type = $5 AND limit_price = $6',
          [userId, stock_symbol, order_action, quantity, 'limit', limit_price]
        );
        console.log('Order executed successfully.');
      } else {
        setTimeout(checkOrderStatus, 10000);
      }
    } catch (error) {
      console.error('Error checking order status:', error);
      await pool.query(
        'UPDATE pending_orders SET status = $1 WHERE user_id = $2 AND stock_symbol = $3 AND order_action = $4 AND quantity = $5 AND order_type = $6 AND limit_price = $7',
        ['fail', userId, stock_symbol, order_action, quantity, 'limit', limit_price]
      );
      console.log('Order failed.');
    }
  };

  setTimeout(checkOrderStatus, 4000);
}

module.exports = router;
