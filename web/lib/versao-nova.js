'use strict';
// Versão nova do S2 Bot (23/10/2026, pedido do dono, no jeito do Dokploy): o Web pergunta às releases
// do fork (fabriziomachado/DG-Claw) se saiu versão mais nova que a instalada (o arquivo VERSAO-S2BOT; o
// VERSION é a versão do DG Claw de base, que o original controla) e a
// tela mostra o botão "Atualização disponível" no rodapé do menu. Instalar NÃO é daqui: o botão manda
// ao Admin um pedido de texto fixo (conversa.js), e o Admin segue o roteiro com backup e volta.
//
// A leitura é pública (sem token) e só da última release. O texto da release nasce no GitHub: sai
// pela API como dado, com tamanho conferido, e a tela escapa tudo. O aviso olha o fork, nunca o
// projeto original (DGCLAW_ATUALIZA_REPO no web.env troca o repositório, se um dia precisar).
//
//   GET  /api/v1/versao-nova            { ok, atual, nova|null, verificado_em, erro, auto, dispensada }
//   POST /api/v1/versao-nova/checar     confere agora
//   POST /api/v1/versao-nova/auto       { ligado } liga ou desliga a procura sozinha (a cada 6 h)
//   POST /api/v1/versao-nova/agora-nao  esconde o botão até sair uma versão ainda mais nova

const fs = require('node:fs');
const path = require('node:path');
const H = require('./http');

const BASE = '/api/v1/versao-nova';
const REPO_PADRAO = 'fabriziomachado/DG-Claw';
const RX_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const RX_TAG = /^v?\d{1,3}\.\d{1,3}\.\d{1,3}(-[0-9A-Za-z.-]{1,30})?$/;
const INTERVALO_MS = 6 * 3600 * 1000;
const PRAZO_MS = 10000;
const MAX_ITENS = 4;

/** "v1.3.0-s2bot" -> [1, 3, 0]; null se não for versão. */
function numeros(tag) {
  const m = /^v?(\d{1,3})\.(\d{1,3})\.(\d{1,3})/.exec(String(tag || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
/** a > b, só pelos três números (o sufixo -s2bot não conta). */
function maisNova(a, b) {
  const x = numeros(a), y = numeros(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
/** "v1.3.0-s2bot" -> "1.3" (o zero do fim some); "1.3.2" fica inteiro. */
function curta(tag) {
  const n = numeros(tag);
  if (!n) return '';
  return n[2] ? n.join('.') : `${n[0]}.${n[1]}`;
}
/** Item longo vira frase curta: corta no último espaço antes de `max` e põe reticências. */
function encurta(t, max) {
  const a = Array.from(t);
  if (a.length <= max) return t;
  const corte = a.slice(0, max).join('');
  const i = corte.lastIndexOf(' ');
  return (i > max * 0.6 ? corte.slice(0, i) : corte).replace(/[\s,.;:(]+$/, '') + '…';
}
const semMarkdown = (t) => String(t).replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();

/** Os itens da release para a janela: os primeiros tópicos "- ..." das notas, sem markdown, e quantos sobram. */
function itensDasNotas(corpo) {
  const linhas = String(corpo || '').split('\n').map((l) => l.trim()).filter((l) => /^[-*] \S/.test(l));
  const itens = linhas.map((l) => semMarkdown(l.slice(2))).filter(Boolean).map((l) => encurta(l, 110));
  return { itens: itens.slice(0, MAX_ITENS), mais: Math.max(0, itens.length - MAX_ITENS) };
}

function criarVersaoNova({ appDir, dataDir, log, repo, buscar, relogio }) {
  const agora = relogio || Date.now;
  const repositorio = repo && RX_REPO.test(repo) ? repo : REPO_PADRAO;
  const arqVersao = path.join(appDir, 'VERSAO-S2BOT');
  const arqEstado = path.join(dataDir, 'versao-nova.json');
  const baixar = buscar || ((url) => fetch(url, {
    signal: AbortSignal.timeout(PRAZO_MS), redirect: 'error',
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 's2bot-versao-nova' },
  }));
  let timer = null, primeira = null;

  function atual() {
    try { return fs.readFileSync(arqVersao, 'utf8').trim().split('\n')[0].slice(0, 40); } catch (_) { return ''; }
  }
  function lerEstado() {
    try { return JSON.parse(fs.readFileSync(arqEstado, 'utf8')) || {}; } catch (_) { return {}; }
  }
  function gravar(e) {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${arqEstado}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(e, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, arqEstado);
  }

  async function checar() {
    const e = lerEstado();
    e.verificado_em = new Date(agora()).toISOString();
    try {
      const r = await baixar(`https://api.github.com/repos/${repositorio}/releases/latest`);
      if (r.status === 404) { e.ultima = null; e.erro = null; gravar(e); return e; }   // repositório sem release ainda
      if (!r.ok) throw new Error(`o GitHub respondeu ${r.status}`);
      const d = await r.json();
      const tag = typeof d.tag_name === 'string' && RX_TAG.test(d.tag_name) ? d.tag_name : null;
      if (!tag) throw new Error('a última release não tem uma versão que eu reconheça (esperava algo como v1.4.0-s2bot)');
      const { itens, mais } = itensDasNotas(d.body);
      const url = typeof d.html_url === 'string' && d.html_url.startsWith(`https://github.com/${repositorio}/releases/`) ? d.html_url : null;
      e.ultima = { tag, nome: semMarkdown(d.name || '').slice(0, 80), itens, mais, url, publicada: typeof d.published_at === 'string' ? d.published_at.slice(0, 25) : null };
      e.erro = null;
    } catch (err) {
      e.erro = `Não consegui perguntar ao GitHub (${err.message}). Tento de novo mais tarde.`;
      log('aviso', `Versão nova: ${e.erro}`);
    }
    gravar(e);
    return e;
  }

  function paraApi() {
    const e = lerEstado(), v = atual();
    const u = e.ultima;
    const nova = u && maisNova(u.tag, v) ? Object.assign({ curta: curta(u.tag) }, u) : null;
    return {
      ok: true, repo: repositorio, atual: v, atual_curta: curta(v), nova,
      dispensada: !!(nova && e.dispensada === nova.tag),
      auto: e.auto !== false, verificado_em: e.verificado_em || null, erro: e.erro || null,
    };
  }

  async function rotas(req, res, url, sessao) {
    const p = url.pathname.replace(/\/+$/, '');
    if (p !== BASE && !p.startsWith(`${BASE}/`)) return false;
    // só o dono, pelo painel: a caixa dos agentes nem libera a rota, isto é a segunda trava
    if (!sessao || sessao.via === 'caixa') { H.erroJson(res, 403, 'A versão nova é só do dono, pelo painel.'); return true; }
    const m = req.method, sub = p.slice(BASE.length);
    try {
      if (sub === '' && m === 'GET') { H.enviaJson(res, 200, paraApi()); return true; }
      if (sub === '/checar' && m === 'POST') { await checar(); H.enviaJson(res, 200, paraApi()); return true; }
      if (sub === '/auto' && m === 'POST') {
        const c = await H.lerJson(req, 1024);
        if (typeof c.ligado !== 'boolean') { H.erroJson(res, 400, 'Mande { "ligado": true } ou { "ligado": false }.'); return true; }
        const e = lerEstado(); e.auto = c.ligado; gravar(e);
        H.enviaJson(res, 200, paraApi()); return true;
      }
      if (sub === '/agora-nao' && m === 'POST') {
        const api = paraApi();
        if (api.nova) { const e = lerEstado(); e.dispensada = api.nova.tag; gravar(e); }
        H.enviaJson(res, 200, paraApi()); return true;
      }
    } catch (err) {
      if (err.status) { H.erroJson(res, err.status, err.message); return true; }
      log('erro', `Versão nova: falha em ${m} ${p}: ${err.stack || err.message}`);
      H.erroJson(res, 500, 'Não consegui tratar o pedido da versão nova. O detalhe está no log do Web.');
      return true;
    }
    H.erroJson(res, 404, `Não existe ${m} ${p}.`);
    return true;
  }

  function iniciar() {
    if (timer) return;
    const rodada = () => { if (lerEstado().auto !== false) checar().catch((e) => log('erro', `Versão nova: ${e.message}`)); };
    primeira = setTimeout(rodada, 30000);
    primeira.unref();
    timer = setInterval(rodada, INTERVALO_MS);
    timer.unref();
  }
  function parar() {
    if (primeira) { clearTimeout(primeira); primeira = null; }
    if (timer) { clearInterval(timer); timer = null; }
  }

  return { rotas, checar, paraApi, iniciar, parar };
}

module.exports = { criarVersaoNova, maisNova, curta, itensDasNotas, REPO_PADRAO };
