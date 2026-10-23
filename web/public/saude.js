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
    relogio: ico('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    sino: ico('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
    folha: ico('<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z"/><path d="M5 19l7-7"/>'),
    cerebro: ico('<path d="M9 4.5a3 3 0 0 0-3 3 3 3 0 0 0-1.5 5.3A3 3 0 0 0 8 18a2.5 2.5 0 0 0 4 1.5V5.5A2.5 2.5 0 0 0 9 4.5zM15 4.5a3 3 0 0 1 3 3 3 3 0 0 1 1.5 5.3A3 3 0 0 1 16 18a2.5 2.5 0 0 1-4 1.5"/>'),
    lampada: ico('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>'),
    lupa: ico('<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>'),
    paralela: ico('<rect x="3.5" y="5" width="7" height="14" rx="2"/><rect x="13.5" y="5" width="7" height="14" rx="2"/>'),
  };
  let mem = null, memAg = '', memPergunta = '', memRes = null, memBusca = false;
  let dados = null, periodo = 'dia', agentesInfo = {}, carregando = false, verTudo = false, lim = null, janela = 'semana';
  const CORES = ['var(--dg-serie-0)', 'var(--dg-serie-1)', 'var(--dg-serie-2)', 'var(--dg-serie-3)', 'var(--dg-serie-4)', 'var(--dg-serie-5)'];
  // cor fixa por agente (a mesma nas duas janelas): Admin primeiro, depois os outros em ordem de nome
  const corDe = slug => {
    const q = lim && lim.quem ? [...(lim.quem.semana || []), ...(lim.quem.sessao || [])].map(p => p.slug) : [];
    const ids = ['admin', ...new Set([...Object.keys(agentesInfo), ...q].filter(k => k !== 'admin').sort())];
    return CORES[Math.max(0, ids.indexOf(slug)) % CORES.length];
  };
  const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const hm = iso => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const renova = iso => { if (!iso) return ''; const d = new Date(iso); return d - Date.now() < 20 * 3600e3 ? `renova às ${hm(iso)}` : `renova ${DIAS[d.getDay()]}, ${hm(iso)}`; };
  const dinheiro = (v, moeda) => (moeda === 'USD' ? 'US$ ' : moeda + ' ') + (v / 100).toLocaleString('pt-BR', { minimumFractionDigits: v % 100 ? 2 : 0, maximumFractionDigits: 2 });

  // limite da conta (lib/limites.js): sessão, semana, créditos extras e quem usou
  function limites() {
    if (!lim) return '';
    if (!lim.semana) return `<div class="ss-sec">${I.relogio}Limite da conta</div><p class="ss-fraco">${esc(lim.erro || 'Ainda não consegui ler o uso da conta.')}</p>`;
    const barra = (rot, j, aviso) => `<div class="ss-lim"><b>${rot}</b><div class="ss-barra2${j.pct >= aviso ? ' medio' : ''}${j.pct >= 95 ? ' alto' : ''}"><i style="width:${Math.min(100, j.pct)}%"></i>` +
      `<span class="ss-marca" style="left:${aviso}%" title="aviso em ${aviso}%"></span></div><span class="ss-p">${j.pct}%</span><small>${renova(j.renova)}</small></div>`;
    const x = lim.extras;
    const extras = x && x.ligado ? `<div class="ss-lim"><b>Créditos extras</b><div class="ss-barra2"><i style="width:${x.limite ? Math.min(100, Math.round(x.usado / x.limite * 100)) : 0}%"></i></div>` +
      `<span class="ss-p">${dinheiro(x.usado, x.moeda)}</span><small>de ${dinheiro(x.limite, x.moeda)} no mês</small></div>` : '';
    const q = (lim.quem && lim.quem[janela]) || [];
    const nomeDe = p => (agentesInfo[p.slug] || {}).nome || p.nome;
    return `<div class="ss-sec">${I.relogio}Limite da conta</div><div class="ss-grupo ss-pad">` +
      `<div class="ss-conta">${lim.plano ? 'Plano ' + esc(lim.plano.charAt(0).toUpperCase() + lim.plano.slice(1)) + ' · ' : ''}todos os agentes usam esta mesma conta</div>` +
      barra('Sessão atual', lim.sessao, lim.avisos.sessao) + barra('Esta semana', lim.semana, lim.config.economia.ligado ? lim.config.economia.nivel : lim.avisos.semana) + extras +
      `<div class="ss-div"></div><div class="ss-sec ss-sec0">Quem usou<span class="q ss-chips"><button type="button" class="ss-chip${janela === 'sessao' ? ' on' : ''}" data-janela="sessao">5 h</button>` +
      `<button type="button" class="ss-chip${janela === 'semana' ? ' on' : ''}" data-janela="semana">7 dias</button></span></div>` +
      (q.length ? `<div class="ss-pilha">${q.map(p => `<i style="flex:${p.pct};background:${corDe(p.slug)}" title="${esc(nomeDe(p))} ${p.pct}%"></i>`).join('')}</div>` +
        `<div class="ss-leg">${q.map(p => `<span><i style="background:${corDe(p.slug)}"></i>${esc(nomeDe(p))} <em>${p.pct}%</em></span>`).join('')}</div>`
        : '<p class="ss-fraco" style="margin:0">Ninguém usou nessa janela.</p>') +
      '<p class="ss-fraco" style="margin:0">A barra é a da Anthropic. A divisão por agente é uma estimativa pelos tokens de cada um.</p></div>';
  }
  function plano() {
    if (!lim || !lim.config) return '';
    const c = lim.config, e = lim.economia || {};
    const sw = (id, on, rot) => `<button type="button" class="ss-sw${on ? ' on' : ''}" role="switch" aria-checked="${on}" data-sw="${id}" aria-label="${rot}" title="${rot}"></button>`;
    return `<div class="ss-sec">${I.folha}Planejar o uso</div><div class="ss-grupo ss-pad">` +
      `<div class="ss-op"><span class="ss-ic">${I.sino}</span><span class="ss-optx"><b>Avisar no celular</b><small>quando a sessão passar de ${lim.avisos.sessao}% ou a semana passar de ${lim.avisos.semana}%</small></span>${sw('avisar', c.avisar, 'Avisar no celular')}</div>` +
      '<div class="ss-div"></div>' +
      `<div class="ss-op"><span class="ss-ic">${I.folha}</span><span class="ss-optx"><b>Modo economia automático</b><small>os agentes passam para o Sonnet e o Admin pergunta antes de trabalho grande, até a semana renovar</small>` +
      `<span class="ss-niveis">${(lim.niveis || []).map((n, i) => `<button type="button" class="ss-chip${c.economia.nivel === n ? ' on' : ''}" data-nivel="${n}">${i === 0 ? 'liga em ' : ''}${n}%</button>`).join('')}</span>` +
      (e.ativa ? `<span class="ss-eco on">ligado desde ${hm(e.desde)} · semana em ${lim.semana ? lim.semana.pct : '?'}%</span>` : c.economia.ligado && lim.semana ? `<span class="ss-eco">desligado · semana em ${lim.semana.pct}%</span>` : '') +
      `</span>${sw('economia', c.economia.ligado, 'Modo economia automático')}</div>` +
      (c.paralela ? '<div class="ss-div"></div>' +
        `<div class="ss-op"><span class="ss-ic">${I.paralela}</span><span class="ss-optx"><b>Sessão paralela automática</b><small>trabalho que passar deste tempo vai para uma sessão paralela, e o chat com o agente fica livre</small>` +
        `<span class="ss-niveis">${(lim.minutos_paralela || []).map((n, i) => `<button type="button" class="ss-chip${c.paralela.ligado && c.paralela.minutos === n ? ' on' : ''}" data-minutos="${n}">${i === 0 ? 'depois de ' : ''}${n} min</button>`).join('')}</span>` +
        `${c.paralela.ligado ? '' : '<span class="ss-eco">desligada · só quando você pedir</span>'}</span>${sw('paralela', c.paralela.ligado, 'Sessão paralela automática')}</div>` : '') +
      '</div>';
  }
  // memória semântica (lib/memoria-semantica.js): índice de cada agente, uso em 48 h, lembrete e teste
  function quandoFoi(iso) {
    if (!iso) return 'nunca atualizada';
    const d = new Date(iso);   // sem fuso = hora local do servidor (São Paulo), a mesma do dono
    const hoje = new Date().toDateString() === d.toDateString();
    return `atualizada ${hoje ? 'hoje' : DIAS[d.getDay()] + ' ' + String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0')}, ${hm(d.toISOString())}`;
  }
  function barras(b) {
    return `<div class="ss-uso" aria-hidden="true">${b.map((x, i) => {
      const h = Math.round(48 - (b.length - i) * 1.5);
      const tit = x.perguntas ? `${x.achou} de ${x.perguntas} ${x.perguntas === 1 ? 'mensagem' : 'mensagens'} com lembrete` : 'sem mensagem';
      return `<i class="${x.achou ? 'ok' : x.perguntas ? 'nada' : ''}" title="há ${48 - h} h: ${tit}"></i>`;
    }).join('')}</div>`;
  }
  function memoria() {
    if (!mem) return '';
    const nomeDe = a => (agentesInfo[a.slug] || {}).nome || a.nome;
    if (!memAg && mem.agentes.length) memAg = mem.agentes[0].slug;
    const ligadas = mem.agentes.filter(a => a.ligada).length;
    const linhas = mem.agentes.map(a => {
      const i = a.indice || {};
      const sub = a.ligada ? `${i.trechos} trechos de ${i.arquivos} arquivos · ${quandoFoi(i.atualizada_em)}` : 'desligada: o modelo não está na caixa dele';
      const uso = a.total.perguntas ? `nas últimas 48 h: ${a.total.achou} de ${a.total.perguntas} mensagens com lembrete` : 'nas últimas 48 h: nenhuma mensagem com o lembrete ligado';
      return `<div class="ss-mem"><div class="ss-mem-l1">${foto(a.slug)}<span class="ss-agtx"><b>${esc(nomeDe(a))}</b><small>${sub}</small></span>` +
        `<span class="ss-est${a.ligada ? '' : ' fora'}">${a.ligada ? 'ligada' : 'desligada'}</span>` +
        `<button type="button" class="ss-bt ss-bt-p" data-mem-atualiza="${esc(a.slug)}" title="Atualizar a memória agora" aria-label="Atualizar a memória de ${esc(nomeDe(a))} agora">${I.atualiza}</button></div>` +
        (mem.lembrete ? barras(a.barras) + `<small class="ss-mem-uso">${uso}</small>` : '') + '</div>';
    }).join('');
    const res = memBusca ? '<p class="ss-fraco" style="margin:0">Procurando… a primeira busca do dia leva uns 10 segundos.</p>'
      : memRes && memRes.erro ? `<p class="ss-fraco" style="margin:0">${esc(memRes.erro)}</p>`
      : memRes ? (memRes.trechos.length ? `<div class="ss-res">${memRes.trechos.map(t => `<div class="ss-r"><small>${esc(t.fonte || t.tipo || '')}${t.data ? ' · ' + esc(String(t.data).slice(0, 10).split('-').reverse().join('/')) : ''}${t.score ? ' · ' + Math.round(t.score * 100) + '% parecido' : ''}</small>${esc(t.texto)}</div>`).join('')}</div>`
        : '<p class="ss-fraco" style="margin:0">Nada parecido na memória. Pode ser que isso nunca tenha sido anotado.</p>') : '';
    return `<div class="ss-sec">${I.cerebro}Memória semântica<span class="q">${ligadas} de ${mem.agentes.length} ligadas</span></div><div class="ss-grupo ss-pad ss-grupo-mem">` +
      '<div class="ss-conta">Modelo local do Google, roda no servidor: sem conta, sem custo, nada sai da máquina</div>' + linhas +
      '<div class="ss-div"></div>' +
      `<div class="ss-op"><span class="ss-ic">${I.lampada}</span><span class="ss-optx"><b>Lembrete automático na conversa</b><small>antes de responder, o agente procura na memória e nas conversas antigas o que combina com a sua mensagem</small></span>` +
      `<button type="button" class="ss-sw${mem.lembrete ? ' on' : ''}" role="switch" aria-checked="${mem.lembrete}" data-sw="lembrete" aria-label="Lembrete automático" title="Lembrete automático"></button></div>` +
      (mem.lembrete ? '<div class="ss-leg ss-leg-mem"><span><i class="ok"></i>achou e lembrou</span><span><i class="nada"></i>procurou, nada a lembrar</span><span><i></i>sem mensagem</span></div>' : '') +
      '<div class="ss-div"></div><div class="ss-sec ss-sec0">Perguntar à memória</div>' +
      `<form class="ss-busca" id="ssBusca"><select id="ssMemAg" aria-label="De qual agente">${mem.agentes.map(a => `<option value="${esc(a.slug)}"${a.slug === memAg ? ' selected' : ''}>${esc(nomeDe(a))}</option>`).join('')}</select>` +
      `<input id="ssMemQ" type="text" placeholder="Escreva como você perguntaria" value="${esc(memPergunta)}" autocomplete="off">` +
      `<button type="submit" class="ss-go" title="Procurar" aria-label="Procurar">${I.lupa}</button></form>${res}</div>`;
  }
  async function perguntaMemoria() {
    const q = (document.getElementById('ssMemQ') || {}).value || '';
    memAg = (document.getElementById('ssMemAg') || {}).value || memAg;
    memPergunta = q.trim();
    if (!memPergunta) return;
    memBusca = true; memRes = null; pinta();
    try {
      const r = await fetch('/api/v1/memoria/' + encodeURIComponent(memAg) + '/perguntar', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: memPergunta }) });
      const d = await r.json().catch(() => null);
      memRes = d && d.ok ? { trechos: d.trechos || [] } : { erro: (d && (d.erro)) || 'A busca não respondeu.' };
    } catch (e) { memRes = { erro: 'A busca não respondeu: ' + e.message }; }
    memBusca = false; pinta();
  }

  async function salva(corpo) {
    try {
      const r = await fetch('/api/v1/limites/config', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d || !d.ok) throw new Error((d && d.erro) || 'o servidor respondeu ' + r.status);
      lim.config = d.config; pinta();
      setTimeout(() => carrega(false), 4000);   // o servidor liga ou desliga o modo economia em seguida
    } catch (e) { alert('Não consegui guardar: ' + e.message); }
  }

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
      // duas barras por agente (20/10/2026, pedido do dono): entrada (o que leu) e saída (o que escreveu),
      // cada uma do tamanho perto do maior daquele tipo
      `<div class="ss-grupo ss-pad ss-tok">${(() => {
        const maxE = Math.max(1, ...linhas.map(a => a[periodo].entrada)), maxS = Math.max(1, ...linhas.map(a => a[periodo].saida));
        const pct = (v, m) => Math.max(v ? 2 : 0, Math.round(v / m * 100));
        return linhas.map(a => `<div class="ss-tk"><div class="ss-tk-l1">${foto(a.slug)}<b>${esc((agentesInfo[a.slug] || {}).nome || a.nome)}</b></div>` +
          `<div class="ss-tk-lin"><span>entrada</span><div class="ss-tk-barra"><i style="width:${pct(a[periodo].entrada, maxE)}%;background:${corDe(a.slug)}"></i></div><b>${num(a[periodo].entrada)}</b></div>` +
          `<div class="ss-tk-lin"><span>saída</span><div class="ss-tk-barra"><i class="s" style="width:${pct(a[periodo].saida, maxS)}%;background:${corDe(a.slug)}"></i></div><b>${num(a[periodo].saida)}</b></div></div>`).join('');
      })()}</div>` +
      (totE ? `<p class="ss-fraco">${Math.round((totC / totE) * 100)}% da entrada veio do cache, que custa bem menos. Na assinatura, o que conta é o limite de uso da conta, e não o valor.</p>` : '');
    raiz.innerHTML = resumo + `<div class="ss-colunas"><div>${servidor}${agentes}${memoria()}</div><div>${limites()}${consumo}${plano()}</div></div>`;
    // a lista de agentes da busca na memória é a mesma pílula com foto e cargo do Board
    const sel = document.getElementById('ssMemAg');
    if (sel) {
      sel.addEventListener('change', () => { memAg = sel.value; });
      if (window.DGSeletorAgente) DGSeletorAgente.liga(sel, mem.agentes.map(a => Object.assign({ id: a.slug, nome: a.nome }, agentesInfo[a.slug] || {})), { titulo: 'De qual agente' });
    }
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
      const [r, ag, l, mm] = await Promise.all([
        fetch('/api/v1/saude-servidor' + (forca ? '?forca=1' : ''), { credentials: 'same-origin', cache: 'no-store' }),
        fetch('/api/v1/agents', { credentials: 'same-origin', cache: 'no-store' }).then(x => x.json()).catch(() => null),
        fetch('/api/v1/limites' + (forca ? '?forca=1' : ''), { credentials: 'same-origin', cache: 'no-store' }).then(x => x.json()).catch(() => null),
        fetch('/api/v1/memoria', { credentials: 'same-origin', cache: 'no-store' }).then(x => x.json()).catch(() => null),
      ]);
      mem = mm && mm.ok ? mm : null;
      // a página se repinta a cada minuto: não apaga o que a pessoa está digitando na busca
      const q = document.getElementById('ssMemQ'); if (q) memPergunta = q.value;
      lim = l && l.config ? l : null;
      if (r.status === 401) { location.href = '/login?next=/saude'; return; }
      const d = await r.json().catch(() => null);
      if (!r.ok || !d || d.ok === false) throw new Error((d && d.erro) || 'o servidor respondeu ' + r.status);
      agentesInfo = {}; ((ag && ag.agentes) || []).forEach(a => { agentesInfo[a.id] = a; });
      dados = d; pinta();
    } catch (e) {
      raiz.innerHTML = `<p class="ss-erro">Não consegui conferir o servidor: ${esc(e.message)}. Tento de novo em instantes.</p>`;
    } finally { carregando = false; }
  }

  raiz.addEventListener('submit', ev => { if (ev.target.id === 'ssBusca') { ev.preventDefault(); perguntaMemoria(); } });
  raiz.addEventListener('click', ev => {
    if (ev.target.closest('#ssAtualiza')) { carrega(true); return; }
    if (ev.target.closest('#ssVerTudo')) { verTudo = !verTudo; pinta(); return; }
    const j = ev.target.closest('[data-janela]');
    if (j && lim) { janela = j.dataset.janela; pinta(); return; }
    const ma = ev.target.closest('[data-mem-atualiza]');
    if (ma) {
      ma.classList.add('girando');
      fetch('/api/v1/memoria/' + encodeURIComponent(ma.dataset.memAtualiza) + '/atualizar', { method: 'POST', credentials: 'same-origin' })
        .then(() => setTimeout(() => carrega(false), 20000)).catch(() => {});
      return;
    }
    const lw = ev.target.closest('[data-sw="lembrete"]');
    if (lw && mem) {
      const on = !lw.classList.contains('on');
      fetch('/api/v1/memoria/config', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lembrete: on }) })
        .then(r => r.json()).then(d => { if (d && d.ok) { mem.lembrete = d.lembrete; pinta(); } }).catch(() => {});
      return;
    }
    const w = ev.target.closest('[data-sw]');
    if (w && lim) { const on = !w.classList.contains('on'); salva(w.dataset.sw === 'avisar' ? { avisar: on } : w.dataset.sw === 'paralela' ? { paralela: { ligado: on } } : { economia: { ligado: on } }); return; }
    const mn = ev.target.closest('[data-minutos]');
    if (mn && lim) { salva({ paralela: { minutos: +mn.dataset.minutos } }); return; }
    const nv = ev.target.closest('[data-nivel]');
    if (nv && lim) { salva({ economia: { nivel: +nv.dataset.nivel, ligado: true } }); return; }
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
