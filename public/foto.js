// Reduz a foto no próprio navegador antes de enviar (até 1600 px, JPEG): envio rápido e pouca internet.
// Usado pelo app do colaborador e pelo painel. Devolve "data:image/jpeg;base64,...".
/* exported comprimirFoto */
function comprimirFoto(arquivo) {
  return new Promise((ok, falha) => {
    const url = URL.createObjectURL(arquivo), img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const escala = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * escala); c.height = Math.round(img.naturalHeight * escala);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      let q = 0.75, dados = c.toDataURL('image/jpeg', q);
      while (dados.length > 1800000 && q > 0.4) { q -= 0.1; dados = c.toDataURL('image/jpeg', q); }
      ok(dados);
    };
    img.onerror = () => { URL.revokeObjectURL(url); falha(new Error('Não foi possível abrir esta imagem. Tente outra foto ou use a câmera.')); };
    img.src = url;
  });
}
