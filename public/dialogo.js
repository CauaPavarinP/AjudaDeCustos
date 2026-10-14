// Janelas de aviso e confirmação no visual do sistema (no lugar de alert() e confirm() do navegador).
// Uso:
//   await avisar('Mensagem');                                  -> mostra e espera o OK
//   if (await confirmar('Excluir?', { ok: 'Excluir', perigo: true })) { ... }
// Abrem por cima de qualquer outra janela; Esc ou clique fora = Cancelar.
(function () {
  function abrir({ titulo, mensagem, botoes, valorFora }) {
    return new Promise(resolver => {
      const fundo = document.createElement('div');
      fundo.className = 'modal-bg dialogo-bg';
      fundo.innerHTML = `<div class="card modal dialogo" role="alertdialog" aria-modal="true">
        <h3></h3><p></p><div class="acts"></div></div>`;
      fundo.querySelector('h3').textContent = titulo;
      fundo.querySelector('p').textContent = mensagem;
      const fechar = valor => {
        window.removeEventListener('keydown', teclas, true);
        fundo.remove();
        if (anterior && anterior.focus) anterior.focus();
        resolver(valor);
      };
      const teclas = e => {
        if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); fechar(valorFora); }
      };
      botoes.forEach(b => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = b.classe;
        el.textContent = b.rotulo;
        el.onclick = () => fechar(b.valor);
        fundo.querySelector('.acts').appendChild(el);
      });
      fundo.addEventListener('click', e => { if (e.target === fundo) fechar(valorFora); });
      window.addEventListener('keydown', teclas, true); // antes dos outros atalhos (ex.: Esc do painel)
      const anterior = document.activeElement;
      document.body.appendChild(fundo);
      fundo.querySelector('.acts button:last-child').focus();
    });
  }

  window.avisar = (mensagem, titulo = 'Atenção') =>
    abrir({ titulo, mensagem, valorFora: true, botoes: [{ rotulo: 'OK', valor: true, classe: 'btn' }] });

  window.confirmar = (mensagem, { titulo = 'Confirmar', ok = 'Confirmar', cancelar = 'Cancelar', perigo = false } = {}) =>
    abrir({
      titulo, mensagem, valorFora: false,
      botoes: [
        { rotulo: cancelar, valor: false, classe: 'btn secondary' },
        { rotulo: ok, valor: true, classe: perigo ? 'btn perigo' : 'btn' },
      ],
    });

  window.dialogoAberto = () => !!document.querySelector('.dialogo-bg');
})();
