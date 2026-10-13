// Armazenamento dos dados (funcionários e lançamentos).
// Produção: Google Sheets (abas "Funcionarios" e "Lancamentos").
// Desenvolvimento sem credenciais: memória (os dados somem ao reiniciar).

const crypto = require('crypto');

const ABA_FUNC = 'Funcionarios';
const ABA_LANC = 'Lancamentos';
const COLS_FUNC = ['ID', 'Nome', 'Funcao', 'Telefone', 'Codigo', 'Ativo', 'CriadoEm'];
const COLS_LANC = ['ID', 'Data', 'FuncionarioID', 'Funcionario', 'Funcao', 'Tipo', 'Valor', 'Descricao', 'CriadoEm'];

const novoId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);

// Aceita "186.4", "186,40", "1234,5" (formato da planilha pode variar com a localidade)
function paraNumero(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim().replace(/[R$\s]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function linhaParaFuncionario(o) {
  return {
    id: String(o.ID || ''),
    nome: String(o.Nome || ''),
    funcao: String(o.Funcao || ''),
    telefone: String(o.Telefone || ''),
    codigo: String(o.Codigo || ''),
    ativo: String(o.Ativo || '').toUpperCase() !== 'NAO',
    criadoEm: String(o.CriadoEm || ''),
  };
}
function funcionarioParaLinha(f) {
  return { ID: f.id, Nome: f.nome, Funcao: f.funcao, Telefone: f.telefone, Codigo: f.codigo, Ativo: f.ativo ? 'SIM' : 'NAO', CriadoEm: f.criadoEm };
}
function linhaParaLancamento(o) {
  return {
    id: String(o.ID || ''),
    data: String(o.Data || ''),
    funcionarioId: String(o.FuncionarioID || ''),
    funcionario: String(o.Funcionario || ''),
    funcao: String(o.Funcao || ''),
    tipo: String(o.Tipo || ''),
    valor: Math.round(paraNumero(o.Valor) * 100) / 100,
    descricao: String(o.Descricao || ''),
    criadoEm: String(o.CriadoEm || ''),
  };
}
function lancamentoParaLinha(l) {
  return { ID: l.id, Data: l.data, FuncionarioID: l.funcionarioId, Funcionario: l.funcionario, Funcao: l.funcao, Tipo: l.tipo, Valor: l.valor, Descricao: l.descricao, CriadoEm: l.criadoEm };
}

// ---------------- Memória (só desenvolvimento) ----------------
function criarStoreMemoria() {
  const func = [];
  const lanc = [];
  return {
    modo: 'memoria',
    async init() {},
    async listFuncionarios() { return func.map(f => ({ ...f })); },
    async addFuncionario(f) { func.push({ ...f }); return { ...f }; },
    async updateFuncionario(id, campos) {
      const f = func.find(x => x.id === id);
      if (!f) return null;
      Object.assign(f, campos);
      return { ...f };
    },
    async listLancamentos() { return lanc.map(l => ({ ...l })); },
    async addLancamento(l) { lanc.push({ ...l }); return { ...l }; },
  };
}

// ---------------- Google Sheets ----------------
function criarStoreSheets({ spreadsheetId, email, privateKey }) {
  const { GoogleSpreadsheet } = require('google-spreadsheet');
  const { JWT } = require('google-auth-library');
  const auth = new JWT({ email, key: privateKey, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const doc = new GoogleSpreadsheet(spreadsheetId, auth);

  // Cache curto para não estourar a cota de leitura da API
  const CACHE_MS = 5000;
  const cache = {};
  const limpar = aba => { delete cache[aba]; };

  async function aba(titulo, colunas) {
    let sheet = doc.sheetsByTitle[titulo];
    if (!sheet) {
      sheet = await doc.addSheet({ title: titulo, headerValues: colunas });
      return sheet;
    }
    await sheet.loadHeaderRow().catch(async () => { await sheet.setHeaderRow(colunas); });
    const faltando = colunas.filter(c => !sheet.headerValues.includes(c));
    if (faltando.length) await sheet.setHeaderRow([...sheet.headerValues, ...faltando]);
    return sheet;
  }

  async function linhas(titulo) {
    const c = cache[titulo];
    if (c && Date.now() - c.t < CACHE_MS) return c.rows;
    const rows = await doc.sheetsByTitle[titulo].getRows();
    cache[titulo] = { t: Date.now(), rows };
    return rows;
  }

  return {
    modo: 'sheets',
    async init() {
      await doc.loadInfo();
      await aba(ABA_FUNC, COLS_FUNC);
      await aba(ABA_LANC, COLS_LANC);
    },
    async listFuncionarios() {
      return (await linhas(ABA_FUNC)).map(r => linhaParaFuncionario(r.toObject())).filter(f => f.id);
    },
    async addFuncionario(f) {
      // raw: true evita que textos digitados virem fórmulas na planilha
      await doc.sheetsByTitle[ABA_FUNC].addRow(funcionarioParaLinha(f), { raw: true });
      limpar(ABA_FUNC);
      return f;
    },
    async updateFuncionario(id, campos) {
      limpar(ABA_FUNC);
      const row = (await linhas(ABA_FUNC)).find(r => String(r.get('ID')) === id);
      if (!row) return null;
      const atual = { ...linhaParaFuncionario(row.toObject()), ...campos };
      row.assign(funcionarioParaLinha(atual));
      await row.save({ raw: true });
      limpar(ABA_FUNC);
      return atual;
    },
    async listLancamentos() {
      return (await linhas(ABA_LANC)).map(r => linhaParaLancamento(r.toObject())).filter(l => l.id);
    },
    async addLancamento(l) {
      await doc.sheetsByTitle[ABA_LANC].addRow(lancamentoParaLinha(l), { raw: true });
      limpar(ABA_LANC);
      return l;
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
