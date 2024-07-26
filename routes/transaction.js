const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const pool = require('../db/config');


router.get('/transaction', authMiddleware, async (req, res) => {
    const userId = req.session.userId;
  
    if (!userId) {
      return res.status(403).send('Not authorized');
    }
  
    try {
      const transactionsResult = await pool.query('SELECT * FROM transactions WHERE user_id = $1', [userId]);
      const pendingOrdersResult = await pool.query('SELECT * FROM pending_orders WHERE user_id = $1', [userId]);
  
      const transactions = transactionsResult.rows.sort((a, b) => new Date(b.transaction_date) - new Date(a.transaction_date));
      const pendingOrders = pendingOrdersResult.rows.sort((a, b) => new Date(b.order_date) - new Date(a.order_date));
  
      res.render('transaction', { transactions, pendingOrders });
    } catch (err) {
      console.error(err);
      res.status(500).send('Server error');
    }
  });
  

module.exports = router;