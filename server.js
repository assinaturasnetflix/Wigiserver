const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const path = require('path');

// Configuração do app Express
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuração do banco de dados SQLite
const db = new sqlite3.Database('./keys.db');

// Criar tabela se não existir
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    key TEXT UNIQUE, 
    plan TEXT, 
    createdAt TEXT, 
    expiresAt TEXT, 
    status TEXT)`
  );

  // Inserir chave admin se não existir
  db.get("SELECT * FROM keys WHERE key = 'admin'", (err, row) => {
    if (!row) {
      const createdAt = new Date().toISOString();
      const expiresAt = '9999-12-31T23:59:59Z';
      db.run("INSERT INTO keys (key, plan, createdAt, expiresAt, status) VALUES (?, ?, ?, ?, ?)", 
        ['admin', 'admin', createdAt, expiresAt, 'active']);
      console.log('Chave admin criada com sucesso!');
    }
  });
});

// Função auxiliar para calcular data de expiração baseada no plano
function calculateExpirationDate(plan) {
  const now = new Date();
  const expiresAt = new Date(now);
  
  switch(plan) {
    case '7':
      expiresAt.setDate(now.getDate() + 7);
      break;
    case '15':
      expiresAt.setDate(now.getDate() + 15);
      break;
    case '30':
      expiresAt.setDate(now.getDate() + 30);
      break;
    default:
      expiresAt.setDate(now.getDate() + 7); // Padrão para 7 dias
  }
  
  return expiresAt.toISOString();
}

// Função para validar o valor do plano
function validatePlanValue(plan, value) {
  const planValues = {
    '7': 300,
    '15': 700,
    '30': 1200
  };
  
  return planValues[plan] === parseInt(value);
}

// Endpoint para autenticação
app.post('/auth', (req, res) => {
  const { key } = req.body;
  
  if (!key) {
    return res.status(400).json({ success: false, message: 'Chave não fornecida' });
  }
  
  db.get('SELECT * FROM keys WHERE key = ?', [key], (err, row) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
    
    if (!row) {
      return res.status(404).json({ success: false, message: 'Chave inválida' });
    }
    
    // Verificar se a chave expirou
    const expiresAt = new Date(row.expiresAt);
    const currentDate = new Date();
    
    if (expiresAt < currentDate && row.key !== 'admin') {
      return res.status(401).json({ success: false, message: 'Chave expirada' });
    }
    
    // Chave válida
    return res.json({
      success: true,
      key: row.key,
      plan: row.plan,
      expiresAt: row.expiresAt
    });
  });
});

// Endpoint para processamento de pagamentos e geração de chave
app.post('/payment', async (req, res) => {
  const { paymentMethod, numero, nome, plan, valor } = req.body;
  
  // Validar dados recebidos
  if (!paymentMethod || !numero || !nome || !plan || !valor) {
    return res.status(400).json({ 
      success: false, 
      message: 'Dados incompletos' 
    });
  }
  
  // Validar se o valor corresponde ao plano selecionado
  if (!validatePlanValue(plan, valor)) {
    return res.status(400).json({ 
      success: false, 
      message: 'Valor incorreto para o plano selecionado' 
    });
  }
  
  try {
    // Definir a URL da API com base no método de pagamento
    const apiUrl = paymentMethod === 'emola' 
      ? 'https://mozpayment.co.mz/api/1.1/wf/pagamentorotativoemola'
      : 'https://mozpayment.co.mz/api/1.1/wf/pagamentorotativompesa';
    
    // Dados para o pagamento
    const paymentData = {
      carteira: "1746519798335x143095610732969980",
      numero: numero,
      quem_comprou: nome,
      valor: valor
    };
    
    // Fazer a requisição para a API de pagamento
    const response = await axios.post(apiUrl, paymentData);
    
    // Verificar resposta com base no método de pagamento
    let paymentSuccess = false;
    
    if (paymentMethod === 'emola' && response.data.success === "yes") {
      paymentSuccess = true;
    } else if (paymentMethod === 'mpesa' && response.status === 200) {
      paymentSuccess = true;
    }
    
    if (paymentSuccess) {
      // Gerar nova chave
      const key = uuidv4();
      const createdAt = new Date().toISOString();
      const expiresAt = calculateExpirationDate(plan);
      
      // Salvar no banco de dados
      db.run(
        "INSERT INTO keys (key, plan, createdAt, expiresAt, status) VALUES (?, ?, ?, ?, ?)",
        [key, plan, createdAt, expiresAt, 'active'],
        function(err) {
          if (err) {
            console.error('Erro ao salvar chave:', err);
            return res.status(500).json({ 
              success: false, 
              message: 'Erro ao gerar chave' 
            });
          }
          
          // Retornar dados da chave gerada
          return res.json({
            success: true,
            key: key,
            plan: plan,
            expiresAt: expiresAt,
            message: 'Pagamento processado com sucesso'
          });
        }
      );
    } else {
      return res.status(400).json({ 
        success: false, 
        message: 'Falha no processamento do pagamento' 
      });
    }
  } catch (error) {
    console.error('Erro no processamento do pagamento:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Erro no processamento do pagamento' 
    });
  }
});

// Endpoint para geração de sinais do jogo
app.post('/generateSignal', (req, res) => {
  const { key } = req.body;
  
  // Verificar se a chave é válida
  db.get('SELECT * FROM keys WHERE key = ?', [key], (err, row) => {
    if (err || !row) {
      return res.status(401).json({ success: false, message: 'Chave inválida' });
    }
    
    // Verificar se a chave expirou
    const expiresAt = new Date(row.expiresAt);
    const currentDate = new Date();
    
    if (expiresAt < currentDate && row.key !== 'admin') {
      return res.status(401).json({ success: false, message: 'Chave expirada' });
    }
    
    // Gerar tabuleiro de probabilidades 5x5
    const board = [];
    for (let i = 0; i < 5; i++) {
      const row = [];
      for (let j = 0; j < 5; j++) {
        // Probabilidade entre 10% e 90%
        const probability = Math.floor(Math.random() * 81) + 10;
        row.push({
          x: i,
          y: j,
          probability: probability,
          safe: probability >= 60 // Safe se probabilidade for >= 60%
        });
      }
      board.push(row);
    }
    
    return res.json({
      success: true,
      board: board
    });
  });
});

// Endpoint para verificar status do servidor
app.get('/status', (req, res) => {
  res.json({ status: 'online' });
});

// Rota principal serve o frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

// Lidar com o encerramento do processo
process.on('SIGINT', () => {
  db.close();
  process.exit(0);
});
