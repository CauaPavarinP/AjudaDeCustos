// Testes automáticos do sistema. Rode com: npm test   (no Windows: npm.cmd test)
//
// Sobem o servidor numa porta separada, em memória: as variáveis do Google, do banco, do Cloudinary e de
// produção são zeradas abaixo, então nada é gravado na planilha real, no banco nem no Cloudinary, mesmo que
// exista um arquivo .env com as credenciais.
//
// Para rodar os mesmos testes num banco PostgreSQL DE TESTE (nunca o de produção):
//   TEST_DATABASE_URL=postgresql://... npm test
// Cada servidor de teste usa um schema próprio (teste_a, teste_b), apagado e recriado no começo.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { paraNumero, configBanco, criarStore } = require('../services/store');
const { lerDataUrl, assinar } = require('../services/fotos');

const PORTA = 3900 + Math.floor(Math.random() * 90);
const B = `http://localhost:${PORTA}`;
let servidor;

// Banco de teste opcional: cada servidor recebe um schema limpo
const BANCO_TESTE = process.env.TEST_DATABASE_URL || '';
async function envBanco(schema) {
  if (!BANCO_TESTE) return { DATABASE_URL: '', DATABASE_SCHEMA: '' };
  const { Client } = require('pg');
  const c = new Client({ connectionString: BANCO_TESTE });
  await c.connect();
  try { await c.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await c.end(); }
  return { DATABASE_URL: BANCO_TESTE, DATABASE_SCHEMA: schema };
}

before(async () => {
  const env = {
    ...process.env, PORT: String(PORTA),
    // vazias de propósito: o dotenv não sobrescreve variáveis já definidas
    NODE_ENV: '', SPREADSHEET_ID: '', GOOGLE_SERVICE_ACCOUNT_EMAIL: '', GOOGLE_PRIVATE_KEY: '',
    CLOUDINARY_URL: '', SESSION_SECRET: '', ADMIN_USER: '', ADMIN_PASSWORD: '', ADMIN_NOME: '', DATABASE_SSL_CA: '',
    ...(await envBanco('teste_a')),
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
function cliente(base = B) { // base: outro servidor (usado num teste com configuração própria)
  let cookie = '';
  const chamar = async (metodo, url, corpo) => {
    const r = await fetch(base + url, {
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
test('configuração do banco: recusa o que é perigoso e explica o que está errado', () => {
  const U = 'postgresql://u:p@host:5432/db';
  assert.throws(() => configBanco({ url: U, schema: 'public' }), /DATABASE_SCHEMA/);
  assert.throws(() => configBanco({ url: U, schema: 'pg_algo' }), /DATABASE_SCHEMA/);
  assert.throws(() => configBanco({ url: 'notaurl', schema: 'ajuda' }), /DATABASE_URL inválida/);
  assert.throws(() => configBanco({ url: 'postgresql://u:a#b@host/db', schema: 'ajuda' }), /DATABASE_URL inválida/);
  assert.throws(() => configBanco({ url: U, schema: 'ajuda', producao: true }), /DATABASE_SSL_CA é obrigatório/);
  assert.throws(() => configBanco({ url: U, schema: 'ajuda', ca: '/nao/existe.crt' }), /arquivo do certificado não encontrado/);
  // com certificado: o sslmode do endereço não passa por cima dele, e o texto colado com espaços é arrumado
  const pem = '-----BEGIN CERTIFICATE----- ' + 'QUJD'.repeat(40) + ' -----END CERTIFICATE-----';
  const c = configBanco({ url: U + '?sslmode=no-verify&application_name=x', schema: 'ajuda', ca: pem });
  assert.ok(!/sslmode/.test(c.connectionString) && /application_name=x/.test(c.connectionString));
  assert.match(c.ssl.ca, /^-----BEGIN CERTIFICATE-----\n[A-Za-z0-9+/=\n]+\n-----END CERTIFICATE-----$/);
  assert.equal(c.connectionTimeoutMillis, 10000);
  // nenhuma mensagem mostra a senha
  try { configBanco({ url: 'postgresql://u:segredo#1@host/db', schema: 'ajuda' }); } catch (e) { assert.ok(!e.message.includes('segredo')); }
});
test('várias gravações juntas (planilha/memória): erro no meio desfaz o que já tinha sido gravado', async () => {
  const s = criarStore({}); // memória (a planilha usa o mesmo mecanismo)
  await s.add('Funcoes', { id: 'f1', nome: 'A' });
  await assert.rejects(s.transacao(async tx => {
    await tx.add('Funcoes', { id: 'f2', nome: 'B' });
    await tx.update('Funcoes', 'f1', { nome: 'Z' });
    await tx.remove('Funcoes', 'f1');
    throw new Error('falha simulada');
  }), /falha simulada/);
  assert.deepEqual((await s.list('Funcoes')).map(f => [f.id, f.nome]), [['f1', 'A']]);
  // campo que a linha ainda não tinha (ex.: periodoId de despesa nova) também é desfeito
  await s.add('Despesas', { id: 'd1', status: 'Em análise' });
  await assert.rejects(s.transacao(async tx => {
    await tx.update('Despesas', 'd1', { periodoId: 'p1' });
    throw new Error('falha simulada');
  }), /falha simulada/);
  assert.equal((await s.list('Despesas')).find(d => d.id === 'd1').periodoId || '', '');
});
test('texto com caractere invisível (NUL) é limpo, e não vira erro 500', async () => {
  const a = await adminLogado();
  const r = await a.post('/api/admin/colaboradores', { nome: 'Nulo\u0000Teste', usuario: 'nulo' + Date.now().toString(36), funcao: 'Vendedor' });
  assert.equal(r.status, 201);
  assert.equal(r.dados.nome, 'NuloTeste');
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
  assert.equal(r.dados.armazenamento, BANCO_TESTE ? 'banco' : 'memoria');
  assert.ok(r.headers.get('x-versao'));
  // ?banco=1: lê os dados de verdade (usado pelo GitHub Actions para manter o banco do Supabase ativo)
  const b = await cliente().get('/health?banco=1');
  assert.equal(b.status, 200);
  assert.equal(b.dados.banco, 'ok');
});

test('administradores: só o principal cadastra; cada um entra com a própria senha e assina o que faz', async () => {
  const p = await adminLogado();
  assert.equal((await p.get('/api/admin/me')).dados.principal, true);
  // usuário do principal e usuário repetido são recusados
  assert.equal((await p.post('/api/admin/administradores', { nome: 'Outro', usuario: 'admin' })).status, 400);
  const novo = await p.post('/api/admin/administradores', { nome: 'Ana Souza', usuario: 'ana.souza' });
  assert.equal(novo.status, 201);
  assert.ok(novo.dados.senhaTemporaria.length >= 8);
  assert.equal(novo.dados.senhaHash, undefined);
  assert.equal((await p.post('/api/admin/administradores', { nome: 'Ana 2', usuario: 'ana.souza' })).status, 400);
  // dois cadastros juntos com o mesmo usuário: só um entra
  const juntos = await Promise.all([1, 2].map(() => p.post('/api/admin/administradores', { nome: 'Bia', usuario: 'bia.lima' })));
  assert.deepEqual(juntos.map(r => r.status).sort(), [201, 400]);

  // a Ana entra, vê o painel, mas não mexe em administradores
  const ana = cliente();
  assert.equal((await ana.post('/api/admin/login', { usuario: 'ana.souza', senha: 'errada' })).status, 401);
  assert.equal((await ana.post('/api/admin/login', { usuario: 'ana.souza', senha: novo.dados.senhaTemporaria })).status, 200);
  const me = (await ana.get('/api/admin/me')).dados;
  assert.equal(me.nome, 'Ana Souza'); assert.equal(me.principal, false);
  assert.equal((await ana.get('/api/admin/dados')).status, 200);
  assert.equal((await ana.get('/api/admin/administradores')).status, 403);
  assert.equal((await ana.post('/api/admin/administradores', { nome: 'X', usuario: 'xyz' })).status, 403);
  // o que a Ana aprova fica com o nome dela
  const { c } = await novoColaborador(p);
  const d = (await c.post('/api/despesas', { data: ontem(), categoria: 'Hotel', valor: 10 })).dados;
  assert.equal((await ana.post(`/api/admin/despesas/${d.id}/aprovar`)).dados.avaliadoPor, 'Ana Souza');

  // troca a própria senha (mínimo 8); continua logada neste navegador
  assert.equal((await ana.post('/api/admin/me/senha', { atual: novo.dados.senhaTemporaria, nova: 'curta' })).status, 400);
  assert.equal((await ana.post('/api/admin/me/senha', { atual: novo.dados.senhaTemporaria, nova: 'senha-nova-123' })).status, 200);
  assert.equal((await ana.get('/api/admin/me')).status, 200);
  assert.equal((await p.post('/api/admin/me/senha', { atual: 'admin', nova: 'qualquer-coisa' })).status, 400); // principal troca no Render

  // nova senha pelo principal derruba a sessão da Ana; desativar impede o login
  assert.equal((await p.put(`/api/admin/administradores/${novo.dados.id}`, { novaSenha: true })).status, 200);
  assert.equal((await ana.get('/api/admin/me')).status, 401);
  assert.equal((await p.put(`/api/admin/administradores/${novo.dados.id}`, { ativo: false })).status, 200);
  assert.equal((await ana.post('/api/admin/login', { usuario: 'ana.souza', senha: 'senha-nova-123' })).status, 401);
  // excluir
  assert.equal((await p.del(`/api/admin/administradores/${novo.dados.id}`)).status, 200);
  assert.equal((await p.get('/api/admin/administradores')).dados.some(a => a.id === novo.dados.id), false);
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

test('colaborador: telefone, cidade e UF (opcionais) são guardados; UF fora da lista é recusada', async () => {
  const a = await adminLogado();
  const usuario = 'contato' + Date.now().toString(36);
  const r = await a.post('/api/admin/colaboradores', { nome: 'Com Contato', usuario, funcao: 'Vendedor', telefone: ' (47) 99725-0379 ', cidade: 'Porto Alegre', uf: 'rs' });
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  assert.deepEqual([r.dados.telefone, r.dados.cidade, r.dados.uf], ['(47) 99725-0379', 'Porto Alegre', 'RS']);
  const lista = (await a.get('/api/admin/dados')).dados.colaboradores.find(c => c.id === r.dados.id);
  assert.equal(lista.cidade, 'Porto Alegre');
  assert.equal((await a.post('/api/admin/colaboradores', { nome: 'UF Errada', usuario: usuario + 'x', funcao: 'Vendedor', uf: 'XX' })).status, 400);
  const sem = await a.post('/api/admin/colaboradores', { nome: 'Sem Contato', usuario: usuario + 'y', funcao: 'Vendedor' });
  assert.deepEqual([sem.dados.telefone, sem.dados.cidade, sem.dados.uf], ['', '', '']);
});

test('colaborador: dados bancários (opcionais) vão para o painel, não para o app; CPF inválido é recusado', async () => {
  const a = await adminLogado();
  const usuario = 'banco' + Date.now().toString(36);
  const r = await a.post('/api/admin/colaboradores', { nome: 'Com Banco', usuario, funcao: 'Vendedor', banco: 'Banco Teste', agencia: '0001', conta: '1234-5', cpf: '12345678909', pix: 'chave-teste' });
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  assert.deepEqual([r.dados.banco, r.dados.agencia, r.dados.conta, r.dados.cpf, r.dados.pix], ['Banco Teste', '0001', '1234-5', '123.456.789-09', 'chave-teste']);
  const noPainel = (await a.get('/api/admin/dados')).dados.colaboradores.find(c => c.id === r.dados.id);
  assert.equal(noPainel.cpf, '123.456.789-09');
  const c = cliente();
  assert.equal((await c.post('/api/login', { usuario, senha: r.dados.senhaTemporaria })).status, 200);
  const me = (await c.get('/api/me')).dados;
  assert.ok(!('cpf' in me) && !('conta' in me) && !('pix' in me), JSON.stringify(me));
  assert.equal((await a.post('/api/admin/colaboradores', { nome: 'CPF Errado', usuario: usuario + 'x', funcao: 'Vendedor', cpf: '123.456.789-00' })).status, 400);
});

test('colaborador: editar sem mandar os dados bancários não apaga os que já existem', async () => {
  const a = await adminLogado();
  const usuario = 'mantem' + Date.now().toString(36);
  const r = await a.post('/api/admin/colaboradores', { nome: 'Mantém Banco', usuario, funcao: 'Vendedor', banco: 'Banco Teste', pix: 'chave-teste', cidade: 'Lins' });
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  const e = await a.put('/api/admin/colaboradores/' + r.dados.id, { nome: 'Mantém Banco 2', usuario, funcao: 'Vendedor' });
  assert.equal(e.status, 200, JSON.stringify(e.dados));
  const col = (await a.get('/api/admin/dados')).dados.colaboradores.find(c => c.id === r.dados.id);
  assert.deepEqual([col.nome, col.banco, col.pix, col.cidade], ['Mantém Banco 2', 'Banco Teste', 'chave-teste', 'Lins']);
  // mandando o campo vazio, apaga (é assim que o painel limpa um campo)
  await a.put('/api/admin/colaboradores/' + r.dados.id, { nome: 'Mantém Banco 2', usuario, funcao: 'Vendedor', pix: '' });
  assert.equal((await a.get('/api/admin/dados')).dados.colaboradores.find(c => c.id === r.dados.id).pix, '');
});

test('período: o colaborador fecha, a despesa enviada trava, só paga depois de analisar, reabrir e desfazer', async () => {
  const a = await adminLogado();
  const { c, id } = await novoColaborador(a);
  const nova = async (data, valor) => (await c.post('/api/despesas', { data, categoria: 'Hotel', valor })).dados;
  assert.equal((await c.post('/api/periodos/fechar')).status, 400); // nada para enviar
  const d1 = await nova('2026-10-18', 100);
  const d2 = await nova('2026-10-27', 50);
  const d3 = await nova('2026-10-20', 9);
  await a.post(`/api/admin/despesas/${d3.id}/recusar`); // recusada não entra
  assert.equal((await c.get('/api/despesas')).dados.find(x => x.id === d1.id).periodo, null); // ainda não enviada
  const f = await c.post('/api/periodos/fechar');
  assert.equal(f.status, 201, JSON.stringify(f.dados));
  assert.equal(f.dados.notas, 2);
  assert.deepEqual([f.dados.periodo.dataInicial, f.dados.periodo.dataFinal, f.dados.periodo.status], ['2026-10-18', '2026-10-27', 'Enviado']);
  const pid = f.dados.periodo.id;
  assert.equal((await c.post('/api/periodos/fechar')).status, 400); // nada novo para enviar
  // enviada: o colaborador não exclui nem troca a foto
  assert.equal((await c.del(`/api/despesas/${d1.id}`)).status, 400);
  assert.equal((await c.get('/api/despesas')).dados.find(x => x.id === d1.id).periodo.status, 'Enviado');
  // pagar: só depois de analisar todas
  const pagar = () => a.post(`/api/admin/periodos/${pid}/pagar`);
  assert.equal((await pagar()).status, 400);
  await a.post(`/api/admin/despesas/${d1.id}/aprovar`);
  await a.post(`/api/admin/despesas/${d2.id}/recusar`);
  const pg = await pagar();
  assert.equal(pg.status, 200, JSON.stringify(pg.dados));
  assert.equal(pg.dados.periodo.valorPago, 100); // só a aprovada
  assert.equal((await pagar()).status, 409); // já pago
  assert.equal((await a.post(`/api/admin/despesas/${d1.id}/reabrir`)).status, 400); // período pago: não muda
  assert.equal((await a.post(`/api/admin/periodos/${pid}/reabrir`)).status, 409); // pago não reabre
  assert.equal((await c.get('/api/despesas')).dados.find(x => x.id === d1.id).periodo.status, 'Pago');
  // despesa lançada depois entra no próximo período
  const d4 = await nova('2026-10-28', 7);
  const f2 = await c.post('/api/periodos/fechar');
  assert.equal(f2.dados.notas, 1);
  // desfazer o pagamento: volta a Enviado; reabrir: as despesas voltam a "não enviadas"
  assert.equal((await a.post(`/api/admin/periodos/${pid}/desfazer-pagamento`)).status, 200);
  assert.equal((await a.get('/api/admin/dados')).dados.periodos.find(p => p.id === pid).status, 'Enviado');
  assert.equal((await a.post(`/api/admin/periodos/${pid}/reabrir`)).status, 200);
  const dados = (await a.get('/api/admin/dados')).dados;
  assert.ok(!dados.periodos.some(p => p.id === pid));
  assert.ok(!dados.despesas.find(x => x.id === d1.id).periodoId);
  // o Maurício fecha pelo colaborador
  const f3 = await a.post('/api/admin/periodos/fechar', { colaboradorId: id });
  assert.equal(f3.status, 201);
  assert.equal(f3.dados.periodo.fechadoPor, 'Maurício');
  assert.equal((await a.get('/api/admin/dados')).dados.despesas.find(x => x.id === d4.id).periodoId, f2.dados.periodo.id); // a d4 continua no período dela
});

test('período: fechar e aprovar ao mesmo tempo, e fechar duas vezes, não se cruzam', async () => {
  const a = await adminLogado();
  const { c } = await novoColaborador(a);
  const x = (await c.post('/api/despesas', { data: '2026-10-13', categoria: 'Hotel', valor: 10 })).dados;
  await c.post('/api/despesas', { data: '2026-10-14', categoria: 'Hotel', valor: 7 });
  const [ap, f1, f2] = await Promise.all([a.post(`/api/admin/despesas/${x.id}/aprovar`), c.post('/api/periodos/fechar'), c.post('/api/periodos/fechar')]);
  assert.deepEqual([f1.status, f2.status].sort(), [201, 400]); // um período só
  assert.ok([200, 409].includes(ap.status));
  const dados = (await a.get('/api/admin/dados')).dados;
  const per = dados.periodos.filter(p => p.colaboradorId === x.colaboradorId);
  assert.equal(per.length, 1);
  assert.equal(dados.despesas.filter(d => d.periodoId === per[0].id).length, 2);
});

// Servidor separado com o início do controle de pagamentos no futuro: tudo o que for lançado conta como "antigo"
test('período: despesas aprovadas antes do controle não entram sozinhas; o Maurício decide', async () => {
  const porta = PORTA + 100, b2 = `http://localhost:${porta}`;
  const env = { ...process.env, PORT: String(porta), NODE_ENV: '', SPREADSHEET_ID: '', GOOGLE_SERVICE_ACCOUNT_EMAIL: '', GOOGLE_PRIVATE_KEY: '',
    CLOUDINARY_URL: '', SESSION_SECRET: '', ADMIN_USER: '', ADMIN_PASSWORD: '', ADMIN_NOME: '', INICIO_PERIODOS: '2999-01-01T00:00:00.000Z',
    DATABASE_SSL_CA: '', ...(await envBanco('teste_b')) };
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((ok, falha) => { const t = setTimeout(() => falha(new Error('não subiu')), 10000); srv.stdout.on('data', x => { if (String(x).includes('rodando')) { clearTimeout(t); ok(); } }); });
    const a = cliente(b2), c = cliente(b2);
    await a.post('/api/admin/login', { usuario: 'admin', senha: 'admin' });
    const col = (await a.post('/api/admin/colaboradores', { nome: 'Antigo Teste', usuario: 'antigo.teste', funcao: 'Vendedor' })).dados;
    await c.post('/api/login', { usuario: 'antigo.teste', senha: col.senhaTemporaria });
    const d1 = (await c.post('/api/despesas', { data: '2026-10-06', categoria: 'Hotel', valor: 40 })).dados;
    await a.post(`/api/admin/despesas/${d1.id}/aprovar`);
    assert.equal((await c.get('/api/despesas')).dados.find(x => x.id === d1.id).periodo.status, 'Anterior');
    assert.equal((await c.post('/api/periodos/fechar')).status, 400); // antiga não entra sozinha no período
    const pagas = await a.post('/api/admin/periodos/antigas', { colaboradorId: col.id, jaPagas: true });
    assert.equal(pagas.status, 201, JSON.stringify(pagas.dados));
    assert.equal(pagas.dados.pagamento.valorPago, 40);
    // desfazer o "pago antes do sistema" devolve para as antigas; "Incluir para pagar" vira um período Enviado
    assert.equal((await a.post(`/api/admin/periodos/${pagas.dados.pagamento.id}/desfazer-pagamento`)).status, 200);
    const inc = await a.post('/api/admin/periodos/antigas', { colaboradorId: col.id });
    assert.equal(inc.status, 201, JSON.stringify(inc.dados));
    assert.equal(inc.dados.periodo.status, 'Enviado');
    const pg = await a.post(`/api/admin/periodos/${inc.dados.periodo.id}/pagar`);
    assert.equal(pg.status, 200, JSON.stringify(pg.dados));
    assert.equal(pg.dados.periodo.valorPago, 40);
    // reabrir: as antigas voltam como "não enviadas" (liberadas), sem cair na caixa das antigas de novo
    await a.post(`/api/admin/periodos/${inc.dados.periodo.id}/desfazer-pagamento`);
    assert.equal((await a.post(`/api/admin/periodos/${inc.dados.periodo.id}/reabrir`)).status, 200);
    assert.equal((await c.get('/api/despesas')).dados.find(x => x.id === d1.id).periodo, null);
    assert.equal((await c.post('/api/periodos/fechar')).status, 201);
  } finally { srv.kill(); }
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
  // data com texto sobrando depois não é cortada e aceita
  assert.equal((await c.post('/api/despesas', { data: ontem() + 'xyz', categoria: 'Hotel', valor: 10 })).status, 400);
  // valor só como número: texto como "0.500" não vira R$ 500
  assert.equal((await c.post('/api/despesas', { data: ontem(), categoria: 'Hotel', valor: '0.500' })).status, 400);
  assert.equal((await c.post('/api/despesas', { data: ontem(), categoria: 'Hotel', valor: '10' })).status, 400);
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

test('marca de mudanças: só muda quando algo é gravado; exige login', async () => {
  assert.equal((await cliente().get('/api/mudancas')).status, 401);
  assert.equal((await cliente().get('/api/admin/mudancas')).status, 401);
  const a = await adminLogado();
  const { c } = await novoColaborador(a);
  const m1 = (await c.get('/api/mudancas')).dados.v, m1a = (await a.get('/api/admin/mudancas')).dados.v;
  assert.ok(m1 && m1 === m1a, 'app e painel recebem a mesma marca');
  await c.get('/api/despesas'); // só leitura: não muda
  assert.equal((await c.get('/api/mudancas')).dados.v, m1);
  const d = (await c.post('/api/despesas', { data: ontem(), categoria: 'Hotel', valor: 10 })).dados;
  const m2 = (await a.get('/api/admin/mudancas')).dados.v;
  assert.notEqual(m2, m1, 'lançar despesa muda a marca');
  await a.post(`/api/admin/despesas/${d.id}/aprovar`);
  assert.notEqual((await c.get('/api/mudancas')).dados.v, m2, 'aprovar muda a marca');
});

test('prestação lançada junto com a exclusão do colaborador não fica sem colaborador', async () => {
  const a = await adminLogado();
  for (let i = 0; i < 15; i++) {
    const usuario = 'corrida' + i + Date.now().toString(36);
    const id = (await a.post('/api/admin/colaboradores', { nome: 'Corrida ' + i, usuario, funcao: 'Vendedor' })).dados.id;
    const mes = ontem().slice(0, 7);
    await Promise.all([
      a.post('/api/admin/prestacoes', { colaboradorId: id, dataInicial: ontem(), dataFinal: ontem(), mesRef: mes, hotel: 10 }),
      a.del('/api/admin/colaboradores/' + id),
    ]);
  }
  const d = (await a.get('/api/admin/dados')).dados;
  const ids = new Set(d.colaboradores.map(c => c.id));
  assert.equal(d.prestacoes.filter(p => !ids.has(p.colaboradorId)).length, 0);
});

test('reativar alguém não traz de volta o login antigo; admin desativado recebe o motivo', async () => {
  const a = await adminLogado();
  const { c, id, usuario } = await novoColaborador(a);
  const col = (await a.get('/api/admin/dados')).dados.colaboradores.find(x => x.id === id);
  await a.put('/api/admin/colaboradores/' + id, { ativo: false });
  await a.put('/api/admin/colaboradores/' + id, { ativo: true });
  assert.equal((await c.get('/api/me')).status, 401, 'cookie de antes da desativação não vale mais');
  assert.equal(col.usuario, usuario);
  // administrador
  const novo = (await a.post('/api/admin/administradores', { nome: 'Desativa Teste', usuario: 'desat' + Date.now().toString(36) })).dados;
  const b = cliente();
  assert.equal((await b.post('/api/admin/login', { usuario: novo.usuario, senha: novo.senhaTemporaria })).status, 200);
  await a.put('/api/admin/administradores/' + novo.id, { ativo: false });
  const r = await b.get('/api/admin/dados');
  assert.equal(r.status, 401);
  assert.match(r.dados.erro, /desativado/);
  // tentar entrar de novo com a senha certa explica; com a senha errada, não revela nada
  const b2 = cliente();
  const certa = await b2.post('/api/admin/login', { usuario: novo.usuario, senha: novo.senhaTemporaria });
  assert.equal(certa.status, 403); assert.match(certa.dados.erro, /desativado/);
  assert.match((await b2.post('/api/admin/login', { usuario: novo.usuario, senha: 'errada123' })).dados.erro, /incorretos/);
  await a.put('/api/admin/administradores/' + novo.id, { ativo: true });
  assert.equal((await b.get('/api/admin/dados')).status, 401, 'reativado precisa entrar de novo');
});

test('login do painel: erros de um usuário não bloqueiam os outros administradores', async () => {
  const c = cliente();
  for (let i = 0; i < 6; i++) await c.post('/api/admin/login', { usuario: 'fulano.inexistente', senha: 'x' });
  assert.equal((await c.post('/api/admin/login', { usuario: 'fulano.inexistente', senha: 'x' })).status, 429);
  assert.equal((await c.post('/api/admin/login', { usuario: 'admin', senha: 'admin' })).status, 200);
});

test('nome de administrador não pode imitar a marca de "pago antes do sistema"', async () => {
  const a = await adminLogado();
  const r = await a.post('/api/admin/administradores', { nome: 'Ana (pago antes do sistema)', usuario: 'imita' + Date.now().toString(36) });
  assert.equal(r.status, 400);
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

test('aprovação: decisão já tomada em outra aba não é trocada sem aviso (409)', async () => {
  const a = await adminLogado();
  const { c } = await novoColaborador(a);
  const d = (await c.post('/api/despesas', { data: ontem(), categoria: 'Hotel', valor: 10 })).dados;
  assert.equal((await a.post(`/api/admin/despesas/${d.id}/reabrir`)).status, 409); // já está em análise
  assert.equal((await a.post(`/api/admin/despesas/${d.id}/aprovar`)).status, 200);
  const r = await a.post(`/api/admin/despesas/${d.id}/recusar`); // aba antiga ainda mostrava "Em análise"
  assert.equal(r.status, 409);
  assert.match(r.dados.erro, /outra tela/);
  assert.equal((await a.get('/api/admin/dados')).dados.despesas.find(x => x.id === d.id).status, 'Aprovada');
  assert.equal((await a.post(`/api/admin/despesas/${d.id}/reabrir`)).status, 200);
  assert.equal((await a.post(`/api/admin/despesas/${d.id}/recusar`)).status, 200);
});

test('login: trocar de IP a cada tentativa não escapa do bloqueio da conta', async () => {
  const a = await adminLogado();
  const { usuario, senha } = await novoColaborador(a);
  const tentar = (ip, s) => fetch(B + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ usuario, senha: s }),
  }).then(r => r.status);
  // 4 erros por IP (abaixo do limite de 5 por aparelho), em IPs diferentes
  const status = [];
  for (let i = 0; i < 24; i++) status.push(await tentar(`10.9.${Math.floor(i / 4)}.1`, 'errada'));
  assert.ok(status.slice(0, 20).every(s => s === 401), status.join(','));
  assert.ok(status.slice(20).every(s => s === 429), status.join(','));
  // Bloqueada a conta, nem a senha certa entra por um IP novo
  assert.equal(await tentar('10.9.99.1', senha), 429);
});

test('foto trocada muda a versão (fotoV) para o painel não mostrar a antiga do cache', async () => {
  const a = await adminLogado();
  const { c } = await novoColaborador(a);
  const d = (await c.post('/api/despesas', { data: ontem(), categoria: 'Hotel', valor: 10, foto: fotoFake() })).dados;
  assert.match(d.fotoV, /^[0-9a-f]{10}$/);
  const outra = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 9)]).toString('base64');
  assert.equal((await c.put(`/api/despesas/${d.id}/foto`, { foto: outra })).status, 200);
  const noPainel = (await a.get('/api/admin/dados')).dados.despesas.find(x => x.id === d.id);
  assert.ok(noPainel.fotoV && noPainel.fotoV !== d.fotoV, 'a versão deveria mudar');
  assert.ok(!JSON.stringify(noPainel).includes('ajuda-de-custo/'), 'a referência da foto não sai do servidor');
  const img = await a.get(`/api/admin/despesas/${d.id}/foto?v=${noPainel.fotoV}`);
  assert.equal(img.status, 200);
  assert.equal(img.dados[img.dados.length - 1], 9); // é a foto nova
});

test('comprovante: remover pela versão; aba desatualizada não apaga a foto errada (409)', async () => {
  const a = await adminLogado();
  const { id: colaboradorId } = await novoColaborador(a);
  const p = (await a.post('/api/admin/prestacoes', { colaboradorId, dataInicial: ontem(), dataFinal: ontem(), mesRef: ontem().slice(0, 7), hotel: 10 })).dados;
  const foto = n => 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, n)]).toString('base64');
  let r;
  for (const n of [1, 2, 3]) r = await a.post(`/api/admin/prestacoes/${p.id}/fotos`, { foto: foto(n) });
  const [vVerm, vAzul, vVerde] = r.dados.fotosV;
  assert.equal(r.dados.fotosV.length, 3);
  // aba B remove a 1ª (vermelha)
  r = await a.del(`/api/admin/prestacoes/${p.id}/fotos/0?v=${vVerm}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.dados.fotosV, [vAzul, vVerde]);
  // aba A (desatualizada) tenta remover a azul pela posição antiga 1: remove a azul, não a verde
  r = await a.del(`/api/admin/prestacoes/${p.id}/fotos/1?v=${vAzul}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.dados.fotosV, [vVerde]);
  // tentar remover de novo a vermelha (já removida) → conflito
  assert.equal((await a.del(`/api/admin/prestacoes/${p.id}/fotos/0?v=${vVerm}`)).status, 409);
  // abrir pela versão entrega a foto certa
  const img = await a.get(`/api/admin/prestacoes/${p.id}/fotos/0?v=${vVerde}`);
  assert.equal(img.status, 200);
  assert.equal(img.dados[img.dados.length - 1], 3);
});
