// App do colaborador (celular): login, minhas despesas, nova despesa, detalhe e perfil
const $ = id => document.getElementById(id);
const tela = () => $('screen');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = n => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dmy = s => s.split('-').reverse().join('/');
const dm = s => dmy(s).slice(0, 5);
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MES_CURTO = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const VISUAL = {
  'Combustível': ['⛽', '#fee2e2'], 'Alimentação': ['🍽️', '#e0e7ff'], 'Degustação': ['🍷', '#dcfce7'],
  'Hotel': ['🏨', '#f3e8ff'], 'Transporte': ['🚌', '#e0f2fe'], 'Outros': ['🧾', '#fef3c7'],
};
const icone = cat => { const [e, bg] = VISUAL[cat] || ['🧾', '#f1f5f9']; return `<span class="ic" style="background:${bg}">${e}</span>`; };
const badge = st => `<span class="badge ${st === 'Aprovada' ? 'b-green' : st === 'Recusada' ? 'b-red' : 'b-amber'}">${esc(st)}</span>`;

let me = null, despesas = [], categorias = [], mesSel = hoje().slice(0, 7), ultima = null;

async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts });
  const corpo = await r.json().catch(() => ({}));
  if (r.status === 401 && !url.endsWith('/api/login')) {
    telaLogin();
    if (corpo.erro && corpo.erro !== 'Faça login.') erro('l-erro', corpo.erro); // ex.: "Sua senha foi alterada"
    throw Object.assign(new Error(corpo.erro || 'Faça login.'), { login: true });
  }
  if (!r.ok) throw new Error(corpo.erro || 'Erro de conexão. Tente novamente.');
  return corpo;
}
const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body || {}) });

function mostrar(html, aba) {
  tela().innerHTML = html;
  tela().classList.toggle('no-nav', !aba);
  $('tabbar').classList.toggle('hidden', !aba);
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === aba));
  window.scrollTo(0, 0);
}
function erro(id, msg) { const el = $(id); el.textContent = msg; el.classList.toggle('hidden', !msg); }
document.querySelectorAll('#tabbar button').forEach(b => b.addEventListener('click', () => ({ inicio: telaInicio, nova: telaNova, perfil: telaPerfil }[b.dataset.tab])()));

// ---------- C1 · Login ----------
function telaLogin() {
  me = null;
  mostrar(`
    <div class="login-brand"><div class="logo-rs">R$</div><h1>Ajuda de Custo</h1><span class="muted small">101 do Brasil · área do colaborador</span></div>
    <form id="f-login" style="display:flex;flex-direction:column;gap:12px">
      <div class="field"><label for="l-user">Usuário</label><input class="input" id="l-user" autocomplete="username" autocapitalize="none" required></div>
      <div class="field"><label for="l-pass">Senha</label><input class="input" id="l-pass" type="password" autocomplete="current-password" required></div>
      <div id="l-erro" class="alert hidden"></div>
      <button class="btn lg block" type="submit">Entrar</button>
      <button type="button" class="link" id="l-esq" style="align-self:flex-start">Esqueci minha senha</button>
      <span class="muted small hidden" id="l-esq-msg">Peça ao Maurício para gerar uma nova senha para você.</span>
    </form>`, null);
  try { const u = localStorage.getItem('ultimoUsuario'); if (u) { $('l-user').value = u; } } catch {}
  $('l-esq').onclick = () => $('l-esq-msg').classList.remove('hidden');
  $('f-login').addEventListener('submit', async e => {
    e.preventDefault(); erro('l-erro', '');
    const b = e.submitter || $('f-login').querySelector('[type=submit]'); b.disabled = true;
    try {
      await post('/api/login', { usuario: $('l-user').value.trim(), senha: $('l-pass').value });
      try { localStorage.setItem('ultimoUsuario', $('l-user').value.trim().toLowerCase()); } catch {}
      await iniciar();
    } catch (err) { erro('l-erro', err.message); b.disabled = false; }
  });
}

// ---------- C2 · Minhas despesas ----------
async function telaInicio() {
  despesas = await api('/api/despesas');
  const meses = [...new Set([hoje().slice(0, 7), ...despesas.map(d => d.data.slice(0, 7))])].sort().reverse();
  const lista = mesSel === 'todas' ? despesas : despesas.filter(d => d.data.startsWith(mesSel));
  const total = lista.reduce((s, d) => s + d.valor, 0);
  const aprov = lista.filter(d => d.status === 'Aprovada').length, anal = lista.filter(d => d.status === 'Em análise').length, rec = lista.filter(d => d.status === 'Recusada').length;
  const nomeMes = ym => MESES[Number(ym.slice(5)) - 1] + '/' + ym.slice(0, 4);
  mostrar(`
    <div class="m-head">
      <div class="grow"><h2>Olá, ${esc(me.nome.split(' ')[0])} 👋</h2><p>${mesSel === 'todas' ? 'Todas as suas despesas' : 'Suas despesas de ' + nomeMes(mesSel)}</p></div>
      <select class="input" id="i-mes">${meses.map(m => `<option value="${m}"${m === mesSel ? ' selected' : ''}>${MES_CURTO[Number(m.slice(5)) - 1]}/${m.slice(2, 4)}</option>`).join('')}<option value="todas"${mesSel === 'todas' ? ' selected' : ''}>Todas</option></select>
    </div>
    <div class="hero">
      <span class="l">${mesSel === 'todas' ? 'Total geral' : 'Total no mês'}</span>
      <span class="v">${brl(total)}</span>
      <span class="d">${lista.length} despesa${lista.length === 1 ? '' : 's'} · ${aprov} aprovada${aprov === 1 ? '' : 's'} · ${anal} em análise${rec ? ` · ${rec} recusada${rec === 1 ? '' : 's'}` : ''}</span>
    </div>
    <div class="sec-title"><span>Minhas despesas</span>${mesSel !== 'todas' ? '<button class="link" id="i-todas">Ver todas</button>' : ''}</div>
    <div class="list" id="i-lista">
      ${lista.map(d => `<button class="item" data-id="${esc(d.id)}">${icone(d.categoria)}
        <div class="grow"><div class="t">${esc(d.categoria)}</div><div class="s">${d.observacao ? esc(d.observacao) + ' · ' : ''}${dm(d.data)}</div></div>
        <div class="r"><b>${brl(d.valor)}</b>${badge(d.status)}</div></button>`).join('') || '<div class="empty">Nenhuma despesa neste mês.<br>Toque no + para lançar.</div>'}
    </div>
    <button class="fab" id="i-fab" aria-label="Nova despesa">+</button>`, 'inicio');
  $('i-mes').onchange = e => { mesSel = e.target.value; telaInicio(); };
  if ($('i-todas')) $('i-todas').onclick = () => { mesSel = 'todas'; telaInicio(); };
  $('i-fab').onclick = telaNova;
  document.querySelectorAll('#i-lista .item').forEach(b => b.onclick = () => telaDetalhe(despesas.find(d => d.id === b.dataset.id)));
}

// ---------- C3 · Nova despesa ----------
function telaNova() {
  let cat = '', centavos = 0;
  mostrar(`
    <div class="m-title"><button class="iconbtn" id="n-voltar" aria-label="Voltar"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg></button><h2>Nova despesa</h2></div>
    <div class="photo"><span style="font-size:28px">📷</span><span>Foto da nota</span><span class="pill">Em breve · fase 2</span></div>
    <div class="field"><label>Categoria</label><div class="chips" id="n-cats">${categorias.map(c => `<button type="button" class="chip" data-cat="${esc(c.nome)}">${esc(c.nome)}</button>`).join('')}</div></div>
    <div class="row2" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label for="n-valor">Valor</label><input class="input" id="n-valor" inputmode="numeric" placeholder="R$ 0,00" autocomplete="off"></div>
      <div class="field"><label for="n-data">Data</label><input class="input" id="n-data" type="date" value="${hoje()}" max="${hoje()}"></div>
    </div>
    <div class="field"><label for="n-obs" id="n-obs-l">Observação</label><input class="input" id="n-obs" maxlength="200" placeholder="Ex.: Lavação do veículo"></div>
    <span class="tip">Dica: guarde a nota. O valor precisa ser igual ao da nota.</span>
    <div id="n-erro" class="alert hidden"></div>
    <button class="btn lg block" id="n-enviar">Enviar despesa</button>`, 'nova');
  $('n-voltar').onclick = telaInicio;
  document.querySelectorAll('#n-cats .chip').forEach(b => b.onclick = () => {
    cat = b.dataset.cat;
    document.querySelectorAll('#n-cats .chip').forEach(x => x.classList.toggle('on', x === b));
    $('n-obs-l').textContent = cat === 'Outros' ? 'Observação (obrigatória)' : 'Observação';
  });
  // Valor digitado como numa calculadora (centavos primeiro): cada dígito entra no fim
  // e "apagar" tira o último dígito, não importa onde esteja o cursor.
  const campoValor = $('n-valor');
  const fimValor = () => setTimeout(() => campoValor.setSelectionRange(campoValor.value.length, campoValor.value.length));
  const mudaValor = c => { centavos = c; campoValor.value = c ? brl(c / 100) : ''; fimValor(); };
  campoValor.addEventListener('beforeinput', e => {
    const tudo = campoValor.selectionStart === 0 && campoValor.selectionEnd === campoValor.value.length;
    if (e.inputType === 'insertText') {
      e.preventDefault();
      const d = String(e.data || '').replace(/\D/g, '');
      if (d) mudaValor(Number(((tudo ? '' : String(centavos)) + d).slice(-9)));
    } else if (e.inputType.startsWith('delete')) {
      e.preventDefault();
      mudaValor(tudo ? 0 : Math.floor(centavos / 10));
    }
  });
  campoValor.addEventListener('input', e => mudaValor(Number(e.target.value.replace(/\D/g, '').slice(-9) || 0)));
  campoValor.addEventListener('focus', fimValor);
  campoValor.addEventListener('click', fimValor);
  $('n-enviar').onclick = async () => {
    erro('n-erro', '');
    if (!cat) return erro('n-erro', 'Escolha a categoria.');
    if (!centavos) return erro('n-erro', 'Informe o valor da nota.');
    const b = $('n-enviar'); b.disabled = true; b.textContent = 'Enviando...';
    try {
      ultima = await post('/api/despesas', { categoria: cat, valor: centavos / 100, data: $('n-data').value, observacao: $('n-obs').value });
      telaEnviada();
    } catch (err) { erro('n-erro', err.message); b.disabled = false; b.textContent = 'Enviar despesa'; }
  };
}

// ---------- C4 · Despesa enviada ----------
function telaEnviada() {
  const d = ultima;
  mostrar(`
    <div class="success"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>
    <div class="center"><h2 style="margin:0 0 6px;font-size:20px">Despesa enviada!</h2>
      <p style="margin:0 0 10px;font-size:13px">${brl(d.valor)} · ${esc(d.categoria)} · ${dmy(d.data)}</p>
      <p class="muted small" style="margin:0">Ela fica "Em análise" até o Maurício aprovar.<br>Você acompanha tudo em Minhas despesas.</p></div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">
      <button class="btn lg block" id="o-ver">Ver minhas despesas</button>
      <button class="btn lg block secondary" id="o-outra">Lançar outra despesa</button>
    </div>`, 'nova');
  $('o-ver').onclick = () => { mesSel = d.data.slice(0, 7); telaInicio(); };
  $('o-outra').onclick = telaNova;
}

// ---------- C5 · Detalhe da despesa ----------
function telaDetalhe(d) {
  const quando = iso => { if (!iso) return ''; const x = new Date(iso); return x.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' · ' + x.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }); };
  const dataAval = d.avaliadoEm ? new Date(d.avaliadoEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
  const linha = d.status === 'Aprovada' ? `<div class="okline">✓ Aprovada por ${esc(d.avaliadoPor)} em ${dataAval}</div>`
    : d.status === 'Recusada' ? `<div class="okline red">Recusada por ${esc(d.avaliadoPor)} em ${dataAval}. Fale com ele se tiver dúvida.</div>`
    : '<div class="okline amber">Aguardando aprovação do Maurício.</div>';
  mostrar(`
    <div class="m-title"><button class="iconbtn" id="d-voltar" aria-label="Voltar"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg></button><h2>Detalhe da despesa</h2></div>
    <div class="photo light"><span style="font-size:28px">🧾</span><span>Foto da nota · fase 2</span></div>
    <div class="card rows">
      <div><span>Categoria</span><span>${(VISUAL[d.categoria] || ['🧾'])[0]} ${esc(d.categoria)}</span></div>
      <div><span>Valor</span><span>${brl(d.valor)}</span></div>
      <div><span>Data da nota</span><span>${dmy(d.data)}</span></div>
      <div><span>Observação</span><span>${esc(d.observacao) || '—'}</span></div>
      <div><span>Enviada em</span><span>${quando(d.criadoEm)}</span></div>
      <div><span>Status</span><span>${badge(d.status)}</span></div>
    </div>
    ${linha}
    ${d.status === 'Em análise' ? '<div id="d-erro" class="alert hidden"></div><button class="btn lg block danger" id="d-excluir">Excluir despesa</button>' : ''}`, 'inicio');
  $('d-voltar').onclick = telaInicio;
  if ($('d-excluir')) $('d-excluir').onclick = async () => {
    if (!confirm('Excluir esta despesa?')) return;
    try { await api('/api/despesas/' + encodeURIComponent(d.id), { method: 'DELETE' }); telaInicio(); } catch (err) { erro('d-erro', err.message); }
  };
}

// ---------- Perfil ----------
function telaPerfil() {
  mostrar(`
    <div class="m-title"><h2>Perfil</h2></div>
    <div class="card rows">
      <div><span>Nome</span><span>${esc(me.nome)}</span></div>
      <div><span>Função</span><span>${esc(me.funcao)}</span></div>
      <div><span>Usuário</span><span>${esc(me.usuario)}</span></div>
    </div>
    <div class="sec-title"><span>Trocar senha</span></div>
    <div class="field"><label for="p-atual">Senha atual</label><input class="input" id="p-atual" type="password" autocomplete="current-password"></div>
    <div class="field"><label for="p-nova">Nova senha (mínimo 6 caracteres)</label><input class="input" id="p-nova" type="password" autocomplete="new-password"></div>
    <div class="field"><label for="p-conf">Repita a nova senha</label><input class="input" id="p-conf" type="password" autocomplete="new-password"></div>
    <div id="p-erro" class="alert hidden"></div>
    <div id="p-ok" class="okline hidden">Senha alterada.</div>
    <button class="btn lg block" id="p-salvar">Salvar nova senha</button>
    <button class="btn lg block secondary" id="p-sair">Sair</button>`, 'perfil');
  $('p-salvar').onclick = async () => {
    erro('p-erro', ''); $('p-ok').classList.add('hidden');
    if ($('p-nova').value !== $('p-conf').value) return erro('p-erro', 'As duas senhas novas não são iguais.');
    $('p-salvar').disabled = true;
    try {
      await post('/api/me/senha', { atual: $('p-atual').value, nova: $('p-nova').value });
      ['p-atual', 'p-nova', 'p-conf'].forEach(id => { $(id).value = ''; });
      $('p-ok').classList.remove('hidden');
    } catch (err) { erro('p-erro', err.message); }
    $('p-salvar').disabled = false;
  };
  $('p-sair').onclick = async () => { try { await fetch('/api/logout', { method: 'POST' }); } catch {} telaLogin(); };
}

// ---------- início ----------
async function iniciar() {
  me = await api('/api/me');
  if (!categorias.length) categorias = await api('/api/categorias');
  await telaInicio();
}
iniciar().catch(err => {
  // 401 já leva ao login; qualquer outro erro (servidor fora do ar, sem internet) mostra aviso em vez de tela em branco
  if (me || err.login) return;
  telaLogin();
  erro('l-erro', 'Não foi possível conectar ao servidor. Tente de novo em instantes.');
});
