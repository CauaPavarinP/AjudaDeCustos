// Armazenamento dos dados.
// Produção: Google Sheets (uma aba por tabela, criada automaticamente).
// Desenvolvimento sem credenciais: memória (os dados somem ao reiniciar).

const crypto = require('crypto');

// Cada tabela: [chave no código, título da coluna na planilha]
const TABELAS = {
  Colaboradores: {
    cols: [['id', 'ID'], ['nome', 'Nome'], ['usuario', 'Usuario'], ['funcao', 'Funcao'], ['ativo', 'Ativo'], ['senhaHash', 'SenhaHash'], ['criadoEm', 'CriadoEm'],
      ['telefone', 'Telefone'], ['cidade', 'Cidade'], ['uf', 'UF'],
      ['banco', 'Banco'], ['agencia', 'Agencia'], ['conta', 'Conta'], ['cpf', 'CPF'], ['pix', 'PIX']],
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
  return {
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
    const rows = await doc.sheetsByTitle[t].getRows();
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

  return {
    modo: 'sheets',
    async init() {
      await doc.loadInfo();
      for (const t of Object.keys(TABELAS)) await prepararAba(t);
    },
    // { fresco: true }: ignora o cache (para decisões que não podem usar dado de até 5 s atrás)
    async list(t, { fresco } = {}) {
      if (fresco) limpar(t);
      return (await linhas(t)).map(r => deLinha(t, r.toObject())).filter(o => o.id);
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
    remove: (t, id) => naFila(t, async () => {
      const row = await acharLinha(t, id);
      if (!row) return false;
      await row.delete();
      limpar(t);
      return true;
    }),
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
