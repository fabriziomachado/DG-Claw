'use strict';
/* lembretes-aba.js: a aba Lembretes do Board e a página /lembretes (21/10/2026, pedido do dono, proposta
   aprovada em imagem). Mesmo desenho do Avisos: a linha dos avisos neste aparelho, o campo no topo com
   "quando" e "de qual agente" em pílulas (insistência e aviso pelo agente atrás do ícone de ajustes),
   filtros em pílulas com as fotos e a lista em grupos: tocando agora (Feito e Adiar à mão), hoje, amanhã,
   mais adiante. Pausar, retomar, histórico e apagar ficam no "⋯".
   Usa as contas que já existiam em lembretes.js (window.DGLembretesTela: montaCorpo, fmt, fraseAvisos,
   ROTULO_ESTADO) e a API /api/v1/lembretes (web/docs/LEMBRETES.md).
   No Board: DGMesaAbas.registrar; na página: monta em #lembretesRaiz. */
(function (raiz, fabrica) {
  const m = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { raiz.DGLembretesAba = m; m.registra(); }
})(this, function (raiz) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ico = (d, t) => `<svg viewBox="0 0 24 24" width="${t || 16}" height="${t || 16}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICO = {
    relogio: ico('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 1.5"/>'), dn: ico('<path d="m6 9 6 6 6-6"/>', 13),
    aj: ico('<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>', 18),
    enviar: ico('<path d="M12 19V5M6 11l6-6 6 6"/>', 18), mais: ico('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
    sino: ico('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>', 15),
    semSino: ico('<path d="M6 8a6 6 0 0 1 9.3-5M18 8c0 7 3 9 3 9H8"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0M3 3l18 18"/>', 16),
    teste: ico('<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>'),
  };
  const DIAS = [['seg', 'seg'], ['ter', 'ter'], ['qua', 'qua'], ['qui', 'qui'], ['sex', 'sex'], ['sab', 'sáb'], ['dom', 'dom']];
  const DSEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const QUANDO = [['daqui', 'daqui a pouco'], ['unico', 'uma vez'], ['diario', 'todo dia'], ['semanal', 'toda semana'], ['a_cada_n_dias', 'a cada N dias']];
  const MAX_TEXTO = 500;
  const p2 = n => String(n).padStart(2, '0');
  const diaDe = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  // o dia no fuso do servidor (o "hoje" e o "amanhã" da lista seguem a hora dos lembretes, não a do aparelho)
  function diaNoFuso(d, fuso) {
    if (!fuso) return diaDe(d);
    try { return d.toLocaleDateString('en-CA', { timeZone: fuso }); } catch (_) { return diaDe(d); }
  }
  // "uma vez, em 21/10/2026 às 08:50" vira "uma vez": a hora já aparece à direita
  const regraCurta = t => /^uma vez\b/.test(String(t || '')) ? 'uma vez' : String(t || '');

  /* "2026-10-24T08:00:00-03:00" -> "08:00" (hoje e amanhã) ou "sex 24/10". O servidor manda no fuso dele. */
  function quandoCurto(iso, hoje, amanha) {
    if (typeof iso !== 'string' || iso.length < 16) return '';
    const dia = iso.slice(0, 10), hh = iso.slice(11, 16);
    if (dia === hoje || dia === amanha) return hh;
    const d = new Date(dia + 'T12:00:00');
    return `${DSEM[d.getDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  }

  /* Grupos da lista: tocando agora (as ocorrências em insistência), hoje, amanhã, mais adiante, e os parados. */
  function grupos(lembretes, insistindo, hoje, amanha) {
    const tocando = new Set((insistindo || []).map(o => o.lembrete_id));
    const g = { tocando: [], hoje: [], amanha: [], depois: [], pausado: [], encerrado: [] };
    for (const o of insistindo || []) g.tocando.push({ oc: o });
    for (const l of lembretes || []) {
      if (l.estado === 'pausado') g.pausado.push({ l });
      else if (l.estado === 'encerrado') { if (!tocando.has(l.id)) g.encerrado.push({ l }); }
      else if (tocando.has(l.id) && !l.proxima) continue;
      else {
        const dia = String(l.proxima || '').slice(0, 10);
        if (!dia || dia <= hoje) g.hoje.push({ l });
        else if (dia === amanha) g.amanha.push({ l });
        else g.depois.push({ l });
      }
    }
    const porProxima = (a, b) => String(a.l.proxima || '').localeCompare(String(b.l.proxima || ''));
    g.hoje.sort(porProxima); g.amanha.sort(porProxima); g.depois.sort(porProxima);
    return [['tocando', 'Tocando agora'], ['hoje', 'Hoje'], ['amanha', 'Amanhã'], ['depois', 'Mais adiante'], ['pausado', 'Pausados'], ['encerrado', 'Encerrados']]
      .filter(([k]) => g[k].length).map(([k, rotulo]) => ({ id: k, rotulo, itens: g[k] }));
  }

  function rotuloOcorrencia(o) {
    if (o.estado === 'adiada' && o.adiada_ate) return 'adiado até ' + String(o.adiada_ate).slice(11, 16);
    return `insistindo, ${o.envio || 1}º aviso` + (o.teto ? ` de ${o.teto}` : '');
  }

  if (!raiz.document) return { quandoCurto, grupos, rotuloOcorrencia, regraCurta, diaNoFuso, QUANDO };

  /* ── Parte com DOM ── */
  const T = () => raiz.DGLembretesTela || {};
  const E = { lista: [], insistindo: [], agendador: {}, agentes: [], fotos: {}, filtro: { estado: 'ativo', agente: '' },
    menu: null, hist: new Set(), apagar: null, agente: '', carregou: false };
  let el = null, timer = 0, setBolinha = null;
  const q = s => el.querySelector(s);

  async function chamar(metodo, caminho, corpo) {
    let r;
    try {
      r = await fetch(caminho, { method: metodo, credentials: 'same-origin', cache: 'no-store',
        headers: corpo === undefined ? {} : { 'Content-Type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    } catch (e) { return { ok: false, erro: 'Não consegui falar com o servidor (' + e.message + ').' }; }
    let json = null; try { json = await r.json(); } catch (_) { /* abaixo */ }
    if (r.status === 401) return { ok: false, erro: 'Sua sessão acabou. Entre de novo.' };
    if (!r.ok) return { ok: false, erro: (json && json.erro) || ('O servidor respondeu ' + r.status + '.') };
    return { ok: true, json: json || {} };
  }

  function tela() {
    const opQuando = QUANDO.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    const dias = DIAS.map(([v, t]) => `<label class="lb-dia"><input type="checkbox" value="${v}"><span>${t}</span></label>`).join('');
    return `<div class="av-tela bh lb">
<p class="lb-aparelho" id="lbAparelho" data-lb-tour="aparelho"></p>
<div class="lb-prefs" id="lbPrefs" role="group" aria-label="Quando avisar sobre os agentes" hidden><label class="lb-pref"><input type="checkbox" id="prefPrecisa" data-lb-pref="precisa_de_voce" disabled><span>Quando um agente precisar de mim</span></label><label class="lb-pref"><input type="checkbox" id="prefTerminou" data-lb-pref="terminou" disabled><span>Quando um agente terminar uma resposta</span></label></div>
<p id="lbStatus" class="av-status" role="status" aria-live="polite"></p>
<form id="lbForm" class="bh-novo av-novo" novalidate data-lb-tour="novo">
<textarea id="lbTexto" rows="2" maxlength="${MAX_TEXTO}" placeholder="Escreva o lembrete: ligar pro contador"></textarea>
<div class="bh-acoes">
<label class="av-pil">${ICO.relogio}<select id="lbQuando" aria-label="Quando">${opQuando}</select>${ICO.dn}</label>
<span class="av-dest"><button type="button" class="av-pil" id="lbAgBtn" aria-haspopup="true" aria-expanded="false">de <span id="lbAgFoto" class="av-fotos"></span><span id="lbAgTx"></span>${ICO.dn}</button>
<div id="lbAgMenu" class="av-para-menu" role="radiogroup" aria-label="De qual agente" hidden></div></span>
<span class="lb-fim"><button type="button" class="av-ic" id="lbAjustes" aria-expanded="false" title="Insistência e aviso pelo agente" aria-label="Insistência e aviso pelo agente">${ICO.aj}</button>
<span class="av-cont"><span id="lbCont">0/${MAX_TEXTO}</span></span>
<button type="submit" id="lbCriar" class="av-go" title="Criar o lembrete" aria-label="Criar o lembrete">${ICO.enviar}</button></span></div>
<div class="lb-quando">
<label data-so="daqui">daqui a <input id="lbDaqui" type="number" min="1" max="10080" value="30" inputmode="numeric"> min</label>
<label data-so="a_cada_n_dias">a cada <input id="lbN" type="number" min="1" max="365" value="3" inputmode="numeric"> dias, a partir de <input id="lbInicio" type="date"></label>
<label data-so="unico">em <input id="lbData" type="date"></label>
<span class="lb-dias" data-so="semanal" id="lbDias">${dias}</span>
<label data-so="unico diario semanal a_cada_n_dias">às <input id="lbHora" type="time" value="09:00"></label></div>
<div class="av-mais-campos" id="lbMais" hidden>
<div class="lb-par"><label>Insistir a cada (min)<input id="lbIntervalo" type="number" min="1" max="120" value="5" inputmode="numeric"></label>
<label>No máximo (avisos)<input id="lbTeto" type="number" min="1" max="60" value="12" inputmode="numeric"></label></div>
<label data-so="diario semanal a_cada_n_dias">Último dia (opcional)<input id="lbFim" type="date"></label>
<label class="lb-marca"><input id="lbPeloAgente" type="checkbox" checked>Também avisar pelo agente (Telegram, WhatsApp)</label></div>
<p id="lbMsg" class="bh-msg" role="status" hidden></p>
</form>
<div class="av-filtros" id="lbFiltros" data-lb-tour="filtros"></div>
<div id="lbLista" class="av-lista" aria-live="polite" data-lb-tour="lista"><p class="av-vazio">Carregando…</p></div>
<p class="lb-rodape" id="lbRodape"></p></div>`;
  }

  // ── avisos neste aparelho ──
  // a frase curta da linha; a explicação inteira (fraseAvisos) aparece ao tocar em "Como ativar"
  const CURTA = { ativo: 'Avisos ativos neste aparelho', inativo: 'Avisos desligados neste aparelho', negado: 'O navegador bloqueou os avisos',
    'iphone-precisa-instalar': 'No iPhone, os avisos pedem o app instalado', 'sem-suporte': 'Este navegador não recebe avisos' };
  async function pintaAparelho() {
    const p = q('#lbAparelho'), A = raiz.DGClawAvisos;
    if (!A) { p.hidden = true; return; }
    let estado = 'desconhecido';
    try { estado = await A.estado(); } catch (_) { /* fica desconhecido */ }
    const f = (T().fraseAvisos || (() => ({ texto: '' })))(estado);
    const ativo = estado === 'ativo';
    p.classList.toggle('on', ativo);
    const ajuda = !ativo && estado !== 'inativo';
    p.innerHTML = ICO.sino + `<span>${esc(CURTA[estado] || 'Não consegui conferir os avisos deste aparelho')}</span>` +
      (ajuda ? `<button type="button" class="bh-bt lb-leve" data-lb-como="${esc(f.texto)}">Como ativar</button>` : '') +
      (f.ativar && !ajuda ? '<button type="button" class="bh-bt" data-lb-ativar>Ativar</button>' : '') +
      (f.teste ? `<button type="button" class="av-ic" data-lb-teste title="Mandar um aviso de teste" aria-label="Mandar um aviso de teste">${ICO.teste}</button>` : '') +
      (f.desativar ? `<button type="button" class="av-ic" data-lb-desativar title="Desligar os avisos neste aparelho" aria-label="Desligar os avisos neste aparelho">${ICO.semSino}</button>` : '');
    pintaPrefs(ativo);
  }
  /* "Precisa de você" e "terminou" (vigia de atenção, 23/10/2026): valem para todos os aparelhos. Só aparecem
     com os avisos ativos aqui; os de entrega e pedido seguem nas escolhas das boas-vindas. */
  async function pintaPrefs(ativo) {
    const box = q('#lbPrefs'), A = raiz.DGClawAvisos;
    if (!box) return;
    if (!ativo || !A || !A.preferencias) { box.hidden = true; return; }
    let r;
    try { r = await A.preferencias(); } catch (e) { r = { ok: false, erro: e.message }; }
    if (!r.ok) { box.hidden = true; status('Não consegui ler as preferências de aviso: ' + r.erro, 'erro'); return; }
    for (const c of box.querySelectorAll('[data-lb-pref]')) { c.checked = r.preferencias[c.dataset.lbPref] !== false; c.disabled = false; }
    box.hidden = false;
  }
  async function salvaPref(c) {
    c.disabled = true;
    let r;
    try { r = await raiz.DGClawAvisos.salvarPreferencia(c.dataset.lbPref, c.checked); } catch (e) { r = { ok: false, erro: e.message }; }
    c.disabled = false;
    if (!r.ok) { c.checked = !c.checked; status('Não consegui guardar a preferência: ' + r.erro, 'erro'); }
  }
  async function acaoAparelho(fazer, ok) {
    try {
      const r = await fazer();
      status(r.ok ? ok(r) : r.erro, r.ok ? 'ok' : 'erro');
    } catch (e) { status('Algo falhou (' + e.message + '). Recarregue a página e tente de novo.', 'erro'); }
    pintaAparelho();
  }

  function status(msg, tipo) {
    const s = q('#lbStatus');
    s.textContent = msg || '';
    s.className = 'av-status' + (tipo ? ' av-' + tipo : '');
  }
  function msgForm(msg, tipo) {
    const s = q('#lbMsg');
    s.textContent = msg || '';
    s.hidden = !msg;
    s.classList.toggle('erro', tipo === 'erro');
  }

  // ── agentes e fotos ──
  async function carregaAgentes() {
    const r = await chamar('GET', '/api/v1/agents');
    if (!r.ok) return;
    E.agentes = r.json.agentes || [];
    for (const a of E.agentes) {
      const img = a.avatar_img || (/^https:\/\//i.test(a.avatar || '') ? a.avatar : '');
      E.fotos[a.id] = `<span class="av-foto" style="background:${esc(a.cor || '#5b6472')}">${img ? `<img src="${esc(img)}" alt="">` : esc(Array.from(a.avatar || a.nome || '?')[0])}</span>`;
    }
    if (!E.agente) {
      const trabalho = E.agentes.filter(a => a.tipo === 'agente');
      E.agente = (trabalho[0] || E.agentes[0] || {}).id || '';
    }
    pintaAgente(); pintaFiltros();
    if (E.carregou) pintaLista();
  }
  const nomeDe = id => (E.agentes.find(a => a.id === id) || {}).nome || id;
  function pintaAgente() {
    q('#lbAgFoto').innerHTML = E.fotos[E.agente] || '';
    q('#lbAgTx').textContent = nomeDe(E.agente) || 'agente';
    q('#lbAgMenu').innerHTML = E.agentes.map(a => `<label class="av-op"><input type="radio" name="lbAgente" value="${esc(a.id)}"${a.id === E.agente ? ' checked' : ''}>` +
      `${E.fotos[a.id] || ''}<span>${esc(a.nome)}</span></label>`).join('');
  }

  function pintaFiltros() {
    const f = E.filtro;
    const chip = (v, rot) => `<button type="button" class="av-chip${f.estado === v ? ' on' : ''}" data-lb-festado="${v}" aria-pressed="${f.estado === v}">${rot}</button>`;
    q('#lbFiltros').innerHTML = `<div class="av-chips">${chip('ativo', 'Ativos')}${chip('pausado', 'Pausados')}${chip('encerrado', 'Encerrados')}${chip('', 'Todos')}</div>` +
      `<div class="av-fquem">${E.agentes.filter(a => E.fotos[a.id]).map(a => `<button type="button" class="av-fav${f.agente === a.id ? ' on' : ''}" data-lb-fagente="${esc(a.id)}" aria-pressed="${f.agente === a.id}" title="Só os lembretes de ${esc(a.nome)}">${E.fotos[a.id]}</button>`).join('')}</div>`;
  }

  // ── lista ──
  function linhaOcorrencia(o) {
    const foto = E.fotos[o.agente] || `<span class="av-foto">${esc(Array.from(nomeDe(o.agente) || '?')[0])}</span>`;
    return `<article class="av-aviso lb-tocando" data-lb-oc="${esc(o.id)}">${foto}<div class="av-corpo">` +
      `<header class="av-topo"><b class="av-autor">${esc(o.agente_nome || nomeDe(o.agente))}</b>` +
      `<span class="av-tipo">${esc(rotuloOcorrencia(o))}</span><span class="av-hora">${esc(String(o.agendada_para || '').slice(11, 16))}</span></header>` +
      `<p class="av-texto">${esc(o.texto)}</p>` +
      `<div class="lb-acoes"><button type="button" class="bh-bt pri" data-lb-feito="${esc(o.id)}">Feito</button>` +
      `<button type="button" class="bh-bt" data-lb-adiar="${esc(o.id)}">Adiar 10 min</button></div></div></article>`;
  }

  function linhaLembrete(l, hoje, amanha) {
    const foto = E.fotos[l.agente] || `<span class="av-foto">${esc(Array.from(l.agente_nome || l.agente || '?')[0])}</span>`;
    const parado = l.estado !== 'ativo';
    const rotulo = parado ? `<span class="av-tipo">${esc((T().ROTULO_ESTADO || {})[l.estado] || l.estado)}</span>` : '';
    const menuAberto = E.menu === l.id;
    const apagar = E.apagar === l.id;
    const menu = `<span class="av-menu"><button type="button" class="av-mais" data-lb-menu="${esc(l.id)}" aria-expanded="${menuAberto}" aria-label="Mais ações" title="Mais ações">${ICO.mais}</button></span>`;
    const ops = menuAberto ? '<div class="lb-ops">' +
      `<button type="button" class="bh-bt" data-lb-hist="${esc(l.id)}">${E.hist.has(l.id) ? 'Esconder histórico' : 'Histórico'}</button>` +
      (l.estado === 'pausado' ? `<button type="button" class="bh-bt" data-lb-retomar="${esc(l.id)}">Retomar</button>`
        : l.estado === 'ativo' ? `<button type="button" class="bh-bt" data-lb-pausar="${esc(l.id)}">Pausar</button>` : '') +
      `<button type="button" class="bh-bt lb-perigo" data-lb-apagar="${esc(l.id)}">${apagar ? 'Toque de novo para apagar' : 'Apagar'}</button></div>` : '';
    const hist = E.hist.has(l.id) ? `<div class="lb-hist" data-lb-hist-de="${esc(l.id)}"><p class="av-fraco">Carregando o histórico…</p></div>` : '';
    return `<article class="av-aviso${l.estado === 'encerrado' ? ' av-apagado' : ''}" data-lb-id="${esc(l.id)}">${foto}<div class="av-corpo">` +
      `<header class="av-topo"><b class="av-autor">${esc(l.agente_nome || nomeDe(l.agente))}</b><span class="lb-regra">${esc(regraCurta(l.regra_texto))}</span>${rotulo}` +
      `<span class="av-hora">${esc(quandoCurto(l.proxima, hoje, amanha))}</span></header>` +
      `<p class="av-texto">${esc(l.texto)}</p>${ops}${hist}</div>${menu}</article>`;
  }

  function pintaLista() {
    const agora = new Date(), amanhaD = new Date(agora.getTime() + 864e5);
    const fuso = (E.agendador || {}).fuso;
    const hoje = diaNoFuso(agora, fuso), amanha = diaNoFuso(amanhaD, fuso);
    const f = E.filtro;
    const ins = E.insistindo.filter(o => !f.agente || o.agente === f.agente);
    const gs = grupos(E.lista, f.estado === '' || f.estado === 'ativo' ? ins : [], hoje, amanha);
    if (!gs.length) {
      q('#lbLista').innerHTML = '<p class="av-vazio">' + (f.estado === 'ativo' && !f.agente
        ? 'Nenhum lembrete ativo. Escreva um no campo acima, ou peça a um agente na conversa.'
        : 'Nenhum lembrete com esse filtro.') + '</p>';
    } else {
      q('#lbLista').innerHTML = gs.map(g => `<section class="av-dia"><h3 class="av-dia-t">${esc(g.rotulo)}<span class="q">${g.itens.length}</span></h3>` +
        `<div class="av-grupo">${g.itens.map(x => x.oc ? linhaOcorrencia(x.oc) : linhaLembrete(x.l, hoje, amanha)).join('')}</div></section>`).join('');
    }
    for (const id of E.hist) carregaHistorico(id);
    const a = E.agendador || {};
    q('#lbRodape').textContent = a.erro ? 'Atenção: o agendador está parado. ' + a.erro
      : (a.fuso ? 'Horário de ' + String(a.fuso).split('/').pop().replace(/_/g, ' ').replace(/^Sao /, 'São ') + '. ' : '') + 'O S2 Bot confere os lembretes a cada ' + (a.intervalo_s || 15) + ' segundos.';
  }

  async function carregaHistorico(id) {
    const caixa = el.querySelector(`[data-lb-hist-de="${CSS.escape(id)}"]`);
    if (!caixa) return;
    const r = await chamar('GET', '/api/v1/lembretes/' + encodeURIComponent(id) + '/ocorrencias?limit=30');
    if (!caixa.isConnected) return;
    if (!r.ok) { caixa.innerHTML = `<p class="av-fraco">Não consegui ler o histórico: ${esc(r.erro)}</p>`; return; }
    const ocs = r.json.ocorrencias || [];
    const fmt = T().fmt || (x => x), ROT = T().ROTULO_ESTADO || {};
    caixa.innerHTML = ocs.length ? '<ul>' + ocs.map(o => `<li><b>${esc(fmt(o.agendada_para))}</b> <span class="av-tipo">${esc(ROT[o.estado] || o.estado)}</span> ` +
      `<span class="av-fraco">${o.total_envios === 1 ? '1 aviso' : (o.total_envios || 0) + ' avisos'}${o.feito_por ? ', feito por ' + esc(o.feito_por) : ''}</span></li>`).join('') + '</ul>'
      : '<p class="av-fraco">Ainda não tocou nenhuma vez.</p>';
  }

  async function carrega() {
    const qs = new URLSearchParams();
    if (E.filtro.agente) qs.set('agente', E.filtro.agente);
    if (E.filtro.estado) qs.set('estado', E.filtro.estado);
    const r = await chamar('GET', '/api/v1/lembretes' + (qs.toString() ? '?' + qs : ''));
    if (!r.ok) {
      status('Não consegui ler os lembretes: ' + r.erro, 'erro');
      if (!E.carregou) q('#lbLista').innerHTML = '<p class="av-vazio">A lista não carregou. <button type="button" class="bh-bt" data-lb-recarrega>Tentar de novo</button></p>';
      return;
    }
    E.lista = r.json.lembretes || [];
    E.insistindo = r.json.insistindo || [];
    E.agendador = r.json.agendador || {};
    E.carregou = true;
    if (setBolinha) setBolinha(E.insistindo.length > 0);
    if (!digitando()) pintaLista();
  }
  // não redesenha a lista com um menu aberto em foco no meio de uma ação
  const digitando = () => el.contains(document.activeElement) && document.activeElement.closest('.lb-ops');

  // ── formulário ──
  function mostraCampos() {
    const v = q('#lbQuando').value;
    el.querySelectorAll('#lbForm [data-so]').forEach(x => { x.hidden = !x.dataset.so.split(' ').includes(v); });
  }
  function lerForm() {
    const v = id => q('#' + id).value;
    return { texto: v('lbTexto'), agente: E.agente, quando: v('lbQuando'), daqui: v('lbDaqui'), data: v('lbData'), hora: v('lbHora'),
      n: v('lbN'), inicio: v('lbInicio'), fim: q('#lbFim').closest('[data-so]').hidden ? '' : v('lbFim'),
      dias: Array.from(el.querySelectorAll('#lbDias input:checked')).map(i => i.value),
      intervalo: v('lbIntervalo'), teto: v('lbTeto'), peloAgente: q('#lbPeloAgente').checked };
  }
  async function criar(ev) {
    ev.preventDefault();
    msgForm('');
    if (!T().montaCorpo) { msgForm('A tela não carregou por inteiro. Recarregue a página.', 'erro'); return; }
    const r0 = T().montaCorpo(lerForm());
    if (r0.erro) { msgForm(r0.erro, 'erro'); return; }
    const b = q('#lbCriar'); b.disabled = true;
    const r = await chamar('POST', '/api/v1/lembretes', r0.corpo);
    b.disabled = false;
    if (!r.ok) { msgForm(r.erro, 'erro'); return; }
    const l = r.json.lembrete || {};
    msgForm(/^uma vez\b/.test(l.regra_texto || '') ? 'Criado. Toca em ' + (T().fmt ? T().fmt(l.proxima) : l.proxima) + '.'
      : 'Criado: ' + (l.regra_texto || '') + '.');
    q('#lbTexto').value = ''; contador();
    carrega();
  }
  function contador() { q('#lbCont').textContent = q('#lbTexto').value.length + '/' + MAX_TEXTO; }

  async function aoClicar(ev) {
    const b = ev.target.closest('button');
    if (!b || !el.contains(b)) return;
    const d = b.dataset;
    if (b.id === 'lbAgBtn') { const m = q('#lbAgMenu'); m.hidden = !m.hidden; b.setAttribute('aria-expanded', String(!m.hidden)); return; }
    if (b.id === 'lbAjustes') { const m = q('#lbMais'); m.hidden = !m.hidden; b.classList.toggle('on', !m.hidden); b.setAttribute('aria-expanded', String(!m.hidden)); return; }
    if (d.lbFestado != null) { E.filtro.estado = d.lbFestado; pintaFiltros(); carrega(); return; }
    if (d.lbFagente) { E.filtro.agente = E.filtro.agente === d.lbFagente ? '' : d.lbFagente; pintaFiltros(); carrega(); return; }
    if (d.lbMenu) { E.menu = E.menu === d.lbMenu ? null : d.lbMenu; E.apagar = null; pintaLista(); return; }
    if (d.lbHist) { if (E.hist.has(d.lbHist)) E.hist.delete(d.lbHist); else E.hist.add(d.lbHist); pintaLista(); return; }
    if (b.hasAttribute('data-lb-recarrega')) { carrega(); return; }
    if (d.lbComo) { status(d.lbComo, ''); return; }
    const A = raiz.DGClawAvisos;
    if (b.hasAttribute('data-lb-ativar') && A) return acaoAparelho(() => A.ativar(), () => 'Pronto: os avisos estão ativos neste aparelho.');
    if (b.hasAttribute('data-lb-desativar') && A) return acaoAparelho(() => A.desativar(), () => 'Avisos desligados neste aparelho.');
    if (b.hasAttribute('data-lb-teste') && A) return acaoAparelho(() => A.testar(), r => 'Aviso de teste enviado para ' + r.enviados + (r.enviados === 1 ? ' aparelho.' : ' aparelhos.'));
    let r;
    if (d.lbApagar) {
      if (E.apagar !== d.lbApagar) { E.apagar = d.lbApagar; pintaLista(); return; }
      r = await chamar('DELETE', '/api/v1/lembretes/' + encodeURIComponent(d.lbApagar));
      E.apagar = null; E.menu = null; E.hist.delete(d.lbApagar);
    } else if (d.lbPausar) { r = await chamar('POST', '/api/v1/lembretes/' + encodeURIComponent(d.lbPausar) + '/pausar'); E.menu = null; }
    else if (d.lbRetomar) { r = await chamar('POST', '/api/v1/lembretes/' + encodeURIComponent(d.lbRetomar) + '/retomar'); E.menu = null; }
    else if (d.lbFeito) r = await chamar('POST', '/api/v1/lembretes/ocorrencias/' + encodeURIComponent(d.lbFeito) + '/feito', { origem: 'tela' });
    else if (d.lbAdiar) r = await chamar('POST', '/api/v1/lembretes/ocorrencias/' + encodeURIComponent(d.lbAdiar) + '/adiar', { minutos: 10 });
    else return;
    b.disabled = true;
    if (!r.ok) status(r.erro, 'erro');
    else status(r.json.aviso || '', r.json.aviso ? 'erro' : '');
    carrega();
  }

  function tutorial() {
    if (!raiz.DGTour) return;
    raiz.DGTour.inicia({ passos: [
      { alvo: '[data-lb-tour="aparelho"]', titulo: 'Avisos neste aparelho', oque: 'Diz se este celular ou computador recebe o aviso quando um lembrete toca.',
        como: 'Toque em Ativar e permita os avisos. Com eles ativos, o ícone de avião manda um aviso de teste.', porque: 'Sem isso o lembrete só aparece na faixa da conversa e no recado do agente.' },
      { alvo: '[data-lb-tour="novo"]', titulo: 'Novo lembrete', oque: 'Escreva o que lembrar, escolha quando e de qual agente.',
        como: '"Daqui a pouco" conta os minutos a partir de agora. As outras opções repetem. O ícone de ajustes muda de quanto em quanto o aviso insiste e se o agente também avisa.', porque: 'O aviso insiste até você tocar Feito.' },
      { alvo: '[data-lb-tour="filtros"]', titulo: 'Filtros', oque: 'Ativos, pausados, encerrados ou todos, e as fotos para ver só os de um agente.',
        como: 'Toque de novo na foto para tirar o filtro.', porque: 'Para achar rápido o que está agendado.' },
      { alvo: '[data-lb-tour="lista"]', titulo: 'A lista', oque: 'O que está tocando agora (com Feito e Adiar), depois hoje, amanhã e mais adiante.',
        como: 'No "⋯" de cada lembrete: histórico, pausar, retomar e apagar.', porque: 'Tudo o que você pediu para lembrar, num lugar só.' },
    ] });
  }

  function montar(elemento, extra) {
    el = elemento;
    el.classList.add('av-raiz', 'lb-raiz');
    el.innerHTML = tela();
    if (extra && typeof extra.bolinha === 'function' && !setBolinha) setBolinha = extra.bolinha;
    q('#lbInicio').value = q('#lbData').value = diaDe(new Date());
    mostraCampos();
    q('#lbQuando').addEventListener('change', mostraCampos);
    if (window.DGSeletorAgente) window.DGSeletorAgente.opcoes(q('#lbQuando'), { titulo: 'Quando' });
    q('#lbTexto').addEventListener('input', contador);
    q('#lbForm').addEventListener('submit', criar);
    el.addEventListener('click', aoClicar);
    el.addEventListener('change', ev => {
      if (ev.target.dataset && ev.target.dataset.lbPref) { salvaPref(ev.target); return; }
      if (ev.target.name === 'lbAgente') { E.agente = ev.target.value; pintaAgente(); q('#lbAgMenu').hidden = true; q('#lbAgBtn').setAttribute('aria-expanded', 'false'); }
    });
    document.addEventListener('click', ev => {
      const m = q('#lbAgMenu');
      if (m && !m.hidden && !ev.target.closest('.av-dest')) { m.hidden = true; q('#lbAgBtn').setAttribute('aria-expanded', 'false'); }
    });
    pintaAparelho(); pintaFiltros();
    carregaAgentes().then(carrega);
    clearInterval(timer);
    timer = setInterval(() => { if (document.visibilityState === 'visible' && el.isConnected && el.offsetParent !== null) carrega(); }, 15000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && el.isConnected) { carrega(); pintaAparelho(); } });
  }

  function bolinha(fn) { if (typeof fn === 'function') setBolinha = fn; }

  // a bolinha da aba acende quando algum lembrete está tocando, mesmo antes de abrir a aba
  async function espiar() {
    if (E.carregou) return;
    const r = await chamar('GET', '/api/v1/lembretes?estado=ativo');
    if (r.ok && setBolinha) setBolinha((r.json.insistindo || []).length > 0);
  }

  function registra() {
    const api = raiz.DGMesaAbas;
    if (api && typeof api.registrar === 'function') {
      api.registrar({ id: 'lembretes', titulo: 'Lembretes', montar, bolinha });
      espiar();
      setInterval(() => { if (document.visibilityState === 'visible') espiar(); }, 60000);
      return;
    }
    const start = () => { const x = document.getElementById('lembretesRaiz'); if (x) montar(x); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }

  return { montar, registra, bolinha, tutorial, quandoCurto, grupos, rotuloOcorrencia, regraCurta, diaNoFuso, QUANDO };
});
