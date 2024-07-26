const express = require('express');
const pool = require('../db/config');
const authMiddleware = require('../middleware/authMiddleware');

// Use dynamic import for node-fetch
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const router = express.Router();

// Function to fetch market price for a given stock symbol
async function getMarketPrice(stock_symbol) {
    try {
        const apiUrl = `https://api.binance.com/api/v3/ticker/price?symbol=${stock_symbol}`;
        const response = await fetch(apiUrl);
        const data = await response.json();
        if (data && data.price) {
            return parseFloat(data.price);
        } else {
            console.error(`Failed to fetch price for ${stock_symbol}: `, data);
            return null;
        }
    } catch (error) {
        console.error('Error fetching market price:', error);
        return null;
    }
}

// Function to fetch and calculate holdings data for a user
async function fetchHoldingsData(userId) {
    const userResult = await pool.query('SELECT balance FROM users WHERE user_id = $1', [userId]);
    if (userResult.rows.length === 0) {
        throw new Error('User not found');
    }
    const balance = userResult.rows[0].balance;

    const holdingsResult = await pool.query('SELECT stock_symbol, quantity, invested, average_price FROM holdings WHERE user_id = $1', [userId]);
    const holdings = holdingsResult.rows;

    let totalInvested = 0;
    let totalCurrent = 0;
    let totalReturn = 0;

    // Fetch current prices for all holdings
    await Promise.all(holdings.map(async holding => {
        holding.current_price = await getMarketPrice(holding.stock_symbol);
        if (!holding.current_price) {
            console.error(`Failed to get current price for ${holding.stock_symbol}`);
            holding.current_price = 0;
        }
    }));

    // Calculate summary data
    holdings.forEach(holding => {
        totalInvested += parseFloat(holding.invested) || 0;
        const currentValue = (holding.quantity * holding.current_price) || 0;
        totalCurrent += currentValue;
        holding.current_return = currentValue - (holding.invested || 0);
        holding.current_return_percentage = ((currentValue - (holding.invested || 0)) / (holding.invested || 1)) * 100;
        totalReturn += holding.current_return;
    });

    const totalReturnPercentage = (totalReturn / (totalInvested || 1)) * 100;

    return {
        balance,
        holdings,
        totalInvested: totalInvested.toFixed(2),
        totalCurrent: totalCurrent.toFixed(2),
        totalReturn: totalReturn.toFixed(2),
        totalReturnPercentage: totalReturnPercentage.toFixed(2)
    };
}

// Global object to store the latest data for each user
let latestData = {};
let updateInProgress = {};

// Function to update holdings data for a user
async function updateHoldingsData(userId) {
    if (updateInProgress[userId]) {
        return;
    }
    updateInProgress[userId] = true;
    try {
        latestData[userId] = await fetchHoldingsData(userId);
    } catch (error) {
        console.error('Error updating holdings data:', error);
    } finally {
        updateInProgress[userId] = false;
    }
}

// Route to get holdings data and render holdings page
router.get('/holdings', authMiddleware, async (req, res) => {
    const userId = req.session.userId;
    const username = req.session.username;

    if (!userId) {
        return res.status(403).send('Not authorized');
    }

    if (!latestData[userId]) {
        await updateHoldingsData(userId);
    }

    const data = latestData[userId];

    res.render('holdings', {
        username,
        balance: data.balance,
        holdings: data.holdings,
        totalInvested: data.totalInvested,
        totalCurrent: data.totalCurrent,
        totalReturn: data.totalReturn,
        totalReturnPercentage: data.totalReturnPercentage
    });
});

// Route to get holdings data as JSON
router.get('/holdings/data', authMiddleware, async (req, res) => {
    const userId = req.session.userId;

    if (!userId) {
        return res.status(403).send('Not authorized');
    }

    await updateHoldingsData(userId);

    const data = latestData[userId];

    res.json(data);
});

// Exporting functions and router
module.exports = {
    updateHoldingsData,
    latestData,
    router
};
