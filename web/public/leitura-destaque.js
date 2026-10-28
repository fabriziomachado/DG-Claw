'use strict';
/* leitura-destaque.js: marca-texto da leitura em voz alta (27/10/2026, pedido do dono).

   Enquanto a resposta é lida, a frase em curso fica pintada de leve e, quando a voz avisa as palavras
   (voz do aparelho no Edge e no iPhone), a palavra também. O texto da tela não é tocado: o destaque usa
   a CSS Custom Highlight API (Range por cima do DOM). Navegador sem ela fica sem destaque, só isso.

   A fala é o texto limpo (sem markdown, links, código) e a tela é o texto formatado. Para casar os dois,
   os dois lados viram só letras e números em minúsculas, com um mapa de volta para a posição na tela.
   As partes que só mexem em texto (normaliza, frases, acha) ficam fora do DOM e têm teste. */
(function (raiz, fabrica) {
  const m = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.DGLeituraDestaque = m;
})(this, function (raiz) {
  const LETRA = /[\p{L}\p{N}]/u;

  /** Só letras e números, minúsculos. `mapa[k]` = posição no texto original do k-ésimo caractere. */
  function normaliza(texto) {
    let n = ''; const mapa = [];
    const t = String(texto || '');
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (LETRA.test(c)) { n += c.toLowerCase(); mapa.push(i); }
    }
    return { n, mapa };
  }
  const tamNorm = s => normaliza(s).n.length;

  /** Frases do trecho falado: [{ ini, fim }] em posições do trecho. */
  function frases(trecho) {
    const t = String(trecho || ''), out = [], re = /[^.!?…\n]+[.!?…]*\s*/g;
    let m;
    while ((m = re.exec(t))) if (m[0].trim()) out.push({ ini: m.index, fim: m.index + m[0].length });
    return out.length ? out : [{ ini: 0, fim: t.length }];
  }

  /** Onde o trecho falado começa no texto da tela (normalizado), a partir de `desde`. -1 se não achou. */
  function acha(telaN, trechoN, desde) {
    if (!trechoN) return -1;
    const tenta = (agulha, de) => telaN.indexOf(agulha, de);
    let i = tenta(trechoN, desde);
    if (i < 0) i = tenta(trechoN.slice(0, 40), desde);
    if (i < 0) i = tenta(trechoN.slice(0, 40), 0);
    return i;
  }

  if (!raiz || !raiz.document) return { normaliza, frases, acha, tamNorm };

  /* ── Parte com DOM ── */
  const doc = raiz.document;
  const temApi = () => !!(raiz.CSS && raiz.CSS.highlights && typeof raiz.Highlight === 'function');
  const PULA = 'pre,table,button,svg,.selo-fila,.acoes,.hora,script,style';

  let atual = null;   // { bub, tela:{texto,nos,n,mapa}, cursor, trecho, ini (normalizado), frases, frase }

  function lerTela(bub) {
    const nos = []; let texto = '';
    const anda = doc.createTreeWalker(bub, 4 /* NodeFilter.SHOW_TEXT */, {
      acceptNode: no => (no.parentElement && no.parentElement.closest(PULA) ? 2 : 1),
    });
    for (let no = anda.nextNode(); no; no = anda.nextNode()) { nos.push({ no, ini: texto.length }); texto += no.data; }
    const { n, mapa } = normaliza(texto);
    return { texto, nos, n, mapa };
  }

  /* posição no texto da tela -> (nó, deslocamento) */
  function ponto(tela, pos) {
    let lo = 0, hi = tela.nos.length - 1;
    while (lo < hi) { const md = (lo + hi + 1) >> 1; if (tela.nos[md].ini <= pos) lo = md; else hi = md - 1; }
    const e = tela.nos[lo];
    return e ? { no: e.no, off: Math.min(pos - e.ini, e.no.data.length) } : null;
  }
  /* faixa normalizada [nIni, nFim) -> Range na tela */
  function faixa(tela, nIni, nFim) {
    if (nFim <= nIni || nIni >= tela.mapa.length) return null;
    const a = ponto(tela, tela.mapa[nIni]), b = ponto(tela, tela.mapa[Math.min(nFim, tela.mapa.length) - 1] + 1);
    if (!a || !b) return null;
    const r = doc.createRange();
    try { r.setStart(a.no, a.off); r.setEnd(b.no, b.off); } catch (e) { return null; }
    return r;
  }
  function pinta(nome, range) {
    if (!temApi()) return;
    if (range) raiz.CSS.highlights.set(nome, new raiz.Highlight(range)); else raiz.CSS.highlights.delete(nome);
  }

  /** Um pedaço novo da fala começou. `bub` é o balão da resposta; `trecho`, o texto que vai ser falado. */
  function comeca(bub, trecho) {
    if (!temApi() || !bub || !trecho) return limpa();
    if (!atual || atual.bub !== bub || !bub.isConnected) atual = { bub, tela: lerTela(bub), cursor: 0 };
    const tn = normaliza(trecho).n, ini = acha(atual.tela.n, tn, atual.cursor);
    if (ini < 0) { atual.trecho = null; pinta('dg-lendo-palavra', null); pinta('dg-lendo-frase', null); return; }
    Object.assign(atual, { trecho, ini, frases: frases(trecho), frase: -1 });
    atual.cursor = ini + tn.length;
    pinta('dg-lendo-palavra', null);
    frase(0);
  }
  function frase(j) {
    if (!atual || !atual.trecho || j === atual.frase || !atual.frases[j]) return;
    atual.frase = j;
    const f = atual.frases[j], t = atual.trecho;
    const nIni = atual.ini + tamNorm(t.slice(0, f.ini)), nFim = nIni + tamNorm(t.slice(f.ini, f.fim));
    pinta('dg-lendo-frase', faixa(atual.tela, nIni, nFim));
  }
  /** A voz do aparelho avisou a palavra (posição dentro do trecho). */
  function palavra(pos, tam) {
    if (!atual || !atual.trecho) return;
    const t = atual.trecho;
    const j = atual.frases.findIndex(f => pos >= f.ini && pos < f.fim);
    if (j >= 0) frase(j);
    const w = tam > 0 ? t.substr(pos, tam) : (t.slice(pos).match(/^\S+/) || [''])[0];
    const nIni = atual.ini + tamNorm(t.slice(0, pos));
    pinta('dg-lendo-palavra', faixa(atual.tela, nIni, nIni + tamNorm(w)));
  }
  /** Áudio (ElevenLabs): sem aviso de palavra, a frase segue a proporção do tempo tocado. */
  function progresso(frac) {
    if (!atual || !atual.trecho || !(frac >= 0)) return;
    const alvo = frac * atual.trecho.length;
    let j = atual.frases.findIndex(f => alvo < f.fim);
    if (j < 0) j = atual.frases.length - 1;
    frase(j);
  }
  function limpa() {
    atual = null;
    pinta('dg-lendo-palavra', null);
    pinta('dg-lendo-frase', null);
  }

  return { normaliza, frases, acha, tamNorm, comeca, palavra, progresso, limpa };
});
