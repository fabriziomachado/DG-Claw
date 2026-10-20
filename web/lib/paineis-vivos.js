'use strict';
// Painel que se atualiza sozinho (18/10/2026, pedido do dono, ideia 4 dos painéis interativos).
//
// O agente manda o painel com "vivo": {"id": "chamados", "a_cada_min": 15} e deixa na casa dele um
// script que IMPRIME o painel atualizado (o mesmo JSON do bloco dgui): ~/.dgclaw/paineis/<id>.sh
// (bash) ou <id>.py (python3). A tela pede:
//   GET  /api/v1/paineis/<slug>/<id>            a última versão salva ({painel, atualizado} ou {painel:null})
//   POST /api/v1/paineis/<slug>/<id>/atualizar  roda o script e salva a saída em <id>.json
// Tudo roda DENTRO da caixa do agente, como "agente" (podman exec), com o caminho passado como
// argumento (nunca montado num texto de shell): o Web não lê nem escreve na casa do agente pelo host,
// para um atalho plantado lá não apontar para um arquivo do servidor. Só o dono, no navegador.

const { execFile } = require('node:child_process');

const CASA = '/home/agente';
const PASTA = `${CASA}/.dgclaw/paineis`;
const RX_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TETO = 512 * 1024;
const INTERVALO_MIN_MS = 30 * 1000;   // dois "atualizar" seguidos do mesmo painel: o segundo espera
const TEMPO_SCRIPT_S = 180;

function rodaPadrao(cmd, args, opcoes) {
  return new Promise((ok) => {
    execFile(cmd, args, { timeout: (TEMPO_SCRIPT_S + 20) * 1000, maxBuffer: 2 * TETO, windowsHide: true, ...opcoes }, (err, stdout, stderr) => {
      ok({ ok: !err, codigo: err && err.code, saida: String(stdout || ''), erro: String(stderr || (err && err.message) || '') });
    });
  });
}

// Lê a versão salva: "mtime\n" e depois o conteúdo (até o teto).
const SH_LER = 'f="$1"; [ -f "$f" ] || exit 3; stat -c %Y "$f"; head -c ' + TETO + ' "$f"';
// Roda o script (.sh com bash, .py com python3) e só troca o .json se a saída for um JSON de verdade.
const SH_ATUALIZA = 'b="$1"; t="$2"; cd ' + CASA + ' || exit 9; ' +
  'if [ -f "$b.sh" ]; then c="bash"; s="$b.sh"; elif [ -f "$b.py" ]; then c="python3"; s="$b.py"; else exit 3; fi; ' +
  'timeout "$t" "$c" "$s" > "$b.json.tmp" 2> "$b.erro" || { r=$?; rm -f "$b.json.tmp"; exit $r; }; ' +
  'python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$b.json.tmp" 2>> "$b.erro" || { rm -f "$b.json.tmp"; exit 4; }; ' +
  'mv -f "$b.json.tmp" "$b.json"';

function criarPaineisVivos({ registro, log = () => {}, roda = rodaPadrao, agora = Date.now }) {
  const json = (res, status, corpo) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(corpo)); };
  const erro = (res, status, motivo) => json(res, status, { ok: false, erro: motivo });
  const ultimaRodada = new Map();   // "slug/id" -> ms
  const rodando = new Map();        // "slug/id" -> Promise

  function agenteDe(slug) {
    const est = registro.estado();
    if (!est.ok) return { erro: est.erro, status: 503 };
    const a = est.agentes.find((x) => x.slug === slug);
    if (!a || a.tipo === 'admin') return { erro: `Não existe agente "${String(slug).slice(0, 40)}".`, status: 404 };
    return { a };
  }
  const naCaixa = (a, args) => roda('podman', ['exec', '-u', 'agente', '-w', CASA, a.container || `dgclaw-${a.slug}`, ...args]);

  async function ler(a, id) {
    const r = await naCaixa(a, ['sh', '-c', SH_LER, 'ler', `${PASTA}/${id}.json`]);
    if (!r.ok) return { painel: null };
    const i = r.saida.indexOf('\n');
    const mt = Number(r.saida.slice(0, i));
    let painel = null;
    try { painel = JSON.parse(r.saida.slice(i + 1)); } catch (_) { painel = null; }
    return { painel, atualizado: Number.isFinite(mt) ? Math.round(mt * 1000) : null };
  }

  async function atualizar(a, id) {
    const k = `${a.slug}/${id}`;
    if (rodando.has(k)) return rodando.get(k);
    const ult = ultimaRodada.get(k) || 0;
    if (agora() - ult < INTERVALO_MIN_MS) return { ok: true, recente: true };
    ultimaRodada.set(k, agora());
    const p = (async () => {
      const r = await naCaixa(a, ['sh', '-c', SH_ATUALIZA, 'atualiza', `${PASTA}/${id}`, String(TEMPO_SCRIPT_S)]);
      if (r.ok) return { ok: true };
      const motivo = r.codigo === 3 ? `o agente ainda não deixou o script deste painel (~/.dgclaw/paineis/${id}.sh)`
        : r.codigo === 4 ? 'o script do painel não devolveu um JSON válido'
        : r.codigo === 124 ? `o script passou de ${TEMPO_SCRIPT_S} s`
        : 'o script do painel falhou';
      log('aviso', `Painel vivo ${k}: ${motivo} (código ${r.codigo}).`);
      return { ok: false, erro: motivo };
    })().finally(() => rodando.delete(k));
    rodando.set(k, p);
    return p;
  }

  async function tratar(req, res, url, sessao) {
    const p = url.pathname, m = req.method;
    if (!p.startsWith('/api/v1/paineis/')) return false;
    if (!sessao || sessao.via === 'caixa') { erro(res, 403, 'Os painéis vivos só são abertos pelo dono, no navegador.'); return true; }
    const mm = /^\/api\/v1\/paineis\/([^/]+)\/([^/]+)(\/atualizar)?$/.exec(p);
    if (!mm || !RX_ID.test(mm[2])) { erro(res, 404, 'Painel desconhecido.'); return true; }
    const { a, erro: e, status } = agenteDe(decodeURIComponent(mm[1]));
    if (!a) { erro(res, status, e); return true; }
    const id = mm[2];
    try {
      if (!mm[3] && m === 'GET') { json(res, 200, { ok: true, ...(await ler(a, id)) }); return true; }
      if (mm[3] && m === 'POST') {
        req.resume();
        const r = await atualizar(a, id);
        if (!r.ok) { erro(res, 409, r.erro); return true; }
        json(res, 200, { ok: true, ...(await ler(a, id)) });
        return true;
      }
      erro(res, 405, 'Use GET para ler ou POST em /atualizar.');
    } catch (err) {
      log('erro', `Painel vivo ${a.slug}/${id}: ${err.message}`);
      erro(res, 500, 'Não consegui ler o painel agora.');
    }
    return true;
  }

  return { tratar };
}

module.exports = { criarPaineisVivos, RX_ID, SH_LER, SH_ATUALIZA };
