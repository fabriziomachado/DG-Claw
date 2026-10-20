'use strict';
/* saude.js: a Saúde do servidor, só no Admin (20/10/2026, pedido do dono). Mostra o que o
   GET /api/v1/saude-servidor junta: o resumo das conferências do `dgclaw status`, disco, memória e
   processador, o estado de cada agente e o consumo de tokens (24 h ou 7 dias). Atualiza a cada minuto;
   o ícone do resumo confere na hora (?forca=1). */
(function () {
  const raiz = document.getElementById('ssRaiz');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ico = d => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I = {
    ok: ico('<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
    alerta: ico('<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/>'),
    atualiza: ico('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>'),
    servidor: ico('<rect x="3.5" y="4" width="17" height="7" rx="1.5"/><rect x="3.5" y="13" width="17" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>'),
    agentes: ico('<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.5M18.5 19a5.5 5.5 0 0 0-3-4.9"/>'),
    raio: ico('<path d="M13 3 5 13h6l-1 8 8-10h-6z"/>'),
  };
  let dados = null, periodo = 'dia', agentesInfo = {}, carregando = false, verTudo = false;

  const gb = b => (b / 1073741824).toFixed(b >= 1e11 ? 0 : 1).replace('.', ',') + ' GB';
  function bytes(b) {
    if (!Number.isFinite(b)) return '–';
    if (b >= 1073741824) return gb(b);
    if (b >= 1048576) return Math.round(b / 1048576) + ' MB';
    return Math.round(b / 1024) + ' KB';
  }
  function num(n) {
    if (!Number.isFinite(n)) return '–';
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e8 ? 0 : 1).replace('.', ',').replace(/,0$/, '') + ' mi';
    if (n >= 1e3) return Math.round(n / 1e3) + ' mil';
    return String(n);
  }
  function haQuanto(ep) {
    if (!ep) return 'sem resposta ainda';
    const s = Math.max(0, Date.now() / 1000 - ep);
    if (s < 90) return 'respondeu agora';
    if (s < 3600) return `respondeu há ${Math.round(s / 60)} min`;
    if (s < 86400) return `respondeu há ${Math.round(s / 3600)} h`;
    return `respondeu há ${Math.round(s / 86400)} dias`;
  }
  const ligado = s => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600); return d ? `ligado há ${d} ${d === 1 ? 'dia' : 'dias'}` : `ligado há ${h} h`; };
  function foto(slug) {
    const a = agentesInfo[slug] || {};
    const img = a.avatar_img || (/^https:\/\//i.test(a.avatar || '') ? a.avatar : '');
    return `<span class="ss-av" style="background:${esc(a.cor || '#5b6472')}">${img ? `<img src="${esc(img)}" alt="">` : esc((a.avatar || a.nome || slug || '?').slice(0, 1))}</span>`;
  }
  // a frase do status, em palavras de gente
  function frase(t) {
    return t.replace(/^dominio:\s*/, 'Site: ').replace(/^servico (\S+) de pe$/, 'Serviço $1 de pé').replace(/^Web responde.*$/, 'S2 Bot (Web) respondendo')
      .replace(/^Admin responde.*$/, 'Admin respondendo').replace(/^imagem dos agentes pronta$/, 'Caixa dos agentes pronta')
      .replace(/^firewall com.*$/, 'Firewall com as regras certas').replace(/^inotify: (\d+) de (\d+).*$/, 'Vigias de arquivo: $1 de $2 em uso')
      .replace(/^agente (\S+): de pe e respondendo$/, (_, sl) => `Agente ${(agentesInfo[sl] || {}).nome || sl} de pé e respondendo`);
  }

  function pinta() {
    const d = dados;
    const ruins = d.conferencias.filter(c => c.estado !== 'ok');
    const quando = new Date(d.conferido_em);
    const hhmm = `${String(quando.getHours()).padStart(2, '0')}:${String(quando.getMinutes()).padStart(2, '0')}`;
    const resumo = `<div class="ss-resumo ${ruins.some(c => c.estado === 'falha') ? 'falha' : ruins.length ? 'aviso' : 'ok'}">${ruins.length ? I.alerta : I.ok}` +
      `<span class="ss-rtx"><b>${ruins.length ? `${ruins.length} ${ruins.length === 1 ? 'coisa pede' : 'coisas pedem'} atenção` : 'Tudo de pé.'}</b>` +
      `<small>${d.conferencias.length - ruins.length} de ${d.conferencias.length} conferências ok · conferido às ${hhmm}</small></span>` +
      `<button type="button" class="ss-bt" id="ssAtualiza" title="Conferir agora" aria-label="Conferir agora">${I.atualiza}</button></div>`;
    const m = d.maquina;
    const k = (nome, pct, sub) => `<div class="ss-k"><span>${nome}</span><b>${Number.isFinite(pct) ? pct + '%' : '–'}</b><div class="ss-barra${pct >= 90 ? ' alto' : pct >= 75 ? ' medio' : ''}"><i style="width:${Math.min(100, pct || 0)}%"></i></div><small>${sub}</small></div>`;
    const servidor = `<div class="ss-sec">${I.servidor}Servidor</div><div class="ss-grade">` +
      k('Disco', m.disco && m.disco.pct, m.disco ? `${gb(m.disco.usado)} de ${gb(m.disco.total)}` : 'sem dado') +
      k('Memória', m.memoria.pct, `${gb(m.memoria.usado)} de ${gb(m.memoria.total)}`) +
      k('Processador', m.processador.pct, `${m.processador.nucleos} ${m.processador.nucleos === 1 ? 'núcleo' : 'núcleos'} · ${ligado(m.ligado_ha_s)}`) + '</div>' +
      conferencias(d, ruins);
    const EST = { de_pe: ['de pé', ''], trabalhando: ['trabalhando', 'trab'], fora: ['fora do ar', 'fora'] };
    const agentes = `<div class="ss-sec">${I.agentes}Agentes<span class="q">${d.agentes.length}</span></div><div class="ss-grupo">` +
      d.agentes.map(a => `<a class="ss-li ss-ag" href="/a/${encodeURIComponent(a.slug)}">${foto(a.slug)}<span class="ss-agtx"><b>${esc((agentesInfo[a.slug] || {}).nome || a.nome)}</b>` +
        `<small>${esc(haQuanto(a.ultima_resposta_ep))} · casa ${bytes(a.casa_bytes)}</small></span><span class="ss-est ${(EST[a.estado] || EST.de_pe)[1]}">${(EST[a.estado] || EST.de_pe)[0]}</span></a>`).join('') + '</div>';
    const linhas = [...d.consumo].sort((x, y) => y[periodo].entrada - x[periodo].entrada);
    const totE = linhas.reduce((t, a) => t + a[periodo].entrada, 0), totC = linhas.reduce((t, a) => t + a[periodo].cache, 0);
    const consumo = `<div class="ss-sec">${I.raio}Consumo de tokens<span class="q ss-chips"><button type="button" class="ss-chip${periodo === 'dia' ? ' on' : ''}" data-periodo="dia">24 h</button><button type="button" class="ss-chip${periodo === 'semana' ? ' on' : ''}" data-periodo="semana">7 dias</button></span></div>` +
      `<div class="ss-grupo"><div class="ss-tok"><span class="h">Agente</span><span class="h">Entrada</span><span class="h">Saída</span>` +
      linhas.map(a => `<span class="ss-n">${foto(a.slug)}${esc((agentesInfo[a.slug] || {}).nome || a.nome)}</span><b>${num(a[periodo].entrada)}</b><b>${num(a[periodo].saida)}</b>`).join('') + '</div></div>' +
      (totE ? `<p class="ss-fraco">${Math.round((totC / totE) * 100)}% da entrada veio do cache, que custa bem menos. Na assinatura, o que conta é o limite de uso da conta, e não o valor.</p>` : '');
    raiz.innerHTML = resumo + `<div class="ss-colunas"><div>${servidor}</div><div>${agentes}${consumo}</div></div>`;
  }

  // as conferências: o que pede atenção aparece sempre; as que estão ok ficam atrás do "ver todas", para a tela não virar uma lista comprida
  function conferencias(d, ruins) {
    const li = c => `<div class="ss-li"><span class="ss-pt ${c.estado}"></span><span>${esc(frase(c.texto))}</span></div>`;
    if (!d.conferencias.length) return `<div class="ss-grupo"><div class="ss-li"><span class="ss-pt aviso"></span><span>${esc(d.erro_status || 'Sem conferências')}</span></div></div>`;
    const lista = verTudo ? d.conferencias : ruins;
    return (lista.length ? `<div class="ss-grupo">${lista.map(li).join('')}</div>` : '') +
      `<button type="button" class="ss-mais" id="ssVerTudo">${verTudo ? 'Esconder as conferências ok' : `Ver as ${d.conferencias.length} conferências`}</button>`;
  }

  async function carrega(forca) {
    if (carregando) return;
    carregando = true;
    const bt = document.getElementById('ssAtualiza');
    if (bt) bt.classList.add('girando');
    try {
      const [r, ag] = await Promise.all([
        fetch('/api/v1/saude-servidor' + (forca ? '?forca=1' : ''), { credentials: 'same-origin', cache: 'no-store' }),
        fetch('/api/v1/agents', { credentials: 'same-origin', cache: 'no-store' }).then(x => x.json()).catch(() => null),
      ]);
      if (r.status === 401) { location.href = '/login?next=/saude'; return; }
      const d = await r.json().catch(() => null);
      if (!r.ok || !d || d.ok === false) throw new Error((d && d.erro) || 'o servidor respondeu ' + r.status);
      agentesInfo = {}; ((ag && ag.agentes) || []).forEach(a => { agentesInfo[a.id] = a; });
      dados = d; pinta();
    } catch (e) {
      raiz.innerHTML = `<p class="ss-erro">Não consegui conferir o servidor: ${esc(e.message)}. Tento de novo em instantes.</p>`;
    } finally { carregando = false; }
  }

  raiz.addEventListener('click', ev => {
    if (ev.target.closest('#ssAtualiza')) { carrega(true); return; }
    if (ev.target.closest('#ssVerTudo')) { verTudo = !verTudo; pinta(); return; }
    const p = ev.target.closest('[data-periodo]');
    if (p && dados) { periodo = p.dataset.periodo; pinta(); }
  });
  window.DGSaudeTutorial = () => window.DGTour && window.DGTour.inicia({ passos: [
    { alvo: '.ss-resumo', titulo: 'Saúde do servidor', oque: 'Um resumo de tudo o que o S2 Bot confere no servidor: serviços, site, firewall e cada agente.', como: 'Atualiza sozinho a cada minuto. O ícone ao lado confere na hora.', porque: 'Para você saber num olhar se está tudo de pé.' },
    { alvo: '.ss-grade', titulo: 'A máquina', oque: 'Disco, memória e processador do servidor.', como: 'A barra fica amarela acima de 75% e vermelha acima de 90%.', porque: 'Disco cheio ou memória no limite são as causas mais comuns de agente travar.' },
    { alvo: '.ss-tok', titulo: 'Consumo de tokens', oque: 'Quanto cada agente usou do Claude nas últimas 24 h ou 7 dias.', como: 'Entrada é o que o agente leu (quase tudo do cache); saída é o que ele escreveu.', porque: 'Ajuda a ver qual agente puxa mais o limite da assinatura.' },
  ] });
  carrega();
  setInterval(() => { if (!document.hidden) carrega(); }, 60000);
})();
