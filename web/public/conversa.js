'use strict';
/* conversa.js: a tela de conversa do DG Claw Web.

   O que o servidor entrega por rota (nada mais é chamado daqui):
   GET /api/v1/agents, /messages, /stream (SSE), /wait, POST /send, /upload,
   GET /media/:id, /media/:id/thumb, POST /transcribe, /tts, GET /tts/cota.

   O ciclo de voz (só quando o servidor libera microfone e voz): grava -> o
   servidor transcreve -> o texto vai como mensagem -> a tela espera a resposta
   aparecer na conversa -> lê em voz alta no MESMO <audio> que foi destravado no
   primeiro toque.

   Duas coisas do iPhone mandam no desenho deste arquivo:
   1) som só toca depois de um gesto, e só no elemento que foi tocado dentro do
      gesto. Daí o destravarAudio() e o #player reusado pra sempre.
   2) quem usa "Reduzir Movimento" não pode depender de animação: tudo que muda
      vira TEXTO em #estado ou em #micTxt. */

const $ = id => document.getElementById(id);

/* Regras puras da conversa (conversa-puro.js). Se o arquivo não carregar, a tela segue de pé com
   versões mínimas que não separam nada: o render não pode quebrar por causa de um arquivo auxiliar. */
const PURO = window.DGConversaPuro || (() => {
  console.warn('conversa-puro.js não carregou (a página não encontrou /conversa-puro.js). A conversa abre, mas o áudio transcrito aparece sem o 🎤, os avisos fechados não descansam e o Reiniciar não confirma a volta do agente. Recarregue a página; se persistir, confira se o arquivo existe em web/public.');
  return {
    avisoDescansando: () => false,
    registraFechamento: mapa => mapa || {},
    separaAudio: texto => ({ audio: false, texto: String(texto == null ? '' : texto) }),
    textoDaFala: texto => String(texto),
    avaliaVolta: () => ({ acao: 'indeterminado' }),
  };
})();

/* ── Partida: quem é o agente desta página? ───────────────────────────────
   O endereço é /a/<slug>. A lista de agentes vem da API; o agente da página é o
   da lista com esse id. Sem lista ou sem agente, a tela explica o que houve. */
function slugDaUrl() {
  const m = /^\/a\/([^/]+)\/?$/.exec(location.pathname);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
}

function mostraErroTela(titulo, texto, agentes) {
  const caixa = $('erroTela');
  $('erroTelaTit').textContent = titulo;
  $('erroTelaTxt').textContent = texto;
  const links = $('erroTelaLinks');
  links.textContent = '';
  for (const a of agentes || []) {
    const l = document.createElement('a');
    l.href = '/a/' + encodeURIComponent(a.id);
    l.textContent = 'Abrir ' + a.nome;
    links.appendChild(l);
    links.appendChild(document.createTextNode('  '));
  }
  caixa.hidden = false;
  for (const id of ['cabecalho', 'chat']) { const e = $(id); if (e) e.hidden = true; }
  const barra = document.querySelector('.barra');
  if (barra) barra.hidden = true;
}

/* ── Fileira de agentes do cabeçalho ──────────────────────────────────────
   Montada aqui fora para aparecer JÁ na partida: a lista da última visita fica guardada no
   aparelho (só nome, cor e foto) e desenha a fileira antes de a API responder. Sem isso, trocar
   de agente mostrava por um instante o cabeçalho padrão (bolinha e "DG Claw"). iniciaTela troca
   a provisória pela de verdade, com estado e avisos. */
const CHAVE_FILEIRA = 'dgclaw-fileira';
const escF = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fotoFileira(a) {
  const img = a.avatar_img || (/^https:\/\//i.test(a.avatar || '') ? a.avatar : '');
  return img ? `<img src="${escF(img)}" alt="">` : escF(a.avatar || (a.nome || '?').slice(0, 1));
}
function ordemFileira(lista) {
  return lista.filter(a => a.tipo === 'admin').concat(lista.filter(a => a.tipo !== 'admin'));
}
function montaFileira(lista, atualId) {
  const nav = document.createElement('nav');
  nav.id = 'fileira';
  nav.setAttribute('aria-label', 'Trocar de agente');
  const admin = lista.find(a => a.tipo === 'admin');
  // "Novo" fica no fim da fileira, depois dos agentes (19/10/2026, pedido do dono)
  nav.innerHTML =
    lista.map(a => {
      const atual = a.id === atualId;
      return `<a class="fil${atual ? ' atual' : ''}" href="/a/${encodeURIComponent(a.id)}" data-avt="${escF(a.id)}" style="--arco:${escF(a.cor || '#2f9e5e')}"` +
        `${atual ? ' aria-current="page"' : ''} aria-label="${escF((atual ? 'Conversa aberta: ' : 'Conversar com ') + a.nome)}">` +
        `<span class="fil-foto" style="background:${escF(a.cor || '#2f9e5e')}">${fotoFileira(a)}</span>` +
        `<span class="fil-nome">${escF(a.nome)}</span></a>`;
    }).join('') +
    (admin ? `<a class="fil novo" href="/a/${encodeURIComponent(admin.id)}#criar" aria-label="Criar um agente novo">` +
      `<span class="fil-foto"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></span>` +
      `<span class="fil-nome">Novo</span></a>` : '');
  return nav;
}
/** Põe a fileira no cabeçalho, no lugar do avatar e do nome soltos (troca a que já estiver lá). */
function pregaFileira(nav) {
  const cab = $('cabecalho'), btnMenu = $('btnMenu');
  if (!cab || !btnMenu) return false;
  const velha = $('fileira');
  if (velha) velha.remove();
  cab.insertBefore(nav, btnMenu.nextSibling);
  cab.classList.add('com-fileira');
  const at = nav.querySelector('.atual');
  if (at && at.scrollIntoView) at.scrollIntoView({ block: 'nearest', inline: 'center' });
  return true;
}
function guardaFileira(lista) {
  try {
    localStorage.setItem(CHAVE_FILEIRA, JSON.stringify(lista.map(a => ({ id: a.id, nome: a.nome, tipo: a.tipo, cor: a.cor, avatar: a.avatar, avatar_img: a.avatar_img }))));
  } catch (_) { /* sem armazenamento: a fileira só aparece quando a API responder */ }
}
(function fileiraProvisoria() {
  const slug = slugDaUrl();
  if (!slug) return;
  let lista = null;
  try { lista = JSON.parse(localStorage.getItem(CHAVE_FILEIRA) || 'null'); } catch (_) { lista = null; }
  if (!Array.isArray(lista) || lista.length < 2 || !lista.some(a => a && a.id === slug)) return;
  pregaFileira(montaFileira(ordemFileira(lista.filter(a => a && a.id)), slug));
})();

async function boot() {
  let d = null;
  try {
    const r = await fetch('/api/v1/agents', { cache: 'no-store' });
    if (r.status === 401) {
      location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
      return;
    }
    try { d = await r.json(); } catch (e) { d = null; }
    if (!r.ok || !d || d.ok === false) {
      throw new Error((d && d.erro) || ('a API respondeu ' + r.status));
    }
  } catch (e) {
    mostraErroTela('Não consegui listar os agentes',
                   e.message + '. Recarregue a página; se continuar, avise quem cuida do servidor.');
    return;
  }
  const lista = Array.isArray(d.agentes) ? d.agentes : [];
  guardaFileira(lista);
  if (!lista.length) {
    mostraErroTela('Nenhum agente por aqui ainda',
                   'O servidor não devolveu nenhum agente. Peça para cadastrarem um e recarregue.');
    return;
  }
  const slug = slugDaUrl();
  if (!slug) { location.replace('/a/' + encodeURIComponent(lista[0].id)); return; }
  const ag = lista.find(a => a.id === slug);
  if (!ag) {
    mostraErroTela('Não achei o agente "' + slug + '"',
                   'Esse endereço não corresponde a nenhum agente cadastrado. Escolha um da lista:',
                   lista);
    return;
  }
  // voz e microfone: o servidor diz por agente (ou, se preferir, uma vez para todos)
  const cap = nome => (ag[nome] !== undefined ? ag[nome] : d[nome]) === true;
  iniciaTela(ag, lista, { voz: cap('voz'), microfone: cap('microfone'), conta: d.usuario, limiteUpload: d.limite_upload_bytes });
}

function iniciaTela(AGENTE, agentesLista, caps) {
const dormir = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s == null ? '' : s)
  .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Admin primeiro (com selo "admin"); o resto na ordem que o servidor mandou. */
const agentesMenu = agentesLista.filter(a => a.tipo === 'admin')
  .concat(agentesLista.filter(a => a.tipo !== 'admin'));

const chat = $('chat'), wrap = $('wrap'), estadoEl = $('estado'), entrada = $('entrada');

/* ── Rolagem que não pula ────────────────────────────────────────────────────
   Tudo que muda a altura do #chat (mensagem nova, faixa de atividade, cartão de login,
   imagem que carregou, teclado do iPhone, o formulário "criar meu agente") passa por aqui,
   em vez de cada ponto fazer a sua conta DEPOIS da mudança (quando o "estou no fim?" já dá
   errado). Guardamos o estado da última posição que a pessoa viu: se estava no fim (80 px),
   o fim novo é seguido; se não, o primeiro balão visível volta para o mesmo lugar da tela.
   O Safari do iPhone não tem overflow-anchor, por isso a âncora é feita à mão. O
   ResizeObserver roda depois do layout e antes de pintar: nenhum quadro sai fora do lugar. */
const rolagem = (() => {
  const R = window.DGRolagem;
  const est = { noFim: true, ancora: null, top: 0 };
  const nosVistos = new WeakSet();
  const itens = () => {
    const l = Array.from(wrap.children);
    for (const f of chat.children) if (f !== wrap) l.push(f);
    return l.filter(e => !e.hidden && e.offsetHeight > 0);
  };
  function captura() {
    est.top = chat.scrollTop;
    est.noFim = R.estaNoFim(chat.scrollTop, chat.scrollHeight, chat.clientHeight);
    est.ancora = null;
    if (est.noFim) return;
    const l = itens();
    let i = R.primeiroVisivel(l.length, k => l[k].offsetTop + l[k].offsetHeight, chat.scrollTop);
    // prefere um balão com id (sobrevive a ser refeito); sem isso, o próprio elemento
    for (let j = i; i >= 0 && j < l.length && j < i + 6; j++) {
      if (l[j].dataset && l[j].dataset.msg) { i = j; break; }
    }
    if (i >= 0) {
      const e = l[i];
      est.ancora = { el: e, id: e.dataset ? e.dataset.msg : '', desvio: e.offsetTop - chat.scrollTop };
    }
  }
  function acha(a) {
    if (a.el.isConnected) return a.el;
    return a.id ? wrap.querySelector('[data-msg="' + CSS.escape(a.id) + '"]') : null;
  }
  function aplica() {
    if (!chat.clientHeight) return;      // tela escondida: não é medida de verdade
    let alvo = null;
    if (!est.noFim && est.ancora) {
      const e = acha(est.ancora);
      if (e) alvo = e.offsetTop - est.ancora.desvio;
    }
    const nova = R.novaPosicao({ estavaNoFim: est.noFim, scrollTopAgora: chat.scrollTop,
      scrollHeight: chat.scrollHeight, clientHeight: chat.clientHeight, alvoAncora: alvo });
    if (Math.abs(nova - chat.scrollTop) > 0.5) chat.scrollTop = nova;
    captura();
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(aplica) : null;
  function observa(e) { if (ro && e.nodeType === 1 && !nosVistos.has(e)) { nosVistos.add(e); ro.observe(e); } }
  if (ro) {
    ro.observe(chat);
    for (const f of chat.children) observa(f);
    // o cartão de login e o formulário de criação entram em #chat depois
    new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) observa(n); })
      .observe(chat, { childList: true });
  }
  // passivo: só mede. A posição de quem está rolando nunca é tocada aqui. O evento de scroll chega
  // um quadro DEPOIS do scrollTop que nós mesmos pusemos (aoFim, aplica); se o conteúdo cresceu nesse
  // meio tempo (visual, imagem), medir de novo daria "não estou no fim" e a conversa ficaria para trás.
  // Por isso só mede quando o scrollTop mudou de verdade desde a última captura.
  chat.addEventListener('scroll', () => { if (R.moveuDeVerdade(est.top, chat.scrollTop)) captura(); }, { passive: true });
  captura();
  return {
    captura,
    /** Rola ao fim de propósito (a pessoa pediu, ou a conversa abriu). */
    aoFim() { chat.scrollTop = chat.scrollHeight; captura(); },
    /** Traz um elemento à vista por ação explícita. */
    mostra(e, opcoes) { e.scrollIntoView(Object.assign({ block: 'nearest', behavior: 'instant' }, opcoes)); captura(); },
    noFim: () => R.estaNoFim(chat.scrollTop, chat.scrollHeight, chat.clientHeight),
  };
})();
const btnEnviar = $('btnEnviar'), btnMic = $('btnMic'), micTxt = $('micTxt');
const btnParar = $('btnParar'), btnContinua = $('btnContinua');
const btnLer = $('btnLer'), player = $('player'), avEl = $('av');
const menu = $('menu'), overlayMenu = $('overlayMenu');
const fErro = $('faixaErro'), fAviso = $('faixaAviso');
const btnAnexo = $('btnAnexo'), inputArquivo = $('arquivo');
const anexoChip = $('anexoChip'), anexoLista = $('anexoLista'), anexoInfo = $('anexoInfo');
const lightbox = $('lightbox'), lbCorpo = $('lbCorpo'), lbNome = $('lbNome'),
      lbBaixar = $('lbBaixar');
const btnFim = $('btnFim'), fimNovas = $('fimNovas');

const API = '/api/v1/agents/' + encodeURIComponent(AGENTE.id);
const AQUI = location.pathname + location.search;
const EH_ADMIN = AGENTE.tipo === 'admin';
/* A Mesa e os Lembretes levam o agente junto (?a=), para o menu deles ser o deste agente. */
(function () {
  // localStorage para a casca das outras telas; o cookie é o que o servidor lê na rota "/" (abre o último agente usado)
  window.DGCasca.guardaAgente(AGENTE.id);
  [['btnMesa', '/mesa'], ['btnLembretes', '/lembretes']].forEach(([id, href]) => {
    const el = $(id);
    if (el) el.href = window.DGMenuLado.comAgente(href, AGENTE.id);
  });
})();
(function () {
  const b = $('btnPainel');
  if (!b || !AGENTE.tem_painel) return;
  b.href = AGENTE.painel_url || ('/p/' + encodeURIComponent(AGENTE.id) + '/');
  b.hidden = false;
})();
if (window.campoCofre) window.campoCofre.configurar({ agente: AGENTE.id, outrosAgentes: AGENTE.tipo === 'admin', enviar: texto => new Promise((resolve, reject) => { enviarTexto(texto, null, { aoEntregar: (ok, motivo) => ok ? resolve() : reject(new Error(motivo || 'O agente não recebeu a mensagem.')) }); }) });
if (window.DGOnboarding) window.DGOnboarding.iniciar({ agente: AGENTE, enviar: texto => new Promise((resolve, reject) => { enviarTexto(texto, null, { aoEntregar: (ok, motivo) => ok ? resolve() : reject(new Error(motivo || 'O Admin não recebeu a mensagem.')) }); }), refazer: () => render({ semRolar: true }) });
if (window.DGBarra) window.DGBarra.liga(entrada, { url: API + '/comandos' });   // lista de comandos ao digitar /
let novasAbaixo = 0, setaVisivel = false;   // a seta pro fim e o contador dela
/* mp3 de 0,08s em silêncio: é o que destrava o áudio no iOS dentro do gesto. */
const SILENCIO = 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYwLjE2LjEwMAAAAAAAAAAAAAAA//NwwAAAAAAAAAAAAEluZm8AAAAPAAAABgAAAVMAnZ2dnZ2dnZ2dnZ2dnZ2dnbGxsbGxsbGxsbGxsbGxsbGxxcXFxcXFxcXFxcXFxcXFxdjY2NjY2NjY2NjY2NjY2NjY7Ozs7Ozs7Ozs7Ozs7Ozs7Oz/////////////////////AAAAAExhdmM2MC4zMQAAAAAAAAAAAAAAACQEUQAAAAAAAAFTx3TIuwAAAAAAAAAAAAAAAAD/8xDEAAAAA0gAAAAATEFNRTMuMTAwVVVVVf/zEsQNAAADSAAAAABVVVVVVVVVVVVVVVVVVf/zEMQbAAADSAAAAABVVVVVVVVVVVVVVVVV//MQxCgAAANIAAAAAFVVVVVVVVVVVVVVVVX/8xDENQAAA0gAAAAAVVVVVVVVVVVVVVVVVf/zEMRCAAADSAAAAABVVVVVVVVVVVVVVVVV';

/* Quem escreveu cada mensagem, pelo campo `origin` que o servidor manda:
   "dono" é quem conversa com o agente; "agente" e "rotina" são as falas do agente. */
const ehDono = m => !!m && m.origin === 'dono';
const ehAgente = m => !!m && (m.origin === 'agente' || m.origin === 'rotina');

let msgs = [];          // thread que veio da API
let pendentes = [];     // balões otimistas de quem escreve, ainda não confirmados
let lerRespostas = false;   // sempre desligada ao abrir; só o toque no botão liga
let continua = false;
let gravando = false, esperando = false, falando = false;
let pararPedido = false;
let resyncTimer = null;
let audioDestravado = false, ctxAudio = null;
let fonte = null;                   // EventSource do /stream
let streamAberto = false, jaConectou = false;
let religaTimer = null, religaEspera = 3000;
let avisoThread = null;             // último aviso da THREAD posto na faixa amarela
const ouvintesChegada = [];         // chamados no fim de cada integra()
let anexos = [];                    // arquivos colados/arrastados/escolhidos esperando o Enter

/* Rascunho por agente (pedido do dono, 21/10/2026): texto e anexos JÁ SUBIDOS ficam guardados no
   aparelho, então trocar de agente e voltar não perde nada. Anexo ainda subindo não entra (o
   arquivo só existe nesta página). Vale 7 dias, chave "dgclaw:" para sair junto no logout. */
const RASCUNHO_VALE_MS = 7 * 24 * 3600 * 1000;
let rascunhoTimer = null;
function chaveRascunho() { return 'dgclaw:' + AGENTE.id + ':rascunho'; }
function gravaRascunho() {
  if (rascunhoTimer) { clearTimeout(rascunhoTimer); rascunhoTimer = null; }
  try {
    const texto = typeof entrada !== 'undefined' && entrada ? entrada.value : '';
    const prontos = anexos.filter(a => a.estado === 'pronto' && a.id)
      .map(a => ({ id: a.id, kind: a.kind, nome: a.nome, path: a.path, bytes: a.bytes, previa: a.previaServidor || null }));
    if (!texto.trim() && !prontos.length) { localStorage.removeItem(chaveRascunho()); return; }
    localStorage.setItem(chaveRascunho(), JSON.stringify({ em: Date.now(), texto: texto.slice(0, 20000), anexos: prontos }));
  } catch (e) { console.warn('não consegui guardar o rascunho no aparelho:', e.message); }
}
function gravaRascunhoLogo() {
  if (rascunhoTimer) clearTimeout(rascunhoTimer);
  rascunhoTimer = setTimeout(gravaRascunho, 400);
}
function leRascunho() {
  try {
    const d = JSON.parse(localStorage.getItem(chaveRascunho()) || 'null');
    if (!d || !(Date.now() - d.em < RASCUNHO_VALE_MS)) { localStorage.removeItem(chaveRascunho()); return null; }
    return d;
  } catch (e) { console.warn('rascunho guardado ilegível, ignorado:', e.message); return null; }
}
let filtrosProntos = false;         // os filtros do topo (mais abaixo) já existem?
let carregouUmaVez = false;         // a primeira página já chegou (ou falhou)
let demoAtividade = false;         // o tutorial mostra um exemplo da faixa de atividade

/* Cabeçalho, título da aba e campo de texto com o nome do agente. */
function pintaAvatar(el, a) {
  if (!el) return;
  const img = a.avatar_img || (/^https:\/\//i.test(a.avatar || '') ? a.avatar : '');
  el.innerHTML = img ? `<img src="${esc(img)}" alt="">` : esc(a.avatar || (a.nome || '?').slice(0, 1));
  el.style.background = a.cor || '#2f9e5e';
}
document.documentElement.style.setProperty('--accent', AGENTE.cor || '#2f9e5e');
document.title = AGENTE.nome + ' - S2 Bot';
$('nomeAgente').textContent = AGENTE.nome;
pintaAvatar(avEl, AGENTE);
/* Foto trocada no menu (menu-lado.js): o cabeçalho e a conversa vazia mudam sem recarregar. */
document.addEventListener('dgavatar', ev => {
  const d = ev.detail || {};
  if (d.id !== AGENTE.id) return;
  AGENTE.avatar = d.avatar; AGENTE.avatar_img = d.avatar_img;
  const noMenu = agentesMenu.find(a => a.id === d.id);
  if (noMenu) Object.assign(noMenu, { avatar: d.avatar, avatar_img: d.avatar_img });
  pintaAvatar(avEl, AGENTE);
  const vz = document.querySelector('.vazio .vz-av');
  if (vz) {
    const img = d.avatar_img || '';
    vz.innerHTML = img ? `<img src="${esc(img)}" alt="">` : esc(d.avatar || (AGENTE.nome || '?').slice(0, 1));
  }
});

/* Fileira de agentes no cabeçalho (18/10/2026, pedido do dono, no lugar do grupo sobreposto e do
   nome do agente): todos lado a lado, com o nome embaixo, o aberto sublinhado e com o estado
   ("pronto", "trabalhando") embaixo do nome, um anel e um número quando há aviso não visto, e um "+"
   que leva ao Admin para criar outro. Um toque troca de conversa; no aberto, abre as mídias. */
(function () {
  $('cabecalho').classList.add('pronto');
  if (agentesMenu.length < 2) { const v = $('fileira'); if (v) v.remove(); $('cabecalho').classList.remove('com-fileira'); return; }
  const nav = montaFileira(agentesMenu, AGENTE.id);
  if (!pregaFileira(nav)) return;
  const at = nav.querySelector('.atual');
  if (at) {
    estadoEl.classList.add('fil-estado');
    at.appendChild(estadoEl);
    at.title = 'Mídias, links e arquivos desta conversa';
    at.addEventListener('click', ev => { ev.preventDefault(); $('who').click(); });
  }
  document.addEventListener('dgavatar', ev => {
    const d = ev.detail || {};
    const el = nav.querySelector('[data-avt="' + CSS.escape(d.id || '') + '"] .fil-foto');
    if (el) el.innerHTML = fotoFileira(Object.assign({}, agentesMenu.find(a => a.id === d.id) || {}, d));
  });
  // número discreto e anel em cada outro agente: avisos não vistos (amarelo se algum pede decisão)
  const outros = agentesMenu.filter(a => a.id !== AGENTE.id);
  async function badges() {
    if (document.hidden) return;
    let total = 0;
    for (const a of outros) {
      let lista = [];
      try {
        const r = await fetch('/api/v1/agents/' + encodeURIComponent(a.id) + '/alertas', { credentials: 'same-origin', cache: 'no-store' });
        if (!r.ok) continue;
        lista = ((await r.json()) || {}).alertas || [];
      } catch (_) { continue; }
      total += lista.length;
      const el = nav.querySelector('[data-avt="' + CSS.escape(a.id) + '"]');
      if (!el) continue;
      let b = el.querySelector('.fil-badge');
      el.classList.toggle('aviso', lista.length > 0);
      el.classList.toggle('pede', lista.some(x => x.tipo === 'pedido'));
      if (!lista.length) { if (b) b.remove(); el.setAttribute('aria-label', 'Conversar com ' + a.nome); continue; }
      if (!b) { b = document.createElement('span'); b.className = 'fil-badge'; el.appendChild(b); }
      b.textContent = lista.length > 9 ? '9+' : String(lista.length);
      el.setAttribute('aria-label', 'Conversar com ' + a.nome + ' (' + lista.length + ' aviso' + (lista.length > 1 ? 's' : '') + ' não visto' + (lista.length > 1 ? 's' : '') + ')');
    }
    avisosOutros = total;
    pintaBadgeApp();
  }
  badges(); setInterval(badges, 30000);
  document.addEventListener('visibilitychange', badges);
  // borda girando em quem está trabalhando: o aberto vem do stream (integraAtividade), os outros daqui
  async function quemTrabalha() {
    if (document.hidden) return;
    let d = null;
    try {
      const r = await fetch('/api/v1/atividade', { credentials: 'same-origin', cache: 'no-store' });
      if (r.ok) d = await r.json();
    } catch (_) { return; }
    if (!d || !d.agentes) return;
    if (window.DGAjudantes) window.DGAjudantes.pinta(d);   // selo na fileira e linha acima do campo
    for (const a of outros) marcaTrabalhando(a.id, (d.agentes[a.id] || {}).estado === 'trabalhando');
  }
  quemTrabalha(); setInterval(quemTrabalha, 6000);
  document.addEventListener('visibilitychange', quemTrabalha);
})();
function marcaTrabalhando(id, sim) {
  const el = document.querySelector('#fileira [data-avt="' + CSS.escape(id) + '"]');
  if (!el || el.classList.contains('trab') === sim) return;
  el.classList.toggle('trab', sim);
  const nome = (agentesMenu.find(a => a.id === id) || {}).nome || id;
  if (id === AGENTE.id) return;   // o aberto já tem o estado dele embaixo do nome (#estado)
  el.title = sim ? nome + ' está trabalhando' : '';
  // os outros também mostram "trabalhando" embaixo do nome, enquanto trabalham (18/10/2026)
  let e = el.querySelector('.fil-estado');
  if (sim && !e) { e = document.createElement('span'); e.className = 'fil-estado'; e.textContent = 'trabalhando'; el.appendChild(e); }
  else if (!sim && e) e.remove();
}
/* O "+" da fileira abre o cartão "criar um agente novo" do Admin (onboarding.js). Já na conversa do
   Admin o toque abre direto; de outro agente, o link leva ao Admin com #criar e ele abre ao carregar. */
function abreCriacao() {
  if (window.DGOnboarding && typeof window.DGOnboarding.novo === 'function') { window.DGOnboarding.novo(); return true; }
  return false;
}
if (EH_ADMIN) {
  document.addEventListener('click', ev => {
    const n = ev.target.closest && ev.target.closest('#fileira .fil.novo');
    if (n && abreCriacao()) ev.preventDefault();
  });
  if (location.hash === '#criar') {
    history.replaceState(null, '', location.pathname + location.search);
    setTimeout(abreCriacao, 400);
  }
}
entrada.placeholder = 'Pergunte ao ' + AGENTE.nome;
if (EH_ADMIN) $('avisoAdmin').hidden = false;
// ajudantes do agente aberto: linha acima do campo (ajudantes.js); o "avisar" é uma mensagem normal ao agente
if (window.DGAjudantes) window.DGAjudantes.liga(AGENTE, texto => enviarTexto(texto));
if (!caps.microfone) document.documentElement.classList.add('sem-mic');
if (!caps.voz) document.documentElement.classList.add('sem-voz');

/* ── Texto de estado, faixas, utilidades ──────────────────────────────────── */
function setEstado(txt, ehErro) {
  estadoEl.textContent = txt;
  estadoEl.style.color = ehErro ? '#c0392b' : '';
  pintaAtividade();
}

/* ── Indicador "O agente está trabalhando · rodando um comando" ────────────
   O evento SSE "atividade" traz a foto de todos os agentes; aqui vale a deste.
   Fica numa faixa entre a última mensagem e o campo de digitar (#atividade) e
   aparece sempre que o agente trabalha e o stream está aberto; o #estado do
   cabeçalho segue contando o que o app faz (gravando, enviando, erro). A foto
   fica em window.atividadeFoto. */
const atividadeEl = $('atividade');
new MutationObserver(() => { if (typeof pintaParar === 'function') pintaParar(); }).observe(atividadeEl, { attributes: true, attributeFilter: ['hidden', 'class'] });
// dica e folha de "sessão em paralelo" enquanto o agente trabalha (sessao-paralela.js)
if (window.DGSessaoParalela) window.DGSessaoParalela.inicia({ agente: AGENTE, atividade: atividadeEl, entrada });
// aviso de cota acabada, com a hora da volta, e a fila das mensagens para a volta (cota.js)
if (window.DGCota) window.DGCota.inicia({ agente: AGENTE, enviar: t => enviarTexto(t) });
if (window.DGEconomia) window.DGEconomia.inicia({ agente: AGENTE });
const atvNomeEl = atividadeEl && atividadeEl.querySelector('.atv-nome');
const atvSepEl = atividadeEl && atividadeEl.querySelector('.atv-sep');
const atvAcaoEl = atividadeEl && atividadeEl.querySelector('.atv-acao');
window.atividadeFoto = null;
let atvDeslocaMs = 0;          // relógio do servidor menos o do aparelho
let atvDetalheAte = 0;         // até quando o toque mostra o detalhe no lugar do texto
let atvBase = null;            // a ação mostrada, pra fazer a troca com fade só quando ela muda
let atvFadeTimer = null;

function atvAgoraMs() { return Date.now() + atvDeslocaMs; }
function atvDuracao(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + ' s';
  const m = Math.floor(s / 60);
  return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
}
function atvHora(iso) {
  const t = Date.parse(iso || '');
  if (!isFinite(t)) return '';
  return new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Sao_Paulo' }).replace(':', 'h');
}
/* {nome, acao, classe, titulo}: as duas metades da linha e o estilo */
function atvFrase(est) {
  const nome = AGENTE.nome;
  const ha = iso => { const t = Date.parse(iso || ''); return isFinite(t) ? atvDuracao(atvAgoraMs() - t) : null; };
  if (est.alerta === 'sem_login') {
    return { nome: nome + ' sem sinal: falta conectar a conta', acao: '', classe: 'atv-cinza',
             titulo: est.motivo || '' };
  }
  if (est.alerta === 'login_expirado') {
    const h = atvHora(est.expirou_em || est.desde);
    return { nome: nome + ' parado: o login expirou' + (h ? ' às ' + h : ''), acao: '', classe: 'atv-cinza',
             titulo: est.motivo || '' };
  }
  if (est.estado === 'sem_sinal') {
    const h = atvHora(est.ultimo_sinal);
    return { nome: nome + ' sem sinal' + (h ? ' desde ' + h : ''), acao: '', classe: 'atv-cinza',
             titulo: est.motivo || '' };
  }
  const d = ha(est.desde);
  if (est.alerta === 'permissao') {
    return { nome: nome + ' esperando a sua permissão', acao: est.detalhe ? est.detalhe.split('\n')[0].slice(0, 80) : '',
             classe: 'atv-alerta', titulo: est.detalhe || '' };
  }
  if (est.alerta === 'pergunta') {
    return { nome: nome + ' fez uma pergunta para você', acao: '', classe: 'atv-alerta', titulo: 'O agente abriu uma pergunta de escolha e está parado até ela ser respondida' };
  }
  if (est.alerta === 'ferramenta_longa') {
    return { nome: nome, acao: acaoAmigavel(est.detalhe || est.acao) + ' rodando' + (d ? ' há ' + d : ''), classe: 'atv-alerta',
             titulo: est.detalhe || '' };
  }
  if (est.alerta === 'sem_escrita') {
    const sem = ha(est.ultimo_sinal);
    return { nome: nome + ' sem escrever' + (sem ? ' há ' + sem : ''), acao: '', classe: 'atv-alerta',
             titulo: 'Sem nada escrito no registro da sessão' };
  }
  const longa = est.acao !== 'pensando' && est.desde &&
    atvAgoraMs() - Date.parse(est.desde) >= 60000;
  const oQue = acaoAmigavel(est.detalhe || est.acao);
  return { nome: nome + ' está trabalhando',
           acao: oQue + (longa && d ? ', há ' + d : ''),
           base: oQue, classe: longa ? 'atv-longa' : '', titulo: est.detalhe || '' };
}
/* Nome técnico da ferramenta vira frase de gente na faixa "está trabalhando" (18/10/2026):
   "mcp__dgchat__reply" virava texto cru para o dono. O que não está na lista passa como veio. */
const ACOES_AMIGAVEIS = {
  mcp__dgchat__reply: 'escrevendo a resposta', mcp__dgchat__send_file: 'enviando um arquivo',
  mcp__dgchat__whatsapp_reply: 'respondendo no WhatsApp', mcp__dgchat__whatsapp_send_file: 'enviando um arquivo no WhatsApp',
  Bash: 'rodando um comando', Read: 'lendo um arquivo', Edit: 'editando um arquivo', Write: 'escrevendo um arquivo',
  MultiEdit: 'editando um arquivo', NotebookEdit: 'editando um caderno', Grep: 'procurando nos arquivos', Glob: 'procurando arquivos',
  WebFetch: 'lendo uma página da internet', WebSearch: 'pesquisando na internet', Skill: 'seguindo uma skill',
  Task: 'pedindo ajuda a um subagente', Agent: 'pedindo ajuda a um subagente', TodoWrite: 'organizando as tarefas',
  ToolSearch: 'procurando uma ferramenta',
};
function acaoAmigavel(t) {
  const s = String(t || '');
  if (ACOES_AMIGAVEIS[s]) return ACOES_AMIGAVEIS[s];
  const m = /^mcp__(?:claude_ai_)?([^_]+(?:_[^_]+)*?)__(.+)$/.exec(s);
  if (m) return 'usando ' + m[1].replace(/_/g, ' ');
  return s;
}

function pintaAtividade() {
  if (!atividadeEl || demoAtividade) return;
  const foto = window.atividadeFoto;
  const est = foto && foto.agentes ? foto.agentes[AGENTE.id] : null;
  // sem o stream aberto a foto está velha: não acusa trabalho
  const mostra = !!est && est.estado !== 'ocioso' && streamAberto;
  if (atividadeEl.hidden === mostra) {
    // a faixa entra e sai do fluxo e a área de mensagens muda de altura: o
    // observador de rolagem (acima) mantém quem estava no fim no fim e quem lia lá em cima parado
    atividadeEl.hidden = !mostra;
  }
  if (!mostra) { atvBase = null; pgFecha(); return; }
  const f = atvFrase(est);
  // trabalhando sem alerta: a linha de passos (spinner, o comando de agora, quantos passos e o tempo)
  const trab = est.estado === 'trabalhando' && !est.alerta;
  atividadeEl.className = (f.classe || '') + (trab ? ' trab' : '') + (trab && pgAberto ? ' aberto' : '');
  atividadeEl.title = f.titulo;
  if (trab) { pintaPassos(est); return; }
  pgFecha();
  if (Date.now() < atvDetalheAte) {
    // toque: o detalhe (ex.: "Bash: npm test, há 40 s") no lugar da linha
    const d = Date.parse(est.desde || '');
    const detalhe = est.detalhe || est.acao || est.motivo || f.nome;
    atvNomeEl.textContent = detalhe + (est.detalhe && isFinite(d) ? ', há ' + atvDuracao(atvAgoraMs() - d) : '');
    atvSepEl.hidden = true;
    atvAcaoEl.textContent = '';
    return;
  }
  atvNomeEl.textContent = f.nome;
  atvSepEl.hidden = !f.acao;
  const base = f.base || f.acao;
  if (atvBase !== null && atvBase !== base && f.acao) {
    // ação nova: some e volta em 150 ms. O texto só entra quando o fade-out acaba
    atvAcaoEl.classList.add('troca');
    clearTimeout(atvFadeTimer);
    atvFadeTimer = setTimeout(() => { pintaAtividade(); atvAcaoEl.classList.remove('troca'); }, 150);
    atvBase = base;
    return;
  }
  atvBase = base;
  atvAcaoEl.textContent = f.acao;
}
/* ── Passos do pedido (18/10/2026, proposta aprovada pelo dono) ─────────────────
   Trabalhando, a linha colada no campo mostra o spinner, o comando (ou arquivo, busca, página) de
   agora, quantos passos já foram e o tempo desde o pedido. Um toque abre a lista para cima: os passos
   feitos (✓, com o tempo de cada um) e o de agora. Os feitos vêm da trilha da conversa (itens
   "trilha" depois da última fala do dono); o de agora vem da foto de atividade (est.passo). */
let pgAberto = false;
let pgTimer = null;
const pgListaEl = $('pgLista'), pgMetaEl = $('pgMeta');
const ICONE_PASSO = {
  terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
  ler: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  editar: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  buscar: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  skill: '<path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/>',
  ajuda: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18.5 20a6.5 6.5 0 0 0-2.5-5.1"/>',
  outro: '<circle cx="12" cy="12" r="3"/>',
};
const icPasso = tipo => `<svg class="pg-tipo" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONE_PASSO[tipo] || ICONE_PASSO.outro}</svg>`;
const IC_FEITO = '<svg class="pg-ok" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const IC_FALHOU = '<svg class="pg-erro" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const SETA_BAIXO = '<svg class="pg-seta" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
/* Uma linha de passo: ✓ (ou ✕), ícone do tipo, o comando/alvo e o tempo. Com detalhe, um toque mostra o
   comando inteiro e a saída (o que a trilha antiga mostrava). */
function htmlPasso(i, seg) {
  const t = i.trilha;
  const rot = TR.rotuloPasso(t);
  const tipo = TR.tipoPasso(t.ferramenta);
  const cab = `${t.erro ? IC_FALHOU : IC_FEITO}${icPasso(tipo)}<span class="pg-rot">${esc(rot)}</span>` +
    (seg != null ? `<span class="pg-q">${esc(TR.duracao(seg))}</span>` : '');
  const temDetalhe = !t.leitura || t.erro;
  if (!temDetalhe) return `<li class="pg-passo" title="${esc(t.comando || t.titulo)}">${cab}</li>`;
  const saida = t.saida ? `<pre class="tl-saida${t.erro ? ' erro' : ''}">${esc(t.saida)}${t.cortado ? '\n…' : ''}</pre>`
    : `<div class="tl-vazio">${t.erro ? 'falhou, sem texto de saída' : 'sem saída'}</div>`;
  return `<li class="pg-passo"><details data-tl="${esc(i.id)}"${trilhaAbertas.has(i.id) ? ' open' : ''}><summary title="${esc(t.comando || t.titulo)}">${cab}</summary>` +
    `<pre class="tl-cmdtxt">${esc(t.comando)}</pre>${saida}</details></li>`;
}
/* Os passos feitos, cada um com o tempo até o próximo (o último, até `fimEp`). */
function htmlPassos(itens, fimEp) {
  return itens.map((i, k) => htmlPasso(i, (k + 1 < itens.length ? itens[k + 1].ep : fimEp) - i.ep)).join('');
}
const ultimaFalaDono = () => msgs.reduce((a, m) => (ehDono(m) && typeof m.ep === 'number' && m.ep > a ? m.ep : a), 0);
const mmss = seg => { const s = Math.max(0, Math.round(seg)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function pintaPassos(est) {
  const desde = ultimaFalaDono();
  const feitos = msgs.filter(m => TR.ehTrilha(m) && m.ep > desde);
  const agoraSeg = atvAgoraMs() / 1000;
  const p = est.passo;
  const rot = p ? TR.rotuloPasso(p) : (est.acao === 'pensando' ? 'pensando…' : acaoAmigavel(est.acao));
  atvNomeEl.textContent = '';
  atvSepEl.hidden = true;
  atvAcaoEl.className = 'atv-acao';
  atvAcaoEl.textContent = rot;
  atvAcaoEl.title = p ? (p.comando || p.titulo || '') : '';
  const n = feitos.length + (p ? 1 : 0);
  const ini = desde || (Date.parse(est.desde || '') / 1000) || agoraSeg;
  pgMetaEl.textContent = (n ? (n === 1 ? '1 passo · ' : n + ' passos · ') : '') + mmss(agoraSeg - ini);
  pgListaEl.hidden = !pgAberto;
  if (pgAberto) {
    const inicioAgora = p ? (Date.parse(est.desde || '') / 1000 || agoraSeg) : agoraSeg;
    const agoraLi = p ? `<li class="pg-passo agora"><i class="pg-gira" aria-hidden="true"></i>${icPasso(TR.tipoPasso(p.ferramenta))}` +
      `<span class="pg-rot">${esc(rot)}</span><span class="pg-q">${esc(TR.duracao(agoraSeg - inicioAgora))}</span></li>` : '';
    const html = '<ul class="pg-passos">' + (feitos.length || agoraLi ? htmlPassos(feitos, inicioAgora) + agoraLi
      : `<li class="pg-passo vazio">${esc(AGENTE.nome)} ainda não rodou nenhum passo neste pedido.</li>`) + '</ul>';
    if (pgListaEl.innerHTML !== html) pgListaEl.innerHTML = html;
  }
  if (!pgTimer) pgTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && atividadeEl.classList.contains('trab')) pintaAtividade();
  }, 1000);
}
if (pgListaEl) pgListaEl.addEventListener('toggle', ev => {
  const d = ev.target;
  if (!d || !d.dataset || !d.dataset.tl) return;
  if (d.open) trilhaAbertas.add(d.dataset.tl); else trilhaAbertas.delete(d.dataset.tl);
}, true);
function pgFecha() {
  if (pgTimer) { clearInterval(pgTimer); pgTimer = null; }
  if (pgListaEl) pgListaEl.hidden = true;
  if (pgMetaEl) pgMetaEl.textContent = '';
  if (atvAcaoEl) { atvAcaoEl.className = 'atv-acao'; atvAcaoEl.title = ''; }
}

let trabalhavaAntes = false;
function integraAtividade(d) {
  if (!d || !d.agentes) return;
  if (typeof d.agora === 'number') atvDeslocaMs = d.agora * 1000 - Date.now();
  window.atividadeFoto = d;
  if (d.agentes[AGENTE.id]) marcaTrabalhando(AGENTE.id, d.agentes[AGENTE.id].estado === 'trabalhando');
  // começou ou terminou de trabalhar: o resumo "Fez N passos" do último pedido some ou aparece
  const est = d.agentes[AGENTE.id];
  const trabalha = !!(est && est.estado === 'trabalhando');
  if (trabalha !== trabalhavaAntes) { trabalhavaAntes = trabalha; if (carregouUmaVez) render({ semRolar: true }); }
  if (telaOciosa()) estadoOcioso();
  else pintaAtividade();
  lcSincroniza();
  leSincroniza();
  pcSincroniza();
  pqSincroniza();
  filaSincroniza();
}
if (atividadeEl) {
  atividadeEl.addEventListener('click', ev => {
    ev.stopPropagation();           // o #who em volta abre as mídias
    if (atividadeEl.classList.contains('trab')) {
      if (ev.target.closest('.pg-lista')) return;   // dentro da lista vale o toque de cada passo
      pgAberto = !pgAberto;
      pintaAtividade();
      return;
    }
    atvDetalheAte = Date.now() + 4000;
    pintaAtividade();
    setTimeout(pintaAtividade, 4100);
  });
  /* "há 3 min" anda sozinho, sem evento: um timer local. */
  setInterval(() => {
    if (document.visibilityState !== 'visible' || !window.atividadeFoto) return;
    pintaAtividade();
  }, 15000);
}

/* ── Cartão "Conectar o seu Claude/Codex" ──────────────────────────────────
   Aparece no fim da conversa quando a foto de atividade traz alerta 'sem_login'
   (o agente não tem conta conectada) ou quando a pessoa envia "/login" no campo
   (nada disso vai ao agente). O runner faz o login de verdade; aqui só se mostra
   o passo a passo, se confere de 2 em 2 s e, ao conectar, se pede o "primeiro oi".
   O que cada estado mostra vem de login-cartao.js (parte pura, com teste).
   O código colado e o link nunca vão para console nem para log. */
const LC = window.DGLoginCartao;
const lcEl = $('loginCartao');
const lc = { aberto: false, manual: false, iniciado: false, demo: false, dispensado: false, abriuLink: false, vencido: false,
             carregando: false, ocupado: false, dados: null, erro: '', codigo: '', copiado: false,
             timer: null, conferindo: false, chave: '', fechaTimer: null, expirado: false };
const LOGIN_API = API + '/login';

function lcVisao() {
  return LC.visao(lc.dados, { iniciado: lc.iniciado, agente: AGENTE.nome, abriuLink: lc.abriuLink, vencido: lc.vencido });
}
function lcBotao(texto, classe, aoClicar) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'lc-btn ' + classe; b.textContent = texto;
  b.disabled = lc.ocupado;
  b.addEventListener('click', aoClicar);
  return b;
}
function lcEl_(tag, classe, texto) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto != null) e.textContent = texto;
  return e;
}

function lcDesenha() {
  if (!lc.aberto) { lcEl.hidden = true; lc.chave = ''; return; }
  if (!LC) { mostraErro('O cartão de login não carregou. Recarregue a página.'); lcEl.hidden = true; return; }
  const v = lc.carregando
    ? { fase: 'carregando', provedor: LC.nomeProvedor(lc.dados && lc.dados.provedor), titulo: 'Conferindo a conta…', texto: '', passos: [], aviso: 'Conferindo a conta' }
    : lcVisao();
  const chave = JSON.stringify([v, lc.erro, lc.ocupado, lc.copiado]);
  if (chave === lc.chave && !lcEl.hidden) return;
  lc.chave = chave;
  const tinhaFoco = lcEl.contains(document.activeElement);
  const antes = document.getElementById('lcCodigo');
  if (antes) lc.codigo = antes.value;
  // o campo é refeito a cada desenho: sem devolver o foco a ele, o teclado fecha no meio da digitação
  const codigoFocado = !!antes && document.activeElement === antes;
  const selIni = codigoFocado ? antes.selectionStart : 0, selFim = codigoFocado ? antes.selectionEnd : 0;
  const abrindo = lcEl.hidden;

  /* Passo a passo (20/10/2026, pedido do dono): ícone, título e uma linha; os três passos com o atual
     marcado; o texto do passo e uma ação só. Ações secundárias são o × e links discretos. */
  const svg = d => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICO_LC = { chave: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2M14 9l2 2"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
    ok: '<path d="m5 12 4.5 4.5L19 7"/>', ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', seta: '<path d="M12 19V5M6 11l6-6 6 6"/>' };
  const pronto = v.fase === 'concluido';
  const topo = lcEl_('div', 'lc-topo');
  const ic = lcEl_('span', 'lc-ic' + (pronto ? ' ok' : ''));
  ic.innerHTML = svg(pronto ? ICO_LC.ok : ICO_LC.chave);
  const tt = lcEl_('span', 'lc-tt');
  const tit = lcEl_('b', 'lc-titulo', v.titulo);
  tit.id = 'lcTitulo';
  tt.append(tit);
  if (v.sub) tt.append(lcEl_('small', 'lc-sub', v.sub));
  topo.append(ic, tt);
  if (v.fechar || v.cancelar) {
    const x = lcEl_('button', 'lc-x');
    x.type = 'button'; x.innerHTML = svg(ICO_LC.x);
    x.title = v.cancelar ? 'Cancelar o login' : 'Fechar'; x.setAttribute('aria-label', x.title);
    x.disabled = lc.ocupado;
    x.addEventListener('click', v.cancelar ? lcCancela : () => lcFecha(true));
    topo.append(x);
  }
  lcEl.setAttribute('aria-label', v.titulo);
  const corpo = [topo];
  if (v.fase !== 'ja_conectado' && v.fase !== 'falhou' && v.etapas) {
    const pass = lcEl_('ol', 'lc-etapas');
    v.etapas.forEach((t, i) => {
      const li = lcEl_('li', i < v.passo ? 'ok' : i === v.passo ? 'on' : '');
      const bola = lcEl_('i', '');
      if (i < v.passo) bola.innerHTML = svg(ICO_LC.ok); else bola.textContent = String(i + 1);
      li.append(bola, document.createTextNode(t));
      if (i === v.passo) li.setAttribute('aria-current', 'step');
      pass.append(li);
    });
    corpo.push(pass);
  }
  // no começo a linha de baixo do título já diz tudo; o texto entra a partir do passo do link
  if (v.texto && !pronto && !['ja_conectado', 'inicio', 'falhou'].includes(v.fase)) corpo.push(lcEl_('p', 'lc-texto', v.texto));
  if (v.link && !v.reabrir) {
    const a = lcEl_('a', 'lc-btn lc-link');
    a.innerHTML = svg(ICO_LC.ext) + '<span>Abrir a página de login</span>';
    a.href = v.link; a.target = '_blank'; a.rel = 'noopener noreferrer';
    // a página abriu: o passo vai para o código (a conferência de 2 em 2 s continua)
    a.addEventListener('click', () => { lc.abriuLink = true; setTimeout(lcDesenha, 300); });
    corpo.push(a);
  }
  if (v.codigoDispositivo && (v.reabrir || !v.link)) {
    const linha = lcEl_('div', 'lc-disp');
    linha.append(lcEl_('code', 'lc-disp-cod', v.codigoDispositivo));
    linha.append(lcBotao(lc.copiado ? 'Copiado' : 'Copiar', 'lc-leve', () => lcCopia(v.codigoDispositivo)));
    corpo.push(linha);
  }
  if (v.campoCodigo) {
    const campo = document.createElement('input');
    campo.type = 'text'; campo.id = 'lcCodigo'; campo.className = 'lc-campo';
    campo.autocomplete = 'off'; campo.spellcheck = false; campo.value = lc.codigo;
    campo.placeholder = 'Cole o código aqui';
    campo.setAttribute('aria-label', 'Cole aqui o código que aparece no fim');
    campo.setAttribute('autocapitalize', 'off');
    campo.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); lcEnviaCodigo(); } });
    campo.addEventListener('focus', () => lcTrazCampo(campo));
    const vai = lcBotao('', 'lc-go', lcEnviaCodigo);
    vai.innerHTML = svg(ICO_LC.seta); vai.title = 'Enviar código'; vai.setAttribute('aria-label', 'Enviar código');
    const linha = lcEl_('div', 'lc-linha');
    linha.append(campo, vai);
    corpo.push(linha);
  }
  if (v.reabrir && v.link) {
    const p = lcEl_('p', 'lc-dica');
    const a = lcEl_('a', '', 'Abrir a página de novo');
    a.href = v.link; a.target = '_blank'; a.rel = 'noopener noreferrer';
    p.append(document.createTextNode('Não abriu? '), a);
    corpo.push(p);
  }
  if (lc.erro) {
    const e = lcEl_('p', 'lc-erro', lc.erro);
    e.setAttribute('role', 'alert');
    corpo.push(e);
  }
  if (v.fase === 'falhou' || v.fase === 'ja_conectado') corpo.push(lcEl_('p', 'lc-texto', v.texto));
  const pe = lcEl_('div', 'lc-pe');
  if (v.botao) pe.append(lcBotao(lc.ocupado && v.fase === 'inicio' ? 'Conectando…' : v.botao, 'lc-principal', lcComeca));
  if (v.entrarDeNovo) pe.append(lcBotao('Entrar de novo', 'lc-leve', lcComeca));
  if (pe.childElementCount) corpo.push(pe);
  const vivo = lcEl_('p', 'lc-vivo', v.aviso || '');
  vivo.setAttribute('aria-live', 'polite');
  corpo.push(vivo);

  lcEl.replaceChildren(...corpo);
  lcEl.hidden = false;
  if (abrindo) {
    // entrada leve (desligada em prefers-reduced-motion pelo CSS) e foco no botão principal
    lcEl.classList.remove('entra'); void lcEl.offsetWidth; lcEl.classList.add('entra');
    // só vai ao cartão quem o pediu (/login) ou já estava no fim; quem lê mais acima não é puxado
    if (lc.manual) rolagem.aoFim();
    // aberto sozinho, não rouba o foco de quem está digitando; pelo /login, vai para o botão
    if (!lc.demo && (lc.manual || !/^(INPUT|TEXTAREA)$/.test(document.activeElement ? document.activeElement.tagName : ''))) lcFoco();
  } else if (codigoFocado) {
    const novo = document.getElementById('lcCodigo');
    if (novo) {
      novo.focus({ preventScroll: true });
      try { novo.setSelectionRange(selIni, selFim); } catch (e) { console.warn('cartão de login: não restaurei o cursor:', e.message); }
    } else lcFoco();
  } else if (tinhaFoco && (!lcEl.contains(document.activeElement) || document.activeElement === lcEl)) lcFoco();
}

/* O campo do código fica no fim do #chat. No iPhone o teclado sobe DEPOIS do foco e encolhe a
   área visível, então o campo precisa ser trazido para a vista de novo quando isso acontece.
   A conta é feita só no #chat (scrollIntoView poderia deslocar a página inteira no iOS) e
   nunca anima, o que também vale para "Reduzir Movimento". */
function lcTrazCampo(campo) {
  const traz = () => {
    if (!campo.isConnected || document.activeElement !== campo || !chat.clientHeight) return;
    const alvo = campo.parentElement || campo;
    const r = alvo.getBoundingClientRect(), c = chat.getBoundingClientRect();
    if (r.bottom > c.bottom - 12) chat.scrollTop += r.bottom - c.bottom + 12;
    else if (r.top < c.top + 12) chat.scrollTop -= c.top + 12 - r.top;
    rolagem.captura();
  };
  const vv = window.visualViewport;
  const aoRedimensionar = () => setTimeout(traz, 120);
  if (vv) {
    vv.addEventListener('resize', aoRedimensionar);
    campo.addEventListener('blur', () => vv.removeEventListener('resize', aoRedimensionar), { once: true });
  }
  setTimeout(traz, 350);
}
function lcFoco() {
  const alvo = lcEl.querySelector('.lc-link, .lc-principal') || lcEl.querySelector('.lc-btn') || lcEl;
  try { alvo.focus({ preventScroll: true }); } catch (e) { /* elemento saiu do documento */ }
}

function lcPara() { if (lc.timer) { clearInterval(lc.timer); lc.timer = null; } }
function lcFecha(dispensar) {
  lcPara();
  clearTimeout(lc.fechaTimer);
  if (dispensar) lc.dispensado = true;
  Object.assign(lc, { aberto: false, manual: false, iniciado: false, demo: false, carregando: false,
                      ocupado: false, erro: '', codigo: '', copiado: false, abriuLink: false, expirado: false });
  const era = !lcEl.hidden;
  lcDesenha();
  if (era) estadoOcioso();
  leAoFecharCartao();
}
function lcEmAndamento() {
  const e = lc.dados && lc.dados.estado;
  return e === 'aguardando_link' || e === 'aguardando_codigo' || e === 'aguardando_navegador';
}
function lcAgenda() {
  if (lc.timer || !lc.aberto) return;
  lc.timer = setInterval(() => { if (document.visibilityState === 'visible') lcConfere(); }, 2000);
}

/* Lê o estado do login no runner. Erro de rede aparece no cartão e a conferência continua. */
async function lcConfere() {
  if (!lc.aberto || lc.conferindo || lc.demo) return;
  lc.conferindo = true;
  try {
    const d = await api(LOGIN_API, { timeoutMs: 15000 });
    if (!lc.aberto) return;
    lc.erro = '';
    const eraEmAndamento = lcEmAndamento();
    lc.dados = d;
    lc.carregando = false;
    if (lcEmAndamento()) { lc.iniciado = true; lcAgenda(); }
    else if (d.estado === 'concluido' && (lc.iniciado || eraEmAndamento)) { lc.iniciado = true; lcConcluiu(); }
    else if (!lc.iniciado || d.estado === 'falhou') lcPara();
    lcDesenha();
  } catch (e) {
    if (!lc.aberto) return;
    lc.carregando = false;
    lc.erro = 'Não consegui conferir o login: ' + e.message;
    lcDesenha();
  } finally { lc.conferindo = false; }
}

function lcConcluiu() {
  if (lc.fechaTimer) return;
  lcPara();
  leLoginConcluido();
  // O oi é pedido já: o servidor espera o agente subir (até 60 s) e entrega uma vez só. Com o login
  // EXPIRADO não há oi: o runner reinicia a mesma sessão e entrega o recado "login-reconectado".
  if (!lc.expirado) {
    api(LOGIN_API + '/oi', { method: 'POST', body: {}, timeoutMs: 75000 })
      .catch(e => mostraAviso('A conta foi conectada, mas não consegui pedir o oi do agente: ' + e.message + '. Escreva um oi na conversa.'));
  }
  lc.fechaTimer = setTimeout(() => { lc.fechaTimer = null; lcFecha(false); }, 1500);
}

async function lcComeca() {
  if (lc.ocupado) return;
  lc.ocupado = true; lc.erro = ''; lcDesenha();
  try {
    const d = await api(LOGIN_API, { method: 'POST', body: {}, timeoutMs: 20000 });
    lc.dados = d; lc.iniciado = true; lc.carregando = false; lc.abriuLink = false;
    lcAgenda();
  } catch (e) {
    lc.erro = 'Não consegui começar o login: ' + e.message;
  } finally { lc.ocupado = false; lcDesenha(); }
}

async function lcEnviaCodigo() {
  if (lc.ocupado) return;
  const campo = document.getElementById('lcCodigo');
  const codigo = campo ? campo.value.trim() : '';
  if (!codigo) { lc.erro = 'Cole o código que a página mostrou no fim do login.'; lcDesenha(); if (campo) campo.focus(); return; }
  lc.codigo = codigo; lc.ocupado = true; lc.erro = ''; lcDesenha();
  try {
    await api(LOGIN_API + '/codigo', { method: 'POST', body: { codigo }, timeoutMs: 20000 });
    lc.codigo = '';
  } catch (e) {
    lc.erro = 'Não consegui enviar o código: ' + e.message;
  } finally { lc.ocupado = false; lcDesenha(); }
  if (!lc.erro) lcConfere();
}

async function lcCancela() {
  if (lc.ocupado) return;
  lc.ocupado = true; lc.erro = ''; lcDesenha();
  try {
    await api(LOGIN_API, { method: 'DELETE', timeoutMs: 20000 });
  } catch (e) {
    lc.ocupado = false;
    lc.erro = 'Não consegui cancelar o login: ' + e.message;
    lcDesenha();
    return;
  }
  lcFecha(true);
}

async function lcCopia(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    lc.copiado = true; lc.erro = '';
    setTimeout(() => { lc.copiado = false; lcDesenha(); }, 2000);
  } catch (e) {
    lc.erro = 'Não consegui copiar sozinho (' + e.message + '). Toque no código, segure e escolha copiar.';
  }
  lcDesenha();
}

/* Abre o cartão. `manual`: veio do /login (fica mesmo com a conta conectada). */
function lcAbre(manual, semConferir) {
  if (lc.aberto) { if (manual) { lc.manual = true; lc.dispensado = false; } lcDesenha(); return; }
  Object.assign(lc, { aberto: true, manual: !!manual, iniciado: false, erro: '', codigo: '', carregando: !semConferir,
                      dados: { estado: 'nenhum', provedor: AGENTE.provedor, precisa_login: !manual } });
  lcDesenha();
  if (!semConferir) lcConfere();
}

/* Chamado a cada foto de atividade: abre o cartão quando falta conta e o fecha quando a falta some. */
function lcSincroniza() {
  if (lc.demo) return;
  const est = window.atividadeFoto && window.atividadeFoto.agentes ? window.atividadeFoto.agentes[AGENTE.id] : null;
  const expirado = !!est && est.alerta === 'login_expirado';
  const semLogin = !!est && (est.alerta === 'sem_login' || expirado);
  if (!semLogin) lc.dispensado = false;
  if (expirado) lc.expirado = true;
  if (semLogin && !lc.aberto && !lc.dispensado) { lc.vencido = /venceu/.test(est.motivo || ''); lcAbre(false); }
  else if (!semLogin && lc.aberto && !lc.manual && !lc.iniciado) lcFecha(false);
}

/* O comando /login digitado no campo: abre o cartão e não manda nada ao agente. */
function lcInterceptaLogin(texto) {
  if (!LC || !LC.ehComandoLogin(texto)) return false;
  lcAbre(true);
  return true;
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') lcConfere(); });

/* ── Pop-up "Seu login do Claude expirou" ──────────────────────────────────
   A conta ESTAVA conectada e a credencial morreu (alerta 'login_expirado' da foto de atividade):
   o agente parou de responder e nada aparecia na conversa. Este <dialog> modal explica o que houve
   e oferece o caminho: reconectar (o cartão de login, que é levado para dentro do pop-up, em vez
   de reescrito), reiniciar a sessão (o Reiniciar do menu, com a mesma faixa de acompanhamento) ou
   "Agora não" (dispensa só ESTE incidente, guardado por agente + instante em sessionStorage; o
   cartão no fim da conversa continua). Depois do login o runner reinicia a MESMA sessão sozinho: o
   pop-up só espera o agente voltar. Quando decide e o que diz vem de login-expirado.js (com teste). */
const LE = window.DGLoginExpirado;
const leDlg = $('dlgLoginExpirado');
const le = { aberto: false, fase: 'aviso', est: null, erro: '', timer: null, concluiu: false, origemCartao: null };
const LE_DISPENSADOS = 'dgclaw-login-expirado-dispensados';
let reiniciaSessao = null;   // ligado pelo bloco "Reiniciar sessão do agente", mais abaixo

function leEstAtual() {
  return window.atividadeFoto && window.atividadeFoto.agentes ? window.atividadeFoto.agentes[AGENTE.id] || null : null;
}
function leDispensados() {
  try { return JSON.parse(sessionStorage.getItem(LE_DISPENSADOS) || '{}') || {}; }
  catch (e) { console.warn('pop-up de login: não consegui ler os incidentes dispensados (' + e.message + '); mostro o pop-up de novo.'); return {}; }
}
function leDispensa() {
  try { sessionStorage.setItem(LE_DISPENSADOS, JSON.stringify(LE.dispensar(leDispensados(), AGENTE.id, le.est || {}))); }
  catch (e) { console.warn('pop-up de login: não guardei o "Agora não" (' + e.message + '); ele volta se a página recarregar.'); }
}
function leTextos() {
  const est = le.est || leEstAtual() || {};
  return LE.textos({ nome: AGENTE.nome, provedor: est.provedor || AGENTE.provedor, expirouEm: est.expirou_em, motivo: le.erro });
}

function leDesenha() {
  if (!leDlg) return;
  const t = leTextos(), f = le.fase;
  $('leTit').textContent = f === 'pronto' ? t.pronto : t.titulo;
  const txt = $('leTxt');
  txt.textContent = t.corpo;
  txt.hidden = f !== 'aviso';
  $('leCartao').hidden = f !== 'cartao';
  const estado = $('leEstado');
  estado.textContent = f === 'reiniciando' ? t.reiniciando : f === 'pronto' ? t.pronto : '';
  estado.hidden = !estado.textContent;
  const erro = $('leErro');
  erro.textContent = f === 'nao_voltou' ? t.naoVoltou : le.erro;
  erro.hidden = !erro.textContent;
  const prim = $('lePrimario'), sec = $('leSecundario'), nao = $('leAgoraNao');
  prim.textContent = t.primario; sec.textContent = t.secundario;
  prim.hidden = f !== 'aviso';
  sec.hidden = !(f === 'aviso' || f === 'nao_voltou');
  nao.hidden = f === 'pronto';
  nao.textContent = f === 'aviso' || f === 'cartao' ? t.agoraNao : 'Fechar';
}

function leAbre() {
  if (!LE || !leDlg || le.aberto) return;
  le.est = leEstAtual();
  Object.assign(le, { aberto: true, fase: 'aviso', erro: '', concluiu: false });
  leDesenha();
  if (leDlg.showModal) leDlg.showModal(); else leDlg.setAttribute('open', '');
  try { $('lePrimario').focus({ preventScroll: true }); } catch (e) { console.warn('pop-up de login: não consegui pôr o foco no botão:', e.message); }
}

function leFecha(dispensar) {
  if (!le.aberto) return;
  clearTimeout(le.timer);
  if (dispensar) leDispensa();
  leDevolveCartao();
  le.aberto = false;
  if (leDlg.close) leDlg.close(); else leDlg.removeAttribute('open');
}

/* O cartão de login muda de lugar (do fim da conversa para dentro do pop-up) e volta depois. */
function leLevaCartao() {
  if (le.origemCartao || !lcEl) return;
  le.origemCartao = { pai: lcEl.parentNode, depois: lcEl.nextSibling };
  $('leCartao').appendChild(lcEl);
}
function leDevolveCartao() {
  const o = le.origemCartao;
  if (!o) return;
  le.origemCartao = null;
  o.pai.insertBefore(lcEl, o.depois && o.depois.parentNode === o.pai ? o.depois : null);
}

async function leReconectar() {
  le.erro = '';
  le.fase = 'cartao';
  le.concluiu = false;
  leLevaCartao();
  leDesenha();
  lc.expirado = true;
  if (!lc.aberto) lcAbre(false, true);
  else lcDesenha();
  await lcComeca();
}

/* O cartão fechou: ou o login terminou (segue para esperar a volta) ou a pessoa cancelou (volta à pergunta). */
function leAoFecharCartao() {
  if (!le.aberto || le.fase !== 'cartao') return;
  leDevolveCartao();
  if (le.concluiu) leComecaVolta();
  else { le.fase = 'aviso'; leDesenha(); try { $('lePrimario').focus({ preventScroll: true }); } catch (e) { /* o botão acabou de ser mostrado */ } }
}
function leLoginConcluido() {
  if (le.aberto && le.fase === 'cartao') le.concluiu = true;
}

/* Espera o agente voltar a responder. Reaproveita a mesma regra do Reiniciar (avaliaVolta). */
function leComecaVolta() {
  clearTimeout(le.timer);
  le.fase = 'reiniciando'; le.erro = '';
  leDesenha();
  const ini = Date.now();
  const marco = atvAgoraMs() / 1000;
  let vivas = 0, ultimoAgora = null;
  const olha = () => {
    if (!le.aberto || le.fase !== 'reiniciando') return;
    const v = PURO.avaliaVolta({ marco, ultimoAgora, vivas, foto: window.atividadeFoto, agenteId: AGENTE.id, streamAberto, decorridoMs: Date.now() - ini });
    vivas = v.vivas; ultimoAgora = v.ultimoAgora;
    if (v.acao === 'voltou') return lePronto();
    if (v.acao === 'login_expirado' || v.acao === 'sem_login') return leNaoVoltou(v.motivo || 'A conta continua sem login. Reconecte de novo.');
    if (v.acao === 'indeterminado') return leNaoVoltou('A tela não consegue confirmar a volta (conversa-puro.js não carregou). Recarregue a página.');
    if (Date.now() - ini > LE.PRAZO_VOLTA_MS) return leNaoVoltou('');
    le.timer = setTimeout(olha, 2000);
  };
  le.timer = setTimeout(olha, 2000);
}
function leNaoVoltou(motivo) {
  le.fase = 'nao_voltou'; le.erro = motivo;
  leDesenha();
  try { $('leSecundario').focus({ preventScroll: true }); } catch (e) { /* botão recém-mostrado */ }
}
function lePronto() {
  le.fase = 'pronto'; le.erro = '';
  leDesenha();
  le.timer = setTimeout(() => leFecha(false), LE.FECHA_PRONTO_MS);
}

function leReiniciar() {
  if (!reiniciaSessao) {
    le.erro = 'O botão de reiniciar não carregou nesta página. Recarregue a página ou use o menu da conversa, "Reiniciar a sessão".';
    leDesenha();
    return;
  }
  leFecha(true);
  reiniciaSessao();
}

/* A cada foto de atividade: abre quando o alerta aparece; com o alerta sumido (login feito pelo
   terminal, ou o runner reiniciou sozinho) passa a esperar o "voltou". */
function leSincroniza() {
  if (!LE || !leDlg) return;
  const est = leEstAtual();
  if (LE.expirado(est)) le.est = est;
  const d = LE.decisao({ aberto: le.aberto, fase: le.fase, agenteId: AGENTE.id, est, dispensados: leDispensados() });
  if (d === 'abrir') leAbre();
  else if (d === 'aguardar_volta') { leDevolveCartao(); leComecaVolta(); }
}

/* Mensagem recusada com LOGIN_EXPIRADO: a pessoa acabou de tentar falar, então abre mesmo se dispensou. */
function leAbreAoRecusar() {
  if (!LE || !leDlg) { mostraErro('O login da conta expirou, mas o pop-up de reconectar não carregou. Recarregue a página e use o cartão de login.'); return; }
  const est = leEstAtual();
  if (le.aberto) return;
  if (est && LE.expirado(est)) { lc.expirado = true; }
  leAbre();
}

if (leDlg && LE) {
  $('lePrimario').onclick = () => { leReconectar(); };
  $('leSecundario').onclick = leReiniciar;
  $('leAgoraNao').onclick = () => leFecha(true);
  leDlg.addEventListener('cancel', ev => { ev.preventDefault(); leFecha(true); });
} else {
  console.warn('pop-up de login expirado: ' + (!LE ? 'login-expirado.js não carregou' : 'falta #dlgLoginExpirado na página') + '. O cartão de login no fim da conversa continua funcionando.');
}

/* ── Cartão "O agente está esperando a sua permissão" ─────────────────────
   Aparece quando a foto de atividade traz alerta 'permissao' (o runner está em waiting_input).
   Mostra o que o agente quer fazer (o último comando sem resultado no transcript, calculado no
   servidor) e dois botões. A decisão vai para POST /permissao, que confere no runner que o agente
   ainda espera. O cartão some sozinho quando o estado sai de waiting_input. */
const TR = window.DGTrilha;
const pcEl = $('permCartao');
const pc = { aberto: false, ocupado: false, decidido: '', erro: '', chave: '', id: '' };

function pcSincroniza() {
  if (!pcEl || !TR) return;
  const est = window.atividadeFoto && window.atividadeFoto.agentes ? window.atividadeFoto.agentes[AGENTE.id] : null;
  const pede = !!est && est.alerta === 'permissao' && streamAberto;
  if (!pede) {
    if (pc.aberto) { Object.assign(pc, { aberto: false, ocupado: false, decidido: '', erro: '', chave: '' }); pcEl.hidden = true; }
    return;
  }
  const chave = JSON.stringify([est.desde, est.permissao, pc.ocupado, pc.decidido, pc.erro]);
  if (pc.aberto && chave === pc.chave) return;
  const novo = !pc.aberto;
  if (novo) { pc.decidido = ''; pc.erro = ''; }
  pc.aberto = true;
  pc.chave = JSON.stringify([est.desde, est.permissao, pc.ocupado, pc.decidido, pc.erro]);
  pcDesenha(est.permissao, novo);
}

function pcDesenha(pedido, abrindo) {
  // O id do tool_use que a tela mostra vai junto da decisão: o runner recusa se o pedido de agora for outro.
  pc.id = (pedido && typeof pedido.id === 'string') ? pedido.id : '';
  const filho = (tag, classe, texto) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto != null) e.textContent = texto;
    return e;
  };
  pcEl.textContent = '';
  // 22/10/2026: no visual novo (paleta do tema, cartão como o de escolha); o ícone é o escudo de traço
  const cab = filho('div', 'pc-cab');
  cab.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z"/><path d="M12 9v4M12 16.5v.01"/></svg>';
  cab.appendChild(filho('strong', 'pc-titulo', AGENTE.nome + ' pede a sua permissão'));
  pcEl.appendChild(cab);
  if (pedido && pedido.titulo) {
    pcEl.appendChild(filho('p', 'pc-texto', 'Ele parou e só continua depois que você decidir. Quer fazer isto:'));
    pcEl.appendChild(filho('pre', 'pc-pedido', TR.descricaoPedido(pedido)));
  } else {
    pcEl.appendChild(filho('p', 'pc-texto', 'Ele parou e só continua depois que você decidir. Não disse o que quer fazer: se tiver dúvida, negue e pergunte na conversa.'));
  }
  if (pc.erro) pcEl.appendChild(filho('p', 'pc-erro', pc.erro));
  const linha = filho('div', 'pc-botoes');
  const botao = (texto, classe, decisao) => {
    const b = filho('button', 'pc-btn ' + classe, texto);
    b.type = 'button';
    b.disabled = pc.ocupado || !!pc.decidido;
    b.addEventListener('click', () => pcDecide(decisao));
    return b;
  };
  linha.appendChild(botao('Negar', 'pc-nega', 'negar'));
  linha.appendChild(botao('Aprovar', 'pc-aprova', 'aprovar'));
  pcEl.appendChild(linha);
  const msg = pc.decidido ? (pc.decidido === 'aprovar' ? 'Aprovado. Aguardando o agente continuar…' : 'Negado. Aguardando o agente continuar…')
    : (pc.ocupado ? 'Enviando a sua decisão…' : '');
  const vivo = filho('p', 'pc-status', msg);
  vivo.setAttribute('role', 'status');
  pcEl.appendChild(vivo);
  pcEl.hidden = false;
  if (abrindo) pcEl.classList.add('entra');
  else pcEl.classList.remove('entra');
}

async function pcDecide(decisao) {
  if (pc.ocupado || pc.decidido) return;
  pc.ocupado = true; pc.erro = '';
  pcSincroniza();
  try {
    await api(API + '/permissao', { method: 'POST', body: pc.id ? { decisao, tool_use_id: pc.id } : { decisao }, timeoutMs: 20000 });
    pc.decidido = decisao;
  } catch (e) {
    pc.erro = 'Não consegui enviar a decisão: ' + e.message;
  } finally {
    pc.ocupado = false;
    pcSincroniza();
  }
}

/* ── Cartão "O agente fez uma pergunta de escolha" ───────────────────────
   Aparece quando a foto de atividade traz alerta 'pergunta' (o agente chamou AskUserQuestion e a tela dele espera
   a resposta). Com `pergunta` na foto desenha as escolhas (única: botões de rádio + "Outra resposta"; múltipla:
   caixinhas) e manda POST /pergunta com o tool_use_id; o servidor digita as teclas no terminal. Sem `pergunta`
   (formato que o servidor não conseguiu ler) o cartão só manda a pessoa para o terminal na aba Sessões.
   As escolhas ficam em `pq` e os eventos mexem no DOM direto: a foto chega a cada poucos segundos e redesenhar
   apagaria o que a pessoa está digitando. */
const pqEl = $('perguntaCartao');
const pq = { aberto: false, ocupado: false, feito: '', erro: '', noTerminal: false, id: '', chave: '', sel: [], texto: [], btnEnvia: null };

function pqReinicia() {
  Object.assign(pq, { aberto: false, ocupado: false, feito: '', erro: '', id: '', chave: '', sel: [], texto: [], btnEnvia: null });
  if (pqEl) { pqEl.hidden = true; pqEl.textContent = ''; }
}

function pqSincroniza() {
  if (!pqEl) return;
  const est = window.atividadeFoto && window.atividadeFoto.agentes ? window.atividadeFoto.agentes[AGENTE.id] : null;
  const pede = !!est && est.alerta === 'pergunta' && streamAberto;
  if (!pede) { if (pq.aberto) pqReinicia(); return; }
  const perg = est.pergunta || null;
  const id = perg ? perg.id : '';
  if (pq.aberto && pq.id !== id) pqReinicia();   // outra pergunta no lugar da anterior: começa limpo
  const chave = JSON.stringify([est.desde, id, pq.ocupado, pq.feito, pq.erro, pq.noTerminal]);
  if (pq.aberto && chave === pq.chave) return;
  const novo = !pq.aberto;
  if (novo) {
    pq.id = id; pq.feito = ''; pq.erro = ''; pq.noTerminal = false;
    pq.sel = perg ? perg.perguntas.map(q => (q.multipla ? [] : null)) : [];
    pq.texto = perg ? perg.perguntas.map(() => '') : [];
  }
  pq.aberto = true;
  pq.chave = chave;
  pqDesenha(perg, novo);
}

/* Cada pergunta tem uma resposta quando: múltipla com pelo menos uma caixinha; única com opção ou texto. */
function pqCompleto(perg) {
  return perg.perguntas.every((q, i) => (q.multipla ? pq.sel[i].length > 0 : (pq.sel[i] != null || pq.texto[i].trim() !== '')));
}

function pqDesenha(perg, abrindo) {
  const filho = (tag, classe, texto) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto != null) e.textContent = texto;
    return e;
  };
  const travado = pq.ocupado || !!pq.feito;
  pqEl.textContent = '';
  pqEl.appendChild(filho('strong', 'pc-titulo', AGENTE.nome + ' fez uma pergunta para você'));
  if (!perg) {
    pqEl.appendChild(filho('p', 'pc-texto', 'Não consegui ler a pergunta para mostrar as escolhas aqui. Responda pelo terminal do agente, na aba Sessões.'));
    const sess = $('btnSessoes');
    if (sess && !sess.hidden && sess.getAttribute('href') && sess.getAttribute('href') !== '#') {
      const a = filho('a', 'pc-btn pc-nega pq-link', 'Abrir a aba Sessões');
      a.href = sess.getAttribute('href');
      pqEl.appendChild(a);
    }
    pqEl.hidden = false;
    pqEl.classList.toggle('entra', !!abrindo);
    return;
  }
  pqEl.appendChild(filho('p', 'pc-texto', 'Ele parou até você responder. Mensagens enviadas pelo chat ficam bloqueadas enquanto isso.'));
  const atualizaEnvio = () => { if (pq.btnEnvia) pq.btnEnvia.disabled = travado || !pqCompleto(perg); };
  perg.perguntas.forEach((q, i) => {
    const caixa = filho('fieldset', 'pq-bloco');
    caixa.disabled = travado;
    const leg = filho('legend', 'pq-pergunta');
    if (q.cabecalho) leg.appendChild(filho('span', 'pq-cabecalho', q.cabecalho));
    leg.appendChild(document.createTextNode(q.pergunta));
    caixa.appendChild(leg);
    const campoTexto = q.multipla ? null : filho('input', 'pq-texto');
    q.opcoes.forEach((o, k) => {
      const num = k + 1;
      const rot = filho('label', 'pq-opcao');
      const inp = document.createElement('input');
      inp.type = q.multipla ? 'checkbox' : 'radio';
      inp.name = 'pq-' + i;
      inp.checked = q.multipla ? pq.sel[i].includes(num) : pq.sel[i] === num;
      inp.addEventListener('change', () => {
        if (q.multipla) {
          pq.sel[i] = inp.checked ? pq.sel[i].concat(num).sort((a, b) => a - b) : pq.sel[i].filter(x => x !== num);
        } else {
          pq.sel[i] = num; pq.texto[i] = ''; campoTexto.value = '';
        }
        atualizaEnvio();
      });
      rot.appendChild(inp);
      const txt = filho('span', 'pq-rotulo');
      txt.appendChild(filho('span', 'pq-nome', o.rotulo));
      if (o.descricao) txt.appendChild(filho('span', 'pq-desc', o.descricao));
      rot.appendChild(txt);
      caixa.appendChild(rot);
    });
    if (campoTexto) {
      campoTexto.type = 'text';
      campoTexto.maxLength = 2000;
      campoTexto.placeholder = 'Outra resposta (escreva em uma linha)';
      campoTexto.setAttribute('aria-label', 'Outra resposta para a pergunta ' + (i + 1));
      campoTexto.value = pq.texto[i];
      campoTexto.addEventListener('input', () => {
        pq.texto[i] = campoTexto.value;
        if (campoTexto.value.trim()) {
          pq.sel[i] = null;
          for (const r of caixa.querySelectorAll('input[type=radio]')) r.checked = false;
        }
        atualizaEnvio();
      });
      caixa.appendChild(campoTexto);
    }
    pqEl.appendChild(caixa);
  });
  if (pq.erro) pqEl.appendChild(filho('p', 'pc-erro', pq.erro));
  if (pq.noTerminal) {
    const sess = $('btnSessoes');
    if (sess && !sess.hidden && sess.getAttribute('href') && sess.getAttribute('href') !== '#') {
      const a = filho('a', 'pc-btn pc-nega pq-link', 'Abrir a aba Sessões');
      a.href = sess.getAttribute('href');
      pqEl.appendChild(a);
    }
  }
  const linha = filho('div', 'pc-botoes');
  const envia = filho('button', 'pc-btn pc-aprova', 'Enviar resposta');
  envia.type = 'button';
  envia.addEventListener('click', () => pqEnvia(perg, false));
  const cancela = filho('button', 'pc-btn pc-nega', 'Cancelar pergunta');
  cancela.type = 'button';
  cancela.disabled = travado;
  cancela.addEventListener('click', () => pqEnvia(perg, true));
  pq.btnEnvia = envia;
  linha.appendChild(envia);
  linha.appendChild(cancela);
  pqEl.appendChild(linha);
  atualizaEnvio();
  const msg = pq.feito === 'cancelada' ? 'Pergunta cancelada. Aguardando o agente continuar…'
    : pq.feito ? 'Resposta enviada. Aguardando o agente continuar…'
    : (pq.ocupado ? 'Enviando a sua resposta (leva alguns segundos)…' : '');
  const vivo = filho('p', 'pc-status', msg);
  vivo.setAttribute('role', 'status');
  pqEl.appendChild(vivo);
  pqEl.hidden = false;
  pqEl.classList.toggle('entra', !!abrindo);
}

async function pqEnvia(perg, cancelar) {
  if (pq.ocupado || pq.feito) return;
  if (!cancelar && !pqCompleto(perg)) return;
  const body = cancelar ? { tool_use_id: pq.id, cancelar: true } : {
    tool_use_id: pq.id,
    respostas: perg.perguntas.map((q, i) => (q.multipla ? { opcoes: pq.sel[i] }
      : pq.sel[i] != null ? { opcao: pq.sel[i] } : { texto: pq.texto[i].trim() })),
  };
  pq.ocupado = true; pq.erro = ''; pq.noTerminal = false;
  pqSincroniza();
  try {
    // o servidor espera ~350 ms entre as teclas; várias perguntas somam alguns segundos
    await api(API + '/pergunta', { method: 'POST', body, timeoutMs: 45000 });
    pq.feito = cancelar ? 'cancelada' : 'respondida';
  } catch (e) {
    pq.erro = 'Não consegui ' + (cancelar ? 'cancelar' : 'enviar') + ' a resposta: ' + e.message;
    // Terminal já mexeu na pergunta: o chat não pode mais responder, só o terminal.
    pq.noTerminal = e.codigo === 'PERGUNTA_JA_MEXIDA';
    if (pq.noTerminal && e.dados && e.dados.howToFix) pq.erro += ' ' + e.dados.howToFix;
  } finally {
    pq.ocupado = false;
    pq.chave = '';   // força o redesenho com o resultado
    pqSincroniza();
  }
}

/* Aviso de fila no balão: a mensagem foi entregue ao runner mas o agente ainda não a leu. */
function filaSincroniza() {
  let mudou = false;
  const est = window.atividadeFoto && window.atividadeFoto.agentes ? window.atividadeFoto.agentes[AGENTE.id] : null;
  for (const p of pendentes) {
    if (!p.fila) continue;
    // agente ocioso e a cópia ainda não apareceu: o aviso já não vale
    if (est && est.estado === 'ocioso') { p.fila = null; mudou = true; }
    else mudou = true;
  }
  if (mudou) render();
}

/* O estado de descanso da tela depende do stream: sem ele as mensagens novas
   não chegam sozinhas, e a pessoa precisa ler isso (sem animação nenhuma). */
const ESTADOS_CONEXAO = ['pronto', 'conectando…', 'reconectando…', 'conferindo agente…', 'agente sem sinal', 'esperando a sua permissão', 'esperando a sua resposta'];
function estadoOcioso() {
  if (!streamAberto) return setEstado(jaConectou ? 'reconectando…' : 'conectando…');
  const est = window.atividadeFoto?.agentes?.[AGENTE.id];
  if (!est) return setEstado('conferindo agente…');
  if (est.alerta === 'permissao') return setEstado('esperando a sua permissão');
  if (est.alerta === 'pergunta') return setEstado('esperando a sua resposta');
  if (est.estado === 'trabalhando') return setEstado('trabalhando');
  setEstado(est.estado === 'sem_sinal' ? 'agente sem sinal' : 'pronto', est.estado === 'sem_sinal');
}

/* Ociosa = nada do ciclo em curso. Os estados de trabalho terminam em
   reticências ("gravando…", "esperando o agente…", "transcrevendo…") ou em
   porcentagem ("enviando 40%"); os de conexão também têm reticências, por isso
   entram como exceção. Assim o "reconectando…" nunca pisa num estado de trabalho. */
function telaOciosa() {
  if (gravando || falando) return false;   // esperar a resposta não prende o estado (18/10/2026)
  const t = estadoEl.textContent;
  return ESTADOS_CONEXAO.includes(t) || !/(…|%)$/.test(t);
}

function faixa(el, txt) {
  el.classList.remove('ok', 'leve');
  el.style.left = el.style.width = el.style.right = ''; el.title = '';
  // botões de uma faixa anterior (ex.: "Tentar de novo") não valem pro texto novo
  const acoes = el.querySelector('.acoes');
  if (acoes) acoes.remove();
  el.querySelector('.txt').textContent = txt || '';
  el.classList.toggle('aparece', !!txt);
  respiroDasFaixas();
}

/* As faixas flutuam sobre o fim da thread e escondiam o balão de baixo (no
   celular, o botão "reenviar" ficava embaixo da faixa de erro). O #wrap ganha
   um respiro do tamanho das faixas visíveis, e a thread desce junto se já
   estava no fim. */
function respiroDasFaixas() {
  let altura = 0;
  for (const f of [fErro, fAviso]) {
    if (f.classList.contains('aparece')) altura += f.offsetHeight + 8;
  }
  // a faixa do áudio pendente (05/10/2026) fica em cima das outras duas
  const fa = document.getElementById('faixaAudio');
  if (fa) {
    fa.style.bottom = '';
    if (fa.classList.contains('aparece')) {
      let topo = Infinity;
      for (const f of [fErro, fAviso]) {
        if (f.classList.contains('aparece')) topo = Math.min(topo, f.getBoundingClientRect().top);
      }
      if (topo !== Infinity) fa.style.bottom = Math.round(window.innerHeight - topo + 8) + 'px';
      altura += fa.offsetHeight + 8;
    }
  }
  wrap.style.paddingBottom = altura ? altura + 'px' : '';
  posicionaSeta();
}
const mostraErro = t => faixa(fErro, t);
fErro.querySelector('.x').onclick = () => faixa(fErro, '');

/* Aviso amarelo fechado no ✕ descansa 48 h (a cota de voz voltava toda hora). Passou o prazo
   e o problema continua, ele volta. Sem localStorage, o aviso só deixa de ser silenciado.
   Não confundir com fechaAviso, que é outra coisa. */
const CHAVE_DESCANSO = 'dgclaw:avisos-fechados';
function avisosFechados() {
  try { return JSON.parse(localStorage.getItem(CHAVE_DESCANSO) || '{}') || {}; }
  catch (e) { return {}; }
}
function fechaFaixaAviso() {
  const t = fAviso.querySelector('.txt').textContent;
  if (t) {
    try { localStorage.setItem(CHAVE_DESCANSO, JSON.stringify(PURO.registraFechamento(avisosFechados(), t, Date.now()))); }
    catch (e) { console.warn('aviso: não consegui guardar o fechamento (' + e.message + ')'); }
  }
  faixa(fAviso, '');
}
const mostraAviso = t => {
  if (t && PURO.avisoDescansando(avisosFechados(), t, Date.now())) return;
  faixa(fAviso, t);
};
fAviso.querySelector('.x').onclick = () => {
  // fechar o aviso de conversa pesada vale como "Agora não" (senão ele volta na próxima resposta)
  if (fAviso.classList.contains('leve')) { const b = Array.from(fAviso.querySelectorAll('.acoes button')).pop(); if (b) { b.click(); return; } }
  fechaFaixaAviso();
};

/* Avisos que vêm da thread (ex.: "Nenhum transcript...") valem enquanto o
   servidor manda. Lista vazia limpa a faixa, mas só se o que está nela é o aviso
   da thread: aviso de TTS ou de cota fica. O mesmo aviso repetido não reabre a
   faixa que foi fechada no ✕. */
function trataAvisosThread(avisos) {
  if (!Array.isArray(avisos)) return;
  if (avisos.length) {
    if (avisos[0] !== avisoThread) { avisoThread = avisos[0]; mostraAviso(avisoThread); }
    return;
  }
  if (avisoThread !== null && fAviso.querySelector('.txt').textContent === avisoThread) {
    mostraAviso('');
  }
  avisoThread = null;
}

/* O formatador (links, negrito, tabelas, blocos de código com cor, .md do visor) fica em formatador.js
   desde 25/10/2026, usado também pela Pasta do agente. */
const { linkify, formata, ehDiff, SINTAXE_NOME, htmlSintaxe, htmlDiff, ICONE_COPIAR, textoEmParagrafos, RX_LINHA_TAB, htmlTabela, paragrafos, mdComTitulos } = window.DGFormatador; // formatador.js
const ICO_VISUAL = '<svg class="ico-vis" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9h17"/></svg>';

const ROTULO_MIDIA = { photo: '📷 foto', video: '🎬 vídeo',
                       document: '📄 arquivo', voice: '🎤 áudio',
                       audio: '🎤 áudio' };

/* Mídia da thread por id, pro lightbox achar o que abrir sem reconsultar a API. */
const midias = {};

function tamanhoHumano(n) {
  if (!n && n !== 0) return '';
  const mb = n / (1024 * 1024);
  if (mb < 0.1) return Math.round(n / 1024) + ' KB';
  return (mb < 1 ? mb.toFixed(2) : mb.toFixed(1)).replace('.', ',') + ' MB';
}

/* O balão da mídia. Áudio toca ali mesmo (é o uso número um: ouvir o que o agente
   mandou); foto, vídeo e PDF abrem no lightbox ao toque. */
function htmlMidia(m) {
  const md = m.media;
  if (!md) return '';
  midias[md.id] = md;
  const rot = ROTULO_MIDIA[md.kind] || '📄 arquivo';
  if (!md.disponivel) {
    return `<span class="midoff">${rot} (o arquivo não está mais disponível)` +
           `<br><small>${esc(md.nome || '')}</small></span>`;
  }
  if (ehVisual(md)) return htmlVisual(m, md);
  if (md.kind === 'audio' || md.kind === 'voice') {
    // data-aud: é por ele que o render reconhece o player que já está tocando e
    // reaproveita o mesmo nó, em vez de criar outro do zero a cada poll.
    return `<span class="midaudio combx"><audio controls playsinline preload="none" ` +
           `data-aud="${esc(md.id)}" src="${esc(md.url)}"></audio>${botaoBaixaMidia(md, rot)}</span>`;
  }
  if (md.kind === 'document' && !md.thumb && !/\.pdf$/i.test(md.nome || '')) {
    // texto, .md e código abrem no leitor: o olho ao lado do baixar deixa isso à vista
    const ver = ehTextoLegivel(md) ? `<button type="button" class="midver" data-mid="${esc(md.id)}" title="Ver ${esc(md.nome || '')}" aria-label="Ver o arquivo">${ICO_VER}</button>` : '';
    return `<span class="midcx cxarq${ver ? ' comver' : ''}">${cartaoArquivo(md, md.id)}${ver}${botaoBaixaMidia(md, rot)}</span>`;
  }
  const legenda = esc(md.nome || '') + (md.bytes ? ' (' + tamanhoHumano(md.bytes) + ')' : '');
  if (md.thumb) {
    return `<span class="midcx"><button class="mid" data-mid="${esc(md.id)}" aria-label="Abrir ${rot}">` +
           `<img loading="lazy" alt="${rot}" src="${esc(md.thumb)}" ` +
           `onerror="semThumb(this)">` +
           `<span class="midfb">${rot} ${legenda}</span>` +
           (md.kind === 'video' ? '<span class="play" aria-hidden="true">▶</span>' : '') +
           `<span class="lupa">${md.kind === 'video' ? 'vídeo' : 'toque para abrir'}</span></button>` +
           `${botaoBaixaMidia(md, rot)}</span>`;
  }
  // sem miniatura (PDF, por exemplo): o mesmo cartão de arquivo, com o selo do tipo
  return `<span class="midcx cxarq">${cartaoArquivo(md, md.id)}${botaoBaixaMidia(md, rot)}</span>`;
}

/* Cartão de arquivo que não é mídia (zip, planilha, texto, código...): ícone pelo tipo,
   nome como texto comum (outras partes da tela leem e mascaram o texto do balão, então
   o nome não pode ficar só em atributo) e "tamanho · TIPO". */
function extDe(nome) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(nome || '');
  return m ? m[1].toLowerCase() : '';
}
// selo do tipo (PDF, XLSX...) com a cor discreta da família do arquivo, no lugar do emoji
const FAMILIA_ARQ = [
  ['pdf', /^pdf$/], ['planilha', /^(xlsx|xls|csv|tsv|ods|numbers)$/], ['texto', /^(docx?|odt|rtf|txt|md|pages)$/],
  ['slide', /^(pptx?|key|odp)$/], ['zip', /^(zip|rar|7z|tar|gz|tgz|bz2|xz)$/],
  ['codigo', /^(js|mjs|cjs|ts|tsx|jsx|py|sh|bash|json|html?|css|ya?ml|xml|sql|toml|ini|rb|go|rs|java|c|cpp|h|php|ipynb)$/],
];
function cartaoArquivo(md, mid) {
  const ext = extDe(md.nome);
  const fam = (FAMILIA_ARQ.find(i => i[1].test(ext)) || ['outro'])[0];
  const ic = `<span class="selo-arq ${fam}">${esc((ext || 'arq').slice(0, 4).toUpperCase())}</span>`;
  const info = [md.bytes ? tamanhoHumano(md.bytes) : '', ext ? ext.toUpperCase() : 'ARQUIVO']
    .filter(Boolean).join(' · ');
  const abre = mid ? ` data-mid="${esc(mid)}"` : '';
  const tag = mid ? 'button' : 'span';
  return `<${tag} class="cartaoarq"${abre}>` +
         `<span class="cartaoarq-ic" aria-hidden="true">${ic}</span>` +
         `<span class="cartaoarq-txt"><span class="cartaoarq-nome">${esc(md.nome || 'arquivo')}</span>` +
         `<span class="cartaoarq-info">${esc(info)}</span></span></${tag}>`;
}

/* O ⬇ de todo anexo da thread: um link com `download`, FORA do botão da mídia
   (botão dentro de botão não vale). */
const ICO_VER = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
function botaoBaixaMidia(md, rot) {
  return `<a class="midbx" href="${esc(md.url)}" download="${esc(md.nome || '')}" ` +
         `title="Baixar ${esc(md.nome || '')}" aria-label="Baixar ${rot.replace(/^\S+\s/, '')}">` +
         '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg></a>';
}

/* Miniatura que não veio (documento que não é PDF, ou geração falhou): o balão
   vira uma linha com o nome do arquivo, e o toque continua abrindo. */
function semThumb(img) {
  const caixa = img.closest('.mid');
  if (caixa) caixa.classList.add('semthumb');
}
window.semThumb = semThumb;

/* As prévias do balão otimista com vários anexos (já subiram; falta a mensagem
   sair e a cópia de verdade voltar na thread). */
function htmlAnexosLocal(lista) {
  const itens = lista.map(a => {
    if (a.previa && a.kind === 'photo') {
      return `<span class="mid"><img alt="${esc(a.nome)}" src="${a.previa}"></span>`;
    }
    if (a.previa && a.kind === 'video') {
      return `<span class="mid"><video src="${a.previa}" muted playsinline ` +
             `preload="metadata"></video></span>`;
    }
    if (a.kind === 'document' && !/\.pdf$/i.test(a.nome || '')) {
      return cartaoArquivo({ nome: a.nome, bytes: a.bytes }, null);
    }
    return `<span class="midoff">${ROTULO_MIDIA[a.kind] || '📄 arquivo'} ` +
           `${esc(a.nome || '')} (${tamanhoHumano(a.bytes)})</span>`;
  });
  return `<span class="midgrade${lista.length > 1 ? ' varios' : ''}">${itens.join('')}</span>`;
}

/* Chama a API e traduz falha em mensagem que se lê. Nunca deixa erro mudo.
   opt.timeoutMs: no iPhone em segundo plano o fetch pode ficar pendurado pra
   sempre sem erro nenhum; o AbortController transforma isso em falha legível. */
async function api(url, opt) {
  opt = opt || {};
  const init = { cache: 'no-store', method: opt.method || 'GET' };
  if (opt.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(opt.body);
  }
  let ctl = null, relogio = null;
  if (opt.timeoutMs) {
    ctl = new AbortController();
    init.signal = ctl.signal;
    relogio = setTimeout(() => ctl.abort(), opt.timeoutMs);
  }
  const estourou = () => ctl && ctl.signal.aborted;
  const msgEstouro = () => 'o app não respondeu em ' + Math.round(opt.timeoutMs / 1000) + ' s';
  try {
    let r;
    try {
      r = await fetch(url, init);
    } catch (e) {
      if (estourou()) throw new Error(msgEstouro());
      throw new Error('o app não respondeu (' + (e.message || 'sem rede') + ')');
    }
    if (r.status === 401) {
      location.href = '/login?next=' + encodeURIComponent(AQUI);
      throw new Error('sessão expirada');
    }
    let d = null;
    try { d = await r.json(); } catch (e) { d = null; }
    // o corpo pode ter sido cortado pelo abort no meio da leitura
    if (estourou()) throw new Error(msgEstouro());
    if (!r.ok || (d && d.ok === false)) {
      const erro = new Error((d && d.erro) || ('a API respondeu ' + r.status));
      erro.status = r.status; erro.codigo = d && d.codigo; erro.dados = d;   // comandos de barra leem isto
      throw erro;
    }
    return d || {};
  } finally {
    if (relogio) clearTimeout(relogio);
  }
}

/* ── Thread ───────────────────────────────────────────────────────────────── */
/* Renderização por chave: cada nó da thread (separador de dia, mensagem,
   balão otimista) guarda o HTML com que foi montado. Nó com o mesmo HTML é o
   MESMO elemento de antes, então o <audio> que está tocando nem sabe que houve
   render (foi o bug de 20/09: trocar o innerHTML inteiro matava o áudio). */
const nosThread = new Map();   // chave -> { html, el }
const modelo = document.createElement('template');

function criaNo(html) {
  modelo.innerHTML = html;
  return modelo.content.firstElementChild;
}

/* Nó refeito (a mensagem mudou) com um áudio em uso dentro: o player vivo vai
   pro nó novo no lugar do player recém-criado. Um <audio> fora do documento
   continua tocando, então a troca não interrompe o som. */
function transplantaAudio(velho, novo) {
  for (const el of velho.querySelectorAll('audio[data-aud]')) {
    if (el.ended || (el.paused && el.currentTime === 0)) continue;
    const alvo = novo.querySelector('audio[data-aud="' + CSS.escape(el.dataset.aud) + '"]');
    if (alvo) alvo.replaceWith(el);
  }
}

/* Três estados do balão otimista. 'enviada' fica como "✓ hh:mm" até a cópia
   real aparecer (e para sempre, se ela não vier: a mensagem foi entregue).
   'falhou' não some sozinho: a pessoa decide se reenvia ou descarta. */
function metaPendente(p) {
  if (p.estado === 'enviada') {
    if (p.fila && TR) {
      const est = window.atividadeFoto && window.atividadeFoto.agentes ? window.atividadeFoto.agentes[AGENTE.id] : null;
      const t = TR.textoFila(p.fila, !!est && est.alerta === 'permissao');
      if (t) return `<span class="meta fila" title="entregue ao agente, que ainda não chegou nela">✓ ${esc(p.hhmm)} · ${esc(t)}</span>`;
    }
    return `<span class="meta" title="entregue">✓ ${esc(p.hhmm)}</span>`;
  }
  if (p.estado === 'falhou' && p.recusado) {   // comando recusado: reenviar daria o mesmo erro
    return `<span class="meta"><span style="color:#c0392b;font-weight:600">recusado</span> ` +
           `${esc(p.erro || 'motivo desconhecido')} ` +
           `<button class="mini descartar" data-pend="${p.n}">descartar</button></span>`;
  }
  if (p.estado === 'falhou') {
    const ocupado = p.conferindo ? ' disabled' : '';
    return `<span class="meta"><span style="color:#c0392b;font-weight:600" ` +
           `title="${esc(p.erro || 'motivo desconhecido')}">não foi enviada</span> ` +
           `<button class="mini reenviar" data-pend="${p.n}"${ocupado}>reenviar</button> ` +
           `<button class="mini descartar" data-pend="${p.n}"${ocupado}>descartar</button></span>`;
  }
  if (p.estado === 'fila') {
    return '<span class="meta" title="sai assim que a parte anterior chegar">na fila…</span>';
  }
  return '<span class="meta">enviando…</span>';
}

/* A legenda que só repete o tipo ("📷 foto" embaixo da foto) não aparece. */
function legendaUtil(m) {
  if (!m.text) return '';
  if (m.media && Object.values(ROTULO_MIDIA).includes(m.text)) return '';
  return m.text;
}

/* Selo do canal: só WhatsApp e Telegram levam; "plataforma" (o próprio painel) é o normal e fica sem. */
const CANAIS_SELO = { whatsapp: 'WhatsApp', telegram: 'Telegram' };
function htmlSelo(m) {
  const nome = CANAIS_SELO[m.via];
  if (!nome) return '';
  const dono = ehDono(m);
  const num = dono && m.via === 'whatsapp' && m.quem && /^\+?\d[\d ()-]*$/.test(m.quem) ? ' (número ' + m.quem + ')' : '';
  const dica = dono ? 'Mensagem que veio pelo ' + nome + num : 'Resposta enviada pelo ' + nome;
  return `<span class="selo-canal ${esc(m.via)}" title="${esc(dica)}">${esc(nome)}</span>`;
}

/* Mensagem que o dono mandou pelo toque num visual começa com
   "[do visual <titulo>] ". Na tela vira uma etiqueta e o texto sem o prefixo; o
   texto bruto (m.text) não muda, porque o casamento com o pendente compara ele. */
function separaDoVisual(txt) {
  const r = /^\[do visual ([^\]\n]*)\] ([\s\S]*)$/.exec(String(txt || ''));
  return r ? { titulo: r[1].trim(), texto: r[2] } : null;
}

/* Hora discreta embaixo do balão, em linguagem de gente ("agora", "há 5 min", "ontem, 20:24").
   O HTML leva só a hora fixa e o ep: o texto humano é posto no DOM por humanizaHoras(), assim
   o render continua reaproveitando o nó (o HTML não muda a cada minuto). */
/* ✓ entregue / ✓✓ azul lido, como no WhatsApp, nas mensagens do dono (18/10/2026): "lido" é o
   agente ter feito algo depois dela (respondido ou rodado um comando). lidoAteEp vem do render. */
let lidoAteEp = 0;
// até onde VOCÊ já viu as mensagens do agente neste aparelho (as do agente ganham ✓ / ✓✓ também)
let vistoAteEp = 0;
try { vistoAteEp = Number(localStorage.getItem('dgclaw-visto-ate:' + AGENTE.id)) || 0; } catch (_) { /* sem storage */ }
const CHECK_1 = '<svg viewBox="0 0 16 11" width="15" height="11" aria-hidden="true"><path d="M1.5 5.8l3 3L11 2.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHECK_2 = '<svg viewBox="0 0 20 11" width="18" height="11" aria-hidden="true"><path d="M1.5 5.8l3 3L11 2.2M7.5 8.6l.4.2L15 2.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function htmlHora(m, extra) {
  if (!m || m.pendente || typeof m.ep !== 'number') return '';
  const hora = `<span class="hora" data-ep="${m.ep}" title="${esc(m.dia + ' ' + m.hhmm)}">` +
               `${m.editada ? 'editada · ' : ''}${esc(m.hhmm)}</span>`;
  const lido = ehDono(m) ? lidoAteEp >= m.ep : vistoAteEp >= m.ep;
  if (!ehDono(m)) {
    return `<span class="hora-cx">${hora}<span class="checks${lido ? ' lido' : ''}" data-ep-chk="${m.ep}" title="${lido ? 'você viu' : 'chegou, você ainda não viu'}" ` +
           `aria-label="${lido ? 'vista por você' : 'não vista'}">${lido ? CHECK_2 : CHECK_1}</span></span>`;
  }
  return `<span class="hora-cx">${hora}<span class="checks${lido ? ' lido' : ''}" title="${lido ? 'lida pelo agente' : 'entregue ao agente'}" ` +
         `aria-label="${lido ? 'lida' : 'entregue'}">${lido ? CHECK_2 : CHECK_1}</span></span>`;
}
function horaHumana(ep, agora) {
  const s = Math.max(0, agora / 1000 - ep);
  if (s < 60) return 'agora';
  if (s < 3600) return 'há ' + Math.floor(s / 60) + ' min';
  const d = new Date(ep * 1000), h = new Date(agora);
  const hhmm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const meiaNoite = new Date(h.getFullYear(), h.getMonth(), h.getDate()).getTime() / 1000;
  if (ep >= meiaNoite) return s < 6 * 3600 ? 'há ' + Math.floor(s / 3600) + ' h' : 'hoje, ' + hhmm;
  if (ep >= meiaNoite - 86400) return 'ontem, ' + hhmm;
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + ', ' + hhmm;
}
function humanizaHoras() {
  const agora = Date.now();
  for (const el of wrap.querySelectorAll('.hora[data-ep]')) {
    const txt = (el.textContent.startsWith('editada · ') ? 'editada · ' : '') + horaHumana(Number(el.dataset.ep), agora);
    if (el.textContent !== txt) el.textContent = txt;
  }
}
setInterval(humanizaHoras, 30000);

const RX_LINHA_TAREFA = /^📋 Tarefa #(\d+) da Mesa:[^\n]*\n?/m;
const RX_LINK_TAREFA = /(?:https?:\/\/[^\s/]+)?\/mesa(?:\?[^\s#]*)?#t(\d+)\b/g;
const tarefasCache = new Map();   // n -> tarefa | null (não existe) ; ausente = ainda não buscou
function htmlTarefaCartao(n) {
  const t = tarefasCache.get(String(n));
  if (!t) return `<span class="tf-k">▦ Tarefa do Board · #${esc(n)}</span><b>${t === null ? 'Tarefa não encontrada' : 'Carregando…'}</b>`;
  const est = { fazendo: 'fazendo', esperando_dono: 'esperando você', travada: 'travada', concluida: 'concluída', cancelada: 'cancelada' }[t.estado] || t.estado || '';
  const ag = (agentesMenu.find(a => a.id === t.agente) || {}).nome || t.agente || '';
  return `<span class="tf-k">▦ Tarefa do Board · #${esc(n)}${est ? ' · ' + esc(est) : ''}</span><b>${esc(t.titulo || '')}</b>` +
    `<small>${esc([ag, t.progresso != null ? t.progresso + '%' : '', t.nota || ''].filter(Boolean).join(' · '))}</small>`;
}
async function preencheTarefas() {
  const els = wrap.querySelectorAll('.tf-cartao[data-tarefa]');
  const faltam = new Set();
  for (const el of els) { const n = el.dataset.tarefa; if (tarefasCache.has(n)) el.innerHTML = htmlTarefaCartao(n); else faltam.add(n); }
  for (const n of faltam) {
    tarefasCache.set(n, undefined);
    try {
      const r = await fetch('/api/v1/tarefas/' + encodeURIComponent(n), { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const d = r.ok ? await r.json() : null;
      tarefasCache.set(n, d ? (d.tarefa || d) : null);
    } catch (_) { tarefasCache.delete(n); continue; }
    wrap.querySelectorAll('.tf-cartao[data-tarefa="' + n + '"]').forEach(el => { el.innerHTML = htmlTarefaCartao(n); });
  }
}
/* Aviso do cofre ("[cofre] NOME guardada (final 1a2b)."): a mensagem que o campo de senha manda ao
   agente depois de guardar. Na tela vira a etiqueta "do cofre" e o texto sem o prefixo; nunca
   leva o valor da chave, só o nome e o final. */
function separaDoCofre(txt) {
  const r = /^\[cofre\] ([\s\S]*)$/.exec(String(txt || ''));
  return r ? { texto: r[1] } : null;
}

function htmlCorpo(m) {
  let midia = '';
  if (m.local && m.local.anexos) {
    midia = htmlAnexosLocal(m.local.anexos);
  } else if (m.media) {
    midia = htmlMidia(m);
  } else if (m.kind && m.kind !== 'text' && ROTULO_MIDIA[m.kind]) {
    // veio marcado como mídia e o arquivo não chegou até aqui: o rótulo explica o que era
    midia = `<span class="midia">${ROTULO_MIDIA[m.kind]} (não baixada)</span>`;
  }
  // a marca de áudio transcrito é para o agente: na tela vira um microfone discreto junto da hora
  const citaDono = !!m.cita && ehDono({ origin: m.cita.origin });
  const cita = m.cita ? `<div class="cita"${m.cita.id ? ` role="button" tabindex="0" data-ir-msg="${esc(m.cita.id)}" title="Ir até a mensagem citada"` : ''}><b>${citaDono ? 'Você' :
      esc(AGENTE.nome)}</b>${esc(citaDono ? PURO.separaAudio(m.cita.texto).texto : m.cita.texto)}</div>` : '';
  let leg = legendaUtil(m);
  let viaAudio = false;
  if (leg && ehDono(m)) {
    const sa = PURO.separaAudio(leg);
    viaAudio = sa.audio;
    leg = sa.texto;
  }
  // tarefa da Mesa citada (19/10/2026, ideia 4): a linha "📋 Tarefa #N da Mesa: ..." vira cartão, e todo
  // link /mesa#tN do texto ganha o cartão embaixo
  const tarefas = [];
  if (leg) {
    leg = String(leg).replace(RX_LINHA_TAREFA, (_, n) => { tarefas.push(n); return ''; }).trim();
    for (const r of String(leg).matchAll(RX_LINK_TAREFA)) if (!tarefas.includes(r[1])) tarefas.push(r[1]);
  }
  const cartoesTarefa = tarefas.slice(0, 4).map(n => `<a class="tf-cartao" href="/mesa#t${n}" data-tarefa="${n}">${htmlTarefaCartao(n)}</a>`).join('');
  let doVisual = '';
  const dv = ehDono(m) ? separaDoVisual(leg) : null;
  if (dv) {
    leg = dv.texto;
    doVisual = `<div class="dovisual">${ICO_VISUAL} do visual${dv.titulo ? ': ' + esc(dv.titulo) : ''}</div>`;
  }
  const dc = !dv && ehDono(m) ? separaDoCofre(leg) : null;
  if (dc) {
    leg = dc.texto;
    doVisual = `<div class="dovisual">🔑 do cofre</div>`;
  }
  // [ver a criação] só vira botão em mensagem de quem não é o dono (o texto já sai escapado de paragrafos)
  let htmlLeg = leg ? paragrafos(leg, m.fmt) : '';
  if (htmlLeg && !ehDono(m) && window.DGOnboarding && window.DGOnboarding.marcadorParaBotao) htmlLeg = window.DGOnboarding.marcadorParaBotao(htmlLeg);
  const corpo = leg ? doVisual + htmlLeg : doVisual;
  const reac = (m.reacoes && m.reacoes.length)
    ? `<span class="reac">${m.reacoes.map(esc).join(' ')}</span>` : '';
  // a hora das mensagens já entregues fica fora do balão (htmlHora); a do pendente segue dentro
  const meta = m.pendente ? metaPendente(m.local) : '';
  const viaAudioHtml = viaAudio ? '<span class="via-audio" title="Falado e transcrito automaticamente"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></span>' : '';
  return htmlSelo(m) + cita + midia + cartoesTarefa + corpo + reac + viaAudioHtml + meta;
}

/* Trilha de comandos: o que a pessoa abriu (resumo ou passo) continua aberto quando a lista cresce
   (trilhaAbertas). O texto vem do servidor já mascarado e cortado, e entra sempre escapado. */
const trilhaAbertas = new Set();
/* "Fez 5 passos em 2 min": os passos de um pedido, recolhidos (abre com um toque). O tempo vai da fala
   do dono até a última coisa do agente naquele pedido. */
function htmlResumoPassos(itens, todas) {
  const id = itens[0].id;
  const iniDono = todas.reduce((a, x) => (ehDono(x) && typeof x.ep === 'number' && x.ep <= itens[0].ep && x.ep > a ? x.ep : a), 0);
  const ultimo = itens[itens.length - 1];
  let fim = ultimo.ep;
  for (const x of todas) {
    if (typeof x.ep !== 'number' || x.ep <= ultimo.ep) continue;
    if (ehDono(x)) break;
    fim = x.ep;
  }
  const ini = iniDono || itens[0].ep;
  const erros = itens.filter(i => i.trilha.erro).length;
  const rot = `Fez ${itens.length === 1 ? '1 passo' : itens.length + ' passos'}${fim - ini >= 1 ? ' em ' + TR.duracao(fim - ini) : ''}` +
    (erros ? ` · ${erros === 1 ? '1 falhou' : erros + ' falharam'}` : '');
  return `<div class="row her trilha" data-msg="${esc(id)}"><details class="pg-resumo${erros ? ' erro' : ''}" data-tl="${esc(id)}"${trilhaAbertas.has(id) ? ' open' : ''}>` +
    `<summary>${erros ? IC_FALHOU : IC_FEITO}<span>${esc(rot)}</span>${SETA_BAIXO}</summary>` +
    `<ul class="pg-passos">${htmlPassos(itens, fim)}</ul></details></div>`;
}
/* Resultado de um comando de barra (/context, /cost...): o que o terminal respondeu, num bloco fechado
   do lado do agente. O texto vem do servidor e entra sempre escapado. */
const comandoAbertos = new Set();
function htmlResultadoComando(m) {
  const erro = m.comando && m.comando.saida === 'stderr';
  const texto = String(m.text || '').trim();
  return `<div class="row her comando" data-msg="${esc(m.id)}"><details data-cmd="${esc(m.id)}"${comandoAbertos.has(m.id) ? ' open' : ''}>` +
    `<summary>resultado do comando<span class="tl-hora">${esc(m.hhmm)}</span></summary>` +
    `<pre class="cmd-saida${erro ? ' erro' : ''}">${texto ? esc(texto) : 'sem texto de saída'}</pre></details></div>`;
}
wrap.addEventListener('toggle', ev => {
  const d = ev.target;
  if (!d || !d.dataset || !d.dataset.cmd) return;
  if (d.open) comandoAbertos.add(d.dataset.cmd); else comandoAbertos.delete(d.dataset.cmd);
}, true);
wrap.addEventListener('toggle', ev => {
  const d = ev.target;
  if (!d || !d.dataset || !d.dataset.tl) return;
  if (d.open) trilhaAbertas.add(d.dataset.tl); else trilhaAbertas.delete(d.dataset.tl);
}, true);

/* Fotos do dono no estilo do ChatGPT (17/10/2026): miniaturas quadradas lado a lado,
   fora do balão, e o texto (se houver) num balão logo abaixo. Só foto e vídeo com
   miniatura; o resto continua no balão de sempre. */
function fotoDoDono(m) {
  return !!(m && ehDono(m) && !m.pendente && m.media && m.media.disponivel && m.media.thumb &&
            !ehVisual(m.media) && (m.media.kind === 'photo' || m.media.kind === 'image' || m.media.kind === 'video'));
}
/* Imagens que o agente manda em sequência (19/10/2026): um carrossel, com a legenda de cada uma */
function fotoDoAgente(m) {
  return !!(m && !ehDono(m) && m.media && m.media.disponivel && m.media.thumb && !ehVisual(m.media) &&
            (m.media.kind === 'photo' || m.media.kind === 'image'));
}
function htmlFotosAgente(grupo, troca) {
  const n = grupo.length;
  const slides = grupo.map((m, i) => {
    const md = m.media; midias[md.id] = md;
    const leg = legendaUtil(m);
    return `<div class="dg-car-sl" data-msg="${esc(m.id)}"><span class="midcx"><button class="mid" data-mid="${esc(md.id)}" aria-label="Abrir a imagem ${i + 1} de ${n}">` +
      `<img loading="lazy" alt="" src="${esc(md.url || md.thumb)}" onerror="this.src='${esc(md.thumb)}'"></button></span>` +
      `<div class="dg-car-tx"><div class="dg-car-k">${i + 1} de ${n}</div>${leg ? `<div class="dg-car-d">${esc(leg)}</div>` : ''}</div></div>`;
  });
  const ultimo = grupo[n - 1];
  return `<div class="row her${troca}" data-msg="${esc(grupo[0].id)}"><div class="bub">${window.dgui.htmlCarrossel(slides, 'dg-car-fotos')}</div>${htmlAcoes(ultimo, htmlHora(ultimo))}</div>`;
}
function htmlFotosDono(grupo, troca) {
  const fotos = grupo.map(m => `<span class="mfoto-item" data-msg="${esc(m.id)}">${htmlMidia(m)}</span>`).join('');
  const textos = grupo.map(m => {
    const leg = legendaUtil(m);
    return leg ? paragrafos(leg, m.fmt) : '';
  }).filter(Boolean).join('');
  return `<div class="row me mfotos-row${troca}" data-msg="${esc(grupo[0].id)}">` +
         `<div class="mfotos">${fotos}</div>` +
         (textos ? `<div class="bub">${textos}</div>` : '') + htmlHora(grupo[grupo.length - 1]) + '</div>';
}

/* Ações embaixo de cada resposta do agente, como no ChatGPT: copiar e ouvir. */
const ICONE_ACAO = {
  copiar: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/></svg>',
  ok:     '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  ouvir:  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  bom: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10v10H4.5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM7 10l4-7a2.2 2.2 0 0 1 2.6 2.6L13 9h5.4a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.2 20H7"/></svg>',
  ruim: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 14V4h2.5a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1zM17 14l-4 7a2.2 2.2 0 0 1-2.6-2.6L11 15H5.6a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 6.8 4H17"/></svg>',
  responder: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H12"/></svg>'
};
/* 👍 / 👎 (19/10/2026, ideia 5): discretos, no estilo do ChatGPT. O voto fica no servidor (vale em todo
   aparelho) e vira recado ao agente: 👍 ele guarda o que funcionou; 👎 ele pergunta o que melhorar. */
let votos = {};
api(API + '/feedback').then(d => { votos = (d && d.votos) || {}; if (carregouUmaVez) render({ semRolar: true }); }).catch(() => {});
async function vota(m, tipo) {
  const novo = votos[m.id] === tipo ? '' : tipo;
  const antes = votos[m.id];
  if (novo) votos[m.id] = novo; else delete votos[m.id];
  render({ semRolar: true });
  try { await api(API + '/feedback', { method: 'POST', body: { mensagem: m.id, tipo: novo } }); }
  catch (e) { if (antes) votos[m.id] = antes; else delete votos[m.id]; render({ semRolar: true }); mostraErro('Não consegui registrar: ' + e.message); }
}
function htmlAcoes(m, hora) {
  hora = hora || '';
  if (!m || m.pendente || !legendaUtil(m) || ehVisual(m.media)) return hora ? `<div class="acoes so-hora">${hora}</div>` : '';
  return chipMemoria(m) + `<div class="acoes" data-acoes="${esc(m.id)}">` +
         `<button type="button" class="ac" data-ac="copiar" title="Copiar" aria-label="Copiar a resposta">${ICONE_ACAO.copiar}</button>` +
         `<button type="button" class="ac ac-ouvir" data-ac="ouvir" title="Ouvir em voz alta" aria-label="Ouvir a resposta em voz alta">${ICONE_ACAO.ouvir}</button>` +
         `<button type="button" class="ac${respondendo && respondendo.id === m.id ? ' acao-resp-on' : ''}" data-ac="responder" title="Responder citando" aria-label="Responder citando esta mensagem">${ICONE_ACAO.responder}</button>` +
         (m.origin === 'agente' ? `<button type="button" class="ac ac-voto${votos[m.id] === 'bom' ? ' on' : ''}" data-ac="bom" title="Boa resposta" aria-label="Boa resposta" aria-pressed="${votos[m.id] === 'bom'}">${ICONE_ACAO.bom}</button>` +
           `<button type="button" class="ac ac-voto${votos[m.id] === 'ruim' ? ' on' : ''}" data-ac="ruim" title="Resposta ruim" aria-label="Resposta ruim" aria-pressed="${votos[m.id] === 'ruim'}">${ICONE_ACAO.ruim}</button>` : '') +
         hora + extrasDaResposta(m) + '</div>' + detalhesDaResposta(m);
}
/* Memória e tokens de cada resposta (20/10/2026, proposta B do dono). O servidor manda em m.memorias
   ([{tipo, texto}]: o que o agente guardou na memória durante esta resposta) e m.uso ({entrada, cache,
   saida, ms}). Na linha das ações: um cérebro com o número de memórias e, à direita, um ⓘ. Cada um abre um
   bloco logo abaixo; a escolha de aberto sobrevive ao redesenho. */
const memAbertas = new Set(), infoAbertas = new Set();
const ICO_MEMORIA = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4.5a3 3 0 0 0-3 3 3 3 0 0 0-1.5 5.3A3 3 0 0 0 8 18a2.5 2.5 0 0 0 4 1.5V5.5A2.5 2.5 0 0 0 9 4.5zM15 4.5a3 3 0 0 1 3 3 3 3 0 0 1 1.5 5.3A3 3 0 0 1 16 18a2.5 2.5 0 0 1-4 1.5"/></svg>';
const ICO_INFO = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';
function numCurto(n) {
  if (!Number.isFinite(n)) return '–';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 2).replace('.', ',').replace(/,?0+$/, '') + ' mi';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace('.', ',').replace(/,0$/, '') + ' mil';
  return String(n);
}
function dolar(v) {
  return 'US$ ' + v.toFixed(v >= 10 ? 0 : 2).replace('.', ',');
}
function duracao(ms) {
  if (!Number.isFinite(ms)) return '';
  const s = Math.round(ms / 1000);
  return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min' + (s % 60 ? ' ' + (s % 60) + ' s' : '');
}
/* Opção A (o dono trocou de B para A em 20/10/2026): "2 memórias" é um chip numa linha logo abaixo da
   resposta (o toque abre o que foi guardado), e os tokens ficam sempre à vista à direita da linha das ações
   ("↓ 853 mil · ↑ 7,8 mil"); o toque neles abre o detalhe (cache e tempo). */
function chipMemoria(m) {
  if (!m || m.origin !== 'agente') return '';
  const n = Array.isArray(m.memorias) ? m.memorias.length : 0;
  if (!n) return '';
  const aberto = memAbertas.has(m.id);
  return `<div class="resp-memchip" data-memchip="${esc(m.id)}"><button type="button" class="rmc-bt${aberto ? ' on' : ''}" data-memchip-bt aria-expanded="${aberto}">${ICO_MEMORIA}` +
    `<b>${n} ${n === 1 ? 'memória' : 'memórias'}</b><svg class="rmc-seta" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>` +
    (aberto ? `<div class="resp-mem">${m.memorias.map(x => `<div><span class="rm-tag">${esc(x.tipo || 'Fato')}</span><span>${esc(x.texto)}</span></div>`).join('')}</div>` : '') + '</div>';
}
function extrasDaResposta(m) {
  if (!m || m.origin !== 'agente' || !m.uso) return '';
  const aberto = infoAbertas.has(m.id);
  return `<button type="button" class="ac ac-tok${aberto ? ' on' : ''}" data-ac="info" title="Tokens desta resposta: entrada e saída" aria-expanded="${aberto}">` +
    `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 3 5 13h6l-1 8 8-10h-6z"/></svg>` +
    `<span>↓ ${numCurto(m.uso.entrada)} · ↑ ${numCurto(m.uso.saida)}</span></button>`;
}
function detalhesDaResposta(m) {
  if (!m || m.origin !== 'agente') return '';
  let html = '';
  if (infoAbertas.has(m.id) && m.uso) {
    const u = m.uso;
    html += `<div class="resp-info" data-det="info"><span class="ri-t">Esta resposta</span>` +
      `<div><span>Entrada</span><b>${numCurto(u.entrada)} tokens</b></div>` +
      (u.cache ? `<div><span>· do cache (mais barato)</span><b>${numCurto(u.cache)}</b></div>` : '') +
      `<div><span>Saída</span><b>${numCurto(u.saida)} tokens</b></div>` +
      (Number.isFinite(u.ms) && u.ms > 0 ? `<div><span>Tempo</span><b>${duracao(u.ms)}</b></div>` : '') +
      (u.usd >= 0.01 ? `<div title="Preço de uso da API; na assinatura não é cobrado por mensagem"><span>Custo na API</span><b>${dolar(u.usd)}</b></div>` : '') + '</div>';
  }
  return html;
}
wrap.addEventListener('click', ev => {
  const bt = ev.target.closest ? ev.target.closest('[data-memchip-bt]') : null;
  if (!bt) return;
  const caixa = bt.closest('[data-memchip]'), id = caixa.dataset.memchip;
  const m = msgs.find(x => x.id === id);
  if (!m) return;
  if (memAbertas.has(id)) memAbertas.delete(id); else memAbertas.add(id);
  caixa.outerHTML = chipMemoria(m);
});
wrap.addEventListener('click', async ev => {
  const b = ev.target.closest ? ev.target.closest('.acoes .ac') : null;
  if (!b) return;
  const id = b.closest('.acoes').dataset.acoes;
  const m = msgs.find(x => x.id === id);
  const texto = m ? legendaUtil(m) : '';
  if (!texto) return;
  if (b.dataset.ac === 'mem' || b.dataset.ac === 'info') {
    const conj = b.dataset.ac === 'mem' ? memAbertas : infoAbertas;
    if (conj.has(m.id)) conj.delete(m.id); else conj.add(m.id);
    const linha = b.closest('.acoes');
    linha.parentElement.querySelectorAll(':scope > [data-det]').forEach(x => x.remove());
    linha.insertAdjacentHTML('afterend', detalhesDaResposta(m));
    linha.querySelectorAll('.ac-mem, .ac-info').forEach(x => {
      const on = (x.dataset.ac === 'mem' ? memAbertas : infoAbertas).has(m.id);
      x.classList.toggle('on', on); x.setAttribute('aria-expanded', String(on));
    });
    return;
  }
  if (b.dataset.ac === 'responder') { comecaResposta(m); acendeResp(m.id); return; }
  if (b.dataset.ac === 'bom' || b.dataset.ac === 'ruim') { vota(m, b.dataset.ac); return; }
  if (b.dataset.ac === 'copiar') {
    try {
      await navigator.clipboard.writeText(texto);
      b.innerHTML = ICONE_ACAO.ok;
      b.classList.add('feito');
      setTimeout(() => { b.innerHTML = ICONE_ACAO.copiar; b.classList.remove('feito'); }, 1500);
    } catch (e) {
      mostraAviso('Não consegui copiar: ' + e.message);
    }
  } else if (b.dataset.ac === 'ouvir') {
    // a mesma leitura em pedaços do fone: toca esta resposta e segue pelas seguintes
    destravarAudio();
    ouvirAPartirDe({ id: m.id, texto });
  }
});

/* Conversa vazia: nunca tela em branco (18/10/2026, no padrão de estado vazio): o avatar do agente,
   uma pergunta curta e sugestões que só preenchem o campo (o dono revisa e envia). Depois de um
   /clear, aponta para as conversas arquivadas no Histórico. */
const SUGESTOES_VAZIO = ['O que você consegue fazer por mim?', 'O que ficou pendente da última conversa?', 'Me dê um resumo do que você sabe sobre o meu trabalho']
  .map(texto => ({ texto, tipo: '' }));
// As do próprio agente (objetivo dele e últimas conversas), em ~/.dgclaw/sugestoes.json; as de cima são o reserva.
let sugestoesAgente = null;
const ROTULO_SUGESTAO = { continuar: 'Continuar', insight: 'Ideia' };
if (!EH_ADMIN) {
  fetch('/api/v1/historico/' + encodeURIComponent(AGENTE.id) + '/sugestoes', { credentials: 'same-origin', cache: 'no-store' })
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (!d || !Array.isArray(d.sugestoes) || !d.sugestoes.length) return;
      sugestoesAgente = d.sugestoes;
      if (wrap.querySelector('.vazio')) render({ semRolar: true });
    })
    .catch(() => { /* fica com as genéricas */ });
}
function htmlVazio() {
  const img = AGENTE.avatar_img || (/^https:\/\//i.test(AGENTE.avatar || '') ? AGENTE.avatar : '');
  const foto = img ? `<img src="${esc(img)}" alt="">` : esc(AGENTE.avatar || (AGENTE.nome || '?').slice(0, 1));
  const comHist = !!window.DGHistorico;
  const sub = arquivadasTela && comHist
    ? 'Conversa nova. As anteriores estão no <button type="button" class="vz-link" data-abre-historico>Histórico</button>.'
    : `Mande a primeira mensagem para o ${esc(AGENTE.nome)}. A resposta aparece aqui.`;
  const sug = EH_ADMIN ? '' : '<div class="vz-sug" role="list">' + (sugestoesAgente || SUGESTOES_VAZIO).map(t =>
    `<button type="button" role="listitem" class="vz-chip" data-vz-sugestao="${esc(t.texto)}">` +
    (ROTULO_SUGESTAO[t.tipo] ? `<span class="vz-tipo">${ROTULO_SUGESTAO[t.tipo]}</span>` : '') + `${esc(t.texto)}</button>`).join('') + '</div>';
  // nome e função logo abaixo da foto (21/10/2026, pedido do dono): o cargo é o subtitulo do registro
  const quem = `<div class="vz-quem"><span class="vz-nome">${esc(AGENTE.nome || '')}</span>` +
    (AGENTE.subtitulo ? `<span class="vz-cargo">${esc(AGENTE.subtitulo)}</span>` : '') + '</div>';
  return `<div class="vazio"><div class="vz-av" style="background:${esc(AGENTE.cor || '#2f9e5e')}" aria-hidden="true">${foto}</div>` +
    `${quem}<b>Como posso ajudar?</b><small>${sub}</small>${sug}</div>`;
}
wrap.addEventListener('click', ev => {
  const b = ev.target.closest('[data-vz-sugestao]');
  if (!b) return;
  const campo = $('entrada');
  campo.value = b.dataset.vzSugestao;
  campo.dispatchEvent(new Event('input', { bubbles: true }));
  campo.focus();
  try { campo.setSelectionRange(campo.value.length, campo.value.length); } catch (_) { /* campo sem seleção */ }
});

/* Dia e hora de cada mensagem no fuso de QUEM ESTÁ LENDO, a partir do ep. O servidor formata no
   fuso dele (a KVM de teste roda em UTC): depois das 21h de Brasília a mensagem virava "dia
   seguinte" e o separador de dia caía no meio da conversa. Recalcular aqui deixa o separador
   antes da primeira mensagem de cada dia local, também quando o histórico antigo chega por
   paginação (a lista inteira é reordenada e reagrupada a cada render). */
const fmtLocal = (() => {
  const cache = new Map();
  const z = n => String(n).padStart(2, '0');
  return ep => {
    const seg = Math.floor(ep);
    let r = cache.get(seg);
    if (!r) {
      const d = new Date(seg * 1000);
      r = { dia: z(d.getDate()) + '/' + z(d.getMonth() + 1) + '/' + d.getFullYear(), hhmm: z(d.getHours()) + ':' + z(d.getMinutes()) };
      if (cache.size > 5000) cache.clear();
      cache.set(seg, r);
    }
    return r;
  };
})();
function horaLocal(m) {
  if (typeof m.ep !== 'number' || !isFinite(m.ep)) return;
  const f = fmtLocal(m.ep);
  m.dia = f.dia; m.hhmm = f.hhmm;
}

function render(opt) {
  opt = opt || {};
  for (const m of msgs) horaLocal(m);
  const todas = msgs.slice();
  // o pendente entra na posição cronológica dele (hora local da criação), e
  // não colado no fim, por baixo das respostas que chegaram depois
  for (const p of pendentes) {
    todas.push({ id: 'pend-' + p.n, ep: p.epLocal, dia: p.dia,
                 hhmm: p.hhmm, origin: 'dono', text: p.texto,
                 kind: p.kind || 'text', pendente: true, local: p });
    const re = RX_CITA_LOCAL.exec(String(p.texto || ''));
    if (re) {
      const orig = re[1] ? msgs.find(x => x.id === re[1]) : null;
      Object.assign(todas[todas.length - 1], { text: re[3], cita: { origin: orig ? orig.origin : 'agente', texto: re[2], id: re[1] || undefined } });
    }
  }
  // cartões "X nasceu às HH:MM" (onboarding.js): entram na ordem cronológica como qualquer item
  if (window.DGOnboarding && window.DGOnboarding.cartoes) {
    for (const c of window.DGOnboarding.cartoes()) todas.push({ id: 'nasc-' + c.id, ep: c.ep, dia: c.dia, cartaoNasc: c });
  }
  todas.sort((a, b) => a.ep - b.ep);
  const itens = [];            // [chave, html]
  if (todas.length) {
    itens.push(['topo', maisAntigas
      ? `<div class="topo">${carregandoAntigas ? 'carregando mensagens antigas…'
                                              : 'role para ver as antigas'}</div>`
      : arquivadasTela && window.DGHistorico
        ? '<div class="topo topo-arq">Conversa nova. As anteriores estão no <button type="button" data-abre-historico>Histórico</button></div>'
        : '<div class="topo">início da conversa</div>']);
  }
  let dia = '', anterior = null;
  lidoAteEp = 0;
  for (const x of todas) if (!x.pendente && !x.cartaoNasc && !ehDono(x) && typeof x.ep === 'number' && x.ep > lidoAteEp) lidoAteEp = x.ep;
  const blocos = TR ? TR.agrupaPorTurno(todas) : todas.map(x => ({ msg: x }));
  // enquanto ele trabalha no último pedido, os passos dele ficam na linha do campo, não aqui
  const fotoAtv = window.atividadeFoto && window.atividadeFoto.agentes ? window.atividadeFoto.agentes[AGENTE.id] : null;
  const trabalhandoAgora = !!(fotoAtv && fotoAtv.estado === 'trabalhando' && streamAberto);
  const ultDono = todas.reduce((a, x) => (ehDono(x) && typeof x.ep === 'number' && x.ep > a ? x.ep : a), 0);
  let divisorPosto = false;
  if (divisorEp != null && ultDono > divisorEp) divisorEp = null;   // você já escreveu depois: a linha sai
  // só passos de rotina (o batimento, por exemplo) e nenhuma mensagem: a conversa segue "nova" (22/10/2026)
  const soPassos = blocos.length > 0 && blocos.every(b => b.trilha);
  for (let bi = 0; bi < (soPassos ? 0 : blocos.length); bi++) {
    const bloco = blocos[bi];
    const m = bloco.msg || bloco.trilha[0];
    if (m.dia !== dia) {
      dia = m.dia;
      itens.push(['dia:' + dia, `<div class="dia"><span>${esc(dia)}</span></div>`]);
      anterior = null;
    }
    if (divisorEp != null && !divisorPosto && m.ep >= divisorEp && !ehDono(m)) {
      divisorPosto = true;
      itens.push(['novas-sep', `<div class="novas-sep" role="separator"><span>${divisorN === 1 ? '1 nova mensagem' : divisorN + ' novas mensagens'}</span></div>`]);
    }
    if (bloco.trilha) {
      if (trabalhandoAgora && m.ep > ultDono) continue;
      itens.push(['trilha:' + m.id, htmlResumoPassos(bloco.trilha, todas)]);
      continue;
    }
    if (m.origin === 'comando') { itens.push([m.id, htmlResultadoComando(m)]); continue; }
    if (m.origin === 'linha') { itens.push([m.id, `<div class="linha-sis${m.economia ? ' eco' : ''}" data-msg="${esc(m.id)}"><span>${esc(m.text)}</span></div>`]); anterior = null; continue; }
    if (m.origin === 'mencao' && m.mencao) { itens.push([m.id, htmlMencao(m)]); anterior = 'her'; continue; }
    if (m.cartaoNasc) { itens.push([m.id, window.DGOnboarding.htmlCartao(m.cartaoNasc)]); anterior = null; continue; }
    const lado = ehDono(m) ? 'me' : 'her';
    const troca = (anterior !== null && anterior !== lado ? ' gap' : '') +
      (['entrega', 'pedido'].includes(m.alerta) ? ' alerta-' + m.alerta : '');
    if (lado === 'me' && fotoDoDono(m)) {
      // fotos que o dono mandou juntas viram uma fileira de miniaturas, com o texto embaixo
      const grupo = [m];
      while (bi + 1 < blocos.length) {
        const prox = blocos[bi + 1].msg;
        if (!prox || !fotoDoDono(prox) || prox.dia !== m.dia || prox.ep - grupo[grupo.length - 1].ep > 120) break;
        grupo.push(prox); bi++;
      }
      itens.push([m.id + (grupo.length > 1 ? '~' + grupo.length : ''), htmlFotosDono(grupo, troca)]);
      anterior = lado;
      continue;
    }
    if (lado === 'her' && fotoDoAgente(m) && window.dgui && window.dgui.htmlCarrossel) {
      const grupo = [m];
      while (bi + 1 < blocos.length) {
        const prox = blocos[bi + 1].msg;
        if (!prox || !fotoDoAgente(prox) || prox.dia !== m.dia || prox.ep - grupo[grupo.length - 1].ep > 300) break;
        grupo.push(prox); bi++;
      }
      if (grupo.length > 1) {
        itens.push([m.id + '~car' + grupo.length, htmlFotosAgente(grupo, troca)]);
        anterior = lado;
        continue;
      }
    }
    itens.push([m.id, `<div class="row ${lado}${ehVisual(m.media) ? ' vis' : ''}${troca}" data-msg="${esc(m.id)}">` +
                      `<div class="bub">${m.mencaoPergunta ? destacaMencao(htmlCorpo(m), m) : destacaNomes(htmlCorpo(m))}</div>${lado === 'her' ? htmlAcoes(m, htmlHora(m)) : htmlHora(m)}</div>`]);
    anterior = lado;
  }
  if (!itens.length && carregouUmaVez) itens.push(['vazio', htmlVazio()]);

  const usadas = new Set(), nos = [];
  for (let [chave, html] of itens) {
    // chave repetida não pode reusar o mesmo elemento duas vezes no wrap
    while (usadas.has(chave)) chave += '+';
    usadas.add(chave);
    const velho = nosThread.get(chave);
    let el;
    if (velho && velho.html === html) {
      el = velho.el;
    } else {
      el = criaNo(html);
      if (velho) transplantaAudio(velho.el, el);
      nosThread.set(chave, { html: html, el: el });
    }
    nos.push(el);
  }
  for (const chave of Array.from(nosThread.keys())) {
    if (!usadas.has(chave)) nosThread.delete(chave);
  }
  // mesma lista de nós na mesma ordem: não encosta no DOM
  const atuais = wrap.children;
  const igual = atuais.length === nos.length && nos.every((el, i) => atuais[i] === el);
  if (igual) { pintaFilaLeitura(); return; }
  // Mensagens antigas entrando no topo, mensagem nova no fim, balão refeito: a posição
  // fica por conta do observador de rolagem (no fim acompanha, lendo mais acima não mexe).
  aplicaNos(nos);
  humanizaHoras();
  // os filtros nascem mais abaixo (alertas): antes disso, um render do cache não pode tocá-los
  if (filtrosProntos) { aplicaFiltro(); observaVistos(); observaLeitura(); }
  if (window.dgui && window.dgui.restauraEscolhas) window.dgui.restauraEscolhas(wrap);
  visuaisAposRender();
  preencheTarefas();
  respiroDasFaixas();
  guardaCache();
  atualizaSeta();
  pintaFilaLeitura();   // os balões foram refeitos: o selo da fila volta
}

/* Põe a lista de nós no #wrap mexendo só no que mudou. O replaceChildren
   recolocava TODOS: com milhares de balões (depois de um pulo da busca), cada
   cartão de prévia que chegava custava 300 ms de tela travada. Os nós que
   ficam já estão na ordem certa entre si (a thread é ordenada por ep), então
   basta tirar os que saíram e inserir os novos no lugar. */
function aplicaNos(nos) {
  const ficam = new Set(nos);
  for (const el of Array.from(wrap.children)) if (!ficam.has(el)) el.remove();
  let atual = wrap.firstElementChild;
  for (const el of nos) {
    if (el === atual) { atual = atual.nextElementSibling; continue; }
    wrap.insertBefore(el, atual);
  }
}

/* ── Visuais na conversa (12/10/2026, docs/ESPEC-VISUAIS.md) ──────────────
   A agente manda um vis-<assunto>.html e o balão vira o visual desenhado num
   <iframe sandbox="allow-scripts"> (origem opaca: sem cookie, sem storage, sem
   acesso ao app). O iframe é território inimigo: tudo o que ele manda por
   postMessage é conferido (fonte, número preso, texto cortado) e nada dele vira
   HTML. O <iframe> NÃO entra na string de HTML do render: é criado aqui, quando
   o balão chega perto da tela, e fica no nó enquanto o nó existir (o render
   reaproveita o nó quando o HTML é o mesmo, então os polls não recarregam nada).
   Se o nó for refeito (mensagem editada, destaque da busca), o visual recarrega
   na altura que já tinha, para a conversa não pular. */
const RX_VISUAL = /^vis-[^\/]*\.html?$/i;
const ehVisual = md => !!(md && md.kind === 'document' && RX_VISUAL.test(md.nome || ''));
const VIS_PRONTO_MS = 12000;
const VIS_ALT_MIN = 40;
const visuais = new Map();          // contentWindow -> estado (balão e tela cheia)
const visEstados = new Set();       // estados dos balões na conversa
// trocou o tema (tema.js): os visuais abertos acompanham na hora
document.addEventListener('dgtema', () => { for (const est of visEstados) enviaAoVisual(est, { tipo: 'tema', valor: temaApp() }); });
const visPorCaixa = new WeakMap();  // .visq -> estado
const visAlturas = new Map();       // id da mídia -> última altura (sobrevive ao nó refeito)

const temaApp = () => document.documentElement.dataset.tema === 'escuro' ? 'escuro' : 'claro';
/* Teto alto de propósito (12/10/2026): com 80% da tela, o relatório inteiro rolava
   DENTRO do balão, e no iPhone o dedo em cima do visual rolava o visual e não a
   conversa. O visual ocupa a altura que precisa; só um gigante rola por dentro. */
const tetoVisual = () => Math.max(2400, Math.floor(window.innerHeight * 3));

/* O que se vê no balão até o <title> chegar: o nome do arquivo sem "vis-" e sem
   extensão, hífen e sublinhado viram espaço. */
function tituloProvisorio(nome) {
  const t = String(nome || '').replace(/^vis-/i, '').replace(/\.html?$/i, '')
    .replace(/[-_]+/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Visual';
}

function urlVisual(md) {
  let v = '';
  try { v = new URL(md.url, location.href).searchParams.get('v') || ''; }
  catch (e) { console.warn('visual: url de mídia ilegível:', md.url, e.message); }
  return '/api/v1/media/' + encodeURIComponent(md.id) + '/visual?tema=' + temaApp() +
         (v ? '&v=' + encodeURIComponent(v) : '');
}

function htmlVisual(m, md) {
  const tit = tituloProvisorio(md.nome);
  return `<div class="visb"><div class="vish">` +
    `<span class="vist">${ICO_VISUAL}<span class="visn" data-visn="${esc(md.id)}">${esc(tit)}</span></span>` +
    `<button type="button" class="visfull" data-visfull="${esc(md.id)}" ` +
    `title="Abrir em tela cheia" aria-label="Abrir o visual em tela cheia">⛶</button>` +
    `${botaoBaixaMidia(md, ROTULO_MIDIA.document)}</div>` +
    `<div class="visq" data-vis="${esc(md.id)}"><span class="visq-msg">carregando o visual…</span></div>` +
    `</div>`;
}

function enviaAoVisual(est, obj) {
  if (!est.win) return;
  try { est.win.postMessage(Object.assign({ dgvis: 1 }, obj), '*'); }
  catch (e) { console.warn('visual: não consegui avisar o iframe (' + obj.tipo + '):', e.message); }
}
function enviaVisivel(est) {
  enviaAoVisual(est, { tipo: 'visivel',
    v: !!(est.noViewport && document.visibilityState === 'visible') });
}

function mostraTarjaVisual(est, texto) {
  if (est.tarja) { est.tarja.textContent = texto; est.tarja.hidden = !texto; return; }
  if (!texto) return;
  const t = document.createElement('div');
  t.className = 'vistarja';
  t.setAttribute('role', 'alert');
  t.textContent = texto;      // texto do iframe: nunca HTML
  est.tarja = t;
  if (est.cheia) est.caixa.parentElement.insertBefore(t, est.caixa);
  else (est.barraEl || est.caixa).after(t);   // a barrinha de envio fica entre a caixa e a tarja
}

function semPronto(est) {
  if (est.pronto || est.falhou) return;
  mostraTarjaVisual(est, 'O visual não respondeu em ' + (VIS_PRONTO_MS / 1000) +
    ' s: o script dele travou ou o arquivo não é um visual. Use ⬇ para ver o arquivo.');
  est.semPronto = true;
  console.warn('visual ' + est.md.id + ' (' + est.md.nome + '): sem "pronto" em ' +
               (VIS_PRONTO_MS / 1000) + ' s depois do load');
}

/* Cria o iframe dentro da caixa (balão ou tela cheia). Só aqui, nunca no HTML. */
function carregaVisual(est) {
  if (est.iframe) return;
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts');       // NUNCA allow-same-origin
  f.setAttribute('referrerpolicy', 'no-referrer');
  f.setAttribute('allow', '');
  f.setAttribute('title', 'Visual: ' + tituloProvisorio(est.md.nome));
  f.className = 'visf';
  f.addEventListener('load', () => {
    clearTimeout(est.relogio);
    est.relogio = setTimeout(() => semPronto(est), VIS_PRONTO_MS);
  });
  f.src = urlVisual(est.md);
  est.iframe = f;
  est.caixa.appendChild(f);
  est.win = f.contentWindow;
  if (est.win) visuais.set(est.win, est);
  else console.warn('visual ' + est.md.id + ': o iframe não tem janela depois de inserido');
}

function desmontaVisual(est) {
  clearTimeout(est.relogio);
  fechaBarraDe(est);
  if (est.win) visuais.delete(est.win);
  if (est.caixa) { ioVisCarrega.unobserve(est.caixa); ioVisVisivel.unobserve(est.caixa); }
  if (est.iframe) est.iframe.remove();
  if (est.tarja) est.tarja.remove();
  est.iframe = null; est.win = null;
  visEstados.delete(est);
}

const ioVisCarrega = new IntersectionObserver(es => {
  for (const e of es) {
    if (!e.isIntersecting) continue;
    const est = visPorCaixa.get(e.target);
    ioVisCarrega.unobserve(e.target);
    if (est) carregaVisual(est);
  }
}, { root: chat, rootMargin: '600px 0px' });
const ioVisVisivel = new IntersectionObserver(es => {
  for (const e of es) {
    const est = visPorCaixa.get(e.target);
    if (!est) continue;
    est.noViewport = e.isIntersecting;
    enviaVisivel(est);
  }
}, { root: chat, rootMargin: '0px' });

/* Chamado depois de cada render que mexeu no DOM: dá estado e observadores às
   caixas novas e solta as que saíram da conversa. */
function visuaisAposRender() {
  for (const cx of wrap.querySelectorAll('.visq[data-vis]')) {
    if (visPorCaixa.has(cx)) continue;
    const md = midias[cx.getAttribute('data-vis')];
    if (!md) { console.warn('visual: mídia desconhecida na caixa', cx.getAttribute('data-vis')); continue; }
    const est = { md, caixa: cx, iframe: null, win: null, pronto: false, falhou: false,
                  noViewport: false, relogio: null, tarja: null, cheia: false };
    visPorCaixa.set(cx, est);
    visEstados.add(est);
    const h = visAlturas.get(md.id);
    if (h) cx.style.height = Math.min(h, tetoVisual()) + 'px';
    ioVisCarrega.observe(cx);
    ioVisVisivel.observe(cx);
  }
  for (const est of Array.from(visEstados)) if (!est.caixa.isConnected) desmontaVisual(est);
}

function aplicaAlturaVisual(est, h) {
  est.h = h;
  est.caixa.style.height = Math.min(h, tetoVisual()) + 'px';
  visAlturas.set(est.md.id, h);
}

/* ── Pergunta do visual (BL-544, docs/VISUAIS.md) ──────────
   O iframe é território inimigo e o app não tem como saber se houve toque de
   verdade dentro dele. Por isso o visual NUNCA manda mensagem sozinho: ele só
   PEDE (tipo 'pergunta'). O pedido abre uma barrinha no DOM do app, fora do
   iframe, com o texto exato; só o toque do dono em "Enviar" manda. O ramo da
   mensagem abaixo não chama enviarTexto: o envio fica no handler do botão. */
const VIS_PERG_MAX = 500;            // caracteres, depois da limpeza (acima disso recusa, não corta)
const VIS_PERG_RAPIDO_MS = 3000;     // entre dois pedidos aceitos do mesmo visual
const VIS_PERG_LIMITE = 5;           // pedidos aceitos sem nenhum toque do dono na barrinha
const VIS_PERG_ARMA_MS = 400;        // Enviar nasce desligado: um toque que era para o visual não cai nele
const RX_HTML_PERG = /<\s*[a-z!\/?]/i;
/* Estado por id da mídia (não por nó): sobrevive ao balão refeito, e o balão e a
   tela cheia do mesmo visual dividem o mesmo contador. */
const visLimites = new Map();       // id da mídia -> { ultimo, pedidos, avisou, barra }

function limitesDe(mediaId) {
  let l = visLimites.get(mediaId);
  if (!l) { l = { ultimo: 0, pedidos: 0, avisou: false, barra: null }; visLimites.set(mediaId, l); }
  return l;
}

/* Devolve { texto } limpo ou { motivo, msg } quando recusa. */
function limpaPergunta(bruto) {
  if (typeof bruto !== 'string') return { motivo: 'vazio', msg: 'O visual não mandou texto nenhum.' };
  const t = bruto.replace(/\r\n/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n').trim();
  if (!t) return { motivo: 'vazio', msg: 'O pedido veio sem texto.' };
  if (t.length > VIS_PERG_MAX) {
    return { motivo: 'longo', msg: 'O texto passa de ' + VIS_PERG_MAX + ' caracteres.' };
  }
  if (RX_HTML_PERG.test(t)) return { motivo: 'html', msg: 'O texto não pode ter HTML.' };
  return { texto: t };
}

const tituloDoEnvio = est => (est.titulo || tituloProvisorio(est.md.nome))
  .replace(/[\[\]]/g, '').replace(/\s*[\r\n]+\s*/g, ' ').trim().slice(0, 60) || 'Visual';

function recusaPergunta(est, id, motivo, msg) {
  enviaAoVisual(est, { tipo: 'pergunta-erro', id, motivo, msg });
}

function fechaBarra(lim) {
  const b = lim.barra;
  if (!b) return;
  clearTimeout(b.relogio);
  b.est.barraEl = null;
  b.el.remove();
  lim.barra = null;
}
/* ── Caixa de cofre da peça .dv-cofre (campo-cofre.js) ──────────────────
   O iframe só PEDE (postMessage 'cofre'). O cartão com o campo de senha é do app, desenhado abaixo do
   visual (ou na tela cheia) fora do iframe: o valor nunca passa por ele. Uma caixa por visual. */
const visCofres = new Map();        // id da mídia -> { est, el, relogio }
const VIS_COFRE_FECHA_MS = 4000;

function alvoDoVisual(est) {
  return est.win && visuais.get(est.win) === est ? est
    : Array.from(visEstados).find(e => e.md.id === est.md.id && e.win);
}
function recusaCofre(est, id, motivo, msg) {
  enviaAoVisual(est, { tipo: 'cofre-erro', id, motivo, msg });
}
function fechaCofre(mediaId) {
  const c = visCofres.get(mediaId);
  if (!c) return;
  clearTimeout(c.relogio);
  c.el.remove();
  visCofres.delete(mediaId);
}
function fechaCofreDe(est) {
  const c = est.md && visCofres.get(est.md.id);
  if (c && c.est === est) fechaCofre(est.md.id);
}

function tratarCofre(est, d, id) {
  // O campo-cofre.js do S2 Bot (slug:NOME no Admin, "usar a de outro agente") ainda não tem a porta da lousa:
  // sem validaPedido/montar, o visual recebe a recusa e o dono usa o bloco ```dgcofre da conversa.
  const temLousa = window.campoCofre && typeof window.campoCofre.validaPedido === 'function' && typeof window.campoCofre.montar === 'function';
  const v = temLousa ? window.campoCofre.validaPedido(d) : null;
  if (!v) return recusaCofre(est, id, 'indisponivel', 'A caixa de cofre dos visuais ainda não está ligada. Peça ao agente o campo de senha na conversa.');
  if (v.erro) return recusaCofre(est, id, v.erro.motivo, v.erro.msg);
  if (document.visibilityState !== 'visible' || (!est.cheia && !est.noViewport)) {
    return recusaCofre(est, id, 'fora', 'O visual não está à vista agora.');
  }
  if (visCofres.has(est.md.id)) return recusaCofre(est, id, 'ocupado', 'Já tem uma caixa de cofre aberta neste visual.');
  const { nome, rotulo, ajuda } = v.ok;
  const el = document.createElement('div');
  el.className = 'viscofre' + (est.cheia ? ' viscofre-cheia' : '');
  const reg = { est, el, relogio: 0 };
  visCofres.set(est.md.id, reg);
  if (est.cheia) visTelaEl.appendChild(el); else est.caixa.after(el);
  window.campoCofre.montar(el, {
    envName: nome, rotulo, ajuda,
    aoGuardar: ({ final }) => {
      const alvo = alvoDoVisual(est);
      if (alvo) enviaAoVisual(alvo, { tipo: 'cofre-ok', id, nome });  // sem o final: o visual não é confiável
      reg.relogio = setTimeout(() => fechaCofre(est.md.id), VIS_COFRE_FECHA_MS);
    },
    aoErro: ({ motivo, msg }) => { const alvo = alvoDoVisual(est); if (alvo) recusaCofre(alvo, id, motivo, msg); },
    aoCancelar: () => {
      fechaCofre(est.md.id);
      const alvo = alvoDoVisual(est);
      if (alvo) recusaCofre(alvo, id, 'cancelado', 'Você cancelou.');
    },
  });
  if (!est.cheia) {
    // rola só o #chat (scrollIntoView poderia mexer na página inteira no iPhone)
    const r = el.getBoundingClientRect(), c = chat.getBoundingClientRect();
    if (r.bottom > c.bottom - 8) { chat.scrollTop += r.bottom - c.bottom + 8; rolagem.captura(); }
  }
  enviaAoVisual(est, { tipo: 'cofre-espera', id });
}

/* O visual pergunta, ao carregar, quais nomes já estão guardados. Resposta: só {guardada: bool} por nome,
   nunca o final da chave (o visual é código não confiável). Só responde com o visual à vista, no máximo
   1 vez a cada 3 s e até 20 nomes por pedido; o excesso é ignorado, com um único aviso por visual. */
const visCofreEstado = new Map();   // id da mídia -> { ultimo, avisou }
function tratarCofreEstado(est, d) {
  if (!window.campoCofre || typeof window.campoCofre.freioEstado !== 'function') return;
  if (document.visibilityState !== 'visible' || (!est.cheia && !est.noViewport)) return;
  const bruto = Array.isArray(d.nomes) ? d.nomes.filter(n => typeof n === 'string') : [];
  let reg = visCofreEstado.get(est.md.id);
  if (!reg) { reg = { ultimo: 0, avisou: false }; visCofreEstado.set(est.md.id, reg); }
  const f = window.campoCofre.freioEstado(reg, Date.now(), bruto.length);
  if (!f.ok) {
    if (f.avisar) console.warn('visual ' + est.md.id + ' (' + est.md.nome + '): pedidos de estado do cofre demais ou rápidos demais; ignorando o excesso (máximo 1 a cada 3 s e 20 nomes).');
    return;
  }
  const v = bruto.filter(n => window.campoCofre.validaPedido({ nome: n }).ok);
  if (!v.length) return;
  window.campoCofre.estados(v).then(
    estados => enviaAoVisual(est, { tipo: 'cofre-estado', estados }),
    e => console.warn('visual ' + est.md.id + ': não consegui consultar o cofre para o visual:', e && e.message));
}

/* Balão desmontado ou tela cheia fechada: a barrinha some sem mandar nada. */
function fechaBarraDe(est) {
  fechaCofreDe(est);
  const lim = est.md && visLimites.get(est.md.id);
  if (lim && lim.barra && lim.barra.est === est) fechaBarra(lim);
}

function abreBarra(est, lim, id, texto) {
  const el = document.createElement('div');
  el.className = 'vispede' + (est.cheia ? ' vispede-cheia' : '');
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Confirmar envio do visual');
  const rot = document.createElement('div');
  rot.className = 'vispede-rot';
  rot.textContent = 'Mandar para o ' + AGENTE.nome + ':';
  const tx = document.createElement('div');
  tx.className = 'vispede-txt';
  tx.textContent = '“' + texto + '”';        // texto do iframe: nunca HTML
  const bts = document.createElement('div');
  bts.className = 'vispede-bts';
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'vispede-ok';
  ok.textContent = 'Enviar';
  ok.disabled = true;
  const nao = document.createElement('button');
  nao.type = 'button';
  nao.className = 'vispede-nao';
  nao.textContent = '✕';
  nao.setAttribute('aria-label', 'Cancelar');
  bts.append(ok, nao);
  el.append(rot, tx, bts);
  const b = { el, est, id, texto, relogio: setTimeout(() => { ok.disabled = false; }, VIS_PERG_ARMA_MS) };
  lim.barra = b;
  est.barraEl = el;
  if (est.cheia) visTelaEl.appendChild(el);
  else {
    est.caixa.after(el);
    // QA de 12/10: com a conversa rolada para cima, a barrinha nascia abaixo da borda
    // do #chat e o "confirme no app" apontava para um Enviar invisível. Rola só o
    // #chat (scrollIntoView poderia mexer na página inteira no iPhone).
    const r = el.getBoundingClientRect(), c = chat.getBoundingClientRect();
    if (r.bottom > c.bottom - 8) { chat.scrollTop += r.bottom - c.bottom + 8; rolagem.captura(); }
  }
  ok.addEventListener('click', () => enviaPergunta(lim, b));
  nao.addEventListener('click', () => {
    if (lim.barra !== b) return;
    lim.pedidos = 0; lim.avisou = false;
    fechaBarra(lim);
    recusaPergunta(est, id, 'cancelado', 'Você cancelou o envio.');
  });
}

/* Único lugar onde a pergunta de um visual vira mensagem: o toque do dono. */
function enviaPergunta(lim, b) {
  if (lim.barra !== b || b.el.querySelector('.vispede-ok').disabled) return;
  const { est, id, texto } = b;
  lim.pedidos = 0; lim.avisou = false;
  fechaBarra(lim);
  const aoEntregar = (ok, motivo) => {
    // se a tela cheia já fechou, quem recebe a resposta é o balão do mesmo visual
    const alvo = est.win && visuais.get(est.win) === est ? est
      : Array.from(visEstados).find(e => e.md.id === est.md.id && e.win);
    if (!alvo) return;
    if (ok) enviaAoVisual(alvo, { tipo: 'pergunta-ok', id });
    else recusaPergunta(alvo, id, 'envio', 'Não consegui mandar: ' + motivo);
  };
  enviarTexto('[do visual ' + tituloDoEnvio(est) + '] ' + texto, null, { aoEntregar })
    .catch(e => console.warn('visual ' + est.md.id + ': o envio da pergunta falhou:', e));
  if (est.cheia) fechaTelaVisual();
}

/* Trata o pedido. `d.id` já veio validado (inteiro >= 0). */
function tratarPergunta(est, d, id) {
  const v = limpaPergunta(d.texto);
  if (!v.texto) return recusaPergunta(est, id, v.motivo, v.msg);
  if (document.visibilityState !== 'visible' || (!est.cheia && !est.noViewport)) {
    return recusaPergunta(est, id, 'fora', 'O visual não está à vista agora.');
  }
  const lim = limitesDe(est.md.id);
  if (lim.barra) return recusaPergunta(est, id, 'ocupado', 'Já tem um pedido esperando sua confirmação.');
  if (lim.pedidos >= VIS_PERG_LIMITE) {
    if (!lim.avisou) {
      lim.avisou = true;
      console.warn('visual ' + est.md.id + ' (' + est.md.nome + '): ' + VIS_PERG_LIMITE +
                   ' pedidos sem nenhum toque do dono; recusando os próximos até ele tocar');
    }
    return recusaPergunta(est, id, 'limite', 'Muitos pedidos sem resposta sua. Toque no visual de novo mais tarde.');
  }
  if (Date.now() - lim.ultimo < VIS_PERG_RAPIDO_MS) {
    return recusaPergunta(est, id, 'rapido', 'Espere alguns segundos entre um pedido e outro.');
  }
  lim.ultimo = Date.now();
  lim.pedidos++;
  abreBarra(est, lim, id, v.texto);
  enviaAoVisual(est, { tipo: 'pergunta-espera', id });
}

/* O único ouvinte de mensagens do iframe. `origin` vem "null" (origem opaca) e não
   prova nada: quem vale é `ev.source` ser a janela de um iframe que EU criei. */
window.addEventListener('message', ev => {
  const d = ev.data;
  if (!d || typeof d !== 'object' || d.dgvis !== 1 || typeof d.tipo !== 'string') return;
  const est = visuais.get(ev.source);
  if (!est) return;
  if (d.tipo === 'pronto') {
    est.pronto = true;
    clearTimeout(est.relogio);
    if (est.semPronto) { est.semPronto = false; mostraTarjaVisual(est, ''); }
    est.caixa.classList.add('on');
    const tit = typeof d.titulo === 'string' ? d.titulo.trim().slice(0, 120) : '';
    const desc = typeof d.descricao === 'string' ? d.descricao.trim().slice(0, 300) : '';
    if (tit) {
      est.titulo = tit;
      if (est.cheia) { if (visTelaNome) visTelaNome.textContent = tit; }
      else {
        const n = est.caixa.parentElement.querySelector('.visn');
        if (n) n.textContent = tit;
        est.iframe.setAttribute('title', 'Visual: ' + tit);
      }
    }
    if (desc && !est.cheia) est.caixa.parentElement.querySelector('.vist').setAttribute('title', desc);
    enviaAoVisual(est, { tipo: 'tema', valor: temaApp() });
    if (est.cheia) enviaAoVisual(est, { tipo: 'tela', cheia: true });
    enviaVisivel(est);
  } else if (d.tipo === 'altura') {
    if (est.cheia) return;
    const n = Number(d.h);
    if (!isFinite(n)) return;
    est.caixa.classList.add('on');
    aplicaAlturaVisual(est, Math.max(VIS_ALT_MIN, Math.ceil(n)));
  } else if (d.tipo === 'pergunta') {
    const id = Number(d.id);
    if (!isFinite(id) || id < 0 || Math.floor(id) !== id) return;
    tratarPergunta(est, d, id);
  } else if (d.tipo === 'cofre') {
    const id = Number(d.id);
    if (!isFinite(id) || id < 0 || Math.floor(id) !== id) return;
    tratarCofre(est, d, id);
  } else if (d.tipo === 'cofre-estado?') {
    tratarCofreEstado(est, d);
  } else if (d.tipo === 'erro') {
    est.caixa.classList.add('on');
    const msg = typeof d.msg === 'string' ? d.msg.slice(0, 400) : 'erro sem mensagem';
    const linha = Number(d.linha);
    const doServidor = isFinite(Number(d.status)) && d.status !== undefined && d.status !== null;
    if (doServidor) est.falhou = true;      // a página de erro da rota já explica dentro do iframe
    clearTimeout(est.relogio);
    console.warn('visual ' + est.md.id + ' (' + est.md.nome + '): ' + msg +
                 (isFinite(linha) && linha > 0 ? ' (linha ' + linha + ')' : ''));
    if (doServidor) return;
    if (d.vazio === true) { est.falhou = true; mostraTarjaVisual(est, 'O visual chegou vazio: o arquivo não desenhou nada.'); return; }
    mostraTarjaVisual(est, '⚠️ O visual teve um erro: ' + msg +
                           (isFinite(linha) && linha > 0 ? ' (linha ' + linha + ')' : ''));
  }
});

document.addEventListener('visibilitychange', () => {
  for (const est of visEstados) enviaVisivel(est);
  if (visTelaEst) enviaVisivel(visTelaEst);
});
window.addEventListener('resize', () => {
  for (const est of visEstados) if (est.h) est.caixa.style.height = Math.min(est.h, tetoVisual()) + 'px';
});

/* Tela cheia: camada por cima da conversa com um SEGUNDO iframe (mesma rota, mesmo
   sandbox). O voltar do sistema fecha, no mesmo padrão do visor de arquivos. */
let visTelaEl = null, visTelaCorpo = null, visTelaNome = null, visTelaBaixa = null;
let visTelaEst = null, visTelaNoHist = false, visTelaVoltaPend = false, visTelaVoltaRelogio = null;
const visTelaAberta = () => !!(visTelaEl && visTelaEl.classList.contains('abre'));

function montaTelaVisual() {
  if (visTelaEl) return;
  visTelaEl = document.createElement('div');
  visTelaEl.id = 'visTela';
  visTelaEl.setAttribute('role', 'dialog');
  visTelaEl.setAttribute('aria-label', 'Visual em tela cheia');
  visTelaEl.innerHTML = '<div class="vtctopo"><span class="vtcnome" id="visTelaNome"></span>' +
    '<span id="visTelaBaixa"></span>' +
    '<button type="button" class="vtcfecha" id="visTelaFecha" aria-label="Fechar">✕</button></div>' +
    '<div class="vtccorpo" id="visTelaCorpo"></div>';
  document.body.appendChild(visTelaEl);
  visTelaCorpo = document.getElementById('visTelaCorpo');
  visTelaNome = document.getElementById('visTelaNome');
  visTelaBaixa = document.getElementById('visTelaBaixa');
  document.getElementById('visTelaFecha').onclick = () => fechaTelaVisual();
}

function limpaTelaVisual() {
  if (!visTelaEst) return;
  clearTimeout(visTelaEst.relogio);
  fechaBarraDe(visTelaEst);
  if (visTelaEst.win) {
    enviaAoVisual(visTelaEst, { tipo: 'tela', cheia: false });
    visuais.delete(visTelaEst.win);
  }
  if (visTelaEst.tarja) visTelaEst.tarja.remove();
  visTelaCorpo.innerHTML = '';
  visTelaEst = null;
}

function abreTelaVisual(md) {
  montaTelaVisual();
  const jaAberta = visTelaAberta();
  limpaTelaVisual();
  midias[md.id] = md;
  visTelaNome.textContent = tituloProvisorio(md.nome);
  visTelaBaixa.innerHTML = botaoBaixaMidia(md, ROTULO_MIDIA.document);
  const est = { md, caixa: visTelaCorpo, iframe: null, win: null, pronto: false, falhou: false,
                noViewport: true, relogio: null, tarja: null, cheia: true };
  visTelaEst = est;
  visTelaEl.classList.add('abre');
  if (!jaAberta) {
    try {
      history.pushState(Object.assign({}, history.state || {}, { dgtgVisual: 1 }), '');
      visTelaNoHist = true;
    } catch (e) {
      visTelaNoHist = false;
      console.warn('tela cheia do visual sem entrada no histórico:', e.message);
    }
  }
  carregaVisual(est);
}

function fechaTelaVisual(peloHistorico) {
  if (!visTelaAberta()) return;
  visTelaEl.classList.remove('abre');
  limpaTelaVisual();
  if (peloHistorico !== true && visTelaNoHist) {
    visTelaNoHist = false;
    visTelaVoltaPend = true;
    clearTimeout(visTelaVoltaRelogio);
    visTelaVoltaRelogio = setTimeout(() => { visTelaVoltaPend = false; }, 1500);
    history.back();
  }
}
/* Registrado antes do popstate do visor de arquivos: se o visor estiver aberto por
   cima (ex.: ⬇ no celular), este voltar é DELE e a tela cheia continua. */
window.addEventListener('popstate', () => {
  if (visTelaVoltaPend) { visTelaVoltaPend = false; clearTimeout(visTelaVoltaRelogio); return; }
  if (visTelaAberta() && visTelaNoHist && !visorAberto()) {
    visTelaNoHist = false;
    fechaTelaVisual(true);
  }
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && visTelaAberta() && !visorAberto()) fechaTelaVisual();
});

wrap.addEventListener('click', ev => {
  const bt = ev.target.closest ? ev.target.closest('button[data-visfull]') : null;
  if (!bt) return;
  const md = midias[bt.getAttribute('data-visfull')];
  if (md) abreTelaVisual(md);
  else mostraErro('Não reconheci este visual para abrir em tela cheia. Recarregue a conversa.');
});

const normaliza = s => String(s == null ? '' : s).trim().replace(/\s+/g, ' ');

/* Some com o balão otimista quando a mensagem de verdade aparece na thread.
   Casa pendente 'enviada' e também 'falhou' (um envio dado como perdido pode
   ter ido: timeout do lado de cá com o relay tendo entregado). Nunca casa
   'enviando', pra prévia de upload não sumir no meio. Só vale mensagem de
   quem escreve mais nova que o envio (ep do servidor, ou a hora local de criação
   quando o servidor não chegou a responder), pra um "ok" antigo não apagar um
   "ok" novo. Cada mensagem real consome um pendente só. */
function limpaPendentes() {
  if (!pendentes.length) return;
  const consumidas = new Set();
  pendentes = pendentes.filter(p => {
    if (p.estado !== 'enviada' && p.estado !== 'falhou') return true;
    const piso = (p.ep != null ? p.ep : p.epLocal) - 60;
    const achou = msgs.find(m => ehDono(m) && !consumidas.has(m.id) &&
      m.ep >= piso &&
      ((p.path && m.media && m.media.path === p.path) ||
       (p.anexos && m.media && p.anexos.some(a => a.path === m.media.path)) ||
       (p.texto && normaliza(m.text) === normaliza(semCita(p.casa || p.texto)))));
    if (!achou) return true;
    consumidas.add(achou.id);
    soltaPrevias(p);
    return false;
  });
}

/* Recebe o evento "msgs" do stream ({novas, sumidas, avisos}) ou, por
   compatibilidade, uma lista simples de mensagens (/wait). */
function integra(d) {
  if (!d) return;
  const lista = Array.isArray(d);
  const novas = lista ? d : (d.novas || []);
  const sumidas = lista ? [] : (d.sumidas || []);
  if (sumidas.length) {
    // o id muda quando a mídia é resolvida depois: a versão velha sai
    const fora = new Set(sumidas);
    msgs = msgs.filter(m => !fora.has(m.id));
  }
  const vistos = new Set(msgs.map(m => m.id));
  const posicoes = new Map(msgs.map((m, i) => [m.id, i]));
  // a seta conta a resposta que chegou com a pessoa lendo lá em cima
  const longe = distanciaDoFim() >= 160, topoAntes = maiorEp();
  for (const m of novas) {
    if (posicoes.has(m.id)) { msgs[posicoes.get(m.id)] = m; continue; }
    if (!vistos.has(m.id)) {
      msgs.push(m);
      vistos.add(m.id);
      if (longe && m.ep > topoAntes && ehAgente(m)) novasAbaixo++;
    }
  }
  msgs.sort((a, b) => a.ep - b.ep);
  limpaPendentes();
  render();
  atualizaSeta();
  if (!lista) trataAvisosThread(d.avisos);
  for (const f of ouvintesChegada.slice()) {
    try { f(novas); } catch (e) { console.warn('ouvinte de chegada falhou:', e); }
  }
}

/* ── Carregar: a página mais nova, e as antigas quando rola pra cima ─────── */
/* A tela pede só as últimas 60. Rolar até perto do topo traz mais 80, quantas
   vezes precisar, até o começo da conversa. */
const PAGINA = 60, PAGINA_ANTIGAS = 80;
let maisAntigas = true, carregandoAntigas = false;
let arquivadasTela = false;   // um /clear já mandou conversas para Histórico > Arquivadas
/* Sobe a cada troca inteira de `msgs`: uma página pedida antes da troca chega
   depois e não pode ser colada na janela nova. */
let geracaoJanela = 0;

const menorEp = () => msgs.reduce((m, x) => Math.min(m, x.ep), Infinity);

/* Devolve true se a página chegou e foi aplicada. */
async function carregar(primeiraVez) {
  let ok = false;
  try {
    const d = await api(API + '/messages?limit=' + PAGINA);
    const novas = d.msgs || [];
    arquivadasTela = !!d.arquivadas;
    if (primeiraVez || !msgs.length) {
      geracaoJanela++;
      msgs = novas;
      maisAntigas = !!d.mais_antigas;
    } else if (novas.length) {
      // a página nova manda em tudo do primeiro ep dela pra frente; o que veio
      // rolando pra cima (mais velho que isso) fica
      const piso = novas[0].ep;
      msgs = msgs.filter(m => m.ep < piso).concat(novas);
    }
    msgs.sort((a, b) => a.ep - b.ep);
    carregouUmaVez = true;
    limpaPendentes();
    if (primeiraVez) marcaDivisor();
    render();
    const sep = primeiraVez && divisorEp != null ? wrap.querySelector('.novas-sep') : null;
    if (sep) rolagem.mostra(sep, { block: 'start' });
    else if (primeiraVez) {
      rolagem.aoFim();
      // conversa curta ou página que não encheu a tela: já pede as antigas
      verificaBordas();
    }
    trataAvisosThread(d.avisos || []);
    for (const f of ouvintesChegada.slice()) {
      try { f([]); } catch (e) { console.warn('ouvinte de chegada falhou:', e); }
    }
    ok = true;
  } catch (e) {
    mostraErro('Não consegui carregar a conversa: ' + e.message);
    if (!carregouUmaVez) { carregouUmaVez = true; render(); }
  }
  return ok;
}

async function carregaAntigas() {
  if (carregandoAntigas || !maisAntigas || !msgs.length) return;
  carregandoAntigas = true;
  const geracao = geracaoJanela;
  let ok = false;
  render({ segurarPosicao: true });
  try {
    const d = await api(API + '/messages?limit=' + PAGINA_ANTIGAS + '&before=' +
                        encodeURIComponent(menorEp()));
    // a janela foi trocada no meio do pedido: esta página é de outro trecho
    if (geracao === geracaoJanela) {
      const ids = new Set(msgs.map(m => m.id));
      const antigas = (d.msgs || []).filter(m => !ids.has(m.id));
      msgs = antigas.concat(msgs);
      maisAntigas = !!d.mais_antigas && antigas.length > 0;
      ok = true;
    }
  } catch (e) {
    mostraErro('Não consegui trazer as mensagens antigas: ' + e.message);
  } finally {
    carregandoAntigas = false;
    render({ segurarPosicao: true });
  }
  // A página nova pode não ter enchido a tela e, com o scrollTop reposicionado,
  // o iPhone não dispara mais scroll: sem este encadeamento a rolagem parava.
  if (ok || geracao !== geracaoJanela) requestAnimationFrame(verificaBordas);
}

/* Leva ao fim da conversa. */
function voltaAoFim() {
  rolagem.aoFim();
  atualizaSeta();
}

function verificaBordas() {
  if (!chat.clientHeight) return;      // tela escondida: não é rolagem de verdade
  if (chat.scrollTop < 600) carregaAntigas();
}
chat.addEventListener('scroll', verificaBordas, { passive: true });

/* Sentinelas fora do #wrap (o aplicaNos só mexe nos filhos dele). O evento de
   scroll sozinho falha no iPhone: com a inércia e o scrollTop reposicionado ele
   deixa de disparar, e o observador pega o mesmo caso por outro caminho. */
const sentTopo = document.createElement('div');
const sentFim = document.createElement('div');
for (const el of [sentTopo, sentFim]) {
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = 'height:1px;pointer-events:none';
}
chat.insertBefore(sentTopo, wrap);
chat.appendChild(sentFim);
if (typeof IntersectionObserver !== 'undefined') {
  const io = new IntersectionObserver(es => {
    if (es.some(e => e.isIntersecting)) verificaBordas();
  }, { root: chat, rootMargin: '600px 0px 600px 0px' });
  io.observe(sentTopo);
  io.observe(sentFim);
}

/* Cache no aparelho: ao abrir, a conversa aparece NA HORA com o que estava na
   tela da última vez, e a página nova chega por cima em seguida. Sai no logout. */
const CHAVE_CACHE = 'dgclaw:' + AGENTE.id + ':ultimas';
let cacheTimer = null;
function guardaCache() {
  if (cacheTimer) return;
  cacheTimer = setTimeout(() => {
    cacheTimer = null;
    try {
      const ultimas = msgs.slice(-PAGINA);
      localStorage.setItem(CHAVE_CACHE, JSON.stringify({ em: Date.now(), msgs: ultimas }));
    } catch (e) {
      console.warn('não consegui guardar a conversa no aparelho:', e.message);
    }
  }, 1500);
}
function leCache() {
  try {
    const d = JSON.parse(localStorage.getItem(CHAVE_CACHE) || 'null');
    if (d && Array.isArray(d.msgs) && d.msgs.length) return d.msgs;
  } catch (e) {
    console.warn('cache da conversa ilegível, ignorado:', e.message);
  }
  return null;
}
/* Sair apaga o que ficou guardado neste aparelho. */
$('formSair').addEventListener('submit', async ev => {
  ev.preventDefault();
  try {
    for (const k of Object.keys(localStorage)) if (k.indexOf('dgclaw:') === 0) localStorage.removeItem(k);
  } catch (e) { console.warn('não consegui limpar o aparelho ao sair:', e.message); }
  if (cacheMidias) await cacheMidias.limpar();
  ev.target.submit();
});

/* ── Stream: as mensagens chegam sozinhas (SSE) ──────────────────────────── */
/* Um EventSource só. Queda simples (rede, o servidor fechando depois de ~50
   min) o próprio navegador religa mandando Last-Event-ID. Se ele desistir
   (CLOSED: 401, 5xx, servidor fora), religo com espera crescente até 30 s. */
function maiorEp() {
  let ep = 0;
  for (const m of msgs) if (m.ep > ep) ep = m.ep;
  return ep;
}

function mudouStream() {
  pintaAtividade();
  if (streamAberto) {
    // só troca de volta pra "pronto" o que era estado de conexão
    if (ESTADOS_CONEXAO.includes(estadoEl.textContent) && !gravando && !esperando &&
        !falando) estadoOcioso();
  } else if (telaOciosa()) {
    estadoOcioso();
  }
}

let versaoVista = null;     // versao_js do primeiro "ola"; se mudar, o servidor foi atualizado

function ligaStream() {
  if (religaTimer) { clearTimeout(religaTimer); religaTimer = null; }
  if (fonte) fonte.close();
  streamAberto = false;
  const ep = maiorEp();
  const since = ep ? Math.floor(ep - 120) : 0;
  const es = new EventSource(API + '/stream?since=' + since);
  fonte = es;
  mudouStream();
  const abriu = () => {
    religaEspera = 3000;
    if (!streamAberto) {
      const religou = jaConectou;
      streamAberto = true; jaConectou = true; mudouStream();
      if (religou) { atualizaNaoLidas(); agendaLido(); }
    }
  };
  /* Cada evento traz JSON; JSON ruim vira aviso no console com o começo do
     texto, nunca erro mudo. */
  const ouve = (nome, fn, marcaAberto) => es.addEventListener(nome, ev => {
    if (fonte !== es) return;
    if (marcaAberto) abriu();
    let d;
    try {
      d = JSON.parse(ev.data);
    } catch (e) {
      console.warn('stream: evento ' + nome + ' com JSON inválido (' + e.message + '):',
                   String(ev.data).slice(0, 200));
      return;
    }
    fn(d);
  });
  ouve('ola', d => {
    if (d && d.versao_js) {
      if (versaoVista === null) versaoVista = d.versao_js;
      else if (versaoVista !== d.versao_js) {
        console.warn('versão da tela mudou no servidor (' + versaoVista + ' -> ' + d.versao_js +
                     '): recarrego a página assim que a tela estiver ociosa');
        precisaRecarregar = true;
        tentaRecarregar();
      }
    }
  }, true);
  ouve('msgs', integra, true);
  ouve('atividade', integraAtividade, false);
  ouve('foco', d => window.DGFoco && window.DGFoco.recebe(d), false);
  es.onerror = () => {
    if (fonte !== es) return;
    if (streamAberto) { streamAberto = false; mudouStream(); }
    if (es.readyState !== EventSource.CLOSED) return;   // o navegador religa sozinho
    console.warn('stream: conexão encerrada em ' + API + '/stream, religo em ' +
                 (religaEspera / 1000) + ' s');
    const espera = religaEspera;
    religaEspera = Math.min(religaEspera * 2, 30000);
    religaTimer = setTimeout(() => {
      religaTimer = null;
      // carregar() primeiro: se a sessão caiu, é ele que leva pro login
      carregar(false).then(ligaStream);
    }, espera);
  };
}

/* O iPhone mata a conexão com o app em segundo plano: ao voltar, conexão nova
   e a thread recarregada. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  /* O fetch que estava no ar quando o app foi pro fundo pode nunca voltar.
     Passados 90 s, o balão vira 'falhou' (com reenviar); se a resposta ainda
     chegar depois, mandaTexto promove pra 'enviada'. */
  for (const p of pendentes) {
    if (p.estado === 'enviando' && Date.now() - p.tentouEm > 90000) {
      marcaFalhou(p, 'o envio ficou pendurado enquanto o app estava em segundo plano');
    }
  }
  ligaStream();
  carregar(false);
});

/* ── Página velha: o servidor avisa no "ola" que o JS mudou ─────────────── */
/* Recarregar joga fora o que só existe na memória desta página: gravação,
   espera, chip de anexo, texto no campo e balão ainda não resolvido. Então só
   recarrega com tudo isso vazio, e tenta de novo a cada 5 s. */
let precisaRecarregar = false, recargaTimer = null;

function podeRecarregar() {
  return telaOciosa() && !anexos.length && !entrada.value.trim() &&
         !pendentes.some(p => p.estado === 'enviando' || p.estado === 'falhou' ||
                              p.estado === 'fila');
}

function tentaRecarregar() {
  if (!precisaRecarregar) return;
  if (podeRecarregar()) {
    console.warn('recarregando a página pra pegar o JS novo');
    location.reload();
    return;
  }
  if (!recargaTimer) recargaTimer = setInterval(tentaRecarregar, 5000);
}

/* Rede de segurança: o stream é a via principal; isto só pega o que ele
   perder por algum motivo que eu não previ. */
function ligaResync() {
  if (resyncTimer) return;
  resyncTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && !gravando) carregar(false);
  }, 90000);
}

/* ── Visor de arquivos ────────────────────────────────────────────────────
   Foto, vídeo e áudio abrem direto do arquivo. PDF abre numa moldura (no
   computador) e todo o resto vira um cartão com "abrir" e "baixar". O ✕ fica
   sempre no topo (abaixo do notch), e o "voltar" do sistema fecha o visor em
   vez de sair da conversa (pushState ao abrir, popstate fecha). */
let lbMid = null;
let visorNoHistorico = false, voltaPendente = false, voltaRelogio = null;
const visorAberto = () => lightbox.classList.contains('abre');
const btnLbFechar = $('lbFechar');
const lbTopo = lightbox.querySelector('.lbtopo');
// o ✕ vai pra esquerda, onde o polegar procura o "voltar" no iPhone
if (lbTopo && lbTopo.firstElementChild !== btnLbFechar) lbTopo.prepend(btnLbFechar);
btnLbFechar.setAttribute('aria-label', 'Fechar o arquivo e voltar pra conversa');

function marcaHistorico() {
  try {
    history.pushState(Object.assign({}, history.state || {}, { dgVisor: 1 }), '');
    visorNoHistorico = true;
  } catch (e) {
    visorNoHistorico = false;
    console.warn('visor sem entrada no histórico:', e.message);
  }
}
window.addEventListener('popstate', () => {
  if (voltaPendente) {
    voltaPendente = false;
    clearTimeout(voltaRelogio);
    // abriu outro arquivo antes do back terminar: empilha agora
    if (visorAberto() && !visorNoHistorico) marcaHistorico();
    return;
  }
  if (visorAberto() && visorNoHistorico) {
    visorNoHistorico = false;
    fechaLightbox(true);
  }
});

const ICO_ARQUIVO = '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3.5H7.5A2 2 0 0 0 5.5 5.5v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z"/><path d="M14 3.5V8h4.5M9 13h6M9 16.5h4"/></svg>';
function cartaoDoc(md) {
  const tam = md.bytes ? tamanhoHumano(md.bytes) : '';
  return `<div class="vcard"><div class="ico">${ICO_ARQUIVO}</div>` +
    `<b>${esc(md.nome || 'arquivo')}</b>` +
    `<small>${esc(tam)}${tam ? ' · ' : ''}Esse tipo de arquivo não tem prévia aqui.</small>` +
    `<div class="vcard-acoes"><a class="pri" href="${esc(md.url)}" download="${esc(md.nome || '')}">Baixar</a>` +
    `<a href="${esc(md.url)}" target="_blank" rel="noopener">Abrir em outra aba</a></div></div>`;
}
/* Arquivos de texto abrem formatados no visor: .md vira texto com títulos e listas; código, json,
   csv e txt vão no bloco de código da conversa (com Copiar e cores de sintaxe). */
const RX_TEXTO_LEGIVEL = /\.(md|markdown|txt|log|json|csv|tsv|ya?ml|toml|ini|env|sql|sh|bash|py|js|mjs|ts|php|html?|css|xml)$/i;
function ehTextoLegivel(md) { return !!(md && md.url && RX_TEXTO_LEGIVEL.test(md.nome || '') && !ehVisual(md) && (!md.bytes || md.bytes <= 512 * 1024)); }
// o Copiar dos blocos de código também funciona dentro do visor (ele fica fora do #wrap)
lbCorpo.addEventListener('click', ev => {
  const bt = ev.target.closest ? ev.target.closest('.codcopia') : null;
  if (!bt) return;
  const pre = bt.closest('.cod') && bt.closest('.cod').querySelector('pre');
  if (!pre) return;
  copiaTexto(pre.textContent).then(ok => { if (!ok) return; const tx = bt.querySelector('span'); bt.classList.add('ok'); if (tx) tx.textContent = 'Copiado'; setTimeout(() => { bt.classList.remove('ok'); if (tx) tx.textContent = 'Copiar'; }, 1600); });
});

async function abreTextoNoVisor(md) {
  const caixa = lbCorpo.querySelector('.lb-texto');
  try {
    const r = await fetch(md.url, { credentials: 'same-origin' });
    if (!r.ok) throw new Error('o servidor respondeu ' + r.status);
    const t = (await r.text()).slice(0, 512 * 1024);
    if (!caixa.isConnected) return;
    caixa.innerHTML = window.DGFormatador.arquivoParaHtml(t, md.nome);
  } catch (e) {
    if (caixa.isConnected) lbCorpo.innerHTML = cartaoDoc(md);
  }
}

/* Zoom só da FOTO aberta no visor (a página nunca amplia; ver sem-zoom.js).
   Pinça de dois dedos de 1x a 4x, um dedo arrasta quando ampliada, duplo toque
   alterna 1x/2x. Cada abertura cria uma <img> nova, então volta a 1x ao fechar. */
function ativaZoomImagem(img) {
  img.dataset.zoomProprio = '1';
  img.draggable = false;
  img.style.touchAction = 'none';
  img.style.transformOrigin = 'center center';
  let esc = 1, tx = 0, ty = 0;
  let dist0 = 0, esc0 = 1, ini = null, ultimoToque = 0, moveu = false;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const aplica = () => {
    if (esc <= 1.02) { esc = 1; tx = 0; ty = 0; }
    const mx = img.offsetWidth * (esc - 1) / 2, my = img.offsetHeight * (esc - 1) / 2;
    tx = Math.max(-mx, Math.min(mx, tx));
    ty = Math.max(-my, Math.min(my, ty));
    img.style.transform = esc === 1 ? '' : 'translate(' + tx + 'px,' + ty + 'px) scale(' + esc + ')';
  };
  const alterna = () => { esc = esc > 1 ? 1 : 2; tx = 0; ty = 0; aplica(); };
  img.addEventListener('touchstart', ev => {
    moveu = false;
    if (ev.touches.length === 2) { dist0 = dist(ev.touches) || 1; esc0 = esc; ini = null; }
    else if (ev.touches.length === 1) ini = { x: ev.touches[0].clientX, y: ev.touches[0].clientY, tx, ty };
  }, { passive: true });
  img.addEventListener('touchmove', ev => {
    ev.preventDefault();
    if (ev.touches.length === 2 && dist0) {
      moveu = true;
      esc = Math.max(1, Math.min(4, esc0 * dist(ev.touches) / dist0));
      aplica();
    } else if (ev.touches.length === 1 && ini && esc > 1) {
      const dx = ev.touches[0].clientX - ini.x, dy = ev.touches[0].clientY - ini.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) moveu = true;
      tx = ini.tx + dx; ty = ini.ty + dy;
      aplica();
    }
  }, { passive: false });
  img.addEventListener('touchend', ev => {
    if (ev.touches.length) { ini = null; return; }
    ini = null;
    if (moveu) { ultimoToque = 0; return; }
    const agora = Date.now();
    if (agora - ultimoToque < 300) { ultimoToque = 0; ev.preventDefault(); alterna(); }
    else ultimoToque = agora;
  }, { passive: false });
  if (!ehToque) img.addEventListener('dblclick', alterna);
}

function abreLightbox(mid, opt) {
  const md = midias[mid];
  if (!md) return;
  // visual (vis-*.html) e qualquer outro .html (relatório de agente, 24/10/2026) abrem desenhados, em tela
  // cheia, no mesmo quadro isolado do visual; `texto` pede o visor de arquivo
  if ((ehVisual(md) || (md.kind === 'document' && /\.html?$/i.test(md.nome || ''))) && !(opt && opt.texto)) {
    abreTelaVisual(md); return;
  }
  const jaAberto = visorAberto();
  lbCorpo.innerHTML = '';
  lbMid = mid;
  lbNome.textContent = md.nome || 'arquivo';
  lbBaixar.href = md.url;
  lbBaixar.setAttribute('download', md.nome || '');
  const lbAbrir = document.getElementById('lbAbrir');
  if (lbAbrir) lbAbrir.href = md.url;
  lightbox.classList.toggle('lb-midia', md.kind === 'photo' || md.kind === 'video');
  const ehPdf = /\.pdf$/i.test(md.nome || '');
  if (md.kind === 'photo') {
    const img = document.createElement('img');
    img.alt = md.nome || 'foto';
    img.src = md.url;
    img.onerror = () => { lbCorpo.innerHTML = cartaoDoc(md); };
    ativaZoomImagem(img);
    lbCorpo.appendChild(img);
  } else if (md.kind === 'video') {
    const v = document.createElement('video');
    v.controls = true; v.autoplay = true; v.playsInline = true; v.src = md.url;
    v.onerror = () => { lbCorpo.innerHTML = cartaoDoc(md); };
    lbCorpo.appendChild(v);
  } else if (md.kind === 'audio' || md.kind === 'voice') {
    const a = document.createElement('audio');
    a.controls = true; a.autoplay = true; a.src = md.url;
    lbCorpo.appendChild(a);
  } else if (ehPdf && !ehToque) {
    const f = document.createElement('iframe');
    f.src = md.url;
    f.title = md.nome || 'PDF';
    lbCorpo.appendChild(f);
  } else if (ehTextoLegivel(md)) {
    // texto, markdown, código, json, csv: abre formatado aqui mesmo (19/10/2026)
    lbCorpo.innerHTML = '<div class="lb-texto"><p class="lb-carregando">Abrindo…</p></div>';
    abreTextoNoVisor(md);
  } else {
    lbCorpo.innerHTML = cartaoDoc(md);
  }
  lightbox.classList.add('abre');
  if (!jaAberto) {
    if (!voltaPendente) marcaHistorico();
    else visorNoHistorico = false;      // empilha quando o back pendente chegar
  }
}

function fechaLightbox(peloHistorico) {
  if (!visorAberto()) return;
  lightbox.classList.remove('abre');
  lbCorpo.innerHTML = '';       // para o vídeo/áudio de tocar ao fechar
  lbMid = null;
  if (peloHistorico !== true && visorNoHistorico) {
    // tira do histórico a entrada que o abrir empilhou
    visorNoHistorico = false;
    voltaPendente = true;
    clearTimeout(voltaRelogio);
    voltaRelogio = setTimeout(() => { voltaPendente = false; }, 1500);
    history.back();
  }
}
btnLbFechar.onclick = () => fechaLightbox();
lightbox.addEventListener('click', ev => {
  // tocar fora da foto fecha; no cartão não, que o toque ali é nos botões
  if (ev.target === lightbox || ev.target === lbCorpo) fechaLightbox();
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && visorAberto()) fechaLightbox();
});

/* Link pra um arquivo do próprio app (o agente escreveu a URL na mensagem):
   abre no visor em vez de navegar. */
const RE_URL_MIDIA = /^\/api\/v1\/media\/([^/?#]+)(?:\/.*)?$/;
document.addEventListener('click', ev => {
  const a = ev.target.closest ? ev.target.closest('a[href]') : null;
  if (!a || a === lbBaixar || a.hasAttribute('download') || a.closest('#lightbox')) return;
  let u;
  try { u = new URL(a.getAttribute('href'), location.href); } catch (e) { return; }
  if (u.host !== location.host) return;
  const m = RE_URL_MIDIA.exec(u.pathname);
  if (!m || !midias[m[1]]) return;
  ev.preventDefault();
  ev.stopPropagation();
  destravarAudio();
  abreLightbox(m[1]);
}, true);

/* App instalado no iPhone: link de fora abria numa janela do sistema POR CIMA
   do app, e a pessoa ficava presa nela. O esquema x-safari-https (iOS 17 em
   diante) entrega o endereço pro Safari de verdade. No navegador comum e fora
   do iPhone nada muda: o target=_blank já abre aba nova. */
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
document.addEventListener('click', ev => {
  if (!IOS || !document.documentElement.classList.contains('pwa')) return;
  if (ev.defaultPrevented) return;
  const a = ev.target.closest ? ev.target.closest('a[href]') : null;
  if (!a || a.hasAttribute('download')) return;
  let u;
  try { u = new URL(a.getAttribute('href'), location.href); } catch (e) { return; }
  if (u.origin === location.origin || !/^https?:$/.test(u.protocol)) return;
  ev.preventDefault();
  location.href = 'x-safari-' + u.href;
});

async function copiaTexto(t) {
  try {
    await navigator.clipboard.writeText(t);
    setEstado('texto copiado');
    return true;
  } catch (e) {
    mostraErro('O navegador não deixou copiar (' + e.message + '). Segure o texto ' +
               'no balão e use o "Copiar" do sistema.');
    return false;
  }
}

/* O quadradinho do bloco copia só o que está dentro dele. */
wrap.addEventListener('click', ev => {
  const bt = ev.target.closest ? ev.target.closest('.codcopia') : null;
  if (!bt) return;
  ev.preventDefault();
  ev.stopPropagation();
  const cx = bt.closest('.cod');
  const pre = cx ? cx.querySelector('pre') : (bt.parentElement ? bt.parentElement.querySelector('pre') : null);
  if (!pre) return;
  copiaTexto(pre.textContent).then(ok => {
    if (!ok) return;
    const tx = bt.querySelector('span');
    bt.classList.add('ok');
    if (tx) tx.textContent = 'Copiado';
    setTimeout(() => { bt.classList.remove('ok'); if (tx) tx.textContent = 'Copiar'; }, 1600);
  });
}, true);

wrap.addEventListener('click', ev => {
  const alvo = ev.target.closest ? ev.target.closest('.mid[data-mid], .cartaoarq[data-mid], .midver[data-mid]') : null;
  if (alvo) { destravarAudio(); abreLightbox(alvo.getAttribute('data-mid')); }
});

const ehToque = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches) ||
  /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');

/* ── Mandar arquivo (qualquer tipo: foto, vídeo, áudio, PDF, zip, planilha, código...) ── */
/* Um arquivo por pedido (POST /upload, multipart). O limite real é o do servidor
   (DGCLAW_WEB_MAX_UPLOAD_MB) e vem em /api/v1/agents; recusar aqui, antes de subir, evita
   gastar o 4G do celular num envio que o servidor ia devolver com 413. */
const TETO_UPLOAD = caps.limiteUpload > 0 ? caps.limiteUpload : 50 * 1024 * 1024;

function kindLocal(file) {
  const t = (file.type || '').toLowerCase();
  const n = (file.name || '').toLowerCase();
  if (t.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/.test(n)) return 'photo';
  if (t.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv|3gp)$/.test(n)) return 'video';
  if (t.startsWith('audio/') || /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/.test(n)) return 'audio';
  return 'document';
}

/* Vários anexos numa mensagem. Cada arquivo colado, arrastado ou escolhido ENTRA na
   fila do chip, na ordem, e já começa a subir (upload com enviar=0: fica
   guardado no servidor, nada sai pra agente). O Enter manda o texto e os ids
   de todos juntos pelo /send. Se um não sobe, a mensagem não sai: o cartão dele
   mostra o erro com "tentar de novo", e a pessoa decide. */
const MAX_ANEXOS = 10;          // teto de arquivos por mensagem
const SUBIDAS_JUNTAS = 2;       // em paralelo, sem afogar o 4G do iPhone
let seqAnexo = 0;
let enviarQuandoSubir = false;  // Enter apertado com anexo ainda subindo

/* Sobe um anexo (ou tenta de novo). Resposta de tentativa velha, ou de anexo
   já removido, não mexe em nada. */
function subirAnexo(a) {
  const tentativa = ++a.tentativa;
  a.estado = 'subindo';
  a.pct = 0;
  a.erro = null;
  atualizaCartao(a);
  const fd = new FormData();
  fd.append('file', a.file, a.nome);
  fd.append('enviar', '0');
  fd.append('cliente_id', a.cid);
  const xhr = new XMLHttpRequest();
  a.xhr = xhr;
  xhr.open('POST', API + '/upload');
  xhr.timeout = 600000;
  const vale = () => anexos.includes(a) && a.tentativa === tentativa;
  xhr.upload.onprogress = ev => {
    if (!ev.lengthComputable || !vale()) return;
    // 100% do envio ainda não é "pronto": falta o servidor gravar (e transcrever áudio)
    const pct = Math.min(99, Math.round(100 * ev.loaded / ev.total));
    if (pct !== a.pct) { a.pct = pct; atualizaCartao(a); pintaInfoAnexos(); }
  };
  const acaba = () => { if (a.xhr === xhr) a.xhr = null; };
  const falha = motivo => {
    acaba();
    if (!vale()) return;
    falhaAnexo(a, motivo);
  };
  xhr.onload = () => {
    if (xhr.status === 401) {
      location.href = '/login?next=' + encodeURIComponent(AQUI);
      return;
    }
    let d = null;
    try {
      d = JSON.parse(xhr.responseText);
    } catch (e) {
      console.warn('upload de anexo: resposta não é JSON (status ' + xhr.status + '):',
                   String(xhr.responseText).slice(0, 200));
    }
    if (xhr.status < 200 || xhr.status >= 300 || !d || d.ok === false || !d.anexo) {
      falha((d && d.erro) || ('o app respondeu ' + xhr.status));
      return;
    }
    acaba();
    if (!vale()) return;
    prontoAnexo(a, d);
  };
  xhr.onerror = () => falha('a rede caiu no meio do upload');
  xhr.ontimeout = () => falha('o app não respondeu em 10 min');
  xhr.onabort = () => acaba();
  xhr.send(fd);
}

function falhaAnexo(a, motivo) {
  a.estado = 'falhou';
  a.erro = motivo;
  a.pct = null;
  atualizaCartao(a);
  pintaInfoAnexos();
  const quem = '"' + a.nome + '"';
  if (enviarQuandoSubir) {
    enviarQuandoSubir = false;
    mostraErro('A mensagem NÃO saiu: o anexo ' + quem + ' não subiu (' + motivo +
               '). Toque em "tentar de novo" no cartão dele, ou tire ele no ✕, ' +
               'e envie de novo.');
    setEstado('anexo não subiu', true);
  } else {
    mostraErro('O anexo ' + quem + ' não subiu (' + motivo + '). Toque em ' +
               '"tentar de novo" no cartão dele ou tire ele no ✕.');
  }
  tocaSubidas();
}

function prontoAnexo(a, d) {
  if (d.media) midias[d.media.id] = d.media;
  a.estado = 'pronto';
  a.pct = null;
  a.id = d.anexo.id;
  a.path = d.anexo.path;
  if (d.media) a.previaServidor = d.media.thumb || d.media.url || null;
  atualizaCartao(a);
  pintaInfoAnexos();
  gravaRascunhoLogo();
  tocaSubidas();
  if (enviarQuandoSubir && anexos.every(x => x.estado === 'pronto')) despachaAnexos();
}

/* Põe pra subir os que estão na fila, até SUBIDAS_JUNTAS de cada vez. */
function tocaSubidas() {
  while (anexos.filter(a => a.estado === 'subindo').length < SUBIDAS_JUNTAS) {
    const prox = anexos.find(a => a.estado === 'espera');
    if (!prox) break;
    subirAnexo(prox);
  }
}

/* Enter com anexos. Tudo pronto: manda já. Algum falhou: não manda, explica.
   Algum ainda subindo: manda sozinho quando o último terminar. */
function enviarComAnexos() {
  const falhos = anexos.filter(a => a.estado === 'falhou');
  if (falhos.length) {
    mostraErro('A mensagem não saiu: ' + (falhos.length === 1
      ? 'o anexo "' + falhos[0].nome + '" não subiu'
      : falhos.length + ' anexos não subiram (' + falhos.map(a => a.nome).join(', ') + ')') +
      '. Toque em "tentar de novo" no cartão, ou tire no ✕, e envie de novo.');
    return;
  }
  if (anexos.every(a => a.estado === 'pronto')) { despachaAnexos(); return; }
  enviarQuandoSubir = true;
  mostraErro('');
  pintaInfoAnexos();
  setEstado('esperando os anexos subirem…');
}

/* Tudo subiu: o chip esvazia e vira um balão com o texto e as prévias. As URLs
   locais das prévias passam pro balão (ele é que as libera depois). */
function despachaAnexos() {
  enviarQuandoSubir = false;
  const lista = anexos.map(a => ({ id: a.id, kind: a.kind, nome: a.nome, path: a.path,
                                   bytes: a.bytes, previa: a.semPrevia ? null : a.url }));
  for (const a of anexos) if (a.semPrevia && a.url) URL.revokeObjectURL(a.url);
  anexos = [];
  pintaAnexos();
  const t = entrada.value.trim();
  entrada.value = '';
  ajustaCampo();
  gravaRascunho();
  vozNoCampo = false;
  enviarTexto(respondendo && t ? comResposta(t) : t, lista);
}

/* O ➕ abre um menuzinho (22/10/2026, a pedido do dono): Anexar arquivo e Nova conversa.
   A nova é o mesmo /clear (o servidor arquiva a anterior no Histórico) e pede um segundo
   toque, para um toque sem querer não limpar a tela. */
const menuMais = document.createElement('div');
menuMais.id = 'menuMais';
menuMais.setAttribute('role', 'menu');
menuMais.hidden = true;
menuMais.innerHTML =
  '<button type="button" role="menuitem" data-mais="anexar"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15 7"/></svg>' +
  '<span><b>Anexar arquivo</b><small>Fotos, vídeos, áudios, PDFs</small></span></button>' +
  // 23/10/2026 (opção A do dono): o Histórico sai da fileira de filtros do topo e vem para cá
  '<button type="button" role="menuitem" data-mais="historico"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>' +
  '<span><b>Conversas anteriores</b><small>Histórico e busca</small></span></button>' +
  '<div class="mm-sep"></div>' +
  '<button type="button" role="menuitem" data-mais="nova"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h8"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>' +
  '<span><b>Nova conversa</b><small>Guarda esta no Histórico</small></span></button>';
btnAnexo.parentElement.appendChild(menuMais);
const itemNova = menuMais.querySelector('[data-mais="nova"]');
let novaTimer = 0;
function novaPronta(sim) {
  clearTimeout(novaTimer);
  itemNova.classList.toggle('confirma', sim);
  itemNova.querySelector('b').textContent = sim ? 'Toque de novo para limpar' : 'Nova conversa';
  itemNova.querySelector('small').textContent = sim ? 'A conversa de agora vai para o Histórico' : 'Guarda esta no Histórico';
  if (sim) novaTimer = setTimeout(() => novaPronta(false), 4000);
}
function menuMaisAbre(abre) {
  menuMais.hidden = !abre;
  btnAnexo.classList.toggle('ativo', abre);
  btnAnexo.setAttribute('aria-expanded', abre ? 'true' : 'false');
  if (!abre) novaPronta(false);
}
btnAnexo.setAttribute('aria-haspopup', 'menu');
btnAnexo.onclick = () => {
  if (gravando) { cancelaGravacao(); return; }   // durante a gravação o ➕ vira ✕
  menuMaisAbre(menuMais.hidden);
};
menuMais.onclick = (ev) => {
  const b = ev.target.closest('[data-mais]');
  if (!b) return;
  if (b.dataset.mais === 'anexar') { menuMaisAbre(false); destravarAudio(); inputArquivo.click(); return; }
  if (b.dataset.mais === 'historico') {
    menuMaisAbre(false);
    if (window.DGHistorico) window.DGHistorico.abre({ id: AGENTE.id, nome: AGENTE.nome || 'o agente', soArquivadas: EH_ADMIN });
    else mostraErro('O Histórico não carregou. Recarregue a página.');
    return;
  }
  if (!itemNova.classList.contains('confirma')) { novaPronta(true); return; }
  menuMaisAbre(false);
  enviarTexto('/clear');
};
document.addEventListener('pointerdown', (ev) => {
  if (!menuMais.hidden && !menuMais.contains(ev.target) && !btnAnexo.contains(ev.target)) menuMaisAbre(false);
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !menuMais.hidden) menuMaisAbre(false); });
/* O 📎 também passa pelo chip: anexa, mostra a prévia, a legenda vai no campo
   e só o Enter (ou ➤) manda, tudo numa mensagem só. O input
   tem `multiple`: no iPhone dá pra marcar várias fotos de uma vez. */
inputArquivo.onchange = () => {
  const fs = Array.from(inputArquivo.files || []);
  inputArquivo.value = '';     // escolher o MESMO arquivo de novo tem que disparar
  anexaArquivos(fs);
};

/* ── Anexo pendente: colar (Ctrl+V) ou arrastar ───────────────────────────── */
/* Print colado ou arquivo solto na thread não vai na hora: vira um cartão no
   chip acima do campo (sobe em segundo plano), a pessoa escreve a legenda se
   quiser, e o Enter (ou ➤) manda tudo junto. */
const PLACEHOLDER_ORIGINAL = entrada.placeholder;
const raiz = document.documentElement;

/* O chip aumenta a barra de baixo, e as faixas de aviso (e o #chat fora do modo
   app) se posicionam por --barra-h: sem isto o chip ficaria por cima da faixa. */
function ajustaBarra() {
  // a faixa de miniaturas tem uns 150 px: o observador de rolagem mantém quem estava
  // no fim no fim, em vez de empurrar a última mensagem pra baixo da barra
  raiz.style.removeProperty('--barra-h');
  // o campo crescido (texto longo) também aumenta a barra
  const extra = (anexoChip.hidden ? 0 : anexoChip.offsetHeight + 6) +
                Math.max(0, entrada.offsetHeight - CAMPO_MIN);
  if (extra) {
    const base = parseFloat(getComputedStyle(raiz).getPropertyValue('--barra-h')) || 104;
    raiz.style.setProperty('--barra-h', Math.ceil(base + extra) + 'px');
  }
}

/* O campo cresce de 1 até 4 linhas com o texto (colar um texto longo agora dá
   pra ver o que vai sair, pedido de 03/10/2026); dali pra frente rola por
   dentro. Chamado a cada digitação e sempre que o código muda o valor. */
const CAMPO_MIN = 46, CAMPO_LINHAS = 4;

/* Ícones de linha da barra, no estilo do ChatGPT (17/10/2026). Strings fixas,
   nunca texto de fora, por isso o innerHTML é seguro aqui. */
const ICONE = {
  mais:   '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  fechar: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  mic:    '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
  gira:   '<svg class="gira" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"/></svg>',
  parar:  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2.5" fill="currentColor"/></svg>'
};
/* Enviar fica apagado com o campo vazio e sem anexo, como no ChatGPT. Só a
   aparência: o clique continua funcionando (Enter e /comandos também). */
function pintaEnviar() {
  if (typeof btnEnviar === 'undefined' || !btnEnviar) return;
  const vazio = !entrada.value.trim() && !(typeof anexos !== 'undefined' && anexos.length) &&
                !(typeof gravando !== 'undefined' && gravando);
  btnEnviar.classList.toggle('apagado', vazio);
  pintaParar();
}
/* Parar o trabalho (19/10/2026, pedido do dono, como no ChatGPT): enquanto o agente trabalha e o
   campo está vazio, a setinha vira um quadrado. Um toque manda Esc ao terminal dele
   (POST /interromper): para o turno de agora, sem apagar a conversa nem o que já foi feito. */
const ICO_ENVIAR = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
const ICO_PARAR = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/></svg>';
function pintaParar() {
  if (typeof btnEnviar === 'undefined' || !btnEnviar || typeof atividadeEl === 'undefined' || !atividadeEl) return;
  const trabalhando = !atividadeEl.hidden && atividadeEl.classList.contains('trab');
  const parar = trabalhando && btnEnviar.classList.contains('apagado') && !(typeof gravando !== 'undefined' && gravando);
  if (btnEnviar.classList.contains('parar') === parar) return;
  btnEnviar.classList.toggle('parar', parar);
  btnEnviar.innerHTML = parar ? ICO_PARAR : ICO_ENVIAR;
  btnEnviar.setAttribute('aria-label', parar ? 'Parar o que ' + AGENTE.nome + ' está fazendo' : 'Enviar');
  btnEnviar.title = parar ? 'Parar o que ' + AGENTE.nome + ' está fazendo' : '';
}
/* Parar (21/10/2026, no design do app): um cartão discreto em cima do campo, no lugar da faixa amarela.
   O servidor espera uns segundos para ver se o agente reagiu; congelado, o cartão oferece reiniciar a
   sessão (a mesma conversa, e as mensagens na fila continuam). */
const pararEl = document.createElement('div');
pararEl.id = 'pararCartao'; pararEl.hidden = true; pararEl.setAttribute('role', 'status');
{ const l1 = document.querySelector('.barra .linha1'); if (l1) l1.before(pararEl); }
let pararTimer = null;
const ICO_CARTAO_PARAR = {
  gira: '<i class="pa-gira" aria-hidden="true"></i>',
  ok: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4.5 4.5L19 7"/></svg>',
  alerta: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};
function pintaCartaoParar(estado, texto, acao) {
  clearTimeout(pararTimer);
  if (!estado) { pararEl.hidden = true; pararEl.innerHTML = ''; return; }
  pararEl.className = 'pa-' + estado;
  pararEl.innerHTML = `<span class="pa-ic">${estado === 'andando' ? ICO_CARTAO_PARAR.gira : estado === 'ok' ? ICO_CARTAO_PARAR.ok : ICO_CARTAO_PARAR.alerta}</span>` +
    `<span class="pa-tx">${texto}</span>` + (acao ? `<button type="button" class="pa-bt" data-pa="${acao.id}">${esc(acao.rotulo)}</button>` : '') +
    (estado === 'travado' || estado === 'erro' ? `<button type="button" class="pa-x" data-pa="fechar" title="Fechar" aria-label="Fechar">${ICO_CARTAO_PARAR.x}</button>` : '');
  pararEl.hidden = false;
  if (estado === 'ok') pararTimer = setTimeout(() => pintaCartaoParar(null), 3500);
}
pararEl.addEventListener('click', async ev => {
  const b = ev.target.closest('[data-pa]'); if (!b) return;
  if (b.dataset.pa === 'fechar') { pintaCartaoParar(null); return; }
  if (b.dataset.pa === 'destravar') {
    pintaCartaoParar('andando', `Reiniciando ${esc(AGENTE.nome)}…`);
    try {
      await api(API + '/destravar', { method: 'POST', body: {}, timeoutMs: 70000 });
      pintaCartaoParar('ok', `${esc(AGENTE.nome)} foi reiniciado. A conversa continua e as mensagens que esperavam vão chegar a ele.`);
    } catch (e) { pintaCartaoParar('erro', `Não consegui reiniciar: ${esc(e.message)}`); }
  }
});
async function interrompe() {
  btnEnviar.disabled = true;
  pintaCartaoParar('andando', `Parando ${esc(AGENTE.nome)}…`);
  try {
    const r = await api(API + '/interromper', { method: 'POST', body: {}, timeoutMs: 20000 });
    if (r && r.travado) pintaCartaoParar('travado', `<b>${esc(AGENTE.nome)} não reagiu.</b> Parece travado.`, { id: 'destravar', rotulo: 'Reiniciar' });
    else pintaCartaoParar('ok', `Parado. A conversa e o que ${esc(AGENTE.nome)} já fez continuam.`);
  } catch (e) { pintaCartaoParar('erro', 'Não consegui parar: ' + esc(e.message)); }
  finally { btnEnviar.disabled = false; }
}
function ajustaCampo() {
  try { pintaEspelho(); } catch (_) { /* a camada do @ ainda não existe (início da página) */ }
  const antes = entrada.offsetHeight;
  entrada.style.height = CAMPO_MIN + 'px';
  const cs = getComputedStyle(entrada);
  const linha = parseFloat(cs.lineHeight) || 20;
  const max = Math.ceil(linha * CAMPO_LINHAS + parseFloat(cs.paddingTop) +
                        parseFloat(cs.paddingBottom) + 2);
  // vazio: 1 linha (o placeholder comprido no celular não conta)
  const quer = entrada.value ? entrada.scrollHeight + 2 : CAMPO_MIN;
  const h = Math.max(CAMPO_MIN, Math.min(quer, max));
  entrada.style.height = h + 'px';
  entrada.style.overflowY = quer > max ? 'auto' : 'hidden';
  const l1 = entrada.parentElement;
  if (l1) l1.classList.toggle('cresceu', h > CAMPO_MIN);
  pintaEnviar();
  if (h !== antes) {
    ajustaBarra();
    if (typeof posicionaSeta === 'function') posicionaSeta();
  }
}
entrada.addEventListener('input', ajustaCampo);
entrada.addEventListener('input', gravaRascunhoLogo);
window.addEventListener('pagehide', gravaRascunho);

/* O cartão de cada anexo é montado uma vez (a miniatura não pisca a cada 1% de
   progresso); depois só o estado dele muda. */
function criaCartao(a) {
  const el = document.createElement('div');
  el.className = 'anx';
  el.setAttribute('role', 'listitem');
  el.dataset.anx = String(a.n);
  const rotulo = ROTULO_MIDIA[a.kind] || '📄 arquivo';
  let mid;
  if (a.url && a.kind === 'photo') {
    mid = `<img alt="${esc(a.nome)}" src="${a.url}">`;
  } else if (a.url && a.kind === 'video') {
    mid = `<video src="${a.url}" muted playsinline preload="metadata"></video>` +
          '<span class="anxplay" aria-hidden="true">▶</span>';
  } else {
    mid = `<span class="anxico">${esc(rotulo.split(' ')[0])}</span>`;
  }
  el.innerHTML =
    `<div class="anxmid">${mid}<span class="anxest"></span></div>` +
    `<div class="anxnome" title="${esc(a.nome)}">${esc(a.nome)}</div>` +
    `<div class="anxtam">${esc(tamanhoHumano(a.bytes))}</div>` +
    `<button class="anxde" type="button" hidden>tentar de novo</button>` +
    `<button class="anxx" type="button" aria-label="Tirar ${esc(a.nome)} da mensagem">✕</button>`;
  // imagem que o navegador não desenha (HEIC no Chrome): fica o ícone, o envio segue
  const img = el.querySelector('img');
  if (img) {
    img.onerror = () => {
      a.semPrevia = true;
      img.replaceWith(Object.assign(document.createElement('span'),
                                    { className: 'anxico', textContent: '📷' }));
    };
  }
  a.el = el;
  return el;
}

function atualizaCartao(a) {
  if (!a.el) return;
  const est = a.el.querySelector('.anxest');
  a.el.dataset.estado = a.estado;
  if (a.estado === 'subindo') a.el.style.setProperty('--pct', (a.pct || 0) + '%');
  est.textContent = a.estado === 'subindo' ? a.pct + '%'
    : a.estado === 'espera' ? 'na fila'
    : a.estado === 'falhou' ? '⚠ não subiu' : '✓';
  a.el.title = a.estado === 'falhou' ? a.nome + ': ' + a.erro : a.nome;
  a.el.querySelector('.anxde').hidden = a.estado !== 'falhou';
}

/* A linha embaixo das miniaturas: quantos, quanto falta e o que deu errado. */
function pintaInfoAnexos() {
  pintaInfoAnexosTexto();
  // o cartão que falhou ganha o botão "tentar de novo" e a linha pode quebrar:
  // a barra cresce, e as faixas de aviso sobem junto (senão cobrem o ✕)
  ajustaBarra();
}

function pintaInfoAnexosTexto() {
  if (!anexos.length) { anexoInfo.textContent = ''; anexoInfo.classList.remove('erro'); return; }
  const n = anexos.length;
  const falhos = anexos.filter(a => a.estado === 'falhou');
  const faltam = anexos.filter(a => a.estado === 'subindo' || a.estado === 'espera').length;
  let t = n === 1 ? '1 anexo' : n + ' anexos';
  if (falhos.length) {
    t += ' · ' + falhos.map(a => a.nome + ': ' + a.erro).join(' · ');
  } else if (faltam) {
    t += ' · ' + (n - faltam) + ' de ' + n + ' prontos, subindo o resto' +
         (enviarQuandoSubir ? ' (a mensagem sai sozinha quando terminar)' : '');
    // arquivo grande (em pedaços): quanto já foi, em MB, que 1% de 500 MB demora
    const gr = anexos.find(a => a.estado === 'subindo' && a.subidos != null);
    if (gr) t += ' · ' + gr.nome + ': ' + tamanhoHumano(gr.subidos) + ' de ' + tamanhoHumano(gr.bytes);
  } else {
    t += ' · prontos, Enter envia tudo junto';
  }
  if (n >= MAX_ANEXOS) t += ' (máximo de ' + MAX_ANEXOS + ')';
  anexoInfo.textContent = t;
  anexoInfo.classList.toggle('erro', falhos.length > 0);
}

/* Põe os cartões na ordem da fila e mostra ou esconde o chip. */
function pintaAnexos() {
  for (const el of Array.from(anexoLista.children)) {
    if (!anexos.some(a => a.el === el)) el.remove();
  }
  for (const a of anexos) {
    anexoLista.appendChild(a.el || criaCartao(a));   // appendChild reordena se já existe
    atualizaCartao(a);
  }
  anexoChip.hidden = !anexos.length;
  gravaRascunhoLogo();
  pintaEnviar();
  entrada.placeholder = anexos.length ? 'Legenda (opcional), Enter envia'
                                      : PLACEHOLDER_ORIGINAL;
  pintaInfoAnexos();
}

function tiraAnexo(a) {
  if (a.xhr) { try { a.xhr.abort(); } catch (e) { /* já acabou */ } }
  a.xhr = null;
  if (a.url) URL.revokeObjectURL(a.url);
  anexos = anexos.filter(x => x !== a);
  pintaAnexos();
  tocaSubidas();
  if (!anexos.length) {
    if (enviarQuandoSubir) { enviarQuandoSubir = false; estadoOcioso(); }
    mostraErro('');
  } else if (enviarQuandoSubir && anexos.every(x => x.estado === 'pronto')) {
    despachaAnexos();
  } else if (!anexos.some(x => x.estado === 'falhou')) {
    mostraErro('');
  }
}

/* Acrescenta (nunca substitui) os arquivos ao chip, na ordem em que vieram. */
function anexaArquivos(lista) {
  const fs = Array.from(lista || []).filter(Boolean);
  if (!fs.length) return;
  const recusados = [], deFora = [];
  for (const f of fs) {
    const nome = f.name || 'sem nome';
    if (f.size === 0) { recusados.push('"' + nome + '" tem 0 byte'); continue; }
    if (f.size > TETO_UPLOAD) {
      recusados.push('"' + nome + '" tem ' + tamanhoHumano(f.size) +
                     ' e o limite aqui é ' + Math.round(TETO_UPLOAD / 1048576) + ' MB');
      continue;
    }
    if (anexos.length >= MAX_ANEXOS) { deFora.push(nome); continue; }
    const kind = kindLocal(f);
    anexos.push({
      n: ++seqAnexo, file: f, kind: kind, nome: nome, bytes: f.size,
      url: (kind === 'photo' || kind === 'video') ? URL.createObjectURL(f) : null,
      estado: 'espera', pct: null, erro: null, id: null, path: null, xhr: null,
      tentativa: 0, el: null, semPrevia: false, cid: novoClienteId(),
    });
  }
  const avisos = [];
  if (recusados.length) avisos.push('Não anexei: ' + recusados.join('; ') + '.');
  if (deFora.length) {
    avisos.push('Cabem até ' + MAX_ANEXOS + ' anexos por mensagem e ' +
                (deFora.length === 1 ? 'ficou de fora "' + deFora[0] + '"'
                                     : 'ficaram de fora ' + deFora.length + ' (' +
                                       deFora.join(', ') + ')') +
                '. Envie esta e mande o resto na próxima.');
  }
  if (avisos.length) mostraErro(avisos.join(' '));
  pintaAnexos();
  tocaSubidas();
  entrada.focus();
}

anexoLista.addEventListener('click', ev => {
  const bt = ev.target.closest ? ev.target.closest('button') : null;
  const card = bt && bt.closest('.anx');
  if (!card) return;
  const a = anexos.find(x => String(x.n) === card.dataset.anx);
  if (!a) return;
  if (bt.classList.contains('anxx')) {
    tiraAnexo(a);
    entrada.focus();
  } else if (bt.classList.contains('anxde')) {
    mostraErro('');
    a.estado = 'espera';
    atualizaCartao(a);
    pintaInfoAnexos();
    tocaSubidas();
  }
});

/* Volta o rascunho guardado deste agente (texto e anexos que já tinham subido). */
(function voltaRascunho() {
  const d = leRascunho();
  if (!d) return;
  if (d.texto && !entrada.value) { entrada.value = d.texto; ajustaCampo(); }
  for (const x of Array.isArray(d.anexos) ? d.anexos.slice(0, MAX_ANEXOS) : []) {
    if (!x || !x.id) continue;
    const comPrevia = !!x.previa && (x.kind === 'photo' || x.kind === 'video');
    anexos.push({
      n: ++seqAnexo, file: null, kind: x.kind, nome: x.nome || 'anexo', bytes: x.bytes || 0,
      url: comPrevia && x.kind === 'photo' ? x.previa : null, previaServidor: x.previa || null,
      estado: 'pronto', pct: null, erro: null, id: x.id, path: x.path || null, xhr: null,
      tentativa: 0, el: null, semPrevia: !comPrevia || x.kind !== 'photo', cid: novoClienteId(),
    });
  }
  if (anexos.length) pintaAnexos();
  // o registro dos anexos é da memória do site: se ele reiniciou, o anexo guardado não vale mais
  for (const a of anexos.filter(x => x.previaServidor)) {
    fetch(a.previaServidor, { method: 'HEAD', credentials: 'same-origin' }).then(r => {
      if (r.status !== 404 || !anexos.includes(a)) return;
      tiraAnexo(a);
      mostraErro('O anexo "' + a.nome + '" do rascunho expirou (o S2 Bot reiniciou). Cole ou escolha o arquivo de novo.');
    }).catch(() => { /* sem rede: fica, e o envio avisa se faltar */ });
  }
})();

/* Todos os arquivos do que foi colado: print, várias imagens copiadas de uma
   vez, ou arquivos copiados no Finder/Explorer. */
function arquivosColados(ev) {
  const dt = ev.clipboardData;
  if (!dt) return [];
  const doItens = [];
  for (const it of Array.from(dt.items || [])) {
    if (it.kind === 'file') {
      const f = it.getAsFile();
      if (f) doItens.push(f);
    }
  }
  return doItens.length ? doItens : Array.from(dt.files || []);
}

/* O campo é um <textarea> comum: o evento paste nativo já entrega a imagem, sem
   precisar do navigator.clipboard.read(). O listener no document cobre o colar
   com o foco fora do campo. */
function aoColar(ev) {
  const fs = arquivosColados(ev);
  if (!fs.length) return;       // texto colado segue o caminho normal
  ev.preventDefault();
  ev.stopPropagation();
  anexaArquivos(fs);
}
entrada.addEventListener('paste', aoColar);
document.addEventListener('paste', ev => { if (ev.target !== entrada) aoColar(ev); });

/* Arrastar vale para a tela inteira (thread, campo, topo): antes só a thread
   aceitava, e soltar no campo fazia o navegador abrir o arquivo no lugar do
   chat. Enquanto o arquivo está em cima, uma moldura diz "Solte para anexar".
   O contador segura o dragleave que dispara a cada filho atravessado. */
const temArquivo = ev => ev.dataTransfer &&
  Array.from(ev.dataTransfer.types || []).includes('Files');
const soltaAqui = document.createElement('div');
soltaAqui.id = 'soltaAqui';
soltaAqui.hidden = true;
soltaAqui.innerHTML = '<div><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg><b>Solte para anexar</b></div>';
document.body.appendChild(soltaAqui);
let arrastoes = 0;
const soltaMostra = (sim) => { soltaAqui.hidden = !sim; if (!sim) arrastoes = 0; };
document.addEventListener('dragenter', ev => {
  if (!temArquivo(ev)) return;
  ev.preventDefault();
  arrastoes++;
  soltaMostra(true);
});
document.addEventListener('dragover', ev => {
  if (!temArquivo(ev)) return;
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('dragleave', ev => {
  if (!temArquivo(ev)) return;
  if (--arrastoes <= 0) soltaMostra(false);
});
document.addEventListener('drop', ev => {
  if (!temArquivo(ev)) return;
  ev.preventDefault();
  soltaMostra(false);
  const fs = Array.from((ev.dataTransfer.files) || []);
  if (fs.length) { anexaArquivos(fs); entrada.focus(); }
  else console.warn('drop sem arquivo legível:', ev.dataTransfer.types);
});
window.addEventListener('blur', () => soltaMostra(false));

/* ── Menu lateral (gaveta do ☰) ───────────────────────────────────────────── */
function abreMenu(abrir) {
  if (abrir) atualizaNaoLidas();
  menu.classList.toggle('abre', abrir);
  overlayMenu.classList.toggle('abre', abrir);
}
$('btnMenu').onclick = () => { destravarAudio(); abreMenu(true); };
$('btnFechaMenu').onclick = () => abreMenu(false);
overlayMenu.onclick = () => abreMenu(false);
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && menu.classList.contains('abre') && !document.getElementById('tourCaixa')) {
    abreMenu(false);
  }
});

/* Foto, seletor de agentes, páginas do painel e Configurações: tudo no menu-lado.js.
   A lista já veio do boot, então não é buscada de novo. */
window.DGMenuLado.inicia({ agente: AGENTE, agentes: agentesMenu, fecha: () => abreMenu(false), marcarNaoLida: (slug, ligar) => marcaNaoLida(slug, ligar) });

/* ── Bolinha de não lidas ────────────────────────────────────────────────────
   Quem guarda o "visto" é o servidor (por usuário e por agente), então o celular e o computador
   concordam. Aqui a tela só pede a contagem, pinta e avisa até onde esta conversa foi vista. */
/* Desde o selo de atenção, a contagem vem de GET /api/v1/estados, que traz por agente também o estado
   (trabalhando / precisa_de_voce / terminou / ocioso / sem_sinal), o resumo e a marca "não lida". */
let naoLidas = {};              // slug -> { estado, resumo, nao_lidas, mais, marcada_nao_lida, visto_ep, ultima_ep, marco_novo, erro }
let naoLidasEmVoo = null;
function textoBolinha(n) { return n && (n.mais || n.nao_lidas > 99) ? '99+' : String(n.nao_lidas); }
/* Marca (ligar=true) ou desmarca a conversa de um agente como não lida. O servidor guarda por usuário;
   a tela repinta com o estado que ele devolver na contagem seguinte. */
function marcaNaoLida(slug, ligar) {
  return api('/api/v1/agents/' + encodeURIComponent(slug) + '/nao-lido', ligar ? { method: 'POST', body: {}, timeoutMs: 15000 } : { method: 'DELETE', timeoutMs: 15000 })
    .then(() => atualizaNaoLidas());
}
/* No cabeçalho da conversa aberta: marca e leva a pessoa para fora (abre o menu), porque ficar nesta tela
   a faria "ler" de novo e o objetivo é voltar a isto depois. A marca só sai quando ela abrir a conversa. */
const btnNaoLida = $('btnNaoLida');
if (btnNaoLida) btnNaoLida.onclick = () => {
  btnNaoLida.disabled = true;
  marcaNaoLida(AGENTE.id, true)
    .then(() => { abreMenu(true); })
    .catch(e => mostraErro('Não consegui marcar a conversa como não lida: ' + e.message))
    .finally(() => { btnNaoLida.disabled = false; });
};
function atualizaNaoLidas() {
  if (naoLidasEmVoo) return naoLidasEmVoo;
  naoLidasEmVoo = api('/api/v1/estados', { timeoutMs: 15000 }).then(d => {
    if (!d || typeof d.agentes !== 'object' || !d.agentes) throw new Error('a resposta não trouxe o campo "agentes"');
    const novo = {};
    for (const slug of Object.keys(d.agentes)) {
      const n = d.agentes[slug];
      // falha pontual de um agente (nao_lidas null) não apaga a contagem que já tínhamos dele,
      // mas o estado novo (trabalhando, precisa de você, sem sinal) vale sempre
      novo[slug] = (n && typeof n.nao_lidas !== 'number' && naoLidas[slug])
        ? Object.assign({}, naoLidas[slug], { estado: n.estado, motivo: n.motivo, resumo: n.resumo, marcada_nao_lida: n.marcada_nao_lida })
        : n;
    }
    naoLidas = novo;
    window.DGMenuLado.defineNaoLidas(naoLidas);
    pintaTrocaBaixo();
    pintaBolinhaMenu();
  }).catch(e => {
    console.warn('não consegui atualizar o estado dos agentes e as não lidas (mantive o que a tela já tinha):', e.message);
  }).finally(() => { naoLidasEmVoo = null; });
  return naoLidasEmVoo;
}

/* Bolinha no ☰ com a soma dos outros agentes: no computador a fileira de avatares não aparece. */
function pintaBolinhaMenu() {
  const btn = $('btnMenu');
  if (!btn) return;
  const total = window.DGMenuLado.totalNaoLidas(agentesMenu, naoLidas, AGENTE.id);
  let b = btn.querySelector('.bolinha-menu');
  const precisam = window.DGMenuLado.totalPrecisam(agentesMenu, naoLidas, AGENTE.id);
  /* Quem precisa de você ganha o selo âmbar com "!" (vale mais que a bolinha vermelha de não lidas). */
  btn.classList.toggle('precisa', precisam > 0);
  let partes = [];
  if (precisam) partes.push(precisam + (precisam === 1 ? ' agente precisa de você' : ' agentes precisam de você'));
  if (total) partes.push(total + (total === 1 ? ' mensagem não lida' : ' mensagens não lidas') + ' em outros agentes');
  if (!total && !precisam) { if (b) b.remove(); btn.setAttribute('aria-label', 'Abrir o menu'); return; }
  if (!b) { b = document.createElement('span'); b.className = 'bolinha-menu'; b.setAttribute('aria-hidden', 'true'); btn.appendChild(b); }
  b.textContent = precisam ? '!' : '';
  btn.setAttribute('aria-label', 'Abrir o menu, ' + partes.join(', '));
}

let epLidoEnviado = 0, lidoTimer = null;
/* Só conta como lida a conversa que a pessoa está vendo no fim: rolar lá em cima relendo o passado
   não pode marcar como lidas as respostas novas que ainda estão abaixo. */
const pertoDoFim = () => distanciaDoFim() < 160;
function agendaLido() {
  if (document.visibilityState !== 'visible' || !msgs.length || !pertoDoFim()) return;
  const ep = maiorEp();
  if (!(ep > epLidoEnviado)) return;
  clearTimeout(lidoTimer);
  lidoTimer = setTimeout(() => {
    lidoTimer = null;
    if (document.visibilityState !== 'visible' || !pertoDoFim()) return;
    const alvo = maiorEp();
    if (!(alvo > epLidoEnviado)) return;
    api(API + '/lido', { method: 'POST', body: { ep: alvo }, timeoutMs: 15000 })
      .then(() => { epLidoEnviado = Math.max(epLidoEnviado, alvo); })
      .catch(e => console.warn('não consegui avisar o servidor que a conversa foi lida (tento de novo na próxima mensagem):', e.message));
  }, 1000);
}
/* "Abri a conversa": só isto limpa a marca "não lida" (o lido automático da rolagem não limpa, senão desfaria
   a marca na hora). Uma vez por carregamento da página, quando ela está visível. */
let abriuAvisado = false;
function avisaAbriu() {
  if (abriuAvisado || document.visibilityState !== 'visible') return;
  abriuAvisado = true;
  api(API + '/lido', { method: 'POST', body: { abriu: true }, timeoutMs: 15000 })
    .catch(e => { abriuAvisado = false; console.warn('não consegui avisar o servidor que abri a conversa (a marca de não lida pode continuar):', e.message); });
}
/* "Estou vendo": a cada 20 s com a aba visível. O servidor deixa de mandar aviso no celular de uma conversa
   que a pessoa está olhando agora. */
function avisaVendo() {
  if (document.visibilityState !== 'visible') return;
  api(API + '/vendo', { method: 'POST', body: {}, timeoutMs: 10000 })
    .catch(e => console.warn('não consegui avisar que estou vendo esta conversa (o celular pode avisar à toa):', e.message));
}
avisaAbriu(); avisaVendo();
setInterval(avisaVendo, 20000);
ouvintesChegada.push(agendaLido);
// voltar a rolar até o fim reavalia (o debounce de agendaLido junta a rolagem toda)
chat.addEventListener('scroll', agendaLido, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  avisaAbriu(); avisaVendo();
  agendaLido();
  atualizaNaoLidas();
});
// quem fica parado nesta conversa também vê chegar mensagem e mudança de estado em outro agente:
// a cada 10 s com a aba visível, a cada 60 s escondida
let ultimoEstados = 0;
setInterval(() => {
  const agora = Date.now();
  if (document.visibilityState !== 'visible' && agora - ultimoEstados < 60000) return;
  ultimoEstados = agora;
  atualizaNaoLidas();
}, 10000);
atualizaNaoLidas();

/* Celular: a mesma lista do menu vira uma fileira de avatares embaixo, com a agente atual
   destacada. O link é o mesmo do menu (/a/<id>). Com uma agente só, a fileira fica vazia e o CSS a esconde. */
function pintaTrocaBaixo() {
  const baixo = $('trocaBaixo');
  if (!baixo) return;
  // 23/10/2026 (pedido do dono): no S2 Bot a troca é pela fileira do topo; a de baixo some e a bolinha
  // de não lidas vai para as fotos de cima (pintaNaoLidasTopo). O desenho de baixo fica, sem uso.
  document.body.classList.remove('com-troca');
  baixo.innerHTML = '';
  pintaNaoLidasTopo();
  return;
  // eslint-disable-next-line no-unreachable
  document.body.classList.toggle('com-troca', agentesMenu.length >= 2);
  if (agentesMenu.length < 2) { baixo.innerHTML = ''; return; }
  baixo.innerHTML = agentesMenu.map(a => {
    const atual = a.id === AGENTE.id;
    const foto = a.avatar_img || (/^https:\/\//i.test(a.avatar || '') ? a.avatar : '');
    const av = foto ? `<img src="${esc(foto)}" alt="">` : esc(a.avatar || (a.nome || '?').slice(0, 1));
    const rot = a.nome + (a.subtitulo ? ', ' + a.subtitulo : '');
    const selo = window.DGMenuLado.seloDe(naoLidas[a.id], atual);
    const aviso = selo ? ', ' + selo.rotulo : '';
    const marcaSelo = !selo ? ''
      : selo.tipo === 'precisa' ? '<span class="selo-aten" aria-hidden="true">!</span>'
      : selo.tipo === 'nao_lido' ? `<span class="bolinha-nl" aria-hidden="true">${textoBolinha(naoLidas[a.id])}</span>`
      : selo.tipo === 'marcada' ? '<span class="bolinha-nl ponto" aria-hidden="true"></span>'
      : '<span class="selo-trab" aria-hidden="true"></span>';
    return `<a href="/a/${encodeURIComponent(a.id)}" title="${esc(rot)}" ` +
      (atual ? `class="atual" aria-current="page" style="--cor-troca:${esc(a.cor || '#2f9e5e')}" ` : '') +
      `aria-label="Abrir a conversa com ${esc(rot + aviso)}"><div class="av" style="background:${esc(a.cor || '#2f9e5e')}">${av}</div>` +
      `${marcaSelo}</a>`;
  }).join('');
  centralizaTrocaBaixo();
}
/* Não lidas nas fotos do topo: o número vermelho (todas as respostas não vistas, que já incluem
   entregas e pedidos), um ponto quando a conversa foi marcada, e "!" âmbar quando precisa de você.
   Com o número vermelho, o número azul de avisos (fil-badge) sai para não haver dois. */
function pintaNaoLidasTopo() {
  const nav = $('fileira');
  if (!nav || !window.DGMenuLado) return;
  for (const el of nav.querySelectorAll('.fil[data-avt]')) {
    const id = el.dataset.avt;
    const selo = window.DGMenuLado.seloDe(naoLidas[id], id === AGENTE.id);
    let b = el.querySelector('.fil-nl');
    const tipo = selo && (selo.tipo === 'nao_lido' || selo.tipo === 'marcada' || selo.tipo === 'precisa') ? selo.tipo : '';
    el.classList.toggle('tem-nl', !!tipo);
    if (!tipo) { if (b) b.remove(); continue; }
    if (!b) { b = document.createElement('span'); el.appendChild(b); }
    b.className = 'fil-nl' + (tipo === 'marcada' ? ' ponto' : tipo === 'precisa' ? ' aten' : '');
    b.textContent = tipo === 'nao_lido' ? textoBolinha(naoLidas[id]) : tipo === 'precisa' ? '!' : '';
    b.title = selo.rotulo || '';
  }
}
// sem scrollIntoView: ele rolaria a página toda
function centralizaTrocaBaixo() {
  const baixo = $('trocaBaixo'), atual = baixo && baixo.querySelector('.atual');
  if (atual && baixo.clientWidth) baixo.scrollLeft = atual.offsetLeft - (baixo.clientWidth - atual.offsetWidth) / 2;
}
pintaTrocaBaixo();
window.addEventListener('resize', centralizaTrocaBaixo);
// ?texto=... chega do painel (ex.: "editar" numa rotina): o pedido já vem escrito no campo, sem
// enviar sozinho, e o parâmetro sai da barra para não reaparecer ao recarregar.
try {
  const u = new URL(location.href);
  const pronto = u.searchParams.get('texto');
  if (pronto) {
    entrada.value = pronto.slice(0, 2000);
    entrada.dispatchEvent(new Event('input'));
    entrada.focus();
    u.searchParams.delete('texto');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  }
} catch (e) { console.warn('[conversa] não consegui preencher o texto vindo do link:', e.message); }

/* O Safari só deixa tocar som num <audio> que já tocou dentro de um gesto do
   dedo. Então no PRIMEIRO toque da tela eu toco um mp3 em silêncio nesse mesmo
   elemento, e daí pra frente o play() assíncrono do TTS passa. Trocar de
   elemento quebra tudo, por isso o #player é um só pra toda a sessão. */
function destravarAudio() {
  if (audioDestravado) return;
  audioDestravado = true;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      ctxAudio = ctxAudio || new AC();
      if (ctxAudio.state === 'suspended') ctxAudio.resume();
    }
  } catch (e) {
    console.warn('AudioContext:', e.message);
  }
  try {
    player.src = SILENCIO;
    const p = player.play();
    if (p && p.catch) p.catch(e => console.warn('destrave:', e.message));
  } catch (e) {
    console.warn('destrave:', e.message);
  }
}
document.addEventListener('pointerdown', destravarAudio, { once: true, capture: true });
document.addEventListener('touchstart', destravarAudio, { once: true, capture: true });

/* ── Gravar e transcrever (só quando o servidor libera o microfone) ───────── */
function melhorMime() {
  if (!window.MediaRecorder) return null;
  const cands = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
  for (const c of cands) {
    if (!MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

function extensaoDe(mime) {
  if (!mime) return 'bin';
  if (mime.indexOf('mp4') >= 0) return 'm4a';
  if (mime.indexOf('webm') >= 0) return 'webm';
  if (mime.indexOf('ogg') >= 0) return 'ogg';
  if (mime.indexOf('wav') >= 0) return 'wav';
  return 'bin';
}

/* Parar a gravação ESCREVE a transcrição no campo pra revisar; a seta verde
   durante a gravação transcreve e manda direto. Na conversa contínua, parar já
   manda. */
let vozNoCampo = false;    // o texto do campo veio de uma transcrição
let micAbrindo = false;
let gravacao = null;       // { stream, rec, pedacos, mime, inicio, parado }
let pedindoMic = false;    // getUserMedia em voo: o segundo toque espera
let transcrevendo = false;
let timerGravando = null;

function tempoGravando() {
  const t0 = gravacao && gravacao.inicio;
  const s = t0 ? Math.max(0, Math.floor((Date.now() - t0) / 1000)) : 0;
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/* Onda do ditado (17/10/2026): uma linha de pontinhos que corre da direita para
   a esquerda, com cada ponto subindo conforme o volume da voz, como no ditado do
   ChatGPT. Lê o mesmo stream da gravação por um AnalyserNode; não grava nada. */
const micOnda = $('micOnda');
let onda = null;   // { ctx, fonte, an, buf, niveis, raf, ultimo, proprio }
function ondaLiga(stream) {
  if (onda || !micOnda || !stream) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const proprio = !ctxAudio;
    const ctx = ctxAudio || new AC();
    if (ctx.state === 'suspended') ctx.resume();
    const fonte = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    fonte.connect(an);
    onda = { ctx, fonte, an, buf: new Uint8Array(an.fftSize), niveis: [], raf: 0, ultimo: 0, proprio };
    const passo = t => {
      if (!onda) return;
      onda.raf = requestAnimationFrame(passo);
      if (t - onda.ultimo < 70) return;          // ~14 pontos novos por segundo
      onda.ultimo = t;
      onda.an.getByteTimeDomainData(onda.buf);
      let soma = 0;
      for (const v of onda.buf) { const d = (v - 128) / 128; soma += d * d; }
      onda.niveis.push(Math.min(1, Math.sqrt(soma / onda.buf.length) * 4));
      if (onda.niveis.length > 400) onda.niveis.shift();
      ondaDesenha();
    };
    onda.raf = requestAnimationFrame(passo);
  } catch (e) {
    console.warn('onda do microfone:', e.message);
    ondaDesliga();
  }
}
function ondaDesenha() {
  const dpr = window.devicePixelRatio || 1;
  const w = micOnda.clientWidth, h = micOnda.clientHeight;
  if (!w || !h) return;
  if (micOnda.width !== Math.round(w * dpr)) { micOnda.width = Math.round(w * dpr); micOnda.height = Math.round(h * dpr); }
  const c = micOnda.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const esp = 6, n = Math.floor(w / esp), meio = h / 2;
  const niv = onda ? onda.niveis : [];
  for (let i = 0; i < n; i++) {
    const v = niv[niv.length - n + i] || 0;      // o mais novo fica na direita
    const alt = Math.max(2.5, v * (h - 6));
    c.fillStyle = v > 0.04 ? '#5d6a61' : '#c5ccc7';
    const x = w - (n - i) * esp + 2;
    c.beginPath();
    if (c.roundRect) c.roundRect(x, meio - alt / 2, 2.5, alt, 1.25); else c.rect(x, meio - alt / 2, 2.5, alt);
    c.fill();
  }
}
function ondaDesliga() {
  if (!onda) return;
  cancelAnimationFrame(onda.raf);
  try { onda.fonte.disconnect(); } catch (e) {}
  if (onda.proprio) { try { onda.ctx.close(); } catch (e) {} }
  onda = null;
  if (micOnda) micOnda.getContext('2d').clearRect(0, 0, micOnda.width, micOnda.height);
}

function pintaMic() {
  btnMic.classList.toggle('gravando', gravando);
  if (btnMic.parentElement) {
    btnMic.parentElement.classList.toggle('ditando', gravando);
    btnMic.parentElement.classList.toggle('transcrevendo', transcrevendo);
  }
  if (gravando && !micAbrindo && gravacao && gravacao.stream) ondaLiga(gravacao.stream);
  else if (!gravando) ondaDesliga();
  btnMic.innerHTML = (micAbrindo || transcrevendo) ? ICONE.gira : gravando ? ICONE.parar : ICONE.mic;
  btnMic.setAttribute('aria-label', gravando
    ? (continua ? 'Parar e enviar' : 'Parar e escrever no campo')
    : 'Gravar áudio');
  btnEnviar.classList.toggle('direto', gravando);
  pintaEnviar();
  btnEnviar.setAttribute('aria-label', gravando ? 'Parar e enviar direto' : 'Enviar');
  /* O estado vai dentro do campo (#micTxt) e o 📎 vira ✕ que cancela a gravação. */
  if (micAbrindo) micTxt.textContent = 'abrindo o microfone…';
  else if (gravando) micTxt.textContent = '● ' + tempoGravando();
  else micTxt.textContent = '';
  micTxt.classList.toggle('vivo', gravando && !micAbrindo);
  btnAnexo.classList.toggle('cancela', gravando);
  btnAnexo.innerHTML = gravando ? ICONE.fechar : ICONE.mais;
  btnAnexo.setAttribute('aria-label', gravando ? 'Cancelar a gravação'
    : 'Anexar arquivo ou começar uma conversa nova');
  btnAnexo.title = gravando ? 'Cancelar a gravação (nada é enviado)'
    : 'Anexar arquivo ou começar uma conversa nova';
  if (gravando) menuMaisAbre(false);
  clearInterval(timerGravando);
  timerGravando = gravando && !micAbrindo ? setInterval(pintaMic, 500) : null;
}

function soltaMicrofone(g) {
  try {
    if (g && g.stream) g.stream.getTracks().forEach(t => t.stop());
  } catch (e) {
    console.warn('não consegui parar as trilhas do microfone:', e.message);
  }
  if (g) g.stream = null;
}

async function comecaGravar() {
  destravarAudio();
  if (!caps.microfone) return;
  if (gravando || pedindoMic || gravacao) return;
  const mime = melhorMime();
  if (mime === null) {
    mostraErro('Este navegador não grava áudio (sem MediaRecorder). ' +
               'No iPhone use o Safari, ou escreva no campo de texto.');
    return;
  }
  mostraErro('');
  setEstado('pedindo o microfone…');
  let stream;
  pedindoMic = true;
  // a leitura em curso é pausada (não cancelada) e a fila espera a gravação acabar
  pausaPelaGravacao();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    const nome = e && e.name;
    if (nome === 'NotAllowedError' || nome === 'SecurityError') {
      mostraErro('Microfone negado: libere o microfone para ' + location.host +
                 ' nas permissões do navegador e recarregue esta página.');
    } else if (nome === 'NotFoundError') {
      mostraErro('Nenhum microfone encontrado neste aparelho.');
    } else {
      mostraErro('Não consegui abrir o microfone (' + (nome || 'erro') + ': ' +
                 (e && e.message) + ').');
    }
    setEstado('erro no microfone', true);
    return;
  } finally {
    pedindoMic = false;
    if (!stream) filaRetoma();    // o microfone não abriu: a leitura volta
  }
  const g = { stream: stream, rec: null, pedacos: [], mime: mime, inicio: 0, parado: false,
              erro: null, blob: null, aoParar: null };
  let r;
  try {
    r = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  } catch (e) {
    soltaMicrofone(g);
    mostraErro('Não consegui iniciar a gravação (' + e.message + ').');
    setEstado('erro no microfone', true);
    filaRetoma();
    return;
  }
  g.rec = r;
  gravacao = g;
  // cada gravação enxerga só os pedaços dela (um pedaço atrasado da anterior
  // no começo da seguinte corrompe o arquivo)
  r.ondataavailable = ev => {
    if (!ev.data || !ev.data.size || g.parado) return;
    g.pedacos.push(ev.data);
  };
  r.onerror = ev => {
    g.erro = (ev.error && ev.error.name) || 'erro';
    mostraErro('A gravação falhou no meio (' + g.erro + '). O que já foi gravado vai ser enviado.');
    setEstado('erro na gravação', true);
  };
  r.onstop = () => {
    if (g.parado) return;
    g.parado = true;
    soltaMicrofone(g);
    g.blob = g.pedacos.length
      ? new Blob(g.pedacos, { type: (g.rec && g.rec.mimeType) || g.mime || 'audio/mp4' }) : null;
    if (g.aoParar) { g.aoParar(); return; }
    // Parou sem ninguém pedir (o aparelho tomou o microfone pra uma ligação):
    // o que foi gravado segue o caminho normal em vez de sumir.
    if (gravacao === g && gravando) paraEEnvia(false);
  };
  /* "Gravando" só aparece quando o gravador avisa que começou de verdade: antes
     o começo da frase se perdia no iPhone. */
  micAbrindo = true;
  gravando = true;
  pintaMic();
  setEstado('abrindo o microfone…');
  r.onstart = () => {
    g.inicio = Date.now();
    if (gravacao !== g) return;
    micAbrindo = false;
    pintaMic();
    setEstado('gravando…');
  };
  try {
    r.start(1000);
  } catch (e) {
    micAbrindo = false;
    gravando = false;
    gravacao = null;
    soltaMicrofone(g);
    pintaMic();
    mostraErro('Não consegui começar a gravar (' + e.message + ').');
    setEstado('erro no microfone', true);
    filaRetoma();
  }
}

/* Termina a gravação e devolve o blob (ou null se não sobrou nada). */
function paraGravacao() {
  const g = gravacao;
  gravacao = null;
  if (!g) return Promise.resolve(null);
  return new Promise(resolve => {
    const fim = () => { soltaMicrofone(g); resolve(g.blob || null); };
    if (g.parado) { fim(); return; }
    g.aoParar = fim;
    try {
      if (g.rec.state !== 'inactive') g.rec.stop();
    } catch (e) {
      console.warn('stop() falhou:', e.message);
    }
    // o Safari às vezes não dispara o onstop: em 4 s fica com o que já chegou
    setTimeout(() => {
      if (g.parado) return;
      console.warn('o onstop não veio em 4 s; sigo com ' + g.pedacos.length + ' pedaços');
      g.parado = true;
      g.blob = g.pedacos.length ? new Blob(g.pedacos, { type: g.mime || 'audio/mp4' }) : null;
      fim();
    }, 4000);
  });
}

/* Para e transcreve. `direto`: manda na hora; senão o texto vai pro campo. */
async function paraEEnvia(direto) {
  micAbrindo = false;
  if (!gravando && !gravacao) return;   // dois toques no ■: o segundo não faz nada
  const blob = await paraGravacao();
  gravando = false;
  pintaMic();
  filaRetoma();    // na hora, sem esperar a transcrição
  if (!blob || blob.size < 1024) {
    mostraErro('A gravação saiu vazia (' + (blob ? blob.size : 0) + ' bytes). ' +
               'Toque no microfone, espere aparecer "gravando", fale, e toque de novo.');
    estadoOcioso();
    return;
  }
  const item = { blob: blob, manda: direto || continua, clienteId: novoClienteId() };
  await transcreveEEntrega(item);
}

async function cancelaGravacao() {
  await paraGravacao();
  gravando = false;
  micAbrindo = false;
  pintaMic();
  estadoOcioso();
  filaRetoma();
}

btnMic.onclick = () => {
  destravarAudio();
  if (transcrevendo) return;
  if (gravando) paraEEnvia(false); else comecaGravar();
};

/* Uma ida ao /transcribe: multipart com o áudio (`audio`) e o `cliente_id`.
   Devolve o texto; erro leva a mensagem pronta pra tela. */
async function transcreveAudio(item) {
  const fd = new FormData();
  fd.append('audio', item.blob, 'fala.' + extensaoDe(item.blob.type));
  fd.append('cliente_id', item.clienteId);
  fd.append('agent_id', AGENTE.id);
  let r;
  try {
    r = await fetch('/api/v1/transcribe', { method: 'POST', body: fd });
  } catch (e) {
    throw new Error('a rede caiu antes da resposta (' + (e.message || 'sem rede') + ')');
  }
  if (r.status === 401) {
    location.href = '/login?next=' + encodeURIComponent(AQUI);
    throw new Error('a sessão expirou');
  }
  let d = null;
  try { d = await r.json(); } catch (e) { d = null; }
  if (r.ok && d && d.ok !== false) return (d.text || '').trim();
  if (r.status === 413) throw new Error('o áudio passou do limite de tamanho (413)');
  throw new Error((d && d.erro) || ('a API respondeu ' + r.status + ' sem explicar o motivo'));
}

/* Transcreve e entrega o texto pelo caminho de sempre (campo ou envio direto). */
async function transcreveEEntrega(item) {
  if (transcrevendo) return;
  transcrevendo = true;
  mostraErro('');
  setEstado('transcrevendo…');
  micTxt.textContent = 'Transcrevendo';
  micTxt.classList.add('vivo');
  btnMic.disabled = true;
  pintaMic();
  micTxt.textContent = 'Transcrevendo';
  let texto = '';
  try {
    texto = await transcreveAudio(item);
  } catch (e) {
    erroComTentarDeNovo('Não consegui transcrever: ' + e.message +
                        '. O áudio ficou guardado nesta tela até você sair dela.', item);
    setEstado('erro na transcrição', true);
    return;
  } finally {
    transcrevendo = false;
    btnMic.disabled = false;
    pintaMic();
  }
  await entregaTranscricao(texto, item.manda);
}

async function entregaTranscricao(texto, manda) {
  if (!texto) {
    mostraErro('A transcrição voltou vazia: não ouvi fala nenhuma nesse áudio. ' +
               'Fale mais perto do microfone.');
    estadoOcioso();
    return;
  }
  if (!manda) {
    // escreve no campo, somando ao que já estava lá; a pessoa revisa e manda
    const atual = entrada.value.trim();
    entrada.value = atual ? atual + ' ' + texto : texto;
    ajustaCampo();
    entrada.focus();
    try { entrada.setSelectionRange(entrada.value.length, entrada.value.length); }
    catch (e) { /* campo sem seleção (raro): segue */ }
    vozNoCampo = true;
    setEstado('transcrição no campo: revise e envie');
    return;
  }
  // Com anexos na bandeja (18/10/2026): a fala vira a legenda e vai junto com eles, como se a pessoa
  // tivesse digitado e tocado na seta. Antes ia só o texto e os anexos ficavam para trás.
  if (anexos.length) {
    const atual = entrada.value.trim();
    entrada.value = atual ? atual + ' ' + texto : texto;
    ajustaCampo();
    enviarComAnexos();
    return;
  }
  // envio direto sem revisão: o agente fica sabendo que pode haver erro de transcrição
  await enviarTexto(PURO.textoDaFala(texto, true));
}

/* Botões dentro de uma faixa. A faixa() limpa os botões a cada texto novo,
   então um aviso que chega depois nunca herda o "Tentar de novo" de outro. */
function faixaComAcoes(el, txt, acoes) {
  faixa(el, txt);
  const caixa = document.createElement('span');
  caixa.className = 'acoes';
  for (const a of acoes) {
    const b = document.createElement('button');
    b.className = 'mini';
    b.type = 'button';
    b.textContent = a.rotulo;
    if (a.id) b.id = a.id;
    b.onclick = ev => { ev.stopPropagation(); a.fn(b); };
    caixa.appendChild(b);
  }
  el.appendChild(caixa);
  respiroDasFaixas();
}

function erroComTentarDeNovo(msg, item) {
  faixaComAcoes(fErro, msg, [{
    rotulo: 'Tentar de novo', id: 'audioTentar',
    fn: () => { if (!transcrevendo && !gravando) transcreveEEntrega(item); },
  }]);
}

/* ── Mandar e esperar ─────────────────────────────────────────────────────── */
let seqPendente = 0;

/* Id do balão (ou do anexo) que o servidor usa pra não mandar duas vezes: o
   "reenviar" leva o MESMO id, e se a tentativa antiga ainda está no ar o
   servidor espera ela e devolve a mesma resposta (05/10/2026). */
function novoClienteId() {
  return 'tela-' + Date.now() + '-' + Math.random().toString(16).slice(2, 10);
}

function novoPendente(texto) {
  const agora = new Date();
  return {
    n: ++seqPendente, texto: texto, estado: 'enviando', erro: null, cid: novoClienteId(),
    criadoEm: Date.now(), epLocal: Date.now() / 1000, tentativa: 0,
    hhmm: agora.toTimeString().slice(0, 5),
    dia: agora.toLocaleDateString('pt-BR'),
  };
}

/* Cada envio ganha um número: é assim que uma resposta atrasada sabe se ainda
   é a tentativa corrente. tentouEm mede os 90 s do segundo plano. */
function comecaTentativa(p) {
  p.tentativa += 1;
  p.estado = 'enviando';
  p.erro = null;
  p.tentouEm = Date.now();
  return p.tentativa;
}

function marcaFalhou(p, motivo, prefixo) {
  p.estado = 'falhou';
  p.erro = motivo;
  render();
  mostraErro((prefixo || 'Não consegui entregar a mensagem: ') + motivo +
             '. Toque em "reenviar" no balão.');
  setEstado('erro no envio', true);
  btnEnviar.disabled = false;
  btnAnexo.disabled = false;
}

function falhouTentativa(p, tentativa, prefixo, motivo) {
  if (pendentes.includes(p) && p.tentativa === tentativa && p.estado === 'enviando') {
    marcaFalhou(p, motivo, prefixo);
  } else {
    console.warn('envio antigo do pendente ' + p.n + ' falhou depois de substituído ' +
                 'ou descartado:', motivo);
  }
}

/* O servidor confirmou a entrega. Vale até pra resposta atrasada de um
   pendente já dado como 'falhou'. Devolve false se o balão foi descartado. */
function entregue(p, d) {
  if (!pendentes.includes(p)) {
    console.warn('pendente ' + p.n + ' foi descartado, mas o envio foi entregue');
    return false;
  }
  p.estado = 'enviada';
  p.erro = null;
  p.ep = d.ep_enviado;
  limpaPendentes();
  render();
  return true;
}

/* `anexosMsg`: arquivos que já subiram e vão juntos com o texto. `opts.aoEntregar(ok, motivo)`
   (visuais) é chamado assim que o /send responde, sem esperar a agente. */
async function enviarTexto(texto, anexosMsg, opts) {
  texto = (texto || '').trim();
  if (texto && filtrosProntos) respondePedidos();
  const comAnexos = !!(anexosMsg && anexosMsg.length);
  if (!texto && !comAnexos) return;
  mostraErro('');
  const pend = novoPendente(texto);
  if (comAnexos) pend.anexos = anexosMsg;
  if (opts && opts.aoEntregar) pend.aoEntregar = opts.aoEntregar;
  pendentes.push(pend);
  await mandaTexto(pend);
}

/* O relay do servidor desiste em 60 s; 75 s aqui cobre isso com folga.
   Devolve true se a mensagem foi entregue. `semEsperar`: não fica esperando
   a resposta depois do envio. */
function avisaEntrega(pend, ok, motivo) {
  if (!pend.aoEntregar) return;
  try { pend.aoEntregar(ok, motivo); }
  catch (e) { console.warn('aoEntregar do pendente ' + pend.n + ' falhou:', e); }
}

async function mandaTexto(pend, semEsperar) {
  const tentativa = comecaTentativa(pend);
  render();
  setEstado('enviando…');
  btnEnviar.disabled = true;
  let d;
  // com anexos o servidor pode mandar mais de uma mensagem (marcador não se corta)
  const corpo = pend.anexos ? { text: pend.texto, anexos: pend.anexos.map(a => a.id) }
                            : { text: pend.texto };
  corpo.cliente_id = pend.cid;
  if (lerRespostas) corpo.voz = true;   // o agente sabe que a resposta vai ser ouvida e responde curto
  try {
    d = await api(API + '/send', { method: 'POST', body: corpo,
                                   timeoutMs: pend.anexos ? 120000 : 75000 });
  } catch (e) {
    if (e.codigo && /^COMANDO_/.test(e.codigo)) {   // o servidor recusou o comando: sem "reenviar"
      let motivo = e.message;
      const sug = e.dados && e.dados.sugestoes;
      if (sug && sug.length) motivo += ' Parecidos: ' + sug.join(', ') + '.';
      if (pendentes.includes(pend) && pend.tentativa === tentativa) {
        pend.recusado = true;
        marcaFalhou(pend, motivo, 'Comando recusado: ');
        mostraErro('Comando recusado: ' + motivo + ' Toque em "descartar" no balão.');
      }
      avisaEntrega(pend, false, motivo);
      return false;
    }
    if (e.codigo === 'PERGUNTA_PENDENTE') {
      // O agente espera a resposta de uma pergunta de escolha e a mensagem NÃO foi enviada: o texto volta ao campo
      // (antes de qualquer coisa que a pessoa já tenha digitado) e o erro diz o que fazer.
      const quando = pendentes.includes(pend) && pend.tentativa === tentativa;
      if (quando && !pend.anexos) {
        descartar(pend);
        const novo = entrada.value.trim();
        entrada.value = novo ? pend.texto + '\n' + entrada.value : pend.texto;
        ajustaCampo();
      } else if (quando) {
        marcaFalhou(pend, e.message, 'Não consegui entregar a mensagem: ');
      }
      const how = e.dados && e.dados.howToFix ? ' ' + e.dados.howToFix : '';
      mostraErro(e.message + how);
      avisaEntrega(pend, false, e.message);
      return false;
    }
    if (e.codigo === 'LOGIN_EXPIRADO' && !pend.anexos) {
      // O texto não se perde: sai do balão de erro e volta ao campo (se a pessoa já não escreveu outra coisa).
      if (pendentes.includes(pend) && pend.tentativa === tentativa) {
        descartar(pend);
        if (!entrada.value.trim()) { entrada.value = pend.texto; ajustaCampo(); }
      }
      leAbreAoRecusar();
      avisaEntrega(pend, false, e.message);
      return false;
    }
    falhouTentativa(pend, tentativa, 'Não consegui entregar a mensagem: ', e.message);
    if (e.codigo === 'LOGIN_EXPIRADO') leAbreAoRecusar();
    avisaEntrega(pend, false, e.message);
    return false;
  } finally {
    btnEnviar.disabled = false;
  }
  // o /send respondeu: a mensagem foi entregue, falta só a cópia na thread
  if (d && d.mascarado) {   // era um token: o balão passa a mostrar só a versão mascarada
    pend.texto = d.mascarado;
    pend.casa = d.marca || null;   // o que vai aparecer na thread, para o balão otimista sumir
    pend.anexos = null;
  }
  if (d && d.fila && d.fila.motivo) pend.fila = d.fila.motivo;
  const ficou = entregue(pend, d);
  avisaEntrega(pend, true);
  if (!ficou) return true;
  // /clear ou /new: o servidor arquivou a conversa anterior; a tela recomeça limpa
  if (d && d.arquivou) {
    pendentes = pendentes.filter(x => x !== pend);
    await carregar(true);
    return true;
  }
  // comando que não responde com fala (/compact, /context...): não fica no "esperando a resposta"
  const semResposta = !!(d && d.comando && d.comando.espera_resposta === false);
  if (!semEsperar && !semResposta && !esperando) await esperaResposta(d.ep_enviado);
  return true;
}

/* Reenviar: antes confere a thread, porque o envio dado como perdido pode ter
   ido. Se a cópia está lá, o balão some e pronto; senão, manda de novo pelo
   mesmo caminho, no MESMO balão. */
async function reenviar(p) {
  if (p.estado !== 'falhou' || p.conferindo) return;
  p.conferindo = true;
  render();
  setEstado('conferindo se já foi…');
  await carregar(false);
  p.conferindo = false;
  limpaPendentes();
  render();
  if (!pendentes.includes(p)) { estadoOcioso(); return; }
  if (p.estado !== 'falhou') return;   // a resposta atrasada chegou enquanto eu conferia
  mostraErro('');
  // com anexos os arquivos já estão no servidor: reenviar não sobe nada de novo
  await mandaTexto(p);
}

/* As prévias locais (URL.createObjectURL) do balão otimista. */
function soltaPrevias(p) {
  for (const a of p.anexos || []) if (a.previa) URL.revokeObjectURL(a.previa);
}

function descartar(p) {
  pendentes = pendentes.filter(x => x !== p);
  soltaPrevias(p);
  mostraErro('');
  render();
  if (telaOciosa()) estadoOcioso();
}

wrap.addEventListener('click', ev => {
  const bt = ev.target.closest ? ev.target.closest('button[data-pend]') : null;
  if (!bt) return;
  const p = pendentes.find(x => String(x.n) === bt.getAttribute('data-pend'));
  if (!p) return;
  if (bt.classList.contains('reenviar')) reenviar(p);
  else if (bt.classList.contains('descartar')) descartar(p);
});

const LIMITE_ESPERA_MS = 180000;   // 3 minutos, com botão de parar

/* Espera a resposta pelo stream: um ouvinte de chegada olha a thread a cada
   integra(), e um relógio de 500 ms confere o limite e o "parar de esperar".
   Devolve true (chegou), false (desistiu) ou 'reserva' (o stream caiu de vez
   no meio da espera e o resto é com o /wait). */
function esperaPeloStream(temResposta, limite) {
  return new Promise(resolve => {
    let feito = false, relogio = null;
    const ouvinte = () => { if (temResposta()) acaba(true); };
    function acaba(v) {
      if (feito) return;
      feito = true;
      clearInterval(relogio);
      const i = ouvintesChegada.indexOf(ouvinte);
      if (i >= 0) ouvintesChegada.splice(i, 1);
      resolve(v);
    }
    ouvintesChegada.push(ouvinte);
    relogio = setInterval(() => {
      if (temResposta()) acaba(true);
      else if (pararPedido || Date.now() >= limite) acaba(false);
      else if (!streamAberto && fonte && fonte.readyState === EventSource.CLOSED) {
        acaba('reserva');
      }
    }, 500);
    ouvinte();    // a resposta pode ter chegado antes do /send responder
  });
}

/* Reserva: long-poll no /wait, só quando o stream não está no ar. O /wait
   devolve msgs também quando estoura o timeout, então sempre integra. */
async function esperaPeloWait(since, limite) {
  while (!pararPedido && Date.now() < limite) {
    let d;
    try {
      d = await api(API + '/wait?since=' + encodeURIComponent(since) + '&timeout=25');
    } catch (e) {
      mostraErro('Parei de esperar a resposta: ' + e.message);
      return false;
    }
    integra(d.msgs);
    if (!d.timeout) return true;
  }
  return false;
}

/* Resposta = qualquer fala nova do agente depois do envio. */
const ehResposta = (m, since) => ehAgente(m) && m.ep > since;
/* Só a conversa normal (origin 'agente') entra na fila de voz automática. A rotina também
   conta como resposta para a espera, mas só toca em voz se a pessoa apertar o 🎧 do balão. */
const ehRespostaFalavel = (m, since) => !!m && m.origin === 'agente' && m.ep > since;

/* Depois da pergunta por voz, por 5 minutos, toda resposta nova dele também é
   lida (ele costuma mandar "vou fazer" e, um tempo depois, o resultado). */
const ESCUTA_MS = 5 * 60000;
let escuta = null;            // { since, ate }
const faladas = new Set();
/* Conversa pesada (22/10/2026, pedido do dono): cada mensagem manda de novo a conversa inteira ao
   modelo. Passou de CONTEXTO_PESADO tokens na última resposta, uma faixa discreta oferece começar
   limpo (/clear); a memória do agente fica. "Agora não" vale para esta resposta: a faixa só volta
   se a conversa crescer mais um degrau. */
const CONTEXTO_PESADO = 120000, CONTEXTO_DEGRAU = 60000;
let contextoDispensado = 0;
try { contextoDispensado = Number(sessionStorage.getItem('dgclaw-contexto-dispensado:' + AGENTE.id)) || 0; } catch (_) { /* sem storage */ }
function confereContexto() {
  if (fAviso.classList.contains('aparece') && !fAviso.classList.contains('leve')) return;   // outro aviso na frente
  // ctx: a entrada da última resposta; total e usd: a soma das respostas desde a última conversa nova
  let ctx = 0, total = 0, usd = 0;
  for (let k = msgs.length - 1; k >= 0; k--) {
    const m = msgs[k];
    if ((m.origin === 'dono' || m.origin === 'comando') && /^\s*\/(clear|new|compact)\b/.test(m.text || '')) break;
    if (m.origin !== 'agente' || !m.uso) continue;
    if (!ctx) ctx = Number(m.uso.contexto) || 0;
    total += (Number(m.uso.entrada) || 0) + (Number(m.uso.saida) || 0);
    usd += Number(m.uso.usd) || 0;
  }
  const mostra = ctx >= CONTEXTO_PESADO && ctx >= contextoDispensado + CONTEXTO_DEGRAU;
  if (!mostra) { if (fAviso.classList.contains('leve')) faixa(fAviso, ''); return; }
  if (fAviso.classList.contains('leve') && fAviso.dataset.ctx === String(ctx)) return;
  const gasto = 'já foram ' + numCurto(total) + ' tokens' + (usd >= 0.01 ? ', uns ' + dolar(usd) : '');
  faixaComAcoes(fAviso, 'Nossa conversa neste chat está grande: ' + gasto + '. Vamos iniciar um novo chat?', [
    { rotulo: 'Sim', fn: () => { faixa(fAviso, ''); enviarTexto('/clear'); } },
    { rotulo: 'Agora não', fn: () => {
      contextoDispensado = ctx;
      try { sessionStorage.setItem('dgclaw-contexto-dispensado:' + AGENTE.id, String(ctx)); } catch (_) { /* sem storage */ }
      faixa(fAviso, '');
    } },
  ]);
  fAviso.classList.add('leve');
  fAviso.title = 'Cada mensagem leva de novo uns ' + numCurto(ctx) + ' tokens. A memória fica guardada. ' +
    'O valor é o preço de uso da API; na assinatura ele não é cobrado por mensagem.';
  fAviso.dataset.ctx = String(ctx);
  alinhaFaixaLeve();
}
/* Na largura do campo de digitar (no computador a faixa ia de ponta a ponta, por cima do menu). */
function alinhaFaixaLeve() {
  if (!fAviso.classList.contains('leve')) return;
  const campo = document.querySelector('.barra .campo');
  const linha = campo && campo.closest('.barra > *');   // a linha inteira do campo (com o + e o enviar)
  if (!linha) return;
  const r = linha.getBoundingClientRect();
  if (!r.width) return;
  fAviso.style.left = Math.round(r.left) + 'px';
  fAviso.style.width = Math.round(r.width) + 'px';
  fAviso.style.right = 'auto';
  respiroDasFaixas();
}
window.addEventListener('resize', alinhaFaixaLeve);
ouvintesChegada.push(confereContexto);

/* ── Fila de leitura ──────────────────────────────────────────────────────
   Regra do Danilo (21/10/2026): resposta nova NUNCA derruba a que ele está
   ouvindo. Ela entra no fim da fila e é lida depois, uma por vez. Com o
   microfone aberto nada toca; a leitura em curso é pausada e guardada
   (`retomadaLeitura`), e quando a gravação termina ela continua de onde parou,
   seguida do resto da fila. O 🎧 de um balão pula pra ele e segue dali.
   Parada pedida pela pessoa (cancelaFala) descarta tudo, e `corteFala` registra
   isso para o fim da fila não reabrir o microfone depois de um "parar".
   Este bloco só decide a ordem. Quem fala de verdade vem de fora, por estas
   dependências (o teste em test/voz-fila-leitura.test.js injeta versões de mentira):
     gravando, pedindoMic, gravacao (via microfoneOcupado), esperando, transcrevendo,
     msgs, continua, pararPedido, mostraAviso, estadoOcioso, comecaGravar,
     pintaFilaLeitura, posicaoDoPlayer(), pararSomAtual(),
     tocarMensagemNaFila(item, desde) -> Promise que resolve quando acaba, OU quando
     pararSomAtual() a interrompe, OU com `false` se o aparelho NÃO tocou o som. */
const LIMITE_REINICIO = 0.20;   // pausada antes de 20% do 1º pedaço: recomeça do início
const filaLeitura = [];         // pendentes, em ordem de chegada: { id, texto, desde? }
let tocandoAgora = null;        // { id, texto, parte, tempo, duracao }
let retomadaLeitura = null;     // a que a gravação pausou: { id, texto, parte, tempo, duracao }
let drenoAtivo = false;
let geracaoFila = 0;            // sobe a cada pausa, parada ou pulo: o dreno antigo se aposenta sozinho
// Sobe a cada parada pedida pela pessoa. É separado de faloGeracao, que cada mensagem
// sobe ao começar a tocar.
let corteFala = 0;
// O 🎧 não reabre o microfone no fim (ouvir de novo não é a vez da pessoa falar). Uma
// resposta nova do agente chegando devolve o fluxo normal da conversa contínua.
let fimSemMic = false;
/* `filaFala` é a promessa do dreno em curso (ou uma já resolvida, se não há
   dreno). esperaResposta faz `await filaFala` para só soltar a tela quando a
   leitura acabou. Com o microfone aberto NÃO há dreno, então a promessa já
   está resolvida e o await nunca fica pendurado esperando a gravação. */
let filaFala = Promise.resolve();

const filaTemTrabalho = () => !!(retomadaLeitura || filaLeitura.length);
const mesmoId = (a, b) => String(a) === String(b);

/* De onde recomeçar a mensagem pausada: do início se mal tinha começado
   (menos de 20% do primeiro pedaço), senão do pedaço e do segundo em que parou. */
function decideInicio(r) {
  const ratio = r.duracao > 0 ? r.tempo / r.duracao : (r.tempo > 0 ? 1 : 0);
  if ((r.parte || 0) === 0 && ratio < LIMITE_REINICIO) return { parte: 0, tempo: 0 };
  return { parte: r.parte || 0, tempo: r.tempo || 0 };
}

function enfileiraFala(item) {
  if (!item || !item.id || !item.texto) {
    console.warn('fila de leitura: mensagem sem id ou sem texto, ignorada:', item);
    return false;
  }
  const jaTem = (tocandoAgora && mesmoId(tocandoAgora.id, item.id)) ||
                (retomadaLeitura && mesmoId(retomadaLeitura.id, item.id)) ||
                filaLeitura.some(p => mesmoId(p.id, item.id));
  if (jaTem) return false;
  filaLeitura.push({ id: item.id, texto: item.texto });
  fimSemMic = false;
  pintaFilaLeitura();
  iniciaDreno();
  return true;
}

function iniciaDreno() {
  if (drenoAtivo || microfoneOcupado() || !filaTemTrabalho()) return;
  drenoAtivo = true;
  filaFala = drena(++geracaoFila, corteFala);
}

async function drena(g, corte) {
  const minha = () => g === geracaoFila;
  while (minha() && !microfoneOcupado()) {
    let item, desde;
    if (retomadaLeitura) {
      item = retomadaLeitura;
      desde = decideInicio(item);
      retomadaLeitura = null;
    } else if (filaLeitura.length) {
      item = filaLeitura.shift();
      desde = item.desde || { parte: 0, tempo: 0 };
    } else break;
    tocandoAgora = { id: item.id, texto: item.texto, parte: desde.parte, tempo: desde.tempo, duracao: 0 };
    pintaFilaLeitura();
    let resultado;
    try {
      resultado = await tocarMensagemNaFila(tocandoAgora, desde);
    } catch (e) {
      console.warn('fila de leitura: a leitura da mensagem ' + item.id + ' falhou:', e);
      mostraAviso('Não consegui ler uma resposta em voz alta (' + e.message +
                  '). O texto está na tela. Toque no 🎧 do balão para tentar de novo.');
    }
    if (!minha()) return;          // pausaram, pararam ou pularam: o novo dreno cuida do resto
    if (resultado === false) {
      // o aparelho não tocou (o aviso com o motivo já saiu): tentar as outras só
      // gastaria cota de voz à toa. Para a fila inteira; o texto segue na tela.
      pararTudoFila();
      estadoOcioso();
      return;
    }
    tocandoAgora = null;
  }
  if (!minha()) return;
  drenoAtivo = false;
  pintaFilaLeitura();
  const semMic = fimSemMic;
  fimSemMic = false;
  // fim da fila inteira: só agora a conversa contínua reabre o microfone.
  // Se a pergunta dele ainda está sendo transcrita ou esperando resposta, não
  // reabre: a leitura da resposta (esperaResposta) é que fecha esse ciclo.
  if (!microfoneOcupado() && !filaTemTrabalho() && continua && !pararPedido &&
      corte === corteFala && !semMic && !esperando && !transcrevendo) {
    mostraAviso('');
    await comecaGravar();
  }
}

/* O microfone vai abrir: o que estava tocando é pausado e guardado. Se não há
   nada tocando nem dreno em curso, não mexe em nada (nem no estado da tela).
   `pos` só é passado quando o player não reflete o pedaço atual (ainda não tocou). */
function pausaPelaGravacao(pos) {
  if (!tocandoAgora && !drenoAtivo) return;
  if (tocandoAgora) {
    // `tocando` só fica true entre o play() e o fim do pedaço: antes disso o player ainda
    // guarda a posição da mensagem ANTERIOR e usá-la pularia o começo desta
    pos = pos || (tocandoAgora.tocando ? posicaoDoPlayer() : { tempo: 0, duracao: 0 });
    retomadaLeitura = { id: tocandoAgora.id, texto: tocandoAgora.texto,
                        parte: tocandoAgora.parte || 0, tempo: pos.tempo, duracao: pos.duracao };
    tocandoAgora = null;
  }
  geracaoFila++;
  drenoAtivo = false;
  pararSomAtual();
  pintaFilaLeitura();
}

/* A gravação acabou (enviou, cancelou, saiu vazia, deu erro): retoma na hora,
   sem esperar a transcrição. */
function filaRetoma() {
  iniciaDreno();
}

/* 🎧: toca esta e depois as que vêm depois dela na conversa. O que estava
   tocando é descartado (ele pediu). Pendente mais antigo que a escolhida é
   descartado (ele pulou); mais novo fica. */
function ouvirAPartirDe(item) {
  if (microfoneOcupado()) {
    mostraAviso('Termine a gravação antes de ouvir de novo: o som entraria no áudio que você está gravando.');
    return false;
  }
  const pos = id => msgs.findIndex(x => mesmoId(x.id, id));
  const alvo = pos(item.id);
  // posição desconhecida (-1): na dúvida mantém, melhor repetir do que perder
  const depois = p => alvo < 0 || pos(p.id) < 0 || pos(p.id) > alvo;
  const mantidos = filaLeitura.filter(p => !mesmoId(p.id, item.id) && depois(p));
  if (retomadaLeitura && !mesmoId(retomadaLeitura.id, item.id) && depois(retomadaLeitura)) {
    mantidos.unshift({ id: retomadaLeitura.id, texto: retomadaLeitura.texto,
                       desde: decideInicio(retomadaLeitura) });
  }
  geracaoFila++;
  drenoAtivo = false;
  tocandoAgora = null;
  retomadaLeitura = null;
  pararSomAtual();
  filaLeitura.length = 0;
  filaLeitura.push({ id: item.id, texto: item.texto }, ...mantidos);
  fimSemMic = true;
  pintaFilaLeitura();
  iniciaDreno();
  return true;
}

/* Parar de falar, pedido pela pessoa: para a atual E esvazia tudo. */
function pararTudoFila() {
  geracaoFila++;
  drenoAtivo = false;
  tocandoAgora = null;
  retomadaLeitura = null;
  filaLeitura.length = 0;
  fimSemMic = false;
  pararSomAtual();
  pintaFilaLeitura();
}

/* Retrato do estado, pro selo dos balões e pro teste. */
function estadoFilaLeitura() {
  return { tocando: tocandoAgora ? tocandoAgora.id : null,
           pausada: retomadaLeitura ? retomadaLeitura.id : null,
           fila: filaLeitura.map(p => p.id) };
}
/* ── fim da fila de leitura ── */

/* Selo no balão: "tocando agora", "na fila (n)" ou "continua quando você enviar". */
function pintaFilaLeitura() {
  if (typeof wrap === 'undefined' || !wrap.querySelectorAll) return;
  const e = estadoFilaLeitura();
  for (const row of wrap.querySelectorAll('.row.fila-tocando, .row.fila-espera, .row.fila-pausada')) {
    row.classList.remove('fila-tocando', 'fila-espera', 'fila-pausada');
  }
  for (const s of wrap.querySelectorAll('.selo-fila')) s.remove();
  const marca = (id, classe, texto) => {
    if (id == null) return;
    const row = wrap.querySelector('.row[data-msg="' + CSS.escape(String(id)) + '"]');
    const bub = row && row.querySelector('.bub');
    if (!bub) return;
    row.classList.add(classe);
    const s = document.createElement('span');
    s.className = 'selo-fila';
    s.textContent = texto;
    bub.appendChild(s);
  };
  marca(e.tocando, 'fila-tocando', '🔊 tocando agora');
  marca(e.pausada, 'fila-pausada', '⏸ continua quando você enviar');
  e.fila.forEach((id, i) => marca(id, 'fila-espera', '⏳ na fila (' + (i + 1) + ')'));
}

function falaNovas() {
  if (!escuta || !lerRespostas || Date.now() > escuta.ate) return;
  // visual (vis-*.html) é desenho: não tem o que ler em voz alta. Rotina não entra
  // sozinha na fila: só toca se a pessoa apertar o 🎧.
  const novas = msgs.filter(m => ehRespostaFalavel(m, escuta.since) && !faladas.has(m.id) &&
                              !ehVisual(m.media));
  if (!novas.length) return;
  for (const m of novas) {
    faladas.add(m.id);
    enfileiraFala({ id: m.id, texto: legendaUtil(m) || m.text });
  }
}

ouvintesChegada.push(() => { if (!esperando) falaNovas(); });

/* Pergunta nova: antes de trocar a janela de escuta, enfileira o que já chegou
   na antiga (inclusive durante a gravação), senão uma resposta que veio entre
   as duas perguntas ficaria sem ser lida. */
function armaEscuta(since) {
  falaNovas();
  escuta = { since: since, ate: Date.now() + ESCUTA_MS };
}

async function esperaResposta(since) {
  // Sem "parar de esperar" nem "esperando…" no topo (18/10/2026, pedido do dono): a linha de
  // andamento perto do campo já mostra o agente trabalhando. A espera segue por baixo, só para ler
  // a resposta em voz alta quando ela chegar.
  esperando = true;
  pararPedido = false;
  estadoOcioso();
  const limite = Date.now() + LIMITE_ESPERA_MS;
  const temResposta = () => msgs.some(m => ehResposta(m, since));

  let chegou = streamAberto ? await esperaPeloStream(temResposta, limite) : 'reserva';
  if (chegou === 'reserva') {
    console.warn('esperaResposta: stream fora do ar, esperando pelo /wait');
    chegou = await esperaPeloWait(since, limite);
  }

  if (chegou && !pararPedido) {
    // ela costuma mandar 2 ou 3 balões seguidos: espera até 5 s sem balão
    // novo (no máximo 40 s) antes de começar a ler
    const teto = Date.now() + 40000;
    let qtd = -1, quieto = Date.now();
    while (!pararPedido && Date.now() < teto) {
      const n = msgs.filter(m => ehResposta(m, since)).length;
      if (n !== qtd) { qtd = n; quieto = Date.now(); }
      if (Date.now() - quieto >= 5000) break;
      await dormir(500);
    }
  }

  esperando = false;
  const respostas = msgs.filter(m => ehResposta(m, since));
  if (pararPedido) {
    setEstado('parei de esperar');
    mostraAviso('Parei de esperar. A mensagem foi entregue: a resposta aparece ' +
                'aqui sozinha quando ela mandar.');
  } else if (!respostas.length && (window.atividadeFoto?.agentes?.[AGENTE.id]?.estado === 'trabalhando')) {
    estadoOcioso();   // ainda trabalhando: a linha de andamento já diz isso, sem aviso de demora
    if (lerRespostas) escuta = { since: since, ate: Date.now() + ESCUTA_MS };
  } else if (!respostas.length) {
    // sem faixa de propósito: a resposta chega sozinha pelo stream, e a escuta continua
    estadoOcioso();
    if (lerRespostas) armaEscuta(since);
  } else if (lerRespostas) {
    armaEscuta(since);
    falaNovas();
    await filaFala;
  } else {
    estadoOcioso();
  }
}

btnParar.onclick = () => {
  pararPedido = true;
  escuta = null;                     // parar também encerra a escuta automática
  cancelaFala();
  btnParar.textContent = 'parando…';
};

/* ── Falar a resposta ─────────────────────────────────────────────────────── */
let faloGeracao = 0;      // sobe a cada parada ou fala nova: a leitura antiga morre sozinha
let faloAbort = null;     // cancela o pedido de voz em voo
let fimToque = null;      // resolve o pedaço que está tocando (parar não deixa a fila pendurada)
const vozCache = new Map();   // texto -> { partes, blobs[] }: ouvir de novo sem gerar de novo
const VOZ_CACHE_MAX = 12;

/* Parada pedida pela pessoa: além de calar o que toca, descarta o que espera na fila. */
function cancelaFala() {
  corteFala++;
  pararFala();
}

/* Parar de falar, pedido pela pessoa: para a atual e esvazia a fila inteira. */
function pararFala() {
  pararTudoFila();
  estadoOcioso();
}

/* Só silencia o que está no ar; a fila decide o que fazer depois. Usada ao começar
   a gravar (a leitura pausa, não é cancelada) e dentro da própria fila. */
function pararSomAtual() {
  faloGeracao++;
  if (faloAbort) { faloAbort.abort(); faloAbort = null; }
  try {
    player.pause();
  } catch (e) {
    console.warn('pararSomAtual: player.pause() falhou:', e.message);
  }
  if (fimToque) fimToque();
  falando = false;
  btnParar.style.display = 'none';
}

/* Onde o player está (para retomar depois de uma pausa). duration é NaN antes do
   metadata carregar: vira 0, e a regra dos 20% trata 0 como "recomeça". */
function posicaoDoPlayer() {
  const d = player.duration;
  return { tempo: player.currentTime || 0, duracao: Number.isFinite(d) ? d : 0 };
}

/* Um pedaço da voz. O servidor fatia o texto (parágrafo, frase) e devolve o pedaço `i`,
   com o total em X-TTS-Partes. Pedaço já gerado fica na memória: o blob é solto junto com
   o texto mais antigo quando o cache enche, e a URL de cada toque é revogada ao fim dele. */
async function pegaPedacoVoz(texto, i, sinal) {
  let c = vozCache.get(texto);
  if (c && c.blobs[i]) return { blob: c.blobs[i], partes: c.partes };
  const r = await fetch('/api/v1/tts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: sinal,
    body: JSON.stringify({ agent_id: AGENTE.id, text: texto, parte: i }),
  });
  if (r.status === 401) {
    location.href = '/login?next=' + encodeURIComponent(AQUI);
    throw new Error('sessão expirada');
  }
  if (!r.ok) {
    let motivo = 'a API respondeu ' + r.status;
    try { const d = await r.json(); if (d && d.erro) motivo = d.erro; }
    catch (e) { console.warn('tts: a resposta de erro não veio em JSON:', e.message); }
    throw new Error(motivo);
  }
  const partes = parseInt(r.headers.get('X-TTS-Partes') || '1', 10) || 1;
  const blob = await r.blob();
  if (!c) {
    c = { partes, blobs: [] };
    vozCache.set(texto, c);
    if (vozCache.size > VOZ_CACHE_MAX) vozCache.delete(vozCache.keys().next().value);
  }
  c.blobs[i] = blob;
  return { blob, partes };
}

/* Resolve true se o pedaço tocou até o fim (ou foi parado) e false se o aparelho não tocou. */
function tocaPedaco(blob, inicio) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob);
    let pronto = false;
    const fim = (tocou = true) => {
      if (pronto) return;
      pronto = true;
      fimToque = null;
      URL.revokeObjectURL(url);
      resolve(tocou);
    };
    fimToque = fim;
    player.onended = fim;
    player.onerror = () => {
      mostraAviso('O iPhone não tocou o áudio da resposta. O texto está na tela.');
      fim(false);
    };
    player.src = url;
    // o iOS ignora currentTime antes do metadata: posiciona só depois dele
    if (inicio > 0) {
      player.addEventListener('loadedmetadata', () => {
        try {
          player.currentTime = inicio;
        } catch (e) {
          console.warn('retomada: não consegui posicionar o áudio em ' + inicio +
                       's (' + e.message + '); o pedaço começa do início.');
        }
      }, { once: true });
    }
    const p = player.play();
    if (p && p.catch) {
      p.catch(e => {
        mostraAviso('O iPhone bloqueou o som (' + e.message + '). Toque no ' +
                    'microfone uma vez para liberar o áudio e tente de novo.');
        fim(false);
      });
    }
  });
}

/* Pedaço já gerado, sem esperar nada: a retomada depois da gravação chama
   player.play() colada no toque, sem await no caminho (o iPhone exige). */
function pedacoEmCache(texto, i) {
  const c = vozCache.get(texto);
  return c && c.blobs[i] ? { blob: c.blobs[i], partes: c.partes } : null;
}

/* Microfone abrindo ou gravando: tocar agora faria o alto-falante entrar na gravação, e a fala
   do agente voltaria a ele como se fosse da pessoa. */
function microfoneOcupado() {
  return !!(gravando || pedindoMic || gravacao);
}

/* Toca UMA mensagem, a partir do pedaço `desde.parte` e do segundo `desde.tempo`, sem
   interromper ninguém (quem decide a ordem é a fila). Lê a resposta INTEIRA: toca o pedaço
   inicial assim que chega e já pede o seguinte enquanto ele toca. `item.parte` acompanha o
   pedaço em curso (a pausa da gravação lê). Resolve false se o aparelho NÃO tocou. */
async function tocarMensagemNaFila(item, desde) {
  const texto = item.texto;
  const minha = ++faloGeracao;
  const viva = () => minha === faloGeracao;
  const ctl = new AbortController();
  faloAbort = ctl;
  let i = desde.parte || 0;
  let atual = pedacoEmCache(texto, i);
  if (!atual) {
    setEstado('preparando a voz…');
    try {
      atual = await pegaPedacoVoz(texto, i, ctl.signal);
    } catch (e) {
      if (!viva()) return;
      // a resposta JÁ está na tela: isto é aviso, não é falha do ciclo
      mostraAviso(e.name === 'TypeError' ? 'A resposta está na tela, mas não consegui gerar a voz: ' + e.message : e.message);
      setEstado('resposta só em texto');
      return;
    }
    if (!viva()) return;
  }

  falando = true;
  btnParar.style.display = '';
  btnParar.textContent = 'parar de falar';
  setEstado('falando…');
  const total = atual.partes;
  let inicio = desde.tempo || 0;
  for (; i < total && viva(); i++) {
    item.parte = i;
    // pré-gera o próximo enquanto o atual toca
    const proximo = i + 1 < total ? pegaPedacoVoz(texto, i + 1, ctl.signal) : null;
    if (proximo) proximo.catch(() => {});   // o erro é tratado quando a vez dele chega
    if (microfoneOcupado()) {
      // o microfone abriu enquanto a voz era gerada: guarda este pedaço para a retomada
      pausaPelaGravacao({ tempo: inicio, duracao: 0 });
      return;
    }
    // aparelho que não toca não gasta mais cota: avisa a fila, que para e cancela o próximo já pedido
    item.tocando = true;
    const tocou = await tocaPedaco(atual.blob, inicio);
    item.tocando = false;
    if (!tocou) {
      if (!viva()) return;
      pararSomAtual();
      return false;
    }
    inicio = 0;
    if (!viva() || !proximo) break;
    try {
      atual = await proximo;
    } catch (e) {
      if (!viva()) return;
      mostraAviso('A voz parou no pedaço ' + (i + 2) + ' de ' + total + ': ' + e.message +
                  ' O texto completo está na tela.');
      break;
    }
  }
  if (!viva()) return;               // pararam ou pausaram: quem fez isso arrumou a tela
  faloAbort = null;
  falando = false;
  btnParar.style.display = 'none';
  estadoOcioso();
}

/* Fone no balão: pula para esta mensagem e segue dali pelas seguintes. */
wrap.addEventListener('click', ev => {
  const bt = ev.target.closest ? ev.target.closest('button[data-fone]') : null;
  if (!bt) return;
  const m = msgs.find(x => String(x.id) === bt.getAttribute('data-fone'));
  const texto = m && legendaUtil(m);
  if (!texto) {
    mostraAviso('Não achei o texto desta mensagem para ler de novo. Recarregue a conversa.');
    return;
  }
  destravarAudio();
  // pula para esta mensagem e segue pelas seguintes; recusa com o microfone aberto
  ouvirAPartirDe({ id: m.id, texto: texto });
});

/* ── Modo texto e toggles ─────────────────────────────────────────────────── */
/* Responder citando (19/10/2026, ideia 2): o botão ↩ das respostas, ou deslizar qualquer mensagem
   para a direita no celular, prende a mensagem acima do campo; o envio sai com "↩ [id] trecho" na
   primeira linha, que o servidor transforma em citação (tocar nela leva até a original). */
let respondendo = null;   // { id, texto, origin }
const ICO_RESP_CAMPO = '<svg class="resp-ic" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H12"/></svg>';
const ICO_X_CAMPO = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const respChip = document.createElement('div');
respChip.id = 'respChip'; respChip.hidden = true;
// colada no topo da caixa do campo (.linha1), como uma linha dela (proposta B, 19/10/2026)
document.querySelector('.linha1').before(respChip);
function comecaResposta(m) {
  const t = String(legendaUtil(m) || m.text || '').replace(/\s+/g, ' ').trim();
  if (!t) return;
  respondendo = { id: m.id, texto: t.length > 120 ? t.slice(0, 119) + '…' : t, origin: m.origin };
  respChip.innerHTML = `${ICO_RESP_CAMPO}<span class="resp-tx">Respondendo a <b>${ehDono(m) ? 'você' : esc(AGENTE.nome)}</b>: ${esc(respondendo.texto)}</span>` +
    `<button type="button" class="resp-x" aria-label="Não responder citando" title="Cancelar">${ICO_X_CAMPO}</button>`;
  // outros itens (menções, modo equipe) entram antes da caixa depois; a citação volta a ficar colada nela
  document.querySelector('.barra .linha1').before(respChip);
  respChip.hidden = false;
  entrada.focus();
}
function fimResposta() { respondendo = null; respChip.hidden = true; respChip.innerHTML = ''; acendeResp(null); }
// o botão ↩ da mensagem citada fica aceso enquanto a citação está no campo
function acendeResp(id) {
  for (const b of wrap.querySelectorAll('.acao-resp-on')) b.classList.remove('acao-resp-on');
  if (!id) return;
  const el = wrap.querySelector('.acoes[data-acoes="' + CSS.escape(id) + '"] [data-ac="responder"]');
  if (el) el.classList.add('acao-resp-on');
}
respChip.addEventListener('click', ev => { if (ev.target.closest('.resp-x')) fimResposta(); });
function comResposta(t) {
  if (!respondendo || !/^[a-f0-9]{8,40}$/.test(respondendo.id)) { fimResposta(); return t; }
  const r = '↩ [' + respondendo.id + '] ' + respondendo.texto + '\n' + t;
  fimResposta();
  return r;
}
// tocar numa citação leva até a mensagem original (e pisca)
wrap.addEventListener('click', ev => {
  const c = ev.target.closest ? ev.target.closest('.cita[data-ir-msg]') : null;
  if (!c) return;
  const alvo = wrap.querySelector('[data-msg="' + CSS.escape(c.dataset.irMsg) + '"]');
  if (!alvo) { mostraAviso('A mensagem citada é antiga e não está carregada; role para cima para encontrá-la.'); return; }
  rolagem.mostra(alvo, { block: 'center' });
  alvo.classList.remove('msg-achada'); void alvo.offsetWidth; alvo.classList.add('msg-achada');
});
// deslizar para a direita (celular) responde citando
(function () {
  let ini = null;
  wrap.addEventListener('touchstart', ev => {
    const row = ev.target.closest && ev.target.closest('.row[data-msg]');
    if (!row || ev.touches.length !== 1 || ev.target.closest('.dg-car, .dgui, pre, .cod, table')) { ini = null; return; }
    ini = { x: ev.touches[0].clientX, y: ev.touches[0].clientY, row, dx: 0 };
  }, { passive: true });
  wrap.addEventListener('touchmove', ev => {
    if (!ini) return;
    const dx = ev.touches[0].clientX - ini.x, dy = Math.abs(ev.touches[0].clientY - ini.y);
    if (dy > 24 || dx < 0) { ini.row.style.transform = ''; if (dy > 24) ini = null; return; }
    ini.dx = dx;
    ini.row.style.transform = 'translateX(' + Math.min(dx, 70) + 'px)';
  }, { passive: true });
  wrap.addEventListener('touchend', () => {
    if (!ini) return;
    const { row, dx } = ini; ini = null;
    row.style.transition = 'transform .15s'; row.style.transform = '';
    setTimeout(() => { row.style.transition = ''; }, 160);
    if (dx > 60) {
      const m = msgs.find(x => x.id === row.dataset.msg);
      if (m) comecaResposta(m);
    }
  });
})();
/* Número no ícone do app e no título da aba (19/10/2026, ideia 3): avisos não vistos de todos os agentes
   (os desta conversa vêm de alertasLista; os outros, da conferência da fileira a cada 30 s). */
let avisosOutros = 0;
function pintaBadgeApp() {
  let n = avisosOutros;
  try { n += alertasLista.length; } catch (_) { /* a lista desta conversa ainda não nasceu */ }
  document.title = (n ? '(' + n + ') ' : '') + AGENTE.nome + ' - S2 Bot';
  try {
    if (n && navigator.setAppBadge) navigator.setAppBadge(n).catch(() => {});
    else if (!n && navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  } catch (_) { /* sem suporte a badge: fica só o título */ }
}
/* "N novas mensagens" (ideia 3): ao abrir, uma linha antes da primeira mensagem do agente que você ainda
   não tinha visto (o mesmo marcador do ✓✓ azul), e a tela abre nela em vez de no fim. Some quando você
   escreve. */
let divisorEp = null, divisorN = 0;
function marcaDivisor() {
  const novas = vistoAteEp > 0 ? msgs.filter(m => !ehDono(m) && m.origin !== 'trilha' && typeof m.ep === 'number' && m.ep > vistoAteEp) : [];
  divisorEp = novas.length ? novas[0].ep : null;
  divisorN = novas.length;
}
/* @mencionar outro agente (19/10/2026, ideia 1): "@" no campo abre a lista dos outros agentes (o Admin
   fica de fora); a mensagem que começa com "@Nome" vai ao agente citado por POST /mencao, e a resposta
   dele volta aqui num cartão (lib/mencoes.js), e este agente recebe a resposta para continuar. */
const mencionaveis = () => agentesMenu.filter(a => a.tipo !== 'admin' && a.id !== AGENTE.id);
const fotoAg = a => { const img = a && (a.avatar_img || (/^https:\/\//i.test(a.avatar || '') ? a.avatar : '')); return img ? `<img src="${esc(img)}" alt="">` : esc((a && (a.avatar || a.nome) || '?').slice(0, 1)); };
/* @Nome em destaque (21/10/2026, pedido do dono, opção A): uma pílula na cor do agente, no balão e no campo. */
const corMencao = a => ` style="--c:${esc((a && a.cor) || '#3b82f6')}"`;
function destacaMencao(html, m) {
  if (m.mencaoPergunta.varios) return html.replace(/(^|>)((?:@[^\s<]+\s)+)/, (_, a, b) => a + b.trim().split(/\s+/).map(x => {
    const ag = agentesMenu.find(y => '@' + y.nome.toLowerCase() === x.toLowerCase());
    return `<span class="mencao-nome"${corMencao(ag)}>${x}</span>`;
  }).join(' ') + ' ');
  const a = agentesMenu.find(x => x.id === m.mencaoPergunta.para);
  if (!a) return html;
  const marca = esc('@' + a.nome);
  return html.replace(marca, `<span class="mencao-nome"${corMencao(a)}>${marca}</span>`);
}
/* @Nome solto no meio de qualquer fala (21/10/2026, o dono citou "( @Tech )" na conversa do Admin e não viu o
   destaque): só visual, não chama ninguém. Mexe só no texto entre as tags (nunca dentro de href ou atributo). */
function destacaNomes(html) {
  if (!html.includes('@') || !agentesMenu.length) return html;
  const nomes = agentesMenu.map(a => esc(a.nome)).filter(Boolean).sort((x, y) => y.length - x.length).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const rx = new RegExp('(^|[\\s(\\[])@(' + nomes.join('|') + ')(?=$|[\\s,.!?:;)\\]])', 'gi');
  let dentroCodigo = 0;
  return html.split(/(<[^>]*>)/).map(pedaco => {
    if (pedaco.startsWith('<')) { if (/^<(code|pre|a)\b/i.test(pedaco)) dentroCodigo++; else if (/^<\/(code|pre|a)>/i.test(pedaco)) dentroCodigo = Math.max(0, dentroCodigo - 1); return pedaco; }
    if (dentroCodigo) return pedaco;
    return pedaco.replace(rx, (_, antes, nome) => {
      const a = agentesMenu.find(x => esc(x.nome).toLowerCase() === nome.toLowerCase());
      return `${antes}<span class="mencao-nome"${corMencao(a)}>@${nome}</span>`;
    });
  }).join('');
}

/* No campo de digitar o texto não tem cor por palavra: uma camada por cima do campo, com o mesmo texto
   transparente, pinta só o fundo dos @Nome que batem com um agente. Vale também na conversa do Admin
   (21/10/2026), onde o @ só destaca e não chama ninguém. */
const espelho = document.createElement('div');
espelho.id = 'entradaEspelho'; espelho.setAttribute('aria-hidden', 'true');
if (entrada && entrada.parentElement) entrada.after(espelho);
function pintaEspelho() {
  if (!espelho.isConnected) return;
  const ags = mencionaveis();
  const t = entrada.value;
  if (!t.includes('@') || !ags.length) { if (espelho.innerHTML) espelho.innerHTML = ''; return; }
  const nomes = ags.map(a => a.nome).sort((x, y) => y.length - x.length).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const rx = new RegExp('(^|\\s)@(' + nomes.join('|') + ')(?=$|[\\s,.!?:;])', 'gi');
  let html = '', ult = 0, m;
  while ((m = rx.exec(t))) {
    const ini = m.index + m[1].length, fim = ini + 1 + m[2].length;
    const a = ags.find(x => x.nome.toLowerCase() === m[2].toLowerCase());
    html += esc(t.slice(ult, ini)) + `<span class="esp-men"${corMencao(a)}>${esc(t.slice(ini, fim))}</span>`;
    ult = fim;
  }
  if (!ult) { if (espelho.innerHTML) espelho.innerHTML = ''; return; }
  espelho.innerHTML = html + esc(t.slice(ult)) + '\u200b';
  // a mesma caixa do campo (o tema e o celular mudam padding e fonte): copia do estilo calculado
  const cs = getComputedStyle(entrada);
  for (const k of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth',
    'borderLeftWidth', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent']) espelho.style[k] = cs[k];
  Object.assign(espelho.style, { left: entrada.offsetLeft + 'px', top: entrada.offsetTop + 'px', width: entrada.offsetWidth + 'px', height: entrada.offsetHeight + 'px' });
  espelho.scrollTop = entrada.scrollTop;
}
if (entrada) {
  entrada.addEventListener('input', pintaEspelho);
  entrada.addEventListener('scroll', () => { espelho.scrollTop = entrada.scrollTop; });
  window.addEventListener('resize', pintaEspelho);
}
function htmlEquipe(m) {
  const me = m.mencao;
  const chips = (me.paraNomes || []).map(n => {
    const a = agentesMenu.find(x => x.nome === n) || { nome: n };
    const st = me.tipo === 'pedido' && me.donoNome ? (me.donoNome === n ? ' on' : ' off') : '';
    return `<span class="eq-ag${st}"><span class="men-foto" style="background:${esc(a.cor || '#2f9e5e')}">${fotoAg(a)}</span>${esc(n)}</span>`;
  }).join('');
  const quem = me.para && me.para[0] !== 'todos' ? (me.paraNomes || []).length + ' agentes' : 'todos';
  let cab;
  if (me.tipo === 'aviso') cab = `${ICO_AVISAR}<span>Aviso seu para ${quem} · no quadro de avisos</span>`;
  else if (me.estado === 'aberto') cab = `${ICO_PEDIR}<span>Pedido seu para ${quem} · esperando alguém pegar</span><i class="men-gira" aria-hidden="true"></i>`;
  else if (me.estado === 'fazendo') cab = `${ICO_PEDIR}<span>Pedido seu · <b>${esc(me.donoNome || '')}</b> pegou e está fazendo</span><i class="men-gira" aria-hidden="true"></i>`;
  else if (me.estado === 'feito') cab = `${ICO_PEDIR}<span>Pedido seu · <b>${esc(me.donoNome || '')}</b> fez</span>`;
  else cab = `${ICO_PEDIR}<span>Pedido seu · ${esc(me.motivo || 'ninguém pegou')}</span>`;
  const corpo = me.tipo === 'pedido' && me.estado === 'feito' && m.text ? `<div class="men-txt">${htmlCorpo(Object.assign({}, m, { origin: 'agente', mencao: null }))}</div>` : '';
  return `<div class="row her men eq" data-msg="${esc(m.id)}"><div class="men-cartao"><div class="men-cab">${cab}` +
    (me.tipo === 'aviso' ? '<a class="men-abrir" href="/avisos">quadro</a>' : '') + `</div>` +
    (me.tipo === 'aviso' || me.estado !== 'feito' ? `<div class="eq-ags">${chips}</div>` : '') + corpo + '</div></div>';
}
function htmlMencao(m) {
  if (m.mencao && (m.mencao.tipo === 'aviso' || m.mencao.tipo === 'pedido')) return htmlEquipe(m);
  const me = m.mencao, a = agentesMenu.find(x => x.id === me.para) || { nome: me.paraNome };
  const cab = me.estado === 'respondida' ? `<b>${esc(a.nome)}</b> respondeu, a pedido ${EH_ADMIN ? 'seu' : 'do ' + esc(AGENTE.nome)}`
    : me.estado === 'falhou' ? `<b>${esc(a.nome)}</b> não respondeu${me.motivo ? ': ' + esc(me.motivo) : ''}`
    : `Perguntando ao <b>${esc(a.nome)}</b>…`;
  const corpo = me.estado === 'respondida' ? `<div class="men-txt">${htmlCorpo(Object.assign({}, m, { origin: 'agente', mencao: null }))}</div>` : '';
  return `<div class="row her men${me.estado === 'perguntando' ? ' men-esperando' : ''}" data-msg="${esc(m.id)}"><div class="men-cartao">` +
    `<div class="men-cab"><span class="men-foto" style="background:${esc(a.cor || '#2f9e5e')}">${fotoAg(a)}</span><span>${cab}</span>` +
    (me.estado === 'perguntando' ? '<i class="men-gira" aria-hidden="true"></i>' : '') +
    `<a class="men-abrir" href="/a/${encodeURIComponent(me.para)}" title="Abrir a conversa do ${esc(a.nome)}">abrir</a></div>${corpo}</div></div>`;
}
const menLista = document.createElement('div');
menLista.id = 'menLista'; menLista.hidden = true; menLista.setAttribute('role', 'listbox');
document.querySelector('.barra').insertBefore(menLista, document.querySelector('.barra .linha1'));
let menSel = 0;
function menTrecho() {
  const v = entrada.value.slice(0, entrada.selectionStart || 0);
  const r = /(^|\s)@([^\s@]*)$/.exec(v);
  return r ? { de: v.length - r[2].length - 1, q: r[2].toLowerCase() } : null;
}
function menPinta() {
  const t = menTrecho();
  const lista = t ? [{ id: 'todos', nome: 'todos', todos: true }].concat(mencionaveis()).filter(a => a.nome.toLowerCase().startsWith(t.q) || a.id.startsWith(t.q)) : [];
  if (!lista.length) { menLista.hidden = true; return; }
  menSel = Math.min(menSel, lista.length - 1);
  menLista.innerHTML = lista.map((a, i) => `<button type="button" role="option" class="men-op${i === menSel ? ' on' : ''}" data-men="${esc(a.id)}">` +
    (a.todos ? `<span class="men-foto men-todos" aria-hidden="true">@</span><span>todos</span><small>avisar ou pedir a todos os agentes</small>`
      : `<span class="men-foto" style="background:${esc(a.cor || '#2f9e5e')}">${fotoAg(a)}</span><span>${esc(a.nome)}</span><small>${esc(a.subtitulo || a.papel || '')}</small>`) +
    `</button>`).join('');
  menLista.hidden = false;
}
function menEscolhe(id) {
  const a = id === 'todos' ? { id: 'todos', nome: 'todos' } : mencionaveis().find(x => x.id === id), t = menTrecho();
  if (!a || !t) return;
  const fim = entrada.selectionStart || 0;
  entrada.value = entrada.value.slice(0, t.de) + '@' + a.nome + ' ' + entrada.value.slice(fim);
  const pos = t.de + a.nome.length + 2;
  entrada.setSelectionRange(pos, pos); entrada.focus(); menLista.hidden = true; ajustaCampo(); pintaModo();
}
/* @todos ou dois ou mais @nomes (19/10/2026): Avisar (aviso seu no quadro) ou Pedir (o primeiro que puder faz).
   O seletor pequeno aparece acima do campo só nesses casos. */
let modoEquipe = 'pedir';
const modoEl = document.createElement('div');
modoEl.id = 'modoEquipe'; modoEl.hidden = true; modoEl.setAttribute('role', 'radiogroup'); modoEl.setAttribute('aria-label', 'Avisar ou pedir');
const ICO_AVISAR = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10v4h3l6 4V6L7 10z"/><path d="M16.5 9a4 4 0 0 1 0 6"/></svg>';
const ICO_PEDIR = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V10M14 10.5V6a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-.5a6 6 0 0 1-5-2.7L3.6 13a1.5 1.5 0 0 1 2.4-1.8L8 13.5"/></svg>';
document.querySelector('.barra').insertBefore(modoEl, document.querySelector('.barra .linha1'));
function alvosEquipe(t) {
  const r = /^((?:@\S+\s+)+)/.exec(t);
  if (!r) return null;
  const nomes = r[1].trim().split(/\s+/).map(x => x.slice(1).toLowerCase());
  if (nomes.length === 1 && nomes[0] === 'todos') return { para: ['todos'], resto: t.slice(r[1].length).trim() };
  if (nomes.length < 2 || nomes.includes('todos')) return null;
  const ags = nomes.map(n => mencionaveis().find(a => a.nome.toLowerCase() === n || a.id === n));
  if (ags.some(a => !a)) return null;
  return { para: [...new Set(ags.map(a => a.id))], resto: t.slice(r[1].length).trim() };
}
function pintaModo() {
  const alvo = !EH_ADMIN && alvosEquipe(entrada.value);
  modoEl.hidden = !alvo;
  if (!alvo) return;
  modoEl.innerHTML = [['avisar', 'Avisar', ICO_AVISAR], ['pedir', 'Pedir', ICO_PEDIR]].map(([k, r, ic]) =>
    `<button type="button" role="radio" aria-checked="${modoEquipe === k}" data-modo="${k}"${modoEquipe === k ? ' class="on"' : ''} title="${k === 'avisar' ? 'Só informa: ninguém responde' : 'O primeiro agente que puder faz'}">${ic}${r}</button>`).join('');
}
modoEl.addEventListener('mousedown', ev => ev.preventDefault());
modoEl.addEventListener('click', ev => { const b = ev.target.closest('[data-modo]'); if (b) { modoEquipe = b.dataset.modo; pintaModo(); } });
entrada.addEventListener('input', pintaModo);
async function enviaEquipe(t) {
  const alvo = alvosEquipe(t);
  if (!alvo || !alvo.resto) return false;
  modoEl.hidden = true;
  try {
    if (modoEquipe === 'avisar') {
      if (alvo.resto.length > 280) { mostraErro('O aviso tem ' + alvo.resto.length + ' caracteres; o quadro aceita até 280. Encurte e mande de novo.'); entrada.value = t; ajustaCampo(); pintaModo(); return true; }
      const d = await api('/api/v1/avisos', { method: 'POST', body: { texto: alvo.resto, tipo: 'decisao', para: alvo.para } });
      const avisoId = d && (d.aviso ? d.aviso.id : d.id);
      await api(API + '/aviso', { method: 'POST', body: { texto: alvo.resto, para: alvo.para, avisoId } });
    } else {
      await api(API + '/pedido', { method: 'POST', body: { texto: alvo.resto, para: alvo.para } });
    }
  } catch (e) { mostraErro('Não consegui ' + (modoEquipe === 'avisar' ? 'avisar' : 'pedir') + ': ' + e.message); entrada.value = t; ajustaCampo(); pintaModo(); }
  return true;
}
entrada.addEventListener('input', () => { menSel = 0; menPinta(); });
entrada.addEventListener('keydown', ev => {
  if (menLista.hidden) return;
  const ops = menLista.querySelectorAll('.men-op');
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); menSel = (menSel + (ev.key === 'ArrowDown' ? 1 : ops.length - 1)) % ops.length; menPinta(); }
  else if ((ev.key === 'Enter' || ev.key === 'Tab') && ops[menSel]) { ev.preventDefault(); ev.stopImmediatePropagation(); menEscolhe(ops[menSel].dataset.men); }
  else if (ev.key === 'Escape') { menLista.hidden = true; }
}, true);
menLista.addEventListener('mousedown', ev => ev.preventDefault());
menLista.addEventListener('click', ev => { const b = ev.target.closest('.men-op'); if (b) menEscolhe(b.dataset.men); });
async function enviaMencao(t) {
  const r = /^@(\S+)\s+([\s\S]+)$/.exec(t);
  if (!r) return false;
  const a = mencionaveis().find(x => x.nome.toLowerCase() === r[1].toLowerCase() || x.id === r[1].toLowerCase());
  if (!a) return false;
  try {
    await api(API + '/mencao', { method: 'POST', body: { para: a.id, pergunta: r[2].trim() } });
  } catch (e) { mostraErro('Não consegui perguntar ao ' + a.nome + ': ' + e.message); entrada.value = t; ajustaCampo(); }
  return true;
}
let tarefaPresa = null;
(function () {
  const n = new URLSearchParams(location.search).get('tarefa');
  if (!n || !/^\d+$/.test(n)) return;
  history.replaceState(null, '', location.pathname + location.hash);
  tarefaPresa = n;
  const chip = document.createElement('div');
  chip.id = 'tarefaChip';
  chip.innerHTML = `<a class="tf-cartao" data-tarefa="${n}" href="/mesa#t${n}">${htmlTarefaCartao(n)}</a><button type="button" class="resp-x" aria-label="Não citar a tarefa" title="Cancelar">✕</button>`;
  document.querySelector('.barra').insertBefore(chip, document.querySelector('.barra').firstChild);
  chip.querySelector('.resp-x').onclick = () => { tarefaPresa = null; chip.remove(); };
  fetch('/api/v1/tarefas/' + encodeURIComponent(n), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then(r => r.ok ? r.json() : null).then(d => { tarefasCache.set(n, d ? (d.tarefa || d) : null); const a = chip.querySelector('.tf-cartao'); if (a) a.innerHTML = htmlTarefaCartao(n); }).catch(() => {});
  setTimeout(() => entrada.focus(), 300);
})();
function comTarefa(t) {
  if (!tarefaPresa) return t;
  const n = tarefaPresa, tt = tarefasCache.get(n);
  tarefaPresa = null;
  const chip = document.getElementById('tarefaChip'); if (chip) chip.remove();
  return '📋 Tarefa #' + n + ' da Mesa: ' + ((tt && tt.titulo) || 'sem título') + ' (/mesa#t' + n + ')\n' + t;
}
function enviarDoCampo() {
  if (anexos.length) {
    // a legenda é o texto do campo: despachaAnexos lê e limpa o campo sozinho
    enviarComAnexos();
    return;
  }
  const t = entrada.value.trim();
  if (!t) { entrada.focus(); return; }
  entrada.value = '';
  ajustaCampo();
  gravaRascunho();
  vozNoCampo = false;
  if (lcInterceptaLogin(t)) return;   // /login abre o cartão e não vai ao agente
  menLista.hidden = true;
  if (!EH_ADMIN && alvosEquipe(t)) { fimResposta(); enviaEquipe(t); return; }
  if (!EH_ADMIN && /^@\S+\s/.test(t) && mencionaveis().some(a => t.toLowerCase().startsWith('@' + a.nome.toLowerCase() + ' '))) { fimResposta(); enviaMencao(t); return; }
  const final = comResposta(comTarefa(t));
  // cota acabada: fica guardada e vai sozinha na volta (cota.js)
  if (window.DGCota && window.DGCota.guarda(final)) return;
  enviarTexto(final);
}
// pergunta sugerida embaixo de um painel (dgui.js): vai ao agente como se a pessoa tivesse digitado
document.addEventListener('dgui-pergunta', ev => {
  const t = ev.detail && String(ev.detail.texto || '').trim();
  if (!t) return;
  destravarAudio();
  // resposta a um cartão de escolha: a primeira linha cita a pergunta ("↩ Como seguimos?"); o servidor
  // transforma em citação no balão, e o agente lê a que pergunta a resposta se refere
  const perg = String(ev.detail.pergunta || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  enviarTexto(perg ? '↩ ' + perg + '\n' + t : t);
});
// "Mandar para o Admin aplicar" (dgui para-admin, 23/10/2026): o texto é fixo e montado aqui, com a
// data conferida e o agente desta tela; o que o agente escreveu no relatório não vai junto
document.addEventListener('dgui-para-admin', async ev => {
  const data = String((ev.detail && ev.detail.relatorio) || '');
  const feito = (ev.detail && ev.detail.feito) || (() => {});
  const admin = agentesMenu.find(a => a.tipo === 'admin');
  if (EH_ADMIN || !admin || !/^\d{4}-\d{2}-\d{2}$/.test(data)) { feito(false); mostraErro('Este botão só funciona na conversa de um agente.'); return; }
  const [a, m, d] = data.split('-');
  const texto = '[do cartão do relatório de segurança do ' + AGENTE.nome + '] aplica as correções do relatório de segurança de ' +
    d + '/' + m + '/' + a + ' (agente ' + AGENTE.id + ', arquivo seguranca/relatorio-' + data + '.md)';
  try {
    await api('/api/v1/agents/' + encodeURIComponent(admin.id) + '/send', { method: 'POST', body: { text: texto }, timeoutMs: 75000 });
    feito(true);
  } catch (e) { feito(false); mostraErro('Não consegui mandar para o Admin: ' + e.message); }
});
const RX_CITA_LOCAL = /^↩ (?:\[([a-f0-9]{8,40})\] )?([^\n]{1,200})\n([\s\S]+)$/;
const semCita = t => { const r = RX_CITA_LOCAL.exec(String(t || '')); return r ? r[3] : t; };
btnEnviar.onclick = () => {
  destravarAudio();
  // com texto no campo é sempre enviar, mesmo que o botão ainda mostre o quadrado
  if (btnEnviar.classList.contains('parar') && !entrada.value.trim() && !anexos.length) { interrompe(); return; }
  if (gravando) { paraEEnvia(true); return; }
  enviarDoCampo();
};
// Computador: Enter manda e Shift+Enter quebra a linha. Celular e tablet (toque): Enter quebra a
// linha e quem manda é a setinha, como no WhatsApp (19/10/2026, pedido do dono). Durante a
// composição de acento não manda.
entrada.enterKeyHint = ehToque ? 'enter' : 'send';
entrada.addEventListener('keydown', ev => {
  if (ev.key !== 'Enter' || ev.shiftKey || ev.isComposing || ehToque) return;
  ev.preventDefault(); destravarAudio(); enviarDoCampo();
});

function pintaLer() {
  document.body.classList.toggle('ler-on', lerRespostas);   // mostra os fones dos balões
  btnLer.classList.toggle('on', lerRespostas);
  btnLer.title = lerRespostas ? 'Ler respostas em voz alta: ligado'
                              : 'Ler respostas em voz alta: desligado';
  btnLer.setAttribute('aria-pressed', String(lerRespostas));
  btnLer.setAttribute('aria-label', 'Leitura em voz alta: ' + (lerRespostas ? 'ligada' : 'desligada'));
  btnLer.innerHTML = (lerRespostas ? '🔊' : '🔇') +
    ' <span class="lbl">' + (lerRespostas ? 'ler: sim' : 'ler: não') + '</span>';
}
btnLer.onclick = () => {
  destravarAudio();
  lerRespostas = !lerRespostas;
  // desligou a leitura: o que ainda esperava na fila não pode falar depois
  if (!lerRespostas && (falando || tocandoAgora || retomadaLeitura || filaLeitura.length)) pararFala();
  pintaLer();
};

function pintaContinua() {
  btnContinua.classList.toggle('on', continua);
  btnContinua.setAttribute('aria-pressed', String(continua));
  btnContinua.setAttribute('aria-label', 'Conversa contínua: ' + (continua ? 'ligada' : 'desligada'));
  btnContinua.innerHTML = '🔁 <span class="lbl">' + (continua ? 'contínua: sim' : 'contínua: não') + '</span>';
}
btnContinua.onclick = () => {
  destravarAudio();
  continua = !continua;
  if (continua && !lerRespostas) { lerRespostas = true; pintaLer(); }
  pintaContinua();
};

/* ── Cota da voz (custo é assunto sensível: avisa antes de falhar) ── */
async function conferecota() {
  try {
    const d = await api('/api/v1/tts/cota');
    if (d.pct == null) {
      if (d.aviso) console.warn('cota:', d.aviso);
      return;
    }
    if (d.pct >= (d.teto_pct || 97)) {
      mostraAviso('A cota de voz está no limite (' + d.usado + ' de ' + d.limite +
                  ' caracteres, ' + d.pct + '%). As respostas ficam só em texto ' +
                  'até o mês virar.');
    } else if (d.pct >= 90) {
      mostraAviso('A cota de voz está em ' + d.pct + '% (' + d.usado + ' de ' +
                  d.limite + ' caracteres). Perto do teto de ' +
                  (d.teto_pct || 97) + '%, quando a voz para sozinha.');
    }
  } catch (e) {
    console.warn('cota:', e.message);
  }
}

/* ── Seta pro fim ─────────────────────────────────────────────────────────
   Rolou mais de uma tela pra cima: aparece a seta; o toque leva ao fim NA HORA
   (nada de rolagem animada), e o número em cima dela é quantas respostas
   chegaram enquanto a pessoa lia lá em cima. */
function distanciaDoFim() { return chat.scrollHeight - chat.scrollTop - chat.clientHeight; }

/* Quanto do fundo da janela está ocupado: a barra de baixo e as faixas de
   aviso, que mudam de altura. A seta fica acima disso. */
function fundoLivre() {
  let fundo = window.innerHeight - chat.getBoundingClientRect().bottom;
  for (const f of [fErro, fAviso, document.getElementById('faixaAudio')]) {
    if (!f) continue;
    if (f.classList.contains('aparece')) {
      fundo = Math.max(fundo, window.innerHeight - f.getBoundingClientRect().top);
    }
  }
  return Math.max(fundo, 0);
}

function posicionaSeta() {
  if (!btnFim || btnFim.hidden) return;
  btnFim.style.bottom = Math.round(fundoLivre() + 12) + 'px';
}

function atualizaSeta() {
  const d = distanciaDoFim();
  if (d < 160) { novasAbaixo = 0; setaVisivel = false; }
  else if (d > chat.clientHeight || novasAbaixo > 0) setaVisivel = true;
  const apareceu = setaVisivel && btnFim.hidden;
  btnFim.hidden = !setaVisivel;
  const txt = novasAbaixo > 99 ? '99+' : String(novasAbaixo);
  if (fimNovas.textContent !== txt) fimNovas.textContent = txt;
  fimNovas.hidden = !novasAbaixo;
  const rot = novasAbaixo
    ? 'Ir para o fim: ' + novasAbaixo + (novasAbaixo === 1 ? ' resposta nova' : ' respostas novas')
    : 'Ir para a mensagem mais nova';
  if (btnFim.getAttribute('aria-label') !== rot) btnFim.setAttribute('aria-label', rot);
  if (apareceu) posicionaSeta();
}
btnFim.onclick = () => {
  novasAbaixo = 0;
  voltaAoFim();
};
chat.addEventListener('scroll', atualizaSeta, { passive: true });
window.addEventListener('resize', () => { atualizaSeta(); posicionaSeta(); });

/* ── Visita guiada (Tutorial) ─────────────────────────────────────────────
   O tour em si mora no tour.js (holofote, Anterior/Próximo/Fechar). Aqui ficam
   os passos desta tela: cada um responde o que é, como funciona e por que está
   ali, em linguagem de quem nunca viu o sistema. */

function passosTutorial() {
  const abreM = () => abreMenu(true), fechaM = () => abreMenu(false);
  const nome = AGENTE.nome;
  const passos = [
    ...window.DGMenuLado.passosMenu({ nome, abre: abreM, fecha: fechaM, comTroca: agentesMenu.length > 1, naConversa: true }),
    { alvo: '#chat', antes: fechaM, titulo: 'A conversa',
      oque: 'Aqui aparece tudo o que você e ' + nome + ' já escreveram, na ordem, como num aplicativo de mensagens.',
      como: 'As respostas chegam sozinhas, sem precisar atualizar a página. Role para cima para ver as mensagens mais antigas; a seta no canto leva de volta para a mais nova. Quando uma mensagem veio ou foi respondida pelo WhatsApp ou pelo Telegram, ela ganha um selinho com o nome do canal; passe o dedo ou o mouse nele para ver os detalhes.',
      porque: 'É o histórico do seu trabalho com o agente. Nada se perde quando você fecha a tela.' },
    { alvo: '.campo', titulo: 'O campo de mensagem',
      oque: 'O lugar onde você escreve para ' + nome + '.',
      como: 'Escreva e aperte Enter (ou a seta verde) para enviar. Para pular de linha no computador, use Shift+Enter.',
      porque: 'Falar com o agente por texto é o jeito mais direto de pedir alguma coisa. Se o envio falhar, o balão fica marcado e você escolhe entre reenviar e descartar.' },
    { alvo: '.campo', titulo: 'Comandos com a barra',
      oque: 'Quando a mensagem começa com / (uma barra), aparece uma lista de comandos que ' + nome + ' entende, como /compact, /context e as skills que ele tem instaladas.',
      como: 'Digite / e a lista abre acima do campo; continue digitando para filtrar. Use as setas e Enter, ou toque no item: o nome vai para o campo e você só acrescenta o que falta e envia. Os que não rodam por aqui aparecem apagados, com o motivo. Para mandar um texto que começa com barra, escreva // no começo.',
      porque: 'Assim você não precisa decorar os nomes. O que o terminal responde (por exemplo o /context) volta na conversa, num bloco fechado "resultado do comando".' },
    { alvo: '#btnAnexo', titulo: 'Anexos e conversa nova',
      oque: 'O ➕ serve para mandar fotos, vídeos, áudios e PDFs para o agente, e para começar uma conversa nova.',
      como: 'Toque nele e escolha Anexar arquivo (até 10 por mensagem), ou cole uma imagem direto no campo. Cada arquivo sobe em segundo plano e a mensagem sai quando todos estiverem prontos. Nova conversa pede um segundo toque e guarda a conversa de agora no Histórico.',
      porque: 'Muita coisa é mais fácil de mostrar do que de explicar: um print de erro, um documento, uma foto.' },
    { alvo: document.querySelector('.dgcofre') ? '.dgcofre' : '#chat', titulo: 'A caixa de cofre',
      oque: 'Quando ' + nome + ' precisa de uma senha ou chave de um serviço (OpenAI, Hostinger, Groq...), ele mostra aqui um cartão com um campo de senha, em vez de pedir para você colar a chave na conversa.',
      como: 'Cole a chave no campo e toque em Salvar no cofre. O valor vai direto para o cofre de ' + nome + ' e não entra na conversa nem chega a ele; só o nome e o final da chave são avisados. Salvar reinicia ' + nome + ' para a chave valer, e a conversa continua de onde parou. O olho mostra o que você colou, e o Esc limpa o campo.',
      porque: 'Tudo o que passa pela conversa fica guardado no histórico. Aqui a chave nunca passa por ele, e você pode trocar a chave quando quiser: o cartão avisa se já existe uma guardada.' },
  ];
  if (caps.microfone) {
    passos.push({ alvo: '#btnMic', titulo: 'O microfone',
      oque: 'Em vez de escrever, você pode falar.',
      como: 'Toque uma vez para começar a gravar e outra para parar: o texto aparece no campo para você revisar antes de enviar. A seta verde durante a gravação transcreve e já envia.',
      porque: 'Quando você está com as mãos ocupadas ou no celular, falar é bem mais rápido do que digitar.' });
  }
  passos.push({ alvo: '#atividade', titulo: 'O indicador de atividade',
    antes: () => {
      demoAtividade = true;
      const el = $('atividade');
      el.hidden = false;
      el.className = '';
      el.querySelector('.atv-nome').textContent = nome + ' está trabalhando';
      el.querySelector('.atv-sep').hidden = false;
      el.querySelector('.atv-acao').textContent = 'lendo um arquivo (exemplo)';
    },
    depois: () => { demoAtividade = false; pintaAtividade(); },
    oque: 'Uma faixa que aparece sozinha quando o agente está trabalhando. O que você vê agora é só um exemplo.',
    como: 'Ela mostra o que ele está fazendo naquele momento. Fica amarela se ele estiver esperando uma autorização sua, e cinza se a conexão com ele cair ("sem sinal").',
    porque: 'Alguns pedidos demoram. Com a faixa você sabe que o agente não travou, e sabe quando precisa agir.' });
  passos.push({ alvo: '#btnMenu', antes: fechaM, titulo: 'O botão do menu',
    oque: 'No celular, o botão ☰ abre o menu do agente. No computador ele não aparece, porque o menu já fica fixo à esquerda.',
    como: 'Toque nele quando quiser trocar de agente, abrir uma página do painel ou sair. Toque fora do menu, no ✕ ou na tecla Esc para fechar.',
    porque: 'Mantém a tela da conversa limpa: o que não é conversa fica guardado no menu.' });
  if ($('trocaBaixo') && $('trocaBaixo').offsetParent !== null) {
    passos.push({ alvo: '#trocaBaixo', antes: fechaM, titulo: 'A fileira de agentes',
      oque: 'Um avatar por agente, logo abaixo da barra de escrever. A conversa em que você está fica com um anel na cor dela.',
      como: 'Toque no avatar de outro agente para abrir a conversa com ele. Arraste para o lado se não couberem todos. Ela some enquanto o teclado está aberto.',
      porque: 'Trocar de agente com o polegar, sem abrir o menu ☰.' });
  }
  if (!EH_ADMIN) {
    passos.push({ alvo: '#mlPainel', antes: abreM, titulo: 'As páginas do painel de ' + nome,
      oque: 'Status, Memória, Operações, Custos e as outras páginas que mostram como ' + nome + ' está, o que ele guarda e quanto gasta.',
      como: 'Toque numa página e ela abre na mesma janela. Para voltar à conversa, use o item Conversa do menu do painel ou o voltar do navegador.',
      porque: 'A conversa serve para pedir coisas; as páginas do painel servem para acompanhar e ajustar o agente.' });
  }
  if (!$('mlConfig').hidden) {
    passos.push({ alvo: '#mlConfig', antes: abreM, titulo: 'Configurações',
      oque: 'Hoje tem um item: Instalar o app, que coloca o S2 Bot como aplicativo na tela inicial do aparelho.',
      como: 'No Android e no computador, com Chrome ou Edge, o toque abre o pedido de instalação do navegador. No iPhone e no iPad, o item mostra o caminho: Compartilhar e depois Adicionar à Tela de Início. O item some sozinho quando o app já está instalado.',
      porque: 'O app instalado abre sem a barra do navegador e fica a um toque, como qualquer outro aplicativo.' });
  }
  if ($('mlSessao') && !$('mlSessao').hidden) {
    passos.push({ alvo: '#mlSessao', antes: abreM, titulo: 'Reiniciar a sessão',
      oque: 'O botão que reinicia o processo de ' + nome + ' quando ele trava, sem você abrir terminal.',
      como: 'Pede a sua confirmação, reinicia e mostra uma faixa no topo até ele voltar. A conversa continua de onde estava, porque o agente retoma a mesma sessão.',
      porque: 'Quando o agente para de responder, reiniciar costuma resolver, e aqui é um toque.' });
  }
  passos.push({ alvo: '#loginCartao', titulo: 'Conectar a sua conta',
    antes: () => {
      if (lc.aberto) return;
      lc.demo = true; lc.aberto = true; lc.manual = true; lc.carregando = false; lc.iniciado = false;
      lc.dados = { estado: 'nenhum', provedor: AGENTE.provedor, precisa_login: true };
      lcDesenha();
    },
    depois: () => { if (lc.demo) lcFecha(false); },
    oque: 'Um cartão que aparece no fim da conversa quando ' + nome + ' ainda não tem a sua conta do Claude ou do Codex conectada. O que você vê agora é só um exemplo.',
    como: 'Toque em Conectar, abra a página de login, entre com a sua conta e, no Claude, cole aqui o código que ela mostrar no fim. A tela confere sozinha e avisa quando terminar. Para abrir o cartão a qualquer hora, escreva /login no campo de mensagem e envie: nada vai para o agente. Se a conta JÁ estava conectada e o login expirou, a tela abre na frente um aviso "Seu login do Claude expirou" com os botões Reconectar conta, Reiniciar a sessão e Agora não; depois do login, ' + nome + ' volta sozinho, na mesma conversa.',
    porque: 'Sem conta conectada o agente não consegue responder. Assim você resolve aqui mesmo, sem abrir terminal, e o que você mandou durante a queda não se perde: o campo guarda o texto e ' + nome + ' responde o que ficou pendente.' });
  if ($('btnSessoes') && !$('btnSessoes').hidden) {
    passos.push({ alvo: '#btnSessoes', titulo: 'O botão Sessões',
      oque: 'Um atalho para as sessões de trabalho de ' + nome + ': os cards que andam em paralelo com esta conversa. Uma bolinha vermelha avisa quando alguma espera uma decisão sua.',
      como: 'Toque nele e a tela de Sessões abre dentro do painel do agente, na mesma janela. No celular o texto some e fica só o ícone 🖥.',
      porque: 'É o mini-Bunker do agente: você acompanha e cria trabalhos longos sem sair procurando no menu, e o botão fica no topo, em todas as telas.' });
  }
  if (!$('btnPainel').hidden) {
    passos.push({ alvo: '#btnPainel', titulo: 'O botão Painel',
      oque: 'Um atalho para o painel de ' + nome + ', com Status, Memória, Operações, Custos e as outras páginas.',
      como: 'Toque nele e o painel abre na mesma janela. Para voltar, use o item Conversa do menu do painel ou o voltar do navegador.',
      porque: 'Fica no topo para você passar da conversa ao painel com um toque, sem abrir o menu.' });
  }
  passos.push({ alvo: '#btnMesa', titulo: 'O botão Board',
    oque: 'Um atalho para o Board, onde ficam o seu dia e as tarefas de todos os agentes.',
    como: 'Toque nele e o Board abre na mesma janela. Lá você acompanha o que está pendente e o que já foi feito.',
    porque: 'Você confere o andamento do trabalho sem sair procurando no menu.' });
  passos.push({ alvo: '#btnNaoLida', titulo: 'Os selos dos agentes e o "não lida"',
    oque: 'Cada agente do menu e da fileira de avatares ganha um selo: pontinhos verdes quando está trabalhando, bolinha vermelha quando terminou e você ainda não leu, e um "!" laranja quando ele precisa de você (pede permissão, fez uma pergunta ou perdeu o login). Este botão marca a conversa de ' + nome + ' como não lida.',
    como: 'O selo vem do estado que o runner de cada agente informa, atualizado a cada 10 segundos com a tela aberta. A bolinha conta as respostas depois da última que você viu. Quem pede a sua atenção também pode mandar um aviso ao celular (ligue em "Ativar avisos neste aparelho"). Ao tocar em "não lida", o menu abre e a bolinha fica até você abrir a conversa de novo; nos outros agentes, use o ⋯ ou segure o dedo no nome.',
    porque: 'Com vários agentes trabalhando, você vê de relance quem espera por você e deixa para depois uma resposta que não quer ler agora, sem perder o fio.' });
  passos.push({ alvo: '#btnLembretes', titulo: 'O botão Lembretes',
    oque: 'Um atalho para a tela de lembretes.',
    como: 'Toque nele e a lista abre na mesma janela. Lá você cria, confirma e apaga lembretes.',
    porque: 'Lembrete que insiste até você confirmar só ajuda se for fácil de achar, por isso fica no topo.' });
  if (window.DGSigilo) passos.push(window.DGSigilo.passoTour());
  passos.push(passoAlertas());
  if (window.DGFoco) passos.push(window.DGFoco.passoTutorial());
  passos.push(passoAcervo());
  return passos;
}

function iniciaTutorial() {
  if (!window.DGTour) {
    mostraErro('A visita guiada não carregou. Recarregue a página e tente de novo.');
    return;
  }
  window.DGTour.inicia({ passos: passosTutorial(), aoFechar: () => abreMenu(false) });
}
$('btnTutorial').onclick = iniciaTutorial;
$('gmTutorial').onclick = iniciaTutorial;

/* ── Faixa de ferramentas: sombra só do lado que ainda tem ícone escondido ──
   A faixa (#tools) rola para o lado no celular; .tem-esq / .tem-dir no #ferr
   acendem a sombra da borda. */
(function () {
  const ferr = $('ferr'), tools = $('tools');
  if (!ferr || !tools) return;
  function confere() {
    const max = tools.scrollWidth - tools.clientWidth;
    ferr.classList.toggle('tem-esq', tools.scrollLeft > 2);
    ferr.classList.toggle('tem-dir', max > 2 && tools.scrollLeft < max - 2);
  }
  tools.addEventListener('scroll', confere, { passive: true });
  window.addEventListener('resize', confere);
  if (window.ResizeObserver) new ResizeObserver(confere).observe(tools);
  new MutationObserver(confere).observe(tools, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['hidden', 'style'] });
  confere();
})();

/* Acervo: a lista local aparece antes da revalidação da rede. */
const acPainel = $('acervoPainel'), acLista = $('acervoLista');
let acAba = 'midias';
// O HTML pode vir do cache do app de antes de uma atualização, sem o módulo de mídias: isso
// nunca pode derrubar a conversa inteira. Sem o módulo, só o acervo avisa para recarregar.
const cacheMidias = typeof DGMidias !== 'undefined'
  ? DGMidias.criar({ conta: caps.conta, agente: AGENTE.id, base: API,
    mudou: aba => { if (aba === acAba) pintaAcervo(); } })
  : null;
const ACERVO_SEM_MODULO = 'A página foi atualizada. Recarregue.';
function dadosAcervo(aba) {
  return cacheMidias ? cacheMidias.estado(aba)
    : { itens: [], carregou: true, carregando: false, proximo: null, erro: ACERVO_SEM_MODULO };
}
const ICO_AC = (() => {
  const s = (d, t = 16) => `<svg viewBox="0 0 24 24" width="${t}" height="${t}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  return { link: s('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>', 18),
           arquivo: s('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>', 18),
           play: '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
           ir: s('<path d="M9 18l6-6-6-6"/>', 14) };
})();
function pintaAcervo() {
  if (acPainel.hidden) return;
  const d = dadosAcervo(acAba);
  $('acervoEstado').textContent = !cacheMidias ? ACERVO_SEM_MODULO : d.erro ? 'Não consegui atualizar: ' + d.erro :
    (!d.carregou ? 'Carregando os itens recentes…' : d.itens.length + (d.itens.length === 1 ? ' item' : ' itens') + (d.carregando ? ' · atualizando…' : '')) +
    (d.avisoCache ? ' · ' + d.avisoCache : '');
  let html = acAba === 'midias' ? '<div class="acgrade">' : '<div class="aclista">';
  for (const it of d.itens) {
    const quando = esc(((it.dia || '') + ' ' + (it.hhmm || '')).trim());
    let corpo;
    if (acAba === 'links') corpo = `<a class="aclinha" href="${esc(it.url)}" target="_blank" rel="noopener"><span class="ac-sim" aria-hidden="true">${ICO_AC.link}</span>` +
      `<span class="ac-tx"><span>${esc(it.dominio)}</span><small>${quando} · ${esc(it.url)}</small></span></a>`;
    else {
      const md = it.media; midias[md.id] = md;
      const img = md.disponivel && md.thumb ? `<img src="${esc(md.thumb)}" loading="lazy" decoding="async" width="320" height="320" alt="${esc(md.nome)}" onerror="this.hidden=true">` : '';
      corpo = acAba === 'midias'
        ? `<button class="acfoto" data-midia="${esc(md.id)}" aria-label="${esc(md.nome)}">${esc(md.nome)}${img}${md.kind === 'video' ? `<span class="ac-play" aria-hidden="true">${ICO_AC.play}</span>` : ''}</button>`
        : `<button class="aclinha" data-midia="${esc(md.id)}"><span class="ac-sim" aria-hidden="true">${ICO_AC.arquivo}</span>` +
          `<span class="ac-tx"><span>${esc(md.nome)}</span><small>${[quando, md.bytes ? tamanhoHumano(md.bytes) : ''].filter(Boolean).join(' · ')}</small></span></button>`;
    }
    const ir = acAba === 'midias' ? `${quando}${ICO_AC.ir}` : ICO_AC.ir;
    html += `<div class="acitem">${corpo}<button class="acir" data-origem="${esc(it.msg_id)}" title="Ir para a mensagem" aria-label="Ir para a mensagem">${ir}</button></div>`;
  }
  html += '</div>';
  if (d.erro && cacheMidias) html += '<button class="acmais" data-tentar>Atualizar novamente</button>';
  if (d.proximo) html += `<button class="acmais" data-mais ${d.carregando ? 'disabled' : ''}>${d.carregando ? 'Carregando…' : 'Carregar anteriores'}</button>`;
  else if (cacheMidias && d.carregou && !d.itens.length) html += '<p>Nada deste tipo na conversa ainda.</p>';
  acLista.innerHTML = html;
}
function abreAcervo(aba = acAba) {
  acAba = aba; acPainel.hidden = false;
  for (const b of acPainel.querySelectorAll('[data-aba]')) b.setAttribute('aria-selected', String(b.dataset.aba === aba));
  pintaAcervo(); if (cacheMidias) cacheMidias.abrir(aba);
}
function fechaAcervo() { acPainel.hidden = true; if (cacheMidias) cacheMidias.fechar(); }
$('who').addEventListener('click', () => abreAcervo());
$('who').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abreAcervo(); } });
$('av').addEventListener('click', () => abreAcervo());
$('acervoFechar').onclick = fechaAcervo;
document.addEventListener('keydown', e => { if (e.key === 'Escape') fechaAcervo(); });
acPainel.querySelector('nav').onclick = e => { const b = e.target.closest('[data-aba]'); if (b) { acLista.scrollTop = 0; abreAcervo(b.dataset.aba); } };
acLista.addEventListener('scroll', () => {
  if (cacheMidias && acLista.scrollHeight - acLista.scrollTop - acLista.clientHeight < 250) cacheMidias.mais(acAba);
}, { passive: true });
acLista.onclick = async e => {
  if (!cacheMidias) return;
  if (e.target.closest('[data-mais]')) return cacheMidias.mais(acAba);
  if (e.target.closest('[data-tentar]')) return cacheMidias.abrir(acAba);
  const md = e.target.closest('[data-midia]'); if (md) return abreLightbox(md.dataset.midia);
  const origem = e.target.closest('[data-origem]'); if (!origem) return;
  try {
    const d = await api(API + '/compartilhados?mensagem=' + encodeURIComponent(origem.dataset.origem));
    const porId = new Map([...(d.msgs || []), ...msgs].map(m => [m.id, m]));
    msgs = [...porId.values()].sort((a, b) => a.ep - b.ep); fechaAcervo(); render({ semRolar: true });
    const el = wrap.querySelector('[data-msg="' + CSS.escape(d.mensagem.id) + '"]');
    if (!el) throw new Error('A mensagem não apareceu. Atualize a conversa.');
    rolagem.mostra(el, { block: 'center' }); el.classList.add('alerta-destaque');
    setTimeout(() => el.classList.remove('alerta-destaque'), 3000);
  } catch (err) { mostraErro(err.message); }
};
function passoAcervo() {
  return { alvo: '#acervoLista', antes: () => abreAcervo(), titulo: 'Mídias, links e arquivos',
    oque: 'Tudo o que foi compartilhado na conversa disponível, separado por tipo.',
    como: 'O aparelho mostra o que já guardou e busca novidades em segundo plano. Carrega 20 por vez, até 60 itens ou 30 dias; role para buscar os anteriores. Só miniaturas aparecem na grade.',
    porque: 'Reabrir o painel fica rápido e economiza dados. O arquivo completo só abre quando você toca nele.' };
}
$('acervoAjuda').onclick = () => window.DGTour.inicia({ passos: [passoAcervo()] });
document.addEventListener('click', async e => {
  const a = e.target.closest('a[href="/sair"]'); if (!a) return;
  e.preventDefault(); if (cacheMidias) await cacheMidias.limpar(); location.href = a.href;
});

/* ── Partida ──────────────────────────────────────────────────────────────── */
pintaLer();
pintaContinua();
pintaMic();
estadoOcioso();
const emCache = leCache();
if (emCache) {
  msgs = emCache;
  carregouUmaVez = true;
  render();
  rolagem.aoFim();
}
carregar(true).then(() => ligaStream());
ligaResync();
if (caps.voz) conferecota();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(e => console.warn('sw:', e.message));
}
/* Alertas de mensagem. O servidor guarda o reconhecimento entre aparelhos. */
const alertasPilha = $('alertasPilha'), alertasCaixa = $('alertasMensagem');
let alertasLista = [], alertasLendo = false, alertasRevisao = 0;
const alertasEmCurso = new Set();
function posicionaAlertas() {
  alertasCaixa.style.bottom = Math.round(fundoLivre() + 74) + 'px';
}
/* ── Filtros no topo (18/10/2026, opção 3 do dono) ─────────────────────────────
   No lugar da pilha de bolinhas ✅/⚠️ na lateral: chips Tudo · Não vistas · Pedem ação ·
   Entregas, que filtram a conversa, e uma etiqueta pequena ao lado da hora. O aviso some
   sozinho quando a mensagem fica à vista por um instante (como o "lido" do WhatsApp). */
const filtrosEl = $('filtros'), filtroVazioEl = $('filtroVazio');
let filtro = 'tudo';
const vistosEnviados = new Set();
function contagensFiltro() {
  // o número de cada chip é o que ainda não foi visto (19/10/2026: "Entregas 4" com tudo lido confundia);
  // o filtro Entregas continua mostrando todas as entregas da conversa
  return { nv: alertasLista.length, pedidos: alertasLista.filter(a => a.tipo === 'pedido').length,
           entregas: alertasLista.filter(a => a.tipo === 'entrega').length,
           temEntregas: msgs.some(m => m.alerta === 'entrega') };
}
function desenhaAlertas() {
  pintaBadgeApp();
  alertasCaixa.hidden = true;   // a pilha lateral antiga não aparece mais
  const c = contagensFiltro();
  // o Histórico fica sempre à mão (no Admin, só com as conversas arquivadas)
  const temHist = !!window.DGHistorico;
  // 23/10/2026 (opção A do dono): a fileira sai do topo; pedidos e entregas ficam marcados na conversa e na
  // Caixa de entrada, e o Histórico foi para o menu do ➕. O código fica, só não aparece.
  filtrosEl.hidden = true;
  const chip = (k, rot, n, cls) => `<button type="button" class="filtro${filtro === k ? ' on' : ''}${cls ? ' ' + cls : ''}" data-filtro="${k}" aria-pressed="${filtro === k}">` +
    `${rot}${n ? ` <b>${n}</b>` : ''}</button>`;
  filtrosEl.innerHTML = chip('tudo', 'Tudo', 0) + chip('nao-vistas', 'Não vistas', c.nv) +
    chip('pedidos', 'Pedem ação', c.pedidos, c.pedidos ? 'tem-pedido' : '') + chip('entregas', 'Entregas', c.entregas) +
    (temHist ? `<button type="button" class="filtro filtro-hist" data-historico title="${EH_ADMIN ? 'Ver as conversas arquivadas' : 'Buscar nas conversas antigas e ver as memórias'}">${window.DGHistorico.ICONE}Histórico</button>` : '');
  aplicaFiltro();
}
function idsDoFiltro() {
  if (filtro === 'nao-vistas') return new Set(alertasLista.map(a => a.mensagem_id));
  if (filtro === 'pedidos') return new Set(alertasLista.filter(a => a.tipo === 'pedido').map(a => a.mensagem_id));
  if (filtro === 'entregas') return new Set(msgs.filter(m => m.alerta === 'entrega').map(m => m.id));
  return null;
}
function aplicaFiltro() {
  const ids = idsDoFiltro();
  const pendentes = new Set(alertasLista.map(a => a.mensagem_id));
  let visiveis = 0;
  for (const el of wrap.children) {
    const id = el.dataset ? el.dataset.msg : '';
    const dentro = !ids || (id && ids.has(id));
    el.classList.toggle('fora-do-filtro', !dentro);
    if (id) el.classList.toggle('alerta-pendente', pendentes.has(id));
    if (dentro && id) visiveis++;
  }
  wrap.classList.toggle('filtrando', !!ids);
  filtroVazioEl.hidden = !ids || visiveis > 0;
  if (ids && !visiveis) filtroVazioEl.textContent = filtro === 'entregas' ? 'Nenhuma entrega nesta conversa.' : 'Tudo em dia: nada esperando você aqui.';
}
// mensagem de um aviso que ainda não está na tela (mais antiga): busca e junta ao histórico
async function garanteMensagemDoAlerta(a) {
  if (msgs.some(m => m.id === a.mensagem_id)) return;
  const d = await api(API + '/alertas/' + encodeURIComponent(a.id) + '/mensagem');
  const porId = new Map([...(d.msgs || []), ...msgs].map(m => [m.id, m]));
  porId.set(d.mensagem.id, d.mensagem);
  msgs = Array.from(porId.values()).sort((x, y) => x.ep - y.ep);
  maisAntigas = !!d.mais_antigas;
}
wrap.addEventListener('click', ev => {
  if (ev.target.closest('[data-abre-historico]')) window.DGHistorico.abre({ id: AGENTE.id, nome: AGENTE.nome || 'o agente', soArquivadas: EH_ADMIN }, 'arquivadas');
});
filtrosEl.addEventListener('click', async ev => {
  if (ev.target.closest('[data-historico]')) { window.DGHistorico.abre({ id: AGENTE.id, nome: AGENTE.nome || 'o agente', soArquivadas: EH_ADMIN }); return; }
  const b = ev.target.closest('[data-filtro]'); if (!b) return;
  filtro = b.dataset.filtro;
  try {
    if (filtro === 'nao-vistas' || filtro === 'pedidos') {
      for (const a of alertasLista) await garanteMensagemDoAlerta(a);
      render({ semRolar: true });
    }
  } catch (e) { mostraErro('Não consegui trazer todas as mensagens do filtro: ' + e.message); }
  desenhaAlertas();
  const primeira = Array.from(wrap.children).find(el => el.dataset && el.dataset.msg && !el.classList.contains('fora-do-filtro'));
  if (filtro !== 'tudo' && primeira) rolagem.mostra(primeira, { block: 'start' });
  if (filtro === 'tudo') rolagem.mostra(wrap.lastElementChild || wrap, { block: 'end' });
});
/* Histórico (historico.js): leva até a mensagem de um trecho achado na busca. O trecho vem do
   índice do agente (hora do registro dele); a mensagem do chat é a do mesmo lado mais perto dessa
   hora, até 3 min. Se ela é antiga, traz as páginas de trás até chegar lá. */
// "Nova conversa" do Histórico: é o mesmo /clear que o dono pode digitar (o servidor arquiva a anterior)
window.DGConversaNova = () => enviarTexto('/clear');
window.DGConversaRetomar = (texto) => enviarTexto(texto);
window.DGConversaIr = async (epMs, doDono) => {
  const ep = epMs / 1000, JANELA = 3 * 60;   // as mensagens contam em segundos
  const perto = () => {
    let melhor = null, dist = Infinity;
    for (const m of msgs) {
      if (typeof m.ep !== 'number' || ehDono(m) !== doDono) continue;
      const d = Math.abs(m.ep - ep);
      if (d < dist) { dist = d; melhor = m; }
    }
    return dist <= JANELA ? melhor : null;
  };
  let m = perto();
  for (let voltas = 0; !m && maisAntigas && msgs.length && menorEp() > ep - JANELA && voltas < 40; voltas++) {
    if (carregandoAntigas) await new Promise(ok => setTimeout(ok, 250));
    else await carregaAntigas();
    m = perto();
  }
  if (!m) return false;
  if (filtro !== 'tudo') { filtro = 'tudo'; desenhaAlertas(); }
  const alvo = Array.from(wrap.children).find(el => el.dataset && el.dataset.msg === m.id);
  if (!alvo) return false;
  rolagem.mostra(alvo, { block: 'center' });
  alvo.classList.remove('msg-achada'); void alvo.offsetWidth; alvo.classList.add('msg-achada');
  return true;
};
// "visto": a mensagem de um aviso ficou à vista por 1,2 s com a tela aberta
const olhoVisto = 'IntersectionObserver' in window ? new IntersectionObserver(entradas => {
  for (const en of entradas) {
    const el = en.target;
    clearTimeout(el._vistoT);
    if (!en.isIntersecting || en.intersectionRatio < 0.5) continue;
    el._vistoT = setTimeout(async () => {
      const a = alertasLista.find(x => x.mensagem_id === el.dataset.msg);
      if (!a || document.hidden || vistosEnviados.has(a.id)) return;
      vistosEnviados.add(a.id);
      try {
        await api(API + '/alertas/' + encodeURIComponent(a.id) + '/visto', { method: 'POST', body: {} });
        alertasLista = alertasLista.filter(x => x.id !== a.id);
        alertasRevisao++;
        desenhaAlertas();
      } catch (e) { vistosEnviados.delete(a.id); console.warn('visto:', e.message); }
    }, 1200);
  }
}, { root: chat, threshold: [0, 0.5, 1] }) : null;
/* ✓✓ azul nas mensagens do agente quando ficam à vista por 1 s (guardado por aparelho) */
const olhoLeitura = 'IntersectionObserver' in window ? new IntersectionObserver(entradas => {
  for (const en of entradas) {
    const el = en.target;
    clearTimeout(el._lerT);
    if (!en.isIntersecting || en.intersectionRatio < 0.5) continue;
    el._lerT = setTimeout(() => {
      if (document.hidden) return;
      const ep = Number(el.dataset.epChk) || 0;
      if (ep <= vistoAteEp) return;
      vistoAteEp = ep;
      try { localStorage.setItem('dgclaw-visto-ate:' + AGENTE.id, String(vistoAteEp)); } catch (_) { /* sem storage */ }
      for (const c of wrap.querySelectorAll('.checks[data-ep-chk]')) {
        if (Number(c.dataset.epChk) <= vistoAteEp && !c.classList.contains('lido')) {
          c.classList.add('lido'); c.innerHTML = CHECK_2; c.title = 'você viu'; c.setAttribute('aria-label', 'vista por você');
        }
      }
      baixaAntigos();
    }, 1000);
  }
}, { root: chat, threshold: [0, 0.5, 1] }) : null;
function observaLeitura() {
  if (!olhoLeitura) return;
  olhoLeitura.disconnect();
  for (const c of wrap.querySelectorAll('.checks[data-ep-chk]:not(.lido)')) olhoLeitura.observe(c);
}
filtrosProntos = true;
function observaVistos() {
  if (!olhoVisto) return;
  olhoVisto.disconnect();
  // só entrega some ao ser vista; pedido espera a sua resposta (respondePedidos)
  const pend = new Set(alertasLista.filter(a => a.tipo !== 'pedido').map(a => a.mensagem_id));
  for (const el of wrap.querySelectorAll('[data-msg]')) if (pend.has(el.dataset.msg)) olhoVisto.observe(el);
}
/* Aviso que ficou para trás (18/10/2026: o número na fileira não sumia mesmo com tudo lido): a
   entrega sai quando você já viu uma mensagem do agente igual ou mais nova que ela (o ✓✓ azul), e o
   pedido sai quando você já escreveu depois dele. Sem isso, entrega antiga, de uma página da conversa
   que nunca voltou à tela, ficava "não vista" para sempre. */
async function baixaAntigos() {
  const dono = ultimaFalaDono();
  const velhos = alertasLista.filter(a => !vistosEnviados.has(a.id) && typeof a.ep === 'number' &&
    (a.tipo === 'pedido' ? a.ep < dono : a.ep <= vistoAteEp));
  if (!velhos.length) return;
  for (const a of velhos) {
    vistosEnviados.add(a.id);
    try {
      await api(API + '/alertas/' + encodeURIComponent(a.id) + '/visto', { method: 'POST', body: {} });
      alertasLista = alertasLista.filter(x => x.id !== a.id);
    } catch (e) { vistosEnviados.delete(a.id); console.warn('aviso antigo:', e.message); }
  }
  alertasRevisao++; desenhaAlertas();
}
/* Você escreveu depois de um pedido: ele foi respondido e sai de "Pedem ação". */
async function respondePedidos() {
  const pedidos = alertasLista.filter(a => a.tipo === 'pedido' && !vistosEnviados.has(a.id));
  for (const a of pedidos) {
    vistosEnviados.add(a.id);
    try {
      await api(API + '/alertas/' + encodeURIComponent(a.id) + '/visto', { method: 'POST', body: {} });
      alertasLista = alertasLista.filter(x => x.id !== a.id);
    } catch (e) { vistosEnviados.delete(a.id); console.warn('pedido respondido:', e.message); }
  }
  if (pedidos.length) { alertasRevisao++; desenhaAlertas(); }
}
function passoAlertas() {
  return { alvo: '[data-tour="alertas"]', titulo: 'Entregas e pedidos',
    oque: '✅ Uma entrega importante ficou pronta. ⚠️ O agente espera uma decisão sua.',
    como: 'Cada ícone corresponde a uma mensagem marcada pelo agente. Toque para ir até ela e retirar o aviso em todos os aparelhos. A cor do balão permanece. Retirar um pedido não significa autorizá-lo: responda na conversa.',
    porque: 'A pilha lembra o que merece atenção, mesmo depois de fechar o app. Você limpa um aviso por vez, sem uma tela de gestão.' };
}
$('alertasAjuda').onclick = () => window.DGTour.inicia({ passos: [passoAlertas()] });
async function consultaAlertas() {
  if (alertasLendo || document.hidden) return;
  alertasLendo = true;
  const revisao = alertasRevisao;
  try {
    const d = await api(API + '/alertas');
    if (revisao === alertasRevisao) { alertasLista = d.alertas || []; desenhaAlertas(); observaVistos(); baixaAntigos(); }
    if (d.avisos && d.avisos.length) mostraAviso(d.avisos.join(' '));
  } catch (e) { mostraErro('Não consegui atualizar os alertas: ' + e.message); }
  finally { alertasLendo = false; }
}
consultaAlertas(); setInterval(consultaAlertas, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) consultaAlertas(); });
window.addEventListener('resize', posicionaAlertas);

/* ── Reiniciar sessão do agente ─────────────────────────────────────────────
   O item #gmReiniciar mora no menu (casca.js) e nasce escondido: só a Conversa o mostra.
   Fluxo: diálogo de confirmação, POST /reiniciar (o runner refaz o processo e retoma a MESMA
   conversa), faixa no topo e acompanhamento pela foto de atividade que o stream já traz.
   "De volta" = o agente deixou de estar sem sinal por 2 leituras seguidas. Teto de 150 s. */
(function () {
  const faixaR = $('faixaReinicio'), dlg = $('dlgReinicio'), item = $('gmReiniciar');
  if (!faixaR || !dlg || !item) { console.warn('reinício: faltam elementos na página (faixa, diálogo ou item do menu); o botão não foi ligado.'); return; }
  const URL_REINICIO = API + '/reiniciar';
  const txt = faixaR.querySelector('.rtxt'), ico = faixaR.querySelector('.rico');
  let tempo = null, sumir = null, emCurso = false;
  item.closest('section').hidden = false;

  function mostra(tipo, texto, acoes) {
    clearTimeout(sumir);
    faixaR.className = tipo;
    faixaR.hidden = false;
    ico.textContent = tipo === 'ok' ? '✓' : tipo === 'erro' ? '!' : '↻';
    txt.textContent = texto;
    faixaR.querySelectorAll('.racoes').forEach(e => e.remove());
    if (acoes && acoes.length) {
      const caixa = document.createElement('div');
      caixa.className = 'racoes';
      for (const a of acoes) {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = a.rotulo; b.onclick = a.fn;
        caixa.appendChild(b);
      }
      faixaR.appendChild(caixa);
    }
  }
  const esconde = () => { clearTimeout(sumir); clearTimeout(tempo); faixaR.hidden = true; faixaR.className = ''; };
  const falha = causa => mostra('erro', 'Não consegui reiniciar a sessão de ' + AGENTE.nome + ': ' + causa, [
    { rotulo: 'Fechar', fn: esconde }, { rotulo: 'Tentar de novo', fn: dispara }]);

  function acompanha(textoInicial) {
    clearTimeout(tempo);
    const ini = Date.now();
    // Só vale retrato do servidor posterior ao pedido: a foto que já estava na tela pode ser antiga
    // e ainda mostrar o agente "vivo" (ou "sem login") de antes do reinício.
    const marco = atvAgoraMs() / 1000;
    let vivas = 0, ultimoAgora = null;
    mostra('rodando', textoInicial || 'Reiniciando a sessão de ' + AGENTE.nome + '…');
    const volta = () => {
      const v = PURO.avaliaVolta({ marco, ultimoAgora, vivas, foto: window.atividadeFoto, agenteId: AGENTE.id, streamAberto, decorridoMs: Date.now() - ini });
      vivas = v.vivas; ultimoAgora = v.ultimoAgora;
      if (v.acao === 'indeterminado') {
        emCurso = false;
        mostra('ok', 'Pedi o reinício da sessão de ' + AGENTE.nome + ', mas não consigo confirmar quando ele volta (o arquivo conversa-puro.js não carregou). Recarregue a página para conferir.');
        sumir = setTimeout(esconde, 12000);
        return;
      }
      if (v.acao === 'sem_login' || v.acao === 'login_expirado') {
        emCurso = false;
        return falha('o agente voltou, mas está sem a conta do Claude/Codex conectada. ' + (v.motivo || 'Conecte a conta pelo cartão que aparece na conversa.'));
      }
      if (v.acao === 'voltou') {
        emCurso = false;
        mostra('ok', AGENTE.nome + ' voltou. A conversa continua daqui, de onde estava.');
        sumir = setTimeout(esconde, 8000);
        return;
      }
      if (Date.now() - ini > 150000) {
        emCurso = false;
        return falha('passaram 150 s e o agente não voltou a responder. Peça ao Admin para conferir o serviço dele (dgclaw status).');
      }
      tempo = setTimeout(volta, 2000);
    };
    tempo = setTimeout(volta, 2000);
  }

  async function dispara() {
    if (emCurso) return;
    emCurso = true;
    mostra('rodando', 'Reiniciando a sessão de ' + AGENTE.nome + '…');
    try {
      await api(URL_REINICIO, { method: 'POST', body: {}, timeoutMs: 40000 });
    } catch (e) {
      // 504: o pedido pode ter chegado ao runner. Oferecer "Tentar de novo" já reiniciaria duas vezes,
      // então a faixa mostra o aviso e passa a acompanhar até o agente responder.
      if (e.status === 504) return acompanha(e.message);
      emCurso = false;
      return falha(e.message);
    }
    acompanha();
  }

  function abreDialogo() {
    abreMenu(false);
    if (emCurso) return;
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    $('dlgReinicioNao').focus();
  }
  const fechaDialogo = () => { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); };
  $('dlgReinicioNao').onclick = fechaDialogo;
  $('dlgReinicioSim').onclick = () => { fechaDialogo(); dispara(); };
  item.onclick = abreDialogo;
  reiniciaSessao = dispara;   // o pop-up de login expirado usa o mesmo reinício e a mesma faixa
})();

}   // fim de iniciaTela

boot();
