'use strict';
/* cota.js: quando a cota da assinatura acaba (19/10/2026, pedido do dono).
   O painel do agente já sabe (GET <painel>/api/saude, diagnostico.tipo === "limite", com a frase da
   Anthropic "resets 9:30pm (America/Sao_Paulo)"). Aqui isso vira, na conversa:
   - um cartão "A cota acabou · volta às 21:30 · faltam 38 min", com contador regressivo;
   - mensagens escritas enquanto isso ficam guardadas (neste aparelho) e vão sozinhas quando a cota
     voltar, com o chip "N guardadas para a volta" (o x tira da fila).
   A conversa chama DGCota.inicia({ agente, enviar }) e, ao enviar, DGCota.guarda(texto) (true = guardou).
   horaDaVolta() é pura e tem teste. */
(function (raiz, fabrica) {
  const m = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.DGCota = m;
})(this, function (raiz) {
  /* "resets 9:30pm (America/Sao_Paulo)" -> Date da próxima vez que dá essa hora nesse fuso (ou null). */
  function horaDaVolta(texto, agora) {
    const m = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:\(([^)]+)\))?/i.exec(String(texto || ''));
    if (!m) return null;
    let h = +m[1]; const min = m[2] ? +m[2] : 0; const ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    const fuso = m[4] || undefined;
    const ag = agora || new Date();
    let partes;
    try {
      partes = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
        .formatToParts(ag).filter(p => p.type !== 'literal').map(p => [p.type, +p.value]));
    } catch (_) { return null; }   // fuso desconhecido
    // diferença entre o relógio do fuso e o UTC, agora
    const offset = Date.UTC(partes.year, partes.month - 1, partes.day, partes.hour, partes.minute, partes.second) - Math.floor(ag.getTime() / 1000) * 1000;
    let alvo = Date.UTC(partes.year, partes.month - 1, partes.day, h, min) - offset;
    if (alvo <= ag.getTime()) alvo += 86400000;
    return new Date(alvo);
  }
  function falta(ms) {
    if (ms <= 0) return 'a qualquer momento';
    const t = Math.ceil(ms / 60000), h = Math.floor(t / 60), min = t % 60;
    return h ? `${h} h${min ? ' ' + min + ' min' : ''}` : `${min} min`;
  }

  if (!raiz.document) return { horaDaVolta, falta };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad2 = n => String(n).padStart(2, '0');
  let ag = null, enviar = null, painel = '', estado = { limite: false, volta: null }, cartao = null, relogio = null, chave = '';
  const le = () => { try { const l = JSON.parse(localStorage.getItem(chave) || '[]'); return Array.isArray(l) ? l : []; } catch (_) { return []; } };
  const grava = l => { try { localStorage.setItem(chave, JSON.stringify(l)); } catch (_) { /* sem armazenamento: a fila vale até recarregar */ } };

  function pinta() {
    if (!cartao) return;
    const fila = le();
    if (!estado.limite && !fila.length) { cartao.hidden = true; return; }
    cartao.hidden = false;
    const v = estado.volta;
    const quando = v ? `volta às ${pad2(v.getHours())}:${pad2(v.getMinutes())}` : 'volta assim que a conta liberar';
    cartao.innerHTML = (estado.limite
      ? `<div class="ct-l1"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>` +
        `<span><b>A cota da assinatura acabou.</b> ${esc(ag.nome)} ${quando}${v ? ` · faltam <b class="ct-falta">${falta(v - Date.now())}</b>` : ''}.</span></div>` +
        '<div class="ct-sub">O que você escrever agora fica guardado aqui e vai sozinho quando a cota voltar.</div>'
      : '<div class="ct-l1"><span><b>A cota voltou.</b> Mandando o que ficou guardado…</span></div>') +
      (fila.length ? `<div class="ct-fila">${fila.map((t, i) => `<span class="ct-item"><span>${esc(t.length > 60 ? t.slice(0, 59) + '…' : t)}</span><button type="button" data-tira="${i}" aria-label="Tirar da fila" title="Tirar da fila">×</button></span>`).join('')}</div>` : '');
  }

  async function confere() {
    if (!painel || document.hidden) return;
    let d = null;
    try {
      const r = await fetch(painel + 'api/saude', { credentials: 'same-origin', cache: 'no-store' });
      d = r.ok ? await r.json() : null;
    } catch (_) { return; }
    const dg = d && d.diagnostico;
    const limite = !!(dg && dg.tipo === 'limite');
    const antes = estado.limite;
    estado = { limite, volta: limite ? horaDaVolta((dg.trecho || '') + ' ' + (dg.frase || ''), new Date()) : null };
    pinta();
    if (antes && !limite) despacha();
    else if (!limite && le().length) despacha();   // abriu a página depois da volta: manda o que ficou
  }
  async function despacha() {
    const fila = le();
    if (!fila.length || !enviar) return;
    grava([]);
    for (const t of fila) { try { await enviar(t); } catch (e) { console.warn('cota: não mandei a mensagem guardada:', e.message); } }
    pinta();
  }

  function inicia(o) {
    ag = o && o.agente; enviar = o && o.enviar;
    if (!ag || !ag.tem_painel) return;
    painel = (ag.painel_url || '/p/' + encodeURIComponent(ag.id) + '/').replace(/\/?$/, '/');
    chave = 'dgclaw:fila-da-volta:' + ag.id;
    const linha1 = document.querySelector('.barra .linha1');
    if (!linha1) return;
    cartao = document.createElement('div');
    cartao.id = 'cotaCartao'; cartao.hidden = true; cartao.setAttribute('role', 'status');
    linha1.before(cartao);
    cartao.addEventListener('click', ev => {
      const b = ev.target.closest('[data-tira]'); if (!b) return;
      const l = le(); l.splice(+b.dataset.tira, 1); grava(l); pinta();
    });
    confere();
    setInterval(confere, 60000);
    relogio = setInterval(() => { if (estado.limite && estado.volta && !document.hidden) { const f = cartao.querySelector('.ct-falta'); if (f) f.textContent = falta(estado.volta - Date.now()); if (estado.volta - Date.now() < -60000) confere(); } }, 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) confere(); });
  }
  /* true = a cota está acabada e o texto foi guardado para a volta (a conversa não manda agora) */
  function guarda(texto) {
    if (!estado.limite || !chave) return false;
    const l = le(); l.push(String(texto)); grava(l.slice(-20)); pinta();
    return true;
  }

  return { horaDaVolta, falta, inicia, guarda, confere };
});
