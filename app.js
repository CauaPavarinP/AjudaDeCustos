require('dotenv').config({ quiet: true });
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { criarStore, novoId } = require('./services/store');
const { resumoErro, ondeAconteceu } = require('./services/erros');
const { criarFotos, lerDataUrl } = require('./services/fotos');
const Regras = require('./public/regras');

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
// ---- períodos de pagamento ----
// O colaborador lança as despesas e, quando quiser, "fecha o período": todas as ainda não enviadas (em análise
// ou aprovadas) viram um período Enviado (aba Periodos), da nota mais antiga à mais recente. O Maurício confere,
// aprova/recusa e paga o período. Cada despesa enviada guarda o ID do período em periodoId.
// As regras que as telas também usam (status, despesa antiga) ficam em public/regras.js.
const { STATUS, ENVIADO, PAGO, ANTERIOR, LIBERADA, ANTES_DO_SISTEMA, naoEnviada } = Regras;
// Trava por chave: ações que mexem nas mesmas despesas rodam uma de cada vez, sem se cruzar.
// Vale porque o sistema roda num servidor só (uma instância no Render).
const travas = new Map();
function comTrava(chave, tarefa) {
  const vez = (travas.get(chave) || Promise.resolve()).then(tarefa, tarefa);
  const fim = vez.catch(() => {});
  travas.set(chave, fim);
  fim.then(() => { if (travas.get(chave) === fim) travas.delete(chave); });
  return vez;
}
// Despesa não enviada: trava do colaborador (fechar o período); despesa num período: trava do período (pagar, reabrir)
const chaveFechar = colabId => `fechar:${colabId}`;
const chavePeriodo = id => `periodo:${id}`;
const chaveDespesa = d => (naoEnviada(d) ? chaveFechar(d.colaboradorId) : chavePeriodo(d.periodoId));
// Início do controle de pagamentos (gravado na aba Config na primeira vez que o servidor sobe com esta versão).
// Despesas aprovadas ANTES disso podem já ter sido reembolsadas fora do sistema: não entram sozinhas num período;
// o Maurício decide ("Já foram pagas" ou "Incluir para pagar").
let INICIO_PERIODOS = '';
const antiga = d => Regras.antiga(d, INICIO_PERIODOS);

for (const v of ['SESSION_SECRET', 'ADMIN_USER', 'ADMIN_PASSWORD']) {
  if (!process.env[v]) {
    if (PROD) throw new Error(`Variável de ambiente ${v} não definida.`);
    console.warn(`[config] ${v} não definida (aceito só em desenvolvimento).`);
  }
}

let store;
try { store = criarStore(process.env); }
catch (err) { console.error('Configuração inválida:', err.message); process.exit(1); }
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
const rotaComFoto = req => req.method !== 'GET'
  && (/^\/api\/despesas(\/[^/]+\/foto)?$/.test(req.path) || /^\/api\/admin\/prestacoes\/[^/]+\/fotos$/.test(req.path));
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
// Administrador principal: o login de ADMIN_USER/ADMIN_PASSWORD (variáveis do Render). Não fica na tabela, não pode
// ser desativado pelo painel e é o único que cadastra outros administradores (tabela Administradores).
const PRINCIPAL = 'principal';
const ADMIN_USER = () => process.env.ADMIN_USER || 'admin';
const versaoAdmin = () => versaoSenha('admin:' + ADMIN_USER() + '\n' + (process.env.ADMIN_PASSWORD || 'admin'));

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
// Data AAAA-MM-DD existente e com ano razoável (evita erros de digitação como 07/07/7777)
const ANO_MIN = 2000, anoMax = () => new Date().getFullYear() + 1;
// Diz o que está errado na data (vazia, inexistente ou com ano fora do intervalo), ou '' se estiver certa
function problemaData(s, nome) {
  if (!s) return `Informe ${nome.toLowerCase()}.`;
  // Confere se o dia existe de verdade: o JavaScript "corrige" 31/02 para 03/03 sem avisar
  const existe = /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'))
    && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
  if (!existe) return `${nome} não existe (${s.split('-').reverse().join('/')}). Confira o dia e o mês.`;
  const ano = Number(s.slice(0, 4));
  if (ano < ANO_MIN || ano > anoMax()) return `${nome} está com o ano ${ano}. Use um ano entre ${ANO_MIN} e ${anoMax()}.`;
  return '';
}
const valorMaximoTxt = () => VALOR_MAXIMO.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const mesValido = s => /^\d{4}-(0[1-9]|1[0-2])$/.test(s || '');
// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g; // invisíveis (o PostgreSQL recusa o NUL)
const texto = (v, max) => String(v ?? '').replace(CONTROLE, '').replace(/\s+/g, ' ').trim().slice(0, max);
const r2 = n => Math.round(n * 100) / 100;
// Valor vindo da API: só número (o app e o painel mandam número). Texto como "0.500" não vira 500.
const valor = v => (typeof v === 'number' && Number.isFinite(v) ? r2(v) : NaN);
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
function senhaTemporaria(tamanho = 6) {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: tamanho }, () => abc[crypto.randomInt(abc.length)]).join('');
}
const SENHA_ADMIN_MIN = 8; // administrador vê tudo (inclusive dados bancários): senha mais longa que a do colaborador
// fotoV: "versão" da foto (muda quando a foto é trocada). Vai no endereço da imagem para o navegador
// não mostrar a foto antiga guardada em cache. É um resumo da referência, que nunca sai do servidor.
const versaoFoto = ref => (ref ? crypto.createHash('sha256').update(String(ref)).digest('hex').slice(0, 10) : '');
const publicoDesp = d => ({ ...d, foto: !!d.foto, fotoV: versaoFoto(d.foto) });
// Comprovantes da prestação: várias fotos, guardadas como referências separadas por "|" na coluna Fotos
const MAX_FOTOS_PREST = 10;
const refsPrest = p => String((p && p.fotos) || '').split('|').filter(Boolean);
// fotosV: versão de cada comprovante (resumo da referência). O painel remove/abre pela versão, não só pela
// posição, para uma aba desatualizada não apagar a foto errada.
const publicoPrest = p => ({ ...p, fotos: refsPrest(p).length, fotosV: refsPrest(p).map(versaoFoto) });
const posFoto = (refs, n, v) => (v ? refs.findIndex(r => versaoFoto(r) === v) : Number(n));
const publicoColab = c => ({ id: c.id, nome: c.nome, usuario: c.usuario, funcao: c.funcao, ativo: c.ativo, criadoEm: c.criadoEm,
  telefone: c.telefone || '', cidade: c.cidade || '', uf: c.uf || '' });
// Para o painel: inclui os dados bancários (saem no PDF). O app do colaborador não recebe esses dados.
const adminColab = c => ({ ...publicoColab(c), banco: c.banco || '', agencia: c.agencia || '', conta: c.conta || '', cpf: c.cpf || '', pix: c.pix || '' });
// CPF com 11 dígitos e dígitos verificadores certos (pega erro de digitação); devolve no formato 000.000.000-00
function cpfFormatado(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return '';
  const dv = n => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  if (dv(9) !== Number(d[9]) || dv(10) !== Number(d[10])) return '';
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

// Bloqueio simples contra tentativas de adivinhar senha. Dois contadores:
// - por aparelho (IP) + conta: 5 erros bloqueiam aquele aparelho por 10 minutos;
// - só pela conta, de qualquer IP: 20 erros bloqueiam a conta por 10 minutos (quem troca de IP
//   a cada tentativa não fica sem limite).
const tentativas = new Map();
const LIMITE = 5, LIMITE_CONTA = 20, BLOQUEIO_MS = 10 * 60 * 1000;
const bloqueado = (...ks) => ks.some(k => { const t = tentativas.get(k); return t && t.ate > Date.now(); });
function falhou(k, limite = LIMITE) {
  const t = tentativas.get(k) || { n: 0 };
  t.n += 1;
  if (t.n >= limite) { t.ate = Date.now() + BLOQUEIO_MS; t.n = 0; }
  tentativas.set(k, t);
}
const sucesso = (...ks) => ks.forEach(k => tentativas.delete(k));
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
// req.admin = quem está logado no painel ({ id, nome, usuario, principal }); o nome vai em "aprovado por", "pago por"...
const exigeAdmin = wrap(async (req, res, next) => {
  const s = req.sessao;
  if (s.a === PRINCIPAL || s.a === 1) { // 1: sessões abertas antes desta versão (só existia o principal)
    if (s.av === versaoAdmin()) {
      req.admin = { id: PRINCIPAL, nome: ADMIN_NOME, usuario: ADMIN_USER(), principal: true };
      return next();
    }
  } else if (s.a) {
    const a = (await store.list('Administradores')).find(x => x.id === s.a);
    if (a && a.ativo && s.av === versaoSenha(a.senhaHash)) {
      req.admin = { id: a.id, nome: a.nome, usuario: a.usuario, principal: false };
      return next();
    }
  }
  if (s.a) { sairAdmin(s); gravarSessao(res, s); }
  erro(res, 'Faça login.', 401);
});
const exigePrincipal = (req, res, next) =>
  (req.admin && req.admin.principal ? next() : erro(res, 'Só o administrador principal pode cadastrar e alterar administradores.', 403));


// ---------------- público ----------------
// /health?banco=1 também faz uma leitura leve nos dados (tabela Config, uma linha). Chamado a cada 2 dias pelo
// GitHub Actions (.github/workflows/manter-banco-ativo.yml): mantém ativo o banco gratuito do Supabase, que pausa
// depois de 7 dias sem uso. Não devolve nenhum dado, só se a leitura funcionou.
app.get('/health', wrap(async (req, res) => {
  const base = { armazenamento: store.modo, fotos: fotos ? fotos.modo : 'desligadas' };
  if (req.query.banco === undefined) return res.json({ ok: true, ...base });
  try {
    await store.list('Config');
    res.json({ ok: true, ...base, banco: 'ok' });
  } catch (err) {
    console.error('[health] leitura do banco falhou:', resumoErro(err));
    res.status(503).json({ ok: false, ...base, banco: 'falhou' });
  }
}));
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
const enviarFoto = (res, d) => (d && d.foto ? enviarFotoRef(res, d.foto) : erro(res, 'Esta despesa não tem foto.', 404));
async function enviarFotoRef(res, ref) {
  if (!fotos) return erro(res, 'Fotos indisponíveis no momento.', 503);
  try {
    const buf = await fotos.ler(ref);
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' }).send(buf);
  } catch (e) {
    if (e.naoExiste) return erro(res, 'A foto não está mais disponível.', 404);
    console.error('[fotos] ler', e.message); erro(res, 'Não foi possível carregar a foto.', 502);
  }
}

// ================= COLABORADOR (celular) =================
app.post('/api/login', wrap(async (req, res) => {
  const usuario = texto(req.body.usuario, 40).toLowerCase();
  const chave = 'c:' + req.ip + ':' + usuario, conta = 'C:' + usuario;
  if (bloqueado(chave, conta)) return erro(res, 'Muitas tentativas. Aguarde 10 minutos.', 429);
  const c = (await store.list('Colaboradores')).find(x => x.usuario === usuario && x.ativo);
  if (!c || !confereSenha(req.body.senha, c.senhaHash)) { falhou(chave); falhou(conta, LIMITE_CONTA); return erro(res, 'Usuário ou senha incorretos.', 401); }
  sucesso(chave, conta);
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
  const [todas, periodos] = await Promise.all([store.list('Despesas'), store.list('Periodos')]);
  const lista = todas.filter(d => d.colaboradorId === req.colab.id)
    .sort((a, b) => (b.data + b.criadoEm).localeCompare(a.data + a.criadoEm));
  // Cada despesa vai com o período em que foi enviada (datas, status e data do pagamento); null = ainda não enviada
  const per = new Map(periodos.map(p => [p.id, { dataInicial: p.dataInicial, dataFinal: p.dataFinal, status: p.status, pagoEm: p.pagoEm }]));
  res.json(lista.map(d => ({ ...publicoDesp(d), periodo: per.get(d.periodoId) || (antiga(d) ? { status: ANTERIOR } : null) })));
}));

// Fecha o período: junta todas as despesas do colaborador ainda não enviadas (em análise ou aprovadas; as
// recusadas ficam de fora) num período Enviado, da nota mais antiga à mais recente.
// antigas: true junta só as aprovadas antes do início do controle (o Maurício manda incluir no painel).
function fecharPeriodo(colab, quem, { antigas = false } = {}) {
  return comTrava(chaveFechar(colab.id), async () => {
    const livre = a => naoEnviada(a) && a.status !== STATUS.recusada;
    const candidatas = (await store.list('Despesas', { fresco: true }))
      .filter(d => d.colaboradorId === colab.id && livre(d) && antiga(d) === antigas);
    if (!candidatas.length) return { erro: antigas ? 'Esse colaborador não tem despesas antigas pendentes.' : 'Não há despesas novas para enviar.' };
    const datasDe = l => l.map(d => d.data).sort();
    const datas = datasDe(candidatas);
    const p = { id: novoId(), colaboradorId: colab.id, colaborador: colab.nome, dataInicial: datas[0], dataFinal: datas[datas.length - 1],
      status: ENVIADO, fechadoEm: new Date().toISOString(), fechadoPor: quem, pagoEm: '', pagoPor: '', valorPago: 0 };
    // Numa transação: se algo falhar no meio, nada fica gravado (nunca sobra meio período)
    return store.transacao(async tx => {
      await tx.add('Periodos', p);
      const entraram = [];
      for (const d of candidatas) if (await tx.update('Despesas', d.id, { periodoId: p.id }, livre)) entraram.push(d);
      if (!entraram.length) { await tx.remove('Periodos', p.id); return { erro: 'Essas despesas acabaram de mudar em outra tela. Atualize a lista.', status: 409 }; }
      let periodo = p;
      if (entraram.length < candidatas.length) { // alguma mudou no meio do caminho: as datas são só das que entraram
        const ds = datasDe(entraram);
        periodo = await tx.update('Periodos', p.id, { dataInicial: ds[0], dataFinal: ds[ds.length - 1] });
      }
      return { periodo, notas: entraram.length };
    });
  });
}
app.post('/api/periodos/fechar', exigeColab, wrap(async (req, res) => {
  const r = await fecharPeriodo(req.colab, req.colab.nome);
  if (r.erro) return erro(res, r.erro, r.status || 400);
  res.status(201).json(r);
}));

app.post('/api/despesas', exigeColab, wrap(async (req, res) => {
  const data = texto(req.body.data, 20); // não corta: "2026-10-20xyz" tem que ser recusada, não virar 2026-10-20
  const categoria = texto(req.body.categoria, 30);
  const v = valor(req.body.valor);
  const observacao = texto(req.body.observacao, 200);
  if (!NOMES_CAT.includes(categoria)) return erro(res, 'Escolha a categoria.');
  if (!(v > 0)) return erro(res, 'Informe o valor da nota.');
  if (v > VALOR_MAXIMO) return erro(res, `Valor muito alto (limite de ${valorMaximoTxt()}). Confira o que foi digitado.`);
  const problema = problemaData(data, 'A data');
  if (problema) return erro(res, problema);
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
  // Mesma trava da exclusão do colaborador: não sobra despesa de quem acabou de ser excluído
  const gravou = await comTrava(chaveFechar(req.colab.id), async () => {
    if (!(await store.list('Colaboradores', { fresco: true })).some(c => c.id === req.colab.id && c.ativo)) return false;
    await store.add('Despesas', d);
    return true;
  }).catch(e => { apagarFoto(d.foto); throw e; });
  if (!gravou) { apagarFoto(d.foto); return erro(res, 'Acesso desativado.', 401); }
  res.status(201).json(publicoDesp(d));
}));

// Foto da despesa: o colaborador vê a própria; pode adicionar ou trocar enquanto está em análise
const minhaDespesa = async (req, fresco = false) => (await store.list('Despesas', { fresco })).find(x => x.id === req.params.id && x.colaboradorId === req.colab.id);
app.get('/api/despesas/:id/foto', exigeColab, wrap(async (req, res) => {
  const d = await minhaDespesa(req);
  if (!d) return erro(res, 'Despesa não encontrada.', 404);
  enviarFoto(res, d);
}));
app.put('/api/despesas/:id/foto', exigeColab, wrap(async (req, res) => {
  const d = await minhaDespesa(req, true);
  if (!d) return erro(res, 'Despesa não encontrada.', 404);
  if (d.status !== STATUS.analise) return erro(res, 'Só dá para mudar a foto enquanto a despesa está em análise.');
  if (!naoEnviada(d)) return erro(res, 'Esta despesa já foi enviada num período e não pode mais ser alterada.');
  const f = await guardarFoto(d.id, req.body.foto);
  if (f.erro) return erro(res, f.erro);
  // Condição: só troca se continua em análise e fora de período (pode ter sido aprovada/enviada durante o envio da foto)
  const atual = await store.update('Despesas', d.id, { foto: f.ref }, a => a.status === STATUS.analise && naoEnviada(a));
  if (!atual) {
    apagarFoto(f.ref); // a foto nova não ficou ligada a nada: apaga do Cloudinary
    return atual === null ? erro(res, 'Despesa não encontrada.', 404)
      : erro(res, 'Esta despesa acabou de ser avaliada ou enviada num período e não pode mais ser alterada.', 409);
  }
  apagarFoto(d.foto); // a foto antiga
  res.json(publicoDesp(atual));
}));

app.delete('/api/despesas/:id', exigeColab, wrap(async (req, res) => {
  const d = await minhaDespesa(req, true);
  if (!d) return erro(res, 'Despesa não encontrada.', 404);
  if (d.status !== STATUS.analise) return erro(res, 'Só dá para excluir despesas que ainda estão em análise.');
  if (!naoEnviada(d)) return erro(res, 'Esta despesa já foi enviada num período e não pode mais ser excluída.');
  const r = await store.remove('Despesas', d.id, a => a.status === STATUS.analise && naoEnviada(a)); // confere de novo na hora de apagar
  if (r === 'conflito') return erro(res, 'Esta despesa acabou de ser avaliada ou enviada num período e não pode mais ser excluída.', 409);
  if (r && r.foto !== d.foto) apagarFoto(r.foto); // a foto foi trocada durante a exclusão: apaga a que estava na linha
  apagarFoto(d.foto);
  res.json({ ok: true });
}));

// ================= ADMINISTRADOR (Maurício) =================
// Entra como o principal (variáveis do ambiente) ou como um administrador da tabela
app.post('/api/admin/login', wrap(async (req, res) => {
  const usuario = texto(req.body.usuario, 100), senha = String(req.body.senha ?? '');
  const chave = 'a:' + req.ip, conta = 'A:' + usuario.toLowerCase();
  if (bloqueado(chave, conta)) return erro(res, 'Muitas tentativas. Aguarde 10 minutos.', 429);
  let entrou = null;
  if (iguais(usuario, ADMIN_USER()) && iguais(senha, process.env.ADMIN_PASSWORD || 'admin')) entrou = { a: PRINCIPAL, av: versaoAdmin() };
  else {
    const a = (await store.list('Administradores')).find(x => x.usuario === usuario.toLowerCase() && x.ativo);
    if (a && confereSenha(senha, a.senhaHash)) entrou = { a: a.id, av: versaoSenha(a.senhaHash) };
  }
  if (!entrou) { falhou(chave); falhou(conta, LIMITE_CONTA); return erro(res, 'Usuário ou senha incorretos.', 401); }
  sucesso(chave, conta);
  Object.assign(req.sessao, entrou, { ae: Date.now() + DURACAO_MS });
  gravarSessao(res, req.sessao);
  res.json({ ok: true });
}));
app.post('/api/admin/logout', (req, res) => { sairAdmin(req.sessao); gravarSessao(res, req.sessao); res.json({ ok: true }); });
app.get('/api/admin/me', exigeAdmin, (req, res) => res.json({ nome: req.admin.nome, usuario: req.admin.usuario, principal: req.admin.principal }));
// Administrador da tabela troca a própria senha (o principal troca no Render, em ADMIN_PASSWORD)
app.post('/api/admin/me/senha', exigeAdmin, wrap(async (req, res) => {
  if (req.admin.principal) return erro(res, 'A senha do administrador principal é trocada no Render (variável ADMIN_PASSWORD).');
  const a = (await store.list('Administradores', { fresco: true })).find(x => x.id === req.admin.id);
  if (!a || !confereSenha(req.body.atual, a.senhaHash)) return erro(res, 'A senha atual não confere.');
  const nova = String(req.body.nova ?? '');
  if (nova.length < SENHA_ADMIN_MIN) return erro(res, `A nova senha precisa ter pelo menos ${SENHA_ADMIN_MIN} caracteres.`);
  const senhaHash = hashSenha(nova);
  await store.update('Administradores', a.id, { senhaHash });
  req.sessao.av = versaoSenha(senhaHash); // mantém este navegador logado; os outros com a senha antiga saem
  gravarSessao(res, req.sessao);
  res.json({ ok: true });
}));

// ---- administradores (só o principal) ----
const publicoAdmin = a => ({ id: a.id, nome: a.nome, usuario: a.usuario, ativo: a.ativo, criadoEm: a.criadoEm, criadoPor: a.criadoPor });
async function validarAdmin(body, idAtual) {
  const nome = texto(body.nome, 80), usuario = texto(body.usuario, 30).toLowerCase();
  if (nome.length < 2) return { erro: 'Informe o nome.' };
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) return { erro: 'Usuário: de 3 a 30 letras minúsculas, números, ponto ou traço, sem espaços.' };
  if (usuario === ADMIN_USER().toLowerCase()) return { erro: 'Esse usuário já é o do administrador principal.' };
  const todos = await store.list('Administradores', { fresco: true });
  if (todos.some(a => a.usuario === usuario && a.id !== idAtual)) return { erro: 'Esse usuário já está em uso.' };
  return { nome, usuario };
}
app.get('/api/admin/administradores', exigeAdmin, exigePrincipal, wrap(async (req, res) => {
  const lista = (await store.list('Administradores')).map(publicoAdmin);
  res.json(lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')));
}));
app.post('/api/admin/administradores', exigeAdmin, exigePrincipal, wrap(async (req, res) => {
  const senha = senhaTemporaria(SENHA_ADMIN_MIN + 2);
  const r = await comTrava('administradores', async () => { // um cadastro de cada vez: não repete usuário
    const v = await validarAdmin(req.body);
    if (v.erro) return v;
    const a = { id: novoId(), ...v, ativo: true, senhaHash: hashSenha(senha), criadoEm: new Date().toISOString(), criadoPor: req.admin.nome };
    await store.add('Administradores', a);
    return a;
  });
  if (r.erro) return erro(res, r.erro);
  res.status(201).json({ ...publicoAdmin(r), senhaTemporaria: senha });
}));
app.put('/api/admin/administradores/:id', exigeAdmin, exigePrincipal, wrap(async (req, res) => {
  const id = String(req.params.id), campos = {};
  if ('ativo' in req.body) campos.ativo = req.body.ativo === true;
  let senha;
  if (req.body.novaSenha === true) { senha = senhaTemporaria(SENHA_ADMIN_MIN + 2); campos.senhaHash = hashSenha(senha); }
  const a = await comTrava('administradores', async () => {
    if ('nome' in req.body) {
      const v = await validarAdmin(req.body, id);
      if (v.erro) return v;
      Object.assign(campos, v);
    }
    return store.update('Administradores', id, campos);
  });
  if (a && a.erro) return erro(res, a.erro);
  if (!a) return erro(res, 'Administrador não encontrado.', 404);
  res.json({ ...publicoAdmin(a), ...(senha ? { senhaTemporaria: senha } : {}) });
}));
app.delete('/api/admin/administradores/:id', exigeAdmin, exigePrincipal, wrap(async (req, res) => {
  const r = await store.remove('Administradores', String(req.params.id));
  if (!r) return erro(res, 'Administrador não encontrado.', 404);
  res.json({ ok: true }); // o nome dele continua nos registros antigos ("aprovado por", "pago por")
}));

// Tudo o que o painel precisa de uma vez (volume pequeno); os resumos são calculados na tela
app.get('/api/admin/dados', exigeAdmin, wrap(async (req, res) => {
  const [colaboradores, funcoes, prestacoes, despesas, periodos] = await Promise.all(
    ['Colaboradores', 'Funcoes', 'Prestacoes', 'Despesas', 'Periodos'].map(t => store.list(t)));
  res.json({
    categorias: CATEGORIAS,
    funcoes: funcoes.map(f => f.nome).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    colaboradores: colaboradores.map(adminColab).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    prestacoes: prestacoes.map(publicoPrest), despesas: despesas.map(publicoDesp), periodos, inicioPeriodos: INICIO_PERIODOS,
    fotos: !!fotos,
  });
}));

// ---- funções ----
app.post('/api/admin/funcoes', exigeAdmin, wrap(async (req, res) => {
  const nome = texto(req.body.nome, 40);
  if (nome.length < 2) return erro(res, 'Informe o nome da função.');
  // Um cadastro de cada vez: dois pedidos juntos não criam a mesma função duas vezes
  const criou = await comTrava('funcoes', async () => {
    const existe = (await store.list('Funcoes', { fresco: true })).some(f => f.nome.toLowerCase() === nome.toLowerCase());
    if (!existe) await store.add('Funcoes', { id: novoId(), nome, criadoEm: new Date().toISOString() });
    return !existe;
  });
  if (!criou) return erro(res, 'Essa função já existe.');
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
  // Telefone, cidade e UF são opcionais (saem na folha "Prestação de contas" em PDF)
  const telefone = texto(body.telefone, 20), cidade = texto(body.cidade, 60), uf = texto(body.uf, 2).toUpperCase();
  if (nome.length < 2) return { erro: 'Informe o nome.' };
  if (uf && !UFS.includes(uf)) return { erro: 'Escolha a UF da lista.' };
  // Dados bancários (opcionais, saem no PDF)
  const banco = texto(body.banco, 40), agencia = texto(body.agencia, 15), conta = texto(body.conta, 25), pix = texto(body.pix, 80);
  const cpfDigitado = texto(body.cpf, 20), cpf = cpfFormatado(cpfDigitado);
  if (cpfDigitado && !cpf) return { erro: 'CPF inválido. Confira os números.' };
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) return { erro: 'Usuário: de 3 a 30 letras minúsculas, números, ponto ou traço, sem espaços.' };
  const funcoes = (await store.list('Funcoes')).map(f => f.nome);
  if (!funcoes.includes(funcao)) return { erro: 'Escolha uma função cadastrada.' };
  const todos = await store.list('Colaboradores', { fresco: true });
  if (todos.some(c => c.usuario === usuario && c.id !== idAtual)) return { erro: 'Esse usuário já está em uso.' };
  return { nome, usuario, funcao, telefone, cidade, uf, banco, agencia, conta, cpf, pix };
}

app.post('/api/admin/colaboradores', exigeAdmin, wrap(async (req, res) => {
  const senha = senhaTemporaria();
  // Validação e gravação juntas, um cadastro de cada vez: dois pedidos juntos não criam o mesmo usuário duas vezes
  const r = await comTrava('colaboradores', async () => {
    const v = await validarColab(req.body);
    if (v.erro) return v;
    const c = { id: novoId(), ...v, ativo: true, senhaHash: hashSenha(senha), criadoEm: new Date().toISOString() };
    await store.add('Colaboradores', c);
    return c;
  });
  if (r.erro) return erro(res, r.erro);
  res.status(201).json({ ...adminColab(r), senhaTemporaria: senha });
}));

app.put('/api/admin/colaboradores/:id', exigeAdmin, wrap(async (req, res) => {
  const id = String(req.params.id);
  const campos = {};
  if ('ativo' in req.body) campos.ativo = !!req.body.ativo;
  let senha;
  if (req.body.novaSenha) { senha = senhaTemporaria(); campos.senhaHash = hashSenha(senha); }
  const c = await comTrava('colaboradores', async () => { // mesma trava do cadastro (o usuário pode mudar aqui)
    if ('nome' in req.body) {
      const v = await validarColab(req.body, id);
      if (v.erro) return v;
      // nome, usuário e função sempre; os opcionais (telefone, cidade, banco, CPF...) só se vieram no pedido
      for (const [k, val] of Object.entries(v)) if (['nome', 'usuario', 'funcao'].includes(k) || k in req.body) campos[k] = val;
    }
    return store.update('Colaboradores', id, campos);
  });
  if (c && c.erro) return erro(res, c.erro);
  if (!c) return erro(res, 'Colaborador não encontrado.', 404);
  res.json({ ...adminColab(c), ...(senha ? { senhaTemporaria: senha } : {}) });
}));

// Só exclui colaborador sem nenhum lançamento; quem tem histórico deve ser desativado,
// para os resumos continuarem certos.
app.delete('/api/admin/colaboradores/:id', exigeAdmin, wrap(async (req, res) => {
  const id = String(req.params.id);
  // Conta os lançamentos e exclui sem ninguém lançar no meio (mesma trava do lançamento de despesa)
  const r = await comTrava(chaveFechar(id), async () => {
    const [prest, desp] = await Promise.all([store.list('Prestacoes', { fresco: true }), store.list('Despesas', { fresco: true })]);
    const n = prest.filter(p => p.colaboradorId === id).length + desp.filter(d => d.colaboradorId === id).length;
    if (n) return { erro: `Este colaborador tem ${n} lançamento${n === 1 ? '' : 's'} (prestações ou despesas do app). Para manter o histórico, use Desativar.` };
    return (await store.remove('Colaboradores', id)) ? {} : { erro: 'Colaborador não encontrado.', status: 404 };
  });
  if (r.erro) return erro(res, r.erro, r.status || 400);
  res.json({ ok: true });
}));

// ---- prestações (lançadas pelo Maurício) ----
async function validarPrestacao(body, atual) {
  const colab = (await store.list('Colaboradores')).find(c => c.id === String(body.colaboradorId || ''));
  if (!colab) return { erro: 'Escolha o colaborador.' };
  const mesmoColab = atual && atual.colaboradorId === colab.id;
  if (!colab.ativo && !mesmoColab) return { erro: `${colab.nome} está desativado. Reative o colaborador para lançar uma prestação nova.` };
  const dataInicial = texto(body.dataInicial, 20), dataFinal = texto(body.dataFinal, 20), mesRef = texto(body.mesRef, 20); // não corta antes de validar
  const problema = problemaData(dataInicial, 'A data inicial') || problemaData(dataFinal, 'A data final');
  if (problema) return { erro: problema };
  if (dataFinal < dataInicial) return { erro: 'A data final não pode ser antes da inicial.' };
  if (!mesValido(mesRef)) return { erro: 'Escolha o mês de referência.' };
  if (mesRef < dataInicial.slice(0, 7) || mesRef > dataFinal.slice(0, 7)) return { erro: 'O mês de referência precisa estar dentro do período (entre a data inicial e a final).' };
  // Editar uma prestação antiga mantém o nome e a função gravados nela (a função "do momento em que foi feita")
  const p = mesmoColab
    ? { colaboradorId: colab.id, colaborador: atual.colaborador, funcao: atual.funcao, dataInicial, dataFinal, mesRef }
    : { colaboradorId: colab.id, colaborador: colab.nome, funcao: colab.funcao, dataInicial, dataFinal, mesRef };
  let total = 0;
  for (const c of CATEGORIAS) {
    const v = body[c.chave] == null ? 0 : valor(body[c.chave]); // categoria não enviada = 0
    if (!(v >= 0)) return { erro: `Valor inválido em ${c.nome}.` };
    if (v > VALOR_MAXIMO) return { erro: `O valor de ${c.nome} passa do limite de ${valorMaximoTxt()} por categoria. Confira o que foi digitado.` };
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
  const nova = { id: novoId(), ...p, criadoEm: new Date().toISOString(), fotos: '' };
  await comTrava(chaveFechar(nova.colaboradorId), () => store.add('Prestacoes', nova));
  res.status(201).json(publicoPrest(nova));
}));
app.put('/api/admin/prestacoes/:id', exigeAdmin, wrap(async (req, res) => {
  const anterior = (await store.list('Prestacoes')).find(x => x.id === String(req.params.id));
  if (!anterior) return erro(res, 'Prestação não encontrada.', 404);
  const p = await validarPrestacao(req.body, anterior);
  if (p.erro) return erro(res, p.erro);
  const atual = await store.update('Prestacoes', String(req.params.id), p);
  if (!atual) return erro(res, 'Prestação não encontrada.', 404);
  res.json(publicoPrest(atual));
}));
app.delete('/api/admin/prestacoes/:id', exigeAdmin, wrap(async (req, res) => {
  const p = (await store.list('Prestacoes')).find(x => x.id === String(req.params.id));
  if (!p) return erro(res, 'Prestação não encontrada.', 404);
  const apagada = await store.remove('Prestacoes', p.id);
  refsPrest(apagada && apagada.id ? apagada : p).forEach(apagarFoto); // fotos que estavam na linha na hora (inclui uma enviada há pouco)
  res.json({ ok: true });
}));

// ---- comprovantes da prestação (fotos anexadas pelo Maurício) ----
const acharPrest = async id => (await store.list('Prestacoes')).find(x => x.id === String(id));
app.post('/api/admin/prestacoes/:id/fotos', exigeAdmin, wrap(async (req, res) => {
  const p = await acharPrest(req.params.id);
  if (!p) return erro(res, 'Prestação não encontrada.', 404);
  if (refsPrest(p).length >= MAX_FOTOS_PREST) return erro(res, `Cada prestação aceita até ${MAX_FOTOS_PREST} fotos.`);
  const f = await guardarFoto('prest-' + p.id, req.body.foto);
  if (f.erro) return erro(res, f.erro);
  // lê de novo logo antes de gravar, para não perder uma foto enviada ao mesmo tempo
  const agora = (await store.list('Prestacoes', { fresco: true })).find(x => x.id === p.id);
  if (!agora) { apagarFoto(f.ref); return erro(res, 'Prestação não encontrada.', 404); }
  if (refsPrest(agora).length >= MAX_FOTOS_PREST) { apagarFoto(f.ref); return erro(res, `Cada prestação aceita até ${MAX_FOTOS_PREST} fotos.`); }
  // Condição: só grava se ninguém mexeu nas fotos durante o envio (senão uma das duas fotos se perderia)
  const atual = await store.update('Prestacoes', p.id, { fotos: [...refsPrest(agora), f.ref].join('|') }, a => String(a.fotos || '') === String(agora.fotos || ''));
  if (!atual) {
    apagarFoto(f.ref);
    return atual === null ? erro(res, 'Prestação não encontrada.', 404) : erro(res, 'As fotos desta prestação mudaram durante o envio. Envie esta foto de novo.', 409);
  }
  res.status(201).json(publicoPrest(atual));
}));
app.get('/api/admin/prestacoes/:id/fotos/:n', exigeAdmin, wrap(async (req, res) => {
  const refs = refsPrest(await acharPrest(req.params.id)), ref = refs[posFoto(refs, req.params.n, String(req.query.v || ''))];
  if (!ref) return erro(res, 'Foto não encontrada.', 404);
  enviarFotoRef(res, ref);
}));
app.delete('/api/admin/prestacoes/:id/fotos/:n', exigeAdmin, wrap(async (req, res) => {
  const p = await acharPrest(req.params.id);
  const refs = refsPrest(p), v = String(req.query.v || ''), n = posFoto(refs, req.params.n, v);
  if (!refs[n]) return v ? erro(res, 'Esta foto já foi removida ou a lista mudou em outra tela. A lista foi atualizada; confira antes de remover.', 409) : erro(res, 'Foto não encontrada.', 404);
  const antes = p.fotos;
  const [removida] = refs.splice(n, 1);
  // só grava se ninguém mudou os comprovantes entre a leitura e a gravação
  const atual = await store.update('Prestacoes', p.id, { fotos: refs.join('|') }, a => String(a.fotos || '') === String(antes || ''));
  if (atual === false) return erro(res, 'A lista de fotos mudou em outra tela. A lista foi atualizada; confira antes de remover.', 409);
  if (!atual) return erro(res, 'Prestação não encontrada.', 404);
  apagarFoto(removida);
  res.json(publicoPrest(atual));
}));

// ---- aprovação das despesas do celular ----
app.post('/api/admin/despesas/:id/:acao', exigeAdmin, wrap(async (req, res) => {
  const acao = req.params.acao;
  if (!['aprovar', 'recusar', 'reabrir'].includes(acao)) return erro(res, 'Ação inválida.', 404);
  const status = acao === 'aprovar' ? STATUS.aprovada : acao === 'recusar' ? STATUS.recusada : STATUS.analise;
  // Aprovar/recusar só o que está em análise; desfazer só o que já foi avaliado. Evita que uma aba
  // com dados antigos troque, sem avisar, uma decisão já tomada em outra aba.
  const pode = atual => (acao === 'reabrir' ? atual.status !== STATUS.analise : atual.status === STATUS.analise);
  const id = String(req.params.id);
  const antes = (await store.list('Despesas', { fresco: true })).find(x => x.id === id);
  if (!antes) return erro(res, 'Despesa não encontrada.', 404);
  // Roda com a trava do período da despesa (ou do colaborador, se ainda não foi enviada): não cruza com um
  // pagamento, uma reabertura ou um fechamento de período em andamento
  const MSG_PAGA = 'Esta despesa está num período já pago. Desfaça o pagamento em Pagamentos antes de mudar a despesa.';
  const pago = async d => !naoEnviada(d) && ((await acharPeriodo(d.periodoId)) || {}).status === PAGO;
  if (await pago(antes)) return erro(res, MSG_PAGA);
  const mesmoPeriodo = a => (a.periodoId || '') === (antes.periodoId || '');
  const r = await comTrava(chaveDespesa(antes), async () => {
    const agora = (await store.list('Despesas', { fresco: true })).find(x => x.id === id);
    if (agora && !mesmoPeriodo(agora)) return { d: false }; // foi enviada (ou reaberta) no meio do caminho
    if (agora && await pago(agora)) return { erro: MSG_PAGA, status: 400 };
    return { d: await store.update('Despesas', id, {
      status,
      avaliadoEm: acao === 'reabrir' ? '' : new Date().toISOString(),
      avaliadoPor: acao === 'reabrir' ? '' : req.admin.nome,
    }, a => pode(a) && mesmoPeriodo(a)) };
  });
  if (r.erro) return erro(res, r.erro, r.status);
  if (r.d === null) return erro(res, 'Despesa não encontrada.', 404);
  if (r.d === false) return erro(res, 'Esta despesa já foi alterada em outra tela. A lista foi atualizada; confira o status atual.', 409);
  res.json(publicoDesp(r.d));
}));
app.get('/api/admin/despesas/:id/foto', exigeAdmin, wrap(async (req, res) =>
  enviarFoto(res, (await store.list('Despesas')).find(x => x.id === req.params.id))));

// ---- períodos de pagamento (painel) ----
const acharPeriodo = async id => (await store.list('Periodos', { fresco: true })).find(p => p.id === String(id));
const acharColab = async id => (await store.list('Colaboradores')).find(x => x.id === String(id || ''));
// O Maurício também pode fechar o período por um colaborador (ex.: se ele esqueceu)
app.post('/api/admin/periodos/fechar', exigeAdmin, wrap(async (req, res) => {
  const c = await acharColab(req.body.colaboradorId);
  if (!c) return erro(res, 'Escolha o colaborador.');
  const r = await fecharPeriodo(c, req.admin.nome);
  if (r.erro) return erro(res, r.erro, r.status || 400);
  res.status(201).json(r);
}));
// Pagar o período: só depois de todas as notas dele serem aprovadas ou recusadas; guarda o valor pago
// (soma das aprovadas). Com a trava do período: não cruza com aprovar/recusar uma nota dele nem com reabrir.
app.post('/api/admin/periodos/:id/pagar', exigeAdmin, wrap(async (req, res) => {
  const id = String(req.params.id);
  const r = await comTrava(chavePeriodo(id), async () => {
    const p = await acharPeriodo(id);
    if (!p) return { erro: 'Período não encontrado.', status: 404 };
    if (p.status !== ENVIADO) return { erro: 'Este período já foi pago.', status: 409 };
    const notas = (await store.list('Despesas', { fresco: true })).filter(d => d.periodoId === id);
    const anal = notas.filter(d => d.status === STATUS.analise).length;
    if (anal) return { erro: `Ainda há ${anal} despesa${anal > 1 ? 's' : ''} em análise neste período. Aprove ou recuse antes de pagar.` };
    const aprov = notas.filter(d => d.status === STATUS.aprovada);
    if (!aprov.length) return { erro: 'Nenhuma despesa aprovada neste período. Reabra o período ou aprove as notas antes de pagar.' };
    const agora = new Date().toISOString();
    const pago = await store.update('Periodos', id, { status: PAGO, pagoEm: agora, pagoPor: req.admin.nome,
      valorPago: r2(aprov.reduce((t, d) => t + d.valor, 0)) }, a => a.status === ENVIADO);
    return pago ? { periodo: pago } : { erro: 'Este período acabou de mudar em outra tela. A lista foi atualizada.', status: 409 };
  });
  if (r.erro) return erro(res, r.erro, r.status || 400);
  res.json(r);
}));
// Reabrir: desfaz o envio (as despesas voltam a ficar "não enviadas" e o colaborador pode enviar de novo).
// Só enquanto o período não foi pago. As antigas que estavam nele voltam como liberadas (não caem na caixa
// das antigas de novo).
app.post('/api/admin/periodos/:id/reabrir', exigeAdmin, wrap(async (req, res) => {
  const id = String(req.params.id);
  const r = await comTrava(chavePeriodo(id), async () => {
    const p = await acharPeriodo(id);
    if (!p) return { erro: 'Período não encontrado.', status: 404 };
    if (p.status !== ENVIADO) return { erro: 'Período já pago: desfaça o pagamento antes de reabrir.', status: 409 };
    // dentro também da trava do colaborador: não cruza com ele fechando um período novo
    return comTrava(chaveFechar(p.colaboradorId), () => store.transacao(async tx => { // tudo ou nada
      for (const d of (await tx.list('Despesas')).filter(x => x.periodoId === id)) {
        await tx.update('Despesas', d.id, { periodoId: d.criadoEm < INICIO_PERIODOS ? LIBERADA : '' }, a => a.periodoId === id);
      }
      await tx.remove('Periodos', id);
      return { ok: true };
    }));
  });
  if (r.erro) return erro(res, r.erro, r.status || 400);
  res.json(r);
}));
// Desfazer o pagamento: o período volta a "Enviado" (aguardando pagamento). Um pagamento "antes do sistema"
// é desfeito por inteiro: as despesas voltam para a caixa das antigas, para decidir de novo.
app.post('/api/admin/periodos/:id/desfazer-pagamento', exigeAdmin, wrap(async (req, res) => {
  const id = String(req.params.id);
  const r = await comTrava(chavePeriodo(id), async () => {
    const p = await acharPeriodo(id);
    if (!p) return { erro: 'Pagamento não encontrado.', status: 404 };
    if (p.status !== PAGO) return { erro: 'Este período ainda não foi pago.', status: 409 };
    if (!Regras.antesDoSistema(p)) {
      const volta = await store.update('Periodos', id, { status: ENVIADO, pagoEm: '', pagoPor: '', valorPago: 0 }, a => a.status === PAGO);
      return volta ? { periodo: volta } : { erro: 'Este período acabou de mudar em outra tela. A lista foi atualizada.', status: 409 };
    }
    return store.transacao(async tx => { // tudo ou nada
      for (const d of (await tx.list('Despesas')).filter(x => x.periodoId === id)) {
        await tx.update('Despesas', d.id, { periodoId: '' }, a => a.periodoId === id);
      }
      await tx.remove('Periodos', id);
      return { ok: true };
    });
  });
  if (r.erro) return erro(res, r.erro, r.status || 400);
  res.json(r);
}));
// Despesas antigas (aprovadas antes do controle de pagamentos): o Maurício decide por colaborador.
// jaPagas: viram um pagamento "pago antes do sistema"; senão entram num período Enviado, para pagar.
app.post('/api/admin/periodos/antigas', exigeAdmin, wrap(async (req, res) => {
  const c = await acharColab(req.body.colaboradorId);
  if (!c) return erro(res, 'Escolha o colaborador.');
  if (req.body.jaPagas !== true) {
    const r = await fecharPeriodo(c, req.admin.nome, { antigas: true });
    if (r.erro) return erro(res, r.erro, r.status || 400);
    return res.status(201).json(r);
  }
  const livre = a => !a.periodoId && a.status === STATUS.aprovada;
  const r = await comTrava(chaveFechar(c.id), async () => {
    const lista = (await store.list('Despesas', { fresco: true })).filter(d => d.colaboradorId === c.id && antiga(d));
    if (!lista.length) return { erro: 'Esse colaborador não tem despesas antigas pendentes.' };
    const datas = lista.map(d => d.data).sort(), agora = new Date().toISOString();
    const pg = { id: novoId(), colaboradorId: c.id, colaborador: c.nome, dataInicial: datas[0], dataFinal: datas[datas.length - 1], status: PAGO,
      fechadoEm: agora, fechadoPor: req.admin.nome, pagoEm: agora, pagoPor: `${req.admin.nome} (${ANTES_DO_SISTEMA})`, valorPago: 0 };
    // Numa transação: se algo falhar no meio, nada fica gravado (nunca sobra pagamento pela metade)
    return store.transacao(async tx => {
      await tx.add('Periodos', pg);
      let soma = 0, n = 0;
      for (const d of lista) { const ok = await tx.update('Despesas', d.id, { periodoId: pg.id }, livre); if (ok) { soma += ok.valor; n++; } }
      if (!n) { // todas mudaram no meio do caminho: não deixa um pagamento vazio
        await tx.remove('Periodos', pg.id);
        return { erro: 'As despesas antigas mudaram enquanto você decidia. Confira a tela de novo.', status: 409 };
      }
      return { pagamento: await tx.update('Periodos', pg.id, { valorPago: r2(soma) }), notas: n };
    });
  });
  if (r.erro) return erro(res, r.erro, r.status || 400);
  res.status(201).json(r);
}));

// ---------------- páginas ----------------
// no-cache: o navegador sempre confere se há versão nova (evita admin.html antigo com admin.js novo)
const semCache = res => res.setHeader('Cache-Control', 'no-cache');
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', setHeaders: semCache }));
app.get('/admin', (req, res) => { semCache(res); res.sendFile(path.join(__dirname, 'public', 'admin.html')); });
app.use('/api', (req, res) => erro(res, 'Rota não encontrada.', 404));

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return erro(res, rotaComFoto(req) ? 'Foto muito grande. Tente outra foto.' : 'Dados grandes demais. Confira o que foi digitado.', 413);
  if (err.status >= 400 && err.status < 500) return erro(res, 'Requisição inválida.', err.status);
  // Só o resumo: o objeto inteiro de um erro do Google traz o token de acesso nos cabeçalhos
  console.error(`[erro] ${req.method} ${req.originalUrl.split('?')[0]} — ${resumoErro(err)}`);
  const onde = ondeAconteceu(err);
  if (onde) console.error(onde);
  res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
});

async function iniciar() {
  await store.init();
  // Primeira vez (com trava: dois servidores subindo juntos não gravam duas vezes)
  const gravado = await store.transacao(async tx => {
    const cfg = await tx.list('Config');
    const valor = id => (cfg.find(c => c.id === id) || {}).valor;
    // Início do controle de pagamentos: sempre a data real da primeira vez. INICIO_PERIODOS no ambiente (testes)
    // vale só enquanto estiver definido e nunca é gravado.
    if (!valor('inicioPeriodos')) await tx.add('Config', { id: 'inicioPeriodos', valor: new Date().toISOString() });
    // Funções iniciais: só na primeira vez (se depois todas forem excluídas, não voltam sozinhas)
    if (!valor('funcoesIniciais')) {
      if (!(await tx.list('Funcoes')).length) {
        for (const nome of FUNCOES_INICIAIS) await tx.add('Funcoes', { id: novoId(), nome, criadoEm: new Date().toISOString() });
      }
      await tx.add('Config', { id: 'funcoesIniciais', valor: 'criadas' });
    }
    return (await tx.list('Config')).find(c => c.id === 'inicioPeriodos').valor;
  }, { trava: 'inicio' });
  INICIO_PERIODOS = process.env.INICIO_PERIODOS || gravado;
  app.listen(PORT, () => console.log(`Ajuda de Custo rodando na porta ${PORT} (armazenamento: ${store.modo}, fotos: ${fotos ? fotos.modo : "desligadas"})`));
}
// Dica em português para os erros de conexão com o banco mais comuns na hora de subir
const dicaBanco = msg => (store.modo !== 'banco' ? ''
  : /certificate|self.signed/i.test(msg) ? ' → o DATABASE_SSL_CA não confere com o certificado do banco (baixe de novo no Supabase).'
  : /password authentication/i.test(msg) ? ' → senha do banco errada no DATABASE_URL.'
  : /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|timeout/i.test(msg) ? ' → o banco não respondeu: confira o DATABASE_URL e se o projeto do Supabase está ativo (não pausado).'
  : '');
iniciar().catch(err => { const r = resumoErro(err); console.error('Falha ao iniciar:', r + dicaBanco(r)); process.exit(1); });
