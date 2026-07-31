/**
 * YouRH Dashboard — Servidor Railway
 * Node.js + Express | JWT Auth | Google Sheets API | 3 papéis de acesso
 */

const express      = require('express');
const jwt          = require('jsonwebtoken');
const bcrypt       = require('bcryptjs');
const cookieParser = require('cookie-parser');
const { google }   = require('googleapis');
const fs           = require('fs');
const path         = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const JWT_SECRET      = process.env.JWT_SECRET;
const SPREADSHEET_ID  = process.env.SPREADSHEET_ID || '1kjwjwQF8KL2ijEt9jB-UkWYLmLTZ5XuF6k44sAFzAgU';
const SHEET_NAME      = process.env.SHEET_NAME || 'Sheet1';  // nome da aba na planilha
const CACHE_TTL_MS    = 5 * 60 * 1000;                       // cache de 5 min

if (!JWT_SECRET) {
  console.error('❌  Variável JWT_SECRET não definida. Configure-a no Railway antes de iniciar.');
  process.exit(1);
}

// ─── USUÁRIOS ─────────────────────────────────────────────────────────────────
// Formato JSON em USERS env var — ver .env.example
let USERS = [];
try {
  USERS = JSON.parse(process.env.USERS || '[]');
} catch (e) {
  console.error('❌  Erro ao ler USERS. Verifique o formato JSON na variável de ambiente.');
  process.exit(1);
}

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(cookieParser());

// ─── CACHE GOOGLE SHEETS ──────────────────────────────────────────────────────
let sheetsCache = { data: null, ts: 0 };

async function getRawData() {
  const now = Date.now();
  if (sheetsCache.data && now - sheetsCache.ts < CACHE_TTL_MS) {
    return sheetsCache.data;
  }

  let credentials;
  try {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON inválido ou não definido');
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets  = google.sheets({ version: 'v4', auth });
  const resp    = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: SHEET_NAME,
  });

  const rows = resp.data.values || [];
  if (rows.length < 2) return [];

  // Encontra dinamicamente a linha de cabeçalho (primeira com 3+ colunas preenchidas)
  const headerIdx = rows.findIndex(r => r && r.length >= 3);
  if (headerIdx === -1) return [];

  // Normaliza sem depender de regex com chars Unicode literais (mais robusto)
  const normalize = s => {
    const lower = s.toLowerCase().trim();
    // Remove diacríticos via charCode (U+0300–U+036F) sem regex literal
    return lower.normalize('NFD').split('').filter(c => {
      const code = c.charCodeAt(0);
      return code < 0x0300 || code > 0x036F;
    }).join('');
  };

  const headers = rows[headerIdx].map(normalize);
  console.log('[DEBUG] headers normalizados:', JSON.stringify(headers));

  // Aceita variações com e sem acento, e sinônimos comuns
  const fieldMap = h => {
    if (h === 'mes' || h === 'mês' || h.startsWith('mê') || (h.startsWith('me') && h.length <= 4)) return 'mes';
    if (h === 'nome' || h === 'colaborador' || h === 'name') return 'nome';
    if (h === 'setor' || h === 'sector' || h === 'departamento' || h === 'area' || h === 'área') return 'setor';
    if (h === '%' || h === 'perc' || h === 'performance' || h === 'produtividade' || h.includes('%') || h.includes('prod') || h.includes('perf')) return 'perc';
    return h;
  };

  const parsed = rows.slice(headerIdx + 1).map((row, rowIdx) => {
    const obj = {};
    headers.forEach((h, i) => { obj[fieldMap(h)] = (row[i] || '').trim(); });
    // Remove o símbolo % se vier junto com o número
    const percStr = (obj.perc || '0').replace('%', '').replace(',', '.');
    const perc = parseFloat(percStr);
    if (rowIdx < 3) console.log('[DEBUG] row', rowIdx, JSON.stringify(obj), '→ perc:', perc);
    if (!obj.nome || !obj.mes || isNaN(perc)) return null;
    return { mes: obj.mes, nome: obj.nome, setor: obj.setor || '', perc };
  }).filter(Boolean);

  console.log('[DEBUG] parsed total:', parsed.length);

  sheetsCache = { data: parsed, ts: now };
  return parsed;
}

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.redirect('/login');
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie('token');
    res.redirect('/login');
  }
}

function requireAuthAPI(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token expirado ou inválido' });
  }
}

// ─── FILTRAGEM POR PAPEL ──────────────────────────────────────────────────────
function filterByRole(data, user) {
  switch (user.role) {
    case 'rh_admin':
      return data;                                              // vê tudo
    case 'gestor':
      return data.filter(d => d.setor === user.setor);         // só o setor dele
    case 'colaborador':
      return data.filter(d => d.nome === user.nome);           // só os próprios dados
    default:
      return [];
  }
}

// ─── ROTAS DE AUTENTICAÇÃO ────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  const token = req.cookies.token;
  if (token) {
    try { jwt.verify(token, JWT_SECRET); return res.redirect('/'); } catch {}
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });

  const user = USERS.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Usuário não encontrado' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Senha incorreta' });

  const payload = { email: user.email, nome: user.nome, role: user.role, setor: user.setor || null };
  const token   = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });

  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000,
  });

  res.json({ ok: true, nome: user.nome, role: user.role });
});

app.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// ─── API DE DADOS ─────────────────────────────────────────────────────────────
app.get('/api/me', requireAuthAPI, (req, res) => {
  res.json(req.user);
});

app.get('/api/data', requireAuthAPI, async (req, res) => {
  try {
    const all      = await getRawData();
    const filtered = filterByRole(all, req.user);
    res.json(filtered);
  } catch (err) {
    console.error('Erro Sheets:', err.message);
    res.status(500).json({ error: 'Não foi possível buscar os dados da planilha' });
  }
});

// Força refresh do cache (rota admin)
app.post('/api/refresh', requireAuthAPI, (req, res) => {
  if (req.user.role !== 'rh_admin') return res.status(403).json({ error: 'Acesso negado' });
  sheetsCache = { data: null, ts: 0 };
  res.json({ ok: true, message: 'Cache limpo — próxima requisição buscará dados novos da planilha' });
});

// ─── DASHBOARD (server-side injection) ───────────────────────────────────────
const DASHBOARD_HTML = path.join(__dirname, 'public', 'dashboard.html');

app.get('/', requireAuth, async (req, res) => {
  try {
    const all      = await getRawData();
    const filtered = filterByRole(all, req.user);

    let html = fs.readFileSync(DASHBOARD_HTML, 'utf-8');

    // Injeta dados filtrados e info do usuário logado
    const injection = `
<script>
  // ─── DADOS INJETADOS PELO SERVIDOR ───────────────────────────────────────
  window.__YOURH_USER__ = ${JSON.stringify(req.user)};
  window.__YOURH_DATA__ = ${JSON.stringify(filtered)};
</script>`;

    html = html.replace('</head>', injection + '\n</head>');
    res.send(html);
  } catch (err) {
    console.error('Erro ao montar dashboard:', err.message);
    res.status(500).send('<h2>Erro ao carregar o painel. Tente novamente.</h2>');
  }
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  YouRH Dashboard rodando na porta ${PORT}`);
  console.log(`    Usuários configurados: ${USERS.length}`);
  console.log(`    Planilha: ${SPREADSHEET_ID} / aba: ${SHEET_NAME}`);
});
