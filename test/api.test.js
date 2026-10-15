// Testes automáticos do sistema. Rode com: npm test   (no Windows: npm.cmd test)
//
// Sobem o servidor numa porta separada, SEMPRE em memória: as variáveis do Google, do Cloudinary e de
// produção são zeradas abaixo, então nada é gravado na planilha real nem no Cloudinary, mesmo que exista
// um arquivo .env com as credenciais.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { paraNumero } = require('../services/store');
const { lerDataUrl, assinar } = require('../services/fotos');

const PORTA = 3900 + Math.floor(Math.random() * 90);
const B = `http://localhost:${PORTA}`;
let servidor;

before(async () => {
  const env = {
    ...process.env, PORT: String(PORTA),
    // vazias de propósito: o dotenv não sobrescreve variáveis já definidas
    NODE_ENV: '', SPREADSHEET_ID: '', GOOGLE_SERVICE_ACCOUNT_EMAIL: '', GOOGLE_PRIVATE_KEY: '',
    CLOUDINARY_URL: '', SESSION_SECRET: '', ADMIN_USER: '', ADMIN_PASSWORD: '', ADMIN_NOME: '',
  };
  servidor = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ok, falha) => {
    const t = setTimeout(() => falha(new Error('O servidor não subiu em 10 s')), 10000);
    servidor.stdout.on('data', d => { if (String(d).includes('rodando')) { clearTimeout(t); ok(); } });
    servidor.on('exit', c => falha(new Error('O servidor parou (código ' + c + ')')));
  });
});
after(() => servidor && servidor.kill());

// Cliente simples que guarda o cookie de sessão (como um navegador)
function cliente() {
  let cookie = '';
  const chamar = async (metodo, url, corpo) => {
    const r = await fetch(B + url, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const novo = r.headers.get('set-cookie');
    if (novo) cookie = novo.split(';')[0].endsWith('=') ? '' : novo.split(';')[0];
    const tipo = r.headers.get('content-type') || '';
    const dados = tipo.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
    return { status: r.status, dados, headers: r.headers };
  };
  return {
    get: url => chamar('GET', url), post: (url, c) => chamar('POST', url, c || {}),
    put: (url, c) => chamar('PUT', url, c || {}), del: url => chamar('DELETE', url),
    setCookie: c => { cookie = c; }, get cookie() { return cookie; },
  };
}
const fotoFake = () => 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]).toString('base64');
const ontem = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);

async function adminLogado() {
  const a = cliente();
  assert.equal((await a.post('/api/admin/login', { usuario: 'admin', senha: 'admin' })).status, 200);
  return a;
}
let seq = 0;
async function novoColaborador(a, funcao = 'Vendedor') {
  const usuario = 'teste' + (++seq) + Date.now().toString(36);
  const r = await a.post('/api/admin/colaboradores', { nome: 'Colab ' + usuario, usuario, funcao });
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  const c = cliente();
  assert.equal((await c.post('/api/login', { usuario, senha: r.dados.senhaTemporaria })).status, 200);
  return { c, id: r.dados.id, usuario, senha: r.dados.senhaTemporaria };
}

// ---------------- funções puras ----------------
test('paraNumero entende ponto e vírgula', () => {
  assert.equal(paraNumero('186,40'), 186.4);
  assert.equal(paraNumero('1.234,50'), 1234.5);
  assert.equal(paraNumero('1,234.50'), 1234.5);
  assert.equal(paraNumero('R$ 12'), 12);
  assert.equal(paraNumero(''), 0);
  assert.equal(paraNumero('abc'), 0);
});
test('assinatura do Cloudinary segue o formato documentado', () => {
  // parâmetros em ordem alfabética + segredo, SHA-1
  const esperado = require('node:crypto').createHash('sha1').update('public_id=a&timestamp=1&type=authenticated' + 'seg').digest('hex');
  assert.equal(assinar({ type: 'authenticated', timestamp: 1, public_id: 'a' }, 'seg'), esperado);
});
test('foto: só aceita JPEG válido', () => {
  assert.ok(lerDataUrl(fotoFake()).buf);
  assert.ok(lerDataUrl('data:image/png;base64,AAAA').erro);
  assert.ok(lerDataUrl('data:image/jpeg;base64,' + Buffer.alloc(300).toString('base64')).erro);
});

// ---------------- servidor ----------------
test('health e versão', async () => {
  const r = await cliente().get('/health');
  assert.equal(r.dados.armazenamento, 'memoria');
  assert.ok(r.headers.get('x-versao'));
});

test('login do painel: senha errada recusa, cookie adulterado não entra', async () => {
  const x = cliente();
  assert.equal((await x.post('/api/admin/login', { usuario: 'admin', senha: 'errada' })).status, 401);
  x.setCookie('ajudacusto.s=eyJhIjoxfQ.assinaturafalsa');
  assert.equal((await x.get('/api/admin/me')).status, 401);
  const a = await adminLogado();
  assert.equal((await a.get('/api/admin/me')).status, 200);
});

test('cadastro de colaborador: usuário repetido é recusado', async () => {
  const a = await adminLogado();
  const { usuario } = await novoColaborador(a);
  const r = await a.post('/api/admin/colaboradores', { nome: 'Outro', usuario, funcao: 'Vendedor' });
  assert.equal(r.status, 400);
});

test('despesa: validações', async () => {
  const a = await adminLogado();
  const { c } = await novoColaborador(a);
  const amanha = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  assert.equal((await c.post('/api/despesas', { data: ontem(), categoria: 'Nada', valor: 10 })).status, 400);
  assert.equal((await c.post('/api/despesas', { data: amanha, categoria: 'Hotel', valor: 10 })).status, 400);
  assert.equal((await c.post('/api/despesas', { data: ontem(), categoria: 'Outros', valor: 10 })).status, 400);
  assert.equal((await c.post('/api/despesas', { data: ontem(), categoria: 'Hotel', valor: 0 })).status, 400);
  assert.equal((await c.post('/api/despesas', { data: ontem(), categoria: 'Hotel', valor: 99999 })).status, 400);
});

test('fluxo completo: envia com foto, aprova, desfaz, exclui', async () => {
  const a = await adminLogado();
  const { c } = await novoColaborador(a);
  const outro = (await novoColaborador(a)).c;

  const d = (await c.post('/api/despesas', { data: ontem(), categoria: 'Hotel', valor: 45.5, foto: fotoFake() })).dados;
  assert.equal(d.status, 'Em análise');
  assert.equal(d.foto, true, 'a tela recebe só "tem foto", não a referência');

  // foto: dono e painel veem; outro colaborador e anônimo não
  const f = await c.get(`/api/despesas/${d.id}/foto`);
  assert.equal(f.status, 200);
  assert.equal(f.headers.get('content-type'), 'image/jpeg');
  assert.equal((await a.get(`/api/admin/despesas/${d.id}/foto`)).status, 200);
  assert.equal((await outro.get(`/api/despesas/${d.id}/foto`)).status, 404);
  assert.equal((await cliente().get(`/api/admin/despesas/${d.id}/foto`)).status, 401);

  // aprova -> colaborador não pode mais excluir
  assert.equal((await a.post(`/api/admin/despesas/${d.id}/aprovar`)).dados.status, 'Aprovada');
  assert.equal((await c.del(`/api/despesas/${d.id}`)).status, 400);
  // desfaz -> volta para análise -> pode excluir
  assert.equal((await a.post(`/api/admin/despesas/${d.id}/reabrir`)).dados.status, 'Em análise');
  assert.equal((await c.del(`/api/despesas/${d.id}`)).status, 200);
  assert.equal((await c.get('/api/despesas')).dados.length, 0);
});

test('troca de senha desconecta os outros aparelhos', async () => {
  const a = await adminLogado();
  const { c, usuario, senha, id } = await novoColaborador(a);
  const segundo = cliente();
  await segundo.post('/api/login', { usuario, senha });
  // o colaborador troca a senha no aparelho 1: ele continua, o aparelho 2 cai
  assert.equal((await c.post('/api/me/senha', { atual: senha, nova: 'novasenha1' })).status, 200);
  assert.equal((await c.get('/api/me')).status, 200);
  assert.equal((await segundo.get('/api/me')).status, 401);
  // "Nova senha" pelo painel derruba também o aparelho 1
  await a.put('/api/admin/colaboradores/' + id, { novaSenha: true });
  assert.equal((await c.get('/api/me')).status, 401);
});

test('travas de exclusão: colaborador com histórico e função em uso', async () => {
  const a = await adminLogado();
  await a.post('/api/admin/funcoes', { nome: 'Função Teste' });
  const { c, id } = await novoColaborador(a, 'Função Teste');
  await c.post('/api/despesas', { data: ontem(), categoria: 'Hotel', valor: 10 });
  assert.equal((await a.del('/api/admin/colaboradores/' + id)).status, 400);
  assert.equal((await a.del('/api/admin/funcoes/' + encodeURIComponent('Função Teste'))).status, 400);
  // sem histórico: pode excluir
  const livre = await novoColaborador(a);
  assert.equal((await a.del('/api/admin/colaboradores/' + livre.id)).status, 200);
});

test('colaborador desativado perde o acesso na hora', async () => {
  const a = await adminLogado();
  const { c, id } = await novoColaborador(a);
  await a.put('/api/admin/colaboradores/' + id, { ativo: false });
  assert.equal((await c.get('/api/me')).status, 401);
});

test('prestação: comprovantes (anexar, ver, remover, limite) e data com ano inválido', async () => {
  const a = await adminLogado();
  const { id: colaboradorId } = await novoColaborador(a);
  const base = { colaboradorId, dataInicial: ontem(), dataFinal: ontem(), mesRef: ontem().slice(0, 7), hotel: 100 };
  // ano absurdo (ex.: 07/07/7777) é recusado
  assert.equal((await a.post('/api/admin/prestacoes', { ...base, dataInicial: '7777-07-07', dataFinal: '7777-07-07', mesRef: '7777-07' })).status, 400);

  const p = (await a.post('/api/admin/prestacoes', base)).dados;
  assert.equal(p.fotos, 0);
  assert.equal((await a.post(`/api/admin/prestacoes/${p.id}/fotos`, { foto: fotoFake() })).dados.fotos, 1);
  assert.equal((await a.post(`/api/admin/prestacoes/${p.id}/fotos`, { foto: fotoFake() })).dados.fotos, 2);
  assert.equal((await a.post(`/api/admin/prestacoes/${p.id}/fotos`, { foto: 'data:image/png;base64,AAAA' })).status, 400);

  const f = await a.get(`/api/admin/prestacoes/${p.id}/fotos/1`);
  assert.equal(f.status, 200);
  assert.equal(f.headers.get('content-type'), 'image/jpeg');
  assert.equal((await a.get(`/api/admin/prestacoes/${p.id}/fotos/5`)).status, 404);
  assert.equal((await cliente().get(`/api/admin/prestacoes/${p.id}/fotos/0`)).status, 401);

  // editar a prestação não perde as fotos
  assert.equal((await a.put('/api/admin/prestacoes/' + p.id, { ...base, hotel: 150 })).dados.fotos, 2);
  // remover uma
  assert.equal((await a.del(`/api/admin/prestacoes/${p.id}/fotos/0`)).dados.fotos, 1);
  // limite de 10
  for (let i = 0; i < 9; i++) await a.post(`/api/admin/prestacoes/${p.id}/fotos`, { foto: fotoFake() });
  assert.equal((await a.post(`/api/admin/prestacoes/${p.id}/fotos`, { foto: fotoFake() })).status, 400);
  // excluir a prestação
  assert.equal((await a.del('/api/admin/prestacoes/' + p.id)).status, 200);
  assert.equal((await a.get(`/api/admin/prestacoes/${p.id}/fotos/0`)).status, 404);
});

test('prestação: editar mantém nome e função da época; mês fora do período e colaborador desativado são recusados', async () => {
  const a = await adminLogado();
  const { id: colaboradorId } = await novoColaborador(a, 'Vendedor');
  const base = { colaboradorId, dataInicial: '2026-03-02', dataFinal: '2026-03-05', mesRef: '2026-03', hotel: 100 };
  const p = (await a.post('/api/admin/prestacoes', base)).dados;
  // o colaborador muda de nome e de função depois
  await a.put('/api/admin/colaboradores/' + colaboradorId, { nome: 'Nome Novo', usuario: 'nomenovo' + Date.now().toString(36), funcao: 'Promotora' });
  const editada = (await a.put('/api/admin/prestacoes/' + p.id, { ...base, hotel: 120 })).dados;
  assert.equal(editada.hotel, 120);
  assert.equal(editada.funcao, 'Vendedor', 'a função da época continua');
  assert.equal(editada.colaborador, p.colaborador, 'o nome da época continua');
  // mês de referência fora do período
  assert.equal((await a.post('/api/admin/prestacoes', { ...base, mesRef: '2026-11' })).status, 400);
  // colaborador desativado: não aceita prestação nova, mas a antiga continua editável
  await a.put('/api/admin/colaboradores/' + colaboradorId, { ativo: false });
  assert.equal((await a.post('/api/admin/prestacoes', base)).status, 400);
  assert.equal((await a.put('/api/admin/prestacoes/' + p.id, { ...base, hotel: 130 })).status, 200);
});

test('paraNumero: milhar com ponto vindo da planilha formatada', () => {
  assert.equal(paraNumero('1.234'), 1234);
  assert.equal(paraNumero('12.345.678'), 12345678);
  assert.equal(paraNumero('12.5'), 12.5);
});

test('datas que não existem (31/02, 30/04, 29/02 fora de ano bissexto) são recusadas', async () => {
  const a = await adminLogado();
  const { c, id: colaboradorId } = await novoColaborador(a);
  for (const data of ['2026-02-31', '2026-04-31', '2025-02-29']) {
    const r = await c.post('/api/despesas', { data, categoria: 'Hotel', valor: 10 });
    assert.equal(r.status, 400, data);
    assert.match(r.dados.erro, /não existe/);
  }
  const base = { colaboradorId, dataInicial: '2026-02-30', dataFinal: '2026-03-02', mesRef: '2026-02', hotel: 10 };
  assert.equal((await a.post('/api/admin/prestacoes', base)).status, 400);
  // 29/02 em ano bissexto existe
  assert.equal((await a.post('/api/admin/prestacoes', { ...base, dataInicial: '2024-02-29', dataFinal: '2024-03-02', mesRef: '2024-02' })).status, 201);
});

test('log de erro: resumo de um erro do Google não mostra o token de acesso', async () => {
  const { resumoErro, ondeAconteceu } = require('../services/erros');
  const http = require('node:http');
  const { default: ky } = await import('ky');
  // Servidor falso que responde como a API do Google quando falta permissão
  const falso = http.createServer((req, res) => {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 403, message: 'The caller does not have permission' } }));
  });
  await new Promise(ok => falso.listen(0, ok));
  const TOKEN = 'ya29.TOKEN_DE_TESTE_123';
  let err;
  try {
    // Mesmo jeito que a biblioteca da planilha põe o token: cabeçalho Authorization num hook
    await ky.get(`http://127.0.0.1:${falso.address().port}/planilha`, {
      retry: 0,
      hooks: { beforeRequest: [({ request }) => { request.headers.set('Authorization', `Bearer ${TOKEN}`); }] },
    });
  } catch (e) { err = e; } finally { falso.close(); }
  assert.ok(err, 'a requisição deveria falhar');
  assert.ok(require('node:util').inspect(err).includes(TOKEN), 'o objeto inteiro do erro contém o token (motivo do resumo)');
  const linha = resumoErro(err);
  assert.ok(!linha.includes(TOKEN), linha);
  assert.ok(!ondeAconteceu(err).includes(TOKEN));
  assert.match(linha, /403/);
  // Erro comum de código: mostra a mensagem e onde aconteceu
  const comum = new TypeError('x is not a function');
  assert.equal(resumoErro(comum), 'TypeError: x is not a function');
  assert.match(ondeAconteceu(comum), /at /);
});
