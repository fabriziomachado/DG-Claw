'use strict';
/* versao-nova.js: o botão "Atualização disponível" no rodapé do menu e a janela da versão nova
   (23/10/2026, pedido do dono, no jeito do Dokploy). Os dados vêm de GET /api/v1/versao-nova (as
   releases do fork). "Atualizar" não instala nada daqui: manda ao Admin um pedido de texto fixo,
   montado com a versão conferida, e o Admin segue o roteiro com backup e volta automática.
   Tudo que veio do GitHub (nome e itens da release) sai escapado. */
(function (raiz) {
  const API = '/api/v1/versao-nova';
  const RX_TAG = /^v?\d{1,3}\.\d{1,3}\.\d{1,3}(-[0-9A-Za-z.-]{1,30})?$/;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ico = (d, t) => `<svg viewBox="0 0 24 24" width="${t || 18}" height="${t || 18}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICO = {
    baixar: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
    fechar: '<path d="M6 6l12 12M18 6L6 18"/>',
    item: '<path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3z"/>',
    mais: '<circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/><circle cx="6" cy="12" r="1.5"/>',
    abrir: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    escudo: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
  };
  let estado = null;

  async function chamar(metodo, url, corpo) {
    const r = await fetch(url, { method: metodo, credentials: 'same-origin', cache: 'no-store',
      headers: corpo ? { 'Content-Type': 'application/json' } : {}, body: corpo ? JSON.stringify(corpo) : undefined });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d) throw new Error((d && (d.erro || d.error)) || ('o servidor respondeu ' + r.status));
    return d;
  }

  /** O que o rodapé mostra: o botão só com versão nova não dispensada; a versão atual sempre. */
  function htmlBotao(d) {
    if (!d || !d.nova || d.dispensada) return '';
    return `<button type="button" class="vn-botao" id="vnBotao" title="Atualização disponível: ${esc(d.nova.curta)}">` +
      `${ico(ICO.baixar)}<span>Atualização disponível</span><i class="vn-ponto" aria-hidden="true"></i></button>`;
  }

  function htmlJanela(d) {
    const n = d.nova;
    const itens = (n.itens || []).map(t => `<li>${ico(ICO.item, 16)}<span>${esc(t)}</span></li>`).join('') +
      (n.mais ? `<li>${ico(ICO.mais, 16)}<span>e mais ${n.mais} ${n.mais === 1 ? 'ajuste' : 'ajustes'}</span></li>` : '');
    return `<div class="vn-veu" id="vnVeu"><div class="vn-jan" role="dialog" aria-modal="true" aria-labelledby="vnTit">` +
      `<div class="vn-cab"><h2 id="vnTit">Atualizar o S2 Bot</h2><span class="vn-chip" title="Versão instalada">${esc(d.atual_curta || d.atual)}</span>` +
      `<button type="button" class="vn-x" data-vn="fechar" aria-label="Fechar" title="Fechar">${ico(ICO.fechar)}</button></div>` +
      `<div class="vn-nova">${ico(ICO.baixar)}<span>Versão nova disponível: <b>${esc(n.curta)}</b></span></div>` +
      (itens ? `<div class="vn-rot">O que muda</div><ul class="vn-itens">${itens}</ul>` : '') +
      (n.url ? `<a class="vn-notas" href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${ico(ICO.abrir, 15)}Ver as notas da versão</a>` : '') +
      `<div class="vn-seg">${ico(ICO.escudo)}<span>O Admin faz um backup antes, instala e testa. Os agentes param um de cada vez, por poucos minutos. ` +
      `Se algo falhar, ele volta sozinho para a ${esc(d.atual_curta || d.atual)}.</span></div>` +
      `<label class="vn-chave"><input type="checkbox" data-vn="auto"${d.auto ? ' checked' : ''}><span class="vn-sw" aria-hidden="true"></span>Procurar versões novas sozinho</label>` +
      `<p class="vn-msg" role="status" hidden></p>` +
      `<div class="vn-bts"><button type="button" class="vn-b vn-sec" data-vn="agora-nao">Agora não</button>` +
      `<button type="button" class="vn-b vn-pri" data-vn="atualizar">${ico(ICO.baixar, 16)}Atualizar</button></div>` +
      `</div></div>`;
  }

  function pinta() {
    const rod = document.getElementById('mlRodape');
    if (!rod) return false;
    let ver = document.getElementById('vnVersao');
    if (!ver) {
      ver = document.createElement('span');
      ver.id = 'vnVersao'; ver.className = 'vn-versao';
      const resp = rod.querySelector('.ml-resp');
      if (resp) resp.appendChild(ver); else rod.appendChild(ver);
    }
    ver.textContent = estado && estado.atual_curta ? 'S2 Bot ' + estado.atual_curta : '';
    const velho = document.getElementById('vnBotao');
    if (velho) velho.remove();
    const html = htmlBotao(estado);
    if (html) rod.insertAdjacentHTML('beforebegin', html);
    return true;
  }

  function abre() {
    if (!estado || !estado.nova || document.getElementById('vnVeu')) return;
    document.body.insertAdjacentHTML('beforeend', htmlJanela(estado));
    const b = document.querySelector('#vnVeu [data-vn="atualizar"]');
    if (b) b.focus();
  }
  function fecha() { const v = document.getElementById('vnVeu'); if (v) v.remove(); }
  function aviso(t, erro) {
    const m = document.querySelector('#vnVeu .vn-msg');
    if (!m) return;
    m.textContent = t || ''; m.hidden = !t; m.classList.toggle('erro', !!erro);
  }

  /** O pedido ao Admin: texto fixo, só com a versão conferida. Nada do texto da release vai junto. */
  function textoDoPedido(tag) {
    return '[do botão Atualizar do S2 Bot] atualiza o S2 Bot para a versão ' + tag + ' (release do fork, com backup e volta automática)';
  }

  async function atualizar(botao) {
    const tag = estado && estado.nova && estado.nova.tag;
    if (!tag || !RX_TAG.test(tag)) { aviso('Não reconheci a versão nova. Feche e abra de novo.', true); return; }
    botao.disabled = true;
    try {
      const ags = await chamar('GET', '/api/v1/agents');
      const admin = (ags.agentes || ags.agents || []).find(a => a.tipo === 'admin');
      if (!admin) throw new Error('não achei a conversa do Admin');
      await chamar('POST', '/api/v1/agents/' + encodeURIComponent(admin.id) + '/send', { text: textoDoPedido(tag) });
      aviso('Pedido enviado. O Admin conta o andamento na conversa dele.');
      botao.textContent = 'Enviado';
      setTimeout(() => { fecha(); raiz.location.href = '/a/' + encodeURIComponent(admin.id); }, 1500);
    } catch (e) {
      botao.disabled = false;
      aviso('Não consegui mandar o pedido ao Admin (' + e.message + '). Tente de novo.', true);
    }
  }

  /* Fora do navegador (testes) só as funções puras saem. */
  if (!raiz.document) {
    raiz.DGVersaoNova = { textoDoPedido, htmlBotao, htmlJanela };
    if (typeof module !== 'undefined' && module.exports) module.exports = raiz.DGVersaoNova;
    return;
  }

  document.addEventListener('click', async ev => {
    if (!ev.target.closest) return;
    if (ev.target.closest('#vnBotao')) { abre(); return; }
    const veu = document.getElementById('vnVeu');
    if (!veu) return;
    if (ev.target === veu) { fecha(); return; }
    const b = ev.target.closest('[data-vn]');
    if (!b || b.tagName === 'INPUT') return;
    const acao = b.dataset.vn;
    if (acao === 'fechar') { fecha(); return; }
    if (acao === 'atualizar') { atualizar(b); return; }
    if (acao === 'agora-nao') {
      try { estado = await chamar('POST', API + '/agora-nao'); } catch (e) { aviso('Não consegui guardar (' + e.message + ').', true); return; }
      fecha(); pinta();
    }
  });
  document.addEventListener('change', async ev => {
    const c = ev.target;
    if (!c || !c.matches || !c.matches('#vnVeu [data-vn="auto"]')) return;
    try { estado = await chamar('POST', API + '/auto', { ligado: c.checked }); }
    catch (e) { c.checked = !c.checked; aviso('Não consegui guardar a escolha (' + e.message + ').', true); }
  });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') fecha(); });

  async function carrega() {
    try { estado = await chamar('GET', API); } catch (e) { console.warn('versao-nova: não li a versão nova:', e.message); return; }
    // o rodapé nasce com o menu (menu-lado.js), que pode montar depois de nós
    let n = 0;
    (function espera() { if (!pinta() && n++ < 40) setTimeout(espera, 250); })();
  }

  raiz.DGVersaoNova = { carrega, textoDoPedido, htmlBotao, htmlJanela };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', carrega); else carrega();
})(typeof window !== 'undefined' ? window : globalThis);
