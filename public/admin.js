// Painel do Maurício: Lançamentos, Nova prestação, Resumos e Colaboradores
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl = n => 'R$ ' + fmt(n);
const cel = n => (n ? fmt(n) : '—');
const r2 = n => Math.round(n * 100) / 100;
const dm = s => s.slice(8, 10) + '/' + s.slice(5, 7);
const dmy = s => (s ? dm(s) + '/' + s.slice(0, 4) : '');
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MES_CURTO = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const nomeMes = ym => MESES[Number(ym.slice(5, 7)) - 1] + '/' + ym.slice(0, 4);
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const CORES_CAT = ['#2563eb', '#7c3aed', '#0ea5e9', '#f59e0b', '#16a34a', '#94a3b8'];
const CORES_FUNCAO = ['b-purple', 'b-pink', 'b-blue', 'b-amber', 'b-green', 'b-gray'];

let D = null;          // dados vindos do servidor
let CAT = [];          // categorias
const F = {            // filtros de cada tela (ficam guardados ao trocar de tela)
  l: { ano: hoje().slice(0, 4), mes: hoje().slice(5, 7), funcao: '', colab: '', busca: '' },
  c: { colab: '', ano: hoje().slice(0, 4) },
  f: { ano: hoje().slice(0, 4), mes: hoje().slice(5, 7), funcao: '' },
  d: { ano: hoje().slice(0, 4), mes: hoje().slice(5, 7), colab: '', busca: '', status: '' },
};

// Versão nova no servidor (deploy): a página se recarrega sozinha no próximo momento seguro
let versaoAberta = '', versaoNova = false;
function notaVersao(r) {
  const v = r.headers.get('X-Versao');
  if (!v) return;
  if (!versaoAberta) versaoAberta = v; else if (v !== versaoAberta) versaoNova = true;
}

async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts });
  const corpo = await r.json().catch(() => ({}));
  notaVersao(r);
  if (r.status === 401 && !url.endsWith('/login')) { mostrarLogin(); throw new Error('Faça login.'); }
  if (!r.ok) throw Object.assign(new Error(corpo.erro || 'Erro de conexão.'), { status: r.status });
  return corpo;
}
const post = (url, body, method = 'POST') => api(url, { method, body: JSON.stringify(body || {}) });

// Aprovar, recusar ou desfazer. Se outra aba já mudou a despesa (409), atualiza a tela antes do aviso.
async function avaliarDespesa(id, acao) {
  try { await post(`/api/admin/despesas/${encodeURIComponent(id)}/${acao}`); }
  catch (e) { if (e.status === 409) { await carregar(); fecharModal(); desenharTela(); } throw e; }
  await carregar();
}

async function carregar() {
  D = await api('/api/admin/dados');
  CAT = D.categorias;
  const pend = D.despesas.filter(d => d.status === 'Em análise').length;
  $('nav-pend').textContent = pend;
  $('nav-pend').classList.toggle('hidden', !pend);
}

// Linhas da tabela de lançamentos: prestações do painel + despesas aprovadas do app (somadas por colaborador,
// mês e função: se o colaborador mudou de função no meio do mês, cada parte fica na função em que foi lançada)
function linhas() {
  const zeros = () => Object.fromEntries(CAT.map(c => [c.chave, 0]));
  const rows = D.prestacoes.map(p => ({ ...p, origem: 'painel', valores: Object.fromEntries(CAT.map(c => [c.chave, p[c.chave]])) }));
  const g = new Map();
  for (const d of D.despesas.filter(x => x.status === 'Aprovada')) {
    const mes = d.data.slice(0, 7), k = d.colaboradorId + '|' + mes + '|' + d.funcao;
    let r = g.get(k);
    if (!r) {
      r = { id: 'app|' + k, origem: 'app', colaboradorId: d.colaboradorId, colaborador: d.colaborador, funcao: d.funcao, dataInicial: d.data, dataFinal: d.data, mesRef: mes, valores: zeros(), total: 0, observacao: 'Despesas do app', despesas: [] };
      g.set(k, r);
    }
    if (d.data < r.dataInicial) r.dataInicial = d.data;
    if (d.data >= r.dataFinal) { r.dataFinal = d.data; r.colaborador = d.colaborador; } // nome mais recente
    const ck = (CAT.find(c => c.nome === d.categoria) || CAT[CAT.length - 1]).chave;
    r.valores[ck] = r2(r.valores[ck] + d.valor);
    r.total = r2(r.total + d.valor);
    r.despesas.push(d);
  }
  return [...rows, ...g.values()];
}
const somar = rows => {
  const v = Object.fromEntries(CAT.map(c => [c.chave, 0]));
  let total = 0;
  for (const r of rows) { for (const c of CAT) v[c.chave] = r2(v[c.chave] + (r.valores[c.chave] || 0)); total = r2(total + r.total); }
  return { v, total };
};
function anos(atual) {
  const s = new Set([hoje().slice(0, 4)]);
  if (atual) s.add(String(atual)); // o ano escolhido continua na lista mesmo que fique sem lançamentos
  linhas().forEach(r => s.add(r.mesRef.slice(0, 4)));
  return [...s].sort().reverse();
}
const opt = (v, txt, sel) => `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(txt)}</option>`;
const optsAno = sel => anos(sel).map(a => opt(a, a, sel)).join('');
const optsMes = (sel, todos = true) => (todos ? opt('', 'Todos', sel) : '') + MESES.map((m, i) => opt(String(i + 1).padStart(2, '0'), m, sel)).join('');
// Funções para os filtros: as cadastradas + as que aparecem em lançamentos antigos (função já excluída)
const funcoesFiltro = () => [...new Set([...D.funcoes, ...linhas().map(r => r.funcao).filter(Boolean)])];
const corFuncao = f => CORES_FUNCAO[Math.max(0, D.funcoes.indexOf(f)) % CORES_FUNCAO.length];

// Exportação para Excel (.xlsx): ver public/xlsx.js. A última linha (total) sai em negrito.
const col = (titulo, largura = 14, moeda = false) => ({ titulo, largura, moeda });
const colsCat = () => [...CAT.map(c => col(c.nome, 13, true)), col('Total', 13, true)];
const n2 = v => r2(v || 0);
const mesTxt = ym => ym.slice(5) + '/' + ym.slice(0, 4);
function exportar(nome, aba, colunas, linhas) { baixarXlsx(nome, [{ nome: aba, colunas, linhas, totalNoFim: true }]); }

// ---------- modal ----------
function abrirModal(html, classe = '') { $('modal').innerHTML = `<div class="card modal ${classe}">${html}</div>`; $('modal').classList.remove('hidden'); return $('modal'); }
function fecharModal() { $('modal').classList.add('hidden'); $('modal').innerHTML = ''; }
$('modal').addEventListener('click', e => { if (e.target === $('modal')) fecharModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('modal').classList.contains('hidden')) fecharModal(); });
// Desabilita o botão enquanto a ação roda (evita cadastro duplicado com clique duplo)
async function travando(botao, acao) {
  if (botao.disabled) return;
  botao.disabled = true;
  try { await acao(); } finally { if (botao.isConnected) botao.disabled = false; }
}

// ======================= 01 · LANÇAMENTOS =======================
function telaLancamentos() {
  const f = F.l;
  const busca = semAcento(f.busca);
  const rows = linhas().filter(r => r.mesRef.startsWith(f.ano)
    && (!f.mes || r.mesRef.slice(5) === f.mes)
    && (!f.funcao || r.funcao === f.funcao)
    && (!f.colab || r.colaboradorId === f.colab)
    && (!busca || semAcento(r.colaborador + ' ' + r.observacao).includes(busca)))
    .sort((a, b) => (a.dataInicial + a.colaborador).localeCompare(b.dataInicial + b.colaborador));
  const s = somar(rows);
  const maior = CAT.map(c => ({ ...c, v: s.v[c.chave] })).sort((a, b) => b.v - a.v)[0];
  const nColab = new Set(rows.map(r => r.colaboradorId)).size;
  const periodo = f.mes ? MESES[Number(f.mes) - 1].toLowerCase() : f.ano;
  const pend = D.despesas.filter(d => d.status === 'Em análise').sort((a, b) => a.data.localeCompare(b.data));

  $('page').innerHTML = `
    <div class="page-head">
      <div><h1>Lançamentos</h1><p>Prestações de contas lançadas por colaborador</p></div>
      <div class="acts"><button class="btn secondary" id="l-exp">Exportar Excel</button><a class="btn" href="#nova">+ Nova prestação</a></div>
    </div>
    ${pend.length ? `<div class="card pend"><h3 style="display:flex;justify-content:space-between">Despesas do celular aguardando aprovação (${pend.length})<a class="link" href="#despesas">Ver todas →</a></h3>
      ${pend.map(d => `<div class="pend-row">
        <span><b>${esc(d.colaborador)}</b><br><span class="muted small">${esc(d.funcao)}</span></span>
        <span>${esc(d.categoria)}<br><span class="muted small">${dmy(d.data)}</span></span>
        <span class="num"><b>${brl(d.valor)}</b></span>
        <span class="muted">${esc(d.observacao) || '—'}</span>
        <span class="acts"><button class="btn xs ok" data-ap="${esc(d.id)}">Aprovar</button><button class="btn xs no" data-rc="${esc(d.id)}">Recusar</button></span>
        <span><button class="btn xs" data-nota="${esc(d.id)}" title="${d.foto ? 'Ver a foto da nota e analisar' : 'Esta despesa foi enviada sem foto'}">${d.foto ? '📷 Ver nota' : 'Sem foto'}</button></span></div>`).join('')}
    </div>` : ''}
    <div class="card filters" style="grid-template-columns:110px 150px 1fr 1fr 1.4fr">
      <div class="field"><label>Ano</label><select class="input" id="l-ano">${optsAno(f.ano)}</select></div>
      <div class="field"><label>Mês de referência</label><select class="input" id="l-mes">${optsMes(f.mes)}</select></div>
      <div class="field"><label>Função</label><select class="input" id="l-func">${opt('', 'Todas', f.funcao)}${funcoesFiltro().map(x => opt(x, x, f.funcao)).join('')}</select></div>
      <div class="field"><label>Colaborador</label><select class="input" id="l-colab">${opt('', 'Todos', f.colab)}${D.colaboradores.map(c => opt(c.id, c.nome, f.colab)).join('')}</select></div>
      <div class="field"><label>Buscar</label><input class="input" id="l-busca" placeholder="Nome ou observação" value="${esc(f.busca)}"></div>
    </div>
    <div class="kpis">
      <div class="card kpi"><span class="l">Total ${f.mes ? 'do mês' : 'do ano'}</span><span class="v">${brl(s.total)}</span></div>
      <div class="card kpi"><span class="l">Prestações lançadas</span><span class="v">${rows.filter(r => r.origem === 'painel').length}</span></div>
      <div class="card kpi"><span class="l">Colaboradores</span><span class="v">${nColab}</span></div>
      <div class="card kpi"><span class="l">Maior categoria</span><span class="v sm">${maior && maior.v ? `${esc(maior.nome)} · ${brl(maior.v)}` : '—'}</span></div>
    </div>
    <div class="card table-card"><div class="table-wrap"><table>
      <thead><tr><th>Colaborador</th><th>Função</th><th>Período</th><th>Mês</th>${CAT.map(c => `<th class="num">${esc(c.nome)}</th>`).join('')}<th>Observação</th><th class="num">Total</th></tr></thead>
      <tbody>
        ${rows.map(r => `<tr class="click" data-row="${esc(r.id)}">
          <td class="b">${esc(r.colaborador)}${r.origem === 'app' ? '<span class="tag-app">APP</span>' : ''}${r.fotos ? `<span class="tag-foto" title="${r.fotos} comprovante(s)">📎${r.fotos}</span>` : ''}</td><td>${esc(r.funcao)}</td>
          <td class="num" style="text-align:left">${dm(r.dataInicial)} a ${dmy(r.dataFinal)}</td><td>${r.mesRef.slice(5)}</td>
          ${CAT.map(c => `<td class="num${r.valores[c.chave] ? '' : ' dim'}">${cel(r.valores[c.chave])}</td>`).join('')}
          <td class="obs${r.observacao ? '' : ' dim'}" title="${esc(r.observacao)}">${esc(r.observacao) || '—'}</td>
          <td class="num b">${fmt(r.total)}</td></tr>`).join('')}
        ${rows.length ? `<tr class="total"><td colspan="4">Total ${esc(periodo)}</td>${CAT.map(c => `<td class="num">${cel(s.v[c.chave])}</td>`).join('')}<td></td><td class="num">${fmt(s.total)}</td></tr>`
          : `<tr class="empty-row"><td colspan="${6 + CAT.length}">Nenhuma prestação para esse filtro.</td></tr>`}
      </tbody></table></div></div>
    <p class="muted small" style="margin:0">Clique em uma linha para editar. Linhas com <span class="tag-app" style="margin:0">APP</span> somam as despesas aprovadas que o colaborador lançou pelo celular.</p>`;

  const set = (id, k) => $(id).addEventListener(id === 'l-busca' ? 'input' : 'change', e => { f[k] = e.target.value; telaLancamentos(); if (id === 'l-busca') { const el = $('l-busca'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  set('l-ano', 'ano'); set('l-mes', 'mes'); set('l-func', 'funcao'); set('l-colab', 'colab'); set('l-busca', 'busca');
  document.querySelectorAll('[data-ap],[data-rc]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.ap || b.dataset.rc, acao = b.dataset.ap ? 'aprovar' : 'recusar';
    if (acao === 'recusar' && !(await confirmar('O colaborador verá o status "Recusada".', { titulo: 'Recusar esta despesa?', ok: 'Recusar', perigo: true }))) return;
    b.disabled = true;
    try { await avaliarDespesa(id, acao); telaLancamentos(); } catch (e) { avisar(e.message, 'Não foi possível concluir'); b.disabled = false; }
  }));
  document.querySelectorAll('[data-nota]').forEach(b => b.addEventListener('click', () => modalNota(D.despesas.find(d => d.id === b.dataset.nota))));
  document.querySelectorAll('tr[data-row]').forEach(tr => tr.addEventListener('click', () => {
    const r = rows.find(x => x.id === tr.dataset.row);
    if (r.origem === 'painel') location.hash = '#nova/' + r.id;
    else modalDespesasApp(r);
  }));
  $('l-exp').addEventListener('click', () => exportar(`lancamentos-${f.ano}${f.mes ? '-' + f.mes : ''}`, 'Lançamentos',
    [col('Colaborador', 26), col('Função', 14), col('Data inicial', 12), col('Data final', 12), col('Mês ref.', 10), ...colsCat(), col('Observação', 34), col('Origem', 9)],
    [...rows.map(r => [r.colaborador, r.funcao, dmy(r.dataInicial), dmy(r.dataFinal), mesTxt(r.mesRef), ...CAT.map(c => n2(r.valores[c.chave])), n2(r.total), r.observacao, r.origem === 'app' ? 'App' : 'Painel']),
      ['Total ' + periodo, '', '', '', '', ...CAT.map(c => n2(s.v[c.chave])), n2(s.total), '', '']]));
}

function modalDespesasApp(r) {
  const m = abrirModal(`<h3>${esc(r.colaborador)} · despesas do app</h3>
    <p class="muted small" style="margin:0">${nomeMes(r.mesRef)} · somente despesas aprovadas</p>
    <div class="rows card">${r.despesas.sort((a, b) => a.data.localeCompare(b.data)).map(d => `<div><span>${dmy(d.data)} · ${esc(d.categoria)}${d.observacao ? ' · ' + esc(d.observacao) : ''}${d.foto ? ` <button class="link tag-foto" data-nota="${esc(d.id)}">📷 ver nota</button>` : ''}</span><span>${brl(d.valor)}</span></div>`).join('')}</div>
    <div class="acts"><button class="btn secondary" id="m-fechar">Fechar</button></div>`);
  m.querySelector('#m-fechar').onclick = fecharModal;
  m.querySelectorAll('[data-nota]').forEach(b => b.onclick = () => modalNota(D.despesas.find(d => d.id === b.dataset.nota), () => modalDespesasApp(r)));
}

// Detalhe de um valor dos resumos: o que formou aquele número (despesas aprovadas do celular, uma a uma,
// e prestações do painel com o valor da categoria). chaves = categorias da célula (todas, no Total).
const chaveCat = nome => (CAT.find(c => c.nome === nome) || CAT[CAT.length - 1]).chave; // mesma regra de linhas()
function modalDetalhe(titulo, sub, rows, chaves) {
  const secoes = chaves.map(ch => {
    const cat = CAT.find(c => c.chave === ch);
    const itens = [];
    for (const r of rows) {
      if (r.origem === 'app') {
        for (const d of r.despesas) if (chaveCat(d.categoria) === ch) itens.push({ data: d.data, app: d, valor: d.valor });
      } else if (r.valores[ch]) itens.push({ data: r.dataInicial, prest: r, valor: r.valores[ch] });
    }
    itens.sort((a, b) => a.data.localeCompare(b.data));
    return { cat, itens, total: r2(itens.reduce((s, i) => s + i.valor, 0)) };
  }).filter(s => s.itens.length);
  const total = r2(secoes.reduce((s, x) => s + x.total, 0));
  const linha = i => i.app
    ? `<div><span>${dmy(i.data)} · ${esc(i.app.observacao || i.app.categoria)}${i.app.foto ? ` <button class="link tag-foto" data-nota="${esc(i.app.id)}">📷 ver nota</button>` : ''}<br><span class="muted small">Despesa do celular</span></span><span>${brl(i.valor)}</span></div>`
    : `<div><span>${dm(i.prest.dataInicial)}${i.prest.dataInicial.slice(0, 4) !== i.prest.dataFinal.slice(0, 4) ? '/' + i.prest.dataInicial.slice(0, 4) : ''} a ${dmy(i.prest.dataFinal)}${i.prest.observacao ? ' · ' + esc(i.prest.observacao) : ''}${i.prest.fotos ? ` <span class="tag-foto">📎${i.prest.fotos}</span>` : ''} <button class="link tag-foto" data-prest="${esc(i.prest.id)}">abrir</button><br><span class="muted small">Prestação do painel · mês ref. ${nomeMes(i.prest.mesRef)}</span></span><span>${brl(i.valor)}</span></div>`;
  const reabrir = () => modalDetalhe(titulo, sub, rows, chaves);
  const m = abrirModal(`<h3>${esc(titulo)}</h3>
    <p class="muted small" style="margin:0">${esc(sub)} · somente despesas aprovadas · total <b>${brl(total)}</b></p>
    ${secoes.map(s => `${secoes.length > 1 || chaves.length > 1 ? `<div class="det-cat"><b>${esc(s.cat.nome)}</b><span>${brl(s.total)}</span></div>` : ''}
      <div class="rows card">${s.itens.map(linha).join('')}</div>`).join('') || '<p class="muted">Nenhum lançamento.</p>'}
    <div class="acts"><button class="btn secondary" id="m-fechar">Fechar</button></div>`);
  m.querySelector('#m-fechar').onclick = fecharModal;
  m.querySelectorAll('[data-nota]').forEach(b => b.onclick = () => modalNota(D.despesas.find(d => d.id === b.dataset.nota), reabrir));
  m.querySelectorAll('[data-prest]').forEach(b => b.onclick = () => { fecharModal(); location.hash = '#nova/' + b.dataset.prest; });
}
// Célula clicável dos resumos (só quando tem valor)
const celClick = (v, attrs, extra = '') => `<td class="num${extra}${v ? ' cel-click' : ' dim'}"${v ? ` ${attrs} title="Ver o que formou este valor"` : ''}>${cel(v)}</td>`;
// Liga o clique das células: filtro(td) devolve as linhas que formam aquele valor
function ligarCelulas(filtro, titulo, subtitulo) {
  document.querySelectorAll('.cel-click').forEach(td => td.addEventListener('click', () => {
    document.querySelectorAll('.cel-click.sel').forEach(x => x.classList.remove('sel'));
    td.classList.add('sel'); // fica marcado: mostra qual valor foi aberto
    const total = td.dataset.c === 'total';
    const chaves = total ? CAT.map(c => c.chave) : [td.dataset.c];
    const nomeCat = total ? 'Todas as categorias' : CAT.find(c => c.chave === td.dataset.c).nome;
    modalDetalhe(`${titulo(td)} · ${nomeCat}`, subtitulo(td), filtro(td), chaves);
  }));
}

// Analisar uma despesa do celular: foto da nota (clique para ampliar) ao lado dos dados, com Aprovar/Recusar
function modalNota(d, voltar) {
  if (!d) return;
  const quando = iso => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '—');
  const url = '/api/admin/despesas/' + encodeURIComponent(d.id) + '/foto' + (d.fotoV ? '?v=' + d.fotoV : ''); // ?v muda quando a foto é trocada
  const emAnalise = d.status === 'Em análise';
  const m = abrirModal(`<h3>Analisar despesa · ${esc(d.colaborador)}</h3>
    <div class="nota-grid">
      <div class="nota-img" id="m-img">${d.foto ? `<img src="${url}" alt="Foto da nota" title="Clique para ampliar">` : '<span class="sem">Despesa enviada sem foto da nota.</span>'}</div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="rows card">
          <div><span>Colaborador</span><span>${esc(d.colaborador)}</span></div>
          <div><span>Função</span><span>${esc(d.funcao)}</span></div>
          <div><span>Categoria</span><span>${esc(d.categoria)}</span></div>
          <div><span>Valor</span><span>${brl(d.valor)}</span></div>
          <div><span>Data da nota</span><span>${dmy(d.data)}</span></div>
          <div><span>Observação</span><span>${esc(d.observacao) || '—'}</span></div>
          <div><span>Enviada em</span><span>${quando(d.criadoEm)}</span></div>
          <div><span>Status</span><span>${esc(d.status)}${d.avaliadoEm ? ` · ${quando(d.avaliadoEm)}` : ''}</span></div>
        </div>
        ${d.foto ? `<a class="link small" href="${url}" target="_blank" rel="noopener">Abrir a foto em nova aba ↗</a>` : ''}
        <span class="muted small">Confira se o valor e a data batem com a nota.</span>
        ${emAnalise ? '<div class="acts" style="justify-content:stretch"><button class="btn ok grow" id="m-ap">Aprovar</button><button class="btn danger grow" id="m-rc">Recusar</button></div>'
          : `<button class="btn secondary" id="m-desfazer">↩ Desfazer ${d.status === 'Aprovada' ? 'aprovação' : 'recusa'}</button>`}
        <button class="btn secondary" id="m-fechar">${voltar ? 'Voltar' : 'Fechar'}</button>
      </div>
    </div>`, 'modal-nota');
  const img = m.querySelector('#m-img img');
  if (img) {
    img.onclick = () => m.querySelector('#m-img').classList.toggle('zoom');
    img.onerror = () => { m.querySelector('#m-img').innerHTML = '<span class="sem">Não foi possível carregar a foto. Tente de novo em instantes.</span>'; };
  }
  m.querySelector('#m-fechar').onclick = () => (voltar ? voltar() : fecharModal());
  const decidir = acao => async e => {
    const botao = e.currentTarget; // guardado antes do await (depois dele o evento já não aponta para o botão)
    if (acao === 'recusar' && !(await confirmar('O colaborador verá o status "Recusada".', { titulo: 'Recusar esta despesa?', ok: 'Recusar', perigo: true }))) return;
    if (acao === 'reabrir' && !(await confirmarDesfazer(d))) return;
    botao.disabled = true;
    try { await avaliarDespesa(d.id, acao); fecharModal(); desenharTela(); }
    catch (err) { avisar(err.message, 'Não foi possível concluir'); botao.disabled = false; }
  };
  if (emAnalise) { m.querySelector('#m-ap').onclick = decidir('aprovar'); m.querySelector('#m-rc').onclick = decidir('recusar'); }
  else m.querySelector('#m-desfazer').onclick = decidir('reabrir');
}
// Visualizador de fotos (comprovantes da prestação): foto grande, clique amplia, setas para navegar
function verFotos(lista, inicio = 0) {
  let i = inicio;
  const m = abrirModal(`<h3 id="vf-titulo"></h3>
    <div class="nota-img" id="vf-img"></div>
    <div class="acts" style="justify-content:space-between">
      <span><button class="btn secondary" id="vf-ant">← Anterior</button> <button class="btn secondary" id="vf-prox">Próxima →</button></span>
      <span><a class="btn secondary" id="vf-abrir" target="_blank" rel="noopener">Abrir em nova aba ↗</a> <button class="btn" id="vf-fechar">Fechar</button></span>
    </div>`, 'modal-nota');
  const mostra = () => {
    m.querySelector('#vf-titulo').textContent = `Comprovante ${i + 1} de ${lista.length}`;
    const caixa = m.querySelector('#vf-img');
    caixa.classList.remove('zoom');
    caixa.innerHTML = `<img src="${lista[i]}" alt="Comprovante ${i + 1}" title="Clique para ampliar">`;
    caixa.querySelector('img').onclick = () => caixa.classList.toggle('zoom');
    caixa.querySelector('img').onerror = () => { caixa.innerHTML = '<span class="sem">Não foi possível carregar a foto.</span>'; };
    const aba = m.querySelector('#vf-abrir');
    aba.classList.toggle('hidden', lista[i].startsWith('data:')); // foto ainda não enviada: sem link
    aba.href = lista[i];
    m.querySelector('#vf-ant').disabled = i === 0;
    m.querySelector('#vf-prox').disabled = i === lista.length - 1;
  };
  m.querySelector('#vf-ant').onclick = () => { i--; mostra(); };
  m.querySelector('#vf-prox').onclick = () => { i++; mostra(); };
  m.querySelector('#vf-fechar').onclick = fecharModal;
  mostra();
}

// Desfazer = a despesa volta para "Em análise" (sai dos totais, se estava aprovada)
const confirmarDesfazer = d => confirmar(
  d.status === 'Aprovada'
    ? `A despesa de ${d.colaborador} (${brl(d.valor)}) volta para "Em análise" e sai dos totais até ser aprovada de novo.`
    : `A despesa de ${d.colaborador} (${brl(d.valor)}) volta para "Em análise" e pode ser aprovada.`,
  { titulo: d.status === 'Aprovada' ? 'Desfazer a aprovação?' : 'Desfazer a recusa?', ok: 'Desfazer' });

// ======================= DESPESAS DO CELULAR =======================
// Todas as despesas enviadas pelo app, com filtro por status (inclui as recusadas, que não aparecem nos Lançamentos)
const STATUS_COR = { 'Em análise': 'b-amber', Aprovada: 'b-green', Recusada: 'b-red' };
function telaDespesas() {
  const f = F.d;
  const busca = semAcento(f.busca);
  const anosD = [...new Set([hoje().slice(0, 4), ...D.despesas.map(d => d.data.slice(0, 4))])].sort().reverse();
  const doPeriodo = D.despesas.filter(d => d.data.startsWith(f.ano) && (!f.mes || d.data.slice(5, 7) === f.mes)
    && (!f.colab || d.colaboradorId === f.colab) && (!busca || semAcento(d.colaborador + ' ' + d.observacao + ' ' + d.categoria).includes(busca)));
  const rows = doPeriodo.filter(d => !f.status || d.status === f.status)
    .sort((a, b) => (b.data + b.criadoEm).localeCompare(a.data + a.criadoEm));
  const conta = st => doPeriodo.filter(d => d.status === st);
  const soma = l => r2(l.reduce((s, d) => s + d.valor, 0));
  const quando = iso => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');
  const chip = (st, rot) => `<button class="chip sm${f.status === st ? ' on' : ''}" data-st="${esc(st)}">${esc(rot)}</button>`;

  $('page').innerHTML = `
    <div class="page-head">
      <div><h1>Despesas do celular</h1><p>Tudo o que os colaboradores enviaram pelo app, inclusive as recusadas</p></div>
      <div class="acts"><button class="btn secondary" id="d-exp">Exportar Excel</button></div>
    </div>
    <div class="card filters" style="grid-template-columns:110px 150px 1fr 1.4fr">
      <div class="field"><label>Ano</label><select class="input" id="d-ano">${anosD.map(a => opt(a, a, f.ano)).join('')}</select></div>
      <div class="field"><label>Mês da nota</label><select class="input" id="d-mes">${optsMes(f.mes)}</select></div>
      <div class="field"><label>Colaborador</label><select class="input" id="d-colab">${opt('', 'Todos', f.colab)}${D.colaboradores.map(c => opt(c.id, c.nome, f.colab)).join('')}</select></div>
      <div class="field"><label>Buscar</label><input class="input" id="d-busca" placeholder="Nome, categoria ou observação" value="${esc(f.busca)}"></div>
      <div class="chips" style="grid-column:1/-1"><span class="muted small">Status:</span>
        ${chip('', `Todas (${doPeriodo.length})`)}${chip('Em análise', `Em análise (${conta('Em análise').length})`)}${chip('Aprovada', `Aprovadas (${conta('Aprovada').length})`)}${chip('Recusada', `Recusadas (${conta('Recusada').length})`)}</div>
    </div>
    <div class="kpis">
      <div class="card kpi"><span class="l">Total (filtro atual)</span><span class="v">${brl(soma(rows))}</span><span class="d">${rows.length} despesa${rows.length === 1 ? '' : 's'}</span></div>
      <div class="card kpi"><span class="l">Em análise</span><span class="v">${brl(soma(conta('Em análise')))}</span><span class="d">${conta('Em análise').length} aguardando</span></div>
      <div class="card kpi"><span class="l">Aprovadas</span><span class="v">${brl(soma(conta('Aprovada')))}</span><span class="d">${conta('Aprovada').length} no período</span></div>
      <div class="card kpi"><span class="l">Recusadas</span><span class="v">${brl(soma(conta('Recusada')))}</span><span class="d">${conta('Recusada').length} no período</span></div>
    </div>
    <div class="card table-card"><div class="table-wrap"><table>
      <thead><tr><th>Data</th><th>Colaborador</th><th>Categoria</th><th class="num">Valor</th><th>Observação</th><th>Status</th><th>Nota</th><th>Ações</th></tr></thead>
      <tbody>${rows.map(d => `<tr class="click" data-desp="${esc(d.id)}">
        <td>${dmy(d.data)}</td>
        <td class="b">${esc(d.colaborador)}<br><span class="muted small" style="font-weight:400">${esc(d.funcao)}</span></td>
        <td>${esc(d.categoria)}</td><td class="num b">${fmt(d.valor)}</td>
        <td class="muted">${esc(d.observacao) || '—'}</td>
        <td><span class="badge ${STATUS_COR[d.status] || 'b-gray'}">${esc(d.status)}</span>${d.avaliadoEm ? `<br><span class="muted small">${quando(d.avaliadoEm)}</span>` : ''}</td>
        <td>${d.foto ? '📷' : '<span class="muted small">—</span>'}</td>
        <td><span class="chips">${d.status === 'Em análise'
          ? `<button class="btn xs ok" data-dap="${esc(d.id)}">Aprovar</button><button class="btn xs no" data-drc="${esc(d.id)}">Recusar</button>`
          : `<button class="btn xs" data-dre="${esc(d.id)}">↩ Desfazer</button>`}</span></td></tr>`).join('')
        || `<tr class="empty-row"><td colspan="8">Nenhuma despesa para esse filtro.</td></tr>`}</tbody>
    </table></div></div>
    <p class="muted small" style="margin:0">Clique em uma linha para ver a nota e os detalhes. "Desfazer" volta a despesa para "Em análise".</p>`;

  const set = (id, k, ev = 'change') => $(id).addEventListener(ev, e => {
    f[k] = e.target.value; telaDespesas();
    if (ev === 'input') { const el = $(id); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  });
  set('d-ano', 'ano'); set('d-mes', 'mes'); set('d-colab', 'colab'); set('d-busca', 'busca', 'input');
  document.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { f.status = b.dataset.st; telaDespesas(); });
  const acha = id => D.despesas.find(d => d.id === id);
  const agir = (attr, acao) => document.querySelectorAll(`[${attr}]`).forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation(); // não abre a janela da linha
    const d = acha(b.getAttribute(attr));
    if (acao === 'recusar' && !(await confirmar('O colaborador verá o status "Recusada".', { titulo: 'Recusar esta despesa?', ok: 'Recusar', perigo: true }))) return;
    if (acao === 'reabrir' && !(await confirmarDesfazer(d))) return;
    b.disabled = true;
    try { await avaliarDespesa(d.id, acao); telaDespesas(); }
    catch (err) { avisar(err.message, 'Não foi possível concluir'); b.disabled = false; }
  }));
  agir('data-dap', 'aprovar'); agir('data-drc', 'recusar'); agir('data-dre', 'reabrir');
  document.querySelectorAll('tr[data-desp]').forEach(tr => tr.addEventListener('click', () => modalNota(acha(tr.dataset.desp))));
  $('d-exp').addEventListener('click', () => exportar(`despesas-celular-${f.ano}${f.mes ? '-' + f.mes : ''}${f.status ? '-' + semAcento(f.status).replace(/\W+/g, '-') : ''}`, 'Despesas do celular',
    [col('Data', 12), col('Colaborador', 26), col('Função', 14), col('Categoria', 14), col('Valor', 12, true), col('Observação', 34), col('Status', 12), col('Avaliada em', 14), col('Foto', 7)],
    [...rows.map(d => [dmy(d.data), d.colaborador, d.funcao, d.categoria, n2(d.valor), d.observacao, d.status, quando(d.avaliadoEm), d.foto ? 'Sim' : 'Não']),
      ['Total', '', '', '', soma(rows), '', '', '', '']]));
}

// ======================= 02 · NOVA PRESTAÇÃO =======================
function mascaraDinheiro(input, onChange) {
  // O valor é digitado como numa calculadora (centavos primeiro): cada dígito entra no fim
  // e "apagar" tira o último dígito, não importa onde esteja o cursor.
  const pinta = () => { const c = Number(input.dataset.c || 0); input.value = 'R$ ' + fmt(c / 100); };
  const fim = () => setTimeout(() => input.setSelectionRange(input.value.length, input.value.length));
  const muda = c => { input.dataset.c = String(c); pinta(); fim(); onChange && onChange(); };
  input.addEventListener('beforeinput', e => {
    const c = Number(input.dataset.c || 0);
    const tudo = input.selectionStart === 0 && input.selectionEnd === input.value.length;
    if (e.inputType === 'insertText') {
      e.preventDefault();
      const d = String(e.data || '').replace(/\D/g, '');
      if (d) muda(Number(((tudo ? '' : String(c)) + d).slice(-9)));
    } else if (e.inputType.startsWith('delete')) {
      e.preventDefault();
      muda(tudo ? 0 : Math.floor(c / 10));
    }
  });
  // Colar e outros casos: usa todos os dígitos do campo
  input.addEventListener('input', () => muda(Number(input.value.replace(/\D/g, '').slice(-9) || 0)));
  input.addEventListener('focus', fim);
  input.addEventListener('click', fim);
  pinta();
}
function mesesEntre(a, b) {
  if (!a) return [];
  const out = [];
  let y = Number(a.slice(0, 4)), m = Number(a.slice(5, 7));
  const fim = b && b >= a ? b.slice(0, 7) : a.slice(0, 7);
  while (out.length < 120) { // limite só de segurança; o servidor aceita qualquer mês do período
    const ym = y + '-' + String(m).padStart(2, '0');
    out.push(ym);
    if (ym >= fim) break;
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

function telaNova(id) {
  const p = id ? D.prestacoes.find(x => x.id === id) : null;
  if (id && !p) { location.hash = '#lancamentos'; return; }
  const colabs = D.colaboradores.filter(c => c.ativo || (p && c.id === p.colaboradorId));
  $('page').innerHTML = `
    <div class="page-head"><div><a class="back" href="#lancamentos">← Lançamentos</a><h1>${p ? 'Editar prestação de contas' : 'Nova prestação de contas'}</h1><p>Lance os gastos de um colaborador em um período</p></div></div>
    <div class="form-grid">
      <form class="card form-card" id="n-form" autocomplete="off">
        <div class="sec"><h3>1. Colaborador e período</h3>
          <div class="row2">
            <div class="field"><label>Colaborador</label><select class="input" id="n-colab">${opt('', 'Selecione', '')}${colabs.map(c => opt(c.id, c.nome, p ? p.colaboradorId : '')).join('')}</select></div>
            <div class="field"><label>Função</label><input class="input" id="n-funcao" readonly placeholder="Automático"></div>
          </div>
          <div class="row3">
            <div class="field"><label>Data inicial</label><input class="input" type="date" id="n-ini" min="2000-01-01" max="${Number(hoje().slice(0, 4)) + 1}-12-31" value="${p ? p.dataInicial : ''}"></div>
            <div class="field"><label>Data final</label><input class="input" type="date" id="n-fim" min="2000-01-01" max="${Number(hoje().slice(0, 4)) + 1}-12-31" value="${p ? p.dataFinal : ''}"></div>
            <div class="field"><label>Mês de referência</label><select class="input" id="n-mes"></select></div>
          </div>
          <span class="muted small">A regra do mês de referência (quando o período passa de um mês para outro) ainda será definida com o Maurício. Por padrão, fica o mês da data inicial.</span>
        </div>
        <div class="sec"><h3>2. Valores por categoria (R$)</h3>
          <div class="row3">${CAT.map(c => `<div class="field"><label>${esc(c.nome)}</label><input class="input" inputmode="numeric" data-cat="${c.chave}" data-c="${p ? Math.round(p[c.chave] * 100) : 0}"></div>`).join('')}</div>
          <div class="field"><label>Observação</label><textarea class="input" id="n-obs" maxlength="300" placeholder="Ex.: Veículo / lavação">${p ? esc(p.observacao) : ''}</textarea></div>
        </div>
        <div class="sec"><h3>3. Comprovantes (opcional)</h3>
          ${D.fotos ? `<div class="comprovantes" id="n-fotos"></div>
          <div class="acts" style="display:flex;gap:10px;align-items:center"><button type="button" class="btn secondary" id="n-add-foto">📎 Anexar fotos das notas</button>
            <span class="muted small">JPG ou PNG · até 10 fotos · as fotos novas são enviadas ao salvar</span></div>`
          : '<div class="dropzone">Envio de fotos indisponível no momento.</div>'}
        </div>
      </form>
      <div class="card total-card">
        <span class="muted small">Total da prestação</span>
        <span class="big" id="n-total">R$ 0,00</span>
        <div class="lines" id="n-lines"></div>
        <div id="n-erro" class="alert hidden"></div>
        <button class="btn lg block" id="n-salvar">Salvar prestação</button>
        <a class="btn secondary block" href="#lancamentos">Cancelar</a>
        ${p ? '<button class="btn danger block" id="n-excluir">Excluir prestação</button>' : ''}
        <span class="muted small">O total é calculado automaticamente.</span>
      </div>
    </div>`;

  const total = () => {
    let t = 0;
    $('n-lines').innerHTML = CAT.map(c => {
      const v = Number(document.querySelector(`[data-cat="${c.chave}"]`).dataset.c || 0) / 100;
      t += v;
      return `<div><span>${esc(c.nome)}</span><span>${cel(v)}</span></div>`;
    }).join('');
    $('n-total').textContent = brl(t);
  };
  document.querySelectorAll('[data-cat]').forEach(i => mascaraDinheiro(i, total));
  total();
  // Na edição, mostra a função gravada na prestação (a do momento em que foi feita), não a atual do colaborador
  const funcao = () => { const c = D.colaboradores.find(x => x.id === $('n-colab').value); $('n-funcao').value = p && c && c.id === p.colaboradorId ? p.funcao : c ? c.funcao : ''; };
  $('n-colab').addEventListener('change', funcao); funcao();
  const meses = manter => {
    const atual = manter || $('n-mes').value;
    const lista = mesesEntre($('n-ini').value, $('n-fim').value);
    if (manter && !lista.includes(manter)) lista.unshift(manter);
    $('n-mes').innerHTML = lista.length ? lista.map(ym => opt(ym, nomeMes(ym), lista.includes(atual) ? atual : lista[0])).join('') : opt('', 'Escolha as datas', '');
  };
  $('n-ini').addEventListener('change', () => { if (!$('n-fim').value || $('n-fim').value < $('n-ini').value) $('n-fim').value = $('n-ini').value; meses(); });
  $('n-fim').addEventListener('change', () => meses());
  meses(p ? p.mesRef : '');

  // ---- comprovantes: fotos já salvas (no servidor) + fotos novas (enviadas ao salvar) ----
  let salvas = p ? p.fotos || 0 : 0, versao = Date.now();
  const novas = [];
  const urlSalva = i => `/api/admin/prestacoes/${encodeURIComponent(p.id)}/fotos/${i}?v=${versao}`;
  const todasFotos = () => [...Array.from({ length: salvas }, (_, i) => urlSalva(i)), ...novas];
  const desenhaFotos = () => {
    if (!$('n-fotos')) return;
    $('n-fotos').innerHTML = todasFotos().map((src, i) => `<div class="thumb">
      <img src="${src}" alt="Comprovante ${i + 1}" data-ver="${i}">
      ${i >= salvas ? '<span class="thumb-nova">nova</span>' : ''}
      <button type="button" class="x" data-rm="${i}" title="Remover" aria-label="Remover foto ${i + 1}">×</button></div>`).join('')
      || '<span class="muted small">Nenhuma foto anexada.</span>';
    $('n-fotos').querySelectorAll('[data-ver]').forEach(im => im.onclick = () => verFotos(todasFotos(), Number(im.dataset.ver)));
    $('n-fotos').querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
      const i = Number(b.dataset.rm);
      if (i >= salvas) { novas.splice(i - salvas, 1); return desenhaFotos(); }
      if (!(await confirmar('A foto sai desta prestação e é apagada.', { titulo: 'Remover comprovante?', ok: 'Remover', perigo: true }))) return;
      try {
        const r = await api(`/api/admin/prestacoes/${encodeURIComponent(p.id)}/fotos/${i}`, { method: 'DELETE' });
        salvas = r.fotos; versao = Date.now(); desenhaFotos();
      } catch (e) { avisar(e.message, 'Não foi possível remover'); }
    });
  };
  if ($('n-add-foto')) $('n-add-foto').onclick = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
    inp.onchange = async () => {
      const arquivos = [...(inp.files || [])];
      const vagas = 10 - salvas - novas.length;
      if (arquivos.length > vagas) avisar(`Cada prestação aceita até 10 fotos. ${vagas > 0 ? `Só ${vagas} foram adicionadas.` : 'Remova alguma antes de anexar outra.'}`, 'Limite de fotos');
      for (const arq of arquivos.slice(0, Math.max(0, vagas))) {
        try { novas.push(await comprimirFoto(arq)); } catch (e) { avisar(`${arq.name}: ${e.message}`, 'Foto não adicionada'); }
      }
      desenhaFotos();
    };
    inp.click();
  };
  desenhaFotos();

  $('n-salvar').addEventListener('click', async () => {
    const corpo = { colaboradorId: $('n-colab').value, dataInicial: $('n-ini').value, dataFinal: $('n-fim').value, mesRef: $('n-mes').value, observacao: $('n-obs').value };
    CAT.forEach(c => { corpo[c.chave] = Number(document.querySelector(`[data-cat="${c.chave}"]`).dataset.c || 0) / 100; });
    $('n-erro').classList.add('hidden');
    $('n-salvar').disabled = true;
    try {
      const r = p ? await post('/api/admin/prestacoes/' + encodeURIComponent(p.id), corpo, 'PUT') : await post('/api/admin/prestacoes', corpo);
      // envia as fotos novas, uma de cada vez; se alguma falhar, a prestação já está salva e dá para anexar de novo
      const falhas = [];
      for (let i = 0; i < novas.length; i++) {
        $('n-salvar').textContent = `Enviando foto ${i + 1} de ${novas.length}...`;
        try { await post(`/api/admin/prestacoes/${encodeURIComponent(r.id)}/fotos`, { foto: novas[i] }); }
        catch (e) { falhas.push(e.message); }
      }
      await carregar();
      if (falhas.length) await avisar(`A prestação foi salva, mas ${falhas.length} foto(s) não foram enviadas (${falhas[0]}). Abra a prestação e anexe de novo.`, 'Fotos não enviadas');
      Object.assign(F.l, { ano: r.mesRef.slice(0, 4), mes: r.mesRef.slice(5), colab: '', funcao: '', busca: '' });
      location.hash = '#lancamentos';
    } catch (e) { $('n-erro').textContent = e.message; $('n-erro').classList.remove('hidden'); $('n-salvar').disabled = false; $('n-salvar').textContent = 'Salvar prestação'; }
  });
  if (p) $('n-excluir').addEventListener('click', async () => {
    if (!(await confirmar(`Prestação de ${p.colaborador}, de ${dmy(p.dataInicial)} a ${dmy(p.dataFinal)}. Isso não pode ser desfeito.`, { titulo: 'Excluir esta prestação?', ok: 'Excluir', perigo: true }))) return;
    try { await api('/api/admin/prestacoes/' + encodeURIComponent(p.id), { method: 'DELETE' }); await carregar(); location.hash = '#lancamentos'; } catch (e) { avisar(e.message, 'Não foi possível excluir'); }
  });
}

// ======================= 03 · RESUMO POR COLABORADOR =======================
function telaColaborador() {
  const f = F.c;
  const todas = linhas();
  if (!f.colab || !D.colaboradores.some(c => c.id === f.colab)) {
    const comDados = D.colaboradores.find(c => todas.some(r => r.colaboradorId === c.id));
    f.colab = (comDados || D.colaboradores[0] || {}).id || '';
  }
  const rows = todas.filter(r => r.colaboradorId === f.colab && r.mesRef.startsWith(f.ano));
  const porMes = MESES.map((_, i) => somar(rows.filter(r => Number(r.mesRef.slice(5)) === i + 1)));
  const s = somar(rows);
  const comGasto = porMes.filter(m => m.total > 0);
  const maxI = porMes.reduce((best, m, i) => (m.total > porMes[best].total ? i : best), 0);
  const max = Math.max(...porMes.map(m => m.total), 1);
  const colab = D.colaboradores.find(c => c.id === f.colab);

  $('page').innerHTML = `
    <div class="page-head"><div><h1>Resumo por colaborador</h1><p>Gastos do ano por mês e categoria (igual à planilha "Resumo prestação de contas")</p></div>
      <div class="acts"><button class="btn secondary" id="c-exp">Exportar Excel</button></div></div>
    <div class="kpis" style="grid-template-columns:1.6fr 1fr 1fr 1fr">
      <div class="card filters" style="grid-template-columns:1fr 100px;padding:12px 14px">
        <div class="field"><label>Colaborador</label><select class="input" id="c-colab">${D.colaboradores.map(c => opt(c.id, c.nome, f.colab)).join('') || opt('', 'Nenhum cadastrado', '')}</select></div>
        <div class="field"><label>Ano</label><select class="input" id="c-ano">${optsAno(f.ano)}</select></div>
      </div>
      <div class="card kpi"><span class="l">Total no ano</span><span class="v">${brl(s.total)}</span></div>
      <div class="card kpi"><span class="l">Média nos meses com gasto</span><span class="v">${brl(comGasto.length ? s.total / comGasto.length : 0)}</span></div>
      <div class="card kpi"><span class="l">Mês com maior gasto</span><span class="v sm">${s.total ? `${MESES[maxI]} · ${brl(porMes[maxI].total)}` : '—'}</span></div>
    </div>
    <div class="card chart-card"><h3>Gastos por mês</h3>
      <div class="bars">${porMes.map((m, i) => `<div class="col">${m.total ? `<span class="val">${fmt(m.total)}</span>` : ''}<div class="bar${m.total ? '' : ' zero'}" style="height:${m.total ? Math.max(3, m.total / max * 120) : 2}px"></div><span class="lab">${MES_CURTO[i]}</span></div>`).join('')}</div>
    </div>
    <div class="card table-card"><div class="table-wrap"><table>
      <thead><tr><th>Mês</th>${CAT.map(c => `<th class="num">${esc(c.nome)}</th>`).join('')}<th class="num">Total</th></tr></thead>
      <tbody>${porMes.map((m, i) => `<tr><td class="b">${MESES[i]}</td>${CAT.map(c => celClick(m.v[c.chave], `data-m="${i + 1}" data-c="${c.chave}"`)).join('')}${celClick(m.total, `data-m="${i + 1}" data-c="total"`, ' b')}</tr>`).join('')}
        <tr class="total"><td>Total ${esc(f.ano)}</td>${CAT.map(c => celClick(s.v[c.chave], `data-m="ano" data-c="${c.chave}"`)).join('')}${celClick(s.total, 'data-m="ano" data-c="total"')}</tr></tbody>
    </table></div></div>`;

  // Clique num valor da tabela: abre as despesas e prestações que formam aquele número
  const doMes = td => (td.dataset.m === 'ano' ? rows : rows.filter(r => Number(r.mesRef.slice(5)) === Number(td.dataset.m)));
  ligarCelulas(doMes, () => (colab ? colab.nome : ''), td => (td.dataset.m === 'ano' ? `Ano ${f.ano}` : `${MESES[Number(td.dataset.m) - 1]}/${f.ano}`));
  $('c-colab').addEventListener('change', e => { f.colab = e.target.value; telaColaborador(); });
  $('c-ano').addEventListener('change', e => { f.ano = e.target.value; telaColaborador(); });
  $('c-exp').addEventListener('click', () => exportar(`resumo-${semAcento(colab ? colab.nome : 'colaborador').replace(/\W+/g, '-')}-${f.ano}`, colab ? colab.nome : 'Resumo',
    [col('Mês', 14), ...colsCat()],
    [...porMes.map((m, i) => [MESES[i], ...CAT.map(c => n2(m.v[c.chave])), n2(m.total)]), ['Total ' + f.ano, ...CAT.map(c => n2(s.v[c.chave])), n2(s.total)]]));
}

// ======================= 04 · RESUMO POR FUNÇÃO =======================
function telaFuncao() {
  const f = F.f;
  const base = linhas().filter(r => r.mesRef.startsWith(f.ano) && (!f.mes || r.mesRef.slice(5) === f.mes));
  const rows = base.filter(r => !f.funcao || r.funcao === f.funcao);
  const s = somar(rows);
  const funcoes = [...new Set(rows.map(r => r.funcao))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const cards = funcoes.map(fn => {
    const rr = rows.filter(r => r.funcao === fn);
    return { fn, total: somar(rr).total, n: new Set(rr.map(r => r.colaboradorId)).size };
  }).sort((a, b) => b.total - a.total);
  const dist = CAT.map((c, i) => ({ ...c, v: s.v[c.chave], cor: CORES_CAT[i] })).sort((a, b) => b.v - a.v);
  const maxD = Math.max(...dist.map(d => d.v), 1);
  // Uma linha por colaborador e função (quem mudou de função aparece em cada uma, com o valor de cada)
  const porColab = [...new Set(rows.map(r => r.colaboradorId + '|' + r.funcao))].map(k => {
    const rr = rows.filter(r => r.colaboradorId + '|' + r.funcao === k);
    return { k, nome: rr[0].colaborador, funcao: rr[0].funcao, ...somar(rr) };
  }).sort((a, b) => b.total - a.total);
  const periodo = f.mes ? MESES[Number(f.mes) - 1].toLowerCase() : f.ano;

  $('page').innerHTML = `
    <div class="page-head"><div><h1>Resumo por função</h1><p>Compare os gastos entre funções e entre colaboradores da mesma função</p></div>
      <div class="acts"><button class="btn secondary" id="f-exp">Exportar Excel</button></div></div>
    <div class="card filters" style="grid-template-columns:110px 160px 200px">
      <div class="field"><label>Ano</label><select class="input" id="f-ano">${optsAno(f.ano)}</select></div>
      <div class="field"><label>Mês de referência</label><select class="input" id="f-mes">${optsMes(f.mes)}</select></div>
      <div class="field"><label>Função</label><select class="input" id="f-func">${opt('', 'Todas', f.funcao)}${funcoesFiltro().map(x => opt(x, x, f.funcao)).join('')}</select></div>
    </div>
    <div class="func-grid">
      ${cards.map(c => `<div class="card func-card"><span class="muted small">${esc(c.fn)}</span><span class="v">${brl(c.total)}</span>
        <span class="muted small">${c.n} colaborador${c.n === 1 ? '' : 'es'} · ${s.total ? (c.total / s.total * 100).toFixed(1).replace('.', ',') : '0'}% do ${f.mes ? 'mês' : 'ano'}</span></div>`).join('')
        || '<div class="card func-card"><span class="muted">Sem gastos nesse período.</span></div>'}
      <div class="card dist"><h3>Distribuição por categoria · ${esc(periodo)}</h3>
        ${dist.map(d => `<div class="r"><span>${esc(d.nome)}</span><div class="track"><i style="width:${d.v / maxD * 100}%;background:${d.cor}"></i></div><span class="num">${d.v ? brl(d.v) : '—'}</span></div>`).join('')}
      </div>
    </div>
    <div class="card table-card"><div class="table-wrap"><table>
      <thead><tr><th>Colaborador</th><th>Função</th>${CAT.map(c => `<th class="num">${esc(c.nome)}</th>`).join('')}<th class="num">Total</th></tr></thead>
      <tbody>${porColab.map((r, i) => `<tr><td class="b">${esc(r.nome)}</td><td>${esc(r.funcao)}</td>${CAT.map(c => celClick(r.v[c.chave], `data-l="${i}" data-c="${c.chave}"`)).join('')}${celClick(r.total, `data-l="${i}" data-c="total"`, ' b')}</tr>`).join('')}
        ${porColab.length ? `<tr class="total"><td colspan="2">Total ${esc(periodo)}</td>${CAT.map(c => celClick(s.v[c.chave], `data-l="todos" data-c="${c.chave}"`)).join('')}${celClick(s.total, 'data-l="todos" data-c="total"')}</tr>`
          : `<tr class="empty-row"><td colspan="${3 + CAT.length}">Nenhum lançamento nesse período.</td></tr>`}</tbody>
    </table></div></div>`;

  // Clique num valor: abre as despesas e prestações daquele colaborador (e função) no período filtrado
  const daLinha = td => (td.dataset.l === 'todos' ? rows : rows.filter(r => r.colaboradorId + '|' + r.funcao === porColab[Number(td.dataset.l)].k));
  ligarCelulas(daLinha,
    td => (td.dataset.l === 'todos' ? (f.funcao || 'Todas as funções') : `${porColab[Number(td.dataset.l)].nome} (${porColab[Number(td.dataset.l)].funcao})`),
    () => (f.mes ? `${MESES[Number(f.mes) - 1]}/${f.ano}` : `Ano ${f.ano}`));
  [['f-ano', 'ano'], ['f-mes', 'mes'], ['f-func', 'funcao']].forEach(([id, k]) => $(id).addEventListener('change', e => { f[k] = e.target.value; telaFuncao(); }));
  $('f-exp').addEventListener('click', () => exportar(`resumo-funcao-${f.ano}${f.mes ? '-' + f.mes : ''}`, 'Resumo por função',
    [col('Colaborador', 26), col('Função', 14), ...colsCat()],
    [...porColab.map(r => [r.nome, r.funcao, ...CAT.map(c => n2(r.v[c.chave])), n2(r.total)]), ['Total', '', ...CAT.map(c => n2(s.v[c.chave])), n2(s.total)]]));
}

// ======================= 05 · COLABORADORES =======================
function telaColaboradores() {
  $('page').innerHTML = `
    <div class="page-head"><div><h1>Colaboradores</h1><p>Cadastro de quem presta contas — evita nomes digitados de jeitos diferentes</p></div>
      <div class="acts"><button class="btn" id="k-novo">+ Novo colaborador</button></div></div>
    <div class="card filters"><span class="muted small">Funções cadastradas</span>
      <div class="chips">${D.funcoes.map(f => `<span class="badge ${corFuncao(f)}">${esc(f)}<button class="x" data-delf="${esc(f)}" title="Excluir função" aria-label="Excluir função ${esc(f)}">×</button></span>`).join('')}<button class="btn xs" id="k-funcao">+ Nova função</button></div></div>
    <div class="card table-card"><div class="table-wrap"><table>
      <thead><tr><th>Nome</th><th>Usuário</th><th>Função</th><th>Status</th><th>Ações</th></tr></thead>
      <tbody>${D.colaboradores.map(c => `<tr class="${c.ativo ? '' : 'off'}">
        <td class="b">${esc(c.nome)}</td><td>${esc(c.usuario)}</td>
        <td><span class="badge ${corFuncao(c.funcao)}">${esc(c.funcao)}</span></td>
        <td><span class="badge ${c.ativo ? 'b-green' : 'b-gray'}">${c.ativo ? 'Ativo' : 'Inativo'}</span></td>
        <td><span class="chips">${c.ativo
          ? `<button class="btn xs" data-ed="${esc(c.id)}">Editar</button><button class="btn xs" data-pw="${esc(c.id)}">Nova senha</button><button class="btn xs" data-off="${esc(c.id)}">Desativar</button>`
          : `<button class="btn xs" data-on="${esc(c.id)}">Reativar</button>`}<button class="btn xs no" data-del="${esc(c.id)}">Excluir</button></span></td></tr>`).join('')
        || '<tr class="empty-row"><td colspan="5">Nenhum colaborador cadastrado ainda.</td></tr>'}</tbody>
    </table></div></div>`;

  $('k-novo').onclick = () => modalColab();
  $('k-funcao').onclick = modalFuncao;
  const acha = id => D.colaboradores.find(c => c.id === id);
  document.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => modalColab(acha(b.dataset.ed)));
  document.querySelectorAll('[data-pw]').forEach(b => b.onclick = async () => {
    const c = acha(b.dataset.pw);
    if (!(await confirmar(`A senha atual de ${c.nome} deixa de funcionar, e quem estiver logado com ela é desconectado.`, { titulo: 'Gerar nova senha?', ok: 'Gerar nova senha' }))) return;
    try { const r = await post('/api/admin/colaboradores/' + encodeURIComponent(c.id), { novaSenha: true }, 'PUT'); mostrarSenha(r); } catch (e) { avisar(e.message, 'Não foi possível gerar a senha'); }
  });
  const ativo = (id, v, msg, opcoes) => async () => {
    if (!(await confirmar(msg, opcoes))) return;
    try { await post('/api/admin/colaboradores/' + encodeURIComponent(id), { ativo: v }, 'PUT'); await carregar(); telaColaboradores(); } catch (e) { avisar(e.message, 'Não foi possível concluir'); }
  };
  document.querySelectorAll('[data-off]').forEach(b => { const c = acha(b.dataset.off); b.onclick = ativo(c.id, false, `${c.nome} não consegue mais entrar no app. O histórico continua nos resumos.`, { titulo: 'Desativar colaborador?', ok: 'Desativar', perigo: true }); });
  document.querySelectorAll('[data-on]').forEach(b => { const c = acha(b.dataset.on); b.onclick = ativo(c.id, true, `${c.nome} volta a conseguir entrar no app com a senha atual.`, { titulo: 'Reativar colaborador?', ok: 'Reativar' }); });
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const c = acha(b.dataset.del);
    if (!(await confirmar(`${c.nome} sai do cadastro. Isso não pode ser desfeito.\n\nSó é possível excluir quem ainda não tem nenhum lançamento.`, { titulo: 'Excluir colaborador?', ok: 'Excluir', perigo: true }))) return;
    try { await api('/api/admin/colaboradores/' + encodeURIComponent(c.id), { method: 'DELETE' }); await carregar(); telaColaboradores(); } catch (e) { avisar(e.message, 'Não foi possível excluir'); }
  });
  document.querySelectorAll('[data-delf]').forEach(b => b.onclick = async () => {
    const f = b.dataset.delf;
    if (!(await confirmar(`A função "${f}" sai da lista de funções.`, { titulo: 'Excluir função?', ok: 'Excluir', perigo: true }))) return;
    try { await api('/api/admin/funcoes/' + encodeURIComponent(f), { method: 'DELETE' }); await carregar(); telaColaboradores(); } catch (e) { avisar(e.message, 'Não foi possível excluir'); }
  });
}

// Backup: todas as abas da planilha num .xlsx (o painel nunca recebe as senhas)
function baixarBackup() {
  const sim = b => (b ? 'Sim' : 'Não');
  const quando = iso => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');
  baixarXlsx(`backup-ajuda-de-custo-${hoje()}`, [
    { nome: 'Colaboradores', colunas: [col('ID', 12), col('Nome', 26), col('Usuário', 18), col('Função', 14), col('Ativo', 7), col('Criado em', 18)],
      linhas: D.colaboradores.map(c => [c.id, c.nome, c.usuario, c.funcao, sim(c.ativo), quando(c.criadoEm)]) },
    { nome: 'Funções', colunas: [col('Função', 20)], linhas: D.funcoes.map(f => [f]) },
    { nome: 'Prestações', colunas: [col('ID', 12), col('Colaborador', 26), col('Função', 14), col('Data inicial', 12), col('Data final', 12), col('Mês ref.', 10), ...colsCat(), col('Observação', 34), col('Criado em', 18), col('Fotos', 7)],
      linhas: D.prestacoes.map(p => [p.id, p.colaborador, p.funcao, dmy(p.dataInicial), dmy(p.dataFinal), mesTxt(p.mesRef), ...CAT.map(c => n2(p[c.chave])), n2(p.total), p.observacao, quando(p.criadoEm), p.fotos || 0]) },
    { nome: 'Despesas do app', colunas: [col('ID', 12), col('Colaborador', 26), col('Função', 14), col('Data', 12), col('Categoria', 14), col('Valor', 12, true), col('Observação', 34), col('Status', 12), col('Enviada em', 18), col('Avaliada em', 18), col('Avaliada por', 14), col('Foto', 7)],
      linhas: D.despesas.map(d => [d.id, d.colaborador, d.funcao, dmy(d.data), d.categoria, n2(d.valor), d.observacao, d.status, quando(d.criadoEm), quando(d.avaliadoEm), d.avaliadoPor, sim(d.foto)]) },
  ]);
}

function modalColab(c) {
  const sugestao = nome => semAcento(nome).trim().split(/\s+/).slice(0, 2).join('.').replace(/[^a-z0-9.]/g, '');
  const m = abrirModal(`<h3>${c ? 'Editar colaborador' : 'Novo colaborador'}</h3>
    <div class="field"><label>Nome</label><input class="input" id="m-nome" maxlength="80" value="${c ? esc(c.nome) : ''}"></div>
    <div class="field"><label>Usuário (para entrar no app)</label><input class="input" id="m-user" maxlength="30" value="${c ? esc(c.usuario) : ''}" placeholder="ex.: joao.silva"></div>
    <div class="field"><label>Função</label><select class="input" id="m-func">${opt('', 'Selecione', '')}${D.funcoes.map(f => opt(f, f, c ? c.funcao : '')).join('')}</select></div>
    ${c ? '' : '<span class="muted small">A senha inicial é gerada automaticamente e aparece depois de salvar.</span>'}
    <div id="m-erro" class="alert hidden"></div>
    <div class="acts"><button class="btn secondary" id="m-cancel">Cancelar</button><button class="btn" id="m-ok">Salvar</button></div>`);
  const user = m.querySelector('#m-user');
  let mexeuUser = !!c;
  user.addEventListener('input', () => { mexeuUser = true; });
  m.querySelector('#m-nome').addEventListener('input', e => { if (!mexeuUser) user.value = sugestao(e.target.value); });
  m.querySelector('#m-cancel').onclick = fecharModal;
  m.querySelector('#m-ok').onclick = e => travando(e.currentTarget, async () => {
    const corpo = { nome: m.querySelector('#m-nome').value, usuario: user.value, funcao: m.querySelector('#m-func').value };
    try {
      const r = c ? await post('/api/admin/colaboradores/' + encodeURIComponent(c.id), corpo, 'PUT') : await post('/api/admin/colaboradores', corpo);
      await carregar(); telaColaboradores();
      if (r.senhaTemporaria) mostrarSenha(r); else fecharModal();
    } catch (e) { const el = m.querySelector('#m-erro'); el.textContent = e.message; el.classList.remove('hidden'); }
  });
  m.querySelector('#m-nome').focus();
}
function mostrarSenha(r) {
  const m = abrirModal(`<h3>Acesso de ${esc(r.nome)}</h3>
    <div class="pass-box">Usuário: <strong>${esc(r.usuario)}</strong><br>Senha inicial:<b>${esc(r.senhaTemporaria)}</b></div>
    <span class="muted small">Passe esses dados para o colaborador. Ele pode trocar a senha no app, em Perfil. Esta senha não aparece de novo.</span>
    <div class="acts"><button class="btn" id="m-ok">Pronto</button></div>`);
  m.querySelector('#m-ok').onclick = fecharModal;
}
function modalFuncao() {
  const m = abrirModal(`<h3>Nova função</h3>
    <div class="field"><label>Nome da função</label><input class="input" id="m-nome" maxlength="40" placeholder="ex.: Técnico"></div>
    <div id="m-erro" class="alert hidden"></div>
    <div class="acts"><button class="btn secondary" id="m-cancel">Cancelar</button><button class="btn" id="m-ok">Adicionar</button></div>`);
  m.querySelector('#m-cancel').onclick = fecharModal;
  m.querySelector('#m-ok').onclick = e => travando(e.currentTarget, async () => {
    try { await post('/api/admin/funcoes', { nome: m.querySelector('#m-nome').value }); await carregar(); fecharModal(); telaColaboradores(); }
    catch (e) { const el = m.querySelector('#m-erro'); el.textContent = e.message; el.classList.remove('hidden'); }
  });
  m.querySelector('#m-nome').focus();
}

// ======================= navegação e login =======================
const rota = () => (location.hash.slice(1) || 'lancamentos').split('/');
function desenharTela() {
  const [v, arg] = rota();
  ({ lancamentos: telaLancamentos, despesas: telaDespesas, nova: () => telaNova(arg), colaborador: telaColaborador, funcao: telaFuncao, colaboradores: telaColaboradores }[v] || telaLancamentos)();
}
function render() {
  if (!D) return;
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.v === rota()[0]));
  fecharModal();
  window.scrollTo(0, 0);
  telaDesatualizada = false;
  desenharTela();
}
window.addEventListener('hashchange', render);

// ---------- atualização automática ----------
// A cada 30 s (só com a aba visível) busca os dados de novo, para as despesas enviadas pelo celular
// aparecerem sem precisar apertar F5. A tela só é redesenhada quando isso não atrapalha:
// fora de "Nova prestação", sem janela aberta e sem uma lista de opções aberta.
// Se o cursor estiver num campo de texto (ex.: Buscar), ele volta para o mesmo lugar depois.
const ATUALIZA_MS = 30000;
let telaDesatualizada = false, atualizando = false;
function podeRedesenhar() {
  const ativo = document.activeElement;
  const escolhendo = ativo && $('page').contains(ativo) && ativo.tagName === 'SELECT';
  return rota()[0] !== 'nova' && $('modal').classList.contains('hidden') && !dialogoAberto() && !escolhendo;
}
// Redesenha a tela mantendo a rolagem e, se houver, o campo com o cursor (e a posição do cursor)
function redesenharMantendoFoco() {
  const ativo = document.activeElement, y = window.scrollY;
  const campo = ativo && ativo.id && $('page').contains(ativo) && /^(INPUT|TEXTAREA)$/.test(ativo.tagName)
    ? { id: ativo.id, ini: ativo.selectionStart, fim: ativo.selectionEnd } : null;
  desenharTela();
  window.scrollTo(0, y);
  const el = campo && $(campo.id);
  if (el) { el.focus(); try { el.setSelectionRange(campo.ini, campo.fim); } catch { /* campo sem seleção */ } }
}
async function atualizarSozinho() {
  if (!D || atualizando || document.hidden) return;
  atualizando = true;
  try {
    const antes = JSON.stringify(D);
    await carregar();
    const ativo = document.activeElement;
    if (versaoNova && podeRedesenhar() && !(ativo && /^(INPUT|TEXTAREA)$/.test(ativo.tagName))) return location.reload();
    if (JSON.stringify(D) !== antes) telaDesatualizada = true;
    if (telaDesatualizada && podeRedesenhar()) {
      telaDesatualizada = false;
      redesenharMantendoFoco();
    }
  } catch { /* sem conexão ou sessão expirada: tenta de novo na próxima vez */ }
  finally { atualizando = false; }
}
setInterval(atualizarSozinho, ATUALIZA_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizarSozinho(); });

function mostrarLogin() { $('v-login').classList.remove('hidden'); $('v-painel').classList.add('hidden'); }
async function mostrarPainel(me) {
  $('who-nome').textContent = me.nome;
  await carregar();
  $('v-login').classList.add('hidden'); $('v-painel').classList.remove('hidden');
  render();
}
$('v-login').addEventListener('submit', async e => {
  e.preventDefault();
  $('a-erro').classList.add('hidden');
  try {
    await post('/api/admin/login', { usuario: $('a-user').value, senha: $('a-pass').value });
    $('a-pass').value = '';
    await mostrarPainel(await api('/api/admin/me'));
  } catch (err) { $('a-erro').textContent = err.message; $('a-erro').classList.remove('hidden'); }
});
$('b-backup').addEventListener('click', baixarBackup);
$('b-sair').addEventListener('click', async () => { try { await fetch('/api/admin/logout', { method: 'POST' }); } catch {} D = null; mostrarLogin(); });

(async () => {
  try { await mostrarPainel(await api('/api/admin/me')); } catch { mostrarLogin(); }
})();
