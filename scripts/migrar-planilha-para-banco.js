// Copia todos os dados da planilha do Google para o banco PostgreSQL (DATABASE_URL).
//
// Uso (na pasta do projeto, com o .env tendo as variáveis do Google E o DATABASE_URL):
//   node scripts/migrar-planilha-para-banco.js                 copia (só se o banco estiver vazio)
//   node scripts/migrar-planilha-para-banco.js --apagar-antes  apaga o que já estiver no banco e copia de novo
//
// A planilha é só LIDA: nenhuma aba, coluna ou linha dela é criada, alterada ou apagada.
// As fotos continuam no Cloudinary (o banco guarda só a referência, como a planilha).
require('dotenv').config({ quiet: true });
const { criarStoreSheets, criarStoreBanco, TABELAS } = require('../services/store');

async function main() {
  const env = process.env;
  const faltam = ['SPREADSHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'DATABASE_URL'].filter(v => !env[v]);
  if (faltam.length) throw new Error('Faltam no .env: ' + faltam.join(', '));
  const apagarAntes = process.argv.includes('--apagar-antes');

  const planilha = criarStoreSheets({
    spreadsheetId: env.SPREADSHEET_ID, email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), somenteLeitura: true,
  });
  const banco = criarStoreBanco({ url: env.DATABASE_URL, schema: env.DATABASE_SCHEMA || undefined, ca: env.DATABASE_SSL_CA || '' });
  try {
    await planilha.init();
    await banco.init();
    const tabelas = Object.keys(TABELAS);
    const schema = env.DATABASE_SCHEMA || 'ajuda';

    // Lê tudo da planilha antes e confere IDs repetidos (o banco não aceita; a planilha usaria só o primeiro)
    const dados = {};
    for (const t of tabelas) {
      dados[t] = await planilha.list(t);
      const vistos = new Set(), repetidos = new Set();
      for (const l of dados[t]) (vistos.has(l.id) ? repetidos : vistos).add(l.id);
      if (repetidos.size) throw new Error(`a aba ${t} tem ID repetido: ${[...repetidos].join(', ')}. Corrija na planilha (cada linha precisa de um ID único) e rode de novo.`);
    }

    // Copia tudo numa transação só: se qualquer linha der erro, nada fica gravado (o banco não fica pela metade)
    await banco.transacao(async tx => {
      const jaTem = [];
      for (const t of tabelas) { const n = (await tx.list(t)).length; if (n) jaTem.push(`${t} (${n})`); }
      if (jaTem.length && !apagarAntes) {
        throw new Error(`O banco já tem dados: ${jaTem.join(', ')}. Rode com --apagar-antes para apagar e copiar de novo.`);
      }
      if (jaTem.length) for (const t of tabelas) await tx.sql(`TRUNCATE "${schema}"."${t}"`);
      for (const t of tabelas) {
        for (const l of dados[t]) { // na mesma ordem da planilha
          try { await tx.add(t, l); } catch (e) { throw new Error(`aba ${t}, linha de ID ${l.id}: ${e.message}`); }
        }
        const noBanco = (await tx.list(t)).length;
        if (noBanco !== dados[t].length) throw new Error(`a aba ${t} ficou com ${noBanco} linhas no banco, mas tem ${dados[t].length} na planilha.`);
        console.log(`OK   ${t.padEnd(15)} planilha ${String(dados[t].length).padStart(4)} · banco ${String(noBanco).padStart(4)}`);
      }
    }, { trava: 'migracao' });
    console.log('\nPronto: tudo copiado. A planilha não foi alterada.');
    console.log('Se o sistema já estiver rodando com este banco, reinicie-o para ele ler os dados copiados.');
  } finally {
    await banco.pool.end();
  }
}

main().catch(err => { console.error('\nNão foi possível migrar (nada foi gravado no banco):', err.message); process.exit(1); });
