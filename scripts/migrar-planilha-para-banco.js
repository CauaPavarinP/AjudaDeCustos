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

    // Não mistura dados: só copia num banco vazio (ou apagado de propósito)
    const jaTem = [];
    for (const t of tabelas) { const n = (await banco.list(t)).length; if (n) jaTem.push(`${t} (${n})`); }
    if (jaTem.length && !apagarAntes) {
      throw new Error(`O banco já tem dados: ${jaTem.join(', ')}. Rode com --apagar-antes para apagar e copiar de novo.`);
    }
    if (jaTem.length) {
      for (const t of tabelas) await banco.pool.query(`TRUNCATE "${env.DATABASE_SCHEMA || 'ajuda'}"."${t}"`);
      console.log('Dados que estavam no banco apagados.');
    }

    let erros = 0;
    for (const t of tabelas) {
      const linhas = await planilha.list(t);
      for (const l of linhas) await banco.add(t, l); // na mesma ordem da planilha
      const noBanco = (await banco.list(t)).length;
      const ok = noBanco === linhas.length;
      if (!ok) erros++;
      console.log(`${ok ? 'OK  ' : 'ERRO'} ${t.padEnd(14)} planilha ${String(linhas.length).padStart(4)} · banco ${String(noBanco).padStart(4)}`);
    }
    if (erros) throw new Error('Alguma tabela ficou com quantidade diferente. Rode de novo com --apagar-antes.');
    console.log('\nPronto: tudo copiado. A planilha não foi alterada.');
  } finally {
    await banco.pool.end();
  }
}

main().catch(err => { console.error('\nNão foi possível migrar:', err.message); process.exit(1); });
