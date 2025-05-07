// server.js - Backend para o sistema AC MINES HACK
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const crypto = require('crypto');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors({
  origin: 'https://acmineshackmoz.netlify.app/', // Substituir pelo domínio real do frontend
  methods: ['GET', 'POST'],
  credentials: true
}));

// Configuração do banco de dados SQLite
let db;

// Inicialização do banco de dados
async function initializeDatabase() {
  db = await open({
    filename: './keys.db',
    driver: sqlite3.Database
  });

  // Criar tabela de chaves se não existir
  await db.exec(`
    CREATE TABLE IF NOT EXISTS keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE,
      plan TEXT,
      createdAt TEXT,
      expiresAt TEXT,
      status TEXT
    )
  `);

  // Verificar e adicionar chave admin se não existir
  const adminKey = await db.get("SELECT * FROM keys WHERE key = 'admin'");
  if (!adminKey) {
    const createdAt = new Date().toISOString();
    const expiresAt = '9999-12-31T23:59:59Z';
    await db.run(
      "INSERT INTO keys (key, plan, createdAt, expiresAt, status) VALUES (?, ?, ?, ?, ?)",
      ['admin', 'admin', createdAt, expiresAt, 'active']
    );
    console.log('Chave admin criada com sucesso!');
  }
}

// Função para gerar uma chave aleatória
function generateRandomKey(length = 16) {
  return crypto.randomBytes(length).toString('hex');
}

// Função para calcular a data de expiração com base no plano
function calculateExpirationDate(plan) {
  const now = new Date();
  switch (plan) {
    case '7':
      now.setDate(now.getDate() + 7);
      break;
    case '15':
      now.setDate(now.getDate() + 15);
      break;
    case '30':
      now.setDate(now.getDate() + 30);
      break;
    default:
      throw new Error('Plano inválido');
  }
  return now.toISOString();
}

// Função para verificar se o valor do plano está correto
function validatePlanAmount(plan, amount) {
  const planPrices = {
    '7': 300,
    '15': 700,
    '30': 1200
  };
  
  return planPrices[plan] === parseInt(amount, 10);
}

// Endpoint para autenticação de chave
app.post('/auth', async (req, res) => {
  try {
    const { key } = req.body;
    
    if (!key) {
      return res.status(400).json({ success: false, message: 'Chave não fornecida' });
    }
    
    const keyData = await db.get("SELECT * FROM keys WHERE key = ?", [key]);
    
    if (!keyData) {
      return res.status(404).json({ success: false, message: 'Chave não encontrada' });
    }
    
    const now = new Date();
    const expiresAt = new Date(keyData.expiresAt);
    
    if (now > expiresAt) {
      await db.run("UPDATE keys SET status = 'expired' WHERE key = ?", [key]);
      return res.status(401).json({ success: false, message: 'Chave expirada' });
    }
    
    if (keyData.status !== 'active') {
      return res.status(401).json({ success: false, message: 'Chave inativa' });
    }
    
    // Cálculo do tempo restante em segundos
    const remainingTime = Math.floor((expiresAt - now) / 1000);
    
    return res.json({
      success: true,
      message: 'Autenticação bem-sucedida',
      data: {
        key: keyData.key,
        plan: keyData.plan,
        expiresAt: keyData.expiresAt,
        remainingTime
      }
    });
  } catch (error) {
    console.error('Erro na autenticação:', error);
    return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

// Endpoint para gerar uma nova chave após pagamento
app.post('/generateKey', async (req, res) => {
  try {
    const { plan, paymentId } = req.body;
    
    if (!plan || !['7', '15', '30'].includes(plan)) {
      return res.status(400).json({ success: false, message: 'Plano inválido' });
    }
    
    if (!paymentId) {
      return res.status(400).json({ success: false, message: 'ID de pagamento não fornecido' });
    }
    
    // Verificar se o pagamento existe e está confirmado
    // Na implementação real, você deve verificar o status do pagamento no banco de dados
    // ou fazer uma chamada para o serviço de pagamento para verificar

    // Gerar uma nova chave
    const newKey = generateRandomKey();
    const createdAt = new Date().toISOString();
    const expiresAt = calculateExpirationDate(plan);
    
    // Salvar a nova chave no banco de dados
    await db.run(
      "INSERT INTO keys (key, plan, createdAt, expiresAt, status) VALUES (?, ?, ?, ?, ?)",
      [newKey, plan, createdAt, expiresAt, 'active']
    );
    
    return res.json({
      success: true,
      message: 'Chave gerada com sucesso',
      data: {
        key: newKey,
        plan,
        createdAt,
        expiresAt
      }
    });
  } catch (error) {
    console.error('Erro ao gerar chave:', error);
    return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

// Endpoint para processar pagamentos via MPesa
app.post('/payment/mpesa', async (req, res) => {
  try {
    const { numero, quem_comprou, plan } = req.body;
    
    if (!numero || !quem_comprou || !plan) {
      return res.status(400).json({ success: false, message: 'Dados incompletos' });
    }
    
    // Verificar se o plano é válido
    if (!['7', '15', '30'].includes(plan)) {
      return res.status(400).json({ success: false, message: 'Plano inválido' });
    }
    
    // Determinar o valor com base no plano
    let valor;
    switch (plan) {
      case '7':
        valor = '300';
        break;
      case '15':
        valor = '700';
        break;
      case '30':
        valor = '1200';
        break;
    }
    
    // Chamada real para a API de pagamento MPesa
    const response = await axios.post('https://mozpayment.co.mz/api/1.1/wf/pagamentorotativompesa', {
      carteira: "1746519798335x143095610732969980",
      numero,
      quem_comprou,
      valor
    });
    
    // Verificar a resposta da API
    if (response.data && response.status === 200) {
      // Gerar uma nova chave
      const newKey = generateRandomKey();
      const createdAt = new Date().toISOString();
      const expiresAt = calculateExpirationDate(plan);
      
      // Salvar a nova chave e os dados do pagamento no banco de dados
      const paymentId = response.data.paymentId || crypto.randomBytes(8).toString('hex');
      
      await db.run(
        "INSERT INTO keys (key, plan, createdAt, expiresAt, status) VALUES (?, ?, ?, ?, ?)",
        [newKey, plan, createdAt, expiresAt, 'active']
      );
      
      // Ideal: Salvar também os dados do pagamento em outra tabela
      
      return res.json({
        success: true,
        message: 'Pagamento processado com sucesso',
        data: {
          key: newKey,
          plan,
          expiresAt,
          paymentId
        }
      });
    } else {
      return res.status(400).json({ 
        success: false, 
        message: 'Falha no processamento do pagamento',
        error: response.data
      });
    }
  } catch (error) {
    console.error('Erro no processamento do pagamento MPesa:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Erro interno do servidor',
      error: error.message
    });
  }
});

// Endpoint para processar pagamentos via eMola
app.post('/payment/emola', async (req, res) => {
  try {
    const { numero, quem_comprou, plan } = req.body;
    
    if (!numero || !quem_comprou || !plan) {
      return res.status(400).json({ success: false, message: 'Dados incompletos' });
    }
    
    // Verificar se o plano é válido
    if (!['7', '15', '30'].includes(plan)) {
      return res.status(400).json({ success: false, message: 'Plano inválido' });
    }
    
    // Determinar o valor com base no plano
    let valor;
    switch (plan) {
      case '7':
        valor = '300';
        break;
      case '15':
        valor = '700';
        break;
      case '30':
        valor = '1200';
        break;
    }
    
    // Chamada real para a API de pagamento eMola
    const response = await axios.post('https://mozpayment.co.mz/api/1.1/wf/pagamentorotativoemola', {
      carteira: "1746519798335x143095610732969980",
      numero,
      quem_comprou,
      valor
    });
    
    // Verificar a resposta da API
    if (response.data && response.data.success === "yes") {
      // Gerar uma nova chave
      const newKey = generateRandomKey();
      const createdAt = new Date().toISOString();
      const expiresAt = calculateExpirationDate(plan);
      
      // Salvar a nova chave e os dados do pagamento no banco de dados
      const paymentId = response.data.paymentId || crypto.randomBytes(8).toString('hex');
      
      await db.run(
        "INSERT INTO keys (key, plan, createdAt, expiresAt, status) VALUES (?, ?, ?, ?, ?)",
        [newKey, plan, createdAt, expiresAt, 'active']
      );
      
      // Ideal: Salvar também os dados do pagamento em outra tabela
      
      return res.json({
        success: true,
        message: 'Pagamento processado com sucesso',
        data: {
          key: newKey,
          plan,
          expiresAt,
          paymentId
        }
      });
    } else {
      return res.status(400).json({ 
        success: false, 
        message: 'Falha no processamento do pagamento',
        error: response.data
      });
    }
  } catch (error) {
    console.error('Erro no processamento do pagamento eMola:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Erro interno do servidor',
      error: error.message
    });
  }
});

// Endpoint para gerar um sinal (após autenticação)
app.post('/generateSignal', async (req, res) => {
  try {
    const { key } = req.body;
    
    if (!key) {
      return res.status(400).json({ success: false, message: 'Chave não fornecida' });
    }
    
    // Verificar se a chave existe e está ativa
    const keyData = await db.get("SELECT * FROM keys WHERE key = ? AND status = 'active'", [key]);
    
    if (!keyData) {
      return res.status(404).json({ success: false, message: 'Chave inválida ou expirada' });
    }
    
    const now = new Date();
    const expiresAt = new Date(keyData.expiresAt);
    
    if (now > expiresAt) {
      await db.run("UPDATE keys SET status = 'expired' WHERE key = ?", [key]);
      return res.status(401).json({ success: false, message: 'Chave expirada' });
    }
    
    // Gerar um sinal aleatório para o tabuleiro 5x5
    const board = [];
    for (let i = 0; i < 5; i++) {
      const row = [];
      for (let j = 0; j < 5; j++) {
        // Gerar probabilidade aleatória (0-100%)
        const probability = Math.floor(Math.random() * 101);
        
        // Determinar se é seguro ou arriscado
        const isSafe = probability > 50;
        
        row.push({
          x: j,
          y: i,
          probability,
          isSafe
        });
      }
      board.push(row);
    }
    
    return res.json({
      success: true,
      message: 'Sinal gerado com sucesso',
      data: {
        board,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Erro ao gerar sinal:', error);
    return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

// Inicializar o banco de dados e iniciar o servidor
initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Erro ao inicializar o banco de dados:', err);
    process.exit(1);
  });
