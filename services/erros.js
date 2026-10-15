// Resumo de um erro para o log do Render: tipo, código HTTP (se houver) e mensagem.
// Nunca grave o objeto do erro inteiro: erros de requisição (ex.: API do Google) carregam a
// requisição com os cabeçalhos, inclusive o token de acesso (Authorization: Bearer ...).
function resumoErro(err) {
  if (!err || typeof err !== 'object') return String(err);
  const status = err.response && err.response.status;
  const msg = String(err.message || '').slice(0, 500);
  return `${err.name || 'Erro'}${status ? ` ${status}` : ''}: ${msg}`;
}

// Linhas do stack (onde no código o erro aconteceu), sem a mensagem. Só para erros que não vieram
// de uma resposta HTTP: nesses, o stack aponta para dentro da biblioteca e não ajuda.
function ondeAconteceu(err) {
  if (!err || err.response || typeof err.stack !== 'string') return '';
  return err.stack.split('\n').filter(l => /^\s+at /.test(l)).slice(0, 5).join('\n');
}

module.exports = { resumoErro, ondeAconteceu };
