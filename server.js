const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const app = express();

// Middleware
app.use(cors()); // CORS universal, sem definir origem
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database setup
const db = new sqlite3.Database('./keys.db', (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    
    // Create tables if they don't exist
    db.run(`
      CREATE TABLE IF NOT EXISTS keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE,
        plan TEXT,
        createdAt TEXT,
        expiresAt TEXT,
        status TEXT
      )
    `, (err) => {
      if (err) {
        console.error('Error creating keys table', err.message);
      } else {
        // Check if admin key exists, if not create it
        db.get("SELECT * FROM keys WHERE key = 'admin'", (err, row) => {
          if (err) {
            console.error('Error checking admin key', err.message);
          } else if (!row) {
            const createdAt = new Date().toISOString();
            const expiresAt = '9999-12-31T23:59:59Z';
            db.run("INSERT INTO keys (key, plan, createdAt, expiresAt, status) VALUES (?, ?, ?, ?, ?)", 
                  ['admin', 'admin', createdAt, expiresAt, 'active'],
                  (err) => {
                    if (err) {
                      console.error('Error creating admin key', err.message);
                    } else {
                      console.log('Admin key created successfully');
                    }
                  });
          } else {
            console.log('Admin key already exists');
          }
        });
      }
    });
  }
});

// Helper function to check if a key is valid
const isKeyValid = (key) => {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM keys WHERE key = ? AND status = 'active'", [key], (err, row) => {
      if (err) {
        reject(err);
      } else if (!row) {
        resolve({ valid: false });
      } else {
        const now = new Date();
        const expiresAt = new Date(row.expiresAt);
        
        if (now > expiresAt) {
          // Update key status to expired
          db.run("UPDATE keys SET status = 'expired' WHERE key = ?", [key], (err) => {
            if (err) console.error('Error updating key status', err.message);
          });
          resolve({ valid: false, reason: 'expired' });
        } else {
          resolve({ 
            valid: true, 
            plan: row.plan, 
            expiresAt: row.expiresAt,
            timeLeft: Math.floor((expiresAt - now) / (1000 * 60 * 60 * 24)) // days left
          });
        }
      }
    });
  });
};

// Helper function to calculate expiry date based on plan
const calculateExpiryDate = (plan) => {
  const now = new Date();
  const expiresAt = new Date(now);
  
  switch (plan) {
    case '7dias':
      expiresAt.setDate(now.getDate() + 7);
      break;
    case '15dias':
      expiresAt.setDate(now.getDate() + 15);
      break;
    case '30dias':
      expiresAt.setDate(now.getDate() + 30);
      break;
    default:
      expiresAt.setDate(now.getDate() + 1); // Default 1 day for unknown plans
  }
  
  return expiresAt.toISOString();
};

// Authentication endpoint
app.post('/auth', async (req, res) => {
  try {
    const { key } = req.body;
    
    if (!key) {
      return res.status(400).json({ success: false, message: 'Key is required' });
    }
    
    const keyStatus = await isKeyValid(key);
    
    if (keyStatus.valid) {
      res.json({ 
        success: true, 
        message: 'Key is valid', 
        plan: keyStatus.plan, 
        expiresAt: keyStatus.expiresAt,
        timeLeft: keyStatus.timeLeft
      });
    } else {
      res.json({ 
        success: false, 
        message: keyStatus.reason === 'expired' ? 'Key has expired' : 'Invalid key'
      });
    }
  } catch (error) {
    console.error('Error in authentication', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Generate mining pattern endpoint
app.post('/generateSignal', async (req, res) => {
  try {
    const { key } = req.body;
    
    if (!key) {
      return res.status(400).json({ success: false, message: 'Key is required' });
    }
    
    const keyStatus = await isKeyValid(key);
    
    if (!keyStatus.valid) {
      return res.json({ 
        success: false, 
        message: keyStatus.reason === 'expired' ? 'Key has expired' : 'Invalid key'
      });
    }
    
    // Generate 5x5 mine pattern (25 cells)
    const pattern = [];
    for (let i = 0; i < 25; i++) {
      // Random pattern: 0 = safe (green), 1 = medium (orange), 2 = risky (red)
      const riskLevel = Math.floor(Math.random() * 3);
      pattern.push(riskLevel);
    }
    
    res.json({ 
      success: true,
      pattern: pattern
    });
  } catch (error) {
    console.error('Error generating signal', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Generate key after payment
app.post('/generateKey', async (req, res) => {
  try {
    const { plan } = req.body;
    
    if (!plan || !['7dias', '15dias', '30dias'].includes(plan)) {
      return res.status(400).json({ success: false, message: 'Valid plan is required' });
    }
    
    // Generate a unique key using UUID
    const key = uuidv4();
    const createdAt = new Date().toISOString();
    const expiresAt = calculateExpiryDate(plan);
    
    // Save key to database
    db.run("INSERT INTO keys (key, plan, createdAt, expiresAt, status) VALUES (?, ?, ?, ?, ?)",
          [key, plan, createdAt, expiresAt, 'active'],
          (err) => {
            if (err) {
              console.error('Error saving key', err.message);
              return res.status(500).json({ success: false, message: 'Error saving key' });
            }
            
            res.json({ 
              success: true, 
              message: 'Key generated successfully', 
              key: key,
              plan: plan,
              expiresAt: expiresAt
            });
          });
  } catch (error) {
    console.error('Error generating key', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Process MPesa payment
app.post('/payment/mpesa', async (req, res) => {
  try {
    const { numero, quem_comprou, valor, plan } = req.body;
    
    if (!numero || !quem_comprou || !valor || !plan) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    
    // Validate plan and amount
    let expectedAmount;
    switch (plan) {
      case '7dias':
        expectedAmount = '300';
        break;
      case '15dias':
        expectedAmount = '700';
        break;
      case '30dias':
        expectedAmount = '1200';
        break;
      default:
        return res.status(400).json({ success: false, message: 'Invalid plan' });
    }
    
    if (valor !== expectedAmount) {
      return res.status(400).json({ 
        success: false, 
        message: `Incorrect amount. The cost for ${plan} is ${expectedAmount} MT`
      });
    }
    
    // Process MPesa payment
    try {
      const response = await axios.post('https://mozpayment.co.mz/api/1.1/wf/pagamentorotativompesa', {
        carteira: '1746519798335x143095610732969980',
        numero: numero,
        quem_comprou: quem_comprou,
        valor: valor
      });
      
      // Check response status
      if (response.status === 200) {
        // Generate a new key
        const key = uuidv4();
        const createdAt = new Date().toISOString();
        const expiresAt = calculateExpiryDate(plan);
        
        // Save key to database
        db.run("INSERT INTO keys (key, plan, createdAt, expiresAt, status) VALUES (?, ?, ?, ?, ?)",
              [key, plan, createdAt, expiresAt, 'active'],
              (err) => {
                if (err) {
                  console.error('Error saving key', err.message);
                  return res.status(500).json({ success: false, message: 'Error saving key' });
                }
                
                res.json({ 
                  success: true, 
                  message: 'Payment successful and key generated', 
                  key: key,
                  plan: plan,
                  expiresAt: expiresAt
                });
              });
      } else if (response.status === 201) {
        res.status(400).json({ success: false, message: 'Transaction error' });
      } else if (response.status === 422) {
        res.status(400).json({ success: false, message: 'Insufficient balance' });
      } else if (response.status === 400) {
        res.status(400).json({ success: false, message: 'Wrong PIN' });
      } else {
        res.status(400).json({ success: false, message: 'Payment failed' });
      }
    } catch (error) {
      console.error('MPesa API error', error);
      res.status(500).json({ success: false, message: 'Payment processing error' });
    }
  } catch (error) {
    console.error('Error processing MPesa payment', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Process eMola payment
app.post('/payment/emola', async (req, res) => {
  try {
    const { numero, quem_comprou, valor, plan } = req.body;
    
    if (!numero || !quem_comprou || !valor || !plan) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    
    // Validate plan and amount
    let expectedAmount;
    switch (plan) {
      case '7dias':
        expectedAmount = '300';
        break;
      case '15dias':
        expectedAmount = '700';
        break;
      case '30dias':
        expectedAmount = '1200';
        break;
      default:
        return res.status(400).json({ success: false, message: 'Invalid plan' });
    }
    
    if (valor !== expectedAmount) {
      return res.status(400).json({ 
        success: false, 
        message: `Incorrect amount. The cost for ${plan} is ${expectedAmount} MT`
      });
    }
    
    // Process eMola payment
    try {
      const response = await axios.post('https://mozpayment.co.mz/api/1.1/wf/pagamentorotativoemola', {
        carteira: '1746519798335x143095610732969980',
        numero: numero,
        quem_comprou: quem_comprou,
        valor: valor
      });
      
      // Check response
      if (response.data && response.data.success === 'yes') {
        // Generate a new key
        const key = uuidv4();
        const createdAt = new Date().toISOString();
        const expiresAt = calculateExpiryDate(plan);
        
        // Save key to database
        db.run("INSERT INTO keys (key, plan, createdAt, expiresAt, status) VALUES (?, ?, ?, ?, ?)",
              [key, plan, createdAt, expiresAt, 'active'],
              (err) => {
                if (err) {
                  console.error('Error saving key', err.message);
                  return res.status(500).json({ success: false, message: 'Error saving key' });
                }
                
                res.json({ 
                  success: true, 
                  message: 'Payment successful and key generated', 
                  key: key,
                  plan: plan,
                  expiresAt: expiresAt
                });
              });
      } else {
        res.status(400).json({ success: false, message: 'Payment failed' });
      }
    } catch (error) {
      console.error('eMola API error', error);
      res.status(500).json({ success: false, message: 'Payment processing error' });
    }
  } catch (error) {
    console.error('Error processing eMola payment', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
