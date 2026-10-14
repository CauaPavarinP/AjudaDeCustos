// Armazenamento dos dados.
// Produção: Google Sheets (uma aba por tabela, criada automaticamente).
// Desenvolvimento sem credenciais: memória (os dados somem ao reiniciar).

const crypto = require('crypto');

// Cada tabela: [chave no código, título da coluna na planilha]
const TABELAS = {
  Colaboradores: {
    cols: [['id', 'ID'], ['nome', 'Nome'], ['usuario', 'Usuario'], ['funcao', 'Funcao'], ['ativo', 'Ativo'], ['senhaHash', 'SenhaHash'], ['criadoEm', 'CriadoEm']],
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
      ['criadoEm', 'EnviadaEm'], ['avaliadoEm', 'AvaliadaEm'], ['avaliadoPor', 'AvaliadaPor'], ['foto', 'Foto']],
    num: ['valor'],
  },
};

const novoId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);

// Aceita "186.4", "186,40", "1.234,50", "1,234.50" (o formato na planilha pode variar com a localidade).
// Quando há ponto e vírgula, o último dos dois é o separador decimal.
function paraNumero(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim().replace(/[R$\s]/g, '');
  if (!s) return 0;
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
    else if (t.bool && t.bool.includes(k)) v = String(v || '').toUpperCase() !== 'NAO';
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
  return {
    modo: 'memoria',
    async init() {},
    async list(t) { return copia(dados[t]); },
    async add(t, obj) { dados[t].push(copia(obj)); return copia(obj); },
    async update(t, id, campos) {
      const o = dados[t].find(x => x.id === id);
      if (!o) return null;
      Object.assign(o, copia(campos));
      return copia(o);
    },
    async remove(t, id) {
      const i = dados[t].findIndex(x => x.id === id);
      if (i < 0) return false;
      dados[t].splice(i, 1);
      return true;
    },
  };
}

// ---------------- Google Sheets ----------------
function criarStoreSheets({ spreadsheetId, email, privateKey }) {
  const { GoogleSpreadsheet } = require('google-spreadsheet');
  const { JWT } = require('google-auth-library');
  const auth = new JWT({ email, key: privateKey, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const doc = new GoogleSpreadsheet(spreadsheetId, auth);

  // Cache curto para não estourar a cota de leitura da API do Google
  const CACHE_MS = 5000;
  const cache = {};
  const limpar = t => { delete cache[t]; };

  async function prepararAba(titulo) {
    const colunas = TABELAS[titulo].cols.map(c => c[1]);
    let sheet = doc.sheetsByTitle[titulo];
    if (!sheet) return doc.addSheet({ title: titulo, headerValues: colunas });
    try { await sheet.loadHeaderRow(); } catch { await sheet.setHeaderRow(colunas); return sheet; }
    const faltando = colunas.filter(c => !sheet.headerValues.includes(c));
    if (faltando.length) await sheet.setHeaderRow([...sheet.headerValues, ...faltando]);
    return sheet;
  }
  async function linhas(t) {
    const c = cache[t];
    if (c && Date.now() - c.t < CACHE_MS) return c.rows;
    const rows = await doc.sheetsByTitle[t].getRows();
    cache[t] = { t: Date.now(), rows };
    return rows;
  }
  const acharLinha = async (t, id) => { limpar(t); return (await linhas(t)).find(r => String(r.get('ID')) === id); };

  return {
    modo: 'sheets',
    async init() {
      await doc.loadInfo();
      for (const t of Object.keys(TABELAS)) await prepararAba(t);
    },
    async list(t) {
      return (await linhas(t)).map(r => deLinha(t, r.toObject())).filter(o => o.id);
    },
    async add(t, obj) {
      // raw: true evita que textos digitados virem fórmulas na planilha
      await doc.sheetsByTitle[t].addRow(paraLinha(t, obj), { raw: true });
      limpar(t);
      return obj;
    },
    async update(t, id, campos) {
      const row = await acharLinha(t, id);
      if (!row) return null;
      const atual = { ...deLinha(t, row.toObject()), ...campos };
      row.assign(paraLinha(t, atual));
      await row.save({ raw: true });
      limpar(t);
      return atual;
    },
    async remove(t, id) {
      const row = await acharLinha(t, id);
      if (!row) return false;
      await row.delete();
      limpar(t);
      return true;
    },
  };
}

function criarStore(env) {
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

module.exports = { criarStore, novoId, paraNumero };
