'use strict';
/* seletor-agente.js: escolher o agente com a foto e o cargo (21/10/2026, pedido do dono). Troca o <select>
   de agente da aba Hoje e da aba Tarefas por uma pílula com a foto; o menu traz cada agente com a foto, o
   nome e o cargo (subtitulo do registro), e o Admin por último, separado. O <select> continua lá,
   escondido, guardando o valor: quem lê o agente escolhido não muda nada.
   Uso: DGSeletorAgente.liga(select, agentes[, { titulo }])  (agentes: a lista de GET /api/v1/agents;
   titulo: o cabeçalho do menu, "Para quem é" se não vier). A Saúde do servidor usa com "De qual agente".
   DGSeletorAgente.opcoes(select, { titulo }) (22/10/2026): o mesmo menu para uma lista comum, sem foto. A
   pílula <label class="av-pil">ícone<select>seta</label> vira um botão com o mesmo ícone, que abre o menu;
   o <select> continua guardando o valor (tipo do aviso, "quando" do lembrete). */
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const svg = d => `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const foto = (a, t) => {
    const img = a.avatar_img || (/^https:\/\//i.test(a.avatar || '') ? a.avatar : '');
    return `<span class="sa-av" style="width:${t}px;height:${t}px;background:${esc(a.cor || '#5b6472')}">${img ? `<img src="${esc(img)}" alt="">` : esc(Array.from(a.avatar || a.nome || '?')[0])}</span>`;
  };
  let aberto = null;
  // o primeiro ancestral que rola (a página, se nenhum)
  function rolaDe(el) {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
    }
    return document.scrollingElement || document.documentElement;
  }
  function fecha() { if (aberto) { aberto.menu.hidden = true; aberto.pilula.setAttribute('aria-expanded', 'false'); aberto = null; } }
  document.addEventListener('click', ev => { if (aberto && !aberto.raiz.contains(ev.target)) fecha(); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && aberto) { const p = aberto.pilula; fecha(); p.focus(); } });

  function abre(raiz, menu, pilula) {
    fecha();
    // no fim da página o menu para baixo esticaria a rolagem (segunda barra): aí ele abre para cima
    const rolagem = rolaDe(raiz), altura = rolagem.scrollHeight;
    menu.classList.remove('cima');
    menu.hidden = false; pilula.setAttribute('aria-expanded', 'true'); aberto = { raiz, menu, pilula };
    // dentro da tela: sem sair pela direita nem pela esquerda
    menu.style.left = '0px';
    const r = menu.getBoundingClientRect(), sobra = window.innerWidth - 8 - r.right;
    if (sobra < 0) menu.style.left = Math.max(sobra, 8 - r.left) + 'px';
    const estica = rolagem.scrollHeight > altura + 1 || r.bottom > window.innerHeight - 8;
    if (estica && pilula.getBoundingClientRect().top - 8 > r.height + 6) menu.classList.add('cima');
    const on = menu.querySelector('.sa-op.on'); if (on) on.focus();
  }

  function opcoes(select, opcoesMenu) {
    const rotulo = select && select.closest('.av-pil');
    if (!rotulo || rotulo.dataset.saLigado) return;
    rotulo.dataset.saLigado = '1';
    const titulo = (opcoesMenu && opcoesMenu.titulo) || select.getAttribute('aria-label') || '';
    const icone = rotulo.querySelector('svg');
    const raiz = document.createElement('span');
    raiz.className = 'sa sa-lista';
    raiz.innerHTML = `<button type="button" class="av-pil" aria-haspopup="listbox" aria-expanded="false" aria-label="${esc(titulo)}">${icone ? icone.outerHTML : ''}` +
      `<span class="sa-valor"></span>${svg('<path d="m6 9 6 6 6-6"/>')}</button><div class="sa-menu" role="listbox" hidden></div>`;
    rotulo.after(raiz);
    rotulo.hidden = true;
    const pilula = raiz.querySelector('.av-pil'), menu = raiz.querySelector('.sa-menu');
    const atual = () => select.options[select.selectedIndex] || select.options[0];
    const pinta = () => { const o = atual(); raiz.querySelector('.sa-valor').textContent = o ? o.textContent : ''; };
    const pintaMenu = () => {
      const o = atual();
      menu.innerHTML = (titulo ? `<div class="sa-tit">${esc(titulo)}</div>` : '') + Array.from(select.options).map(op =>
        `<button type="button" class="sa-op${op === o ? ' on' : ''}" role="option" aria-selected="${op === o}" data-valor="${esc(op.value)}">` +
        `<span class="sa-tx"><b>${esc(op.textContent)}</b>${op.title ? `<small>${esc(op.title)}</small>` : ''}</span>` +
        (op === o ? `<span class="sa-ok">${svg('<path d="m5 12 4.5 4.5L19 7"/>')}</span>` : '') + '</button>').join('');
    };
    pilula.onclick = () => {
      if (aberto && aberto.raiz === raiz) { fecha(); return; }
      pintaMenu(); abre(raiz, menu, pilula);
    };
    menu.onclick = ev => {
      const b = ev.target.closest('[data-valor]'); if (!b) return;
      select.value = b.dataset.valor;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      fecha(); pinta(); pilula.focus();
    };
    // as opções podem chegar depois (o tipo do aviso vem do servidor) e o valor pode mudar por código
    select.addEventListener('change', pinta);
    new MutationObserver(pinta).observe(select, { childList: true });
    pinta();
  }

  function liga(select, agentes, opcoes) {
    const titulo = (opcoes && opcoes.titulo) || 'Para quem é';
    if (!select || !Array.isArray(agentes) || !agentes.length) return;
    let raiz = select.nextElementSibling && select.nextElementSibling.classList.contains('sa') ? select.nextElementSibling : null;
    if (!raiz) {
      raiz = document.createElement('div');
      raiz.className = 'sa';
      select.after(raiz);
      select.hidden = true;
    }
    const lista = agentes.filter(a => a.tipo !== 'admin').concat(agentes.filter(a => a.tipo === 'admin'));
    const pinta = () => {
      const atual = lista.find(a => a.id === select.value) || lista[0];
      raiz.innerHTML = `<button type="button" class="sa-pilula" aria-haspopup="listbox" aria-expanded="false" title="${esc(titulo)}">${foto(atual, 24)}<span>${esc(atual.nome)}</span>${svg('<path d="m6 9 6 6 6-6"/>')}</button>` +
        `<div class="sa-menu" role="listbox" hidden><div class="sa-tit">${esc(titulo)}</div>` +
        lista.map((a, i) => (a.tipo === 'admin' && i ? '<div class="sa-div"></div>' : '') +
          `<button type="button" class="sa-op${a.id === atual.id ? ' on' : ''}" role="option" aria-selected="${a.id === atual.id}" data-ag="${esc(a.id)}">${foto(a, 34)}` +
          `<span class="sa-tx"><b>${esc(a.nome)}</b>${a.subtitulo ? `<small>${esc(a.subtitulo)}</small>` : ''}</span>` +
          (a.id === atual.id ? `<span class="sa-ok">${svg('<path d="m5 12 4.5 4.5L19 7"/>')}</span>` : '') + '</button>').join('') + '</div>';
      const pilula = raiz.querySelector('.sa-pilula'), menu = raiz.querySelector('.sa-menu');
      pilula.onclick = () => {
        if (aberto && aberto.raiz === raiz) { fecha(); return; }
        abre(raiz, menu, pilula);
      };
      menu.onclick = ev => {
        const b = ev.target.closest('[data-ag]'); if (!b) return;
        select.value = b.dataset.ag;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        fecha(); pinta(); raiz.querySelector('.sa-pilula').focus();
      };
    };
    select.addEventListener('change', () => { if (!aberto) pinta(); });
    pinta();
  }
  window.DGSeletorAgente = { liga, opcoes };
})();
