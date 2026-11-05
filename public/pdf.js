// Gera um arquivo .pdf no navegador, sem biblioteca externa (mesma ideia do xlsx.js).
// Usa as fontes padrão do PDF (Helvetica e Helvetica-Bold), que todo leitor de PDF já tem,
// com a codificação WinAnsi (cobre os acentos do português: á, ã, ç, ê, õ...).
//
// Uso:
//   const doc = novoPdf();            // folha A4 em pé; medidas em pontos (1 cm ≈ 28,35 pt), origem no canto de cima
//   doc.pagina();
//   doc.texto(60, 90, 'Olá', { tam: 12, negrito: true, italico: true, alinhar: 'esq' | 'centro' | 'dir', cor: [0, 0, 0] });
//     (italico só junto com negrito: Helvetica-BoldOblique, mesma largura do negrito)
//   doc.linha(60, 100, 300, 100, { larg: 0.8 });
//   doc.ret(60, 110, 200, 30, { fundo: [0.75, 0.75, 0.75], borda: true });
//   doc.largura('texto', 12, false)   // largura do texto em pontos (para centralizar ou cortar)
//   doc.baixar('nome-do-arquivo');    // baixa "nome-do-arquivo.pdf"
(function () {
  const A4 = { larg: 595.28, alt: 841.89 };
  // Largura de cada caractere (de " " a "~") em milésimos do tamanho da fonte (tabelas oficiais da Helvetica)
  const LARG = {
    normal: [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584],
    negrito: [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584],
  };
  // Caracteres fora do Latin-1 que existem na WinAnsi
  const WIN = { '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97 };
  const codigo = ch => {
    if (WIN[ch]) return WIN[ch];
    const c = ch.charCodeAt(0);
    return (c >= 32 && c < 127) || (c >= 0xa0 && c <= 0xff) ? c : 63; // "?" para o que a fonte não tem
  };
  // Letra acentuada tem a mesma largura da letra sem acento (á = a, Ç = C)
  const larguraChar = (ch, negrito) => {
    const base = ch.normalize('NFD')[0], c = base.charCodeAt(0);
    return c >= 32 && c <= 126 ? LARG[negrito ? 'negrito' : 'normal'][c - 32] : 556;
  };
  const num = n => (Math.round(n * 100) / 100).toString();
  const cor = c => (c || [0, 0, 0]).map(num).join(' ');

  window.novoPdf = function () {
    const paginas = [];
    let atual = null;
    const largura = (txt, tam = 12, negrito = false) =>
      [...String(txt ?? '').normalize('NFC')].reduce((s, ch) => s + larguraChar(ch, negrito), 0) * tam / 1000;
    const y = v => A4.alt - v; // o PDF conta de baixo para cima; aqui contamos de cima para baixo
    const doc = {
      larg: A4.larg, alt: A4.alt, largura,
      pagina() { atual = []; paginas.push(atual); return doc; },
      texto(x, yy, txt, o = {}) {
        const tam = o.tam || 12, s = String(txt ?? '');
        if (!s) return doc;
        const w = largura(s, tam, o.negrito);
        const x0 = o.alinhar === 'centro' ? x - w / 2 : o.alinhar === 'dir' ? x - w : x;
        const bytes = [...s.normalize('NFC')].map(ch => { const c = codigo(ch); return c === 40 || c === 41 || c === 92 ? '\\' + String.fromCharCode(c) : String.fromCharCode(c); }).join('');
        atual.push(`BT ${cor(o.cor)} rg /${o.negrito ? (o.italico ? 'F3' : 'F2') : 'F1'} ${num(tam)} Tf ${num(x0)} ${num(y(yy))} Td (${bytes}) Tj ET`);
        return doc;
      },
      linha(x1, y1, x2, y2, o = {}) {
        atual.push(`${cor(o.cor)} RG ${num(o.larg || 0.8)} w ${num(x1)} ${num(y(y1))} m ${num(x2)} ${num(y(y2))} l S`);
        return doc;
      },
      ret(x, yy, w, h, o = {}) {
        const r = `${num(x)} ${num(y(yy + h))} ${num(w)} ${num(h)} re`;
        if (o.fundo) atual.push(`${cor(o.fundo)} rg ${r} f`);
        if (o.borda !== false) atual.push(`${cor(o.corBorda)} RG ${num(o.larg || 0.8)} w ${r} S`);
        return doc;
      },
      // Corta o texto com "…" para caber na largura
      caber(txt, max, tam = 12, negrito = false) {
        let s = String(txt ?? '');
        if (largura(s, tam, negrito) <= max) return s;
        while (s && largura(s + '…', tam, negrito) > max) s = s.slice(0, -1);
        return s.trimEnd() + '…';
      },
      blob() {
        const objs = [];
        const add = corpo => { objs.push(corpo); return objs.length; };
        const catalogo = add(''), pags = add('');
        const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
        const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
        const f3 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-BoldOblique /Encoding /WinAnsiEncoding >>');
        const filhos = paginas.map(cmds => {
          const conteudo = cmds.join('\n');
          const c = add(`<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`);
          return add(`<< /Type /Page /Parent ${pags} 0 R /MediaBox [0 0 ${A4.larg} ${A4.alt}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R /F3 ${f3} 0 R >> >> /Contents ${c} 0 R >>`);
        });
        objs[catalogo - 1] = `<< /Type /Catalog /Pages ${pags} 0 R >>`;
        objs[pags - 1] = `<< /Type /Pages /Kids [${filhos.map(n => n + ' 0 R').join(' ')}] /Count ${filhos.length} >>`;
        // Cada caractere já é um byte (0–255), então o tamanho do texto é o tamanho em bytes
        let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
        const pos = objs.map((corpo, i) => { const p = pdf.length; pdf += `${i + 1} 0 obj\n${corpo}\nendobj\n`; return p; });
        const xref = pdf.length;
        pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${pos.map(p => String(p).padStart(10, '0') + ' 00000 n \n').join('')}`;
        pdf += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogo} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
        const bytes = new Uint8Array(pdf.length);
        for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
        return new Blob([bytes], { type: 'application/pdf' });
      },
      baixar(nomeArquivo) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(doc.blob());
        a.download = nomeArquivo + '.pdf';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      },
    };
    return doc;
  };
})();
