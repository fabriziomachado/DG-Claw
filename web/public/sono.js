'use strict';
/* sono.js: o avatar mostra o que o agente está fazendo (20/10/2026, pedido do dono).
   - Precisa de você (21/10/2026): com um pedido de decisão ainda sem resposta (GET /api/v1/caixa, tipo
     "pedido"), quem tem a animação "pede" (o Tech acenando com o alerta) mostra ela, na frente de tudo.
   - Trabalhando: se o agente tem a animação "trabalhando" (a coruja do Tech digitando de asas abertas),
     a foto vira ela enquanto ele trabalha.
   - Parado há SONO_MIN minutos (GET /api/v1/atividade: "ocioso" e parado_desde): "adormecendo" toca uma
     vez e "dormindo" fica repetindo, sem acordar. Quem não tem animação ganha um "z z" discreto e uma
     respiração leve. Não dorme quem espera uma decisão do dono (tem o número na fileira).
   Vale na fileira e no seletor do menu. Leve: confere a cada 15 s só com a tela aberta; com a tela
   escondida ou "reduzir movimento", vale a foto parada de cada modo. As animações vêm de GET
   /api/v1/agents (avatar_sono). <dados>/sono-teste.json põe um agente para dormir de teste (sono_teste). */
(function () {
  const SONO_MIN = 10;
  const ADORMECER_MS = 5200;   // quanto dura o "adormecendo" (toca uma vez)
  const quieto = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let anim = {}, carregou = 0;
  const modo = new Map();   // id -> 'adormecendo' | 'dormindo' | 'zzz' | 'trabalhando' | 'pede'
  const timers = new Map();

  async function animacoes() {
    if (Date.now() - carregou < 5 * 60000) return;
    try {
      const r = await fetch('/api/v1/agents', { credentials: 'same-origin', cache: 'no-store' });
      const d = r.ok ? await r.json() : null;
      if (d && d.agentes) { anim = {}; d.agentes.forEach(a => { anim[a.id] = a.avatar_sono || {}; }); carregou = Date.now(); }
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
  function trocaFoto(id, url) {
    for (const f of fotos(id)) {
      if (!f.img) continue;
      if (!f.img.dataset.acordado) f.img.dataset.acordado = f.img.src;
      if (url && !f.img.src.endsWith(url)) f.img.src = url;
    }
  }
  function normal(id) {
    clearTimeout(timers.get(id)); timers.delete(id);
    if (!modo.has(id)) return;
    modo.delete(id);
    for (const f of fotos(id)) {
      f.caixa.classList.remove('dorme', 'zzz', 'anima');
      if (f.img && f.img.dataset.acordado) { f.img.src = f.img.dataset.acordado; delete f.img.dataset.acordado; }
    }
  }
  const parada = () => document.hidden || quieto();

  function pede(id) {
    const s = anim[id] || {};
    if (!s.pede) return false;
    if (modo.get(id) === 'pede' && !parada()) return true;
    clearTimeout(timers.get(id)); timers.delete(id);
    for (const f of fotos(id)) { f.caixa.classList.remove('dorme', 'zzz'); f.caixa.classList.add('anima'); }
    trocaFoto(id, parada() ? (s['pede-parado'] || s.pede) : s.pede);
    modo.set(id, 'pede');
    return true;
  }

  function trabalha(id) {
    const s = anim[id] || {};
    if (!s.trabalhando) { normal(id); return; }
    if (modo.get(id) === 'trabalhando' && !parada()) return;
    clearTimeout(timers.get(id)); timers.delete(id);
    for (const f of fotos(id)) { f.caixa.classList.remove('dorme', 'zzz'); f.caixa.classList.add('anima'); }
    trocaFoto(id, parada() ? (s['trabalhando-parado'] || s.trabalhando) : s.trabalhando);
    modo.set(id, 'trabalhando');
  }

  function dorme(id) {
    const s = anim[id] || {};
    const fs = fotos(id);
    if (!fs.length) return;
    if (fs.some(f => f.pede())) { normal(id); return; }   // esperando o dono: fica acordado
    const antes = modo.get(id);
    if (!s.dormindo) {
      if (antes === 'zzz') return;
      if (antes) normal(id);
      modo.set(id, 'zzz');
      fs.forEach(f => f.caixa.classList.add('dorme', 'zzz'));
      return;
    }
    fs.forEach(f => { f.caixa.classList.remove('anima', 'zzz'); f.caixa.classList.add('dorme'); });
    if (parada()) { trocaFoto(id, s.parado || s.dormindo); modo.set(id, 'dormindo'); return; }
    if (antes === 'dormindo' || antes === 'adormecendo') { if (antes === 'dormindo') trocaFoto(id, s.dormindo); return; }
    if (s.adormecendo) {
      trocaFoto(id, s.adormecendo);
      modo.set(id, 'adormecendo');
      timers.set(id, setTimeout(() => { if (modo.get(id) === 'adormecendo') { modo.set(id, 'dormindo'); trocaFoto(id, s.dormindo); } }, ADORMECER_MS));
    } else { trocaFoto(id, s.dormindo); modo.set(id, 'dormindo'); }
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
    // quem tem pedido de decisão esperando o dono (só vale para quem tem a animação "pede")
    const pedem = new Set();
    if (Object.values(anim).some(s => s && s.pede)) {
      try {
        const r = await fetch('/api/v1/caixa', { credentials: 'same-origin', cache: 'no-store' });
        const c = r.ok ? await r.json() : null;
        (c && c.itens || []).forEach(i => { if (i.tipo === 'pedido') pedem.add(i.agente); });
      } catch (_) { /* sem a caixa: segue sem o pedido */ }
    }
    const agora = Date.now();
    for (const [id, a] of Object.entries(d.agentes)) {
      const parado = a.sono_teste || (a.estado === 'ocioso' && a.parado_desde && agora - Date.parse(a.parado_desde) >= SONO_MIN * 60000);
      if (pedem.has(id) && pede(id)) continue;
      if (parado) dorme(id);
      else if (a.estado === 'trabalhando') trabalha(id);
      else normal(id);
    }
  }

  // tela escondida: troca as animações pelas fotos paradas (o navegador para de decodificar); voltou, anima de novo
  document.addEventListener('visibilitychange', () => {
    for (const [id, m] of [...modo.entries()]) {
      const s = anim[id] || {};
      if (m === 'trabalhando') trocaFoto(id, document.hidden ? (s['trabalhando-parado'] || s.trabalhando) : s.trabalhando);
      else if (m === 'pede') trocaFoto(id, document.hidden ? (s['pede-parado'] || s.pede) : s.pede);
      else if (m === 'dormindo' || m === 'adormecendo') { if (document.hidden) trocaFoto(id, s.parado || s.dormindo); else { modo.set(id, 'dormindo'); trocaFoto(id, s.dormindo); } }
    }
    if (!document.hidden) confere();
  });
  setTimeout(confere, 1500);
  setInterval(() => { if (!document.hidden) confere(); }, 15000);
  window.DGSono = { confere };
})();
