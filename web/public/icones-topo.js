'use strict';
/* icones-topo.js: troca os emojis dos botões do topo da conversa por ícones de traço
   fino, no estilo do ChatGPT (17/10/2026, a pedido do dono). Os outros scripts
   continuam escrevendo o emoji (conversa.js, sigilo.js); um observador troca o emoji
   pelo ícone sempre que um botão é redesenhado, então nada mais precisa mudar. */
(function () {
  const svg = d => '<svg class="ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const ICONES = {
    '☰':  svg('<path d="M4 7h16M4 12h16M4 17h10"/>'),
    '🦞': svg('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
    '📋': svg('<rect x="5" y="4.5" width="14" height="16" rx="2"/><path d="M9 4.5V3.5h6v1M8.5 10.5l1.5 1.5 3-3M8.5 16h7"/>'),
    '⏰': svg('<path d="M18 16v-5a6 6 0 0 0-12 0v5l-1.5 2h15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
    '🔊': svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
    '🔇': svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
    '🔁': svg('<path d="M17 3l3 3-3 3"/><path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H20M7 21l-3-3 3-3"/><path d="M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H4"/>'),
    '👁': svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  };
  const TUTORIAL = svg('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>');
  const RX = new RegExp('^\\s*(' + Object.keys(ICONES).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\uFE0F?\\s*');

  function troca(btn) {
    const t = btn.firstChild;
    if (!t || t.nodeType !== 3) return;
    const m = RX.exec(t.nodeValue);
    if (!m) return;
    t.nodeValue = t.nodeValue.slice(m[0].length);
    btn.insertAdjacentHTML('afterbegin', ICONES[m[1]]);
  }
  function varre() {
    const cab = document.getElementById('cabecalho');
    if (!cab) return;
    cab.querySelectorAll('.btn').forEach(troca);
    const tut = document.getElementById('btnTutorial');
    if (tut && !tut.querySelector('.ico')) tut.insertAdjacentHTML('afterbegin', TUTORIAL);
  }
  function liga() {
    varre();
    const cab = document.getElementById('cabecalho');
    if (!cab) return;
    // só reage a botões redesenhados; a troca em si não tem emoji, então não entra em laço
    new MutationObserver(varre).observe(cab, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', liga);
  else liga();
})();
