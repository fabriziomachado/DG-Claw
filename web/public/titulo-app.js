'use strict';
/* titulo-app.js: no app instalado, a barra da janela não repete o nome (22/10/2026, pedido do dono).

   Com o S2 Bot instalado, o navegador já põe o nome do app na frente do título da página e a
   janela ficava "S2 Bot - Admin - S2 Bot". Na aba do navegador o " - S2 Bot" do fim continua
   (ajuda a achar a aba); no app instalado ele sai, inclusive quando a tela troca o título depois
   (a conversa põe o nome do agente e o número de não lidas). */
(function (raiz) {
  if (!raiz.document || !raiz.matchMedia) return;
  const RX = /\s+-\s+S2 Bot$/;
  const app = ['standalone', 'minimal-ui', 'window-controls-overlay']
    .some((m) => raiz.matchMedia('(display-mode: ' + m + ')').matches) || raiz.navigator.standalone === true;
  if (!app) return;
  const limpa = () => { const t = raiz.document.title; if (RX.test(t)) raiz.document.title = t.replace(RX, ''); };
  limpa();
  const el = raiz.document.querySelector('title');
  if (el && raiz.MutationObserver) new raiz.MutationObserver(limpa).observe(el, { childList: true, characterData: true, subtree: true });
})(typeof window !== 'undefined' ? window : globalThis);
