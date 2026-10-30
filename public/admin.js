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
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const nomeMes = ym => MESES[Number(ym.slice(5, 7)) - 1] + '/' + ym.slice(0, 4);
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const CORES_CAT = ['#2563eb', '#7c3aed', '#0ea5e9', '#f59e0b', '#16a34a', '#94a3b8'];
const CORES_FUNCAO = ['b-purple', 'b-pink', 'b-blue', 'b-amber', 'b-green', 'b-gray'];

const { STATUS, PAGO, PAGA, naoEnviada, antesDoSistema } = Regras;

let D = null;          // dados vindos do servidor
let ME = null;         // quem está logado no painel: { nome, usuario, principal }
let CAT = [];          // categorias
const F = {            // filtros de cada tela (ficam guardados ao trocar de tela)
  l: { ano: hoje().slice(0, 4), mes: hoje().slice(5, 7), funcao: '', colab: '', busca: '' },
  c: { colab: '', ano: hoje().slice(0, 4), mes: '' }, // mes '' = o ano inteiro
  f: { ano: hoje().slice(0, 4), mes: hoje().slice(5, 7), funcao: '' },
  d: { ano: hoje().slice(0, 4), mes: hoje().slice(5, 7), colab: '', busca: '', status: '' },
  p: { colab: '', status: 'aguardando' }, // pagamentos: começa mostrando os períodos aguardando pagamento
};

// Versão nova no servidor (deploy): a página se recarrega sozinha no próximo momento seguro
let versaoAberta = '', versaoNova = false;
function notaVersao(r) {
  const v = r.headers.get('X-Versao');
  if (!v) return;
  if (!versaoAberta) versaoAberta = v; else if (v !== versaoAberta) versaoNova = true;
}

async function api(url, opts = {}) {
  let r;
  try { r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts }); }
  catch { throw new Error('Sem conexão com a internet. Confira a rede e tente de novo.'); } // o navegador diria só "Failed to fetch"
  const corpo = await r.json().catch(() => ({}));
  notaVersao(r);
  if (r.status === 401 && !url.endsWith('/login')) { mostrarLogin(); throw new Error('Faça login.'); }
  if (!r.ok) throw Object.assign(new Error(corpo.erro || 'Erro de conexão.'), { status: r.status });
  return corpo;
}
const post = (url, body, method = 'POST') => api(url, { method, body: JSON.stringify(body || {}) });

// Aprovar, recusar ou desfazer. Se outra aba já mudou a despesa (409) ou o colaborador a excluiu (404),
// atualiza a tela antes do aviso.
const MSG_EXCLUIDA = 'O colaborador excluiu esta despesa pelo celular. A lista foi atualizada.';
async function avaliarDespesa(id, acao) {
  try { await post(`/api/admin/despesas/${encodeURIComponent(id)}/${acao}`); }
  catch (e) {
    if (e.status === 409 || e.status === 404) { await carregar(); fecharModal(); desenharTela(); }
    if (e.status === 404) throw new Error(MSG_EXCLUIDA);
    throw e;
  }
  await carregar();
}

async function carregar() {
  D = await api('/api/admin/dados');
  // Só o administrador principal vê e cadastra os outros administradores
  D.administradores = ME && ME.principal ? await api('/api/admin/administradores') : [];
  // Despesas, prestações e períodos guardam o nome da época; as telas mostram sempre o nome atual do cadastro
  // (se o colaborador foi renomeado, tudo aparece com o nome novo e a busca encontra pelo nome novo)
  const nomes = new Map(D.colaboradores.map(c => [c.id, c.nome]));
  for (const x of [...D.despesas, ...D.prestacoes, ...(D.periodos || [])]) { x.nomeEpoca = x.colaborador; const n = nomes.get(x.colaboradorId); if (n) x.colaborador = n; }
  CAT = D.categorias;
  const pend = D.despesas.filter(d => d.status === STATUS.analise).length;
  $('nav-pend').textContent = pend;
  $('nav-pend').classList.toggle('hidden', !pend);
  D.periodos = D.periodos || [];
  const aPagar = linhasPagamento().filter(prontaParaPagar).length;
  $('nav-pag').textContent = aPagar;
  $('nav-pag').classList.toggle('hidden', !aPagar);
}

// Linhas da tabela de lançamentos: prestações do painel + despesas aprovadas do app (somadas por colaborador,
// mês e função: se o colaborador mudou de função no meio do mês, cada parte fica na função em que foi lançada)
function linhas() {
  const zeros = () => Object.fromEntries(CAT.map(c => [c.chave, 0]));
  const rows = D.prestacoes.map(p => ({ ...p, origem: 'painel', valores: Object.fromEntries(CAT.map(c => [c.chave, p[c.chave]])) }));
  const g = new Map();
  for (const d of D.despesas.filter(x => x.status === STATUS.aprovada)) {
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

// Exportação para Excel (.xlsx): ver public/xlsx.js. As linhas de total (no fim) saem em negrito.
const col = (titulo, largura = 14, moeda = false) => ({ titulo, largura, moeda });
const colsCat = () => [...CAT.map(c => col(c.nome, 13, true)), col('Total', 13, true)];
const n2 = v => r2(v || 0);
const mesTxt = ym => ym.slice(5) + '/' + ym.slice(0, 4);
function exportar(nome, aba, colunas, linhas, totais = 1) { baixarXlsx(nome, [{ nome: aba, colunas, linhas, totalNoFim: totais }]); }

// ---------- modal ----------
// Foto que não abriu: pergunta ao servidor o motivo (foto que não existe mais × falha passageira)
async function motivoFoto(url) {
  try { return (await fetch(url, { credentials: 'same-origin' })).status === 404 ? 'A foto não está mais disponível.' : 'Não foi possível carregar a foto. Tente de novo em instantes.'; }
  catch { return 'Não foi possível carregar a foto. Confira a internet e tente de novo.'; }
}
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
    && (!busca || semAcento(r.colaborador + ' ' + r.observacao + ' ' + (r.despesas || []).map(d => d.observacao + ' ' + d.categoria).join(' ')).includes(busca)))
    .sort((a, b) => (a.dataInicial + a.colaborador).localeCompare(b.dataInicial + b.colaborador));
  const s = somar(rows);
  const maior = CAT.map(c => ({ ...c, v: s.v[c.chave] })).sort((a, b) => b.v - a.v)[0];
  const nColab = new Set(rows.map(r => r.colaboradorId)).size;
  const periodo = f.mes ? MESES[Number(f.mes) - 1].toLowerCase() : f.ano;
  const pend = D.despesas.filter(d => d.status === STATUS.analise).sort((a, b) => a.data.localeCompare(b.data));

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
        <span class="muted obs-txt" title="${esc(d.observacao)}">${esc(d.observacao) || '—'}</span>
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
          <td class="num" style="text-align:left">${rotPeriodo(r)}</td><td>${r.mesRef.slice(5)}</td>
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
    <div class="rows card">${r.despesas.sort((a, b) => a.data.localeCompare(b.data)).map(d => `<div><span class="desc">${dmy(d.data)} · ${esc(d.categoria)}${seloPaga(d)}${d.observacao ? ' · ' + esc(d.observacao) : ''}${d.foto ? ` <button class="link tag-foto" data-nota="${esc(d.id)}">📷 ver nota</button>` : ''}</span><span class="valor">${brl(d.valor)}</span></div>`).join('')}</div>
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
    ? `<div><span class="desc">${dmy(i.data)} · ${esc(i.app.observacao || i.app.categoria)}${seloPaga(i.app)}${i.app.foto ? ` <button class="link tag-foto" data-nota="${esc(i.app.id)}">📷 ver nota</button>` : ''}<br><span class="muted small">Despesa do celular</span></span><span class="valor">${brl(i.valor)}</span></div>`
    : `<div><span class="desc">${dm(i.prest.dataInicial)}${i.prest.dataInicial.slice(0, 4) !== i.prest.dataFinal.slice(0, 4) ? '/' + i.prest.dataInicial.slice(0, 4) : ''} a ${dmy(i.prest.dataFinal)}${i.prest.observacao ? ' · ' + esc(i.prest.observacao) : ''}${i.prest.fotos ? ` <span class="tag-foto">📎${i.prest.fotos}</span>` : ''} <button class="link tag-foto" data-prest="${esc(i.prest.id)}">abrir</button><br><span class="muted small">Prestação do painel · mês ref. ${nomeMes(i.prest.mesRef)}</span></span><span class="valor">${brl(i.valor)}</span></div>`;
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
// voltaDepois: depois de aprovar/recusar, volta para a lista de origem (só quando ela se recalcula com os dados novos)
function modalNota(d, voltar, voltaDepois = false) {
  if (!d) return;
  const quando = iso => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '—');
  const url = '/api/admin/despesas/' + encodeURIComponent(d.id) + '/foto' + (d.fotoV ? '?v=' + d.fotoV : ''); // ?v muda quando a foto é trocada
  const emAnalise = d.status === STATUS.analise;
  const perPago = periodoTravado(d); // despesa de período pago: não pode mais mudar
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
          <div><span>Status</span><span>${esc(statusVisto(d))}${d.avaliadoEm ? ` · ${quando(d.avaliadoEm)}` : ''}</span></div>
        </div>
        ${d.foto ? `<a class="link small" id="m-abrir" href="${url}" target="_blank" rel="noopener">Abrir a foto em nova aba ↗</a>` : ''}
        <span class="muted small">Confira se o valor e a data batem com a nota.</span>
        ${emAnalise ? '<div class="acts" style="justify-content:stretch"><button class="btn ok grow" id="m-ap">Aprovar</button><button class="btn danger grow" id="m-rc">Recusar</button></div>'
          : perPago ? '<span class="muted small">Período já pago: para mudar esta despesa, desfaça o pagamento em Pagamentos.</span>'
          : `<button class="btn secondary" id="m-desfazer">↩ Desfazer ${d.status === STATUS.aprovada ? 'aprovação' : 'recusa'}</button>`}
        <button class="btn secondary" id="m-fechar">${voltar ? 'Voltar' : 'Fechar'}</button>
      </div>
    </div>`, 'modal-nota');
  const img = m.querySelector('#m-img img');
  if (img) {
    img.onclick = () => m.querySelector('#m-img').classList.toggle('zoom');
    img.onerror = async () => {
      const msg = await motivoFoto(img.src);
      const caixa = m.querySelector('#m-img'), abrir = m.querySelector('#m-abrir');
      if (caixa) caixa.innerHTML = `<span class="sem">${esc(msg)}</span>`;
      if (abrir) abrir.remove(); // o link abriria só uma mensagem de erro
    };
  }
  m.querySelector('#m-fechar').onclick = () => (voltar ? voltar() : fecharModal());
  // Confere na hora se a despesa ainda existe (o colaborador pode tê-la excluído depois da última atualização)
  const antes = JSON.stringify(D);
  carregar().then(() => {
    if (JSON.stringify(D) !== antes) telaDesatualizada = true; // a tela de fundo é redesenhada quando a janela fechar
    if (D.despesas.some(x => x.id === d.id)) return;
    fecharModal(); desenharTela(); avisar(MSG_EXCLUIDA, 'Despesa excluída');
  }).catch(() => { /* sem conexão: segue com os dados que já tem */ });
  const decidir = acao => async e => {
    const botao = e.currentTarget; // guardado antes do await (depois dele o evento já não aponta para o botão)
    if (acao === 'recusar' && !(await confirmar('O colaborador verá o status "Recusada".', { titulo: 'Recusar esta despesa?', ok: 'Recusar', perigo: true }))) return;
    if (acao === 'reabrir' && !(await confirmarDesfazer(d))) return;
    botao.disabled = true;
    // Aberta a partir de outra lista (ex.: "Ver notas" do período): volta para ela, sem fechar tudo
    try { await avaliarDespesa(d.id, acao); desenharTela(); if (voltar && voltaDepois) voltar(); else fecharModal(); }
    catch (err) { avisar(err.message, 'Não foi possível concluir'); botao.disabled = false; }
  };
  if (emAnalise) { m.querySelector('#m-ap').onclick = decidir('aprovar'); m.querySelector('#m-rc').onclick = decidir('recusar'); }
  else if (m.querySelector('#m-desfazer')) m.querySelector('#m-desfazer').onclick = decidir('reabrir');
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
    const aba = m.querySelector('#vf-abrir');
    aba.classList.toggle('hidden', lista[i].startsWith('data:')); // foto ainda não enviada: sem link
    aba.href = lista[i];
    caixa.querySelector('img').onerror = async () => { caixa.innerHTML = `<span class="sem">${esc(await motivoFoto(lista[i]))}</span>`; aba.classList.add('hidden'); };
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
  d.status === STATUS.aprovada
    ? `A despesa de ${d.colaborador} (${brl(d.valor)}) volta para "Em análise" e sai dos totais até ser aprovada de novo.`
    : `A despesa de ${d.colaborador} (${brl(d.valor)}) volta para "Em análise" e pode ser aprovada.`,
  { titulo: d.status === STATUS.aprovada ? 'Desfazer a aprovação?' : 'Desfazer a recusa?', ok: 'Desfazer' });

// ======================= DESPESAS DO CELULAR =======================
// Todas as despesas enviadas pelo app, com filtro por status (inclui as recusadas, que não aparecem nos Lançamentos)
const STATUS_COR = { [STATUS.analise]: 'b-amber', [STATUS.aprovada]: 'b-green', [STATUS.recusada]: 'b-red', [PAGA]: 'b-blue' };
// Quando foi paga: a data do pagamento, ou "antes do sistema" (marcada em "Já foram pagas", não foi paga naquele dia)
const quandoPaga = p => (antesDoSistema(p) ? 'antes do sistema' : 'em ' + diaBR(p.pagoEm));
const periodoDaDespesa = d => d.periodoId && (D.periodos || []).find(p => p.id === d.periodoId);
const periodoTravado = d => (periodoDaDespesa(d) || {}).status === PAGO; // despesa de período pago: não muda mais
// Status como aparece nas telas e no Excel: "Paga" quando o período foi pago
// Selo "Paga em dd/mm" ao lado da despesa (listas de despesas do app)
const seloPaga = d => { const p = periodoDaDespesa(d); return p && p.status === PAGO && d.status === STATUS.aprovada ? ` <span class="badge b-blue">Paga ${antesDoSistema(p) ? 'antes do sistema' : 'em ' + diaBR(p.pagoEm).slice(0, 5)}</span>` : ''; };
const statusVisto = d => (d.status === STATUS.aprovada && (periodoDaDespesa(d) || {}).status === PAGO ? PAGA : d.status);
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
        ${chip('', `Todas (${doPeriodo.length})`)}${chip(STATUS.analise, `Em análise (${conta(STATUS.analise).length})`)}${chip(STATUS.aprovada, `Aprovadas (${conta(STATUS.aprovada).length})`)}${chip(STATUS.recusada, `Recusadas (${conta(STATUS.recusada).length})`)}</div>
    </div>
    <div class="kpis">
      <div class="card kpi"><span class="l">Total (filtro atual)</span><span class="v">${brl(soma(rows))}</span><span class="d">${rows.length} despesa${rows.length === 1 ? '' : 's'}</span></div>
      <div class="card kpi"><span class="l">Em análise</span><span class="v">${brl(soma(conta(STATUS.analise)))}</span><span class="d">${conta(STATUS.analise).length} aguardando</span></div>
      <div class="card kpi"><span class="l">Aprovadas</span><span class="v">${brl(soma(conta(STATUS.aprovada)))}</span><span class="d">${conta(STATUS.aprovada).length} no período</span></div>
      <div class="card kpi"><span class="l">Recusadas</span><span class="v">${brl(soma(conta(STATUS.recusada)))}</span><span class="d">${conta(STATUS.recusada).length} no período</span></div>
    </div>
    <div class="card table-card"><div class="table-wrap"><table>
      <thead><tr><th>Data</th><th>Colaborador</th><th>Categoria</th><th class="num">Valor</th><th>Observação</th><th>Status</th><th>Nota</th><th>Ações</th></tr></thead>
      <tbody>${rows.map(d => `<tr class="click" data-desp="${esc(d.id)}">
        <td>${dmy(d.data)}</td>
        <td class="b">${esc(d.colaborador)}<br><span class="muted small" style="font-weight:400">${esc(d.funcao)}</span></td>
        <td>${esc(d.categoria)}</td><td class="num b">${fmt(d.valor)}</td>
        <td class="muted obs-col"><div class="obs-txt" title="${esc(d.observacao)}">${esc(d.observacao) || '—'}</div></td>
        <td>${(() => { const per = d.periodoId && D.periodos.find(p => p.id === d.periodoId); return per && per.status === PAGO && d.status === STATUS.aprovada
          ? `<span class="badge b-blue">Paga</span><br><span class="muted small">${quandoPaga(per)}</span>`
          : `<span class="badge ${STATUS_COR[d.status] || 'b-gray'}">${esc(d.status)}</span>${d.avaliadoEm ? `<br><span class="muted small">${quando(d.avaliadoEm)}</span>` : ''}`; })()}</td>
        <td>${d.foto ? '📷' : '<span class="muted small">—</span>'}</td>
        <td><span class="chips">${d.status === STATUS.analise
          ? `<button class="btn xs ok" data-dap="${esc(d.id)}">Aprovar</button><button class="btn xs no" data-drc="${esc(d.id)}">Recusar</button>`
          : periodoTravado(d) ? '<span class="muted small">período pago</span>'
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
  // Totais separados por status: "aprovadas" bate com o Lançamentos; em análise e recusadas não se misturam
  const porStatus = st => rows.filter(d => d.status === st);
  const totaisPorStatus = [['Total aprovadas', porStatus(STATUS.aprovada)], ['Total em análise', porStatus(STATUS.analise)],
    ...(porStatus(STATUS.recusada).length ? [['Total recusadas (não entram no pagamento)', porStatus(STATUS.recusada)]] : [])];
  $('d-exp').addEventListener('click', () => exportar(`despesas-celular-${f.ano}${f.mes ? '-' + f.mes : ''}${f.status ? '-' + semAcento(f.status).replace(/\W+/g, '-') : ''}`, 'Despesas do celular',
    [col('Data', 12), col('Colaborador', 26), col('Função', 14), col('Categoria', 14), col('Valor', 12, true), col('Observação', 34), col('Status', 12), col('Avaliada em', 14), col('Período', 24), col('Foto', 7)],
    [...rows.map(d => { const p = periodoDaDespesa(d); return [dmy(d.data), d.colaborador, d.funcao, d.categoria, n2(d.valor), d.observacao, statusVisto(d), quando(d.avaliadoEm),
      p ? `${rotPeriodo(p)} · ${d.status === STATUS.recusada ? 'enviada, recusada (não entra no pagamento)' : p.status === PAGO ? 'paga ' + quandoPaga(p)
        : d.status === STATUS.analise ? 'enviada, aguardando análise' : 'enviada, aguardando pagamento'}` : antiga(d) ? 'antes do controle de pagamentos' : d.status !== STATUS.recusada ? 'não enviada' : '', d.foto ? 'Sim' : 'Não']; }),
      ...totaisPorStatus.map(([rot, l]) => [rot, '', '', '', soma(l), '', '', '', '', ''])], totaisPorStatus.length));
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
  let salvasV = p ? p.fotosV || [] : []; // versão de cada comprovante já salvo (muda se a foto mudar)
  const novas = [];
  const urlSalva = i => `/api/admin/prestacoes/${encodeURIComponent(p.id)}/fotos/${i}?v=${salvasV[i]}`;
  const todasFotos = () => [...salvasV.map((_, i) => urlSalva(i)), ...novas];
  const desenhaFotos = () => {
    if (!$('n-fotos')) return;
    $('n-fotos').innerHTML = todasFotos().map((src, i) => `<div class="thumb">
      <img src="${src}" alt="Comprovante ${i + 1}" data-ver="${i}">
      ${i >= salvasV.length ? '<span class="thumb-nova">nova</span>' : ''}
      <button type="button" class="x" data-rm="${i}" title="Remover" aria-label="Remover foto ${i + 1}">×</button></div>`).join('')
      || '<span class="muted small">Nenhuma foto anexada.</span>';
    $('n-fotos').querySelectorAll('[data-ver]').forEach(im => {
      im.onclick = () => verFotos(todasFotos(), Number(im.dataset.ver));
      // comprovante que não existe mais: aviso no lugar da imagem quebrada (o × continua para remover)
      im.onerror = () => im.replaceWith(Object.assign(document.createElement('span'), { className: 'thumb-sem', textContent: 'Foto indisponível' }));
    });
    $('n-fotos').querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
      const i = Number(b.dataset.rm);
      if (i >= salvasV.length) { novas.splice(i - salvasV.length, 1); return desenhaFotos(); }
      if (!(await confirmar('A foto sai desta prestação e é apagada.', { titulo: 'Remover comprovante?', ok: 'Remover', perigo: true }))) return;
      try {
        const r = await api(`/api/admin/prestacoes/${encodeURIComponent(p.id)}/fotos/${i}?v=${salvasV[i]}`, { method: 'DELETE' });
        salvasV = r.fotosV || []; desenhaFotos();
      } catch (e) {
        if (e.status === 409) { await carregar(); const atual = D.prestacoes.find(x => x.id === p.id); salvasV = (atual && atual.fotosV) || []; desenhaFotos(); }
        avisar(e.message, 'Não foi possível remover');
      }
    });
  };
  if ($('n-add-foto')) $('n-add-foto').onclick = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
    inp.onchange = async () => {
      const arquivos = [...(inp.files || [])];
      const vagas = 10 - salvasV.length - novas.length;
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
  // Filtro de mês: a tabela, o total e o PDF ficam só com o mês escolhido; o gráfico continua com o ano
  const mesN = Number(f.mes) || 0;
  const rowsMes = mesN ? rows.filter(r => Number(r.mesRef.slice(5)) === mesN) : rows;
  const nomePeriodo = mesN ? `${MESES[mesN - 1]}/${f.ano}` : f.ano;
  const s = somar(rows), sMes = somar(rowsMes);
  const comGasto = porMes.filter(m => m.total > 0);
  const maxI = porMes.reduce((best, m, i) => (m.total > porMes[best].total ? i : best), 0);
  const max = Math.max(...porMes.map(m => m.total), 1);
  const colab = D.colaboradores.find(c => c.id === f.colab);

  $('page').innerHTML = `
    <div class="page-head"><div><h1>Resumo por colaborador</h1><p>Gastos do ano por mês e categoria (igual à planilha "Resumo prestação de contas")</p></div>
      <div class="acts"><button class="btn secondary" id="c-exp">Exportar PDF</button></div></div>
    <div class="kpis" style="grid-template-columns:2.2fr 1fr 1fr 1fr">
      <div class="card filters" style="grid-template-columns:1fr 100px 130px;padding:12px 14px">
        <div class="field"><label>Colaborador</label><select class="input" id="c-colab">${D.colaboradores.map(c => opt(c.id, c.nome, f.colab)).join('') || opt('', 'Nenhum cadastrado', '')}</select></div>
        <div class="field"><label>Ano</label><select class="input" id="c-ano">${optsAno(f.ano)}</select></div>
        <div class="field"><label>Mês</label><select class="input" id="c-mes">${optsMes(f.mes)}</select></div>
      </div>
      <div class="card kpi"><span class="l">${mesN ? `Total em ${MESES[mesN - 1]}` : 'Total no ano'}</span><span class="v">${brl(sMes.total)}</span></div>
      <div class="card kpi"><span class="l">Média nos meses com gasto${mesN ? ' (no ano)' : ''}</span><span class="v">${brl(comGasto.length ? s.total / comGasto.length : 0)}</span></div>
      <div class="card kpi"><span class="l">Mês com maior gasto${mesN ? ' (no ano)' : ''}</span><span class="v sm">${s.total ? `${MESES[maxI]} · ${brl(porMes[maxI].total)}` : '—'}</span></div>
    </div>
    <div class="card chart-card"><h3>Gastos por mês</h3>
      <div class="bars${mesN ? ' filtrado' : ''}">${porMes.map((m, i) => `<div class="col${i + 1 === mesN ? ' sel' : ''}">${m.total ? `<span class="val">${fmt(m.total)}</span>` : ''}<div class="bar${m.total ? '' : ' zero'}" style="height:${m.total ? Math.max(3, m.total / max * 120) : 2}px"></div><span class="lab">${MES_CURTO[i]}</span></div>`).join('')}</div>
    </div>
    <div class="card table-card"><div class="table-wrap"><table>
      <thead><tr><th>Mês</th>${CAT.map(c => `<th class="num">${esc(c.nome)}</th>`).join('')}<th class="num">Total</th></tr></thead>
      <tbody>${porMes.map((m, i) => (mesN && i + 1 !== mesN ? '' : `<tr><td class="b">${MESES[i]}</td>${CAT.map(c => celClick(m.v[c.chave], `data-m="${i + 1}" data-c="${c.chave}"`)).join('')}${celClick(m.total, `data-m="${i + 1}" data-c="total"`, ' b')}</tr>`)).join('')}
        <tr class="total"><td>Total ${esc(nomePeriodo)}</td>${CAT.map(c => celClick(sMes.v[c.chave], `data-m="${mesN || 'ano'}" data-c="${c.chave}"`)).join('')}${celClick(sMes.total, `data-m="${mesN || 'ano'}" data-c="total"`)}</tr></tbody>
    </table></div></div>`;

  // Clique num valor da tabela: abre as despesas e prestações que formam aquele número
  const doMes = td => (td.dataset.m === 'ano' ? rows : rows.filter(r => Number(r.mesRef.slice(5)) === Number(td.dataset.m)));
  ligarCelulas(doMes, () => (colab ? colab.nome : ''), td => (td.dataset.m === 'ano' ? `Ano ${f.ano}` : `${MESES[Number(td.dataset.m) - 1]}/${f.ano}`));
  $('c-colab').addEventListener('change', e => { f.colab = e.target.value; telaColaborador(); });
  $('c-ano').addEventListener('change', e => { f.ano = e.target.value; telaColaborador(); });
  $('c-mes').addEventListener('change', e => { f.mes = e.target.value; telaColaborador(); });
  $('c-exp').addEventListener('click', () => (colab ? pdfPrestacao(colab, f.ano, rowsMes, f.mes) : avisar('Cadastre um colaborador primeiro.', 'Nada para exportar')));
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
// PDF "Prestação de contas" (mesmo modelo da folha em papel): uma página por mês com gasto no ano,
// com o quadro por categoria e o total.
// mes ('01'..'12' ou ''): só entra no nome do arquivo e no aviso; as linhas já vêm filtradas
function pdfPrestacao(colab, ano, rows, mes = '') {
  const meses = MESES.map((_, i) => rows.filter(r => Number(r.mesRef.slice(5)) === i + 1)).map((rs, i) => ({ i, rs, s: somar(rs) })).filter(m => m.s.total > 0);
  if (!meses.length) return avisar(`${colab.nome} não tem gastos em ${mes ? MESES[Number(mes) - 1].toLowerCase() + '/' : ''}${ano}.`, 'Nada para exportar');
  // Este PDF soma o mês inteiro, inclusive o que já foi pago pela aba Pagamentos: avisa, para não pagar duas vezes
  const jaPago = rs => r2(rs.flatMap(r => r.despesas || []).filter(d => statusVisto(d) === PAGA).reduce((t, d) => t + d.valor, 0));
  pdfFolhas(colab, meses.map(m => { const pg = jaPago(m.rs); return {
    periodo: `${MESES[m.i].toUpperCase()} / ${ano}`, s: m.s,
    carimbo: pg && pg >= m.s.total ? 'JÁ PAGO' : '',
    nota: pg ? `Resumo do mês. Deste total, ${brl(pg)} já ${pg >= m.s.total ? 'foi pago' : 'foi pago em períodos da aba Pagamentos'} — não pague de novo.` : '',
  }; }),
    `prestacao-de-contas-${semAcento(colab.nome).replace(/\W+/g, '-')}-${ano}${mes ? '-' + mes : ''}`);
}
// Gera o PDF: uma folha por item de "folhas" ({ periodo: texto do campo Período, s: somar(...), carimbo, nota })
function pdfFolhas(colab, folhas, nomeArquivo) {
  const doc = novoPdf(), E = 60, DIR = doc.larg - 60, cinza = [0.45, 0.45, 0.45];
  const gerado = `Gerado em ${dmy(hoje())} pelo sistema Ajuda de Custo`;
  const rodape = () => doc.texto(doc.larg / 2, doc.alt - 30, gerado, { tam: 8, alinhar: 'centro', cor: cinza });
  // Rótulo à direita e o valor sobre uma linha (como os campos da folha)
  const campo = (rot, y, valor, x2 = DIR) => {
    doc.texto(170, y, rot + ' :', { tam: 13, negrito: true, alinhar: 'dir' });
    doc.texto(180, y, doc.caber(valor, x2 - 185, 12), { tam: 12 });
    doc.linha(178, y + 5, x2, y + 5, { larg: 0.6 });
  };
  for (const { periodo, s, carimbo, nota } of folhas) {
    doc.pagina();
    doc.texto(E, 80, 'PRESTAÇÃO DE CONTAS', { tam: 20, negrito: true });
    if (carimbo) { // ex.: "PAGO EM 20/10/2026"
      const w = doc.largura(carimbo, 12, true) + 20;
      doc.ret(DIR - w, 62, w, 24, { corBorda: [0.09, 0.5, 0.24], larg: 1.5 });
      doc.texto(DIR - w / 2, 79, carimbo, { tam: 12, negrito: true, alinhar: 'centro', cor: [0.09, 0.5, 0.24] });
    }
    campo('PERÍODO', 125, periodo, 360);
    campo('NOME', 152, colab.nome);
    campo('TELEFONE', 179, colab.telefone);
    campo('CIDADE', 206, colab.cidade, 390);
    doc.texto(445, 206, 'UF :', { tam: 13, negrito: true, alinhar: 'dir' });
    doc.texto(455, 206, colab.uf || '', { tam: 12 });
    doc.linha(450, 211, DIR, 211, { larg: 0.6 });

    // Quadro Descrição | Valor
    const xV = 365, alt = 24;
    let y = 240;
    doc.ret(E, y, DIR - E, alt + 2, { fundo: [0.78, 0.78, 0.78] });
    doc.texto((E + xV) / 2, y + 18, 'DESCRIÇÃO', { tam: 12, negrito: true, alinhar: 'centro' });
    doc.texto((xV + DIR) / 2, y + 18, 'VALOR', { tam: 12, negrito: true, alinhar: 'centro' });
    doc.linha(xV, y, xV, y + alt + 2);
    y += alt + 2;
    for (const c of [...CAT, null, null]) { // duas linhas em branco no fim, como na folha
      doc.ret(E, y, DIR - E, alt);
      doc.linha(xV, y, xV, y + alt);
      if (c) {
        doc.texto((E + xV) / 2, y + 16, c.nome.toUpperCase(), { tam: 12, alinhar: 'centro' });
        if (s.v[c.chave]) doc.texto((xV + DIR) / 2, y + 16, fmt(s.v[c.chave]), { tam: 12, alinhar: 'centro' });
      }
      y += alt;
    }
    doc.texto(xV + 12, y + 20, 'R$', { tam: 12, negrito: true });
    doc.texto(DIR - 8, y + 20, fmt(s.total), { tam: 12, negrito: true, alinhar: 'dir' });
    // Dados bancários do colaborador (como na folha): só as linhas preenchidas
    const banco = [colab.banco && colab.banco.toUpperCase(), colab.agencia && 'AG - ' + colab.agencia, colab.conta && 'C/C - ' + colab.conta,
      colab.cpf && 'CPF - ' + colab.cpf, colab.pix && 'PIX - ' + colab.pix].filter(Boolean);
    banco.forEach((t, k) => doc.texto(E + 10, y + 70 + k * 19, doc.caber(t, DIR - E - 10, 12, true), { tam: 12, negrito: true, italico: true }));
    if (nota) doc.texto(E, doc.alt - 50, doc.caber(nota, DIR - E, 9), { tam: 9, cor: cinza });
    rodape();
  }
  doc.baixar(nomeArquivo);
}

// ---------- períodos de pagamento ----------
// O colaborador fecha o período no app (todas as despesas ainda não enviadas viram um período "Enviado"); aqui o
// Maurício confere as notas, paga, reabre ou desfaz o pagamento. O Maurício também pode fechar por ele.
const somaAprov = l => r2(l.filter(d => d.status === STATUS.aprovada).reduce((s, d) => s + d.valor, 0));
// Enviado com alguma despesa aprovada (a mesma conta no menu e no KPI)
const prontaParaPagar = l => l.tipo === 'enviado' && somaAprov(l.notas) > 0;
const rotPeriodo = p => (p.dataInicial === p.dataFinal ? dmy(p.dataInicial)
  : `${p.dataInicial.slice(0, 4) === p.dataFinal.slice(0, 4) ? dm(p.dataInicial) : dmy(p.dataInicial)} a ${dmy(p.dataFinal)}`);
const diaBR = iso => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');
// Despesa aprovada antes do início do controle de pagamentos (pode já ter sido reembolsada fora do sistema)
const antiga = d => Regras.antiga(d, D.inicioPeriodos);
// Linhas da tela: os períodos (enviados e pagos), cada um com as suas notas
function linhasPagamento() {
  return (D.periodos || []).map(p => ({ ...p, tipo: p.status === PAGO ? 'pago' : 'enviado',
    notas: D.despesas.filter(d => d.periodoId === p.id).sort((a, b) => a.data.localeCompare(b.data)) }))
    .sort((a, b) => ((a.tipo === 'pago') - (b.tipo === 'pago')) || (b.fechadoEm || '').localeCompare(a.fechadoEm || ''));
}
// Despesas que o colaborador ainda não enviou (para o Maurício fechar o período por ele, se preciso)
const naoEnviadas = colabId => D.despesas.filter(d => d.colaboradorId === colabId && naoEnviada(d) && d.status !== STATUS.recusada && !antiga(d));
const nomeColab = (id, l) => (D.colaboradores.find(c => c.id === id) || {}).nome || (l && l[0] && l[0].colaborador) || 'o colaborador';
function blocoAntigas() {
  const por = new Map();
  for (const d of D.despesas.filter(antiga)) { const g = por.get(d.colaboradorId) || []; g.push(d); por.set(d.colaboradorId, g); }
  if (!por.size) return '';
  return `<div class="card pend"><h3>Despesas aprovadas antes do controle de pagamentos</h3>
    <span class="muted small">Elas não entram sozinhas num período, porque podem já ter sido reembolsadas antes de o sistema controlar os pagamentos. Decida por colaborador:</span>
    ${[...por].map(([id, l]) => { const ds = l.map(d => d.data).sort(); return `<div class="pend-row antigas-row">
      <span><b>${esc(nomeColab(id, l))}</b><br><span class="muted small">${l.length} despesa${l.length === 1 ? '' : 's'} · ${rotPeriodo({ dataInicial: ds[0], dataFinal: ds[ds.length - 1] })}</span></span>
      <span class="num"><b>${brl(l.reduce((s, d) => s + d.valor, 0))}</b></span>
      <span class="acts"><button class="btn xs" data-ant-pagas="${esc(id)}">Já foram pagas</button><button class="btn xs ok" data-ant-incluir="${esc(id)}">Incluir para pagar</button></span></div>`; }).join('')}
  </div>`;
}
function telaPagamentos() {
  const f = F.p;
  const todas = linhasPagamento().filter(l => !f.colab || l.colaboradorId === f.colab);
  const rows = todas.filter(l => !f.status || (f.status === PAGO ? l.tipo === 'pago' : l.tipo === 'enviado'));
  const aguardando = todas.filter(l => l.tipo === 'enviado'), prontos = aguardando.filter(prontaParaPagar);
  const mesAtual = hoje().slice(0, 7);
  const pagosMes = todas.filter(l => l.tipo === 'pago' && !antesDoSistema(l) && diaBR(l.pagoEm).split('/').reverse().join('-').startsWith(mesAtual));
  const anal = aguardando.reduce((s, l) => s + l.notas.filter(d => d.status === STATUS.analise).length, 0);
  const chip = (st, rot, n) => `<button class="chip sm${f.status === st ? ' on' : ''}" data-st="${esc(st)}">${esc(rot)} (${n})</button>`;
  $('page').innerHTML = `
    <div class="page-head"><div><h1>Pagamentos</h1><p>Períodos enviados pelos colaboradores: confira as notas, exporte o PDF e marque como pago</p></div>
      <div class="acts"><button class="btn secondary" id="p-fechar">Fechar período por um colaborador</button></div></div>
    ${blocoAntigas()}
    <div class="card filters" style="grid-template-columns:1fr 2fr">
      <div class="field"><label>Colaborador</label><select class="input" id="p-colab">${opt('', 'Todos', f.colab)}${D.colaboradores.map(c => opt(c.id, c.nome, f.colab)).join('')}</select></div>
      <div class="field"><label>Status</label><div class="chips">${chip('', 'Todos', todas.length)}${chip('aguardando', 'Aguardando pagamento', aguardando.length)}${chip(PAGO, 'Pagos', todas.length - aguardando.length)}</div></div>
    </div>
    <div class="kpis" style="grid-template-columns:repeat(3,1fr)">
      <div class="card kpi"><span class="l">Aguardando pagamento</span><span class="v">${brl(aguardando.reduce((s, l) => s + somaAprov(l.notas), 0))}</span><span class="muted small">${prontos.length} período${prontos.length === 1 ? '' : 's'} com despesas aprovadas</span></div>
      <div class="card kpi"><span class="l">Pago em ${MESES[Number(mesAtual.slice(5)) - 1].toLowerCase()}</span><span class="v">${brl(pagosMes.reduce((s, l) => s + l.valorPago, 0))}</span><span class="muted small">${pagosMes.length} pagamento${pagosMes.length === 1 ? '' : 's'}</span></div>
      <div class="card kpi"><span class="l">Em análise nos períodos enviados</span><span class="v">${anal}</span><span class="muted small">despesa${anal === 1 ? '' : 's'} para aprovar ou recusar antes de pagar</span></div>
    </div>
    <div class="card table-card"><div class="table-wrap"><table>
      <thead><tr><th>Colaborador</th><th>Período</th><th>Notas</th><th class="num">Valor aprovado</th><th>Status</th><th>Ações</th></tr></thead>
      <tbody>${rows.map(l => {
        const na = l.notas.filter(d => d.status === STATUS.analise).length;
        const pago = l.tipo === 'pago';
        const status = pago ? `<span class="badge b-blue">Pago em ${diaBR(l.pagoEm).slice(0, 5)}</span>${antesDoSistema(l) ? '<br><span class="muted small">pago antes do sistema</span>' : ''}`
          : na ? '<span class="badge b-gray">Aguardando análise</span>'
          : prontaParaPagar(l) ? '<span class="badge b-amber">Aguardando pagamento</span>' : '<span class="badge b-gray">Sem despesas aprovadas</span>';
        return `<tr>
        <td class="b">${esc(l.colaborador)}</td>
        <td>${rotPeriodo(l)}${antesDoSistema(l) ? '' : `<br><span class="muted small">enviado em ${diaBR(l.fechadoEm)}${l.fechadoPor && l.fechadoPor !== l.colaborador ? ' por ' + esc(l.fechadoPor) : ''}</span>`}</td>
        <td style="white-space:nowrap">${l.notas.length}${na ? ` <span class="badge b-amber">${na} em análise</span>` : ''}</td>
        <td class="num b">${fmt(pago ? l.valorPago : somaAprov(l.notas))}</td>
        <td>${status}</td>
        <td><span class="chips">
          <button class="btn xs" data-ver="${esc(l.id)}">Ver notas</button>
          <button class="btn xs" data-pdf="${esc(l.id)}">PDF</button>
          ${pago ? `<button class="btn xs" data-despagar="${esc(l.id)}">Desfazer pagamento</button>`
            : `<button class="btn xs ok" data-pagar="${esc(l.id)}">✔ Pagar</button><button class="btn xs" data-reabrir="${esc(l.id)}">Reabrir</button>`}
        </span></td></tr>`;
      }).join('') || `<tr class="empty-row"><td colspan="6">${!todas.length ? 'Nenhum período enviado ainda.' : f.status === PAGO ? 'Nenhum período pago.' : f.status ? 'Nenhum período aguardando pagamento.' : 'Nenhum período.'}</td></tr>`}</tbody>
    </table></div></div>
    <p class="muted small">Só dá para pagar depois de aprovar ou recusar todas as notas do período. "Reabrir" devolve as despesas ao colaborador como não enviadas (ex.: para ele juntar com outras e enviar de novo).</p>`;

  const acha = id => linhasPagamento().find(l => l.id === id);
  const acao = (url, corpo) => async () => { try { await post(url, corpo); await carregar(); telaPagamentos(); } catch (e) { await carregar(); telaPagamentos(); avisar(e.message, 'Não foi possível concluir'); } };
  const url = (id, op) => '/api/admin/periodos/' + encodeURIComponent(id) + '/' + op;
  $('p-colab').onchange = e => { f.colab = e.target.value; telaPagamentos(); };
  document.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { f.status = b.dataset.st; telaPagamentos(); });
  $('p-fechar').onclick = modalFecharPeriodo;
  document.querySelectorAll('[data-ant-pagas]').forEach(b => b.onclick = async () => {
    const id = b.dataset.antPagas;
    if (!(await confirmar(`As despesas antigas de ${nomeColab(id)} viram um pagamento marcado como "pago antes do sistema". Elas não serão pagas de novo.`, { titulo: 'Marcar como já pagas?', ok: 'Já foram pagas' }))) return;
    acao('/api/admin/periodos/antigas', { colaboradorId: id, jaPagas: true })();
  });
  document.querySelectorAll('[data-ant-incluir]').forEach(b => b.onclick = async () => {
    const id = b.dataset.antIncluir;
    if (!(await confirmar(`As despesas antigas de ${nomeColab(id)} viram um período "Aguardando pagamento", para você pagar.`, { titulo: 'Incluir para pagar?', ok: 'Incluir para pagar' }))) return;
    acao('/api/admin/periodos/antigas', { colaboradorId: id })();
  });
  document.querySelectorAll('[data-ver]').forEach(b => b.onclick = () => modalPeriodo(b.dataset.ver));
  document.querySelectorAll('[data-pdf]').forEach(b => b.onclick = () => pdfPeriodo(acha(b.dataset.pdf)));
  document.querySelectorAll('[data-pagar]').forEach(b => b.onclick = async () => {
    const l = acha(b.dataset.pagar), na = l.notas.filter(d => d.status === STATUS.analise).length;
    if (na) return avisar(`Ainda há ${na} despesa${na > 1 ? 's' : ''} em análise neste período. Clique em "Ver notas" para aprovar ou recusar antes de pagar.`, 'Falta analisar');
    if (!somaAprov(l.notas)) return avisar('Este período não tem nenhuma despesa aprovada: não há o que pagar. Se precisar, use "Reabrir".', 'Nada para pagar');
    if (!(await confirmar(`${l.colaborador} · ${rotPeriodo(l)}\nValor: ${brl(somaAprov(l.notas))} (despesas aprovadas)\n\nO colaborador verá "Paga" nessas despesas. Elas não poderão mais ser alteradas, a não ser que você desfaça o pagamento.`, { titulo: 'Marcar como pago?', ok: 'Marcar como pago' }))) return;
    acao(url(l.id, 'pagar'))();
  });
  document.querySelectorAll('[data-reabrir]').forEach(b => b.onclick = async () => {
    const l = acha(b.dataset.reabrir);
    if (!(await confirmar(`O envio de ${l.colaborador} (${rotPeriodo(l)}) é desfeito: as ${l.notas.length} despesa${l.notas.length === 1 ? '' : 's'} voltam a ficar "não enviadas" no app, e ele pode enviar de novo.`, { titulo: 'Reabrir período?', ok: 'Reabrir', perigo: true }))) return;
    acao(url(l.id, 'reabrir'))();
  });
  document.querySelectorAll('[data-despagar]').forEach(b => b.onclick = async () => {
    const l = acha(b.dataset.despagar);
    const msg = antesDoSistema(l) ? `As despesas de ${l.colaborador} (${rotPeriodo(l)}) voltam para a caixa "Despesas aprovadas antes do controle de pagamentos", para você decidir de novo.`
      : `O período ${rotPeriodo(l)} de ${l.colaborador} volta para "Aguardando pagamento".`;
    if (!(await confirmar(msg, { titulo: 'Desfazer pagamento?', ok: 'Desfazer', perigo: true }))) return;
    acao(url(l.id, 'desfazer-pagamento'))();
  });
}
// Notas do período: clicar abre a nota; depois de aprovar/recusar volta para cá
function modalPeriodo(id) {
  const l = linhasPagamento().find(x => x.id === id);
  if (!l) { fecharModal(); return telaPagamentos(); } // o período não existe mais (ex.: reaberto em outra tela)
  const pago = l.tipo === 'pago';
  const m = abrirModal(`<h3>${esc(l.colaborador)} · ${rotPeriodo(l)}</h3>
    <span class="muted small">${l.notas.length} nota${l.notas.length === 1 ? '' : 's'} · ${pago ? `pago ${brl(l.valorPago)} em ${diaBR(l.pagoEm)}` : `aprovado ${brl(somaAprov(l.notas))}`}</span>
    <div class="rows card">${l.notas.map(d => `<div data-nota="${esc(d.id)}" style="cursor:pointer"><span class="desc">${dmy(d.data)} · ${esc(d.categoria)}${d.observacao ? ' · ' + esc(d.observacao) : ''}<br><span class="badge ${STATUS_COR[statusVisto(d)] || 'b-gray'}">${esc(statusVisto(d))}</span></span><span class="valor">${brl(d.valor)}</span></div>`).join('') || '<div><span class="muted">Nenhuma nota.</span></div>'}</div>
    <span class="muted small">${pago ? 'Pago: clique numa nota para ver a foto.' : 'Clique numa nota para ver a foto e aprovar ou recusar.'}</span>
    <div class="acts"><button class="btn" id="m-fechar">Fechar</button></div>`);
  m.querySelector('#m-fechar').onclick = () => { fecharModal(); telaPagamentos(); };
  m.querySelectorAll('[data-nota]').forEach(el => el.onclick = () => modalNota(D.despesas.find(d => d.id === el.dataset.nota), () => modalPeriodo(id), true));
}
// O Maurício fecha o período por um colaborador (ex.: se ele esqueceu): igual ao botão do app
function modalFecharPeriodo() {
  const comPend = D.colaboradores.map(c => ({ c, l: naoEnviadas(c.id) })).filter(x => x.l.length);
  if (!comPend.length) return avisar('Nenhum colaborador tem despesas ainda não enviadas.', 'Nada para fechar');
  const m = abrirModal(`<h3>Fechar período por um colaborador</h3>
    <span class="muted small">Junta as despesas que o colaborador ainda não enviou (em análise ou aprovadas) num período, igual ao botão "Fechar período e enviar" do app.</span>
    <div class="field"><label>Colaborador</label><select class="input" id="m-colab">${comPend.map(({ c, l }) => { const ds = l.map(d => d.data).sort(); return opt(c.id, `${c.nome} · ${l.length} despesa${l.length === 1 ? '' : 's'} · ${brl(l.reduce((s, d) => s + d.valor, 0))} · ${rotPeriodo({ dataInicial: ds[0], dataFinal: ds[ds.length - 1] })}`, F.p.colab); }).join('')}</select></div>
    <div id="m-erro" class="alert hidden"></div>
    <div class="acts"><button class="btn secondary" id="m-cancel">Cancelar</button><button class="btn" id="m-ok">Fechar período</button></div>`);
  m.querySelector('#m-cancel').onclick = fecharModal;
  m.querySelector('#m-ok').onclick = e => travando(e.currentTarget, async () => {
    try { await post('/api/admin/periodos/fechar', { colaboradorId: m.querySelector('#m-colab').value }); fecharModal(); await carregar(); telaPagamentos(); }
    catch (err) { // mudou em outra aba (ex.: já fechado): atualiza a tela e mostra o motivo
      fecharModal(); await carregar().catch(() => {}); telaPagamentos(); avisar(err.message, 'Não foi possível fechar');
    }
  });
}
function pdfPeriodo(l) {
  const colab = D.colaboradores.find(c => c.id === l.colaboradorId) || { nome: l.colaborador };
  const aprov = l.notas.filter(d => d.status === STATUS.aprovada), anal = l.notas.filter(d => d.status === STATUS.analise).length;
  if (!aprov.length) return avisar('Este período ainda não tem despesas aprovadas.', 'Nada para exportar');
  // Soma por categoria das aprovadas (mesmo formato de somar())
  const v = Object.fromEntries(CAT.map(c => [c.chave, 0]));
  for (const d of aprov) { const k = chaveCat(d.categoria); v[k] = r2(v[k] + d.valor); }
  const nomeArq = d => `${d.slice(8)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
  pdfFolhas(colab, [{
    periodo: rotPeriodo(l), s: { v, total: somaAprov(l.notas) },
    carimbo: l.tipo !== 'pago' ? '' : antesDoSistema(l) ? 'PAGO ANTES DO SISTEMA' : `PAGO EM ${diaBR(l.pagoEm)}`,
    nota: anal ? `Atenção: ${anal} despesa${anal > 1 ? 's' : ''} deste período ainda em análise não entr${anal > 1 ? 'aram' : 'ou'} nos valores.` : '',
  }], `prestacao-de-contas-${semAcento(colab.nome).replace(/\W+/g, '-')}-${nomeArq(l.dataInicial)}-a-${nomeArq(l.dataFinal)}`);
}

function telaColaboradores() {
  $('page').innerHTML = `
    <div class="page-head"><div><h1>Colaboradores</h1><p>Cadastro de quem presta contas — evita nomes digitados de jeitos diferentes</p></div>
      <div class="acts"><button class="btn" id="k-novo">+ Novo colaborador</button></div></div>
    <div class="card filters"><span class="muted small">Funções cadastradas</span>
      <div class="chips">${D.funcoes.map(f => `<span class="badge ${corFuncao(f)}">${esc(f)}<button class="x" data-delf="${esc(f)}" title="Excluir função" aria-label="Excluir função ${esc(f)}">×</button></span>`).join('')}<button class="btn xs" id="k-funcao">+ Nova função</button></div></div>
    <div class="card table-card"><div class="table-wrap"><table>
      <thead><tr><th>Nome</th><th>Usuário</th><th>Função</th><th>Telefone</th><th>Cidade / UF</th><th>Status</th><th>Ações</th></tr></thead>
      <tbody>${D.colaboradores.map(c => `<tr class="${c.ativo ? '' : 'off'}">
        <td class="b">${esc(c.nome)}</td><td>${esc(c.usuario)}</td>
        <td><span class="badge ${corFuncao(c.funcao)}">${esc(c.funcao)}</span></td>
        <td>${esc(c.telefone) || '<span class="muted">—</span>'}</td>
        <td>${esc([c.cidade, c.uf].filter(Boolean).join(' / ')) || '<span class="muted">—</span>'}</td>
        <td><span class="badge ${c.ativo ? 'b-green' : 'b-gray'}">${c.ativo ? 'Ativo' : 'Inativo'}</span></td>
        <td><span class="chips">${c.ativo
          ? `<button class="btn xs" data-ed="${esc(c.id)}">Editar</button><button class="btn xs" data-pw="${esc(c.id)}">Nova senha</button><button class="btn xs" data-off="${esc(c.id)}">Desativar</button>`
          : `<button class="btn xs" data-ed="${esc(c.id)}">Editar</button><button class="btn xs" data-on="${esc(c.id)}">Reativar</button>`}<button class="btn xs no" data-del="${esc(c.id)}">Excluir</button></span></td></tr>`).join('')
        || '<tr class="empty-row"><td colspan="7">Nenhum colaborador cadastrado ainda.</td></tr>'}</tbody>
    </table></div></div>
    ${ME && ME.principal ? secaoAdministradores() : ''}`;

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
  ligarAdministradores();
  document.querySelectorAll('[data-delf]').forEach(b => b.onclick = async () => {
    const f = b.dataset.delf;
    if (!(await confirmar(`A função "${f}" sai da lista de funções.`, { titulo: 'Excluir função?', ok: 'Excluir', perigo: true }))) return;
    try { await api('/api/admin/funcoes/' + encodeURIComponent(f), { method: 'DELETE' }); await carregar(); telaColaboradores(); } catch (e) { avisar(e.message, 'Não foi possível excluir'); }
  });
}

// ---- administradores do painel (só o principal vê esta parte) ----
// O principal é o login das variáveis do Render (ADMIN_USER/ADMIN_PASSWORD) e não aparece na lista.
function secaoAdministradores() {
  return `<div class="page-head" style="margin-top:8px"><div><h2>Administradores do painel</h2>
      <p>Quem mais pode entrar neste painel. Cada um tem usuário e senha próprios, e o nome dele fica em "aprovado por" e "pago por".</p></div>
      <div class="acts"><button class="btn" id="k-novo-adm">+ Novo administrador</button></div></div>
    <div class="card table-card"><div class="table-wrap"><table>
      <thead><tr><th>Nome</th><th>Usuário</th><th>Status</th><th>Ações</th></tr></thead>
      <tbody><tr><td class="b">${esc(ME.nome)}</td><td>${esc(ME.usuario)}</td><td><span class="badge b-blue">Principal</span></td>
        <td class="muted small">Senha trocada no Render (ADMIN_PASSWORD)</td></tr>
      ${D.administradores.map(a => `<tr class="${a.ativo ? '' : 'off'}">
        <td class="b">${esc(a.nome)}</td><td>${esc(a.usuario)}</td>
        <td><span class="badge ${a.ativo ? 'b-green' : 'b-gray'}">${a.ativo ? 'Ativo' : 'Inativo'}</span></td>
        <td><span class="chips"><button class="btn xs" data-adm-ed="${esc(a.id)}">Editar</button>${a.ativo
          ? `<button class="btn xs" data-adm-pw="${esc(a.id)}">Nova senha</button><button class="btn xs" data-adm-off="${esc(a.id)}">Desativar</button>`
          : `<button class="btn xs" data-adm-on="${esc(a.id)}">Reativar</button>`}<button class="btn xs no" data-adm-del="${esc(a.id)}">Excluir</button></span></td></tr>`).join('')}</tbody>
    </table></div></div>`;
}
function ligarAdministradores() {
  if (!$('k-novo-adm')) return;
  const acha = id => D.administradores.find(a => a.id === id);
  const url = id => '/api/admin/administradores/' + encodeURIComponent(id);
  const depois = async () => { await carregar(); telaColaboradores(); };
  $('k-novo-adm').onclick = () => modalAdmin();
  document.querySelectorAll('[data-adm-ed]').forEach(b => b.onclick = () => modalAdmin(acha(b.dataset.admEd)));
  document.querySelectorAll('[data-adm-pw]').forEach(b => b.onclick = async () => {
    const a = acha(b.dataset.admPw);
    if (!(await confirmar(`A senha atual de ${a.nome} deixa de funcionar, e quem estiver logado com ela sai do painel.`, { titulo: 'Gerar nova senha?', ok: 'Gerar nova senha' }))) return;
    try { mostrarSenha(await post(url(a.id), { novaSenha: true }, 'PUT'), true); } catch (e) { avisar(e.message, 'Não foi possível gerar a senha'); }
  });
  const ativo = (id, v, msg, opcoes) => async () => {
    if (!(await confirmar(msg, opcoes))) return;
    try { await post(url(id), { ativo: v }, 'PUT'); await depois(); } catch (e) { avisar(e.message, 'Não foi possível concluir'); }
  };
  document.querySelectorAll('[data-adm-off]').forEach(b => { const a = acha(b.dataset.admOff); b.onclick = ativo(a.id, false, `${a.nome} não consegue mais entrar no painel.`, { titulo: 'Desativar administrador?', ok: 'Desativar', perigo: true }); });
  document.querySelectorAll('[data-adm-on]').forEach(b => { const a = acha(b.dataset.admOn); b.onclick = ativo(a.id, true, `${a.nome} volta a conseguir entrar no painel com a senha atual.`, { titulo: 'Reativar administrador?', ok: 'Reativar' }); });
  document.querySelectorAll('[data-adm-del]').forEach(b => b.onclick = async () => {
    const a = acha(b.dataset.admDel);
    if (!(await confirmar(`${a.nome} sai da lista e não consegue mais entrar. O nome dele continua nos registros antigos ("aprovado por", "pago por").`, { titulo: 'Excluir administrador?', ok: 'Excluir', perigo: true }))) return;
    try { await api(url(a.id), { method: 'DELETE' }); await depois(); } catch (e) { avisar(e.message, 'Não foi possível excluir'); }
  });
}
function modalAdmin(a) {
  const m = abrirModal(`<h3>${a ? 'Editar administrador' : 'Novo administrador'}</h3>
    <div class="field"><label>Nome</label><input class="input" id="m-nome" maxlength="80" value="${a ? esc(a.nome) : ''}"></div>
    <div class="field"><label>Usuário (para entrar no painel)</label><input class="input" id="m-user" maxlength="30" value="${a ? esc(a.usuario) : ''}" placeholder="ex.: ana.souza"></div>
    ${a ? '' : '<span class="muted small">A senha inicial é gerada automaticamente e aparece depois de salvar.</span>'}
    <div id="m-erro" class="alert hidden"></div>
    <div class="acts"><button class="btn secondary" id="m-cancel">Cancelar</button><button class="btn" id="m-ok">Salvar</button></div>`);
  m.querySelector('#m-cancel').onclick = fecharModal;
  m.querySelector('#m-ok').onclick = e => travando(e.currentTarget, async () => {
    const corpo = { nome: m.querySelector('#m-nome').value, usuario: m.querySelector('#m-user').value };
    try {
      const r = a ? await post('/api/admin/administradores/' + encodeURIComponent(a.id), corpo, 'PUT') : await post('/api/admin/administradores', corpo);
      await carregar(); telaColaboradores();
      if (r.senhaTemporaria) mostrarSenha(r, true); else fecharModal();
    } catch (err) { const el = m.querySelector('#m-erro'); el.textContent = err.message; el.classList.remove('hidden'); }
  });
  m.querySelector('#m-nome').focus();
}
// Administrador da tabela troca a própria senha (o principal troca no Render)
function modalMinhaSenha() {
  const m = abrirModal(`<h3>Trocar minha senha</h3>
    <div class="field"><label for="m-atual">Senha atual</label><input class="input" id="m-atual" type="password" autocomplete="current-password"></div>
    <div class="field"><label for="m-nova">Nova senha (mínimo 8 caracteres)</label><input class="input" id="m-nova" type="password" autocomplete="new-password"></div>
    <div class="field"><label for="m-conf">Repita a nova senha</label><input class="input" id="m-conf" type="password" autocomplete="new-password"></div>
    <div id="m-erro" class="alert hidden"></div>
    <div class="acts"><button class="btn secondary" id="m-cancel">Cancelar</button><button class="btn" id="m-ok">Salvar</button></div>`);
  const falha = msg => { const el = m.querySelector('#m-erro'); el.textContent = msg; el.classList.remove('hidden'); };
  m.querySelector('#m-cancel').onclick = fecharModal;
  m.querySelector('#m-ok').onclick = e => travando(e.currentTarget, async () => {
    if (m.querySelector('#m-nova').value !== m.querySelector('#m-conf').value) return falha('As duas senhas novas não são iguais.');
    try {
      await post('/api/admin/me/senha', { atual: m.querySelector('#m-atual').value, nova: m.querySelector('#m-nova').value });
      fecharModal(); avisar('Senha alterada. Nos outros navegadores será preciso entrar de novo.', 'Pronto');
    } catch (err) { falha(err.message); }
  });
  m.querySelector('#m-atual').focus();
}

// Backup: todas as abas da planilha num .xlsx (o painel nunca recebe as senhas)
function baixarBackup() {
  const sim = b => (b ? 'Sim' : 'Não');
  const quando = iso => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');
  baixarXlsx(`backup-ajuda-de-custo-${hoje()}`, [
    { nome: 'Colaboradores', colunas: [col('ID', 12), col('Nome', 26), col('Usuário', 18), col('Função', 14), col('Telefone', 16), col('Cidade', 20), col('UF', 5),
      col('Banco', 16), col('Agência', 9), col('Conta', 14), col('CPF', 16), col('PIX', 26), col('Ativo', 7), col('Criado em', 18)],
      linhas: D.colaboradores.map(c => [c.id, c.nome, c.usuario, c.funcao, c.telefone, c.cidade, c.uf, c.banco, c.agencia, c.conta, c.cpf, c.pix, sim(c.ativo), quando(c.criadoEm)]) },
    { nome: 'Funções', colunas: [col('Função', 20)], linhas: D.funcoes.map(f => [f]) },
    ...(D.administradores.length ? [{ nome: 'Administradores', colunas: [col('ID', 12), col('Nome', 26), col('Usuário', 18), col('Ativo', 7), col('Criado em', 18), col('Criado por', 18)],
      linhas: D.administradores.map(a => [a.id, a.nome, a.usuario, sim(a.ativo), quando(a.criadoEm), a.criadoPor]) }] : []),
    { nome: 'Prestações', colunas: [col('ID', 12), col('Colaborador ID', 12), col('Colaborador', 26), col('Função', 14), col('Data inicial', 12), col('Data final', 12), col('Mês ref.', 10), ...colsCat(), col('Observação', 34), col('Criado em', 18), col('Fotos', 7)],
      linhas: D.prestacoes.map(p => [p.id, p.colaboradorId, p.nomeEpoca, p.funcao, dmy(p.dataInicial), dmy(p.dataFinal), mesTxt(p.mesRef), ...CAT.map(c => n2(p[c.chave])), n2(p.total), p.observacao, quando(p.criadoEm), p.fotos || 0]) },
    { nome: 'Despesas do app', colunas: [col('ID', 12), col('Colaborador ID', 12), col('Colaborador', 26), col('Função', 14), col('Data', 12), col('Categoria', 14), col('Valor', 12, true), col('Observação', 34), col('Status', 12), col('Enviada em', 18), col('Avaliada em', 18), col('Avaliada por', 14), col('Foto', 7), col('Período', 12)],
      linhas: D.despesas.map(d => [d.id, d.colaboradorId, d.nomeEpoca, d.funcao, dmy(d.data), d.categoria, n2(d.valor), d.observacao, d.status, quando(d.criadoEm), quando(d.avaliadoEm), d.avaliadoPor, sim(d.foto), d.periodoId]) },
    { nome: 'Períodos', colunas: [col('ID', 12), col('Colaborador ID', 12), col('Colaborador', 26), col('Data inicial', 12), col('Data final', 12), col('Status', 10), col('Enviado em', 18), col('Enviado por', 18), col('Pago em', 18), col('Pago por', 14), col('Valor pago', 12, true)],
      linhas: D.periodos.map(p => [p.id, p.colaboradorId, p.nomeEpoca, dmy(p.dataInicial), dmy(p.dataFinal), p.status, quando(p.fechadoEm), p.fechadoPor, quando(p.pagoEm), p.pagoPor, n2(p.valorPago)]) },
  ]);
}

function modalColab(c) {
  const sugestao = nome => semAcento(nome).trim().split(/\s+/).slice(0, 2).join('.').replace(/[^a-z0-9.]/g, '');
  const m = abrirModal(`<h3>${c ? 'Editar colaborador' : 'Novo colaborador'}</h3>
    <div class="field"><label>Nome</label><input class="input" id="m-nome" maxlength="80" value="${c ? esc(c.nome) : ''}"></div>
    <div class="field"><label>Usuário (para entrar no app)</label><input class="input" id="m-user" maxlength="30" value="${c ? esc(c.usuario) : ''}" placeholder="ex.: joao.silva"></div>
    <div class="field"><label>Função</label><select class="input" id="m-func">${opt('', 'Selecione', '')}${D.funcoes.map(f => opt(f, f, c ? c.funcao : '')).join('')}</select></div>
    <div class="field"><label>Telefone</label><input class="input" id="m-tel" maxlength="20" inputmode="tel" value="${c ? esc(c.telefone) : ''}" placeholder="ex.: (47) 99999-9999"></div>
    <div class="row2" style="grid-template-columns:1fr 110px">
      <div class="field"><label>Cidade</label><input class="input" id="m-cid" maxlength="60" value="${c ? esc(c.cidade) : ''}" placeholder="ex.: Porto Alegre"></div>
      <div class="field"><label>UF</label><select class="input" id="m-uf">${opt('', '—', '')}${UFS.map(u => opt(u, u, c ? c.uf : '')).join('')}</select></div>
    </div>
    <h4 class="form-sec">Dados bancários</h4>
    <div class="field"><label>Banco</label><input class="input" id="m-banco" maxlength="40" value="${c ? esc(c.banco) : ''}" placeholder="ex.: Nubank"></div>
    <div class="row2" style="grid-template-columns:1fr 1.4fr">
      <div class="field"><label>Agência</label><input class="input" id="m-ag" maxlength="15" inputmode="numeric" value="${c ? esc(c.agencia) : ''}" placeholder="ex.: 0001"></div>
      <div class="field"><label>Conta corrente</label><input class="input" id="m-cc" maxlength="25" value="${c ? esc(c.conta) : ''}" placeholder="ex.: 12345678-9"></div>
    </div>
    <div class="field"><label>CPF</label><input class="input" id="m-cpf" maxlength="20" inputmode="numeric" value="${c ? esc(c.cpf) : ''}" placeholder="000.000.000-00"></div>
    <div class="field"><label>Chave PIX</label><input class="input" id="m-pix" maxlength="80" value="${c ? esc(c.pix) : ''}" placeholder="CPF, telefone, e-mail ou chave aleatória"></div>
    ${c ? '' : '<span class="muted small">A senha inicial é gerada automaticamente e aparece depois de salvar.</span>'}
    <div id="m-erro" class="alert hidden"></div>
    <div class="acts"><button class="btn secondary" id="m-cancel">Cancelar</button><button class="btn" id="m-ok">Salvar</button></div>`);
  const user = m.querySelector('#m-user');
  let mexeuUser = !!c;
  user.addEventListener('input', () => { mexeuUser = true; });
  m.querySelector('#m-nome').addEventListener('input', e => { if (!mexeuUser) user.value = sugestao(e.target.value); });
  m.querySelector('#m-cancel').onclick = fecharModal;
  m.querySelector('#m-ok').onclick = e => travando(e.currentTarget, async () => {
    const corpo = { nome: m.querySelector('#m-nome').value, usuario: user.value, funcao: m.querySelector('#m-func').value,
      telefone: m.querySelector('#m-tel').value, cidade: m.querySelector('#m-cid').value, uf: m.querySelector('#m-uf').value,
      banco: m.querySelector('#m-banco').value, agencia: m.querySelector('#m-ag').value, conta: m.querySelector('#m-cc').value,
      cpf: m.querySelector('#m-cpf').value, pix: m.querySelector('#m-pix').value };
    try {
      const r = c ? await post('/api/admin/colaboradores/' + encodeURIComponent(c.id), corpo, 'PUT') : await post('/api/admin/colaboradores', corpo);
      await carregar(); telaColaboradores();
      if (r.senhaTemporaria) mostrarSenha(r); else fecharModal();
    } catch (e) { const el = m.querySelector('#m-erro'); el.textContent = e.message; el.classList.remove('hidden'); }
  });
  m.querySelector('#m-nome').focus();
}
function mostrarSenha(r, admin = false) {
  const m = abrirModal(`<h3>Acesso de ${esc(r.nome)}</h3>
    <div class="pass-box">Usuário: <strong>${esc(r.usuario)}</strong><br>Senha inicial:<b>${esc(r.senhaTemporaria)}</b></div>
    <span class="muted small">${admin
      ? 'Passe esses dados para a pessoa. Ela entra em /admin e pode trocar a senha em "Trocar senha", embaixo do nome. Esta senha não aparece de novo.'
      : 'Passe esses dados para o colaborador. Ele pode trocar a senha no app, em Perfil. Esta senha não aparece de novo.'}</span>
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
  ({ lancamentos: telaLancamentos, despesas: telaDespesas, pagamentos: telaPagamentos, nova: () => telaNova(arg), colaborador: telaColaborador, funcao: telaFuncao, colaboradores: telaColaboradores }[v] || telaLancamentos)();
}
function render() {
  if (!D) return;
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.v === rota()[0]));
  fecharModal();
  window.scrollTo(0, 0);
  telaDesatualizada = false;
  desenharTela();
  atualizarSozinho(); // ao trocar de tela, busca os dados de novo (redesenha só se algo mudou)
}
window.addEventListener('hashchange', render);

// ---------- atualização automática ----------
// A cada 30 s (só com a aba visível) busca os dados de novo, para as despesas enviadas pelo celular
// aparecerem sem precisar apertar F5. A tela só é redesenhada quando isso não atrapalha:
// fora de "Nova prestação", sem janela aberta e sem uma lista de opções aberta.
// Se o cursor estiver num campo de texto (ex.: Buscar), ele volta para o mesmo lugar depois.
// A cada 5 s pergunta ao servidor se algo mudou (resposta minúscula) e só então baixa os dados de novo;
// por segurança, baixa tudo a cada 60 s (pega mudanças feitas fora do sistema, ex.: direto no banco).
const VERIFICA_MS = 5000, ATUALIZA_MS = 60000;
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
// Devolve true quando os dados foram baixados
async function atualizarSozinho() {
  if (!D || atualizando || document.hidden) return false;
  atualizando = true;
  try {
    const antes = JSON.stringify(D);
    await carregar();
    const ativo = document.activeElement;
    if (versaoNova && podeRedesenhar() && !(ativo && /^(INPUT|TEXTAREA)$/.test(ativo.tagName))) { location.reload(); return true; }
    if (JSON.stringify(D) !== antes) telaDesatualizada = true;
    redesenharSePuder();
    return true;
  } catch { return false; /* sem conexão ou sessão expirada: tenta de novo na próxima vez */ }
  finally { atualizando = false; }
}
// Dados novos que chegaram com uma janela aberta: a tela é redesenhada assim que ela fechar
function redesenharSePuder() {
  if (telaDesatualizada && podeRedesenhar()) {
    telaDesatualizada = false;
    redesenharMantendoFoco();
  }
}
// Marca de mudanças do servidor: só é guardada depois que os dados foram baixados
let marcaDados = '';
async function verificarMudancas() {
  if (!D || document.hidden) return;
  redesenharSePuder();
  try {
    const { v } = await api('/api/admin/mudancas');
    if (v !== marcaDados && await atualizarSozinho()) marcaDados = v;
  } catch { /* sem conexão ou sessão expirada: tenta de novo daqui a 5 s */ }
}
setInterval(verificarMudancas, VERIFICA_MS);
setInterval(atualizarSozinho, ATUALIZA_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizarSozinho(); });

function mostrarLogin() { $('v-login').classList.remove('hidden'); $('v-painel').classList.add('hidden'); }
async function mostrarPainel(me) {
  ME = me;
  $('who-nome').textContent = me.nome;
  $('who-papel').textContent = me.principal ? 'Administrador principal' : 'Administrador';
  $('b-senha').classList.toggle('hidden', !!me.principal);
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
$('b-senha').addEventListener('click', modalMinhaSenha);
$('b-sair').addEventListener('click', async () => { try { await fetch('/api/admin/logout', { method: 'POST' }); } catch {} D = null; ME = null; mostrarLogin(); });

(async () => {
  try { await mostrarPainel(await api('/api/admin/me')); } catch { mostrarLogin(); }
})();
