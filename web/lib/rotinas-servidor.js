'use strict';
// Rotinas do servidor (28/10/2026, pedido do dono): os roteiros que rodam no próprio servidor, fora das
// caixas dos agentes (cópia de segurança, varredura, vigia de tráfego, atualização marcada), aparecem na
// Saúde do servidor com a última vez, a próxima e os últimos 7 dias. Se um falha, chega aviso no celular.
//
// GET  /api/v1/rotinas-servidor            -> { ok, rotinas: [...] } (só as que têm timer neste servidor)
// POST /api/v1/rotinas-servidor/<id>/rodar -> roda agora (só as marcadas com `rodar`: as que não reiniciam nada)
// Só o dono, pelo login (um agente pela caixa recebe 403). Tudo vem do systemd: `systemctl show` e o journal.

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const H = require('./http');

// O que o S2 Bot conhece. Um servidor sem algum desses timers simplesmente não mostra a linha.
const CATALOGO = [
  { id: 'copia', unidade: 'dgclaw-copia-diaria', nome: 'Cópia de segurança', icone: 'caixa', rodar: true,
    oque: 'Junta agentes, conversas e configurações, tranca com a sua senha e guarda os últimos 7 dias.' },
  { id: 'varredura', unidade: 'dgclaw-varredura-seguranca', nome: 'Varredura de segurança', icone: 'escudo', rodar: true,
    oque: 'Procura falhas conhecidas nos programas do servidor e na caixa dos agentes. O Tech transforma o resultado no relatório do dia.' },
  { id: 'trafego', unidade: 'dgclaw-vigia-trafego', nome: 'Vigia de tráfego', icone: 'onda', rodar: false,
    oque: 'Confere se o servidor está mandando dados demais para fora e avisa no celular.' },
  { id: 'atualizacao', unidade: 'dgclaw-atualiza-noite', nome: 'Atualização do sistema', icone: 'ciclo', rodar: false,
    oque: 'Instala as atualizações do sistema e reinicia o servidor (uns 2 minutos fora do ar).' },
];
const CACHE_MS = 60 * 1000;
const VIGIA_MS = 5 * 60 * 1000;
const AVISA_ATE_MS = 26 * 3600 * 1000;   // falha mais velha que isso não vira aviso (servidor ligado depois de dias)
const DIAS = 7;

function rodaPadrao(cmd, args) {
  return new Promise((ok) => {
    execFile(cmd, args, { timeout: 30000, maxBuffer: 32 * 1024 * 1024, windowsHide: true, env: { ...process.env, LANG: 'C.UTF-8' } },
      (err, stdout, stderr) => ok({ ok: !err, saida: String(stdout || ''), erro: String(stderr || (err && err.message) || '') }));
  });
}

/** `systemctl show` de várias unidades: blocos separados por linha vazia, cada um com Id=. */
function lerShow(saida) {
  const out = {};
  for (const bloco of String(saida || '').split(/\n\s*\n/)) {
    const o = {};
    for (const l of bloco.split('\n')) {
      const i = l.indexOf('=');
      if (i > 0) { const k = l.slice(0, i); o[k] = o[k] ? `${o[k]}\n${l.slice(i + 1)}` : l.slice(i + 1); }   // TimersMonotonic se repete
    }
    if (o.Id) out[o.Id] = o;
  }
  return out;
}
const unix = (v) => { const m = /^@(\d+)$/.exec(String(v || '').trim()); return m ? Number(m[1]) * 1000 : null; };

/** De quanto em quanto tempo, em palavras: "todo dia às 03:30", "a cada 5 minutos", "uma vez só". */
function frequencia(timer) {
  const cal = /OnCalendar=([^;]+?)\s*;/.exec(timer.TimersCalendar || '');
  if (cal) {
    const m = /^\*-\*-\* (\d{2}):(\d{2})(?::\d{2})?(?: (\S+))?$/.exec(cal[1].trim());
    if (m) {
      if (!m[3] || m[3] === 'America/Sao_Paulo') {
        if (m[3]) return `todo dia às ${m[1]}:${m[2]}`;
        const d = new Date(Date.UTC(2026, 0, 1, +m[1], +m[2]));   // sem fuso: o servidor está em UTC (2026: sem horário de verão)
        return `todo dia às ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(d)}`;
      }
      return `todo dia às ${m[1]}:${m[2]} (${m[3]})`;
    }
    return 'uma vez só';
  }
  const mon = /OnUnitActiveUSec=(\d+)min/.exec(timer.TimersMonotonic || '');
  if (mon) return `a cada ${mon[1]} minutos`;
  const h = /OnUnitActiveUSec=(\d+)h\b/.exec(timer.TimersMonotonic || '');
  if (h) return h[1] === '1' ? 'a cada hora' : `a cada ${h[1]} horas`;
  return 'de tempos em tempos';
}

/** As vezes que rodou, do journal: cada "Finished"/"Failed to start" do systemd tem JOB_RESULT; a causa
 *  de uma falha é a última frase que o próprio roteiro escreveu antes dela. */
function lerVezes(saida, unidade) {
  const vezes = [];
  let ultimaFrase = '';
  for (const l of String(saida || '').split('\n')) {
    if (!l.trim()) continue;
    let d; try { d = JSON.parse(l); } catch { continue; }
    const msg = String(d.MESSAGE || '');
    if (d.SYSLOG_IDENTIFIER === 'systemd') {
      if (/^Starting /.test(msg)) ultimaFrase = '';
      if (d.JOB_RESULT) {
        const ok = d.JOB_RESULT === 'done';
        vezes.push({ em: Math.round(Number(d.__REALTIME_TIMESTAMP) / 1000), ok, causa: ok ? '' : causa(ultimaFrase, unidade) });
      }
    } else if (msg.trim()) ultimaFrase = msg.trim();
  }
  return vezes;
}
function causa(frase, unidade) {
  const t = String(frase || '').replace(new RegExp('^' + unidade + ':\\s*'), '').replace(/^\[\w+\]\s*/, '');
  if (!t) return 'O roteiro parou com erro sem dizer o motivo.';
  return t.length > 300 ? t.slice(0, 297) + '…' : t;
}

/** Os últimos 7 dias, do mais velho para hoje, no fuso de Brasília: como terminou a última vez do dia
 *  (ok ou falhou) ou sem (não rodou). Falha consertada no mesmo dia conta como ok. */
function diasDe(vezes, agora, tz) {
  const dia = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  const out = [];
  for (let i = DIAS - 1; i >= 0; i--) {
    const d = dia(agora - i * 86400000);
    const doDia = vezes.filter((v) => dia(v.em) === d);
    out.push({ dia: d, estado: !doDia.length ? 'sem' : doDia[doDia.length - 1].ok ? 'ok' : 'falhou' });
  }
  return out;
}

function criarRotinasServidor({ dataDir, push, log = () => {}, rodar = rodaPadrao, agora = () => Date.now(), tz = 'America/Sao_Paulo' }) {
  const ARQ = path.join(dataDir, 'rotinas-servidor.json');
  let cache = null, timer = null;

  async function ler(forca) {
    if (!forca && cache && agora() - cache.em < CACHE_MS) return cache.rotinas;
    const unidades = CATALOGO.flatMap((r) => [`${r.unidade}.timer`, `${r.unidade}.service`]);
    const sh = lerShow((await rodar('systemctl', ['show', '--timestamp=unix', '-p',
      'Id,LoadState,ActiveState,Result,NextElapseUSecRealtime,LastTriggerUSec,TimersCalendar,TimersMonotonic', ...unidades])).saida);
    const rotinas = [];
    for (const r of CATALOGO) {
      const t = sh[`${r.unidade}.timer`], s = sh[`${r.unidade}.service`] || {};
      if (!t || t.LoadState !== 'loaded') continue;
      const j = await rodar('journalctl', ['-u', `${r.unidade}.service`, '--since', `-${DIAS} days`, '-o', 'json',
        '--output-fields=MESSAGE,JOB_RESULT,SYSLOG_IDENTIFIER', '--no-pager', '-q']);
      const vezes = lerVezes(j.saida, r.unidade);
      const ultima = vezes[vezes.length - 1] || null;
      const rodando = s.ActiveState === 'activating' || s.ActiveState === 'active';
      const cada = /OnUnitActiveUSec=(\d+)min/.exec(t.TimersMonotonic || '');
      const proxima = t.ActiveState !== 'active' ? null
        : unix(t.NextElapseUSecRealtime) || (cada && ultima ? ultima.em + Number(cada[1]) * 60000 : null);
      const estado = rodando ? 'rodando' : ultima ? (ultima.ok ? 'ok' : 'falhou') : proxima ? 'agendada' : 'nunca';
      rotinas.push({ id: r.id, nome: r.nome, oque: r.oque, icone: r.icone, rodar: r.rodar, frequencia: frequencia(t),
        estado, ultima, proxima, dias: diasDe(vezes, agora(), tz) });
    }
    cache = { em: agora(), rotinas };
    return rotinas;
  }

  function leAvisados() { try { return JSON.parse(fs.readFileSync(ARQ, 'utf8')).avisados || {}; } catch { return {}; } }
  function gravaAvisados(av) {
    try { fs.writeFileSync(ARQ + '.novo', JSON.stringify({ avisados: av }, null, 2), { mode: 0o600 }); fs.renameSync(ARQ + '.novo', ARQ); } catch (e) { log('aviso', `Rotinas do servidor: não gravei ${ARQ}: ${e.message}`); }
  }

  /** Falha nova (que ainda não virou aviso) manda um aviso para o celular, uma vez por falha. */
  async function vigia() {
    let rotinas;
    try { rotinas = await ler(true); } catch (e) { log('aviso', `Rotinas do servidor: ${e.message}`); return; }
    const av = leAvisados();
    let mudou = false;
    for (const r of rotinas) {
      const u = r.ultima;
      if (!u || u.ok || av[r.id] >= u.em || agora() - u.em > AVISA_ATE_MS) continue;
      av[r.id] = u.em; mudou = true;
      if (!push) continue;
      try { await push.enviar({ titulo: `${r.nome} falhou`, corpo: `${u.causa} Toque para ver.`, url: '/saude', tag: `rotina-${r.id}` }); }
      catch (e) { log('aviso', `Rotinas do servidor: não consegui avisar "${r.nome}": ${e.message}`); }
    }
    if (mudou) gravaAvisados(av);
  }
  function iniciar() { if (!timer) { timer = setInterval(vigia, VIGIA_MS); if (timer.unref) timer.unref(); setTimeout(vigia, 30000).unref(); } }
  function parar() { if (timer) { clearInterval(timer); timer = null; } }

  async function rotas(req, res, url, sessao) {
    const p = url.pathname;
    if (p !== '/api/v1/rotinas-servidor' && !p.startsWith('/api/v1/rotinas-servidor/')) return false;
    if (!sessao || sessao.via === 'caixa') { H.erroJson(res, 403, 'As rotinas do servidor são só do dono, pelo login do painel.'); return true; }
    if (p === '/api/v1/rotinas-servidor') {
      if (req.method !== 'GET') { H.erroJson(res, 405, 'Use GET.'); return true; }
      try { H.enviaJson(res, 200, { ok: true, rotinas: await ler(url.searchParams.get('forca') === '1') }); }
      catch (e) { H.erroJson(res, 503, `Não consegui ler as rotinas do servidor: ${e.message}.`); }
      return true;
    }
    const m = /^\/api\/v1\/rotinas-servidor\/([a-z]+)\/rodar$/.exec(p);
    const r = m && CATALOGO.find((x) => x.id === m[1]);
    if (!r) { H.erroJson(res, 404, 'Rotina não encontrada.'); return true; }
    if (req.method !== 'POST') { H.erroJson(res, 405, 'Use POST.'); return true; }
    if (!r.rodar) { H.erroJson(res, 403, 'Esta rotina não roda pela tela.'); return true; }
    const x = await rodar('systemctl', ['start', '--no-block', `${r.unidade}.service`]);
    if (!x.ok) { H.erroJson(res, 503, `Não consegui rodar: ${x.erro.trim() || 'erro do systemd'}.`); return true; }
    log('info', `Rotinas do servidor: o dono rodou "${r.nome}" pela tela.`);
    cache = null;
    H.enviaJson(res, 200, { ok: true });
    return true;
  }

  return { rotas, ler, vigia, iniciar, parar };
}

module.exports = { criarRotinasServidor, CATALOGO, lerShow, lerVezes, frequencia, diasDe };
