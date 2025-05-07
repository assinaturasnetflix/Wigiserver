const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors()); // CORS universal, sem definir origem
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize SQLite database
let db;

async function initializeDatabase() {
  db = await open({
    filename: './keys.db',
    driver: sqlite3.Database
  });

  // Create keys table if it doesn't exist
  await db.exec(`
    CREATE TABLE IF NOT EXISTS keys (
      id INTEGER PRIMARY KEY,
      key TEXT,
      plan TEXT,
      createdAt TEXT,
      expiresAt TEXT,
      status TEXT
    )
  `);

  // Create admin key if it doesn't exist
  const adminKey = await db.get("SELECT * FROM keys WHERE key = 'admin'");
  if (!adminKey) {
    const createdAt = new Date().toISOString();
    const expiresAt = '9999-12-31T23:59:59Z';
    await db.run(
      "INSERT INTO keys (key, plan, createdAt, expiresAt, status) VALUES (?, ?, ?, ?, ?)",
      ['admin', 'admin', createdAt, expiresAt, 'active']
    );
    console.log('Admin key created successfully');
  }
}

// Generate a unique key
function generateUniqueKey() {
  return crypto.randomBytes(8).toString('hex');
}

// Calculate expiration date based on plan
function calculateExpirationDate(plan) {
  const today = new Date();
  let expirationDate = new Date(today);
  
  switch (plan) {
    case '7dias':
      expirationDate.setDate(today.getDate() + 7);
      break;
    case '15dias':
      expirationDate.setDate(today.getDate() + 15);
      break;
    case '30dias':
      expirationDate.setDate(today.getDate() + 30);
      break;
    default:
      expirationDate.setDate(today.getDate() + 1); // Default 1 day
  }
  
  return expirationDate.toISOString();
}

// Verify if key is valid
app.post('/auth', async (req, res) => {
  try {
    const { key } = req.body;
    
    if (!key) {
      return res.status(400).json({ success: false, message: 'Key is required' });
    }
    
    const keyRecord = await db.get(
      "SELECT * FROM keys WHERE key = ? AND status = 'active' AND datetime(expiresAt) > datetime('now')",
      [key]
    );
    
    if (!keyRecord) {
      return res.status(401).json({ success: false, message: 'Invalid or expired key' });
    }
    
    return res.status(200).json({
      success: true,
      plan: keyRecord.plan,
      expiresAt: keyRecord.expiresAt
    });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Process payment and generate key
app.post('/payment', async (req, res) => {
  try {
    const { paymentMethod, numero, quem_comprou, plan } = req.body;
    
    if (!paymentMethod || !numero || !quem_comprou || !plan) {
      return res.status(400).json({ success: false, message: 'Missing required payment information' });
    }
    
    // Determine price based on plan
    let valor;
    switch (plan) {
      case '7dias':
        valor = '300';
        break;
      case '15dias':
        valor = '700';
        break;
      case '30dias':
        valor = '1200';
        break;
      default:
        return res.status(400).json({ success: false, message: 'Invalid plan' });
    }
    
    // Prepare payment data
    const paymentData = {
      carteira: "1746519798335x143095610732969980",
      numero: numero,
      quem_comprou: quem_comprou,
      valor: valor
    };
    
    // Select API endpoint based on payment method
    const apiEndpoint = paymentMethod === 'emola' 
      ? 'https://mozpayment.co.mz/api/1.1/wf/pagamentorotativoemola'
      : 'https://mozpayment.co.mz/api/1.1/wf/pagamentorotativompesa';
    
    // Make payment request
    const response = await axios.post(apiEndpoint, paymentData);
    
    // Check payment success
    let paymentSuccess = false;
    if (paymentMethod === 'emola' && response.data && response.data.success === 'yes') {
      paymentSuccess = true;
    } else if (paymentMethod === 'mpesa' && response.status === 200) {
      paymentSuccess = true;
    }
    
    if (!paymentSuccess) {
      return res.status(400).json({ success: false, message: 'Payment failed' });
    }
    
    // Generate key after successful payment
    const newKey = generateUniqueKey();
    const createdAt = new Date().toISOString();
    const expiresAt = calculateExpirationDate(plan);
    
    // Save key to database
    await db.run(
      "INSERT INTO keys (key, plan, createdAt, expiresAt, status) VALUES (?, ?, ?, ?, ?)",
      [newKey, plan, createdAt, expiresAt, 'active']
    );
    
    return res.status(200).json({
      success: true,
      key: newKey,
      plan: plan,
      expiresAt: expiresAt
    });
  } catch (error) {
    console.error('Payment error:', error);
    res.status(500).json({ success: false, message: 'Payment processing error' });
  }
});

// Generate key endpoint for admin use
app.post('/generateKey', async (req, res) => {
  try {
    const { adminKey, plan } = req.body;
    
    if (!adminKey || adminKey !== 'admin' || !plan) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const newKey = generateUniqueKey();
    const createdAt = new Date().toISOString();
    const expiresAt = calculateExpirationDate(plan);
    
    await db.run(
      "INSERT INTO keys (key, plan, createdAt, expiresAt, status) VALUES (?, ?, ?, ?, ?)",
      [newKey, plan, createdAt, expiresAt, 'active']
    );
    
    return res.status(200).json({
      success: true,
      key: newKey,
      plan: plan,
      expiresAt: expiresAt
    });
  } catch (error) {
    console.error('Generate key error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get game signals endpoint - this will be used to generate the mine pattern
app.post('/getSignal', async (req, res) => {
  try {
    const { key } = req.body;
    
    if (!key) {
      return res.status(400).json({ success: false, message: 'Key is required' });
    }
    
    const keyRecord = await db.get(
      "SELECT * FROM keys WHERE key = ? AND status = 'active' AND datetime(expiresAt) > datetime('now')",
      [key]
    );
    
    if (!keyRecord) {
      return res.status(401).json({ success: false, message: 'Invalid or expired key' });
    }
    
    // Generate a random 5x5 grid with safe (1), medium (2), and risky (3) cells
    const grid = Array(5).fill().map(() => Array(5).fill(0));
    
    // Generate at least 10 safe spots
    let safeCount = 0;
    while (safeCount < 10) {
      const x = Math.floor(Math.random() * 5);
      const y = Math.floor(Math.random() * 5);
      if (grid[x][y] === 0) {
        grid[x][y] = 1; // Safe
        safeCount++;
      }
    }
    
    // Generate some medium risk spots
    let mediumCount = 0;
    while (mediumCount < 8) {
      const x = Math.floor(Math.random() * 5);
      const y = Math.floor(Math.random() * 5);
      if (grid[x][y] === 0) {
        grid[x][y] = 2; // Medium
        mediumCount++;
      }
    }
    
    // Fill remaining with risky spots
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        if (grid[i][j] === 0) {
          grid[i][j] = 3; // Risky
        }
      }
    }
    
    return res.status(200).json({
      success: true,
      grid: grid,
      expiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString() // Signal expires in 2 minutes
    });
  } catch (error) {
    console.error('Get signal error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Initialize database and start server
initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Database initialization error:', err);
  });
