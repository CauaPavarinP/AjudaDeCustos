// Painel do Maurício: extrato e cadastro de funcionários
const $ = id => document.getElementById(id);
const brl = n => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = s => s.split('-').reverse().join('/');
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

let modo = 'funcao';
let funcionarios = [];
let editandoId = null;

function erro(el, msg) { el.textContent = msg; el.classList.toggle('hidden', !msg); }
function celula(tr, txt, cls) { const td = document.createElement('td'); td.textContent = txt; if (cls) td.className = cls; tr.appendChild(td); return td; }

async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts });
  const corpo = await r.json().catch(() => ({}));
  if (r.status === 401 && !url.endsWith('/login')) { mostrarLogin(); throw new Error('Faça login.'); }
  if (!r.ok) throw new Error(corpo.erro || 'Erro de conexão.');
  return corpo;
}

// ---------- login ----------
function mostrarLogin() { $('v-login').classList.remove('hidden'); $('v-painel').classList.add('hidden'); }
async function mostrarPainel() {
  $('v-login').classList.add('hidden'); $('v-painel').classList.remove('hidden');
  await carregarFuncionarios();
  await carregarExtrato();
}
$('v-login').addEventListener('submit', async e => {
  e.preventDefault(); erro($('a-erro'), '');
  try {
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ usuario: $('a-user').value, senha: $('a-pass').value }) });
    $('a-pass').value = '';
    await mostrarPainel();
  } catch (err) { erro($('a-erro'), err.message); }
});
$('b-sair').addEventListener('click', async () => { await fetch('/api/admin/logout', { method: 'POST' }); mostrarLogin(); });

// ---------- abas ----------
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === t));
  $('t-extrato').classList.toggle('hidden', t.dataset.tab !== 'extrato');
  $('t-funcionarios').classList.toggle('hidden', t.dataset.tab !== 'funcionarios');
  if (t.dataset.tab === 'extrato') carregarExtrato(); else renderFuncionarios();
}));

// ---------- extrato ----------
let funcoesConhecidas = [];
function montarSelectQuem(manter) {
  const sel = $('x-quem');
  const atual = manter ? sel.value : '';
  sel.innerHTML = '';
  if (modo === 'funcao') {
    $('x-quem-label').textContent = 'Função';
    sel.add(new Option('Todas as funções', ''));
    funcoesConhecidas.forEach(f => sel.add(new Option(f, f)));
  } else {
    $('x-quem-label').textContent = 'Funcionário';
    sel.add(new Option('Todos os funcionários', ''));
    funcionarios.forEach(f => sel.add(new Option(f.nome + (f.ativo ? '' : ' (inativo)'), f.id)));
  }
  if ([...sel.options].some(o => o.value === atual)) sel.value = atual;
}
document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
  modo = b.dataset.modo;
  document.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b));
  montarSelectQuem(false);
  carregarExtrato();
}));
['x-quem', 'x-ini', 'x-fim', 'x-tipo'].forEach(id => $(id).addEventListener('change', carregarExtrato));

function filtros() {
  const p = new URLSearchParams();
  if ($('x-ini').value) p.set('inicio', $('x-ini').value);
  if ($('x-fim').value) p.set('fim', $('x-fim').value);
  if ($('x-tipo').value) p.set('tipo', $('x-tipo').value);
  if ($('x-quem').value) p.set(modo === 'funcao' ? 'funcao' : 'funcionarioId', $('x-quem').value);
  return p.toString();
}

async function carregarExtrato() {
  let r;
  try { r = await api('/api/admin/extrato?' + filtros()); } catch { return; }
  funcoesConhecidas = r.funcoes;
  if (modo === 'funcao') montarSelectQuem(true);
  if (!$('x-ini').value) $('x-ini').value = r.inicio;
  if (!$('x-fim').value) $('x-fim').value = r.fim;
  $('b-export').href = '/api/admin/extrato.csv?' + filtros();

  const nFunc = r.porFuncionario.length;
  $('k-total').textContent = brl(r.total);
  $('k-periodo').textContent = `${dataBR(r.inicio)} a ${dataBR(r.fim)}`;
  $('k-qtd').textContent = r.quantidade;
  $('k-func').textContent = nFunc === 1 ? '1 funcionário' : `${nFunc} funcionários`;
  const top = r.porTipo[0];
  $('k-tipo').textContent = top ? top.nome : '—';
  $('k-tipo-d').textContent = top ? `${brl(top.total)} · ${Math.round(top.total / r.total * 100)}% do total` : 'Sem lançamentos';
  $('k-media').textContent = nFunc ? brl(r.total / nFunc) : '—';
  $('k-media-d').textContent = $('x-quem').value && modo === 'funcao' ? $('x-quem').value : 'No período filtrado';

  const tb = $('x-linhas');
  tb.innerHTML = '';
  for (const l of r.lancamentos) {
    const tr = document.createElement('tr');
    celula(tr, dataBR(l.data), 'nowrap'); celula(tr, l.funcionario, 'b'); celula(tr, l.funcao);
    celula(tr, l.tipo); celula(tr, l.descricao || '—'); celula(tr, brl(l.valor), 'r b nowrap');
    tb.appendChild(tr);
  }
  if (!r.lancamentos.length) { const tr = document.createElement('tr'); const td = celula(tr, 'Nenhum lançamento para esse filtro.', 'muted'); td.colSpan = 6; tb.appendChild(tr); }
  $('x-registros').textContent = r.quantidade === 1 ? '1 registro' : `${r.quantidade} registros`;
  $('x-rodape').textContent = `${r.quantidade} lançamento(s)`;
  $('x-total-rodape').textContent = 'Total do filtro: ' + brl(r.total);

  const box = $('x-por-func');
  box.innerHTML = '';
  const max = r.porFuncionario[0]?.total || 1;
  for (const f of r.porFuncionario) {
    const d = document.createElement('div');
    d.className = 'bar-row';
    d.innerHTML = '<div class="n"><span></span><span></span></div><div class="bar"><i></i></div>';
    d.querySelector('.n span:first-child').textContent = f.nome;
    d.querySelector('.n span:last-child').textContent = brl(f.total);
    d.querySelector('.bar i').style.width = Math.max(2, f.total / max * 100) + '%';
    d.addEventListener('click', () => { document.querySelector('.seg [data-modo=funcionario]').click(); $('x-quem').value = f.id; carregarExtrato(); });
    box.appendChild(d);
  }
  if (!r.porFuncionario.length) box.innerHTML = '<span class="muted small">Sem lançamentos no período.</span>';
}

// ---------- funcionários ----------
async function carregarFuncionarios() {
  funcionarios = await api('/api/admin/funcionarios');
  const dl = $('funcoes');
  dl.innerHTML = '';
  [...new Set(funcionarios.map(f => f.funcao))].sort().forEach(f => dl.appendChild(new Option(f)));
  if (modo === 'funcionario') montarSelectQuem(true);
  renderFuncionarios();
}
function renderFuncionarios() {
  const tb = $('f-linhas');
  tb.innerHTML = '';
  for (const f of funcionarios) {
    const tr = document.createElement('tr');
    if (!f.ativo) tr.className = 'off';
    celula(tr, f.nome, 'b'); celula(tr, f.funcao); celula(tr, f.telefone || '—', 'nowrap'); celula(tr, f.ativo ? f.codigo : '—');
    const st = celula(tr, ''); const b = document.createElement('span'); b.className = 'badge' + (f.ativo ? '' : ' off'); b.textContent = f.ativo ? 'Ativo' : 'Inativo'; st.appendChild(b);
    const ac = celula(tr, '', 'r nowrap');
    const acao = (txt, fn, red) => { const x = document.createElement('button'); x.className = 'link' + (red ? ' red' : ''); x.textContent = txt; x.style.marginLeft = '12px'; x.addEventListener('click', fn); ac.appendChild(x); };
    if (f.ativo) {
      acao('Editar', () => editar(f));
      acao('Novo código', () => acaoFuncionario(f, { novoCodigo: true }, `Gerar um novo código para ${f.nome}? O código atual deixará de funcionar.`));
      acao('Desativar', () => acaoFuncionario(f, { ativo: false }, `Desativar ${f.nome}? Ele não conseguirá mais lançar. Os lançamentos antigos continuam no extrato.`), true);
    } else {
      acao('Reativar', () => acaoFuncionario(f, { ativo: true }, `Reativar ${f.nome}?`));
    }
    tb.appendChild(tr);
  }
  if (!funcionarios.length) { const tr = document.createElement('tr'); const td = celula(tr, 'Nenhum funcionário cadastrado ainda.', 'muted'); td.colSpan = 6; tb.appendChild(tr); }
}
async function acaoFuncionario(f, corpo, pergunta) {
  if (!confirm(pergunta)) return;
  try {
    const r = await api('/api/admin/funcionarios/' + encodeURIComponent(f.id), { method: 'PUT', body: JSON.stringify(corpo) });
    if (corpo.novoCodigo) mostrarCodigo(r);
    await carregarFuncionarios();
  } catch (err) { alert(err.message); }
}
function mostrarCodigo(f) {
  const box = $('f-codigo');
  box.innerHTML = 'Código de acesso de <span></span>: <b></b><br><span class="small">Passe esse código para o funcionário entrar no sistema.</span>';
  box.querySelector('span').textContent = f.nome;
  box.querySelector('b').textContent = f.codigo;
  box.classList.remove('hidden');
}
function limparForm() {
  editandoId = null;
  $('f-titulo').textContent = 'Cadastrar funcionário';
  $('f-nome').value = ''; $('f-funcao').value = ''; $('f-tel').value = '';
  erro($('f-erro'), '');
}
function editar(f) {
  editandoId = f.id;
  $('f-titulo').textContent = 'Editar funcionário';
  $('f-nome').value = f.nome; $('f-funcao').value = f.funcao; $('f-tel').value = f.telefone;
  $('f-codigo').classList.add('hidden'); erro($('f-erro'), '');
  $('f-nome').focus();
}
$('b-cadastrar').addEventListener('click', () => { limparForm(); $('f-codigo').classList.add('hidden'); $('f-nome').focus(); });
$('f-cancelar').addEventListener('click', () => { limparForm(); $('f-codigo').classList.add('hidden'); });
$('f-form').addEventListener('submit', async e => {
  e.preventDefault(); erro($('f-erro'), '');
  const corpo = { nome: $('f-nome').value, funcao: $('f-funcao').value, telefone: $('f-tel').value };
  try {
    const r = editandoId
      ? await api('/api/admin/funcionarios/' + encodeURIComponent(editandoId), { method: 'PUT', body: JSON.stringify(corpo) })
      : await api('/api/admin/funcionarios', { method: 'POST', body: JSON.stringify(corpo) });
    const novo = !editandoId;
    limparForm();
    if (novo) mostrarCodigo(r); else $('f-codigo').classList.add('hidden');
    await carregarFuncionarios();
  } catch (err) { erro($('f-erro'), err.message); }
});

// ---------- início ----------
(async () => {
  try {
    const t = await (await fetch('/api/tipos')).json();
    t.forEach(x => $('x-tipo').add(new Option(x, x)));
  } catch {}
  try { await api('/api/admin/me'); await mostrarPainel(); } catch { mostrarLogin(); }
})();
