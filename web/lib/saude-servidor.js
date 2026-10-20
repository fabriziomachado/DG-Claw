'use strict';
// Saúde do servidor (20/10/2026, pedido do dono): a página do Admin com o que o `dgclaw status` confere,
// os números da máquina, o estado de cada agente e o consumo de tokens por agente.
//
// GET /api/v1/saude-servidor[?forca=1] -> { ok, conferido_em, conferencias, maquina, agentes, consumo }
// Só o dono, pelo login (um agente pela caixa recebe 403). Cada parte tem o seu cache, porque umas são
// caras (status roda podman e curl; o consumo lê os transcripts; o tamanho da casa roda du).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const H = require('./http');

const DGCLAW = '/usr/local/bin/dgclaw';
const CACHE_STATUS_MS = 60 * 1000;
const CACHE_CONSUMO_MS = 5 * 60 * 1000;
const CACHE_CASA_MS = 30 * 60 * 1000;

function roda(cmd, args, timeoutMs) {
  return new Promise((ok) => {
    execFile(cmd, args, { timeout: timeoutMs || 60000, maxBuffer: 1024 * 1024, windowsHide: true, env: { ...process.env, LANG: 'C.UTF-8' } },
      (err, stdout, stderr) => ok({ ok: !err, saida: String(stdout || ''), erro: String(stderr || (err && err.message) || '') }));
  });
}

/** As linhas do `dgclaw status`: "  ok     texto", "  aviso  texto", "  FALHOU texto". */
function lerStatus(saida) {
  const out = [];
  for (const l of String(saida || '').split('\n')) {
    const m = /^\s{2}(ok|aviso|FALHOU)\s+(.+)$/.exec(l);
    if (m) out.push({ estado: m[1] === 'ok' ? 'ok' : m[1] === 'aviso' ? 'aviso' : 'falha', texto: m[2].trim() });
  }
  return out;
}

/** Disco, memória (disponível de verdade, do /proc/meminfo) e processador (carga de 1 min sobre os núcleos). */
function maquina() {
  let disco = null;
  try {
    const st = fs.statfsSync('/');
    const total = st.blocks * st.bsize, livre = st.bavail * st.bsize;
    disco = { total, usado: total - livre, pct: Math.round(((total - livre) / total) * 100) };
  } catch (_) { /* sem statfs: a tela mostra traço */ }
  let disp = os.freemem();
  try { const m = /MemAvailable:\s+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8')); if (m) disp = +m[1] * 1024; } catch (_) { /* fica o freemem */ }
  const total = os.totalmem();
  const nucleos = os.cpus().length || 1;
  return {
    disco,
    memoria: { total, usado: total - disp, pct: Math.round(((total - disp) / total) * 100) },
    processador: { nucleos, pct: Math.min(100, Math.round((os.loadavg()[0] / nucleos) * 100)) },
    ligado_ha_s: Math.round(os.uptime()),
  };
}

/** Tokens de um agente desde `desde` (ms), lendo os transcripts dele (uma vez por message.id). */
function tokensDe(home, desdeMs) {
  const r = { entrada: 0, cache: 0, saida: 0 };
  let pastas = [];
  try { pastas = fs.readdirSync(path.join(home, '.claude', 'projects')).map((p) => path.join(home, '.claude', 'projects', p)); } catch (_) { return r; }
  const vistos = new Set();
  for (const d of pastas) {
    let arqs = [];
    try { arqs = fs.readdirSync(d).filter((n) => n.endsWith('.jsonl')).map((n) => path.join(d, n)); } catch (_) { continue; }
    for (const f of arqs) {
      try { if (fs.statSync(f).mtimeMs < desdeMs) continue; } catch (_) { continue; }
      let txt = '';
      try { txt = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
      for (const l of txt.split('\n')) {
        if (!l.includes('"usage"')) continue;
        let o; try { o = JSON.parse(l); } catch (_) { continue; }
        const m = o.message || {}, u = m.usage;
        if (o.type !== 'assistant' || !u || (m.id && vistos.has(m.id))) continue;
        if (m.id) vistos.add(m.id);
        if (!(Date.parse(o.timestamp) >= desdeMs)) continue;
        const n = (v) => (Number.isFinite(v) ? v : 0);
        r.entrada += n(u.input_tokens) + n(u.cache_read_input_tokens) + n(u.cache_creation_input_tokens);
        r.cache += n(u.cache_read_input_tokens);
        r.saida += n(u.output_tokens);
      }
    }
  }
  return r;
}

function criarSaudeServidor({ registro, conversa, log, agora = Date.now }) {
  const cache = { status: null, consumo: null, casas: new Map() };

  async function conferencias(forca) {
    if (!forca && cache.status && agora() - cache.status.em < CACHE_STATUS_MS) return cache.status;
    const r = await roda(DGCLAW, ['status'], 90000);
    const linhas = lerStatus(r.saida);
    if (!linhas.length) log('aviso', `Saúde do servidor: o dgclaw status não devolveu linhas (${r.erro.slice(0, 200)})`);
    cache.status = { em: agora(), linhas, erro: linhas.length ? null : 'não consegui rodar o dgclaw status' };
    return cache.status;
  }

  async function tamanhoCasa(a) {
    const c = cache.casas.get(a.slug);
    if (c && agora() - c.em < CACHE_CASA_MS) return c.bytes;
    if (!a.home_host) return null;
    const r = await roda('du', ['-sb', a.home_host], 60000);
    const bytes = r.ok ? Number((r.saida.split('\t')[0] || '').trim()) || null : null;
    cache.casas.set(a.slug, { em: agora(), bytes });
    return bytes;
  }

  async function agentes() {
    const est = registro.estado();
    const lista = (est && est.ok ? est.agentes : []).filter((a) => a.tipo !== 'admin');
    return Promise.all(lista.map(async (a) => {
      // conversa.atividade(agente): sem_sinal (runner fora), trabalhando ou parado
      let at = null;
      try { at = conversa && conversa.atividade ? await conversa.atividade(a) : null; } catch (_) { at = null; }
      let ultima = null;
      try {
        const t = conversa && conversa.thread ? await conversa.thread(a) : null;
        const fala = t && t.msgs ? [...t.msgs].reverse().find((m) => m.quem === 'agente') : null;
        ultima = fala ? fala.ep : null;
      } catch (_) { ultima = null; }
      const runnerOk = !(at && at.estado === 'sem_sinal');
      const trabalhando = !!(at && at.estado === 'trabalhando');
      return {
        slug: a.slug, nome: a.nome,
        estado: runnerOk === false ? 'fora' : trabalhando ? 'trabalhando' : 'de_pe',
        ultima_resposta_ep: ultima,
        casa_bytes: await tamanhoCasa(a),
      };
    }));
  }

  function consumo(forca) {
    if (!forca && cache.consumo && agora() - cache.consumo.em < CACHE_CONSUMO_MS) return cache.consumo.dados;
    const est = registro.estado();
    const lista = (est && est.ok ? est.agentes : []).filter((a) => a.tipo !== 'admin' && a.home_host);
    const t = agora();
    const dados = lista.map((a) => ({ slug: a.slug, nome: a.nome, dia: tokensDe(a.home_host, t - 86400000), semana: tokensDe(a.home_host, t - 7 * 86400000) }));
    cache.consumo = { em: t, dados };
    return dados;
  }

  async function rotas(req, res, url, sessao) {
    if (url.pathname !== '/api/v1/saude-servidor') return false;
    if (!sessao || sessao.via === 'caixa') { H.erroJson(res, 403, 'A saúde do servidor é só do dono, pelo login do painel.'); return true; }
    if (req.method !== 'GET') { H.erroJson(res, 405, 'Use GET.'); return true; }
    try {
      const forca = url.searchParams.get('forca') === '1';
      const [st, ags] = await Promise.all([conferencias(forca), agentes()]);
      H.enviaJson(res, 200, { ok: true, conferido_em: new Date(st.em).toISOString(), conferencias: st.linhas, erro_status: st.erro,
        maquina: maquina(), agentes: ags, consumo: consumo(forca) });
    } catch (e) {
      log('erro', `Saúde do servidor: ${e.message}`);
      H.erroJson(res, 503, `Não consegui montar a saúde do servidor: ${e.message}.`);
    }
    return true;
  }

  return { rotas, conferencias, agentes, consumo };
}

module.exports = { criarSaudeServidor, lerStatus, tokensDe, maquina };
