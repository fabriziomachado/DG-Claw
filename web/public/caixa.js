'use strict';
/* caixa.js: a Caixa de entrada (19/10/2026, pedido do dono). Tudo que espera o dono num lugar só:
   pedidos de decisão e entregas de todos os agentes (GET /api/v1/caixa) e os lembretes que estão
   tocando (GET /api/v1/lembretes, campo "insistindo"). Responde ali mesmo:
   - pedido com cartão de escolha: tocar numa opção manda a resposta ao agente como se fosse na
     conversa ("↩ <pergunta>" + a opção) e marca o alerta como visto;
   - entrega: "Visto" tira da caixa; "Abrir" leva à conversa;
   - lembrete: Feito ou Adiar 1 h, pelas rotas dos lembretes.
   Atualiza a cada 20 s e quando a aba volta ao foco. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const lista = $('cxLista'), msg = $('cxMsg');
  let agentes = {}, itens = [], filtro = 'tudo', ocupado = new Set();

  const ICO = {
    lembrete: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 16v-5a6 6 0 0 0-12 0v5l-1.5 2h15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>',
    vazio: '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13h4l1.5 2.5h5L16 13h4"/><path d="M5.5 5h13L20 13v5.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5V13z"/></svg>',
  };
  const TAG = { pedido: 'decisão', entrega: 'entrega', lembrete: 'lembrete' };

  async function api(url, op) {
    const r = await fetch(url, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, op || {}));
    if (r.status === 401) { location.href = '/login?next=' + encodeURIComponent(location.pathname); throw new Error('sessão expirada'); }
    let d = null; try { d = await r.json(); } catch (_) { d = null; }
    if (!r.ok || !d || d.ok === false) throw new Error((d && (d.erro || d.error)) || ('o servidor respondeu ' + r.status));
    return d;
  }
  const post = (url, corpo) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo || {}) });

  function quando(ep) {
    const s = Math.max(0, Date.now() / 1000 - ep);
    if (s < 60) return 'agora';
    if (s < 3600) return 'há ' + Math.round(s / 60) + ' min';
    if (s < 86400) return 'há ' + Math.round(s / 3600) + ' h';
    const d = Math.round(s / 86400);
    return d === 1 ? 'ontem' : 'há ' + d + ' dias';
  }
  function avatar(slug) {
    const a = agentes[slug] || { nome: slug, cor: '#5b6472' };
    const img = a.avatar_img || (/^https:\/\//i.test(a.avatar || '') ? a.avatar : '');
    return `<span class="cx-av" style="background:${esc(a.cor || '#5b6472')}">${img ? `<img src="${esc(img)}" alt="">` : esc((a.avatar || a.nome || '?').slice(0, 1))}</span>`;
  }
  const nome = slug => (agentes[slug] && agentes[slug].nome) || slug;

  function cartao(it) {
    const k = esc(it.chave);
    if (it.tipo === 'lembrete') {
      return `<article class="cx-card" data-k="${k}"><div class="cx-l1"><span class="cx-av ico">${ICO.lembrete}</span><b>Lembrete</b>` +
        `<span class="cx-tag lembrete">${esc(it.agente_nome || nome(it.agente))}</span><span class="cx-quando">aviso ${esc(it.envio || 1)} de ${esc(it.teto)}</span></div>` +
        `<div class="cx-tx">${esc(it.texto)}</div>` +
        `<div class="cx-acoes"><button type="button" class="cx-bt pri" data-acao="feito" data-k="${k}">Feito</button>` +
        `<button type="button" class="cx-bt" data-acao="adiar" data-k="${k}">Adiar 1 h</button></div></article>`;
    }
    const cab = `<div class="cx-l1">${avatar(it.agente)}<b>${esc(nome(it.agente))}</b><span class="cx-tag ${it.tipo}">${TAG[it.tipo]}</span>` +
      `<span class="cx-quando">${esc(quando(it.ep))}</span></div>`;
    const abrir = `<a class="cx-bt" href="/a/${encodeURIComponent(it.agente)}">Abrir a conversa</a>`;
    if (it.tipo === 'pedido') {
      const ops = (it.opcoes || []).map((o, i) => `<button type="button" class="cx-op" data-acao="opcao" data-k="${k}" data-i="${i}">` +
        `<span>${esc(o.texto)}${o.recomendada ? '<span class="rec">recomendada</span>' : ''}</span>${o.detalhe ? `<small>${esc(o.detalhe)}</small>` : ''}</button>`).join('');
      return `<article class="cx-card pede" data-k="${k}">${cab}<div class="cx-tx">${esc(it.texto)}</div>` +
        (ops ? `${it.pergunta ? `<div class="cx-perg">${esc(it.pergunta)}</div>` : ''}<div class="cx-ops">${ops}</div>` : '') +
        `<div class="cx-acoes">${abrir}<button type="button" class="cx-bt" data-acao="visto" data-k="${k}">Já resolvi</button></div></article>`;
    }
    return `<article class="cx-card" data-k="${k}">${cab}<div class="cx-tx">${esc(it.texto)}</div>` +
      `<div class="cx-acoes">${abrir}<button type="button" class="cx-bt" data-acao="visto" data-k="${k}">Visto</button></div></article>`;
  }

  function pinta() {
    const conta = { tudo: itens.length, pedido: 0, entrega: 0, lembrete: 0 };
    itens.forEach(i => { conta[i.tipo]++; });
    document.querySelectorAll('#cxFiltros .cx-chip').forEach(b => {
      const f = b.dataset.f, n = conta[f] || 0;
      b.innerHTML = esc(b.textContent.replace(/\d+$/, '').trim()) + (n ? `<span class="n">${n}</span>` : '');
      b.classList.toggle('on', f === filtro); b.setAttribute('aria-selected', String(f === filtro));
    });
    const vis = itens.filter(i => filtro === 'tudo' || i.tipo === filtro);
    if (!vis.length) {
      lista.innerHTML = `<div class="cx-vazio">${ICO.vazio}${filtro === 'tudo' ? 'Nada esperando você. Quando um agente pedir uma decisão, entregar algo ou um lembrete tocar, aparece aqui.' : 'Nada deste tipo agora.'}</div>`;
      return;
    }
    const precisa = vis.filter(i => i.tipo !== 'entrega'), novidades = vis.filter(i => i.tipo === 'entrega');
    let html = '';
    if (precisa.length) html += `<div class="cx-sec">Precisa de você<span class="q">${precisa.length}</span></div>` + precisa.map(cartao).join('');
    if (novidades.length) html += `<div class="cx-sec">Novidades<span class="q">${novidades.length}</span></div>` + novidades.map(cartao).join('');
    lista.innerHTML = html;
  }

  function aviso(t, erro) { msg.textContent = t; msg.hidden = !t; msg.classList.toggle('erro', !!erro); }

  async function carrega() {
    try {
      const [ag, cx, lb] = await Promise.all([
        api('/api/v1/agents'),
        api('/api/v1/caixa'),
        api('/api/v1/lembretes').catch(e => { console.warn('caixa: sem os lembretes:', e.message); return { insistindo: [] }; }),
      ]);
      agentes = {};
      (ag.agentes || []).forEach(a => { agentes[a.id] = a; });
      const novos = (cx.itens || []).map(i => Object.assign({ chave: 'a:' + i.agente + ':' + i.id }, i))
        .concat((lb.insistindo || []).map(o => ({ chave: 'l:' + o.id, tipo: 'lembrete', id: o.id, agente: o.agente, agente_nome: o.agente_nome, texto: o.texto, envio: o.envio, teto: o.teto })));
      itens = novos.filter(i => !ocupado.has(i.chave));
      aviso('');
      pinta();
    } catch (e) {
      aviso('Não consegui atualizar a caixa de entrada: ' + e.message + '. Tento de novo em instantes.', true);
    }
  }

  function some(chave) {
    ocupado.add(chave);
    const el = lista.querySelector(`.cx-card[data-k="${CSS.escape(chave)}"]`);
    if (el) el.classList.add('saindo');
    setTimeout(() => { itens = itens.filter(i => i.chave !== chave); pinta(); if (window.DGMenuLado && window.DGMenuLado.atualizaCaixa) window.DGMenuLado.atualizaCaixa(); }, 260);
  }

  lista.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-acao]');
    if (!b) return;
    const it = itens.find(i => i.chave === b.dataset.k);
    if (!it) return;
    const botoes = [...lista.querySelectorAll(`[data-k="${CSS.escape(it.chave)}"] button`)];
    botoes.forEach(x => { x.disabled = true; });
    try {
      if (b.dataset.acao === 'opcao') {
        const o = it.opcoes[+b.dataset.i];
        // a mesma resposta que o cartão de escolha da conversa manda: a pergunta citada e a opção
        const texto = (it.pergunta ? '↩ ' + it.pergunta + '\n' : '') + o.texto;
        await post('/api/v1/agents/' + encodeURIComponent(it.agente) + '/send', { text: texto, cliente_id: 'cx' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) });
        await post('/api/v1/agents/' + encodeURIComponent(it.agente) + '/alertas/' + it.id + '/visto');
        aviso(`Resposta enviada ao ${nome(it.agente)}: "${o.texto}".`);
      } else if (b.dataset.acao === 'visto') {
        await post('/api/v1/agents/' + encodeURIComponent(it.agente) + '/alertas/' + it.id + '/visto');
      } else if (b.dataset.acao === 'feito') {
        await post('/api/v1/lembretes/ocorrencias/' + encodeURIComponent(it.id) + '/feito');
      } else if (b.dataset.acao === 'adiar') {
        await post('/api/v1/lembretes/ocorrencias/' + encodeURIComponent(it.id) + '/adiar', { minutos: 60 });
        aviso('Lembrete adiado por 1 hora.');
      }
      some(it.chave);
    } catch (e) {
      botoes.forEach(x => { x.disabled = false; });
      aviso('Não deu certo: ' + e.message + '.', true);
    }
  });
  $('cxFiltros').addEventListener('click', ev => {
    const b = ev.target.closest('[data-f]'); if (!b) return;
    filtro = b.dataset.f; pinta();
  });

  window.DGCaixaTutorial = () => window.DGTour && window.DGTour.inicia({ passos: [
    { alvo: '#cxLista', titulo: 'Caixa de entrada', oque: 'Tudo que espera você, de todos os agentes: pedidos de decisão, lembretes tocando e entregas.',
      como: 'Responda ali mesmo: toque numa opção para responder ao agente, em Feito ou Adiar no lembrete, ou em Visto na entrega. O número no menu e no ícone do app é quantos itens ainda estão aqui.',
      porque: 'Para você não precisar abrir cada conversa para saber o que depende de você.' },
    { alvo: '#cxFiltros', titulo: 'Filtros', oque: 'Mostra só um tipo de item.', como: 'Toque em Decidir, Lembretes ou Entregas; Tudo volta a mostrar todos.', porque: 'Quando a caixa enche, ajuda a resolver um tipo de cada vez.' },
  ] });

  carrega();
  setInterval(() => { if (!document.hidden) carrega(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) carrega(); });
})();
