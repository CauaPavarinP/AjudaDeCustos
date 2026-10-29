// Fotos das notas fiscais.
// Produção: Cloudinary (conta gratuita), com as fotos em modo "authenticated": não ficam públicas.
// Quem vê a foto é o nosso servidor, que confere o login e repassa a imagem para a tela.
// Desenvolvimento sem Cloudinary: memória (as fotos somem ao reiniciar).
//
// Configuração: variável CLOUDINARY_URL, copiada do painel do Cloudinary
// (formato cloudinary://API_KEY:API_SECRET@CLOUD_NAME).

const crypto = require('crypto');

const PASTA = 'ajuda-de-custo';
const TAMANHO_MAXIMO = 3 * 1024 * 1024; // 3 MB depois de comprimida no celular (normalmente fica bem abaixo)

// Recebe "data:image/jpeg;base64,..." e devolve o Buffer, ou um texto de erro
function lerDataUrl(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return { erro: 'Formato de foto inválido.' };
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8) return { erro: 'Formato de foto inválido.' };
  if (buf.length > TAMANHO_MAXIMO) return { erro: 'Foto muito grande.' };
  return { buf };
}

// Aceita o valor colado com "CLOUDINARY_URL=" na frente, entre aspas ou com espaços sobrando
function limparUrl(bruto) {
  return String(bruto || '').trim()
    .replace(/^CLOUDINARY_URL\s*=\s*/i, '')
    .replace(/^["']+|["']+$/g, '')
    .replace(/\s+/g, '');
}
function lerConfig(env) {
  const url = limparUrl(env.CLOUDINARY_URL);
  const m = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(url);
  if (!m || /[<>]/.test(url)) return null;
  return { apiKey: m[1], apiSecret: m[2], cloud: m[3], base: env.CLOUDINARY_API_BASE || 'https://api.cloudinary.com' };
}
// Diz o que está errado no valor, sem nunca mostrar a chave ou o segredo
function problemaUrl(bruto) {
  const url = limparUrl(bruto);
  if (!url.startsWith('cloudinary://')) return 'o valor precisa começar com cloudinary://';
  if (/[<>]/.test(url)) return 'ainda tem <your_api_key> ou <your_api_secret>; troque pelos valores reais da tabela API Keys';
  const resto = url.slice('cloudinary://'.length);
  if (!resto.includes('@')) return 'falta o @ e o nome da nuvem no fim (ex.: @es2gjfq9)';
  if (!resto.split('@')[0].includes(':')) return 'falta o ":" entre a API Key e o API Secret';
  if (!resto.split('@').pop()) return 'falta o nome da nuvem depois do @';
  return 'formato não reconhecido';
}

// Assinatura do Cloudinary: parâmetros em ordem alfabética, "chave=valor" unidos por "&",
// seguidos do API secret, em SHA-1 (hex).
function assinar(params, segredo) {
  const txt = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  return crypto.createHash('sha1').update(txt + segredo).digest('hex');
}

function criarCloudinary(cfg) {
  const api = acao => `${cfg.base}/v1_1/${encodeURIComponent(cfg.cloud)}/image/${acao}`;
  const assinados = params => {
    const p = { ...params, timestamp: Math.floor(Date.now() / 1000) };
    return { ...p, api_key: cfg.apiKey, signature: assinar(p, cfg.apiSecret) };
  };
  return {
    modo: 'cloudinary',
    async salvar(id, buf) {
      const publicId = `${PASTA}/${id}-${crypto.randomBytes(6).toString('hex')}`;
      const corpo = new URLSearchParams({
        ...assinados({ public_id: publicId, type: 'authenticated' }),
        file: 'data:image/jpeg;base64,' + buf.toString('base64'),
      });
      const r = await fetch(api('upload'), { method: 'POST', body: corpo });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.public_id) throw new Error('Cloudinary upload: ' + (j.error && j.error.message || r.status));
      return j.public_id;
    },
    async ler(ref) {
      // Link de download privado (assinado), válido por poucos minutos, usado só pelo servidor
      const params = assinados({ public_id: ref, format: 'jpg', type: 'authenticated', expires_at: Math.floor(Date.now() / 1000) + 300 });
      const r = await fetch(api('download') + '?' + new URLSearchParams(params));
      if (!r.ok) throw Object.assign(new Error('Cloudinary download: ' + r.status), { naoExiste: r.status === 404 });
      return Buffer.from(await r.arrayBuffer());
    },
    async apagar(ref) {
      const corpo = new URLSearchParams(assinados({ public_id: ref, type: 'authenticated', invalidate: 'true' }));
      const r = await fetch(api('destroy'), { method: 'POST', body: corpo });
      if (!r.ok) throw new Error('Cloudinary destroy: ' + r.status);
    },
  };
}

function criarMemoria() {
  const fotos = new Map();
  return {
    modo: 'memoria',
    async salvar(id, buf) { const ref = `${PASTA}/${id}-${crypto.randomBytes(6).toString('hex')}`; fotos.set(ref, buf); return ref; },
    async ler(ref) { if (!fotos.has(ref)) throw Object.assign(new Error('Foto não encontrada.'), { naoExiste: true }); return fotos.get(ref); },
    async apagar(ref) { fotos.delete(ref); },
  };
}

// Sem Cloudinary em produção, as fotos ficam desligadas (o resto do sistema funciona normalmente)
function criarFotos(env) {
  const cfg = lerConfig(env);
  if (cfg) return criarCloudinary(cfg);
  if (env.CLOUDINARY_URL) console.warn(`[fotos] CLOUDINARY_URL em formato inválido (${problemaUrl(env.CLOUDINARY_URL)}). Fotos desligadas.`);
  if (env.NODE_ENV === 'production') {
    if (!env.CLOUDINARY_URL) console.warn('[fotos] Sem CLOUDINARY_URL: envio de fotos desligado.');
    return null;
  }
  console.warn('[fotos] Sem CLOUDINARY_URL: fotos em memória (apenas para testes locais).');
  return criarMemoria();
}

module.exports = { criarFotos, lerDataUrl, assinar };
