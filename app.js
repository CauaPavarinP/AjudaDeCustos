require('dotenv').config({ quiet: true });
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { criarStore, novoId, paraNumero } = require('./services/store');
const { criarFotos, lerDataUrl } = require('./services/fotos');

const PROD = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;
const ADMIN_NOME = process.env.ADMIN_NOME || 'Maurício';

// Categorias de gasto (iguais às colunas da planilha "Resumo prestação de contas")
const CATEGORIAS = [
  { chave: 'combustivel', nome: 'Combustível' },
  { chave: 'alimentacao', nome: 'Alimentação' },
  { chave: 'degustacao', nome: 'Degustação' },
  { chave: 'hotel', nome: 'Hotel' },
  { chave: 'transporte', nome: 'Transporte' },
  { chave: 'outros', nome: 'Outros' },
];
const NOMES_CAT = CATEGORIAS.map(c => c.nome);
const FUNCOES_INICIAIS = ['Vendedor', 'Promotora'];
const VALOR_MAXIMO = 50000;
const STATUS = { analise: 'Em análise', aprovada: 'Aprovada', recusada: 'Recusada' };

for (const v of ['SESSION_SECRET', 'ADMIN_USER', 'ADMIN_PASSWORD']) {
  if (!process.env[v]) {
    if (PROD) throw new Error(`Variável de ambiente ${v} não definida.`);
    console.warn(`[config] ${v} não definida (aceito só em desenvolvimento).`);
  }
}

const store = criarStore(process.env);
const fotos = criarFotos(process.env); // null quando o envio de fotos está desligado
const app = express();
app.set('trust proxy', 1); // o Render fica atrás de proxy (necessário para cookie "secure")
app.disable('x-powered-by');
// Versão no ar: o Render informa o commit do deploy. As telas abertas comparam esse valor
// e se recarregam sozinhas quando sai uma versão nova (ver "versão nova" em public/*.js).
const VERSAO = (process.env.RENDER_GIT_COMMIT || String(Date.now())).slice(0, 12);
app.use((req, res, next) => {
  res.setHeader('X-Versao', VERSAO);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
// Corpo das requisições: 30 KB, exceto nas rotas que recebem a foto da nota (já comprimida no celular)
const jsonPequeno = express.json({ limit: '30kb' }), jsonComFoto = express.json({ limit: '5mb' });
const rotaComFoto = req => /^\/api\/despesas(\/[^/]+\/foto)?$/.test(req.path) && req.method !== 'GET';
app.use((req, res, next) => (rotaComFoto(req) ? jsonComFoto : jsonPequeno)(req, res, next));
app.use((req, res, next) => { if (!req.body || typeof req.body !== 'object') req.body = {}; next(); });

// ---------------- sessão ----------------
// A sessão fica num cookie assinado (HMAC com o SESSION_SECRET), e não na memória do servidor.
// Assim ninguém é deslogado quando o Render "dorme" ou reinicia. O cookie não leva senha nem hash:
// só o ID, a validade e uma "versão" da senha, que muda quando a senha é trocada (isso derruba as sessões antigas).
const SEGREDO = process.env.SESSION_SECRET || 'dev-secret-troque';
const COOKIE = 'ajudacusto.s';
const DURACAO_MS = 12 * 60 * 60 * 1000;
const hmac = txt => crypto.createHmac('sha256', SEGREDO).update(txt).digest('base64url');
const versaoSenha = hash => hmac('v:' + hash).slice(0, 16);
const versaoAdmin = () => versaoSenha('admin:' + (process.env.ADMIN_USER || 'admin') + '\n' + (process.env.ADMIN_PASSWORD || 'admin'));

function lerSessao(req) {
  const bruto = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='));
  if (!bruto) return {};
  const [dados, assinatura] = bruto.slice(COOKIE.length + 1).split('.');
  if (!dados || !assinatura || !iguais(assinatura, hmac(dados))) return {};
  try {
    const s = JSON.parse(Buffer.from(dados, 'base64url').toString());
    const agora = Date.now();
    if (!(s.ce > agora)) { delete s.c; delete s.cv; delete s.ce; }
    if (!(s.ae > agora)) { delete s.a; delete s.av; delete s.ae; }
    return s;
  } catch { return {}; }
}
function gravarSessao(res, s) {
  const fim = Math.max(s.ce || 0, s.ae || 0);
  const flags = `; Path=/; HttpOnly; SameSite=Lax${PROD ? '; Secure' : ''}`;
  if (fim <= Date.now()) return res.append('Set-Cookie', `${COOKIE}=; Max-Age=0${flags}`);
  const dados = Buffer.from(JSON.stringify(s)).toString('base64url');
  res.append('Set-Cookie', `${COOKIE}=${dados}.${hmac(dados)}; Max-Age=${Math.floor((fim - Date.now()) / 1000)}${flags}`);
}
app.use((req, res, next) => { req.sessao = lerSessao(req); next(); });

// ---------------- utilitários ----------------
const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const dataValida = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const mesValido = s => /^\d{4}-(0[1-9]|1[0-2])$/.test(s || '');
const texto = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const r2 = n => Math.round(n * 100) / 100;
const valor = v => r2(paraNumero(v));
const iguais = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const erro = (res, msg, status = 400) => res.status(status).json({ erro: msg });

function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(String(senha), salt, 32).toString('hex');
}
function confereSenha(senha, guardado) {
  const [salt, h] = String(guardado || '').split(':');
  if (!salt || !h) return false;
  const x = crypto.scryptSync(String(senha), salt, 32), y = Buffer.from(h, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function senhaTemporaria() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 6 }, () => abc[crypto.randomInt(abc.length)]).join('');
}
const publicoDesp = d => ({ ...d, foto: !!d.foto });
const publicoColab = c => ({ id: c.id, nome: c.nome, usuario: c.usuario, funcao: c.funcao, ativo: c.ativo, criadoEm: c.criadoEm });

// Bloqueio simples contra tentativas de adivinhar senha
const tentativas = new Map();
const LIMITE = 5, BLOQUEIO_MS = 10 * 60 * 1000;
const bloqueado = k => { const t = tentativas.get(k); return t && t.ate > Date.now(); };
function falhou(k) {
  const t = tentativas.get(k) || { n: 0 };
  t.n += 1;
  if (t.n >= LIMITE) { t.ate = Date.now() + BLOQUEIO_MS; t.n = 0; }
  tentativas.set(k, t);
}
const sucesso = k => tentativas.delete(k);
setInterval(() => {
  const agora = Date.now();
  for (const [k, t] of tentativas) if (!t.ate || t.ate < agora) tentativas.delete(k);
}, 60 * 60 * 1000).unref();

const sairColab = s => { delete s.c; delete s.cv; delete s.ce; };
const sairAdmin = s => { delete s.a; delete s.av; delete s.ae; };

// ---------------- autenticação ----------------
const exigeColab = wrap(async (req, res, next) => {
  const s = req.sessao;
  if (!s.c) return erro(res, 'Faça login.', 401);
  const c = (await store.list('Colaboradores')).find(x => x.id === s.c);
  const motivo = !c || !c.ativo ? 'Acesso desativado.' : s.cv !== versaoSenha(c.senhaHash) ? 'Sua senha foi alterada. Entre novamente.' : '';
  if (motivo) { sairColab(s); gravarSessao(res, s); return erro(res, motivo, 401); }
  req.colab = c;
  next();
});
const exigeAdmin = (req, res, next) => {
  const s = req.sessao;
  if (s.a && s.av === versaoAdmin()) return next();
  if (s.a) { sairAdmin(s); gravarSessao(res, s); }
  erro(res, 'Faça login.', 401);
};

// ---------------- público ----------------
app.get('/health', (req, res) => res.json({ ok: true, armazenamento: store.modo, fotos: fotos ? fotos.modo : 'desligadas' }));
app.get('/api/categorias', (req, res) => res.json(CATEGORIAS));
app.get('/api/config', (req, res) => res.json({ fotos: !!fotos }));

// Envia a foto para o armazenamento e devolve a referência (ou um erro para mostrar na tela)
async function guardarFoto(id, dataUrl) {
  if (!fotos) return { erro: 'O envio de fotos não está disponível no momento.' };
  const f = lerDataUrl(dataUrl);
  if (f.erro) return f;
  try { return { ref: await fotos.salvar(id, f.buf) }; }
  catch (e) { console.error('[fotos]', e.message); return { erro: 'Não foi possível enviar a foto. Tente de novo ou envie sem foto.' }; }
}
const apagarFoto = ref => { if (fotos && ref) fotos.apagar(ref).catch(e => console.error('[fotos] apagar', e.message)); };
async function enviarFoto(res, d) {
  if (!d || !d.foto) return erro(res, 'Esta despesa não tem foto.', 404);
  if (!fotos) return erro(res, 'Fotos indisponíveis no momento.', 503);
  try {
    const buf = await fotos.ler(d.foto);
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' }).send(buf);
  } catch (e) { console.error('[fotos] ler', e.message); erro(res, 'Não foi possível carregar a foto.', 502); }
}

// ================= COLABORADOR (celular) =================
app.post('/api/login', wrap(async (req, res) => {
  const usuario = texto(req.body.usuario, 40).toLowerCase();
  const chave = 'c:' + req.ip + ':' + usuario;
  if (bloqueado(chave)) return erro(res, 'Muitas tentativas. Aguarde 10 minutos.', 429);
  const c = (await store.list('Colaboradores')).find(x => x.usuario === usuario && x.ativo);
  if (!c || !confereSenha(req.body.senha, c.senhaHash)) { falhou(chave); return erro(res, 'Usuário ou senha incorretos.', 401); }
  sucesso(chave);
  Object.assign(req.sessao, { c: c.id, cv: versaoSenha(c.senhaHash), ce: Date.now() + DURACAO_MS });
  gravarSessao(res, req.sessao);
  res.json({ ok: true });
}));
app.post('/api/logout', (req, res) => { sairColab(req.sessao); gravarSessao(res, req.sessao); res.json({ ok: true }); });

app.get('/api/me', exigeColab, (req, res) => res.json(publicoColab(req.colab)));

app.post('/api/me/senha', exigeColab, wrap(async (req, res) => {
  const nova = String(req.body.nova ?? '');
  if (!confereSenha(req.body.atual, req.colab.senhaHash)) return erro(res, 'A senha atual não confere.');
  if (nova.length < 6) return erro(res, 'A nova senha precisa ter pelo menos 6 caracteres.');
  const senhaHash = hashSenha(nova);
  await store.update('Colaboradores', req.colab.id, { senhaHash });
  // Mantém este aparelho logado; outros aparelhos com a senha antiga são desconectados
  req.sessao.cv = versaoSenha(senhaHash);
  gravarSessao(res, req.sessao);
  res.json({ ok: true });
}));

app.get('/api/despesas', exigeColab, wrap(async (req, res) => {
  const lista = (await store.list('Despesas')).filter(d => d.colaboradorId === req.colab.id)
    .sort((a, b) => (b.data + b.criadoEm).localeCompare(a.data + a.criadoEm));
  res.json(lista.map(publicoDesp));
}));

app.post('/api/despesas', exigeColab, wrap(async (req, res) => {
  const data = texto(req.body.data, 10);
  const categoria = texto(req.body.categoria, 30);
  const v = valor(req.body.valor);
  const observacao = texto(req.body.observacao, 200);
  if (!NOMES_CAT.includes(categoria)) return erro(res, 'Escolha a categoria.');
  if (!(v > 0)) return erro(res, 'Informe o valor da nota.');
  if (v > VALOR_MAXIMO) return erro(res, 'Valor muito alto. Confira o que foi digitado.');
  if (!dataValida(data)) return erro(res, 'Data inválida.');
  if (data > hojeSP()) return erro(res, 'A data não pode ser no futuro.');
  if (categoria === 'Outros' && !observacao) return erro(res, 'Para "Outros", escreva uma observação.');
  const d = {
    id: novoId(), colaboradorId: req.colab.id, colaborador: req.colab.nome, funcao: req.colab.funcao,
    data, categoria, valor: v, observacao, status: STATUS.analise,
    criadoEm: new Date().toISOString(), avaliadoEm: '', avaliadoPor: '', foto: '',
  };
  if (req.body.foto) {
    const f = await guardarFoto(d.id, req.body.foto);
    if (f.erro) return erro(res, f.erro);
    d.foto = f.ref;
  }
  try { await store.add('Despesas', d); }
  catch (e) { apagarFoto(d.foto); throw e; }
  res.status(201).json(publicoDesp(d));
}));

// Foto da despesa: o colaborador vê a própria; pode adicionar ou trocar enquanto está em análise
const minhaDespesa = async req => (await store.list('Despesas')).find(x => x.id === req.params.id && x.colaboradorId === req.colab.id);
app.get('/api/despesas/:id/foto', exigeColab, wrap(async (req, res) => {
  const d = await minhaDespesa(req);
  if (!d) return erro(res, 'Despesa não encontrada.', 404);
  enviarFoto(res, d);
}));
app.put('/api/despesas/:id/foto', exigeColab, wrap(async (req, res) => {
  const d = await minhaDespesa(req);
  if (!d) return erro(res, 'Despesa não encontrada.', 404);
  if (d.status !== STATUS.analise) return erro(res, 'Só dá para mudar a foto enquanto a despesa está em análise.');
  const f = await guardarFoto(d.id, req.body.foto);
  if (f.erro) return erro(res, f.erro);
  const atual = await store.update('Despesas', d.id, { foto: f.ref });
  apagarFoto(d.foto);
  res.json(publicoDesp(atual));
}));

app.delete('/api/despesas/:id', exigeColab, wrap(async (req, res) => {
  const d = (await store.list('Despesas')).find(x => x.id === req.params.id && x.colaboradorId === req.colab.id);
  if (!d) return erro(res, 'Despesa não encontrada.', 404);
  if (d.status !== STATUS.analise) return erro(res, 'Só dá para excluir despesas que ainda estão em análise.');
  await store.remove('Despesas', d.id);
  apagarFoto(d.foto);
  res.json({ ok: true });
}));

// ================= ADMINISTRADOR (Maurício) =================
app.post('/api/admin/login', (req, res) => {
  const chave = 'a:' + req.ip;
  if (bloqueado(chave)) return erro(res, 'Muitas tentativas. Aguarde 10 minutos.', 429);
  const ok = iguais(texto(req.body.usuario, 100), process.env.ADMIN_USER || 'admin')
    && iguais(String(req.body.senha ?? ''), process.env.ADMIN_PASSWORD || 'admin');
  if (!ok) { falhou(chave); return erro(res, 'Usuário ou senha incorretos.', 401); }
  sucesso(chave);
  Object.assign(req.sessao, { a: 1, av: versaoAdmin(), ae: Date.now() + DURACAO_MS });
  gravarSessao(res, req.sessao);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => { sairAdmin(req.sessao); gravarSessao(res, req.sessao); res.json({ ok: true }); });
app.get('/api/admin/me', exigeAdmin, (req, res) => res.json({ nome: ADMIN_NOME }));

// Tudo o que o painel precisa de uma vez (volume pequeno); os resumos são calculados na tela
app.get('/api/admin/dados', exigeAdmin, wrap(async (req, res) => {
  const [colaboradores, funcoes, prestacoes, despesas] = await Promise.all(
    ['Colaboradores', 'Funcoes', 'Prestacoes', 'Despesas'].map(t => store.list(t)));
  res.json({
    categorias: CATEGORIAS,
    funcoes: funcoes.map(f => f.nome).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    colaboradores: colaboradores.map(publicoColab).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    prestacoes, despesas: despesas.map(publicoDesp),
    fotos: !!fotos,
  });
}));

// ---- funções ----
app.post('/api/admin/funcoes', exigeAdmin, wrap(async (req, res) => {
  const nome = texto(req.body.nome, 40);
  if (nome.length < 2) return erro(res, 'Informe o nome da função.');
  const existe = (await store.list('Funcoes')).some(f => f.nome.toLowerCase() === nome.toLowerCase());
  if (existe) return erro(res, 'Essa função já existe.');
  await store.add('Funcoes', { id: novoId(), nome, criadoEm: new Date().toISOString() });
  res.status(201).json({ ok: true });
}));
// Só exclui função que nenhum colaborador (ativo ou inativo) usa. Os lançamentos antigos guardam
// o nome da função como texto, então os resumos continuam iguais depois da exclusão.
app.delete('/api/admin/funcoes/:nome', exigeAdmin, wrap(async (req, res) => {
  const nome = String(req.params.nome);
  const f = (await store.list('Funcoes')).find(x => x.nome === nome);
  if (!f) return erro(res, 'Função não encontrada.', 404);
  const usando = (await store.list('Colaboradores')).filter(c => c.funcao === nome);
  if (usando.length) {
    return erro(res, `A função "${nome}" está no cadastro de ${usando.length} colaborador${usando.length === 1 ? '' : 'es'} (${usando.slice(0, 3).map(c => c.nome).join(', ')}${usando.length > 3 ? '...' : ''}). Troque a função deles em Editar antes de excluir.`);
  }
  await store.remove('Funcoes', f.id);
  res.json({ ok: true });
}));

// ---- colaboradores ----
async function validarColab(body, idAtual) {
  const nome = texto(body.nome, 80);
  const usuario = texto(body.usuario, 30).toLowerCase();
  const funcao = texto(body.funcao, 40);
  if (nome.length < 2) return { erro: 'Informe o nome.' };
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) return { erro: 'Usuário: de 3 a 30 letras minúsculas, números, ponto ou traço, sem espaços.' };
  const funcoes = (await store.list('Funcoes')).map(f => f.nome);
  if (!funcoes.includes(funcao)) return { erro: 'Escolha uma função cadastrada.' };
  const todos = await store.list('Colaboradores');
  if (todos.some(c => c.usuario === usuario && c.id !== idAtual)) return { erro: 'Esse usuário já está em uso.' };
  return { nome, usuario, funcao };
}

app.post('/api/admin/colaboradores', exigeAdmin, wrap(async (req, res) => {
  const v = await validarColab(req.body);
  if (v.erro) return erro(res, v.erro);
  const senha = senhaTemporaria();
  const c = { id: novoId(), ...v, ativo: true, senhaHash: hashSenha(senha), criadoEm: new Date().toISOString() };
  await store.add('Colaboradores', c);
  res.status(201).json({ ...publicoColab(c), senhaTemporaria: senha });
}));

app.put('/api/admin/colaboradores/:id', exigeAdmin, wrap(async (req, res) => {
  const id = String(req.params.id);
  const campos = {};
  if ('nome' in req.body) {
    const v = await validarColab(req.body, id);
    if (v.erro) return erro(res, v.erro);
    Object.assign(campos, v);
  }
  if ('ativo' in req.body) campos.ativo = !!req.body.ativo;
  let senha;
  if (req.body.novaSenha) { senha = senhaTemporaria(); campos.senhaHash = hashSenha(senha); }
  const c = await store.update('Colaboradores', id, campos);
  if (!c) return erro(res, 'Colaborador não encontrado.', 404);
  res.json({ ...publicoColab(c), ...(senha ? { senhaTemporaria: senha } : {}) });
}));

// Só exclui colaborador sem nenhum lançamento; quem tem histórico deve ser desativado,
// para os resumos continuarem certos.
app.delete('/api/admin/colaboradores/:id', exigeAdmin, wrap(async (req, res) => {
  const id = String(req.params.id);
  const [prest, desp] = await Promise.all([store.list('Prestacoes'), store.list('Despesas')]);
  const n = prest.filter(p => p.colaboradorId === id).length + desp.filter(d => d.colaboradorId === id).length;
  if (n) return erro(res, `Este colaborador tem ${n} lançamento${n === 1 ? '' : 's'} (prestações ou despesas do app). Para manter o histórico, use Desativar.`);
  const ok = await store.remove('Colaboradores', id);
  if (!ok) return erro(res, 'Colaborador não encontrado.', 404);
  res.json({ ok: true });
}));

// ---- prestações (lançadas pelo Maurício) ----
async function validarPrestacao(body) {
  const colab = (await store.list('Colaboradores')).find(c => c.id === String(body.colaboradorId || ''));
  if (!colab) return { erro: 'Escolha o colaborador.' };
  const dataInicial = texto(body.dataInicial, 10), dataFinal = texto(body.dataFinal, 10), mesRef = texto(body.mesRef, 7);
  if (!dataValida(dataInicial) || !dataValida(dataFinal)) return { erro: 'Informe a data inicial e a data final.' };
  if (dataFinal < dataInicial) return { erro: 'A data final não pode ser antes da inicial.' };
  if (!mesValido(mesRef)) return { erro: 'Escolha o mês de referência.' };
  const p = { colaboradorId: colab.id, colaborador: colab.nome, funcao: colab.funcao, dataInicial, dataFinal, mesRef };
  let total = 0;
  for (const c of CATEGORIAS) {
    const v = valor(body[c.chave]);
    if (v < 0 || v > VALOR_MAXIMO) return { erro: `Valor inválido em ${c.nome}.` };
    p[c.chave] = v; total += v;
  }
  if (!(total > 0)) return { erro: 'Preencha pelo menos um valor.' };
  p.total = r2(total);
  p.observacao = texto(body.observacao, 300);
  return p;
}

app.post('/api/admin/prestacoes', exigeAdmin, wrap(async (req, res) => {
  const p = await validarPrestacao(req.body);
  if (p.erro) return erro(res, p.erro);
  const nova = { id: novoId(), ...p, criadoEm: new Date().toISOString() };
  await store.add('Prestacoes', nova);
  res.status(201).json(nova);
}));
app.put('/api/admin/prestacoes/:id', exigeAdmin, wrap(async (req, res) => {
  const p = await validarPrestacao(req.body);
  if (p.erro) return erro(res, p.erro);
  const atual = await store.update('Prestacoes', String(req.params.id), p);
  if (!atual) return erro(res, 'Prestação não encontrada.', 404);
  res.json(atual);
}));
app.delete('/api/admin/prestacoes/:id', exigeAdmin, wrap(async (req, res) => {
  const ok = await store.remove('Prestacoes', String(req.params.id));
  if (!ok) return erro(res, 'Prestação não encontrada.', 404);
  res.json({ ok: true });
}));

// ---- aprovação das despesas do celular ----
app.post('/api/admin/despesas/:id/:acao', exigeAdmin, wrap(async (req, res) => {
  const acao = req.params.acao;
  if (!['aprovar', 'recusar', 'reabrir'].includes(acao)) return erro(res, 'Ação inválida.', 404);
  const status = acao === 'aprovar' ? STATUS.aprovada : acao === 'recusar' ? STATUS.recusada : STATUS.analise;
  const d = await store.update('Despesas', String(req.params.id), {
    status,
    avaliadoEm: acao === 'reabrir' ? '' : new Date().toISOString(),
    avaliadoPor: acao === 'reabrir' ? '' : ADMIN_NOME,
  });
  if (!d) return erro(res, 'Despesa não encontrada.', 404);
  res.json(publicoDesp(d));
}));
app.get('/api/admin/despesas/:id/foto', exigeAdmin, wrap(async (req, res) =>
  enviarFoto(res, (await store.list('Despesas')).find(x => x.id === req.params.id))));

// ---------------- páginas ----------------
// no-cache: o navegador sempre confere se há versão nova (evita admin.html antigo com admin.js novo)
const semCache = res => res.setHeader('Cache-Control', 'no-cache');
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', setHeaders: semCache }));
app.get('/admin', (req, res) => { semCache(res); res.sendFile(path.join(__dirname, 'public', 'admin.html')); });
app.use('/api', (req, res) => erro(res, 'Rota não encontrada.', 404));

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return erro(res, 'Foto muito grande. Tente outra foto.', 413);
  if (err.status >= 400 && err.status < 500) return erro(res, 'Requisição inválida.', err.status);
  console.error('[erro]', err);
  res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
});

async function iniciar() {
  await store.init();
  // Cria as funções iniciais na primeira vez
  if (!(await store.list('Funcoes')).length) {
    for (const nome of FUNCOES_INICIAIS) await store.add('Funcoes', { id: novoId(), nome, criadoEm: new Date().toISOString() });
  }
  app.listen(PORT, () => console.log(`Ajuda de Custo rodando na porta ${PORT} (armazenamento: ${store.modo}, fotos: ${fotos ? fotos.modo : "desligadas"})`));
}
iniciar().catch(err => { console.error('Falha ao iniciar:', err.message); process.exit(1); });
