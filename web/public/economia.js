'use strict';
/* economia.js: o selo "economia" no topo da conversa quando o modo economia está ligado (lib/limites.js,
   20/10/2026). Vale para os agentes de trabalho (o Admin não troca de modelo). Toque leva à Saúde do
   servidor, onde se liga ou desliga. A linha "modo economia ligado" no meio da conversa vem do servidor. */
(function () {
  const FOLHA = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z"/><path d="M5 19l7-7"/></svg>';
  let ag = null, selo = null;
  function ate(iso) {
    if (!iso) return 'a semana renovar';
    const d = new Date(iso), dias = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    return `${dias[d.getDay()]}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  async function confere() {
    if (!ag || document.hidden) return;
    let d = null;
    try { const r = await fetch('/api/v1/limites/economia', { credentials: 'same-origin', cache: 'no-store' }); d = r.ok ? await r.json() : null; } catch (_) { return; }
    const ligado = !!(d && d.ativa);
    if (!selo) {
      const tut = document.getElementById('btnTutorial');
      if (!tut) return;
      selo = document.createElement('a');
      selo.id = 'seloEconomia'; selo.className = 'selo-eco'; selo.href = '/saude'; selo.hidden = true;
      selo.innerHTML = FOLHA + '<span>economia</span>';
      tut.before(selo);
    }
    selo.hidden = !ligado;
    if (ligado) selo.title = `Modo economia: ${ag.nome} usa o Sonnet até ${ate(d.ate)}. Toque para ver ou desligar.`;
  }
  window.DGEconomia = {
    inicia(o) {
      ag = o && o.agente;
      if (!ag || ag.tipo === 'admin') return;
      confere();
      setInterval(confere, 120000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) confere(); });
    },
  };
})();
