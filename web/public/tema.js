'use strict';
/* tema.js: o tema claro/escuro do DG Claw (18/10/2026).

   A pessoa escolhe Automático, Claro ou Escuro (localStorage "dgclaw-tema": "auto", "claro"
   ou "escuro"; sem nada guardado vale Automático). Este script resolve a escolha e SEMPRE
   põe html[data-tema="claro"|"escuro"]; no Automático segue o sistema e acompanha a troca
   na hora. Carregue no <head>, antes do CSS da tela, para a página já nascer no tema certo
   (sem piscar branco).

   API: DGTema.preferencia() -> "auto"|"claro"|"escuro"; DGTema.atual() -> "claro"|"escuro";
        DGTema.escolhe(pref) grava e aplica. Toda mudança dispara o evento "dgtema" no
        document, com detail { tema, preferencia }. */
(function (raiz) {
  if (!raiz.document || raiz.DGTema) return;
  const CHAVE = 'dgclaw-tema';
  const html = raiz.document.documentElement;
  const sistema = raiz.matchMedia ? raiz.matchMedia('(prefers-color-scheme: dark)') : null;

  function preferencia() {
    let p = null;
    try { p = raiz.localStorage.getItem(CHAVE); } catch (_) { /* sem storage: Automático */ }
    return p === 'claro' || p === 'escuro' ? p : 'auto';
  }
  function resolve(pref) {
    if (pref === 'claro' || pref === 'escuro') return pref;
    return sistema && sistema.matches ? 'escuro' : 'claro';
  }
  function aplica() {
    const pref = preferencia();
    const tema = resolve(pref);
    if (html.dataset.tema !== tema) html.dataset.tema = tema;
    raiz.document.dispatchEvent(new CustomEvent('dgtema', { detail: { tema, preferencia: pref } }));
    return tema;
  }
  function escolhe(pref) {
    try {
      if (pref === 'claro' || pref === 'escuro') raiz.localStorage.setItem(CHAVE, pref);
      else raiz.localStorage.removeItem(CHAVE);
    } catch (_) { /* sem storage: vale só nesta aba */ }
    return aplica();
  }

  if (sistema) {
    const muda = () => { if (preferencia() === 'auto') aplica(); };
    if (sistema.addEventListener) sistema.addEventListener('change', muda); else if (sistema.addListener) sistema.addListener(muda);
  }
  // outra aba trocou o tema: esta acompanha
  raiz.addEventListener('storage', (ev) => { if (ev.key === CHAVE) aplica(); });

  raiz.DGTema = { preferencia, atual: () => resolve(preferencia()), escolhe };
  aplica();
})(typeof window !== 'undefined' ? window : this);
