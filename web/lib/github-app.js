'use strict';
// GitHub como app próprio de cada agente (28/10/2026), no jeito do Cursor e do Claude: o dono toca em
// Conectar, no Create do GitHub (só na primeira vez) e no Install. Conta, organização e repositórios
// são escolhidos e ajustados na tela do próprio GitHub.
//
//   GET /github/<slug>/conectar    sem app: página que entrega o manifesto ao GitHub (github.com/settings/apps/new)
//                                  com app: vai para github.com/apps/<app>/installations/new
//   GET /github/<slug>/criado      volta do manifesto (?code&state): troca o code pela chave do app
//   GET /github/<slug>/instalado   volta da instalação (?installation_id&setup_action&state)
//   GET  /api/v1/github            o estado de cada agente, sem segredo nenhum
//   POST /api/v1/github/<slug>/renovar   confere as instalações no GitHub e renova as senhas agora
//
// Onde fica cada coisa:
//   chave do app    <dataDir>/github/<slug>.pem (0600, root). NUNCA entra na caixa do agente.
//   estado          <dataDir>/github/<slug>.json (id do app, instalações aceitas, repositórios)
//   na caixa        ~/.dgclaw/github/tokens.json: só a senha de instalação (vale 1 h), renovada a cada
//                   20 min, e dois ajudantes: cabecalho.py (headersHelper do conector) e credencial.py
//                   (git). Se a caixa vazar, o estrago dura no máximo 1 hora e só nos repositórios escolhidos.
//
// O app é público (senão não dá para instalar numa organização a partir da conta do dono), então qualquer
// pessoa poderia instalá-lo. Por isso só vale instalação que voltou para cá pela sessão do dono, ou que um
// dono de organização aprovou depois de um pedido feito daqui: o resto é ignorado.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { gravaArquivoSeguro } = require('./grava-seguro');

const GH = 'https://github.com';
const API = 'https://api.github.com';
const MCP_URL = 'https://api.githubcopilot.com/mcp/';
const RENOVA_MS = 20 * 60 * 1000;
const ESTADO_MS = 30 * 60 * 1000;
const PEDIDO_MS = 30 * 24 * 3600 * 1000;
const RX_SLUG = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const RX_CONTA = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const PERMISSOES = { contents: 'write', pull_requests: 'write', issues: 'write', metadata: 'read' };

// Ajudantes gravados na casa do agente. Leem só o tokens.json, que o Web renova.
const CABECALHO_PY = `#!/usr/bin/env python3
# headersHelper do conector do GitHub (gravado pelo S2 Bot). Imprime o cabeçalho com a senha da conta pedida.
import json, os, sys
d = json.load(open(os.path.expanduser('~/.dgclaw/github/tokens.json')))
c = d['contas'].get((sys.argv[1] if len(sys.argv) > 1 else d.get('padrao') or '').lower())
print(json.dumps({'Authorization': 'Bearer ' + c['token']} if c else {}))
`;
const CREDENCIAL_PY = `#!/usr/bin/env python3
# Ajudante de credencial do git para github.com (gravado pelo S2 Bot): escolhe a senha pelo dono do repositório.
import json, os, sys
if len(sys.argv) < 2 or sys.argv[1] != 'get':
    sys.exit(0)
pedido = dict(l.split('=', 1) for l in sys.stdin.read().splitlines() if '=' in l)
if pedido.get('host') != 'github.com':
    sys.exit(0)
d = json.load(open(os.path.expanduser('~/.dgclaw/github/tokens.json')))
dono = pedido.get('path', '').split('/')[0].lower()
c = d['contas'].get(dono) or d['contas'].get(d.get('padrao') or '')
if c:
    print('username=x-access-token')
    print('password=' + c['token'])
`;

function roda(cmd, args, opcoes) {
  return new Promise((ok) => {
    execFile(cmd, args, { timeout: 60000, maxBuffer: 1024 * 1024, ...opcoes }, (err, stdout, stderr) => {
      ok({ ok: !err, saida: String(stdout || ''), erro: String(stderr || (err && err.message) || '') });
    });
  });
}

const b64url = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function jwtDoApp(appId, pem, agoraS) {
  const corpo = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iat: agoraS - 60, exp: agoraS + 540, iss: String(appId) }))}`;
  return `${corpo}.${b64url(crypto.sign('RSA-SHA256', Buffer.from(corpo), pem))}`;
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nomeDoApp = (a) => `S2-bot (${a.slug})`;

function criarGithubApp({ dataDir, registro, log, buscar, rodar, agora }) {
  const dir = path.join(dataDir, 'github');
  const fetchar = buscar || ((...a) => fetch(...a));
  const exec = rodar || roda;
  const relogio = agora || Date.now;
  const estados = new Map();   // state -> { slug, quando }
  let timer = null;

  function garantePasta() { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.chmodSync(dir, 0o700); }
  const arqEstado = (slug) => path.join(dir, `${slug}.json`);
  const arqChave = (slug) => path.join(dir, `${slug}.pem`);
  function ler(slug) { try { return JSON.parse(fs.readFileSync(arqEstado(slug), 'utf8')); } catch (_) { return null; } }
  function grava(slug, dados) {
    garantePasta();
    const tmp = `${arqEstado(slug)}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(dados, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, arqEstado(slug));
  }

  function agente(slug) {
    if (!RX_SLUG.test(String(slug || ''))) return null;
    const est = registro.estado();
    const a = est.ok ? est.agentes.find((x) => x.slug === slug) : null;
    return a && a.tipo !== 'admin' && a.home_host ? a : null;
  }

  function novoEstado(slug) {
    const s = crypto.randomBytes(16).toString('hex');
    const t = relogio();
    for (const [k, v] of estados) if (t - v.quando > ESTADO_MS) estados.delete(k);
    estados.set(s, { slug, quando: t });
    return s;
  }
  function confereEstado(s, slug) {
    const e = estados.get(String(s || ''));
    if (!e || e.slug !== slug || relogio() - e.quando > ESTADO_MS) return false;
    return true;
  }

  async function gh(metodo, rota, { jwt, token, corpo } = {}) {
    const cab = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'S2-Bot' };
    if (jwt) cab.Authorization = `Bearer ${jwt}`;
    if (token) cab.Authorization = `token ${token}`;
    if (corpo) cab['Content-Type'] = 'application/json';
    const r = await fetchar(API + rota, { method: metodo, headers: cab, body: corpo ? JSON.stringify(corpo) : undefined });
    const txt = await r.text();
    let dados = null; try { dados = txt ? JSON.parse(txt) : null; } catch (_) { dados = null; }
    if (!r.ok) { const e = new Error(`GitHub respondeu ${r.status} em ${rota}: ${(dados && dados.message) || txt.slice(0, 120)}`); e.status = r.status; throw e; }
    return dados;
  }
  function jwt(slug, st) { return jwtDoApp(st.app.id, fs.readFileSync(arqChave(slug), 'utf8'), Math.floor(relogio() / 1000)); }

  // ── na caixa do agente ─────────────────────────────────────────────────────
  function casaDe(a) {
    const st = fs.statSync(a.home_host);
    if (st.uid === 0) throw new Error(`a casa de ${a.slug} pertence ao root`);
    return { raiz: fs.realpathSync(a.home_host), uid: st.uid, gid: st.gid };
  }
  function gravaNaCasa(a, nome, conteudo, modo) {
    const c = casaDe(a);
    const pastaDg = path.join(c.raiz, '.dgclaw');
    gravaArquivoSeguro(path.join(pastaDg, 'github', nome), conteudo, {
      raiz: c.raiz, uid: c.uid, gid: c.gid, modo, pasta: { modo: 0o700, uid: c.uid, gid: c.gid },
    });
  }
  const naCaixa = (a, args) => exec('podman', ['exec', '-u', 'agente', '-w', a.home_container || '/home/agente', a.container || `dgclaw-${a.slug}`, ...args]);

  /** Conector e git do agente apontando para os ajudantes. Só roda quando aparece conta nova. */
  async function configuraCaixa(a, st, conta) {
    const casa = a.home_container || '/home/agente';
    const nome = `github-${conta.toLowerCase()}`;
    const cfg = { type: 'http', url: MCP_URL, headersHelper: `python3 ${casa}/.dgclaw/github/cabecalho.py ${conta.toLowerCase()}` };
    await naCaixa(a, ['claude', 'mcp', 'remove', '-s', 'user', nome]);
    const r = await naCaixa(a, ['claude', 'mcp', 'add-json', '-s', 'user', nome, JSON.stringify(cfg)]);
    if (!r.ok) throw new Error(`não consegui ligar o conector ${nome} (${r.erro.replace(/\s+/g, ' ').slice(0, 160)})`);
    await naCaixa(a, ['git', 'config', '--global', 'credential.https://github.com.helper', `!python3 ${casa}/.dgclaw/github/credencial.py`]);
    await naCaixa(a, ['git', 'config', '--global', 'credential.https://github.com.useHttpPath', 'true']);
    if (st.bot && st.bot.email) {
      await naCaixa(a, ['git', 'config', '--global', 'user.name', st.bot.nome]);
      await naCaixa(a, ['git', 'config', '--global', 'user.email', st.bot.email]);
    }
  }

  // ── renovação ──────────────────────────────────────────────────────────────
  /** Confere as instalações do app no GitHub, aceita as que vieram daqui e entrega senhas novas à caixa. */
  async function renovar(slug) {
    const a = agente(slug);
    const st = ler(slug);
    if (!a || !st || !st.app) return st;
    const j = jwt(slug, st);
    const lista = await gh('GET', '/app/installations?per_page=100', { jwt: j });
    const aceitas = new Set((st.aceitas || []).map(Number));
    const pedido = st.pedido_pendente && relogio() - Date.parse(st.pedido_pendente) < PEDIDO_MS ? st.pedido_pendente : null;
    const instalacoes = [];
    const contas = {};
    for (const i of lista || []) {
      const conta = i.account && i.account.login;
      if (!conta || !RX_CONTA.test(conta)) continue;
      // Pedido feito daqui e aprovado por um dono da organização: a instalação nova é aceita uma vez.
      if (!aceitas.has(i.id) && pedido && i.account.type === 'Organization' && Date.parse(i.created_at) >= Date.parse(pedido)) {
        aceitas.add(i.id); st.pedido_pendente = null; log('info', `GitHub de ${slug}: ${conta} aprovou o pedido de instalação.`);
      }
      if (!aceitas.has(i.id)) continue;
      const t = await gh('POST', `/app/installations/${i.id}/access_tokens`, { jwt: j });
      let repos = 'todos';
      if (i.repository_selection === 'selected') {
        const rs = await gh('GET', '/installation/repositories?per_page=100', { token: t.token });
        repos = (rs.repositories || []).map((r) => r.name).sort();
      }
      contas[conta.toLowerCase()] = { token: t.token, expira_em: t.expires_at };
      instalacoes.push({ id: i.id, conta, tipo: i.account.type === 'Organization' ? 'organizacao' : 'pessoal', repos, desde: i.created_at });
    }
    st.aceitas = [...aceitas].filter((id) => (lista || []).some((x) => x.id === id));   // desinstalada no GitHub sai daqui também
    const novas = instalacoes.filter((i) => !(st.configuradas || []).includes(i.conta.toLowerCase()));
    st.instalacoes = instalacoes;
    st.renovado_em = new Date(relogio()).toISOString();
    gravaNaCasa(a, 'tokens.json', JSON.stringify({
      aviso: 'Senhas de 1 hora do GitHub, renovadas pelo S2 Bot. Não copie para outro lugar.',
      padrao: instalacoes.length ? instalacoes[instalacoes.length - 1].conta.toLowerCase() : null,
      contas, renovado_em: st.renovado_em,
    }, null, 2), 0o600);
    gravaNaCasa(a, 'cabecalho.py', CABECALHO_PY, 0o500);
    gravaNaCasa(a, 'credencial.py', CREDENCIAL_PY, 0o500);
    for (const i of novas) {
      await configuraCaixa(a, st, i.conta);
      st.configuradas = [...(st.configuradas || []), i.conta.toLowerCase()];
      st.reiniciar = true;
      log('info', `GitHub de ${slug}: conector github-${i.conta.toLowerCase()} ligado.`);
    }
    grava(slug, st);
    return st;
  }

  async function renovarTodos() {
    let nomes = [];
    try { nomes = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)); } catch (_) { return; }
    for (const slug of nomes) {
      try { await renovar(slug); } catch (e) { log('aviso', `GitHub de ${slug}: não consegui renovar a senha (${e.message}).`); }
    }
  }
  function iniciar() {
    if (timer) return;
    renovarTodos();
    timer = setInterval(renovarTodos, RENOVA_MS);
    if (timer.unref) timer.unref();
  }
  function parar() { if (timer) { clearInterval(timer); timer = null; } }

  // ── páginas do fluxo ───────────────────────────────────────────────────────
  function pagina(res, status, titulo, corpoHtml, extraCab) {
    const nonce = crypto.randomBytes(12).toString('base64');
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; form-action ${GH}; base-uri 'none'; frame-ancestors 'none'`,
      ...(extraCab || {}),
    });
    res.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)}</title><style>body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f7f7f8;color:#202123;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
@media (prefers-color-scheme:dark){body{background:#212121;color:#ececec}a{color:#8ab4f8}}main{max-width:360px;text-align:center}button{font:inherit;font-weight:600;min-height:42px;padding:0 18px;border-radius:10px;border:0;background:#2563eb;color:#fff;cursor:pointer}</style></head>
<body><main>${corpoHtml.replace(/<script>/g, `<script nonce="${nonce}">`)}</main></body></html>`);
  }
  const vai = (res, onde) => { res.writeHead(302, { Location: onde, 'Cache-Control': 'no-store' }); res.end(); };
  const deVolta = (slug, extra) => `/integracoes?a=${encodeURIComponent(slug)}&github=${extra}`;

  async function tratarPagina(req, res, url, sessao, origem) {
    const mm = /^\/github\/([^/]+)\/(conectar|criado|instalado)$/.exec(url.pathname);
    if (!mm || req.method !== 'GET') return false;
    if (!sessao || sessao.via === 'caixa') { pagina(res, 403, 'Sem acesso', '<p>Só o dono conecta o GitHub, pelo navegador.</p>'); return true; }
    // Atrás do Caddy o Web vê http; o GitHub precisa do endereço público, que é sempre https.
    if (!/^http:\/\/(localhost|127\.)/.test(origem)) origem = origem.replace(/^http:/, 'https:');
    const slug = decodeURIComponent(mm[1]);
    const a = agente(slug);
    if (!a) { pagina(res, 404, 'Agente não encontrado', `<p>Não achei o agente "${esc(slug)}".</p><p><a href="/integracoes">Voltar</a></p>`); return true; }
    const st = ler(slug);
    const q = url.searchParams;

    if (mm[2] === 'conectar') {
      const state = novoEstado(slug);
      if (st && st.app) { vai(res, `${st.app.html_url}/installations/new?state=${state}`); return true; }
      const manifesto = {
        name: nomeDoApp(a), url: origem, public: true,
        redirect_url: `${origem}/github/${slug}/criado`,
        setup_url: `${origem}/github/${slug}/instalado`, setup_on_update: true,
        description: `Agente ${a.nome || slug} do S2 Bot de ${origem.replace(/^https?:\/\//, '')}.`,
        hook_attributes: { url: `${origem}/github/sem-webhook`, active: false },
        default_permissions: PERMISSOES, default_events: [],
      };
      pagina(res, 200, 'Conectar GitHub', `<p>Abrindo o GitHub…</p>
<form id="f" method="post" action="${GH}/settings/apps/new?state=${state}"><input type="hidden" name="manifest" value="${esc(JSON.stringify(manifesto))}"><noscript><button>Continuar no GitHub</button></noscript></form>
<script>document.getElementById('f').submit()</script>`);
      return true;
    }

    if (mm[2] === 'criado') {
      if (!confereEstado(q.get('state'), slug)) { pagina(res, 400, 'Link vencido', '<p>Esse link venceu ou não veio daqui. Toque em Conectar GitHub de novo.</p><p><a href="/integracoes">Voltar</a></p>'); return true; }
      const code = String(q.get('code') || '');
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(code)) { vai(res, deVolta(slug, 'erro')); return true; }
      try {
        const r = await gh('POST', `/app-manifests/${code}/conversions`);
        garantePasta();
        fs.writeFileSync(arqChave(slug), r.pem, { mode: 0o600 });
        let bot = null;
        try {
          const u = await gh('GET', `/users/${encodeURIComponent(r.slug + '[bot]')}`);
          bot = { nome: `${r.slug}[bot]`, email: `${u.id}+${r.slug}[bot]@users.noreply.github.com` };
        } catch (_) { bot = { nome: `${r.slug}[bot]`, email: '' }; }
        grava(slug, {
          app: { id: r.id, slug: r.slug, nome: r.name, html_url: r.html_url, dono: r.owner && r.owner.login, client_id: r.client_id },
          bot, aceitas: [], instalacoes: [], configuradas: [], criado_em: new Date(relogio()).toISOString(),
        });
        log('info', `GitHub de ${slug}: app ${r.slug} (id ${r.id}) criado na conta ${r.owner && r.owner.login}.`);
        vai(res, `${r.html_url}/installations/new?state=${novoEstado(slug)}`);
      } catch (e) {
        log('erro', `GitHub de ${slug}: não consegui criar o app (${e.message}).`);
        vai(res, deVolta(slug, 'erro'));
      }
      return true;
    }

    // instalado: volta do Install (ou do Configure, com setup_action=update)
    if (!st || !st.app) { vai(res, deVolta(slug, 'erro')); return true; }
    const acao = String(q.get('setup_action') || '');
    if (acao === 'request') {
      st.pedido_pendente = new Date(relogio()).toISOString();
      grava(slug, st);
      vai(res, deVolta(slug, 'pedido'));
      return true;
    }
    const id = Number(q.get('installation_id'));
    if (!Number.isInteger(id) || id <= 0) { vai(res, deVolta(slug, 'erro')); return true; }
    // Instalação nova só vale com o state daqui; o Configure do GitHub (update) chega sem ele e só refaz a lista.
    if (!(st.aceitas || []).includes(id)) {
      if (!confereEstado(q.get('state'), slug)) { pagina(res, 400, 'Link vencido', '<p>Essa instalação não começou pelo S2 Bot. Toque em Conectar GitHub na tela de Integrações.</p><p><a href="/integracoes">Voltar</a></p>'); return true; }
      try { await gh('GET', `/app/installations/${id}`, { jwt: jwt(slug, st) }); } catch (e) {
        log('aviso', `GitHub de ${slug}: instalação ${id} não é deste app (${e.message}).`);
        vai(res, deVolta(slug, 'erro')); return true;
      }
      st.aceitas = [...(st.aceitas || []), id];
      grava(slug, st);
    }
    try { await renovar(slug); vai(res, deVolta(slug, 'ok')); } catch (e) {
      log('erro', `GitHub de ${slug}: instalação ${id} aceita, mas a renovação falhou (${e.message}).`);
      vai(res, deVolta(slug, 'erro'));
    }
    return true;
  }

  // ── API para a tela ────────────────────────────────────────────────────────
  const json = (res, status, corpo) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(corpo)); };
  function resumo(slug) {
    const st = ler(slug);
    if (!st || !st.app) return null;
    return {
      app: { nome: st.app.nome, slug: st.app.slug, html_url: st.app.html_url, dono: st.app.dono },
      bot: st.bot ? st.bot.nome : `${st.app.slug}[bot]`,
      instalacoes: (st.instalacoes || []).map((i) => ({
        ...i, ajustar: i.tipo === 'organizacao' ? `${GH}/organizations/${i.conta}/settings/installations/${i.id}` : `${GH}/settings/installations/${i.id}`,
      })),
      pedido_pendente: !!st.pedido_pendente, reiniciar: !!st.reiniciar, renovado_em: st.renovado_em || null,
    };
  }

  async function tratarApi(req, res, url, sessao) {
    const p = url.pathname;
    if (p !== '/api/v1/github' && !p.startsWith('/api/v1/github/')) return false;
    if (!sessao || sessao.via === 'caixa') { json(res, 403, { ok: false, erro: 'O GitHub dos agentes é ligado pelo dono, no navegador.' }); return true; }
    if (p === '/api/v1/github' && req.method === 'GET') {
      const est = registro.estado();
      const agentes = {};
      for (const a of (est.ok ? est.agentes : [])) if (a.tipo !== 'admin') agentes[a.slug] = resumo(a.slug);
      json(res, 200, { ok: true, agentes });
      return true;
    }
    const mm = /^\/api\/v1\/github\/([^/]+)\/(renovar|reiniciado)$/.exec(p);
    if (!mm || req.method !== 'POST') { json(res, 404, { ok: false, erro: 'Rota do GitHub desconhecida.' }); return true; }
    const slug = decodeURIComponent(mm[1]);
    if (!agente(slug) || !ler(slug)) { json(res, 404, { ok: false, erro: `${slug} ainda não tem GitHub conectado.` }); return true; }
    if (mm[2] === 'reiniciado') { const st = ler(slug); st.reiniciar = false; grava(slug, st); json(res, 200, { ok: true }); return true; }
    try { await renovar(slug); json(res, 200, { ok: true, github: resumo(slug) }); } catch (e) {
      json(res, 502, { ok: false, erro: `Não consegui falar com o GitHub: ${e.message}` });
    }
    return true;
  }

  return { tratarPagina, tratarApi, renovar, renovarTodos, iniciar, parar, resumo, jwtDoApp };
}

module.exports = { criarGithubApp, jwtDoApp, CABECALHO_PY, CREDENCIAL_PY };
