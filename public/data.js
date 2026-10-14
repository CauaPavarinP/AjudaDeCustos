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
    <input class="input" id="${id}" inputmode="numeric" placeholder="dd/mm/aaaa" maxlength="10" autocomplete="off" value="${isoParaBr(iso)}">
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
  // Máscara: só números; as barras entram sozinhas (dd/mm/aaaa)
  campo.addEventListener('input', e => {
    if (!e.isTrusted) return;
    const d = campo.value.replace(/\D/g, '').slice(0, 8);
    campo.value = d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
    const iso = brParaIso(campo.value);
    if (iso) { cal.value = iso; avisa(); }
  });
  // Calendário do aparelho
  cal.addEventListener('click', () => { try { cal.showPicker(); } catch { /* navegador antigo: abre pelo clique normal */ } });
  cal.addEventListener('change', () => { if (cal.value) { campo.value = isoParaBr(cal.value); avisa(); } });
}
