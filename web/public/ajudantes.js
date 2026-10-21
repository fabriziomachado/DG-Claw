'use strict';
/* ajudantes.js: os ajudantes (cards, sessões paralelas) de cada agente (21/10/2026, ideia do dono, proposta
   aprovada em imagem). Quem já busca /api/v1/atividade (casca.js e conversa.js) chama DGAjudantes.pinta(d):
   - na fileira, a foto ganha um selo com o número de ajudantes (azul trabalhando, amarelo se algum parou);
   - na conversa do agente aberto (DGAjudantes.liga), uma linha acima do campo: "Ajudante trabalhando ·
     assunto · 12 min", que leva às Sessões; parado: "Ajudante parado · não começou" com "Avisar o <agente>".
   O "avisar" manda uma mensagem ao agente pedindo para reenviar o pedido: o texto do pedido não passa por aqui. */
(function (raiz, fabrica) {
  const m = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.DGAjudantes = m;
})(this, function (raiz) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ICO = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><path d="M16 4a3 3 0 0 1 0 6M21 20c0-2.5-1.8-4.3-4-4.8"/></svg>';

  /** "12 min", "1 h 05", "agora" */
  function tempo(desde, agora) {
    if (typeof desde !== 'number') return '';
    const min = Math.max(0, Math.floor((agora - desde) / 60000));
    if (min < 1) return 'agora';
    if (min < 60) return min + ' min';
    return Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0');
  }

  /** Resumo do selo: { n, parado } ou null quando não há ajudante. */
  function selo(lista) {
    const l = Array.isArray(lista) ? lista : [];
    if (!l.length) return null;
    return { n: l.length, parado: l.some(a => a.estado === 'parado' || a.estado === 'pede') };
  }

  /** As linhas da conversa (o parado primeiro). */
  function linhasHtml(lista, nomeAgente, agora) {
    const ordem = { parado: 0, pede: 1, trabalhando: 2 };
    const l = (Array.isArray(lista) ? lista : []).slice().sort((a, b) => (ordem[a.estado] ?? 3) - (ordem[b.estado] ?? 3));
    return l.map(a => a.estado === 'pede'
      ? `<button type="button" class="ajl parado" data-ajudante-abre="${esc(a.id)}" title="Abrir as Sessões"><span class="ajl-ic">${ICO}</span>` +
        `<span class="ajl-tit"><b>Ajudante pede permissão</b> · ${esc(a.titulo)}</span><span class="ajl-bt">Ver</span></button>`
      : a.estado === 'parado'
      ? `<div class="ajl parado" data-ajudante="${esc(a.id)}"><span class="ajl-ic">${ICO}</span>` +
        `<span class="ajl-tit"><b>Ajudante parado</b> · ${esc(a.motivo || 'não começou')} · ${esc(a.titulo)}</span>` +
        `<button type="button" class="ajl-bt" data-ajudante-avisa="${esc(a.id)}" data-titulo="${esc(a.titulo)}" data-motivo="${esc(a.motivo || '')}">Avisar ${esc(nomeAgente)}</button></div>`
      : `<button type="button" class="ajl" data-ajudante-abre="${esc(a.id)}" title="Abrir as Sessões"><span class="ajl-ic gira">${ICO}</span>` +
        `<span class="ajl-tit"><b>Ajudante trabalhando</b> · ${esc(a.titulo)}</span>` +
        `<span class="ajl-t">${esc(tempo(a.desde, agora))}</span></button>`).join('');
  }

  const puras = { tempo, selo, linhasHtml };
  if (!raiz.document) return puras;

  let conversa = null; // { agente, el, enviar }

  function pintaSelo(slug, lista) {
    const el = document.querySelector('#fileira [data-avt="' + CSS.escape(slug) + '"]');
    if (!el) return;
    const s = selo(lista);
    let b = el.querySelector('.fil-ajd');
    if (!s) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('span'); b.className = 'fil-ajd'; el.appendChild(b); }
    b.className = 'fil-ajd' + (s.parado ? ' parado' : '');
    b.innerHTML = ICO + (s.n > 9 ? '9+' : s.n);
    b.title = s.parado ? 'Um ajudante precisa de atenção' : (s.n === 1 ? '1 ajudante trabalhando' : s.n + ' ajudantes trabalhando');
  }

  function pinta(d) {
    if (!d || !d.agentes) return;
    for (const slug of Object.keys(d.agentes)) pintaSelo(slug, d.agentes[slug].ajudantes);
    if (conversa) {
      const l = (d.agentes[conversa.agente.id] || {}).ajudantes || [];
      conversa.el.innerHTML = linhasHtml(l, conversa.agente.nome, Date.now());
      conversa.el.hidden = !l.length;
    }
  }

  /** Conversa: a caixa das linhas fica logo acima do campo (antes de .linha1). */
  function liga(agente, enviar) {
    const barra = document.querySelector('.barra');
    const linha1 = barra && barra.querySelector('.linha1');
    if (!linha1 || agente.tipo === 'admin') return;
    const el = document.createElement('div');
    el.id = 'ajudantes'; el.className = 'ajudantes'; el.hidden = true;
    el.setAttribute('aria-live', 'polite');
    linha1.before(el);
    conversa = { agente, el, enviar };
    el.addEventListener('click', ev => {
      const av = ev.target.closest('[data-ajudante-avisa]');
      if (av) {
        av.disabled = true; av.textContent = 'Avisado';
        const t = av.dataset.titulo, mot = av.dataset.motivo;
        enviar(`O ajudante "${t}" está parado (${mot || 'não começou'}). Confira com dgclaw-card estado ${av.dataset.ajudanteAvisa} e, se o pedido não chegou, mande de novo com dgclaw-card mandar.`);
        return;
      }
      const ab = ev.target.closest('[data-ajudante-abre]');
      if (ab) location.href = (agente.painel_url || ('/p/' + encodeURIComponent(agente.id) + '/')).replace(/\/*$/, '/') + '#aba=sessoes';
    });
  }

  return Object.assign({ pinta, liga }, puras);
});
