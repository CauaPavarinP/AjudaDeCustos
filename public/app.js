// Tela do colaborador (celular)
const $ = id => document.getElementById(id);
const VIEWS = ['login', 'inicio', 'novo', 'ok'];
const brl = n => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = s => s.split('-').reverse().join('/');
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

const svg = p => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICONES = {
  'Combustível': svg('<line x1="3" x2="15" y1="22" y2="22"/><line x1="4" x2="14" y1="9" y2="9"/><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/>'),
  'Alimentação': svg('<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>'),
  'Hospedagem': svg('<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>'),
  'Estacionamento': svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/>'),
};
const ICONE_PADRAO = svg('<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>');

let tipoSelecionado = '';
let centavos = 0;

function mostrar(v) {
  VIEWS.forEach(n => $('v-' + n).classList.toggle('hidden', n !== v));
  window.scrollTo(0, 0);
}
function erro(el, msg) { el.textContent = msg; el.classList.toggle('hidden', !msg); }

async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts });
  const corpo = await r.json().catch(() => ({}));
  if (r.status === 401 && !url.endsWith('/api/login')) { await abrirLogin(); throw new Error(corpo.erro || 'Faça login.'); }
  if (!r.ok) throw new Error(corpo.erro || 'Erro de conexão. Tente novamente.');
  return corpo;
}

// ---------- login ----------
async function abrirLogin() {
  mostrar('login');
  try {
    const lista = await (await fetch('/api/funcionarios-login')).json();
    const sel = $('l-func');
    sel.innerHTML = '<option value="">Selecione seu nome</option>';
    for (const f of lista) sel.add(new Option(f.nome, f.id));
    const ultimo = localStorage.getItem('ultimoFuncionario');
    if (ultimo && lista.some(f => f.id === ultimo)) sel.value = ultimo;
  } catch { erro($('l-erro'), 'Não foi possível carregar a lista de nomes.'); }
}
$('f-login').addEventListener('submit', async e => {
  e.preventDefault();
  erro($('l-erro'), '');
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ funcionarioId: $('l-func').value, codigo: $('l-cod').value }) });
    try { localStorage.setItem('ultimoFuncionario', $('l-func').value); } catch {}
    $('l-cod').value = '';
    await abrirInicio();
  } catch (err) { erro($('l-erro'), err.message); }
});

// ---------- início ----------
function itemHTML(l) {
  const div = document.createElement('div');
  div.className = 'item';
  div.innerHTML = `<div class="ic">${ICONES[l.tipo] || ICONE_PADRAO}</div><div class="grow"><div class="t"></div><div class="d"></div></div><div class="v"></div>`;
  div.querySelector('.t').textContent = l.tipo;
  div.querySelector('.d').textContent = dataBR(l.data).slice(0, 5) + (l.descricao ? ' · ' + l.descricao : '');
  div.querySelector('.v').textContent = brl(l.valor);
  return div;
}
async function abrirInicio() {
  const me = await api('/api/me');
  $('i-nome').textContent = 'Olá, ' + me.nome.split(' ')[0];
  $('i-funcao').textContent = me.funcao;
  mostrar('inicio');
  const r = await api('/api/meus-lancamentos');
  const [ano, mes] = r.mes.split('-');
  $('i-mes').textContent = `${MESES[Number(mes) - 1]} de ${ano}`;
  $('i-total').textContent = brl(r.total);
  $('i-qtd').textContent = r.quantidade === 1 ? '1 lançamento' : `${r.quantidade} lançamentos`;
  const lista = $('i-lista');
  lista.innerHTML = '';
  if (!r.lancamentos.length) lista.innerHTML = '<div class="empty">Nenhum lançamento neste mês.</div>';
  r.lancamentos.forEach(l => lista.appendChild(itemHTML(l)));
}
$('b-sair').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); abrirLogin(); });
$('b-novo').addEventListener('click', abrirNovo);

// ---------- novo lançamento ----------
async function montarTipos() {
  const tipos = await (await fetch('/api/tipos')).json();
  const box = $('n-tipos');
  box.innerHTML = '';
  for (const t of tipos) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = t;
    b.addEventListener('click', () => {
      tipoSelecionado = t;
      box.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b));
      $('n-desc-label').textContent = t === 'Outros' ? 'Descrição (obrigatória)' : 'Descrição (opcional)';
    });
    box.appendChild(b);
  }
}
function abrirNovo() {
  tipoSelecionado = ''; centavos = 0;
  document.querySelectorAll('#n-tipos .chip').forEach(c => c.classList.remove('on'));
  $('n-data').value = hoje(); $('n-data').max = hoje();
  $('n-valor').value = ''; $('n-desc').value = '';
  $('n-desc-label').textContent = 'Descrição (opcional)';
  erro($('n-erro'), '');
  mostrar('novo');
}
// Máscara de dinheiro: digita só números e vai preenchendo os centavos
$('n-valor').addEventListener('input', e => {
  const d = e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 9);
  centavos = Number(d || 0);
  e.target.value = centavos ? brl(centavos / 100) : '';
});
$('b-voltar').addEventListener('click', abrirInicio);
$('f-novo').addEventListener('submit', async e => {
  e.preventDefault();
  erro($('n-erro'), '');
  if (!tipoSelecionado) return erro($('n-erro'), 'Escolha o tipo de despesa.');
  if (!centavos) return erro($('n-erro'), 'Informe o valor.');
  const btn = $('b-enviar');
  btn.disabled = true; btn.textContent = 'Enviando...';
  try {
    const l = await api('/api/lancamentos', { method: 'POST', body: JSON.stringify({ tipo: tipoSelecionado, data: $('n-data').value, valor: centavos / 100, descricao: $('n-desc').value }) });
    const box = $('ok-resumo');
    box.innerHTML = '';
    for (const [a, b] of [['Tipo', l.tipo], ['Data', dataBR(l.data)], ['Valor', brl(l.valor)], ['Descrição', l.descricao || '—']]) {
      const row = document.createElement('div');
      row.innerHTML = '<span></span><span></span>';
      row.children[0].textContent = a; row.children[1].textContent = b;
      box.appendChild(row);
    }
    mostrar('ok');
  } catch (err) { erro($('n-erro'), err.message); }
  finally { btn.disabled = false; btn.textContent = 'Enviar lançamento'; }
});
$('b-ok-novo').addEventListener('click', abrirNovo);
$('b-ok-inicio').addEventListener('click', abrirInicio);

// ---------- início do app ----------
montarTipos();
abrirInicio().catch(() => {});
