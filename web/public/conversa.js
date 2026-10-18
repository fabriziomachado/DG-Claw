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
  nav.innerHTML = (admin ? `<a class="fil novo" href="/a/${encodeURIComponent(admin.id)}#criar" aria-label="Criar um agente novo">` +
      `<span class="fil-foto"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></span>` +
      `<span class="fil-nome">Novo</span></a>` : '') +
    lista.map(a => {
      const atual = a.id === atualId;
      return `<a class="fil${atual ? ' atual' : ''}" href="/a/${encodeURIComponent(a.id)}" data-avt="${escF(a.id)}" style="--arco:${escF(a.cor || '#2f9e5e')}"` +
        `${atual ? ' aria-current="page"' : ''} aria-label="${escF((atual ? 'Conversa aberta: ' : 'Conversar com ') + a.nome)}">` +
        `<span class="fil-foto" style="background:${escF(a.cor || '#2f9e5e')}">${fotoFileira(a)}</span>` +
        `<span class="fil-nome">${escF(a.nome)}</span></a>`;
    }).join('');
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
  const est = { noFim: true, ancora: null };
  const nosVistos = new WeakSet();
  const itens = () => {
    const l = Array.from(wrap.children);
    for (const f of chat.children) if (f !== wrap) l.push(f);
    return l.filter(e => !e.hidden && e.offsetHeight > 0);
  };
  function captura() {
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
  // passivo: só mede. A posição de quem está rolando nunca é tocada aqui.
  chat.addEventListener('scroll', captura, { passive: true });
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
  try { localStorage.setItem('dgclaw:agente', AGENTE.id); } catch (_) { /* sem armazenamento: a casca usa o primeiro agente */ }
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
document.title = AGENTE.nome + ' - DG Claw';
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
    for (const a of outros) {
      let lista = [];
      try {
        const r = await fetch('/api/v1/agents/' + encodeURIComponent(a.id) + '/alertas', { credentials: 'same-origin', cache: 'no-store' });
        if (!r.ok) continue;
        lista = ((await r.json()) || {}).alertas || [];
      } catch (_) { continue; }
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
  if (id !== AGENTE.id) el.title = sim ? nome + ' está trabalhando' : '';
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
  pcSincroniza();
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
const lc = { aberto: false, manual: false, iniciado: false, demo: false, dispensado: false,
             carregando: false, ocupado: false, dados: null, erro: '', codigo: '', copiado: false,
             timer: null, conferindo: false, chave: '', fechaTimer: null };
const LOGIN_API = API + '/login';

function lcVisao() {
  return LC.visao(lc.dados, { iniciado: lc.iniciado, agente: AGENTE.nome });
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

  const topo = lcEl_('div', 'lc-topo');
  const tit = lcEl_('b', 'lc-titulo', v.titulo);
  tit.id = 'lcTitulo';
  topo.append(tit);
  lcEl.setAttribute('aria-label', v.titulo);
  const corpo = [topo];
  if (v.texto) corpo.push(lcEl_('p', 'lc-texto', v.texto));
  if (v.passos && v.passos.length) {
    const ol = lcEl_('ol', 'lc-passos');
    for (const p of v.passos) ol.append(lcEl_('li', '', p));
    corpo.push(ol);
  }
  if (v.link) {
    const a = lcEl_('a', 'lc-btn lc-link', 'Abrir a página de login');
    a.href = v.link; a.target = '_blank'; a.rel = 'noopener noreferrer';
    corpo.push(a);
  }
  if (v.codigoDispositivo) {
    const linha = lcEl_('div', 'lc-disp');
    linha.append(lcEl_('code', 'lc-disp-cod', v.codigoDispositivo));
    linha.append(lcBotao(lc.copiado ? 'Copiado' : 'Copiar', 'lc-leve', () => lcCopia(v.codigoDispositivo)));
    corpo.push(linha);
  }
  if (v.campoCodigo) {
    const rot = lcEl_('label', 'lc-rotulo', 'Cole aqui o código que aparece no fim');
    rot.htmlFor = 'lcCodigo';
    const campo = document.createElement('input');
    campo.type = 'text'; campo.id = 'lcCodigo'; campo.className = 'lc-campo';
    campo.autocomplete = 'off'; campo.spellcheck = false; campo.value = lc.codigo;
    campo.setAttribute('autocapitalize', 'off');
    campo.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); lcEnviaCodigo(); } });
    campo.addEventListener('focus', () => lcTrazCampo(campo));
    const linha = lcEl_('div', 'lc-linha');
    linha.append(campo, lcBotao('Enviar código', 'lc-principal', lcEnviaCodigo));
    corpo.push(rot, linha);
  }
  if (lc.erro) {
    const e = lcEl_('p', 'lc-erro', lc.erro);
    e.setAttribute('role', 'alert');
    corpo.push(e);
  }
  const pe = lcEl_('div', 'lc-pe');
  if (v.botao) pe.append(lcBotao(lc.ocupado && v.fase === 'inicio' ? 'Conectando…' : v.botao, 'lc-principal', lcComeca));
  if (v.entrarDeNovo) pe.append(lcBotao('Entrar de novo', 'lc-leve', lcComeca));
  if (v.cancelar) pe.append(lcBotao('Cancelar', 'lc-leve', lcCancela));
  if (v.fechar) pe.append(lcBotao('Fechar', 'lc-leve', () => lcFecha(true)));
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
                      ocupado: false, erro: '', codigo: '', copiado: false });
  const era = !lcEl.hidden;
  lcDesenha();
  if (era) estadoOcioso();
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
  // O oi é pedido já: o servidor espera o agente subir (até 60 s) e entrega uma vez só.
  api(LOGIN_API + '/oi', { method: 'POST', body: {}, timeoutMs: 75000 })
    .catch(e => mostraAviso('A conta foi conectada, mas não consegui pedir o oi do agente: ' + e.message + '. Escreva um oi na conversa.'));
  lc.fechaTimer = setTimeout(() => { lc.fechaTimer = null; lcFecha(false); }, 1500);
}

async function lcComeca() {
  if (lc.ocupado) return;
  lc.ocupado = true; lc.erro = ''; lcDesenha();
  try {
    const d = await api(LOGIN_API, { method: 'POST', body: {}, timeoutMs: 20000 });
    lc.dados = d; lc.iniciado = true; lc.carregando = false;
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
function lcAbre(manual) {
  if (lc.aberto) { if (manual) { lc.manual = true; lc.dispensado = false; } lcDesenha(); return; }
  Object.assign(lc, { aberto: true, manual: !!manual, iniciado: false, erro: '', codigo: '', carregando: true,
                      dados: { estado: 'nenhum', provedor: AGENTE.provedor, precisa_login: !manual } });
  lcDesenha();
  lcConfere();
}

/* Chamado a cada foto de atividade: abre o cartão quando falta conta e o fecha quando a falta some. */
function lcSincroniza() {
  if (lc.demo) return;
  const est = window.atividadeFoto && window.atividadeFoto.agentes ? window.atividadeFoto.agentes[AGENTE.id] : null;
  const semLogin = !!est && est.alerta === 'sem_login';
  if (!semLogin) lc.dispensado = false;
  if (semLogin && !lc.aberto && !lc.dispensado) lcAbre(false);
  else if (!semLogin && lc.aberto && !lc.manual && !lc.iniciado) lcFecha(false);
}

/* O comando /login digitado no campo: abre o cartão e não manda nada ao agente. */
function lcInterceptaLogin(texto) {
  if (!LC || !LC.ehComandoLogin(texto)) return false;
  lcAbre(true);
  return true;
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') lcConfere(); });

/* ── Cartão "O agente está esperando a sua permissão" ─────────────────────
   Aparece quando a foto de atividade traz alerta 'permissao' (o runner está em waiting_input).
   Mostra o que o agente quer fazer (o último comando sem resultado no transcript, calculado no
   servidor) e dois botões. A decisão vai para POST /permissao, que confere no runner que o agente
   ainda espera. O cartão some sozinho quando o estado sai de waiting_input. */
const TR = window.DGTrilha;
const pcEl = $('permCartao');
const pc = { aberto: false, ocupado: false, decidido: '', erro: '', chave: '' };

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
  const filho = (tag, classe, texto) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto != null) e.textContent = texto;
    return e;
  };
  pcEl.textContent = '';
  pcEl.appendChild(filho('strong', 'pc-titulo', 'O agente está esperando a sua permissão'));
  pcEl.appendChild(filho('p', 'pc-texto', AGENTE.nome + ' quer fazer isto e parou até você decidir:'));
  pcEl.appendChild(filho('pre', 'pc-pedido', TR.descricaoPedido(pedido)));
  if (pc.erro) pcEl.appendChild(filho('p', 'pc-erro', pc.erro));
  const linha = filho('div', 'pc-botoes');
  const botao = (texto, classe, decisao) => {
    const b = filho('button', 'pc-btn ' + classe, texto);
    b.type = 'button';
    b.disabled = pc.ocupado || !!pc.decidido;
    b.addEventListener('click', () => pcDecide(decisao));
    return b;
  };
  linha.appendChild(botao('Aprovar', 'pc-aprova', 'aprovar'));
  linha.appendChild(botao('Negar', 'pc-nega', 'negar'));
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
    await api(API + '/permissao', { method: 'POST', body: { decisao }, timeoutMs: 20000 });
    pc.decidido = decisao;
  } catch (e) {
    pc.erro = 'Não consegui enviar a decisão: ' + e.message;
  } finally {
    pc.ocupado = false;
    pcSincroniza();
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
const ESTADOS_CONEXAO = ['pronto', 'conectando…', 'reconectando…', 'conferindo agente…', 'agente sem sinal', 'esperando a sua permissão'];
function estadoOcioso() {
  if (!streamAberto) return setEstado(jaConectou ? 'reconectando…' : 'conectando…');
  const est = window.atividadeFoto?.agentes?.[AGENTE.id];
  if (!est) return setEstado('conferindo agente…');
  if (est.alerta === 'permissao') return setEstado('esperando a sua permissão');
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
  el.classList.remove('ok');
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
const mostraAviso = t => faixa(fAviso, t);
fErro.querySelector('.x').onclick = () => faixa(fErro, '');
fAviso.querySelector('.x').onclick = () => faixa(fAviso, '');

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

/* Link na mensagem. O ponto, a vírgula ou o parêntese que fecham a frase não
   são do endereço: antes entravam no link e ele abria quebrado ("...mc83T.").
   Parêntese só fica se abriu dentro da própria URL (Wikipédia). Roda sobre
   texto já escapado, por isso o &quot; é tratado como uma aspa só. */
const linkify = s => s.replace(/https?:\/\/[^\s<]+/g, url => {
  let fim = '';
  for (;;) {
    if (url.endsWith('&quot;')) { fim = '&quot;' + fim; url = url.slice(0, -6); continue; }
    const c = url.slice(-1);
    if (!/[.,;:!?'\])}*_]/.test(c)) break;
    if (c === ')' && url.split('(').length > url.split(')').length - 1) break;
    fim = c + fim;
    url = url.slice(0, -1);
  }
  if (/^https?:\/\/$/.test(url)) return url + fim;
  return `<a href="${url}" target="_blank" rel="noopener">${url}</a>${fim}`;
});

/* Formatação em texto simples: **x** vira negrito, e o formato markdownv2 usa *x*, _x_ e
   `x`.
   Tudo é escapado ANTES: o que vira tag aqui é só o que eu mesmo escrevo.
   O `código` vale em qualquer formato. */
function formata(htmlSeguro, fmt) {
  let s = htmlSeguro.replace(/\*\*([^*\n][^*]*?)\*\*/g, '<b>$1</b>')
    // [texto](url): o linkify já fez o <a> da url, aqui ele ganha o texto
    .replace(/\[([^\]\n]+)\]\((<a href="([^"]+)"[^>]*>[^<]*<\/a>)\)/g,
             '<a href="$3" target="_blank" rel="noopener">$1</a>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>');
  if (fmt === 'markdownv2') {
    s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<b>$2</b>')
         .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
         .replace(/\\([_*\[\]()~`>#+\-=|{}.!\\])/g, '$1');
  }
  return s;
}

/* ```diff (18/10/2026, pedido do dono): o que mudou num código, linha a linha, como no GitHub.
   Vale para ```diff e ```patch, e para bloco sem língua que tem cara de diff (@@ ou ---/+++).
   Cada linha vira um <span> com o \n dentro: o copiar (pre.textContent) devolve o texto igual. */
function ehDiff(lingua, cod) {
  if (lingua === 'diff' || lingua === 'patch') return true;
  if (lingua) return false;
  const l = cod.split('\n');
  return l.some(x => /^@@ .* @@/.test(x)) || (l.some(x => x.startsWith('--- ')) && l.some(x => x.startsWith('+++ ')));
}
/* Cores de sintaxe (18/10/2026, pedido do dono): bloco com a língua no cabeçalho (```php, ```bash...)
   passa pelo highlight.js (vendor/, sem rede), que já devolve o texto escapado. Sem língua ou com
   língua que ele não conhece, fica o texto puro. O render redesenha a conversa toda hora: guarda. */
const SINTAXE_NOME = { bash: 'Bash', sh: 'Shell', shell: 'Shell', zsh: 'Shell', js: 'JavaScript', javascript: 'JavaScript',
  ts: 'TypeScript', typescript: 'TypeScript', py: 'Python', python: 'Python', php: 'PHP', sql: 'SQL', json: 'JSON',
  yaml: 'YAML', yml: 'YAML', html: 'HTML', xml: 'XML', css: 'CSS', scss: 'SCSS', go: 'Go', rust: 'Rust', java: 'Java',
  kotlin: 'Kotlin', csharp: 'C#', cs: 'C#', cpp: 'C++', c: 'C', ruby: 'Ruby', rb: 'Ruby', ini: 'INI', toml: 'TOML',
  markdown: 'Markdown', md: 'Markdown', dockerfile: 'Dockerfile', nginx: 'Nginx', graphql: 'GraphQL', lua: 'Lua', r: 'R', swift: 'Swift' };
const sintaxeCache = new Map();
function htmlSintaxe(lingua, cod) {
  const h = window.hljs;
  const l = lingua === 'toml' ? 'ini' : lingua === 'zsh' ? 'bash' : lingua;
  if (!h || !l || !h.getLanguage(l)) return null;
  const k = l + '\u0000' + cod;
  if (sintaxeCache.has(k)) return sintaxeCache.get(k);
  let v = null;
  try { v = h.highlight(cod, { language: l, ignoreIllegals: true }).value; } catch (_) { v = null; }
  if (sintaxeCache.size > 200) sintaxeCache.clear();
  sintaxeCache.set(k, v);
  return v;
}
function htmlDiff(cod) {
  return cod.split('\n').map(x => {
    const c = /^(\+\+\+ |--- |diff --git|index )/.test(x) ? 'd-meta' : x.startsWith('@@') ? 'd-hunk'
      : x.startsWith('+') ? 'd-add' : x.startsWith('-') ? 'd-del' : 'd-ctx';
    return `<span class="${c}">${esc(x)}\n</span>`;
  }).join('');
}
const ICONE_COPIAR = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">' +
  '<rect x="8" y="8" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/>' +
  '<path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" ' +
  'stroke="currentColor" stroke-width="2"/></svg>';

function textoEmParagrafos(txt, fmt) {
  return txt.split(/\n[ \t]*\n+/).filter(p => p.trim() !== '')
    .map(p => paragrafoComTabelas(p.trim(), fmt)).join('');
}

/* Tabela em Markdown (| a | b | com a linha |---|) vira tabela de verdade (18/10/2026): os
   agentes respondem dados assim e a linha crua cheia de barras era ilegível. O texto do
   parágrafo antes e depois da tabela continua como parágrafo. Cada célula passa pelo mesmo
   esc + linkify + formata do resto, então negrito e link funcionam dentro dela. */
const RX_LINHA_TAB = /^\s*\|.*\|\s*$/;
const RX_SEP_TAB = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
function celulasTab(linha) {
  return linha.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}
function htmlTabela(linhas, fmt) {
  const cab = celulasTab(linhas[0]);
  const alin = celulasTab(linhas[1]).map(c => /^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : '');
  const corpo = linhas.slice(2).map(celulasTab);
  const cel = c => formata(linkify(esc(c)), fmt);
  // coluna só de números (1.234, 7,5%, R$ 10) alinha à direita, como planilha
  const numerica = cab.map((_, i) => corpo.length > 0 && corpo.every(r => /^[\s*_]*[-+]?(R\$\s*)?[\d.,]+\s*%?[\s*_]*$/.test(r[i] || '')));
  const st = i => { const a = alin[i] || (numerica[i] ? 'right' : ''); return a ? ` style="text-align:${a}"` : ''; };
  return '<div class="tabela-md"><table><thead><tr>' + cab.map((c, i) => `<th${st(i)}>${cel(c)}</th>`).join('') +
         '</tr></thead><tbody>' + corpo.map(r => '<tr>' + cab.map((_, i) => `<td${st(i)}>${cel(r[i] || '')}</td>`).join('') + '</tr>').join('') +
         '</tbody></table></div>';
}
function paragrafoComTabelas(p, fmt) {
  const linhas = p.split('\n');
  let html = '', texto = [];
  const soltaTexto = () => { if (texto.length) html += `<div class="p">${formata(linkify(esc(texto.join('\n').trim())), fmt)}</div>`; texto = []; };
  for (let i = 0; i < linhas.length; i++) {
    if (RX_LINHA_TAB.test(linhas[i]) && i + 1 < linhas.length && RX_SEP_TAB.test(linhas[i + 1])) {
      let j = i + 2;
      while (j < linhas.length && RX_LINHA_TAB.test(linhas[j])) j++;
      soltaTexto();
      html += htmlTabela(linhas.slice(i, j), fmt);
      i = j - 1;
    } else {
      texto.push(linhas[i]);
    }
  }
  soltaTexto();
  return html;
}

/* ```bloco``` vira a "caixa de texto" com fundo mais escuro e o botão de
   copiar: o agente põe ali o texto pronto pra colar em outro
   lugar, e um toque copia só ele, sem a introdução. Separado ANTES dos
   parágrafos, porque bloco com linha em branco no meio se partia em dois. */
function paragrafos(txt, fmt) {
  const partes = String(txt).split('```');
  let html = '';
  for (let i = 0; i < partes.length; i++) {
    const fechado = i % 2 === 1 && i < partes.length - 1;
    if (!fechado) {
      // ``` sem par fica como texto, com as crases
      const t = i % 2 === 1 ? '```' + partes[i] : partes[i];
      html += textoEmParagrafos(t, fmt);
      continue;
    }
    // ```dgcofre: campo de senha (campo-cofre.js); nome inválido cai no bloco normal
    const cofre = window.campoCofre && window.campoCofre.blocoParaHtml(partes[i], txt);
    if (cofre) { html += cofre; continue; }
    // ```dgui: KPI, tabela e gráfico desenhados pela tela (dgui.js)
    const ui = window.dgui && window.dgui.blocoParaHtml(partes[i]);
    if (ui) { html += ui; continue; }
    const lingua = ((/^([A-Za-z0-9_+.-]{1,20})\n/.exec(partes[i]) || [])[1] || '').toLowerCase();
    let cod = partes[i].replace(/^[A-Za-z0-9_+.-]{1,20}\n/, '')
                         .replace(/^\n+/, '').replace(/\s+$/, '');
    // no MarkdownV2, dentro do bloco só a crase e a barra vêm escapadas
    if (fmt === 'markdownv2') cod = cod.replace(/\\([`\\])/g, '$1');
    if (!cod) continue;
    const diff = ehDiff(lingua, cod);
    const cor = diff ? null : htmlSintaxe(lingua, cod);
    const rotulo = !diff && lingua && lingua !== 'text' && lingua !== 'plaintext'
      ? `<div class="cod-lingua">${esc(SINTAXE_NOME[lingua] || lingua)}</div>` : '';
    html += `<div class="cod${diff ? ' cod-diff' : ''}${rotulo ? ' com-lingua' : ''}">${rotulo}<button type="button" class="codcopia" ` +
            `aria-label="Copiar o texto do bloco" title="Copiar o texto do bloco">` +
            `${ICONE_COPIAR}</button><pre${cor != null ? ' class="hljs"' : ''}>${diff ? htmlDiff(cod) : (cor != null ? cor : esc(cod))}</pre></div>`;
  }
  return html;
}

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
    return `<span class="midcx cxarq">${cartaoArquivo(md, md.id)}${botaoBaixaMidia(md, rot)}</span>`;
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
  const cita = m.cita ? `<div class="cita"><b>${ehDono({ origin: m.cita.origin }) ? 'Você' :
      esc(AGENTE.nome)}</b>${esc(m.cita.texto)}</div>` : '';
  let leg = legendaUtil(m);
  let doVisual = '';
  const dv = ehDono(m) ? separaDoVisual(leg) : null;
  if (dv) {
    leg = dv.texto;
    doVisual = `<div class="dovisual">📊 do visual${dv.titulo ? ': ' + esc(dv.titulo) : ''}</div>`;
  }
  // [ver a criação] só vira botão em mensagem de quem não é o dono (o texto já sai escapado de paragrafos)
  let htmlLeg = leg ? paragrafos(leg, m.fmt) : '';
  if (htmlLeg && !ehDono(m) && window.DGOnboarding && window.DGOnboarding.marcadorParaBotao) htmlLeg = window.DGOnboarding.marcadorParaBotao(htmlLeg);
  const corpo = leg ? doVisual + htmlLeg : doVisual;
  const reac = (m.reacoes && m.reacoes.length)
    ? `<span class="reac">${m.reacoes.map(esc).join(' ')}</span>` : '';
  // a hora das mensagens já entregues fica fora do balão (htmlHora); a do pendente segue dentro
  const meta = m.pendente ? metaPendente(m.local) : '';
  return htmlSelo(m) + cita + midia + corpo + reac + meta;
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
  ouvir:  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>'
};
function htmlAcoes(m, hora) {
  hora = hora || '';
  if (!m || m.pendente || !legendaUtil(m) || ehVisual(m.media)) return hora ? `<div class="acoes so-hora">${hora}</div>` : '';
  return `<div class="acoes" data-acoes="${esc(m.id)}">` +
         `<button type="button" class="ac" data-ac="copiar" title="Copiar" aria-label="Copiar a resposta">${ICONE_ACAO.copiar}</button>` +
         `<button type="button" class="ac ac-ouvir" data-ac="ouvir" title="Ouvir em voz alta" aria-label="Ouvir a resposta em voz alta">${ICONE_ACAO.ouvir}</button>` +
         hora + '</div>';
}
wrap.addEventListener('click', async ev => {
  const b = ev.target.closest ? ev.target.closest('.acoes .ac') : null;
  if (!b) return;
  const id = b.closest('.acoes').dataset.acoes;
  const m = msgs.find(x => x.id === id);
  const texto = m ? legendaUtil(m) : '';
  if (!texto) return;
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
    destravarAudio();
    falar(texto);
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
  const comHist = !EH_ADMIN && !!window.DGHistorico;
  const sub = arquivadasTela && comHist
    ? 'Conversa nova. As anteriores estão no <button type="button" class="vz-link" data-abre-historico>Histórico</button>.'
    : `Mande a primeira mensagem para o ${esc(AGENTE.nome)}. A resposta aparece aqui.`;
  const sug = EH_ADMIN ? '' : '<div class="vz-sug" role="list">' + (sugestoesAgente || SUGESTOES_VAZIO).map(t =>
    `<button type="button" role="listitem" class="vz-chip" data-vz-sugestao="${esc(t.texto)}">` +
    (ROTULO_SUGESTAO[t.tipo] ? `<span class="vz-tipo">${ROTULO_SUGESTAO[t.tipo]}</span>` : '') + `${esc(t.texto)}</button>`).join('') + '</div>';
  return `<div class="vazio"><div class="vz-av" style="background:${esc(AGENTE.cor || '#2f9e5e')}" aria-hidden="true">${foto}</div>` +
    `<b>Como posso ajudar?</b><small>${sub}</small>${sug}</div>`;
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
      : arquivadasTela && !EH_ADMIN && window.DGHistorico
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
  for (let bi = 0; bi < blocos.length; bi++) {
    const bloco = blocos[bi];
    const m = bloco.msg || bloco.trilha[0];
    if (m.dia !== dia) {
      dia = m.dia;
      itens.push(['dia:' + dia, `<div class="dia"><span>${esc(dia)}</span></div>`]);
      anterior = null;
    }
    if (bloco.trilha) {
      if (trabalhandoAgora && m.ep > ultDono) continue;
      itens.push(['trilha:' + m.id, htmlResumoPassos(bloco.trilha, todas)]);
      continue;
    }
    if (m.origin === 'comando') { itens.push([m.id, htmlResultadoComando(m)]); continue; }
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
    itens.push([m.id, `<div class="row ${lado}${ehVisual(m.media) ? ' vis' : ''}${troca}" data-msg="${esc(m.id)}">` +
                      `<div class="bub">${htmlCorpo(m)}</div>${lado === 'her' ? htmlAcoes(m, htmlHora(m)) : htmlHora(m)}</div>`]);
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
  if (igual) return;
  // Mensagens antigas entrando no topo, mensagem nova no fim, balão refeito: a posição
  // fica por conta do observador de rolagem (no fim acompanha, lendo mais acima não mexe).
  aplicaNos(nos);
  humanizaHoras();
  // os filtros nascem mais abaixo (alertas): antes disso, um render do cache não pode tocá-los
  if (filtrosProntos) { aplicaFiltro(); observaVistos(); observaLeitura(); }
  if (window.dgui && window.dgui.restauraEscolhas) window.dgui.restauraEscolhas(wrap);
  visuaisAposRender();
  respiroDasFaixas();
  guardaCache();
  atualizaSeta();
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
    `<span class="vist">📊 <span class="visn" data-visn="${esc(md.id)}">${esc(tit)}</span></span>` +
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
/* Balão desmontado ou tela cheia fechada: a barrinha some sem mandar nada. */
function fechaBarraDe(est) {
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
      if (est.cheia) { if (visTelaNome) visTelaNome.textContent = '📊 ' + tit; }
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
  visTelaNome.textContent = '📊 ' + tituloProvisorio(md.nome);
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
       (p.texto && normaliza(m.text) === normaliza(p.casa || p.texto))));
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
    render();
    if (primeiraVez) {
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
  await cacheMidias.limpar();
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
    if (!streamAberto) { streamAberto = true; jaConectou = true; mudouStream(); }
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

const ICONE_DOC = { document: '📄', photo: '🖼️', video: '🎬', audio: '🎤', voice: '🎤' };

function cartaoDoc(md) {
  const ico = ICONE_DOC[md.kind] || '📦';
  const tam = md.bytes ? tamanhoHumano(md.bytes) : '';
  return `<div class="vcard"><div class="ico" aria-hidden="true">${ico}</div>` +
    `<b>${esc(md.nome || 'arquivo')}</b>` +
    `<small>${esc(tam)}${tam ? ' · ' : ''}Esse tipo de arquivo não abre aqui dentro.</small>` +
    `<a href="${esc(md.url)}" target="_blank" rel="noopener">Abrir em outra aba</a>` +
    `<a class="sec" href="${esc(md.url)}" download="${esc(md.nome || '')}">Baixar</a></div>`;
}

function abreLightbox(mid, opt) {
  const md = midias[mid];
  if (!md) return;
  // visual (vis-*.html) abre desenhado, em tela cheia; `texto` pede o visor de arquivo
  if (ehVisual(md) && !(opt && opt.texto)) { abreTelaVisual(md); return; }
  const jaAberto = visorAberto();
  lbCorpo.innerHTML = '';
  lbMid = mid;
  lbNome.textContent = md.nome || 'arquivo';
  lbBaixar.href = md.url;
  lbBaixar.setAttribute('download', md.nome || '');
  const ehPdf = /\.pdf$/i.test(md.nome || '');
  if (md.kind === 'photo') {
    const img = document.createElement('img');
    img.alt = md.nome || 'foto';
    img.src = md.url;
    img.onerror = () => { lbCorpo.innerHTML = cartaoDoc(md); };
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
  const pre = bt.parentElement ? bt.parentElement.querySelector('pre') : null;
  if (!pre) return;
  copiaTexto(pre.textContent).then(ok => {
    if (!ok) return;
    bt.classList.add('ok');
    setTimeout(() => bt.classList.remove('ok'), 1600);
  });
}, true);

wrap.addEventListener('click', ev => {
  const alvo = ev.target.closest ? ev.target.closest('.mid[data-mid], .cartaoarq[data-mid]') : null;
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
  atualizaCartao(a);
  pintaInfoAnexos();
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
  vozNoCampo = false;
  enviarTexto(t, lista);
}

btnAnexo.onclick = () => {
  if (gravando) { cancelaGravacao(); return; }   // durante a gravação o 📎 vira ✕
  destravarAudio(); inputArquivo.click();
};
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
}
function ajustaCampo() {
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

const temArquivo = ev => ev.dataTransfer &&
  Array.from(ev.dataTransfer.types || []).includes('Files');
chat.addEventListener('dragover', ev => {
  if (!temArquivo(ev)) return;
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'copy';
});
chat.addEventListener('drop', ev => {
  if (!temArquivo(ev)) return;
  ev.preventDefault();
  const fs = Array.from((ev.dataTransfer.files) || []);
  if (fs.length) anexaArquivos(fs);
  else console.warn('drop na thread sem arquivo legível:', ev.dataTransfer.types);
});

/* ── Menu lateral (gaveta do ☰) ───────────────────────────────────────────── */
function abreMenu(abrir) {
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
window.DGMenuLado.inicia({ agente: AGENTE, agentes: agentesMenu, fecha: () => abreMenu(false) });
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
    : 'Anexar fotos, vídeos, áudios ou PDFs');
  btnAnexo.title = gravando ? 'Cancelar a gravação (nada é enviado)'
    : 'Anexar fotos, vídeos, áudios ou PDFs (vários de uma vez)';
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
}

btnMic.onclick = () => {
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
  await enviarTexto(texto);
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
    falhouTentativa(pend, tentativa, 'Não consegui entregar a mensagem: ', e.message);
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

/* Depois da pergunta por voz, por 5 minutos, toda resposta nova dele também é
   lida (ele costuma mandar "vou fazer" e, um tempo depois, o resultado). */
const ESCUTA_MS = 5 * 60000;
let escuta = null;            // { since, ate }
const faladas = new Set();
let filaFala = Promise.resolve();

function falaNovas() {
  if (!escuta || !lerRespostas || Date.now() > escuta.ate) return;
  // visual (vis-*.html) é desenho: não tem o que ler em voz alta
  const novas = msgs.filter(m => ehResposta(m, escuta.since) && !faladas.has(m.id) &&
                              !ehVisual(m.media));
  if (!novas.length) return;
  for (const m of novas) faladas.add(m.id);
  filaFala = filaFala.then(async () => {
    if (gravando) return;
    await falar(novas.map(m => legendaUtil(m) || m.text).join('\n\n'));
  });
}
ouvintesChegada.push(() => { if (!esperando) falaNovas(); });

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
    setEstado('sem resposta ainda');
    mostraAviso('A ' + AGENTE.nome + ' não respondeu em 3 minutos. A mensagem foi ' +
                'entregue: a resposta aparece aqui sozinha quando ela mandar.');
    if (lerRespostas) escuta = { since: since, ate: Date.now() + ESCUTA_MS };
  } else if (lerRespostas) {
    escuta = { since: since, ate: Date.now() + ESCUTA_MS };
    falaNovas();
    await filaFala;
  } else {
    estadoOcioso();
  }
}

btnParar.onclick = () => {
  pararPedido = true;
  if (falando) pararFala();
  btnParar.textContent = 'parando…';
};

/* ── Falar a resposta ─────────────────────────────────────────────────────── */
function pararFala() {
  try {
    player.pause();
  } catch (e) {
    console.warn('pararFala: player.pause() falhou:', e.message);
  }
  falando = false;
  btnParar.style.display = 'none';
  estadoOcioso();
}

async function falar(texto) {
  setEstado('preparando a voz…');
  let blob;
  try {
    const r = await fetch('/api/v1/tts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: AGENTE.id, text: texto }),
    });
    if (r.status === 401) {
      location.href = '/login?next=' + encodeURIComponent(AQUI);
      return;
    }
    if (!r.ok) {
      let motivo = 'a API respondeu ' + r.status;
      try { const d = await r.json(); if (d && d.erro) motivo = d.erro; }
      catch (e) { console.warn('tts: a resposta de erro não veio em JSON:', e.message); }
      // a resposta JÁ está na tela: isto é aviso, não é falha do ciclo
      mostraAviso(motivo);
      setEstado('resposta só em texto');
      return;
    }
    if (r.headers.get('X-TTS-Cortado') === '1') {
      mostraAviso('A resposta é longa: a voz leu os primeiros 1200 caracteres. ' +
                  'O texto completo está na tela.');
    }
    blob = await r.blob();
  } catch (e) {
    mostraAviso('A resposta está na tela, mas não consegui gerar a voz: ' + e.message);
    setEstado('resposta só em texto');
    return;
  }

  falando = true;
  btnParar.style.display = '';
  btnParar.textContent = 'parar de falar';
  setEstado('falando…');
  const url = URL.createObjectURL(blob);
  await new Promise(resolve => {
    let pronto = false;
    const fim = () => {
      if (pronto) return;
      pronto = true;
      URL.revokeObjectURL(url);
      resolve();
    };
    player.onended = fim;
    player.onerror = () => {
      mostraAviso('O iPhone não tocou o áudio da resposta. O texto está na tela.');
      fim();
    };
    player.src = url;
    const p = player.play();
    if (p && p.catch) {
      p.catch(e => {
        mostraAviso('O iPhone bloqueou o som (' + e.message + '). Toque no ' +
                    'microfone uma vez para liberar o áudio e tente de novo.');
        fim();
      });
    }
  });
  falando = false;
  btnParar.style.display = 'none';
  if (pararPedido) { estadoOcioso(); return; }
  estadoOcioso();
  if (continua) {
    mostraAviso('');
    await comecaGravar();
  }
}

/* ── Modo texto e toggles ─────────────────────────────────────────────────── */
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
  vozNoCampo = false;
  if (lcInterceptaLogin(t)) return;   // /login abre o cartão e não vai ao agente
  enviarTexto(t);
}
// pergunta sugerida embaixo de um painel (dgui.js): vai ao agente como se a pessoa tivesse digitado
document.addEventListener('dgui-pergunta', ev => {
  const t = ev.detail && String(ev.detail.texto || '').trim();
  if (!t) return;
  destravarAudio();
  enviarTexto(t);
});
btnEnviar.onclick = () => {
  destravarAudio();
  if (gravando) { paraEEnvia(true); return; }
  enviarDoCampo();
};
// Enter manda (é a tecla "enviar" do teclado do iPhone); Shift+Enter, no
// computador, quebra a linha. Durante a composição de acento não manda.
entrada.addEventListener('keydown', ev => {
  if (ev.key !== 'Enter' || ev.shiftKey || ev.isComposing) return;
  ev.preventDefault(); destravarAudio(); enviarDoCampo();
});

function pintaLer() {
  btnLer.classList.toggle('on', lerRespostas);
  btnLer.title = lerRespostas ? 'Ler respostas em voz alta: ligado'
                              : 'Ler respostas em voz alta: desligado';
  btnLer.setAttribute('aria-pressed', String(lerRespostas));
  btnLer.setAttribute('aria-label', 'Leitura em voz alta: ' + (lerRespostas ? 'ligada' : 'desligada'));
  btnLer.innerHTML = (lerRespostas ? '🔊' : '🔇') +
    ' <span class="lbl">' + (lerRespostas ? 'ler: sim' : 'ler: não') + '</span>';
}
btnLer.onclick = () => { destravarAudio(); lerRespostas = !lerRespostas; pintaLer(); };

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
    { alvo: '#btnAnexo', titulo: 'Anexos',
      oque: 'O clipe serve para mandar fotos, vídeos, áudios e PDFs para o agente.',
      como: 'Toque nele e escolha os arquivos (até 10 por mensagem), ou cole uma imagem direto no campo. Cada arquivo sobe em segundo plano e a mensagem sai quando todos estiverem prontos.',
      porque: 'Muita coisa é mais fácil de mostrar do que de explicar: um print de erro, um documento, uma foto.' },
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
  if (!EH_ADMIN) {
    passos.push({ alvo: '#mlPainel', antes: abreM, titulo: 'As páginas do painel de ' + nome,
      oque: 'Status, Memória, Operações, Custos e as outras páginas que mostram como ' + nome + ' está, o que ele guarda e quanto gasta.',
      como: 'Toque numa página e ela abre na mesma janela. Para voltar à conversa, use o item Conversa do menu do painel ou o voltar do navegador.',
      porque: 'A conversa serve para pedir coisas; as páginas do painel servem para acompanhar e ajustar o agente.' });
  }
  if (!$('mlConfig').hidden) {
    passos.push({ alvo: '#mlConfig', antes: abreM, titulo: 'Configurações',
      oque: 'Hoje tem um item: Instalar o app, que coloca o DG Claw como aplicativo na tela inicial do aparelho.',
      como: 'No Android e no computador, com Chrome ou Edge, o toque abre o pedido de instalação do navegador. No iPhone e no iPad, o item mostra o caminho: Compartilhar e depois Adicionar à Tela de Início. O item some sozinho quando o app já está instalado.',
      porque: 'O app instalado abre sem a barra do navegador e fica a um toque, como qualquer outro aplicativo.' });
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
    como: 'Toque em Conectar, abra a página de login, entre com a sua conta e, no Claude, cole aqui o código que ela mostrar no fim. A tela confere sozinha e avisa quando terminar. Para abrir o cartão a qualquer hora, escreva /login no campo de mensagem e envie: nada vai para o agente.',
    porque: 'Sem conta conectada o agente não consegue responder. Assim você resolve aqui mesmo, sem abrir terminal.' });
  if (!$('btnPainel').hidden) {
    passos.push({ alvo: '#btnPainel', titulo: 'O botão Painel',
      oque: 'Um atalho para o painel de ' + nome + ', com Status, Memória, Operações, Custos e as outras páginas.',
      como: 'Toque nele e o painel abre na mesma janela. Para voltar, use o item Conversa do menu do painel ou o voltar do navegador.',
      porque: 'Fica no topo para você passar da conversa ao painel com um toque, sem abrir o menu.' });
  }
  passos.push({ alvo: '#btnMesa', titulo: 'O botão Mesa',
    oque: 'Um atalho para a Mesa de tarefas, onde ficam as tarefas de todos os agentes.',
    como: 'Toque nele e a Mesa abre na mesma janela. Lá você acompanha o que está pendente e o que já foi feito.',
    porque: 'Você confere o andamento do trabalho sem sair procurando no menu.' });
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
const cacheMidias = DGMidias.criar({ conta: caps.conta, agente: AGENTE.id, base: API,
  mudou: aba => { if (aba === acAba) pintaAcervo(); } });
function pintaAcervo() {
  if (acPainel.hidden) return;
  const d = cacheMidias.estado(acAba);
  $('acervoEstado').textContent = d.erro ? 'Não consegui atualizar: ' + d.erro :
    (!d.carregou ? 'Carregando os itens recentes…' : d.itens.length + ' itens carregados' + (d.carregando ? ' · atualizando…' : '')) +
    (d.avisoCache ? ' · ' + d.avisoCache : '');
  let html = acAba === 'midias' ? '<div class="acgrade">' : '';
  for (const it of d.itens) {
    let corpo;
    if (acAba === 'links') corpo = `<a class="aclinha" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.dominio)}<small>${esc(it.url)}</small></a>`;
    else {
      const md = it.media; midias[md.id] = md;
      const img = md.disponivel && md.thumb ? `<img src="${esc(md.thumb)}" loading="lazy" decoding="async" width="320" height="320" alt="${esc(md.nome)}" onerror="this.hidden=true">` : '';
      corpo = `<button class="${acAba === 'midias' ? 'acfoto' : 'aclinha'}" data-midia="${esc(md.id)}">${esc(md.kind === 'video' ? '▶ ' : '📎 ')}${esc(md.nome)}${img}</button>`;
    }
    html += `<div class="acitem">${corpo}<button class="acir" data-origem="${esc(it.msg_id)}" title="Ir para a mensagem de origem">${esc(it.dia || '')} ${esc(it.hhmm || '')} ↪</button></div>`;
  }
  if (acAba === 'midias') html += '</div>';
  if (d.erro) html += '<button class="acmais" data-tentar>Atualizar novamente</button>';
  if (d.proximo) html += `<button class="acmais" data-mais ${d.carregando ? 'disabled' : ''}>${d.carregando ? 'Carregando…' : 'Carregar anteriores'}</button>`;
  else if (d.carregou && !d.itens.length) html += '<p>Nenhum item deste tipo na conversa disponível.</p>';
  acLista.innerHTML = html;
}
function abreAcervo(aba = acAba) {
  acAba = aba; acPainel.hidden = false;
  for (const b of acPainel.querySelectorAll('[data-aba]')) b.setAttribute('aria-selected', String(b.dataset.aba === aba));
  pintaAcervo(); cacheMidias.abrir(aba);
}
function fechaAcervo() { acPainel.hidden = true; cacheMidias.fechar(); }
$('who').addEventListener('click', () => abreAcervo());
$('who').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abreAcervo(); } });
$('av').addEventListener('click', () => abreAcervo());
$('acervoFechar').onclick = fechaAcervo;
document.addEventListener('keydown', e => { if (e.key === 'Escape') fechaAcervo(); });
acPainel.querySelector('nav').onclick = e => { const b = e.target.closest('[data-aba]'); if (b) { acLista.scrollTop = 0; abreAcervo(b.dataset.aba); } };
acLista.addEventListener('scroll', () => {
  if (acLista.scrollHeight - acLista.scrollTop - acLista.clientHeight < 250) cacheMidias.mais(acAba);
}, { passive: true });
acLista.onclick = async e => {
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
  e.preventDefault(); await cacheMidias.limpar(); location.href = a.href;
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
  return { nv: alertasLista.length, pedidos: alertasLista.filter(a => a.tipo === 'pedido').length,
           entregas: msgs.filter(m => m.alerta === 'entrega').length };
}
function desenhaAlertas() {
  alertasCaixa.hidden = true;   // a pilha lateral antiga não aparece mais
  const c = contagensFiltro();
  // o Histórico fica sempre à mão nos agentes (o Admin não guarda histórico pesquisável)
  const temHist = !EH_ADMIN && !!window.DGHistorico;
  filtrosEl.hidden = !(temHist || c.nv || c.entregas || filtro !== 'tudo');
  const chip = (k, rot, n, cls) => `<button type="button" class="filtro${filtro === k ? ' on' : ''}${cls ? ' ' + cls : ''}" data-filtro="${k}" aria-pressed="${filtro === k}">` +
    `${rot}${n ? ` <b>${n}</b>` : ''}</button>`;
  filtrosEl.innerHTML = chip('tudo', 'Tudo', 0) + chip('nao-vistas', 'Não vistas', c.nv) +
    chip('pedidos', 'Pedem ação', c.pedidos, c.pedidos ? 'tem-pedido' : '') + chip('entregas', 'Entregas', c.entregas) +
    (temHist ? `<button type="button" class="filtro filtro-hist" data-historico title="Buscar nas conversas antigas e ver as memórias">${window.DGHistorico.ICONE}Histórico</button>` : '');
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
  if (ev.target.closest('[data-abre-historico]')) window.DGHistorico.abre({ id: AGENTE.id, nome: AGENTE.nome || 'o agente' }, 'arquivadas');
});
filtrosEl.addEventListener('click', async ev => {
  if (ev.target.closest('[data-historico]')) { window.DGHistorico.abre({ id: AGENTE.id, nome: AGENTE.nome || 'o agente' }); return; }
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

}   // fim de iniciaTela

boot();
