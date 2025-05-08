const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors()); // CORS universal, sem definir origem
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database setup
const db = new sqlite3.Database('./keys.db', (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    createTables();
    createAdminKey();
  }
});

function createTables() {
  db.run(`CREATE TABLE IF NOT EXISTS keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE,
    plan TEXT,
    createdAt TEXT,
    expiresAt TEXT,
    status TEXT
  )`);
}

function createAdminKey() {
  db.get("SELECT * FROM keys WHERE key = 'admin'", (err, row) => {
    if (!row) {
      const createdAt = new Date().toISOString();
      const expiresAt = '9999-12-31T23:59:59Z';
      db.run("INSERT INTO keys (key, plan, createdAt, expiresAt, status) VALUES (?, ?, ?, ?, ?)",
        ['admin', 'admin', createdAt, expiresAt, 'active'],
        (err) => {
          if (err) {
            console.error('Error creating admin key:', err.message);
          } else {
            console.log('Admin key created successfully');
          }
        });
    }
  });
}

// Helper functions
function generateKey() {
  return crypto.randomBytes(16).toString('hex');
}

function calculateExpirationDate(plan) {
  const now = new Date();
  const expiresAt = new Date(now);
  
  switch(plan) {
    case '7dias':
      expiresAt.setDate(now.getDate() + 7);
      break;
    case '15dias':
      expiresAt.setDate(now.getDate() + 15);
      break;
    case '30dias':
      expiresAt.setDate(now.getDate() + 30);
      break;
    case 'admin':
      return '9999-12-31T23:59:59Z';
    default:
      expiresAt.setDate(now.getDate() + 1); // Default 1 day
  }
  
  return expiresAt.toISOString();
}

// API Routes
app.post('/auth', (req, res) => {
  const { key } = req.body;
  
  if (!key) {
    return res.status(400).json({ success: false, message: 'Key is required' });
  }
  
  db.get("SELECT * FROM keys WHERE key = ? AND status = 'active'", [key], (err, row) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    
    if (!row) {
      return res.status(401).json({ success: false, message: 'Invalid or expired key' });
    }
    
    // Check if key is expired
    const expiresAt = new Date(row.expiresAt);
    const now = new Date();
    
    if (expiresAt < now && row.key !== 'admin') {
      // Update key status to expired
      db.run("UPDATE keys SET status = 'expired' WHERE key = ?", [key]);
      return res.status(401).json({ success: false, message: 'Key has expired' });
    }
    
    // Return key info if valid
    return res.json({
      success: true,
      message: 'Authentication successful',
      data: {
        key: row.key,
        plan: row.plan,
        expiresAt: row.expiresAt
      }
    });
  });
});

app.post('/generateKey', (req, res) => {
  const { plan } = req.body;
  
  if (!plan || !['7dias', '15dias', '30dias'].includes(plan)) {
    return res.status(400).json({ success: false, message: 'Valid plan is required (7dias, 15dias, or 30dias)' });
  }
  
  const key = generateKey();
  const createdAt = new Date().toISOString();
  const expiresAt = calculateExpirationDate(plan);
  
  db.run("INSERT INTO keys (key, plan, createdAt, expiresAt, status) VALUES (?, ?, ?, ?, ?)",
    [key, plan, createdAt, expiresAt, 'active'],
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, message: 'Error generating key', error: err.message });
      }
      
      return res.json({
        success: true,
        message: 'Key generated successfully',
        data: {
          key,
          plan,
          expiresAt
        }
      });
    }
  );
});

app.post('/payment', async (req, res) => {
  const { method, numero, nome, plan } = req.body;
  
  if (!method || !numero || !nome || !plan) {
    return res.status(400).json({ success: false, message: 'Missing required payment information' });
  }
  
  // Validate plan and get price
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
  
  try {
    // Configuration for payment API call
    const endpoint = method === 'emola' 
      ? 'https://mozpayment.co.mz/api/1.1/wf/pagamentorotativoemola'
      : 'https://mozpayment.co.mz/api/1.1/wf/pagamentorotativompesa';
    
    const paymentData = {
      carteira: '1746519798335x143095610732969980',
      numero: numero,
      quem_comprou: nome,
      valor: valor
    };
    
    // Make payment request
    const paymentResponse = await axios.post(endpoint, paymentData);
    
    // Process response based on payment method
    if (method === 'emola') {
      if (paymentResponse.data.success === 'yes') {
        // Generate key for successful payment
        const key = generateKey();
        const createdAt = new Date().toISOString();
        const expiresAt = calculateExpirationDate(plan);
        
        db.run("INSERT INTO keys (key, plan, createdAt, expiresAt, status) VALUES (?, ?, ?, ?, ?)",
          [key, plan, createdAt, expiresAt, 'active'],
          function(err) {
            if (err) {
              return res.status(500).json({ success: false, message: 'Error generating key', error: err.message });
            }
            
            return res.json({
              success: true,
              message: 'Payment successful. Key generated.',
              data: {
                key,
                plan,
                expiresAt
              }
            });
          }
        );
      } else {
        return res.status(400).json({ success: false, message: 'Payment failed' });
      }
    } else if (method === 'mpesa') {
      // MPesa returns HTTP status instead of success field
      if (paymentResponse.status === 200) {
        // Generate key for successful payment
        const key = generateKey();
        const createdAt = new Date().toISOString();
        const expiresAt = calculateExpirationDate(plan);
        
        db.run("INSERT INTO keys (key, plan, createdAt, expiresAt, status) VALUES (?, ?, ?, ?, ?)",
          [key, plan, createdAt, expiresAt, 'active'],
          function(err) {
            if (err) {
              return res.status(500).json({ success: false, message: 'Error generating key', error: err.message });
            }
            
            return res.json({
              success: true,
              message: 'Payment successful. Key generated.',
              data: {
                key,
                plan,
                expiresAt
              }
            });
          }
        );
      } else {
        let errorMessage = 'Payment failed';
        switch (paymentResponse.status) {
          case 201:
            errorMessage = 'Erro na Transação';
            break;
          case 422:
            errorMessage = 'Saldo Insuficiente';
            break;
          case 400:
            errorMessage = 'PIN Errado';
            break;
        }
        return res.status(paymentResponse.status).json({ success: false, message: errorMessage });
      }
    }
  } catch (error) {
    console.error('Payment error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Error processing payment',
      error: error.message
    });
  }
});

// Get signal (requires valid key)
app.post('/generateSignal', (req, res) => {
  const { key } = req.body;
  
  if (!key) {
    return res.status(400).json({ success: false, message: 'Key is required' });
  }
  
  db.get("SELECT * FROM keys WHERE key = ? AND status = 'active'", [key], (err, row) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    
    if (!row) {
      return res.status(401).json({ success: false, message: 'Invalid or expired key' });
    }
    
    // Check if key is expired
    const expiresAt = new Date(row.expiresAt);
    const now = new Date();
    
    if (expiresAt < now && row.key !== 'admin') {
      // Update key status to expired
      db.run("UPDATE keys SET status = 'expired' WHERE key = ?", [key]);
      return res.status(401).json({ success: false, message: 'Key has expired' });
    }
    
    // Generate 5x5 grid signal
    const grid = generateMineGrid();
    
    return res.json({
      success: true,
      message: 'Signal generated successfully',
      data: {
        grid,
        timestamp: new Date().toISOString(),
        expiresIn: 300 // 5 minutes in seconds
      }
    });
  });
});

// Generate 5x5 grid with safety levels
function generateMineGrid() {
  const grid = [];
  const safetyLevels = ['safe', 'medium', 'risky']; // green, orange, red
  
  for (let i = 0; i < 5; i++) {
    const row = [];
    for (let j = 0; j < 5; j++) {
      // Randomly assign safety level with weighted probability
      // 60% safe, 30% medium, 10% risky
      const random = Math.random();
      let safety;
      if (random < 0.6) {
        safety = 'safe';
      } else if (random < 0.9) {
        safety = 'medium';
      } else {
        safety = 'risky';
      }
      
      row.push({
        row: i,
        col: j,
        safety
      });
    }
    grid.push(row);
  }
  
  return grid;
}

// Server start
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Clean up database connection on exit
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Closed the database connection.');
    process.exit(0);
  });
});
