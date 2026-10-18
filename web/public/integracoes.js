'use strict';
/* integracoes.js: a tela de Integrações (/integracoes), 18/10/2026.

   Lê GET /api/v1/integracoes (conectores, plugins, skills, chaves e canais de cada agente, e as
   chaves da plataforma) e mostra uma aba por agente, com resumo, busca e catálogo. As ações vão
   para /api/v1/integracoes/<slug>/... (conector, plugin, reiniciar) e, nas chaves, para o mesmo
   POST/DELETE /p/<slug>/api/cofre que o painel usa: o valor sai do campo direto para o cofre,
   nunca volta para a tela. Conector que precisa de login vira um pedido ao Admin, no chat dele. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Conectores remotos conhecidos: um toque adiciona com o endereço certo. Quase todos pedem
  // login (OAuth) depois; o botão "Pedir ao Admin" cuida disso.
  const CATALOGO = [
    { nome: 'hostinger', titulo: 'Hostinger', endereco: 'https://mcp.hostinger.com', sobre: 'domínios, DNS, VPS e sites' },
    { nome: 'github', titulo: 'GitHub', endereco: 'https://api.githubcopilot.com/mcp/', sobre: 'repositórios, issues e PRs' },
    { nome: 'notion', titulo: 'Notion', endereco: 'https://mcp.notion.com/mcp', sobre: 'páginas e bancos de dados' },
    { nome: 'linear', titulo: 'Linear', endereco: 'https://mcp.linear.app/mcp', sobre: 'tarefas e projetos' },
    { nome: 'atlassian', titulo: 'Jira e Confluence', endereco: 'https://mcp.atlassian.com/v1/mcp', sobre: 'Atlassian' },
    { nome: 'slack', titulo: 'Slack', endereco: 'https://mcp.slack.com/mcp', sobre: 'canais e mensagens' },
    { nome: 'stripe', titulo: 'Stripe', endereco: 'https://mcp.stripe.com', sobre: 'pagamentos e clientes' },
    { nome: 'sentry', titulo: 'Sentry', endereco: 'https://mcp.sentry.dev/mcp', sobre: 'erros dos sistemas' },
    { nome: 'vercel', titulo: 'Vercel', endereco: 'https://mcp.vercel.com', sobre: 'sites e deploys' },
    { nome: 'supabase', titulo: 'Supabase', endereco: 'https://mcp.supabase.com/mcp', sobre: 'banco de dados' },
  ];
  const ESTADO = { conectado: 'Conectado', precisa_entrar: 'Precisa entrar', falha: 'Com falha', nao_configurado: 'Não configurado', pendente: 'Aguardando aprovação', desconhecido: 'Desconhecido' };
  // conector sem endereço (roda como programa dentro da caixa, ou ainda sem configuração)
  const DETALHE = { falha: 'não conseguiu iniciar (o canal ainda não foi configurado?)', nao_configurado: 'ainda sem endereço configurado', precisa_entrar: 'precisa entrar na conta' };
  const ORIGEM = { conta: 'da sua conta do Claude', plugin: 'de um plugin', manual: 'adicionado à mão' };

  let dados = null, aba = null, precisaReiniciar = new Set();

  async function api(url, opcoes) {
    const r = await fetch(url, { credentials: 'same-origin', ...(opcoes || {}), headers: { 'Content-Type': 'application/json', ...((opcoes && opcoes.headers) || {}) } });
    if (r.status === 401) { location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search); throw new Error('sessão expirada'); }
    let d = null; try { d = await r.json(); } catch (_) { /* sem corpo */ }
    if (!r.ok || (d && d.ok === false)) throw new Error((d && (d.erro || d.motivo || d.error)) || ('o servidor respondeu ' + r.status));
    return d || {};
  }
  function msg(texto, erro, acaoHtml) {
    const el = $('igMsg');
    el.hidden = !texto;
    el.className = 'ig-msg' + (erro ? ' erro' : '');
    el.innerHTML = esc(texto) + (acaoHtml || '');
  }

  async function carrega(recarregar) {
    $('igRecarregar').disabled = true;
    try {
      dados = await api('/api/v1/integracoes' + (recarregar ? '?recarregar=1' : ''));
      if (!aba) aba = new URLSearchParams(location.search).get('a') || (dados.agentes.find((a) => a.tipo !== 'admin') || {}).slug || 'plataforma';
      pinta();
    } catch (e) {
      $('igConteudo').innerHTML = `<p class="ig-msg erro">Não consegui carregar as integrações: ${esc(e.message)}.</p>`;
    } finally { $('igRecarregar').disabled = false; }
  }

  function problemas(a) { return a.conectores.filter((c) => c.estado === 'falha' || c.estado === 'precisa_entrar').length; }

  function pintaResumo() {
    const ag = dados.agentes;
    const con = ag.reduce((n, a) => n + a.conectores.length, 0);
    const ok = ag.reduce((n, a) => n + a.conectores.filter((c) => c.estado === 'conectado').length, 0);
    const prob = ag.reduce((n, a) => n + problemas(a), 0);
    const chaves = ag.reduce((n, a) => n + a.chaves.length, 0) + dados.plataforma.chaves.filter((c) => c.ligada).length;
    $('igResumo').innerHTML =
      `<div class="ig-num"><b>${con}</b><span>conectores em ${ag.length} agentes</span></div>` +
      `<div class="ig-num"><b>${ok}</b><span>conectados e funcionando</span></div>` +
      `<div class="ig-num ${prob ? 'alerta' : ''}"><b>${prob}</b><span>precisam de atenção</span></div>` +
      `<div class="ig-num"><b>${chaves}</b><span>chaves guardadas</span></div>`;
  }

  function pintaAbas() {
    const av = (a) => {
      const img = /^(https:\/\/|\/)/.test(a.avatar || '') ? a.avatar : '';
      return `<span class="ig-av" style="background:${esc(a.cor || '#64748b')}">${img ? `<img src="${esc(img)}" alt="">` : esc((a.avatar || a.nome || '?').slice(0, 2))}</span>`;
    };
    const abas = [{ slug: 'plataforma', html: '⚙ Plataforma' }].concat(dados.agentes.map((a) => ({
      slug: a.slug, html: av(a) + esc(a.nome) + (problemas(a) ? `<span class="ig-pino" title="precisam de atenção">${problemas(a)}</span>` : ''),
    })));
    $('igAbas').innerHTML = abas.map((x) => `<button type="button" class="ig-aba" role="tab" data-aba="${esc(x.slug)}" aria-selected="${x.slug === aba}">${x.html}</button>`).join('');
  }

  const est = (e) => `<span class="ig-est ${esc(e)}">${esc(ESTADO[e] || e)}</span>`;
  const sec = (titulo, n, dica, corpo, acoes) => `<section class="ig-sec"><div class="ig-sec-cab"><h2>${titulo}<small>${n}</small></h2>${acoes || ''}</div>` +
    (dica ? `<p class="ig-dica">${dica}</p>` : '') + corpo + '</section>';

  function pintaPlataforma() {
    const ch = dados.plataforma.chaves;
    return sec('Chaves da plataforma', ch.filter((c) => c.ligada).length + ' de ' + ch.length,
      'Chaves que o próprio DG Claw usa (não os agentes). Para ligar ou trocar uma delas, peça ao Admin no chat: ela vai do Cofre de um agente para a plataforma sem aparecer em lugar nenhum.',
      '<ul class="ig-lista">' + ch.map((c) => `<li class="ig-item" data-busca="${esc((c.nome + ' ' + c.para).toLowerCase())}"><span class="ig-ico">🔑</span>` +
        `<div class="ig-txt"><div class="ig-nome">${esc(c.nome)}</div><div class="ig-det">${esc(c.para)}</div></div>` +
        `<div class="ig-acoes">${c.ligada ? est('configurado') : '<span class="ig-est">não configurada</span>'}</div></li>`).join('') + '</ul>');
  }

  function pintaAgente(a) {
    const so = a.somente_leitura;
    const reinicia = precisaReiniciar.has(a.slug) ? `<p class="ig-msg">Há mudanças esperando ${esc(a.nome)} reiniciar. <button type="button" class="ig-btn pri peq" data-reiniciar="${esc(a.slug)}">Reiniciar agora</button></p>` : '';
    const aviso = so ? '<p class="ig-msg">O Admin cuida da máquina, então as integrações dele só mudam por pedido no chat, com você vendo cada passo.</p>' : '';

    const conectores = a.conectores.slice().sort((x, y) => (x.estado === 'conectado' ? 0 : 1) - (y.estado === 'conectado' ? 0 : 1));
    const linhaCon = (c) => {
      const origem = c.origem === 'plugin' ? `do plugin ${c.plugin}` : ORIGEM[c.origem] || '';
      const acoes = [];
      if (!so && (c.estado === 'precisa_entrar' || c.estado === 'falha')) acoes.push(`<button type="button" class="ig-btn peq" data-pedir="${esc(c.nome)}" data-agente="${esc(a.slug)}" title="O Admin te guia no login deste conector">Pedir ao Admin para conectar</button>`);
      if (!so && c.origem === 'manual') acoes.push(`<button type="button" class="ig-btn peq perigo" data-remover="${esc(c.nome)}" data-agente="${esc(a.slug)}">Remover</button>`);
      return `<li class="ig-item" data-busca="${esc((c.nome + ' ' + c.endereco + ' ' + origem).toLowerCase())}">` +
        `<span class="ig-ico">${esc(c.nome.slice(0, 1))}</span>` +
        `<div class="ig-txt"><div class="ig-nome">${esc(c.nome)}<span class="ig-origem">${esc(origem)}</span></div>` +
        `<div class="ig-det" title="${esc(c.endereco || c.detalhe)}">${esc(c.endereco || DETALHE[c.estado] || c.detalhe)}</div></div>` +
        `<div class="ig-acoes">${est(c.estado)}${acoes.join('')}</div></li>`;
    };
    const ja = new Set(a.conectores.map((c) => c.nome.toLowerCase()));
    const catalogo = so ? '' : '<details class="ig-det-cat"><summary class="ig-btn peq" style="display:inline-flex;align-items:center;list-style:none">+ Catálogo de integrações</summary><div class="ig-catalogo">' +
      CATALOGO.map((c) => `<button type="button" class="ig-cat" data-catalogo="${esc(c.nome)}" data-agente="${esc(a.slug)}"${ja.has(c.nome) ? ' disabled title="já adicionado"' : ''}>` +
        `<span class="ig-ico">${esc(c.titulo.slice(0, 1))}</span><span><b>${esc(c.titulo)}</b><small>${ja.has(c.nome) ? 'já adicionado' : esc(c.sobre)}</small></span></button>`).join('') + '</div></details>';
    let html = reinicia + aviso;
    html += sec('Conectores (MCP)', a.conectores.length,
      'Serviços que ' + esc(a.nome) + ' consegue usar direto: e-mail, agenda, planilhas, sistemas da empresa.' + (a.erro_conectores ? ' <b>' + esc(a.erro_conectores) + '</b>' : ''),
      (conectores.length ? '<ul class="ig-lista">' + conectores.map(linhaCon).join('') + '</ul>' : '<p class="ig-vazio">Nenhum conector ainda.</p>') + catalogo,
      so ? '' : `<button type="button" class="ig-btn pri peq" data-adicionar="${esc(a.slug)}">+ Adicionar conector</button>`);

    html += sec('Plugins', a.plugins.length, 'Pacotes que trazem conectores, comandos e skills de uma vez.',
      a.plugins.length ? '<ul class="ig-lista">' + a.plugins.map((p) => `<li class="ig-item" data-busca="${esc((p.id).toLowerCase())}"><span class="ig-ico">${esc(p.nome.slice(0, 1))}</span>` +
        `<div class="ig-txt"><div class="ig-nome">${esc(p.nome)}</div><div class="ig-det">${esc(p.loja)}${p.versao ? ' · versão ' + esc(p.versao) : ''}</div></div>` +
        `<div class="ig-acoes">${so ? est(p.ligado ? 'ligado' : 'desligado') : `<button type="button" class="ig-chave" role="switch" aria-checked="${p.ligado}" aria-label="${p.ligado ? 'Desligar' : 'Ligar'} ${esc(p.nome)}" data-plugin="${esc(p.id)}" data-agente="${esc(a.slug)}"></button>`}</div></li>`).join('') + '</ul>'
        : '<p class="ig-vazio">Nenhum plugin instalado.</p>');

    html += sec('Skills', a.skills.length, 'O que ' + esc(a.nome) + ' sabe fazer com um roteiro pronto.',
      a.skills.length ? '<div class="ig-skills">' + a.skills.map((s) => `<div class="ig-skill" data-busca="${esc((s.nome + ' ' + s.descricao).toLowerCase())}"><b>${esc(s.nome)}</b><p>${esc(s.descricao || 'sem descrição')}</p></div>`).join('') + '</div>'
        : '<p class="ig-vazio">Nenhuma skill.</p>');

    if (!so) {
      html += sec('Chaves (Cofre)', a.chaves.length, 'Só os nomes aparecem aqui. O valor fica guardado no Cofre e nunca volta para a tela.',
        (a.chaves.length ? '<ul class="ig-lista">' + a.chaves.map((c) => `<li class="ig-item" data-busca="${esc(c.toLowerCase())}"><span class="ig-ico">🔑</span>` +
          `<div class="ig-txt"><div class="ig-nome">${esc(c)}</div><div class="ig-det">••••••••</div></div>` +
          `<div class="ig-acoes"><button type="button" class="ig-btn peq" data-chave="${esc(c)}" data-agente="${esc(a.slug)}">Trocar</button>` +
          `<button type="button" class="ig-btn peq perigo" data-tirachave="${esc(c)}" data-agente="${esc(a.slug)}">Remover</button></div></li>`).join('') + '</ul>' : '<p class="ig-vazio">Nenhuma chave guardada.</p>'),
        a.tem_cofre ? `<button type="button" class="ig-btn pri peq" data-chave="" data-agente="${esc(a.slug)}">+ Adicionar chave</button>` : '');
      html += sec('Canais', a.canais.length, 'Por onde você fala com ' + esc(a.nome) + ' além deste chat. Para ligar, peça a ele no chat: "quero falar com você no Telegram".',
        '<ul class="ig-lista">' + a.canais.map((c) => `<li class="ig-item" data-busca="${esc(c.nome.toLowerCase())}"><span class="ig-ico">${c.nome === 'Telegram' ? '✈' : '☏'}</span>` +
          `<div class="ig-txt"><div class="ig-nome">${esc(c.nome)}</div></div><div class="ig-acoes">${c.estado === 'desligado' ? '<span class="ig-est">desligado</span>' : est(c.estado === 'configurado' ? 'configurado' : c.estado)}</div></li>`).join('') + '</ul>');
    }
    return html;
  }

  function pinta() {
    pintaResumo(); pintaAbas();
    const a = dados.agentes.find((x) => x.slug === aba);
    $('igConteudo').innerHTML = aba === 'plataforma' || !a ? pintaPlataforma() : pintaAgente(a);
    filtra();
  }

  function filtra() {
    const q = $('igBusca').value.trim().toLowerCase();
    for (const el of document.querySelectorAll('#igConteudo [data-busca]')) el.classList.toggle('ig-esconde', !!q && !el.dataset.busca.includes(q));
  }

  /* ── janelas ── */
  function abre(titulo, corpo, aoEnviar) {
    $('igModalTit').textContent = titulo;
    $('igModalCorpo').innerHTML = corpo;
    $('igModal').hidden = false;
    const f = $('igModalCorpo').querySelector('form');
    const primeiro = $('igModalCorpo').querySelector('input');
    if (primeiro) primeiro.focus();
    if (f) f.onsubmit = async (ev) => {
      ev.preventDefault();
      const btn = f.querySelector('[type=submit]'); btn.disabled = true;
      const errEl = f.querySelector('.ig-erro');
      try { await aoEnviar(f); fecha(); } catch (e) { errEl.textContent = e.message; errEl.hidden = false; btn.disabled = false; }
    };
  }
  function fecha() { $('igModal').hidden = true; $('igModalCorpo').innerHTML = ''; }

  function formConector(slug, nome, endereco) {
    abre('Adicionar conector', '<form>' +
      `<label class="ig-campo">Nome<input name="nome" required maxlength="40" pattern="[a-z0-9][a-z0-9_-]*" value="${esc(nome || '')}" placeholder="ex.: hostinger"><small>letras minúsculas, números e hífen</small></label>` +
      `<label class="ig-campo">Endereço (https)<input name="endereco" type="url" required value="${esc(endereco || '')}" placeholder="https://mcp.exemplo.com/mcp"><small>o endereço do servidor MCP remoto</small></label>` +
      '<p class="ig-erro" hidden></p><div class="ig-rodape"><button type="button" class="ig-btn" data-fecha>Cancelar</button><button type="submit" class="ig-btn pri">Adicionar</button></div></form>',
    async (f) => {
      const r = await api(`/api/v1/integracoes/${encodeURIComponent(slug)}/conectores`, { method: 'POST', body: JSON.stringify({ nome: f.nome.value.trim(), endereco: f.endereco.value.trim() }) });
      precisaReiniciar.add(slug);
      await carrega(true);
      msg(r.mensagem + ' Quase todo conector novo pede login: use "Pedir ao Admin para conectar".');
    });
  }

  function formChave(slug, nome) {
    abre(nome ? `Trocar ${nome}` : 'Adicionar chave', '<form autocomplete="off">' +
      `<label class="ig-campo">Nome<input name="nome" required maxlength="64" pattern="[A-Z][A-Z0-9_]*" value="${esc(nome || '')}" ${nome ? 'readonly' : ''} placeholder="ex.: OPENAI_API_KEY"><small>letras maiúsculas, números e sublinhado</small></label>` +
      '<label class="ig-campo">Valor<input name="valor" type="password" required autocomplete="new-password" placeholder="cole a chave aqui"><small>vai direto para o Cofre e não aparece mais</small></label>' +
      '<p class="ig-erro" hidden></p><div class="ig-rodape"><button type="button" class="ig-btn" data-fecha>Cancelar</button><button type="submit" class="ig-btn pri">Guardar no Cofre</button></div></form>',
    async (f) => {
      const envName = f.nome.value.trim().toUpperCase();
      await api(`/p/${encodeURIComponent(slug)}/api/cofre`, { method: 'POST', body: JSON.stringify({ envName, valor: f.valor.value, aplicar: true }) });
      f.valor.value = '';
      await carrega(true);
      msg(`${envName} guardada no Cofre. O agente reinicia sozinho para usar a chave.`);
    });
  }

  /* ── cliques ── */
  document.addEventListener('click', async (ev) => {
    const t = ev.target.closest ? ev.target : null; if (!t) return;
    if (t.closest('[data-fecha]') || t === $('igModal')) { fecha(); return; }
    const b = t.closest('button'); if (!b) return;
    try {
      if (b.dataset.aba) { aba = b.dataset.aba; msg(''); pinta(); return; }
      if (b.id === 'igRecarregar') { msg(''); await carrega(true); return; }
      if (b.dataset.adicionar) { formConector(b.dataset.adicionar); return; }
      if (b.dataset.catalogo) { const c = CATALOGO.find((x) => x.nome === b.dataset.catalogo); formConector(b.dataset.agente, c.nome, c.endereco); return; }
      if (b.dataset.remover) {
        if (!confirm(`Remover o conector ${b.dataset.remover}?`)) return;
        b.disabled = true;
        const r = await api(`/api/v1/integracoes/${encodeURIComponent(b.dataset.agente)}/conectores/${encodeURIComponent(b.dataset.remover)}`, { method: 'DELETE' });
        precisaReiniciar.add(b.dataset.agente); await carrega(true); msg(r.mensagem); return;
      }
      if (b.dataset.plugin) {
        const ligado = b.getAttribute('aria-checked') !== 'true';
        b.disabled = true;
        const r = await api(`/api/v1/integracoes/${encodeURIComponent(b.dataset.agente)}/plugins`, { method: 'POST', body: JSON.stringify({ id: b.dataset.plugin, ligado }) });
        precisaReiniciar.add(b.dataset.agente); await carrega(true); msg(r.mensagem); return;
      }
      if (b.dataset.reiniciar) {
        b.disabled = true; b.textContent = 'Reiniciando…';
        const r = await api(`/api/v1/integracoes/${encodeURIComponent(b.dataset.reiniciar)}/reiniciar`, { method: 'POST' });
        precisaReiniciar.delete(b.dataset.reiniciar); await carrega(true); msg(r.mensagem); return;
      }
      if (b.dataset.chave !== undefined && b.dataset.agente) { formChave(b.dataset.agente, b.dataset.chave); return; }
      if (b.dataset.tirachave) {
        if (!confirm(`Remover a chave ${b.dataset.tirachave} do Cofre? O agente deixa de usá-la depois de reiniciar.`)) return;
        b.disabled = true;
        await api(`/p/${encodeURIComponent(b.dataset.agente)}/api/cofre?envName=${encodeURIComponent(b.dataset.tirachave)}`, { method: 'DELETE' });
        precisaReiniciar.add(b.dataset.agente); await carrega(true); msg(`${b.dataset.tirachave} removida do Cofre.`); return;
      }
      if (b.dataset.pedir) {
        const ag = dados.agentes.find((x) => x.slug === b.dataset.agente);
        b.disabled = true;
        await api('/api/v1/agents/admin/send', { method: 'POST', body: JSON.stringify({ text: `[da tela Integrações] Me ajude a conectar o conector "${b.dataset.pedir}" do agente ${ag ? ag.nome : b.dataset.agente} (ele precisa de login).` }) });
        msg('Pedido enviado ao Admin.', false, ' <a class="ig-btn pri peq" href="/a/admin">Abrir o chat do Admin</a>');
      }
    } catch (e) { msg('Não deu certo: ' + e.message, true); b.disabled = false; }
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('igModal').hidden) fecha(); });
  $('igBusca').addEventListener('input', filtra);

  carrega(false);
})();
