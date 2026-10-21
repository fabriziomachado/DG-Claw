'use strict';
// Memória semântica na Saúde do servidor (20/10/2026, pedido do dono).
//
// Para cada agente de trabalho: se a memória semântica está ligada, quantos trechos e arquivos estão no
// índice e quando ele foi atualizado (chunks.db, tabela meta), e o uso das últimas 48 h em 32 barras, lido
// do registro que o lembrete automático grava a cada mensagem do dono (hooks/memory-recall.sh,
// <casa>/.dgclaw/logs/memoria-uso.jsonl: {ts, achou, fonte, ms}).
//
// A chave do lembrete automático é um arquivo na pasta de configuração do agente (só leitura dentro da
// caixa): <casa do agente>/../config/memoria-lembrete-desligado. Sem o arquivo, ligado.
//
// GET  /api/v1/memoria                       tudo o que a seção mostra (só o dono)
// POST /api/v1/memoria/config                { lembrete: true|false } (só o dono)
// POST /api/v1/memoria/<slug>/atualizar      refaz o índice agora (o serviço da madrugada, fora de hora)
// POST /api/v1/memoria/<slug>/perguntar      { texto } -> os trechos mais parecidos (teste da memória)

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const H = require('./http');

const JANELA_MS = 48 * 3600 * 1000;
const BARRAS = 32;
const ARQ_DESLIGADO = 'memoria-lembrete-desligado';

/** 32 barras das últimas 48 h: { perguntas, achou } por fatia de 1,5 h, da mais antiga para a mais nova. */
function barrasDeUso(linhas, agoraMs) {
  const fatia = JANELA_MS / BARRAS;
  const ini = agoraMs - JANELA_MS;
  const out = Array.from({ length: BARRAS }, () => ({ perguntas: 0, achou: 0 }));
  for (const l of linhas) {
    const t = Date.parse(l && l.ts);
    if (!(t >= ini && t <= agoraMs)) continue;
    const i = Math.min(BARRAS - 1, Math.floor((t - ini) / fatia));
    out[i].perguntas++;
    if (l.achou) out[i].achou++;
  }
  return out;
}

function lerUso(casa) {
  let txt = '';
  try { txt = fs.readFileSync(path.join(casa, '.dgclaw', 'logs', 'memoria-uso.jsonl'), 'utf8'); } catch (_) { return []; }
  const out = [];
  for (const l of txt.split('\n').slice(-5000)) {
    if (!l.trim()) continue;
    try { out.push(JSON.parse(l)); } catch (_) { /* linha cortada */ }
  }
  return out;
}

/** O índice: trechos, arquivos, quando atualizou e com qual provedor. Sem python: lê o sqlite pelo node? Não há
 *  sqlite no node desta versão, então pergunta ao python3 do servidor, só leitura. */
function lerIndice(casa) {
  const db = path.join(casa, '.dgclaw', 'memory_index', 'chunks.db');
  if (!fs.existsSync(db)) return Promise.resolve(null);
  const py = 'import sqlite3,sys,json\nc=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True)\n' +
    'm=dict(c.execute("select key,value from meta").fetchall())\n' +
    'n,a=c.execute("select count(*),count(distinct source_path) from chunks").fetchone()\n' +
    'print(json.dumps({"trechos":n,"arquivos":a,"atualizada_em":m.get("last_indexed_at"),"provedor":m.get("provider")}))';
  return new Promise((ok) => execFile('python3', ['-I', '-c', py, db], { timeout: 10000 }, (err, so) => {
    if (err) return ok({ erro: 'não consegui ler o índice' });
    try { ok(JSON.parse(so)); } catch (_) { ok({ erro: 'o índice respondeu algo estranho' }); }
  }));
}

function criarMemoriaSemantica({ registro, log = () => {}, agora = () => Date.now(), exec = execFile }) {
  const container = (a) => a.container || `dgclaw-${a.slug}`;
  const trabalho = () => { const e = registro.estado(); return (e && e.ok ? e.agentes : []).filter((a) => a.tipo !== 'admin' && a.home_host); };
  const pastaConfig = (a) => path.join(path.dirname(a.home_host), 'config');
  const lembreteLigado = () => trabalho().every((a) => !fs.existsSync(path.join(pastaConfig(a), ARQ_DESLIGADO)));
  const modeloLocal = (a) => fs.existsSync(path.join(a.home_host, '.local', 'share', 'dgclaw', 'embed'));

  async function visao() {
    const t = agora();
    const agentes = [];
    for (const a of trabalho()) {
      const idx = await lerIndice(a.home_host);
      const uso = lerUso(a.home_host);
      const barras = barrasDeUso(uso, t);
      const naJanela = barras.reduce((s, b) => ({ perguntas: s.perguntas + b.perguntas, achou: s.achou + b.achou }), { perguntas: 0, achou: 0 });
      agentes.push({ slug: a.slug, nome: a.nome, ligada: !!(idx && !idx.erro && idx.provedor && idx.provedor !== 'off') && modeloLocal(a),
        indice: idx, barras, total: naJanela });
    }
    return { ok: true, lembrete: lembreteLigado(), agentes, janela_h: 48 };
  }

  function atualizar(a) {
    return new Promise((ok) => exec('podman', ['exec', container(a), 'systemctl', 'start', '--no-block', `dgclaw-${a.slug}-memory-reindex.service`],
      { timeout: 20000 }, (err, _o, e) => ok(err ? { ok: false, erro: String(e || err.message).trim().slice(0, 200) } : { ok: true })));
  }

  // os 3 trechos mais parecidos, pela mesma busca que o agente usa (termo exato primeiro, vetor depois)
  const PY_PERGUNTA = 'import sys,json\nsys.path.insert(0,"/opt/dgclaw/app/scripts/memory_index")\nimport memory_search as m\n' +
    'q=sys.stdin.read().strip()\nr=m.search_chunks(q, top_k=3)\n' +
    'print(json.dumps([{"fonte":x.get("source"),"tipo":x.get("source_type"),"data":x.get("date"),"score":x.get("score"),"texto":(x.get("preview") or x.get("content") or "")[:300]} for x in r], ensure_ascii=False))';
  function perguntar(a, texto) {
    return new Promise((ok) => {
      const p = exec('podman', ['exec', '-i', '-u', 'agente', '-w', '/home/agente', '-e', 'DGCLAW_WORKSPACE=/home/agente', container(a), 'python3', '-c', PY_PERGUNTA],
        { timeout: 45000, maxBuffer: 1 << 20 }, (err, so, e) => {
          if (err) return ok({ ok: false, erro: `a busca não respondeu (${String(e || err.message).trim().split('\n').pop().slice(0, 160)})` });
          try { ok({ ok: true, trechos: JSON.parse(String(so).trim().split('\n').pop()) }); } catch (_) { ok({ ok: false, erro: 'a busca respondeu algo estranho' }); }
        });
      p.stdin.end(texto);
    });
  }

  function lembrete(ligado) {
    for (const a of trabalho()) {
      const f = path.join(pastaConfig(a), ARQ_DESLIGADO);
      if (ligado) { try { fs.unlinkSync(f); } catch (_) { /* já não existia */ } }
      else fs.writeFileSync(f, 'desligado pelo dono na Saúde do servidor\n', { mode: 0o644 });
    }
    log('info', `Memória semântica: lembrete automático ${ligado ? 'ligado' : 'desligado'} nos agentes.`);
  }

  async function rotas(req, res, url, sessao) {
    const p = url.pathname;
    if (!p.startsWith('/api/v1/memoria')) return false;
    if (!sessao || sessao.via === 'caixa') { H.erroJson(res, 403, 'A memória dos agentes é só do dono, pelo login do painel.'); return true; }
    if (p === '/api/v1/memoria' && req.method === 'GET') { H.enviaJson(res, 200, await visao()); return true; }
    if (p === '/api/v1/memoria/config' && req.method === 'POST') {
      let b; try { b = await H.lerJson(req, 1024); } catch (e) { H.erroJson(res, 400, e.message); return true; }
      if (typeof b.lembrete !== 'boolean') { H.erroJson(res, 400, 'Mande { "lembrete": true } ou false.'); return true; }
      try { lembrete(b.lembrete); } catch (e) { H.erroJson(res, 500, `Não consegui mudar o lembrete: ${e.message}`); return true; }
      H.enviaJson(res, 200, { ok: true, lembrete: lembreteLigado() });
      return true;
    }
    const m = /^\/api\/v1\/memoria\/([a-z0-9-]+)\/(atualizar|perguntar)$/.exec(p);
    if (m && req.method === 'POST') {
      const a = trabalho().find((x) => x.slug === m[1]);
      if (!a) { H.erroJson(res, 404, `Não conheço o agente "${m[1]}".`); return true; }
      if (m[2] === 'atualizar') {
        const r = await atualizar(a);
        if (r.ok) log('info', `Memória semântica: ${a.slug} atualizando o índice agora, a pedido do dono.`);
        H.enviaJson(res, r.ok ? 202 : 502, r.ok ? { ok: true } : { ok: false, erro: `Não consegui atualizar a memória de ${a.nome}: ${r.erro}` });
        return true;
      }
      let b; try { b = await H.lerJson(req, 4096); } catch (e) { H.erroJson(res, 400, e.message); return true; }
      const texto = String(b.texto || '').trim();
      if (!texto) { H.erroJson(res, 400, 'Escreva uma frase para procurar.'); return true; }
      H.enviaJson(res, 200, await perguntar(a, texto.slice(0, 500)));
      return true;
    }
    H.erroJson(res, 404, `Não existe ${req.method} ${p}.`);
    return true;
  }

  return { rotas, visao };
}

module.exports = { criarMemoriaSemantica, barrasDeUso };
