'use strict';
/* sono.js: o avatar dorme quando o agente fica parado (20/10/2026, pedido do dono).
   Depois de SONO_MIN minutos sem trabalhar (GET /api/v1/atividade: estado "ocioso" e parado_desde), a foto
   do agente na fileira e no seletor do menu troca pela animação dele: "adormecendo" toca uma vez e
   "dormindo" fica repetindo, sem acordar. Quem não tem animação ganha um "zzz" discreto e uma respiração
   leve. Não dorme quem espera uma decisão do dono (tem o número na fileira) nem quem está trabalhando.
   Leve: confere a cada 30 s só com a tela aberta; com a tela escondida ou "reduzir movimento", vale a
   foto parada (-dormindo.png). As animações vêm de GET /api/v1/agents (avatar_sono). */
(function () {
  const SONO_MIN = 10;
  const ADORMECER_MS = 5200;   // quanto dura o "adormecendo" (toca uma vez)
  const quieto = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let sono = {}, carregou = 0;
  const dormindo = new Map();   // id -> 'adormecendo' | 'dormindo' | 'zzz'

  async function animacoes() {
    if (Date.now() - carregou < 5 * 60000) return;
    try {
      const r = await fetch('/api/v1/agents', { credentials: 'same-origin', cache: 'no-store' });
      const d = r.ok ? await r.json() : null;
      if (d && d.agentes) { sono = {}; d.agentes.forEach(a => { sono[a.id] = a.avatar_sono || null; }); carregou = Date.now(); }
    } catch (_) { /* tenta na próxima */ }
  }

  // as fotos daquele agente na tela: a da fileira e a do seletor do menu
  function fotos(id) {
    const out = [];
    const f = document.querySelector('#fileira [data-avt="' + CSS.escape(id) + '"]');
    if (f) out.push({ caixa: f, img: f.querySelector('.fil-foto img'), pede: () => !!f.querySelector('.fil-badge') });
    document.querySelectorAll('.ml-ag[href="/a/' + encodeURIComponent(id) + '"]').forEach(el => out.push({ caixa: el, img: el.querySelector('.ml-mini img'), pede: () => false }));
    return out;
  }

  function acorda(id) {
    if (!dormindo.has(id)) return;
    dormindo.delete(id);
    for (const f of fotos(id)) {
      f.caixa.classList.remove('dorme', 'zzz');
      if (f.img && f.img.dataset.acordado) { f.img.src = f.img.dataset.acordado; delete f.img.dataset.acordado; }
    }
  }

  function dorme(id) {
    const s = sono[id];
    const fs = fotos(id);
    if (!fs.length) return;
    if (fs.some(f => f.pede())) { acorda(id); return; }   // esperando o dono: fica acordado
    const antes = dormindo.get(id);
    if (!s || !s.dormindo) {
      if (antes === 'zzz') return;
      dormindo.set(id, 'zzz');
      fs.forEach(f => f.caixa.classList.add('dorme', 'zzz'));
      return;
    }
    const alvo = document.hidden || quieto() ? (s.parado || s.dormindo) : null;
    for (const f of fs) {
      f.caixa.classList.add('dorme');
      if (!f.img) continue;
      if (!f.img.dataset.acordado) f.img.dataset.acordado = f.img.src;
      if (alvo) { if (!f.img.src.endsWith(alvo)) f.img.src = alvo; continue; }
      if (!antes && s.adormecendo) f.img.src = s.adormecendo;
      else if (antes !== 'dormindo' || f.img.src.indexOf('/avatar/dormindo') < 0) f.img.src = s.dormindo;
    }
    if (alvo) { dormindo.set(id, 'dormindo'); return; }
    if (!antes && s.adormecendo) {
      dormindo.set(id, 'adormecendo');
      setTimeout(() => { if (dormindo.get(id) === 'adormecendo') { dormindo.set(id, 'dormindo'); fotos(id).forEach(f => { if (f.img) f.img.src = s.dormindo; }); } }, ADORMECER_MS);
    } else dormindo.set(id, 'dormindo');
  }

  async function confere() {
    if (!document.querySelector('#fileira')) return;
    await animacoes();
    let d = null;
    try {
      const r = await fetch('/api/v1/atividade', { credentials: 'same-origin', cache: 'no-store' });
      d = r.ok ? await r.json() : null;
    } catch (_) { return; }
    if (!d || !d.agentes) return;
    const agora = Date.now();
    for (const [id, a] of Object.entries(d.agentes)) {
      const parado = a.sono_teste || (a.estado === 'ocioso' && a.parado_desde && agora - Date.parse(a.parado_desde) >= SONO_MIN * 60000);
      if (parado) dorme(id); else acorda(id);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { for (const id of dormindo.keys()) { const s = sono[id]; if (s && s.parado) fotos(id).forEach(f => { if (f.img) f.img.src = s.parado; }); } }
    else { for (const id of [...dormindo.keys()]) if (dormindo.get(id) !== 'zzz') { dormindo.set(id, 'dormindo'); dorme(id); } confere(); }
  });
  setTimeout(confere, 1500);
  setInterval(() => { if (!document.hidden) confere(); }, 30000);
  window.DGSono = { confere };
})();
