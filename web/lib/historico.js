'use strict';
// Histórico: busca nas conversas antigas e leitura das memórias de um agente (18/10/2026).
//
//   GET /api/v1/historico/<slug>                  estado do índice (quantos trechos, de quando a quando)
//   GET /api/v1/historico/<slug>/busca?q=&so=&desde=  trechos de conversa e de memória com a palavra
//   GET /api/v1/historico/<slug>/memorias         lista dos arquivos de memória, por grupo
//   GET /api/v1/historico/<slug>/memoria?arquivo=  texto de um arquivo da lista acima
//
// Tudo roda dentro da caixa do agente, como o próprio agente (podman exec -u agente): o índice e as
// memórias são dele, e o Web (root) não abre banco nem arquivo escrito por quem lê o mundo. A busca é
// o scripts/memory_index/conversas_fts.py, o mesmo que o agente usa; antes da primeira busca de cada
// minuto um reindex incremental traz o que entrou desde a última rotina. Só leitura.
//
// Só o dono, pela sessão do navegador: nenhuma caixa.permitir, e a sessão "via caixa" é recusada.

const { execFile } = require('node:child_process');

const FTS = '/opt/dgclaw/app/scripts/memory_index/conversas_fts.py';
const CASA = '/home/agente';
const REINDEX_MS = 60 * 1000;
const TETO_ARQUIVO = 512 * 1024;
const RX_ARQUIVO = /^(MEMORY\.md|working-memory\.md|memory\/[A-Za-z0-9 _.\/-]{1,200}\.(md|json))$/;
const RX_DIA = /^\d{4}-\d{2}-\d{2}$/;

function rodaPadrao(cmd, args, opcoes) {
  return new Promise((ok) => {
    execFile(cmd, args, { timeout: 60000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, ...opcoes }, (err, stdout, stderr) => {
      ok({ ok: !err, codigo: err && err.code, saida: String(stdout || ''), erro: String(stderr || (err && err.message) || '') });
    });
  });
}

/** Grupo de cada arquivo de memória, na ordem em que a tela mostra. */
const GRUPOS = ['Em andamento', 'Regras e fatos', 'Skills aprendidas', 'Diário', 'Outras anotações'];
function grupoDe(arquivo) {
  if (arquivo === 'working-memory.md') return 'Em andamento';
  if (arquivo === 'MEMORY.md') return 'Regras e fatos';
  const nome = arquivo.split('/').pop();
  if (/^skills?[-_]/i.test(nome)) return 'Skills aprendidas';
  if (/^\d{4}-\d{2}-\d{2}/.test(nome)) return 'Diário';
  return 'Outras anotações';
}

/** Saída do find (caminho \t tamanho \t mtime) -> [{arquivo, grupo, tamanho, mudou}]. */
function listaMemorias(saida) {
  const lista = [];
  for (const linha of String(saida).split('\n')) {
    const [abs, tam, mt] = linha.split('\t');
    if (!abs || !abs.startsWith(CASA + '/')) continue;
    const arquivo = abs.slice(CASA.length + 1);
    if (!RX_ARQUIVO.test(arquivo) || arquivo.includes('..')) continue;
    lista.push({ arquivo, grupo: grupoDe(arquivo), tamanho: Number(tam) || 0, mudou: Math.round(Number(mt) * 1000) || 0 });
  }
  lista.sort((a, b) => GRUPOS.indexOf(a.grupo) - GRUPOS.indexOf(b.grupo) || b.mudou - a.mudou || a.arquivo.localeCompare(b.arquivo));
  return lista;
}

function criarHistorico({ registro, log, roda = rodaPadrao, agora = Date.now }) {
  const json = (res, status, corpo) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(corpo)); };
  const erro = (res, status, motivo) => json(res, status, { ok: false, erro: motivo });
  const ultimoReindex = new Map();

  function agenteDe(slug) {
    const est = registro.estado();
    if (!est.ok) return { erro: est.erro, status: 503 };
    const a = est.agentes.find((x) => x.slug === slug);
    if (!a) return { erro: `Não existe agente "${String(slug).slice(0, 40)}".`, status: 404 };
    if (a.tipo === 'admin') return { erro: 'O Admin não guarda histórico pesquisável.', status: 404 };
    return { a };
  }
  const naCaixa = (a, args) => roda('podman', ['exec', '-u', 'agente', '-w', CASA, a.container || `dgclaw-${a.slug}`, ...args]);
  const fts = (a, args) => naCaixa(a, ['python3', FTS, '--workspace', CASA, ...args]);

  async function reindexSePreciso(a) {
    const t = agora();
    if (t - (ultimoReindex.get(a.slug) || 0) < REINDEX_MS) return;
    ultimoReindex.set(a.slug, t);
    const r = await fts(a, ['reindex', '--quieto']);
    if (!r.ok) log('aviso', `Histórico de ${a.slug}: o reindex falhou (${r.erro.trim().slice(0, 200)}); a busca usa o índice que já existe.`);
  }

  async function listar(a) {
    const r = await naCaixa(a, ['find', `${CASA}/MEMORY.md`, `${CASA}/working-memory.md`, `${CASA}/memory`,
      '-maxdepth', '3', '-type', 'f', '(', '-name', '*.md', '-o', '-name', '*.json', ')', '-printf', '%p\t%s\t%T@\n']);
    // find sai com 1 quando um dos caminhos não existe (agente novo sem working-memory): vale o que achou.
    if (!r.ok && !r.saida) throw new Error(r.erro.trim().slice(0, 200) || 'não consegui listar');
    return listaMemorias(r.saida);
  }

  async function tratar(req, res, url, sessao) {
    const p = url.pathname, m = req.method;
    if (p !== '/api/v1/historico' && !p.startsWith('/api/v1/historico/')) return false;
    if (!sessao || sessao.via === 'caixa') { erro(res, 403, 'O histórico só é aberto pelo dono, no navegador.'); return true; }
    const mm = /^\/api\/v1\/historico\/([^/]+)(?:\/(busca|memorias|memoria))?$/.exec(p);
    if (!mm) { erro(res, 404, 'Rota do histórico desconhecida.'); return true; }
    if (m !== 'GET') { erro(res, 405, 'O histórico é só de leitura: use GET.'); return true; }
    const { a, erro: e, status } = agenteDe(decodeURIComponent(mm[1]));
    if (!a) { erro(res, status, e); return true; }

    try {
      if (!mm[2]) {
        await reindexSePreciso(a);
        const r = await fts(a, ['status', '--json']);
        let s = null; try { s = JSON.parse(r.saida); } catch (_) { /* abaixo */ }
        if (!s) { erro(res, 503, 'Não consegui ler o índice do histórico. O agente está ligado?'); return true; }
        json(res, 200, { ok: true, ligada: !!s.ligada, motivo: s.motivo || '', conversa: s.conversa || 0, memoria: s.memoria || 0,
          primeira_conversa: s.primeira_conversa || '', ultima_conversa: s.ultima_conversa || '', ultimo_reindex: s.ultimo_reindex || '' });
        return true;
      }

      if (mm[2] === 'busca') {
        const q = String(url.searchParams.get('q') || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        const so = url.searchParams.get('so') || '';
        const desde = url.searchParams.get('desde') || '';
        if (q.replace(/[^\p{L}\p{N}]/gu, '').length < 2) { erro(res, 400, 'Digite pelo menos uma palavra com duas letras.'); return true; }
        if (so && so !== 'conversas' && so !== 'memoria') { erro(res, 400, 'Filtro inválido: use conversas ou memoria.'); return true; }
        if (desde && !RX_DIA.test(desde)) { erro(res, 400, 'Data inválida: use AAAA-MM-DD.'); return true; }
        await reindexSePreciso(a);
        const args = ['buscar', q, '--limite', '40', '--json'];
        if (so) args.push('--so', so);
        if (desde) args.push('--desde', desde);
        const r = await fts(a, args);
        if (r.codigo === 2) { json(res, 200, { ok: true, aviso: 'O índice do histórico ainda não foi criado. Ele sai na próxima rotina do agente.', resultados: [] }); return true; }
        let s = null; try { s = JSON.parse(r.saida); } catch (_) { /* abaixo */ }
        if (!s) { erro(res, 503, `A busca falhou: ${(r.erro || 'sem resposta').trim().slice(0, 200)}`); return true; }
        const resultados = (s.resultados || []).map((x) => ({ tipo: x.tipo, quando: x.quando, ts: x.ts, dia: x.dia, canal: x.canal, papel: x.papel, ref: x.ref, trecho: x.trecho }));
        json(res, 200, { ok: true, aviso: s.aviso || '', resultados });
        return true;
      }

      if (mm[2] === 'memorias') {
        json(res, 200, { ok: true, grupos: GRUPOS, arquivos: await listar(a) });
        return true;
      }

      // memoria?arquivo=: só o que está na lista (nada de caminho montado pelo navegador).
      const arquivo = String(url.searchParams.get('arquivo') || '');
      if (!RX_ARQUIVO.test(arquivo) || arquivo.includes('..')) { erro(res, 400, 'Arquivo de memória inválido.'); return true; }
      const item = (await listar(a)).find((x) => x.arquivo === arquivo);
      if (!item) { erro(res, 404, 'Esse arquivo de memória não existe mais. Atualize a lista.'); return true; }
      const r = await naCaixa(a, ['head', '-c', String(TETO_ARQUIVO), `${CASA}/${arquivo}`]);
      if (!r.ok) { erro(res, 503, 'Não consegui abrir esse arquivo agora. Tente de novo.'); return true; }
      json(res, 200, { ok: true, arquivo, grupo: item.grupo, mudou: item.mudou, cortado: item.tamanho > TETO_ARQUIVO, texto: r.saida });
      return true;
    } catch (x) {
      log('erro', `Histórico de ${a.slug}: ${p} falhou: ${x.message}`);
      erro(res, 503, 'Não consegui abrir o histórico agora. O agente está ligado?');
      return true;
    }
  }

  return { tratar };
}

module.exports = { criarHistorico, listaMemorias, grupoDe };
