// Armazenamento dos dados. Escolhido pelas variáveis de ambiente, nesta ordem:
// - DATABASE_URL: banco PostgreSQL (ex.: Supabase), uma tabela por "aba", criadas automaticamente;
// - SPREADSHEET_ID + credenciais do Google: Google Sheets (uma aba por tabela, criada automaticamente);
// - nenhum dos dois (desenvolvimento): memória (os dados somem ao reiniciar).

const crypto = require('crypto');

// Cada tabela: [chave no código, título da coluna na planilha]
const TABELAS = {
  Colaboradores: {
    cols: [['id', 'ID'], ['nome', 'Nome'], ['usuario', 'Usuario'], ['funcao', 'Funcao'], ['ativo', 'Ativo'], ['senhaHash', 'SenhaHash'], ['criadoEm', 'CriadoEm'],
      ['telefone', 'Telefone'], ['cidade', 'Cidade'], ['uf', 'UF'],
      ['banco', 'Banco'], ['agencia', 'Agencia'], ['conta', 'Conta'], ['cpf', 'CPF'], ['pix', 'PIX'], ['desativadoEm', 'DesativadoEm']],
    bool: ['ativo'],
  },
  // Administradores do painel além do principal (que vem de ADMIN_USER/ADMIN_PASSWORD no ambiente)
  Administradores: {
    cols: [['id', 'ID'], ['nome', 'Nome'], ['usuario', 'Usuario'], ['ativo', 'Ativo'], ['senhaHash', 'SenhaHash'], ['criadoEm', 'CriadoEm'], ['criadoPor', 'CriadoPor'], ['desativadoEm', 'DesativadoEm']],
    bool: ['ativo'],
  },
  Funcoes: {
    cols: [['id', 'ID'], ['nome', 'Nome'], ['criadoEm', 'CriadoEm']],
  },
  Prestacoes: {
    cols: [['id', 'ID'], ['colaboradorId', 'ColaboradorID'], ['colaborador', 'Colaborador'], ['funcao', 'Funcao'],
      ['dataInicial', 'DataInicial'], ['dataFinal', 'DataFinal'], ['mesRef', 'MesReferencia'],
      ['combustivel', 'Combustivel'], ['alimentacao', 'Alimentacao'], ['degustacao', 'Degustacao'], ['hotel', 'Hotel'],
      ['transporte', 'Transporte'], ['outros', 'Outros'], ['total', 'Total'], ['observacao', 'Observacao'], ['criadoEm', 'CriadoEm'], ['fotos', 'Fotos']],
    num: ['combustivel', 'alimentacao', 'degustacao', 'hotel', 'transporte', 'outros', 'total'],
  },
  Despesas: {
    cols: [['id', 'ID'], ['colaboradorId', 'ColaboradorID'], ['colaborador', 'Colaborador'], ['funcao', 'Funcao'],
      ['data', 'Data'], ['categoria', 'Categoria'], ['valor', 'Valor'], ['observacao', 'Observacao'], ['status', 'Status'],
      ['criadoEm', 'EnviadaEm'], ['avaliadoEm', 'AvaliadaEm'], ['avaliadoPor', 'AvaliadaPor'], ['foto', 'Foto'],
      ['periodoId', 'PeriodoID']],
    num: ['valor'],
  },
  // Período de pagamento: um grupo de despesas do celular "fechado" pelo colaborador (ou pelo Maurício) e depois pago
  Periodos: {
    cols: [['id', 'ID'], ['colaboradorId', 'ColaboradorID'], ['colaborador', 'Colaborador'], ['dataInicial', 'DataInicial'], ['dataFinal', 'DataFinal'],
      ['status', 'Status'], ['fechadoEm', 'FechadoEm'], ['fechadoPor', 'FechadoPor'], ['pagoEm', 'PagoEm'], ['pagoPor', 'PagoPor'], ['valorPago', 'ValorPago']],
    num: ['valorPago'],
  },
  // Configurações gravadas pelo próprio sistema (ex.: inicioPeriodos = quando o controle de pagamentos começou)
  Config: {
    cols: [['id', 'ID'], ['valor', 'Valor']],
  },
};

const novoId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);

// Aceita "186.4", "186,40", "1.234,50", "1,234.50" (o formato na planilha pode variar com a localidade).
// Quando há ponto e vírgula, o último dos dois é o separador decimal.
function paraNumero(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim().replace(/[R$\s]/g, '');
  if (!s) return 0;
  // "1.234" ou "1.234.567": ponto como separador de milhar (os valores têm no máximo 2 casas decimais)
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
  if (dec === ',') s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function deLinha(tabela, o) {
  const t = TABELAS[tabela], r = {};
  for (const [k, h] of t.cols) {
    let v = o[h];
    if (t.num && t.num.includes(k)) v = Math.round(paraNumero(v) * 100) / 100;
    else if (t.bool && t.bool.includes(k)) v = !/^(NAO|NÃO|N|FALSE|FALSO|0)$/i.test(String(v ?? '').trim()); // aceita também o que for digitado à mão
    else v = String(v ?? '');
    r[k] = v;
  }
  return r;
}
function paraLinha(tabela, obj) {
  const t = TABELAS[tabela], r = {};
  for (const [k, h] of t.cols) {
    if (!(k in obj)) continue;
    let v = obj[k];
    if (t.bool && t.bool.includes(k)) v = v ? 'SIM' : 'NAO';
    r[h] = v ?? '';
  }
  return r;
}

// ---------------- Memória (só desenvolvimento) ----------------
function criarStoreMemoria() {
  const dados = Object.fromEntries(Object.keys(TABELAS).map(t => [t, []]));
  const copia = o => JSON.parse(JSON.stringify(o));
  const loja = {
    modo: 'memoria',
    async init() {},
    async list(t) { return copia(dados[t]); },
    async add(t, obj) { dados[t].push(copia(obj)); return copia(obj); },
    // se(atual) opcional: só grava se a condição for verdadeira; senão devolve false (conflito)
    async update(t, id, campos, se) {
      const o = dados[t].find(x => x.id === id);
      if (!o) return null;
      if (se && !se(copia(o))) return false;
      Object.assign(o, copia(campos));
      return copia(o);
    },
    // se(atual) opcional: só apaga se a condição for verdadeira (senão devolve 'conflito')
    async remove(t, id, se) {
      const i = dados[t].findIndex(x => x.id === id);
      if (i < 0) return false;
      if (se && !se(copia(dados[t][i]))) return 'conflito';
      return copia(dados[t].splice(i, 1)[0]); // devolve a linha apagada (como estava na hora)
    },
  };
  loja.transacao = comDesfazer(loja);
  return loja;
}

// ---------------- Google Sheets ----------------
function criarStoreSheets({ spreadsheetId, email, privateKey, somenteLeitura = false }) {
  const { GoogleSpreadsheet } = require('google-spreadsheet');
  const { JWT } = require('google-auth-library');
  const auth = new JWT({ email, key: privateKey, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const doc = new GoogleSpreadsheet(spreadsheetId, auth);

  // Cache curto para não estourar a cota de leitura da API do Google.
  // versao[t] muda a cada gravação: uma leitura que começou antes de uma gravação não entra no cache
  // (senão o dado velho ficaria guardado por mais 5 s).
  const CACHE_MS = 5000;
  const cache = {}, versao = {};
  const limpar = t => { delete cache[t]; versao[t] = (versao[t] || 0) + 1; };

  async function prepararAba(titulo) {
    const colunas = TABELAS[titulo].cols.map(c => c[1]);
    let sheet = doc.sheetsByTitle[titulo];
    if (!sheet) return doc.addSheet({ title: titulo, headerValues: colunas });
    try { await sheet.loadHeaderRow(); } catch { await sheet.setHeaderRow(colunas); return sheet; }
    const faltando = colunas.filter(c => !sheet.headerValues.includes(c));
    if (faltando.length) {
      // Coluna nova numa aba que já existe: entra no fim (aumenta a aba antes, se faltar espaço)
      const total = sheet.headerValues.length + faltando.length;
      if (total > sheet.columnCount) await sheet.resize({ rowCount: sheet.rowCount, columnCount: total });
      await sheet.setHeaderRow([...sheet.headerValues, ...faltando]);
    }
    return sheet;
  }
  async function linhas(t) {
    const c = cache[t];
    if (c && Date.now() - c.t < CACHE_MS) return c.rows;
    const v = versao[t] || 0;
    const aba = doc.sheetsByTitle[t];
    if (!aba) return []; // só no modo somente leitura (senão o init já criou a aba)
    const rows = await aba.getRows();
    if ((versao[t] || 0) === v) cache[t] = { t: Date.now(), rows };
    return rows;
  }
  const acharLinha = async (t, id) => { limpar(t); return (await linhas(t)).find(r => String(r.get('ID')) === id); };
  // A biblioteca grava e apaga pelo NÚMERO da linha. Se duas operações na mesma aba rodassem juntas,
  // uma exclusão poderia "empurrar" as linhas e a outra gravaria na linha errada. Por isso as gravações
  // de cada aba entram numa fila e rodam uma de cada vez (leituras continuam livres).
  const filas = {};
  const naFila = (t, tarefa) => {
    const vez = (filas[t] || Promise.resolve()).then(tarefa, tarefa);
    filas[t] = vez.catch(() => {});
    return vez;
  };

  const loja = {
    modo: 'sheets',
    async init() {
      await doc.loadInfo();
      if (somenteLeitura) return;
      for (const t of Object.keys(TABELAS)) await prepararAba(t);
    },
    // { fresco: true }: ignora o cache (para decisões que não podem usar dado de até 5 s atrás)
    async list(t, { fresco } = {}) {
      if (fresco) limpar(t);
      return (await linhas(t)).map(r => deLinha(t, r.toObject())).filter(o => o.id);
    },
    // Linhas preenchidas mas sem ID (o sistema ignora). Usado pela migração para não perder nada sem avisar.
    async semId(t) {
      const vazio = v => v === '' || v === false || v === 0;
      return (await linhas(t)).map(r => deLinha(t, r.toObject())).filter(o => !o.id && !Object.values(o).every(vazio)).length;
    },
    add: (t, obj) => naFila(t, async () => {
      // raw: true evita que textos digitados virem fórmulas na planilha
      await doc.sheetsByTitle[t].addRow(paraLinha(t, obj), { raw: true });
      limpar(t);
      return obj;
    }),
    update: (t, id, campos, se) => naFila(t, async () => {
      const row = await acharLinha(t, id);
      if (!row) return null;
      const antes = deLinha(t, row.toObject());
      if (se && !se(antes)) return false;
      const atual = { ...antes, ...campos };
      row.assign(paraLinha(t, atual));
      await row.save({ raw: true });
      limpar(t);
      return atual;
    }),
    remove: (t, id, se) => naFila(t, async () => {
      const row = await acharLinha(t, id);
      if (!row) return false;
      const apagada = deLinha(t, row.toObject());
      if (se && !se(apagada)) return 'conflito';
      await row.delete();
      limpar(t);
      return apagada; // devolve a linha apagada (como estava na hora)
    }),
  };
  loja.transacao = comDesfazer(loja);
  return loja;
}

// ---------------- várias gravações como uma só (planilha e memória) ----------------
// Banco de verdade tem transação (tudo ou nada). Para a planilha e a memória, guarda como desfazer cada
// gravação e, se der erro no meio, desfaz na ordem inversa (melhor esforço), para não sobrar meio pagamento.
function comDesfazer(base) {
  return async fn => {
    const desfazer = [];
    const tx = {
      list: (t, o) => base.list(t, { ...o, fresco: true }),
      async add(t, obj) { const r = await base.add(t, obj); desfazer.push(() => base.remove(t, obj.id)); return r; },
      async update(t, id, campos, se) {
        let antes = null;
        const r = await base.update(t, id, campos, a => { antes = a; return !se || se(a); });
        if (r && antes) {
          // campo que ainda não existia na linha volta vazio (ex.: periodoId de uma despesa nova, na memória)
          const volta = Object.fromEntries(Object.keys(campos).map(k => [k, k in antes ? antes[k] : '']));
          desfazer.push(() => base.update(t, id, volta));
        }
        return r;
      },
      async remove(t, id, se) { const r = await base.remove(t, id, se); if (r && typeof r === 'object') desfazer.push(() => base.add(t, r)); return r; },
    };
    try { return await fn(tx); } catch (e) {
      for (const d of desfazer.reverse()) await Promise.resolve().then(d).catch(err => console.error('[store] não foi possível desfazer uma gravação:', err.message));
      throw e;
    }
  };
}

// ---------------- PostgreSQL (ex.: Supabase) ----------------
// Cada tabela do sistema vira uma tabela no schema DATABASE_SCHEMA (padrão "ajuda"). O schema separado e o RLS
// ligado sem nenhuma regra deixam as tabelas FECHADAS para a API pública do Supabase (que expõe o schema
// "public"): só o servidor, conectado como dono do banco, lê e grava (há CPF e dados bancários).
// As colunas têm o mesmo nome usado no código (ex.: "colaboradorId"); "_ordem" guarda a ordem de inclusão,
// como as linhas da planilha.
const SCHEMAS_PROIBIDOS = /^(public|information_schema|pg_.*)$/;
// Confere a configuração e monta as opções de conexão. Os erros citam a variável e nunca mostram a senha.
function configBanco({ url, schema, ca, producao }) {
  if (!/^[a-z_][a-z0-9_]{0,40}$/.test(schema) || SCHEMAS_PROIBIDOS.test(schema)) {
    throw new Error('DATABASE_SCHEMA inválido: use letras minúsculas, números e _ (e não "public" nem nomes do sistema, como "pg_...").');
  }
  let endereco;
  try { endereco = new URL(String(url).trim()); } catch { endereco = null; }
  if (!endereco || !/^postgres(ql)?:$/.test(endereco.protocol) || !endereco.hostname) {
    throw new Error('DATABASE_URL inválida: deve começar com postgresql://. Se a senha tiver @ # / : % ? ou espaço, troque por uma só com letras e números.');
  }
  let ssl;
  if (ca) {
    let pem = ca;
    if (!ca.includes('BEGIN CERTIFICATE')) {
      try { pem = require('fs').readFileSync(ca, 'utf8'); } catch { throw new Error('DATABASE_SSL_CA: arquivo do certificado não encontrado. Confira o caminho.'); }
    }
    // Arruma o texto colado no Render: "\n" escrito, ou quebras de linha que viraram espaços
    pem = pem.replace(/\\n/g, '\n').replace(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g,
      (_, corpo) => `-----BEGIN CERTIFICATE-----\n${corpo.replace(/\s+/g, '').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----`);
    ssl = { ca: pem }; // criptografada E conferida (nunca aceita certificado errado)
    // sslmode/sslrootcert no endereço passariam por cima do certificado: quem manda é o DATABASE_SSL_CA
    for (const k of [...endereco.searchParams.keys()]) if (/^ssl/i.test(k)) endereco.searchParams.delete(k);
  } else if (producao) {
    throw new Error('DATABASE_SSL_CA é obrigatório em produção: sem ele a conexão com o banco não é criptografada (há CPF e dados bancários).');
  } else {
    console.warn('[banco] DATABASE_SSL_CA não definido: conexão SEM criptografia (aceito só fora de produção).');
  }
  return {
    connectionString: endereco.toString(), ssl,
    max: 4, // o pooler gratuito aceita poucas conexões
    connectionTimeoutMillis: 10000, // banco fora do ar: erro em 10 s, em vez de a tela ficar carregando para sempre
    query_timeout: 30000, statement_timeout: 30000, idleTimeoutMillis: 30000, keepAlive: true,
  };
}

function criarStoreBanco({ url, schema = 'ajuda', ca = '', producao = false }) {
  const { Pool } = require('pg');
  const pool = new Pool(configBanco({ url, schema, ca, producao }));
  pool.on('error', err => console.error('[banco] conexão perdida:', err.message)); // o pool reconecta sozinho
  // Toda conexão ganha um tratador de erro para a vida inteira: sem ele, uma conexão que cai no meio de uma
  // transação (ou logo depois de devolvida) derrubaria o servidor inteiro ("Unhandled 'error' event")
  pool.on('connect', cliente => cliente.on('error', err => console.error('[banco] conexão caiu:', err.message)));

  const nome = t => `"${schema}"."${t}"`;
  const col = c => `"${c}"`;
  const tipo = (t, k) => (TABELAS[t].num && TABELAS[t].num.includes(k) ? 'numeric(14,2)'
    : TABELAS[t].bool && TABELAS[t].bool.includes(k) ? 'boolean' : 'text');
  const chaves = t => TABELAS[t].cols.map(c => c[0]);
  function deBanco(t, linha) {
    const r = {};
    for (const k of chaves(t)) {
      const v = linha[k], ti = tipo(t, k);
      r[k] = ti === 'boolean' ? !!v : ti === 'text' ? String(v ?? '') : Math.round(Number(v || 0) * 100) / 100;
    }
    return r;
  }
  // Só as colunas conhecidas, no tipo certo (o PostgreSQL não aceita o caractere NUL em texto)
  function paraBanco(t, obj) {
    const r = {};
    for (const k of chaves(t)) {
      if (!(k in obj)) continue;
      const ti = tipo(t, k);
      r[k] = ti === 'boolean' ? !!obj[k] : ti === 'text' ? String(obj[k] ?? '').split('\u0000').join('') : Math.round((paraNumero(obj[k]) || 0) * 100) / 100;
    }
    return r;
  }
  // Leituras e gravações sobre uma conexão (q = pool.query ou a de uma transação)
  function operacoes(q) {
    const lerTravada = async (t, id) => (await q(`SELECT * FROM ${nome(t)} WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    return {
      sql: q, // comando direto (só para criar tabelas e para a migração)
      async list(t) { return (await q(`SELECT * FROM ${nome(t)} ORDER BY "_ordem"`)).rows.map(l => deBanco(t, l)); },
      async add(t, obj) {
        const v = paraBanco(t, obj), ks = Object.keys(v);
        await q(`INSERT INTO ${nome(t)} (${ks.map(col).join(', ')}) VALUES (${ks.map((_, i) => '$' + (i + 1)).join(', ')})`, ks.map(k => v[k]));
        return obj;
      },
      async update(t, id, campos, se) {
        const linha = await lerTravada(t, id);
        if (!linha) return null;
        if (se && !se(deBanco(t, linha))) return false;
        const v = paraBanco(t, campos); delete v.id;
        const ks = Object.keys(v);
        if (ks.length) await q(`UPDATE ${nome(t)} SET ${ks.map((k, i) => `${col(k)} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...ks.map(k => v[k])]);
        return deBanco(t, { ...linha, ...v }); // exatamente o que ficou gravado
      },
      async remove(t, id, se) {
        const linha = await lerTravada(t, id);
        if (!linha) return false;
        const apagada = deBanco(t, linha);
        if (se && !se(apagada)) return 'conflito';
        await q(`DELETE FROM ${nome(t)} WHERE id = $1`, [id]);
        return apagada; // devolve a linha apagada (como estava na hora)
      },
    };
  }
  // Roda fn(tx) numa transação: tudo é gravado junto ou nada é gravado. trava (opcional): só uma transação
  // com esse nome por vez em todo o banco (ex.: dois servidores subindo juntos).
  async function transacao(fn, { trava } = {}) {
    const c = await pool.connect();
    let quebrou = false;
    try {
      await c.query('BEGIN');
      if (trava) await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${schema}:${trava}`]);
      const r = await fn(operacoes((sql, p) => c.query(sql, p)));
      await c.query('COMMIT');
      return r;
    } catch (e) {
      quebrou = true;
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release(quebrou); // conexão com problema é descartada; o pool abre outra
    }
  }
  const direto = operacoes((sql, p) => pool.query(sql, p));

  return {
    modo: 'banco',
    pool, // usado pelo script de migração
    transacao,
    // Cria o que faltar; com trava, para dois servidores subindo juntos não criarem a mesma tabela ao mesmo tempo
    init: () => transacao(async tx => {
      await tx.sql(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      for (const t of Object.keys(TABELAS)) {
        await tx.sql(`CREATE TABLE IF NOT EXISTS ${nome(t)} (id text PRIMARY KEY, "_ordem" bigserial)`);
        // Coluna nova (versão nova do sistema) entra sozinha, como na planilha
        for (const k of chaves(t)) if (k !== 'id') await tx.sql(`ALTER TABLE ${nome(t)} ADD COLUMN IF NOT EXISTS ${col(k)} ${tipo(t, k)}`);
        await tx.sql(`ALTER TABLE ${nome(t)} ENABLE ROW LEVEL SECURITY`);
      }
    }, { trava: 'init' }),
    list: t => direto.list(t),
    add: (t, obj) => direto.add(t, obj),
    // se(atual) opcional: só grava se a condição for verdadeira; senão devolve false (conflito)
    update: (t, id, campos, se) => transacao(tx => tx.update(t, id, campos, se)),
    // se(atual) opcional: só apaga se a condição for verdadeira (senão devolve 'conflito')
    remove: (t, id, se) => transacao(tx => tx.remove(t, id, se)),
  };
}

function criarStore(env) {
  if (env.DATABASE_URL) {
    return criarStoreBanco({ url: env.DATABASE_URL, schema: env.DATABASE_SCHEMA || undefined, ca: env.DATABASE_SSL_CA || '', producao: env.NODE_ENV === 'production' });
  }
  const spreadsheetId = env.SPREADSHEET_ID;
  const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = (env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (spreadsheetId && email && privateKey) return criarStoreSheets({ spreadsheetId, email, privateKey });
  if (env.NODE_ENV === 'production') {
    throw new Error('Faltam SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL ou GOOGLE_PRIVATE_KEY nas variáveis de ambiente.');
  }
  console.warn('[store] Sem credenciais do Google: usando memória (apenas para testes locais).');
  return criarStoreMemoria();
}

module.exports = { criarStore, criarStoreSheets, criarStoreBanco, configBanco, novoId, paraNumero, TABELAS };
