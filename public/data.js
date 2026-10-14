// Campo de data sempre no formato brasileiro dd/mm/aaaa.
// O <input type="date"> do navegador mostra a data no formato do IDIOMA DO NAVEGADOR (ex.: Chrome em
// inglês mostra mm/dd/aaaa). Aqui o campo visível é texto com máscara, e o botão 📅 abre o calendário do
// aparelho (um <input type="date"> invisível por cima do botão). Por dentro, o valor continua AAAA-MM-DD.
//
// Uso:
//   html:   ${campoData('n-data', '2026-10-14', { min: '2000-01-01', max: '2026-10-14' })}
//   depois: ligarData('n-data');            // dispara "change" no campo quando a data fica completa
//           lerData('n-data')  -> '2026-10-14' (ou '' se incompleta)
//           definirData('n-data', '2026-10-20')

const isoParaBr = iso => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('/') : '');

function campoData(id, iso = '', { min = '', max = '' } = {}) {
  return `<div class="data-br">
    <input class="input" id="${id}" inputmode="numeric" placeholder="dd/mm/aaaa" autocomplete="off" value="${isoParaBr(iso)}">
    <input type="date" class="data-nativa" id="${id}-cal" tabindex="-1" aria-label="Abrir calendário"${min ? ` min="${min}"` : ''}${max ? ` max="${max}"` : ''} value="${iso || ''}">
    <span class="data-icone" aria-hidden="true">📅</span>
  </div>`;
}

// "14/10/2026" -> "2026-10-14"; incompleta -> ''. Data inexistente (ex.: 31/02) também vira AAAA-MM-DD,
// e o servidor responde com a mensagem de data inválida.
function brParaIso(txt) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(txt || '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
const lerData = id => brParaIso(document.getElementById(id).value);

function definirData(id, iso) {
  document.getElementById(id).value = isoParaBr(iso);
  document.getElementById(id + '-cal').value = iso || '';
}

function ligarData(id) {
  const campo = document.getElementById(id), cal = document.getElementById(id + '-cal');
  const avisa = () => campo.dispatchEvent(new Event('change', { bubbles: true }));
  // Máscara: só números; as barras entram sozinhas (dd/mm/aaaa).
  // O cursor fica onde a pessoa está digitando (dá para corrigir só o dia, por exemplo):
  // com o campo cheio, digitar no meio escreve por cima; apagar em cima de uma barra apaga o número ao lado.
  const formata = d => (d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d);
  const posicaoDoDigito = (txt, n) => { // posição no texto logo depois do n-ésimo número
    if (n <= 0) return 0;
    for (let i = 0, vistos = 0; i < txt.length; i++) if (/\d/.test(txt[i]) && ++vistos === n) return i + 1;
    return txt.length;
  };
  let anteriores = campo.value.replace(/\D/g, '');
  campo.addEventListener('input', e => {
    if (!e.isTrusted) return;
    const cursor = campo.selectionStart ?? campo.value.length;
    let d = campo.value.replace(/\D/g, '');
    let k = campo.value.slice(0, cursor).replace(/\D/g, '').length; // números antes do cursor
    if (d === anteriores && e.inputType === 'deleteContentBackward' && k > 0) { d = d.slice(0, k - 1) + d.slice(k); k--; } // apagou uma barra
    else if (d === anteriores && e.inputType === 'deleteContentForward') d = d.slice(0, k) + d.slice(k + 1);
    if (d.length > 8) d = d.slice(0, k) + d.slice(k + 1); // campo cheio: escreve por cima
    d = d.slice(0, 8);
    anteriores = d;
    campo.value = formata(d);
    const pos = posicaoDoDigito(campo.value, Math.min(k, d.length));
    campo.setSelectionRange(pos, pos);
    const iso = brParaIso(campo.value);
    if (iso) { cal.value = iso; avisa(); }
  });
  // Calendário do aparelho
  cal.addEventListener('click', () => { try { cal.showPicker(); } catch { /* navegador antigo: abre pelo clique normal */ } });
  cal.addEventListener('change', () => { if (cal.value) { campo.value = isoParaBr(cal.value); anteriores = campo.value.replace(/\D/g, ''); avisa(); } });
  campo.addEventListener('focus', () => { anteriores = campo.value.replace(/\D/g, ''); }); // valor pode ter vindo de definirData
}
