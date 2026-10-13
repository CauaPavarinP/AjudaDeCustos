require('dotenv').config({ quiet: true });
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const { criarStore, novoId, paraNumero } = require('./services/store');

const PROD = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;
const TIPOS = ['Combustível', 'Alimentação', 'Hospedagem', 'Pedágio', 'Estacionamento', 'Outros'];
const VALOR_MAXIMO = 50000;

for (const v of ['SESSION_SECRET', 'ADMIN_USER', 'ADMIN_PASSWORD']) {
  if (!process.env[v]) {
    if (PROD) throw new Error(`Variável de ambiente ${v} não definida.`);
    console.warn(`[config] ${v} não definida (aceito só em desenvolvimento).`);
  }
}

const store = criarStore(process.env);
const app = express();
app.set('trust proxy', 1); // Render fica atrás de proxy (necessário para cookie "secure")
app.use(express.json({ limit: '20kb' }));
app.use(session({
  name: 'ajudacusto.sid',
  secret: process.env.SESSION_SECRET || 'dev-secret-troque',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 1000 * 60 * 60 * 12 },
}));

// ---------------- utilitários ----------------
function hojeSP() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const dataValida = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const texto = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const soDigitos = v => String(v ?? '').replace(/\D/g, '');
const iguais = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const ordenar = arr => arr.sort((a, b) => (b.data + b.criadoEm).localeCompare(a.data + a.criadoEm));
const publicoFunc = f => ({ id: f.id, nome: f.nome, funcao: f.funcao, telefone: f.telefone, codigo: f.codigo, ativo: f.ativo, criadoEm: f.criadoEm });
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Bloqueio simples contra tentativa de adivinhar código/senha
const tentativas = new Map();
const LIMITE = 5, BLOQUEIO_MS = 10 * 60 * 1000;
function bloqueado(chave) {
  const t = tentativas.get(chave);
  return t && t.ate && t.ate > Date.now();
}
function falhou(chave) {
  const t = tentativas.get(chave) || { n: 0 };
  t.n += 1;
  if (t.n >= LIMITE) { t.ate = Date.now() + BLOQUEIO_MS; t.n = 0; }
  tentativas.set(chave, t);
}
const sucesso = chave => tentativas.delete(chave);

async function gerarCodigo() {
  const usados = new Set((await store.listFuncionarios()).filter(f => f.ativo).map(f => f.codigo));
  for (let i = 0; i < 200; i++) {
    const c = String(crypto.randomInt(0, 10000)).padStart(4, '0');
    if (!usados.has(c)) return c;
  }
  throw new Error('Não foi possível gerar um código livre.');
}

// ---------------- autenticação ----------------
const exigeFuncionario = wrap(async (req, res, next) => {
  const id = req.session.funcionarioId;
  if (!id) return res.status(401).json({ erro: 'Faça login.' });
  const f = (await store.listFuncionarios()).find(x => x.id === id);
  if (!f || !f.ativo) { req.session.funcionarioId = null; return res.status(401).json({ erro: 'Acesso desativado.' }); }
  req.funcionario = f;
  next();
});
const exigeAdmin = (req, res, next) => (req.session.admin ? next() : res.status(401).json({ erro: 'Faça login.' }));

// ---------------- rotas públicas ----------------
app.get('/health', (req, res) => res.json({ ok: true, armazenamento: store.modo }));
app.get('/api/tipos', (req, res) => res.json(TIPOS));

// Lista para o login do colaborador: só nome e id dos ativos
app.get('/api/funcionarios-login', wrap(async (req, res) => {
  const lista = (await store.listFuncionarios()).filter(f => f.ativo)
    .map(f => ({ id: f.id, nome: f.nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  res.json(lista);
}));

app.post('/api/login', wrap(async (req, res) => {
  const id = texto(req.body.funcionarioId, 40);
  const codigo = soDigitos(req.body.codigo);
  const chave = 'f:' + req.ip + ':' + id;
  if (bloqueado(chave)) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde 10 minutos.' });
  const f = (await store.listFuncionarios()).find(x => x.id === id && x.ativo);
  if (!f || !iguais(f.codigo, codigo)) { falhou(chave); return res.status(401).json({ erro: 'Nome ou código incorreto.' }); }
  sucesso(chave);
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ erro: 'Erro ao iniciar sessão.' });
    req.session.funcionarioId = f.id;
    res.json({ ok: true });
  });
}));

app.post('/api/logout', (req, res) => { req.session.funcionarioId = null; res.json({ ok: true }); });

// ---------------- colaborador ----------------
app.get('/api/me', exigeFuncionario, (req, res) => {
  res.json({ id: req.funcionario.id, nome: req.funcionario.nome, funcao: req.funcionario.funcao });
});

app.get('/api/meus-lancamentos', exigeFuncionario, wrap(async (req, res) => {
  const mes = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : hojeSP().slice(0, 7);
  const lista = ordenar((await store.listLancamentos())
    .filter(l => l.funcionarioId === req.funcionario.id && l.data.startsWith(mes)));
  const total = Math.round(lista.reduce((s, l) => s + l.valor, 0) * 100) / 100;
  res.json({ mes, total, quantidade: lista.length, lancamentos: lista });
}));

app.post('/api/lancamentos', exigeFuncionario, wrap(async (req, res) => {
  const data = texto(req.body.data, 10);
  const tipo = texto(req.body.tipo, 40);
  const valor = Math.round(paraNumero(req.body.valor) * 100) / 100;
  const descricao = texto(req.body.descricao, 200);
  if (!dataValida(data)) return res.status(400).json({ erro: 'Data inválida.' });
  if (data > hojeSP()) return res.status(400).json({ erro: 'A data não pode ser no futuro.' });
  if (!TIPOS.includes(tipo)) return res.status(400).json({ erro: 'Escolha o tipo de despesa.' });
  if (!(valor > 0)) return res.status(400).json({ erro: 'Informe um valor maior que zero.' });
  if (valor > VALOR_MAXIMO) return res.status(400).json({ erro: 'Valor muito alto. Confira o que foi digitado.' });
  if (tipo === 'Outros' && !descricao) return res.status(400).json({ erro: 'Para "Outros", descreva a despesa.' });
  const l = {
    id: novoId(), data, tipo, valor, descricao,
    funcionarioId: req.funcionario.id, funcionario: req.funcionario.nome, funcao: req.funcionario.funcao,
    criadoEm: new Date().toISOString(),
  };
  await store.addLancamento(l);
  res.status(201).json(l);
}));

// ---------------- administrador (Maurício) ----------------
app.post('/api/admin/login', (req, res) => {
  const chave = 'a:' + req.ip;
  if (bloqueado(chave)) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde 10 minutos.' });
  const ok = iguais(texto(req.body.usuario, 100), process.env.ADMIN_USER || 'admin')
    && iguais(String(req.body.senha ?? ''), process.env.ADMIN_PASSWORD || 'admin');
  if (!ok) { falhou(chave); return res.status(401).json({ erro: 'Usuário ou senha incorretos.' }); }
  sucesso(chave);
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ erro: 'Erro ao iniciar sessão.' });
    req.session.admin = true;
    res.json({ ok: true });
  });
});
app.post('/api/admin/logout', (req, res) => { req.session.admin = false; res.json({ ok: true }); });
app.get('/api/admin/me', exigeAdmin, (req, res) => res.json({ ok: true }));

app.get('/api/admin/funcionarios', exigeAdmin, wrap(async (req, res) => {
  const lista = (await store.listFuncionarios()).map(publicoFunc)
    .sort((a, b) => (b.ativo - a.ativo) || a.nome.localeCompare(b.nome, 'pt-BR'));
  res.json(lista);
}));

function validarFuncionario(body) {
  const nome = texto(body.nome, 80);
  const funcao = texto(body.funcao, 60);
  const telefone = texto(body.telefone, 30);
  if (nome.length < 2) return { erro: 'Informe o nome.' };
  if (funcao.length < 2) return { erro: 'Informe a função.' };
  return { nome, funcao, telefone };
}

app.post('/api/admin/funcionarios', exigeAdmin, wrap(async (req, res) => {
  const v = validarFuncionario(req.body);
  if (v.erro) return res.status(400).json(v);
  const todos = await store.listFuncionarios();
  if (todos.some(f => f.ativo && f.nome.toLowerCase() === v.nome.toLowerCase())) {
    return res.status(400).json({ erro: 'Já existe um funcionário ativo com esse nome.' });
  }
  const f = { id: novoId(), ...v, codigo: await gerarCodigo(), ativo: true, criadoEm: new Date().toISOString() };
  await store.addFuncionario(f);
  res.status(201).json(publicoFunc(f));
}));

app.put('/api/admin/funcionarios/:id', exigeAdmin, wrap(async (req, res) => {
  const campos = {};
  if ('nome' in req.body || 'funcao' in req.body || 'telefone' in req.body) {
    const v = validarFuncionario(req.body);
    if (v.erro) return res.status(400).json(v);
    Object.assign(campos, v);
  }
  if ('ativo' in req.body) campos.ativo = !!req.body.ativo;
  if (req.body.novoCodigo) campos.codigo = await gerarCodigo();
  const f = await store.updateFuncionario(String(req.params.id), campos);
  if (!f) return res.status(404).json({ erro: 'Funcionário não encontrado.' });
  res.json(publicoFunc(f));
}));

async function filtrarExtrato(q) {
  const inicio = dataValida(q.inicio || '') ? q.inicio : hojeSP().slice(0, 8) + '01';
  const fim = dataValida(q.fim || '') ? q.fim : hojeSP();
  const funcao = texto(q.funcao, 60);
  const funcionarioId = texto(q.funcionarioId, 40);
  const tipo = texto(q.tipo, 40);
  const lista = ordenar((await store.listLancamentos()).filter(l =>
    l.data >= inicio && l.data <= fim
    && (!funcao || l.funcao === funcao)
    && (!funcionarioId || l.funcionarioId === funcionarioId)
    && (!tipo || l.tipo === tipo)));
  return { inicio, fim, lista };
}

app.get('/api/admin/extrato', exigeAdmin, wrap(async (req, res) => {
  const { inicio, fim, lista } = await filtrarExtrato(req.query);
  const r2 = n => Math.round(n * 100) / 100;
  const total = r2(lista.reduce((s, l) => s + l.valor, 0));
  const agrupar = chave => {
    const m = new Map();
    for (const l of lista) {
      const k = chave(l);
      const g = m.get(k.id) || { ...k, total: 0, quantidade: 0 };
      g.total = r2(g.total + l.valor); g.quantidade += 1;
      m.set(k.id, g);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  };
  const porFuncionario = agrupar(l => ({ id: l.funcionarioId, nome: l.funcionario }));
  const porTipo = agrupar(l => ({ id: l.tipo, nome: l.tipo }));
  const funcoes = [...new Set((await store.listFuncionarios()).map(f => f.funcao).filter(Boolean))].sort();
  res.json({ inicio, fim, total, quantidade: lista.length, porFuncionario, porTipo, funcoes, lancamentos: lista });
}));

// Exporta CSV (abre no Excel). ";" e BOM para acentos e separador corretos no Excel em português.
app.get('/api/admin/extrato.csv', exigeAdmin, wrap(async (req, res) => {
  const { inicio, fim, lista } = await filtrarExtrato(req.query);
  const cel = v => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s; // evita fórmula ao abrir no Excel
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const br = d => d.split('-').reverse().join('/');
  const linhas = [['Data', 'Funcionário', 'Função', 'Tipo', 'Descrição', 'Valor'].map(cel).join(';')];
  for (const l of lista) linhas.push([br(l.data), l.funcionario, l.funcao, l.tipo, l.descricao, l.valor.toFixed(2).replace('.', ',')].map(cel).join(';'));
  const total = lista.reduce((s, l) => s + l.valor, 0);
  linhas.push(['', '', '', '', 'TOTAL', total.toFixed(2).replace('.', ',')].map(cel).join(';'));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="extrato-${inicio}-a-${fim}.csv"`);
  res.send('﻿' + linhas.join('\r\n'));
}));

// ---------------- páginas ----------------
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.use((err, req, res, next) => {
  console.error('[erro]', err);
  res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
});

store.init()
  .then(() => app.listen(PORT, () => console.log(`Ajuda de Custo rodando na porta ${PORT} (armazenamento: ${store.modo})`)))
  .catch(err => { console.error('Falha ao iniciar:', err.message); process.exit(1); });
