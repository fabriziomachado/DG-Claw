/* Referências (25/10/2026): os links que o dono guarda, resumidos pelo agente curador (Tech).
   Desenho C ("pergunte primeiro"): no alto a pergunta vai para a conversa do curador; embaixo a lista
   compacta por período, e tocar abre o resumo com resumir, abrir, conversar, copiar e apagar.
   Guardar não aciona o curador: o resumo é sob pedido, pelo botão Resumir (o dono não quer de todos).
   Imagem e PDF (25/10/2026) chegam pelo segundo atalho; os ajustes do compartilhar (ligado, tipos, tamanho)
   ficam no painel do Atalho.
   API em web/docs/REFERENCIAS.md. */
(function () {
  'use strict';
  const raiz = document.getElementById('refRaiz');
  if (!raiz) return;
  const esc = s => String(s == null ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SVG = {
    enviar: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    mais: '<path d="M12 5v14M5 12h14"/>',
    busca: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    atalho: '<path d="M4 12v6.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V12"/><path d="M12 4v11M7.5 8.5 12 4l4.5 4.5"/>',
    seta: '<path d="M7 17L17 7M9 7h8v8"/>',
    conversa: '<path d="M21 12a8.5 8.5 0 0 1-12.4 7.6L4 21l1.4-4.6A8.5 8.5 0 1 1 21 12z"/>',
    copiar: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>',
    apagar: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
    fechar: '<path d="M6 6l12 12M18 6 6 18"/>',
    ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    resumir: '<path d="M12 3l2.4 5.3 5.6.7-4.1 3.9 1 5.6L12 15.8 7.1 18.5l1-5.6L4 9l5.6-.7z"/>',
    imagem: '<rect x="4" y="5" width="16" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M20 16l-4.5-4.5L7 19"/>',
    pdf: '<path d="M14 3.5H7.5A1.5 1.5 0 0 0 6 5v14a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V7.5z"/><path d="M14 3.5v4h4M9 13h6M9 16.5h4"/>',
  };
  const ic = n => `<svg viewBox="0 0 24 24" aria-hidden="true">${SVG[n]}</svg>`;
  const botao = (n, titulo, extra) => `<button type="button" class="ref-ic" data-acao="${n}" title="${esc(titulo)}" aria-label="${esc(titulo)}"${extra || ''}>${ic(n)}</button>`;
  const CORES = ['--dg-serie-0', '--dg-serie-1', '--dg-serie-2', '--dg-serie-3', '--dg-serie-4', '--dg-serie-5'];
  const corDe = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `var(${CORES[h % CORES.length]})`; };

  const est = { itens: [], assuntos: [], total: 0, curador: 'tech', atalho: false, assunto: '', q: '', aberto: '', busca: false, novo: false, painelAtalho: false, chave: '', ajustes: null };
  const TAMANHOS_MB = [5, 10, 20, 50];
  const ehArquivo = r => r.tipo === 'imagem' || r.tipo === 'pdf';
  const urlArquivo = r => '/api/v1/referencias/' + encodeURIComponent(r.id) + '/arquivo';
  const tamanho = b => b >= 1048576 ? (b / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  // sem título ainda: o nome do arquivo, ou "Imagem de 25/10"
  const tituloDe = r => r.titulo || (ehArquivo(r) ? (r.arquivo && r.arquivo.nome && r.tipo === 'pdf' ? r.arquivo.nome :
    `${r.tipo === 'pdf' ? 'PDF' : 'Imagem'} de ${new Date(r.criada).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`) : urlCurta(r.url));

  async function api(caminho, opcoes) {
    const o = Object.assign({ credentials: 'same-origin', cache: 'no-store', headers: {} }, opcoes || {});
    if (o.body && typeof o.body !== 'string') { o.body = JSON.stringify(o.body); o.headers['Content-Type'] = 'application/json'; }
    const r = await fetch(caminho, o);
    let j = null;
    try { j = await r.json(); } catch (_) { /* resposta sem corpo */ }
    if (!r.ok || (j && j.ok === false)) throw new Error((j && j.erro) || `O servidor respondeu ${r.status}.`);
    return j;
  }

  function quando(ms) {
    const d = new Date(ms), hoje = new Date();
    const min = Math.round((Date.now() - ms) / 60000);
    if (min < 60) return min <= 1 ? 'agora' : `há ${min} min`;
    if (d.toDateString() === hoje.toDateString()) return `há ${Math.round(min / 60)} h`;
    const ontem = new Date(); ontem.setDate(hoje.getDate() - 1);
    if (d.toDateString() === ontem.toDateString()) return 'ontem';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }
  function periodo(ms) {
    const d = new Date(ms), h = new Date(); h.setHours(0, 0, 0, 0);
    const dias = Math.floor((h - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    if (dias <= 0) return 'Hoje';
    if (dias < 7) return 'Esta semana';
    if (dias < 31) return 'Este mês';
    return 'Antes';
  }

  function linha(r) {
    const titulo = tituloDe(r);
    const meta = [r.fonte, ehArquivo(r) && r.arquivo ? tamanho(r.arquivo.bytes) : '', r.assuntos.join(', '), quando(r.criada)].filter(Boolean).join(' · ');
    const aviso = r.estado === 'nova' ? '<span class="ref-estado">resumindo</span>' :
      r.estado === 'erro' ? '<span class="ref-estado erro">não abriu</span>' : '';
    const aberto = est.aberto === r.id;
    let h = `<div class="ref-item${aberto ? ' aberto' : ''}" data-id="${esc(r.id)}">` +
      `<button type="button" class="ref-lin" data-acao="abre" aria-expanded="${aberto}">` +
      (ehArquivo(r) ? `<span class="ref-fav">${ic(r.tipo)}</span>` :
        `<span class="ref-fav" style="color:${corDe(r.fonte)}">${esc((r.fonte || '?')[0].toUpperCase())}</span>`) +
      `<span class="ref-x"><span class="ref-t">${esc(titulo)}</span><span class="ref-m">${esc(meta)}${aviso}</span></span>` +
      (r.vista ? '' : '<span class="ref-ponto" title="Ainda não vista"></span>') + '</button>';
    if (aberto) {
      const corpo = r.resumo || (r.estado === 'erro' ? `O ${esc(nomeCurador())} não conseguiu abrir: ${esc(r.erro)}` :
        r.estado === 'nova' ? `O ${esc(nomeCurador())} está lendo ${ehArquivo(r) ? 'este arquivo' : 'este link'}.` : `Sem resumo. Toque na estrela para pedir ao ${esc(nomeCurador())}.`);
      const podeResumir = r.estado !== 'nova';
      const qual = r.tipo === 'pdf' ? 'o PDF' : r.tipo === 'imagem' ? 'a imagem' : 'o link';
      h += (r.tipo === 'imagem' ? `<a class="ref-img" href="${urlArquivo(r)}" target="_blank" rel="noopener"><img src="${urlArquivo(r)}" alt="" loading="lazy"></a>` : '') +
        `<div class="ref-res">${r.resumo ? esc(corpo) : corpo}</div>` +
        (r.nota ? `<div class="ref-nota">${esc(r.nota)}</div>` : '') +
        '<div class="ref-acoes">' +
        (podeResumir ? botao('resumir', r.resumo ? `Pedir outro resumo ao ${nomeCurador()}` : `Pedir resumo ao ${nomeCurador()}`) : '') +
        `<a class="ref-ic" href="${esc(ehArquivo(r) ? urlArquivo(r) : r.url)}" target="_blank" rel="noopener noreferrer" title="Abrir ${qual}" aria-label="Abrir ${qual}">${ic('seta')}</a>` +
        botao('conversa', `Conversar com o ${nomeCurador()} sobre ${qual}`) +
        (ehArquivo(r) ? '' : botao('copiar', 'Copiar o link')) + botao('apagar', 'Apagar') + '</div>';
    }
    return h + '</div>';
  }

  // link sem título ainda: sem https://, www e parâmetros, que já diz bastante
  const urlCurta = u => String(u).replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/$/, '');
  const nomeCurador = () => est.curador.charAt(0).toUpperCase() + est.curador.slice(1);

  function render() {
    const sug = ['Resumo da semana', 'O que ainda não li?'];
    let h = '<div class="ref-topo"><h1>Referências<span class="ref-n">' + esc(est.total.toLocaleString('pt-BR')) + '</span></h1>' +
      botao('busca', 'Buscar', est.busca ? ' aria-pressed="true"' : '') +
      botao('atalho', 'Atalho do compartilhar', est.atalho ? '' : ' data-alerta="1"') +
      botao('mais', 'Guardar um link') + '</div>';
    if (est.novo) {
      h += '<form class="ref-campo" data-form="novo"><input name="url" type="url" inputmode="url" placeholder="Cole o link aqui" autocomplete="off" required>' +
        '<button type="submit" class="ref-pri">Guardar</button></form>';
    }
    if (est.busca) {
      h += `<div class="ref-campo"><input data-campo="q" type="search" placeholder="Buscar por palavra" value="${esc(est.q)}" autocomplete="off"></div>`;
    }
    if (est.painelAtalho) h += painelAtalho();
    h += '<form class="ref-pergunta" data-form="pergunta">' +
      `<textarea name="pergunta" rows="1" placeholder="Pergunte às suas referências"></textarea>` +
      '<div class="ref-sug">' + sug.map(s => `<button type="button" class="ref-chip" data-sug="${esc(s)}">${esc(s)}</button>`).join('') +
      `<button type="submit" class="ref-enviar" title="Perguntar ao ${esc(nomeCurador())}" aria-label="Perguntar">${ic('enviar')}</button></div></form>`;
    h += '<div class="ref-chips">' + [{ nome: '' }].concat(est.assuntos.slice(0, 12)).map(a =>
      `<button type="button" class="ref-chip${est.assunto === a.nome ? ' on' : ''}" data-assunto="${esc(a.nome)}">${esc(a.nome || 'Todas')}</button>`).join('') + '</div>';
    if (!est.itens.length) {
      h += `<p class="ref-vazio">${est.total ? 'Nada com esse filtro.' : 'Nenhuma referência ainda. Toque no + para guardar um link, ou ligue o Atalho para mandar direto do compartilhar.'}</p>`;
    } else {
      let atual = '';
      for (const r of est.itens) {
        const p = periodo(r.criada);
        if (p !== atual) { h += `<div class="ref-rot">${p}</div>`; atual = p; }
        h += linha(r);
      }
    }
    raiz.innerHTML = h;
  }

  function painelAtalho() {
    const endereco = location.origin + '/api/referencias/entrada';
    let h = '<div class="ref-painel"><div class="ref-painel-topo"><strong>Atalho do compartilhar</strong>' + botao('fechar', 'Fechar') + '</div>';
    h += `<p>Com ele, o S2 Bot aparece no compartilhar do iPhone: <b>Mandar pro S2 Bot</b> para links e <b>Arquivo pro S2 Bot</b> para imagem e PDF. Chega aqui sem abrir o app. Guia completo: <a href="/guia-atalho.html" target="_blank">como configurar</a>. ${est.chave ? '' : est.atalho ? 'O Atalho já tem uma chave. Gerar outra desliga a antiga.' : 'Ainda não há chave.'}</p>`;
    h += painelAjustes();
    if (est.chave) {
      h += '<p class="ref-alerta">Copie a chave agora. Ela não aparece de novo.</p>' +
        `<div class="ref-copia"><code>${esc(est.chave)}</code>${botao('copiar-chave', 'Copiar a chave')}</div>` +
        `<div class="ref-copia"><code>${esc(endereco)}</code>${botao('copiar-endereco', 'Copiar o endereço')}</div>` +
        '<ol class="ref-passos">' +
        '<li>Copie o <b>endereço</b> acima. Abra o app <b>Atalhos</b>, toque em <b>+</b>, busque a ação <b>Obter Conteúdo do URL</b> e cole o endereço no lugar de <b>URL</b>.</li>' +
        '<li>Toque em <b>Mostrar Mais</b>. Troque <b>GET</b> por <b>POST</b>.</li>' +
        '<li>Em <b>Cabeçalhos</b>, adicione um: chave <b>Authorization</b>, valor <b>Bearer</b>, um espaço e a <b>chave</b> acima (ela começa com <b>ref_</b>).</li>' +
        '<li>Em <b>Corpo da Solicitação</b>, escolha <b>JSON</b> e adicione um campo de Texto: à esquerda escreva <b>url</b>; à direita escolha a variável <b>Entrada do Atalho</b>.</li>' +
        '<li>Toque no nome no alto, <b>Renomear</b>: <b>Mandar pro S2 Bot</b>. No <b>ⓘ</b>, ligue <b>Mostrar na Folha de Compartilhamento</b> (URLs e Texto).</li>' +
        '<li>Teste pelo compartilhar de uma página de verdade (o ▶ dentro do Atalhos roda sem link). Para deixar à mão: <b>Editar Ações</b>, <b>+</b> em Favoritos.</li></ol>' +
        '<p class="ref-dica">Outro iPhone com o mesmo Apple ID recebe o atalho sozinho pelo iCloud: não gere chave nova, porque ela desliga a antiga em todos os aparelhos.</p>';
    } else {
      h += `<button type="button" class="ref-pri" data-acao="gerar">${est.atalho ? 'Gerar chave nova' : 'Gerar chave'}</button>`;
    }
    return h + '</div>';
  }

  function painelAjustes() {
    const a = est.ajustes;
    if (!a) return '';
    const sw = (id, on, rot) => `<button type="button" class="ref-sw${on ? ' on' : ''}" role="switch" aria-checked="${on}" data-sw="${id}" aria-label="${esc(rot)}" title="${esc(rot)}"></button>`;
    const op = (id, on, rot, sub) => `<div class="ref-op"><span><b>${rot}</b>${sub ? `<small>${sub}</small>` : ''}</span>${sw(id, on, rot)}</div>`;
    return '<div class="ref-ajustes">' +
      op('ligado', a.ligado, 'Compartilhar', a.ligado ? 'recebendo do iPhone' : 'desligado: o iPhone recebe um aviso e nada entra') +
      `<div class="ref-tipos${a.ligado ? '' : ' apagado'}"><div class="ref-sub">O que aceita</div>` +
      op('link', a.tipos.link, 'Links') + op('imagem', a.tipos.imagem, 'Imagens', 'JPG, PNG, HEIC, WEBP, GIF') + op('pdf', a.tipos.pdf, 'PDF') +
      '<div class="ref-sub">Tamanho máximo do arquivo</div><div class="ref-mb">' +
      TAMANHOS_MB.map(n => `<button type="button" class="ref-chip${a.max_mb === n ? ' on' : ''}" data-mb="${n}">${n} MB</button>`).join('') +
      '</div></div></div>';
  }

  async function mudaAjustes(c) {
    try { const j = await api('/api/v1/referencias/ajustes', { method: 'PUT', body: c }); est.ajustes = j.ajustes; render(); }
    catch (e) { aviso('Não consegui mudar: ' + e.message); }
  }

  async function carrega() {
    const qs = new URLSearchParams();
    if (est.q) qs.set('q', est.q);
    if (est.assunto) qs.set('assunto', est.assunto);
    try {
      const j = await api('/api/v1/referencias?' + qs);
      Object.assign(est, { itens: j.itens, assuntos: j.assuntos, total: j.total, curador: j.curador || 'tech', atalho: !!j.atalho_ligado, ajustes: j.ajustes || est.ajustes });
    } catch (e) { aviso('Não consegui carregar as referências: ' + e.message); }
    const foco = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.campo;
    const digitando = document.activeElement && /TEXTAREA|INPUT/.test(document.activeElement.tagName) && !foco;
    if (digitando) return; // não apaga o que a pessoa está escrevendo
    render();
    if (foco) { const c = raiz.querySelector(`[data-campo="${foco}"]`); if (c) { c.focus(); c.setSelectionRange(c.value.length, c.value.length); } }
  }

  function aviso(msg) {
    let el = document.getElementById('refAviso');
    if (!el) { el = document.createElement('div'); el.id = 'refAviso'; el.className = 'ref-toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('aparece');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('aparece'), 3500);
  }

  async function perguntar(texto, ref) {
    const t = String(texto || '').trim();
    if (!t) return;
    // o curador consulta a lista pela caixa; a dica vai junto para ele não precisar lembrar
    const corpo = '[da tela de Referências; a lista está em dgclaw-api GET /api/v1/referencias (filtros ?q= e ?assunto=)] ' + t + (ref ? `\n(referência ${ref.id}: ${ref.url})` : '');
    try {
      await api('/api/v1/agents/' + encodeURIComponent(est.curador) + '/send', { method: 'POST', body: { text: corpo } });
      location.href = '/a/' + encodeURIComponent(est.curador);
    } catch (e) { aviso(`Não consegui mandar ao ${nomeCurador()}: ${e.message}`); }
  }

  const copia = async (t, ok) => { try { await navigator.clipboard.writeText(t); aviso(ok); } catch (_) { aviso('Não deu para copiar. Toque e segure no texto.'); } };

  raiz.addEventListener('click', async ev => {
    const alvo = ev.target.closest('[data-acao],[data-assunto],[data-sug],[data-sw],[data-mb]');
    if (!alvo) return;
    if (alvo.dataset.sw && est.ajustes) {
      const k = alvo.dataset.sw, on = !alvo.classList.contains('on');
      return mudaAjustes(k === 'ligado' ? { ligado: on } : { tipos: { [k]: on } });
    }
    if (alvo.dataset.mb) return mudaAjustes({ max_mb: Number(alvo.dataset.mb) });
    if (alvo.dataset.assunto != null) { est.assunto = alvo.dataset.assunto; est.aberto = ''; return carrega(); }
    if (alvo.dataset.sug) return perguntar(alvo.dataset.sug);
    const item = alvo.closest('.ref-item');
    const r = item && est.itens.find(x => x.id === item.dataset.id);
    switch (alvo.dataset.acao) {
      case 'abre':
        est.aberto = est.aberto === r.id ? '' : r.id;
        if (est.aberto && !r.vista) { r.vista = true; api('/api/v1/referencias/' + r.id, { method: 'PATCH', body: { vista: true } }).catch(() => {}); }
        return render();
      case 'conversa': {
        // abre a conversa do curador com o link já escrito no campo, sem enviar: o dono completa com a pergunta dele
        const texto = `Sobre a referência ${r.id}, ${r.titulo ? `"${r.titulo}" ` : ''}(${ehArquivo(r) ? (r.tipo === 'pdf' ? 'PDF guardado' : 'imagem guardada') + ' nas Referências' : r.url}): `;
        location.href = '/a/' + encodeURIComponent(est.curador) + '?texto=' + encodeURIComponent(texto);
        return;
      }
      case 'copiar': return copia(r.url, 'Link copiado.');
      case 'resumir':
        try { await api('/api/v1/referencias/' + r.id + '/resumir', { method: 'POST' }); aviso(`Pedido ao ${nomeCurador()}. O resumo aparece aqui em instantes.`); carrega(); } catch (e) { aviso(e.message); }
        return;
      case 'apagar':
        if (!confirm('Apagar esta referência?')) return;
        try { await api('/api/v1/referencias/' + r.id, { method: 'DELETE' }); est.aberto = ''; carrega(); } catch (e) { aviso(e.message); }
        return;
      case 'mais': est.novo = !est.novo; render(); if (est.novo) raiz.querySelector('[data-form="novo"] input').focus(); return;
      case 'busca': est.busca = !est.busca; if (!est.busca && est.q) { est.q = ''; carrega(); } else render(); if (est.busca) raiz.querySelector('[data-campo="q"]').focus(); return;
      case 'atalho': est.painelAtalho = !est.painelAtalho; est.chave = ''; return render();
      case 'fechar': est.painelAtalho = false; est.chave = ''; return render();
      case 'gerar':
        if (est.atalho && !confirm('Gerar outra chave? O Atalho com a chave antiga para de funcionar.')) return;
        try { const j = await api('/api/v1/referencias/atalho', { method: 'POST' }); est.chave = j.chave; est.atalho = true; render(); } catch (e) { aviso(e.message); }
        return;
      case 'copiar-chave': return copia(est.chave, 'Chave copiada.');
      case 'copiar-endereco': return copia(location.origin + '/api/referencias/entrada', 'Endereço copiado.');
    }
  });

  raiz.addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    if (f.dataset.form === 'pergunta') return perguntar(f.pergunta.value);
    if (f.dataset.form === 'novo') {
      try {
        const j = await api('/api/v1/referencias', { method: 'POST', body: { url: f.url.value } });
        est.novo = false;
        aviso(j.repetida ? 'Esse link já estava guardado.' : 'Guardado.');
        carrega();
      } catch (e) { aviso(e.message); }
    }
  });

  let espera = null;
  raiz.addEventListener('input', ev => {
    if (ev.target.dataset.campo === 'q') { est.q = ev.target.value; clearTimeout(espera); espera = setTimeout(carrega, 250); }
    if (ev.target.name === 'pergunta') { ev.target.style.height = 'auto'; ev.target.style.height = Math.min(ev.target.scrollHeight, 140) + 'px'; }
  });
  raiz.addEventListener('keydown', ev => {
    if (ev.target.name === 'pergunta' && ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); perguntar(ev.target.value); }
  });

  render();
  carrega();
  // os resumos chegam aos poucos: confere de novo enquanto a tela está aberta
  setInterval(() => { if (!document.hidden && !est.chave) carrega(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) carrega(); });
})();
