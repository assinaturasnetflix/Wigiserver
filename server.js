require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const shortid = require('shortid');

const app = express(); // ÚNICA E CORRETA DECLARAÇÃO DE 'APP'
const PORT = process.env.PORT || 3000;

// --- Configuração do Banco de Dados (MongoDB Atlas) ---
const MONGODB_URI = process.env.MONGODB_URI;
// ... resto do seu código ...
if (!MONGODB_URI) {
    console.error("Erro: Variável de ambiente MONGODB_URI não definida!");
    process.exit(1); // Sai se não houver string de conexão
}

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    // Mongoose 6+ não precisa mais dessas opções:
    // useCreateIndex: true,
    // useFindAndModify: false
})
.then(() => console.log('Conectado ao MongoDB Atlas'))
.catch(err => {
    console.error('Erro ao conectar ao MongoDB:', err);
    process.exit(1);
});

// --- Schema e Model do Afiliado ---
// Mongoose criará a coleção 'afiliados' (pluralizando 'Afiliado') automaticamente
// se ela não existir na primeira inserção.
const affiliateSchema = new mongoose.Schema({
    slug: { type: String, required: true, unique: true, default: shortid.generate },
    mainAffiliateLink: { type: String, required: true },
    button1Link: { type: String, required: true },
    button2Link: { type: String, required: true },
    button3Link: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const Afiliado = mongoose.model('Afiliado', affiliateSchema); // Modelo

// --- Middlewares ---
app.use(express.json()); // Para parsear JSON no corpo das requisições POST
app.use(express.urlencoded({ extended: true })); // Para parsear dados de formulários
app.use(express.static(path.join(__dirname, 'public'))); // Servir arquivos estáticos (CSS, JS, img, videos)
app.set('view engine', 'ejs'); // Define EJS como template engine
app.set('views', path.join(__dirname, 'views')); // Define o diretório das views

// --- Rotas ---

// Rota principal - Serve o painel do afiliado
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota para criar um novo afiliado (API)
app.post('/create-affiliate', async (req, res) => {
    try {
        const { mainAffiliateLink, button1Link, button2Link, button3Link } = req.body;

        // Validação básica
        if (!mainAffiliateLink || !button1Link || !button2Link || !button3Link) {
            return res.status(400).json({ success: false, message: 'Todos os links são obrigatórios.' });
        }

        // Cria um novo documento de afiliado
        const newAffiliate = new Afiliado({
            mainAffiliateLink,
            button1Link,
            button2Link,
            button3Link
            // O slug é gerado automaticamente pelo default do schema
        });

        // Salva no banco de dados
        const savedAffiliate = await newAffiliate.save();

        // Gera a URL pública completa
        const publicUrl = `${req.protocol}://${req.get('host')}/afiliado/${savedAffiliate.slug}`;

        // Retorna sucesso com o slug e a URL pública
        res.status(201).json({
            success: true,
            message: 'Página de afiliado criada com sucesso!',
            slug: savedAffiliate.slug,
            publicUrl: publicUrl
        });

    } catch (error) {
        console.error("Erro ao criar afiliado:", error);
        // Verifica erro de duplicidade de slug (embora raro com shortid)
        if (error.code === 11000) {
             return res.status(409).json({ success: false, message: 'Erro ao gerar identificador único. Tente novamente.' });
        }
        res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
    }
});

// Rota para servir a página pública do afiliado
app.get('/afiliado/:slug', async (req, res) => {
    try {
        const slug = req.params.slug;
        const affiliateData = await Afiliado.findOne({ slug: slug });

        if (!affiliateData) {
            return res.status(404).send('Página de afiliado não encontrada.');
        }

        // Renderiza a página EJS passando os dados do afiliado
        res.render('affiliate_page', { affiliate: affiliateData });

    } catch (error) {
        console.error("Erro ao buscar afiliado:", error);
        res.status(500).send('Erro interno no servidor.');
    }
});

// --- Iniciar o Servidor ---
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Painel do Afiliado: http://localhost:${PORT}`);
});
