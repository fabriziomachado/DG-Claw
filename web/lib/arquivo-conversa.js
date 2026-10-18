'use strict';
// Conversas arquivadas (18/10/2026, pedido do dono): o /clear (ou /new) limpa a tela da conversa e a
// parte anterior vai para o Histórico, na lista "Arquivadas".
//
// A thread continua sendo a de todas as sessões do agente (conversa.js); o que muda é o que a tela
// mostra. Cada /clear grava um corte (o ep, em segundos, do momento) em <dataDir>/arquivo/<slug>.json.
// A tela, a espera e o stream veem só o que veio depois do último corte (threadVisivel); os trechos
// entre um corte e outro são as conversas arquivadas. Nada é apagado: transcript, índice de busca,
// alertas e compartilhados seguem lendo a thread inteira.

const fs = require('node:fs');
const path = require('node:path');

const MAX_CORTES = 500;
const TITULO = 80;

/** Texto curto de uma mensagem para título e prévia: sem markdown pesado nem etiqueta de alerta. */
function resumo(texto, max) {
  const t = String(texto || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\[(ENTREGA|PEDIDO)\]\s*/i, '')
    .replace(/[*_#>`|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

/**
 * Os trechos arquivados de uma thread: [{ id, de, ate, total, titulo, previa }], o mais novo primeiro.
 * `id` é o ep do corte que fechou o trecho. Trecho sem mensagem nenhuma não entra.
 */
function trechosArquivados(msgs, cortes) {
  const lista = [];
  let antes = -Infinity;
  for (const c of cortes) {
    const dentro = msgs.filter((m) => m.ep > antes && m.ep <= c);
    antes = c;
    if (!dentro.length) continue;
    const doDono = dentro.find((m) => m.origin === 'dono' && resumo(m.text, 4));
    const doAgente = dentro.find((m) => m.origin !== 'dono' && resumo(m.text, 4));
    lista.push({
      id: c, de: dentro[0].ep, ate: dentro[dentro.length - 1].ep, total: dentro.length,
      titulo: resumo((doDono || doAgente || dentro[0]).text, TITULO) || 'Conversa sem texto',
      previa: doAgente ? resumo(doAgente.text, 140) : '',
    });
  }
  return lista.reverse();
}

function criarArquivoConversa({ dataDir, log = () => {} }) {
  const pasta = path.join(dataDir, 'arquivo');
  const cache = new Map(); // slug -> cortes
  const visiveis = new Map(); // slug -> { fonte, corte, msgs }: mesma lista enquanto nada muda

  const arquivo = (slug) => path.join(pasta, `${slug}.json`);
  function cortes(slug) {
    if (cache.has(slug)) return cache.get(slug);
    let c = [];
    try {
      const d = JSON.parse(fs.readFileSync(arquivo(slug), 'utf8'));
      if (Array.isArray(d.cortes)) c = d.cortes.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    } catch (e) {
      if (e.code !== 'ENOENT') log('aviso', `Arquivo de conversas de ${slug} ilegível (${e.message}); sigo sem cortes.`);
    }
    cache.set(slug, c);
    return c;
  }
  const ultimoCorte = (slug) => { const c = cortes(slug); return c.length ? c[c.length - 1] : 0; };

  function cortar(slug, ep) {
    const c = cortes(slug).slice();
    if (c.length && ep <= c[c.length - 1]) return false;
    c.push(ep);
    while (c.length > MAX_CORTES) c.shift();
    fs.mkdirSync(pasta, { recursive: true, mode: 0o700 });
    const tmp = `${arquivo(slug)}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ cortes: c }), { mode: 0o600 });
    fs.renameSync(tmp, arquivo(slug));
    cache.set(slug, c);
    return true;
  }

  /** A thread como a tela vê: só depois do último corte. Mesma referência de lista enquanto nada muda. */
  function visivel(slug, t) {
    const corte = ultimoCorte(slug);
    if (!corte) return t;
    const v = visiveis.get(slug);
    if (v && v.fonte === t.msgs && v.corte === corte) return Object.assign({}, t, { msgs: v.msgs, corte });
    // o eco do próprio /clear chega no transcript novo um instante depois do corte: não abre a conversa nova
    const msgs = t.msgs.filter((m) => m.ep > corte && !(m.origin === 'dono' && m.ep - corte < 30 && /^\/(clear|new)\s*$/.test(String(m.text || '').trim())));
    visiveis.set(slug, { fonte: t.msgs, corte, msgs });
    return Object.assign({}, t, { msgs, corte });
  }

  return { cortes, ultimoCorte, cortar, visivel };
}

module.exports = { criarArquivoConversa, trechosArquivados, resumo };
