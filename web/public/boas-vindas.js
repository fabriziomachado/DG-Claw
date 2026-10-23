'use strict';
/* boas-vindas.js: as telas de abertura do app (22/10/2026, pedido do dono).

   Na primeira vez em cada aparelho: splash com a coruja, boas-vindas, a equipe, o perfil (nome,
   área, o que resolver primeiro) e os avisos (quais tocam e o silêncio à noite). O perfil e os
   avisos vão para o servidor (/api/v1/boas-vindas, ver web/lib/boas-vindas.js); o "já vi" fica só
   no aparelho. window.DGBoasVindas.abre() mostra de novo, já preenchido.

   A marca de "já vi" não começa com "dgclaw:" de propósito: sair da conta apaga essas chaves, e as
   boas-vindas não devem voltar a cada login. */
(function () {
  const CHAVE = 's2bot-boas-vindas-v1';
  const CORUJA = '/icons/coruja-redonda.webp';
  const SETA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  const SINO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 20a1.9 1.9 0 0 0 3.4 0"/></svg>';
  const ICONE = {
    pedido: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="3"/></svg>',
    entrega: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    lua: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
    cadeado: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>',
  };
  const BRILHOS = [
    { c: 'var(--bv-turq)', x: '55%', y: '-5%' },
    { c: 'var(--bv-verde)', x: '-55%', y: '-10%' },
    { c: 'var(--bv-turq)', x: '50%', y: '-25%' },
    { c: 'var(--bv-amarelo)', x: '-55%', y: '5%' },
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function jaViu() { try { return localStorage.getItem(CHAVE) === '1'; } catch (_) { return true; } }
  function marcaVisto() { try { localStorage.setItem(CHAVE, '1'); } catch (e) { console.warn('boas-vindas: não guardei o "já vi" neste aparelho:', e.message); } }

  async function api(metodo, caminho, corpo) {
    const r = await fetch(caminho, {
      method: metodo, credentials: 'same-origin', cache: 'no-store',
      headers: corpo === undefined ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    let d = null;
    try { d = await r.json(); } catch (_) { /* sem corpo */ }
    if (!r.ok || !d || d.ok === false) throw new Error((d && d.erro) || ('o servidor respondeu ' + r.status));
    return d;
  }

  function htmlAgente(a) {
    const foto = a.avatar_img
      ? `<img class="foto" src="${esc(a.avatar_img)}" alt="">`
      : `<span class="foto" style="background:${esc(a.cor || '#2f9e5e')}">${esc(a.avatar || (a.nome || '?')[0])}</span>`;
    return `<div class="bv-agente">${foto}<div><div class="n">${esc(a.nome)}</div><div class="f">${esc(a.subtitulo || a.papel || '')}</div></div></div>`;
  }

  function monta(dados, agentes) {
    const perfil = dados.perfil || {};
    const av = dados.avisos;
    const time = agentes.filter((a) => a.tipo !== 'admin');
    const chips = (lista, escolhidos, nome) => lista.map((t) =>
      `<button type="button" class="bv-chip" data-grupo="${nome}" data-valor="${esc(t)}" aria-pressed="${escolhidos.includes(t)}">${esc(t)}</button>`).join('');
    const chave = (id, on, rotulo) => `<button type="button" class="bv-chave" role="switch" id="${id}" aria-checked="${on}" aria-label="${esc(rotulo)}"></button>`;

    const el = document.createElement('div');
    el.className = 'bv';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Boas-vindas ao S2 Bot');
    el.innerHTML =
      '<div class="bv-grade"></div><div class="bv-brilho"></div>' +
      `<div class="bv-splash"><div class="bv-aro"><img src="${CORUJA}" alt=""></div>` +
        '<div style="text-align:center"><div class="bv-marca">S2 <b>Bot</b></div><div class="bv-rot" style="margin-top:12px">seu agente na Smart.SAU</div></div></div>' +
      '<div class="bv-palco"><div class="bv-telas">' +
        // 1. boas-vindas
        `<section class="bv-tela"><img class="bv-heroi" src="${CORUJA}" alt=""><div class="bv-cresce"></div>` +
          '<div class="bv-rot">uma nova experiência começa agora</div>' +
          '<h1>Oi! Eu sou o<br><span class="bv-marca" style="font-size:inherit">S2 <b>Bot</b></span>,<br><span class="bv-mao">seu <span class="bv-realce">agente pessoal</span></span></h1>' +
          '<p class="bv-sub">Eu trabalho para você dentro da Smart.SAU, de dia e de noite.</p></section>' +
        // 2. equipe
        '<section class="bv-tela"><div class="bv-rot">sua equipe</div>' +
          (time.length
            ? '<h1>Uma equipe de<br><span class="bv-mao" style="color:var(--bv-verde)">corujas</span> trabalhando<br>por você</h1>' +
              '<p class="bv-sub">Cada agente cuida de uma área e fica na sua própria caixa, separado dos outros.</p>' +
              `<div class="bv-agentes">${time.slice(0, 5).map(htmlAgente).join('')}</div>`
            : '<h1>Sua equipe de<br><span class="bv-mao" style="color:var(--bv-verde)">corujas</span> começa<br>por aqui</h1>' +
              '<p class="bv-sub">Cada agente cuida de uma área e fica na sua própria caixa. Logo depois daqui, a gente cria o primeiro juntos.</p>') +
        '</section>' +
        // 3. perfil
        '<section class="bv-tela"><div class="bv-rot">conhecendo você</div>' +
          '<h1>Como posso<br><span class="bv-mao">te <span class="bv-realce">chamar</span>?</span></h1>' +
          `<label class="bv-rot2" for="bvNome">Seu nome</label><input class="bv-campo" id="bvNome" maxlength="60" autocomplete="given-name" value="${esc(perfil.nome || '')}">` +
          `<span class="bv-rot2">Onde você atua na Unesc</span><div class="bv-chips">${chips(dados.areas, perfil.area ? [perfil.area] : [], 'area')}</div>` +
          `<span class="bv-rot2">O que você quer que eu resolva primeiro</span><div class="bv-chips">${chips(dados.prioridades, perfil.prioridades || [], 'prioridades')}</div>` +
          `<div class="bv-dica">${ICONE.cadeado}Fica só no seu S2 Bot. Os agentes usam para falar do seu jeito e começar pelo que importa.</div>` +
          '<div class="bv-erro" id="bvErroPerfil" role="alert"></div></section>' +
        // 4. avisos
        '<section class="bv-tela"><div class="bv-rot">avisos no celular</div>' +
          '<h1>Quando posso<br><span class="bv-mao">te <span class="bv-realce">chamar</span>?</span></h1>' +
          '<p class="bv-sub" style="font-size:15px">Eu aviso de entregas prontas e decisões que dependem de você, mesmo com o app fechado.</p>' +
          '<div style="margin-top:22px">' +
            `<div class="bv-opc"><span class="ic">${ICONE.pedido}</span><div><div class="t">Pedidos de decisão</div><div class="d">quando um agente parou esperando você</div></div>${chave('bvPedidos', av.pedidos, 'Avisar pedidos de decisão')}</div>` +
            `<div class="bv-opc"><span class="ic">${ICONE.entrega}</span><div><div class="t">Entregas prontas</div><div class="d">relatórios, arquivos e respostas</div></div>${chave('bvEntregas', av.entregas, 'Avisar entregas prontas')}</div>` +
            `<div class="bv-opc bv-opc-col"><div class="bv-opc-linha"><span class="ic">${ICONE.lua}</span><div><div class="t">Silêncio à noite</div><div class="d">guardo os avisos e mando um resumo de manhã</div></div>${chave('bvSilencio', av.silencio.ativo || !dados.perfil, 'Silêncio à noite')}</div>` +
              `<div class="bv-horas" id="bvHoras">das <input type="time" id="bvDe" value="${esc(av.silencio.de)}" aria-label="Começo do silêncio"> às <input type="time" id="bvAte" value="${esc(av.silencio.ate)}" aria-label="Fim do silêncio"></div></div>` +
          '</div><div class="bv-erro" id="bvErroAvisos" role="alert"></div></section>' +
      '</div>' +
      '<div class="bv-rodape"><div class="bv-linha"><div class="bv-pontos"><span></span><span></span><span></span><span></span></div>' +
        '<button type="button" class="bv-pular" id="bvPular">Pular</button></div>' +
        '<button type="button" class="bv-btn" id="bvBtn"></button></div></div>';
    return el;
  }

  async function abre(opcoes) {
    const forcado = !!(opcoes && opcoes.forcar);
    let dados, agentes;
    try {
      [dados, agentes] = await Promise.all([
        api('GET', '/api/v1/boas-vindas'),
        api('GET', '/api/v1/agents').then((d) => (Array.isArray(d.agentes) ? d.agentes : [])),
      ]);
    } catch (e) {
      console.warn('boas-vindas: não abri as telas (' + e.message + '); tento na próxima vez.');
      return;
    }
    if (!forcado && jaViu()) return;
    // a coruja carregada antes de abrir: o splash não aparece com o aro vazio
    const pre = new Image(); pre.src = CORUJA;
    try { await Promise.race([pre.decode(), new Promise((r) => setTimeout(r, 2500))]); } catch (_) { /* sem a foto, abre assim mesmo */ }
    const el = monta(dados, agentes);
    document.body.appendChild(el);
    const $ = (s) => el.querySelector(s);
    const telas = Array.from(el.querySelectorAll('.bv-tela'));
    const pontos = Array.from(el.querySelectorAll('.bv-pontos span'));
    const btn = $('#bvBtn'), pular = $('#bvPular'), brilho = $('.bv-brilho');
    let i = 0;

    const nome = $('#bvNome');
    const atualizaBotao = () => { if (i === 2) btn.disabled = !nome.value.trim(); else btn.disabled = false; };
    nome.addEventListener('input', atualizaBotao);
    el.addEventListener('click', (ev) => {
      const c = ev.target.closest('.bv-chip');
      if (c) {
        if (c.dataset.grupo === 'area') for (const o of el.querySelectorAll('.bv-chip[data-grupo="area"]')) if (o !== c) o.setAttribute('aria-pressed', 'false');
        c.setAttribute('aria-pressed', String(c.getAttribute('aria-pressed') !== 'true'));
        return;
      }
      const k = ev.target.closest('.bv-chave');
      if (k) { k.setAttribute('aria-checked', String(k.getAttribute('aria-checked') !== 'true')); mostraHoras(); }
    });
    const mostraHoras = () => { $('#bvHoras').style.display = $('#bvSilencio').getAttribute('aria-checked') === 'true' ? '' : 'none'; };
    mostraHoras();

    function vai(n) {
      i = Math.max(0, Math.min(telas.length - 1, n));
      telas.forEach((t, k) => { t.classList.toggle('on', k === i); t.classList.toggle('antes', k < i); });
      pontos.forEach((p, k) => p.classList.toggle('on', k === i));
      const b = BRILHOS[i];
      brilho.style.background = b.c;
      brilho.style.transform = `translate(${b.x}, ${b.y})`;
      btn.innerHTML = i === 0 ? 'Começar ' + SETA : i === 3 ? 'Ativar avisos ' + SINO : 'Continuar ' + SETA;
      pular.textContent = i === 3 ? 'Agora não' : 'Pular';
      atualizaBotao();
      if (i === 2 && !nome.value) setTimeout(() => nome.focus(), 380);
    }

    function fecha() {
      marcaVisto();
      el.classList.add('sai');
      setTimeout(() => el.remove(), 400);
    }

    async function salvaPerfil() {
      const escolhidos = (g) => Array.from(el.querySelectorAll(`.bv-chip[data-grupo="${g}"][aria-pressed="true"]`)).map((c) => c.dataset.valor);
      await api('POST', '/api/v1/boas-vindas/perfil', { nome: nome.value.trim(), area: escolhidos('area')[0] || '', prioridades: escolhidos('prioridades') });
    }
    function escolhaAvisos() {
      const on = (id) => $(id).getAttribute('aria-checked') === 'true';
      return { pedidos: on('#bvPedidos'), entregas: on('#bvEntregas'), silencio: { ativo: on('#bvSilencio'), de: $('#bvDe').value || '22:00', ate: $('#bvAte').value || '07:00' } };
    }

    btn.addEventListener('click', async () => {
      if (i < 2) { vai(i + 1); return; }
      btn.disabled = true;
      if (i === 2) {
        try { await salvaPerfil(); $('#bvErroPerfil').textContent = ''; vai(3); } catch (e) { $('#bvErroPerfil').textContent = 'Não guardei: ' + e.message; btn.disabled = false; }
        return;
      }
      try {
        await api('POST', '/api/v1/boas-vindas/avisos', escolhaAvisos());
        // o ativar já explica cada caso (iPhone sem instalar, bloqueado, navegador sem suporte)
        const r = window.DGClawAvisos ? await window.DGClawAvisos.ativar() : { ok: false, erro: 'Os avisos não carregaram nesta página. Ative depois em Lembretes.' };
        if (!r || r.ok === false) { $('#bvErroAvisos').textContent = (r && r.erro) || 'O celular não liberou os avisos.'; btn.disabled = false; pular.textContent = 'Continuar sem avisos'; return; }
        fecha();
      } catch (e) { $('#bvErroAvisos').textContent = 'Não consegui: ' + e.message; btn.disabled = false; }
    });
    pular.addEventListener('click', async () => {
      if (i === 3) {
        try { await api('POST', '/api/v1/boas-vindas/avisos', escolhaAvisos()); } catch (e) { console.warn('boas-vindas: não guardei a escolha dos avisos:', e.message); }
      }
      fecha();
    });

    // arrastar para o lado troca de tela (menos na de perfil, onde a pessoa digita)
    let x0 = null;
    el.addEventListener('touchstart', (ev) => { x0 = ev.touches.length === 1 && !ev.target.closest('input') ? ev.touches[0].clientX : null; }, { passive: true });
    el.addEventListener('touchend', (ev) => {
      if (x0 == null) return;
      const dx = ev.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) < 60) return;
      if (dx > 0) vai(i - 1); else if (i < 2) vai(i + 1);
    }, { passive: true });

    vai(0);
    const splash = $('.bv-splash'), palco = $('.bv-palco');
    palco.style.visibility = 'hidden';
    setTimeout(() => { splash.classList.add('some'); palco.style.visibility = ''; }, forcado ? 300 : 1300);
  }

  window.DGBoasVindas = { abre: () => abre({ forcar: true }) };
  if (!jaViu()) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => abre());
    else abre();
  }
})();
