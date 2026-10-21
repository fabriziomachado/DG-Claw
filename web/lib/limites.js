'use strict';
// Limite da conta e plano de uso (20/10/2026, pedido do dono, proposta C aprovada).
//
// Todos os agentes (e o Admin) usam a mesma conta do Claude, então o limite é da conta: sessão (5 h),
// semana e créditos extras. Os números oficiais vêm da Anthropic (o mesmo da tela "Seu uso" do claude.ai),
// lidos com o login do Admin (sem nunca aparecer em log ou resposta). "Quem usou" é uma estimativa pelos
// tokens de cada um, com o peso de custo de cada tipo (cache lido vale pouco, saída vale mais).
//
// O plano de uso tem duas chaves, guardadas em <dados>/limites.json:
//   - avisar: notificação no celular quando a sessão passa de 80% ou a semana passa de 70% (uma vez por janela);
//   - economia { ligado, nivel }: quando a semana passa do nível, os agentes de trabalho trocam para o Sonnet
//     (/model sonnet, só quando estão parados) até a semana renovar; aí voltam ao modelo padrão.
// O Admin lê o estado em GET /api/v1/limites/economia e pede antes de trabalho grande (CLAUDE.md do Admin).
//
// GET  /api/v1/limites            tudo o que a Saúde do servidor mostra (só o dono)
// POST /api/v1/limites/config     { avisar?, economia?: { ligado?, nivel? } } (só o dono)
// GET  /api/v1/limites/economia   { ativa, desde, ate, modelo } (qualquer sessão; a conversa mostra o selo)

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('./http');

const URL_USO = 'https://api.anthropic.com/api/oauth/usage';
const CACHE_USO_MS = 2 * 60 * 1000;
const CACHE_QUEM_MS = 5 * 60 * 1000;
const INTERVALO_MS = 3 * 60 * 1000;
const AVISO_SESSAO = 80;
const AVISO_SEMANA = 70;
const NIVEIS = [60, 70, 85];
const MINUTOS_PARALELA = [3, 5, 10, 15];
const PESO = { entrada: 1, cache_lido: 0.1, cache_criado: 1.25, saida: 5 };

// paralela: trabalho que passa de N minutos vai para uma sessão paralela (card) e o chat fica livre.
// Vira texto nas instruções de cada agente (bin/dgclaw, regra_paralela) quando muda.
const CONFIG_PADRAO = { avisar: true, economia: { ligado: true, nivel: 70 }, paralela: { ligado: true, minutos: 5 } };

/** Os números da Anthropic no formato da tela. */
function normaliza(d) {
  const jan = (j) => (j && Number.isFinite(j.utilization) ? { pct: Math.round(j.utilization), renova: j.resets_at || null } : null);
  const x = d && d.extra_usage;
  return {
    sessao: jan(d && d.five_hour),
    semana: jan(d && d.seven_day),
    extras: x ? { ligado: !!x.is_enabled, usado: Number(x.used_credits) || 0, limite: Number(x.monthly_limit) || 0, moeda: x.currency || 'USD', casas: Number.isInteger(x.decimal_places) ? x.decimal_places : 2 } : null,
  };
}

/** Tokens de uma casa desde `desdeMs`, pesados pelo custo de cada tipo (uma vez por message.id). */
function pesoDe(home, desdeMs) {
  let total = 0;
  let pastas = [];
  try { pastas = fs.readdirSync(path.join(home, '.claude', 'projects')).map((p) => path.join(home, '.claude', 'projects', p)); } catch (_) { return 0; }
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
        total += PESO.entrada * n(u.input_tokens) + PESO.cache_lido * n(u.cache_read_input_tokens)
          + PESO.cache_criado * n(u.cache_creation_input_tokens) + PESO.saida * n(u.output_tokens);
      }
    }
  }
  return total;
}

/** [{slug, nome, pct}] somando 100, do maior para o menor (sem uso: lista vazia). */
function divide(pesos) {
  const tot = pesos.reduce((t, p) => t + p.peso, 0);
  if (!tot) return [];
  const out = pesos.map((p) => ({ slug: p.slug, nome: p.nome, pct: Math.round((p.peso / tot) * 100) })).sort((a, b) => b.pct - a.pct);
  const dif = 100 - out.reduce((t, p) => t + p.pct, 0);
  if (out.length) out[0].pct += dif;
  return out.filter((p) => p.pct > 0);
}

/** Lê o login de um arquivo de credenciais e pergunta o uso à Anthropic. Nunca devolve nem loga o token. */
async function usoPeloLogin(arquivo) {
  let tok;
  try { tok = JSON.parse(fs.readFileSync(arquivo, 'utf8')).claudeAiOauth; } catch (_) { return null; }
  if (!tok || !tok.accessToken) return null;
  const r = await fetch(URL_USO, {
    headers: { Authorization: 'Bearer ' + tok.accessToken, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'dgclaw-web' },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) return { erro: `a Anthropic respondeu ${r.status}` };
  return { dados: await r.json(), plano: tok.subscriptionType || null };
}

/** Regrava as instruções de cada agente (a regra da sessão paralela mudou). Um por vez; não reinicia nada. */
function regravaIdentidades(agentes, log) {
  const { execFile } = require('node:child_process');
  return agentes.reduce((p, a) => p.then(() => new Promise((ok) => execFile('/usr/local/bin/dgclaw', ['agente', 'identidade', a.slug], { timeout: 60000 }, (err, _o, e) => {
    if (err) log('aviso', `Sessão paralela: não consegui regravar as instruções de ${a.slug}: ${String(e || err.message).trim().slice(0, 200)}`);
    ok();
  }))), Promise.resolve());
}

function criarLimites({ registro, conversa, push, log = () => {}, dataDir, tz = 'America/Sao_Paulo', agora = () => Date.now(), buscarUso, homeAdmin = os.homedir(), regravar = regravaIdentidades }) {
  const arquivo = path.join(dataDir, 'limites.json');
  const cache = { uso: null, quem: null };
  let timer = null, rodando = false;

  function lerArquivo() {
    try {
      const d = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
      return {
        config: { avisar: d.config && typeof d.config.avisar === 'boolean' ? d.config.avisar : CONFIG_PADRAO.avisar,
          economia: { ligado: d.config && d.config.economia && typeof d.config.economia.ligado === 'boolean' ? d.config.economia.ligado : CONFIG_PADRAO.economia.ligado,
            nivel: d.config && d.config.economia && NIVEIS.includes(d.config.economia.nivel) ? d.config.economia.nivel : CONFIG_PADRAO.economia.nivel },
          paralela: { ligado: !(d.config && d.config.paralela && d.config.paralela.ligado === false),
            minutos: d.config && d.config.paralela && MINUTOS_PARALELA.includes(d.config.paralela.minutos) ? d.config.paralela.minutos : CONFIG_PADRAO.paralela.minutos } },
        estado: Object.assign({ avisados: {}, economia: { ativa: false, desde: null, ate: null, aplicado: {} } }, d.estado || {}),
      };
    } catch (_) {
      return { config: JSON.parse(JSON.stringify(CONFIG_PADRAO)), estado: { avisados: {}, economia: { ativa: false, desde: null, ate: null, aplicado: {} } } };
    }
  }
  function grava(d) {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    const tmp = arquivo + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, arquivo);
  }

  function agentes() {
    const est = registro.estado();
    return est && est.ok ? est.agentes : [];
  }
  const trabalho = () => agentes().filter((a) => a.tipo !== 'admin');

  async function buscaPadrao() {
    const arqs = [path.join(homeAdmin, '.claude', '.credentials.json')]
      .concat(trabalho().filter((a) => a.home_host).map((a) => path.join(a.home_host, '.claude', '.credentials.json')));
    let ultimoErro = 'nenhum login do Claude encontrado neste servidor';
    for (const a of arqs) {
      try {
        const r = await usoPeloLogin(a);
        if (r && r.dados) return r;
        if (r && r.erro) ultimoErro = r.erro;
      } catch (e) { ultimoErro = e.message; }
    }
    throw new Error(ultimoErro);
  }

  async function uso(forca) {
    if (!forca && cache.uso && agora() - cache.uso.em < CACHE_USO_MS) return cache.uso;
    try {
      const r = await (buscarUso || buscaPadrao)();
      cache.uso = { em: agora(), ...normaliza(r.dados), plano: r.plano, erro: null };
    } catch (e) {
      cache.uso = { em: agora(), ...(cache.uso || {}), erro: `Não consegui ler o uso da conta: ${e.message}.` };
    }
    return cache.uso;
  }

  function quemUsou(u, forca) {
    if (!forca && cache.quem && agora() - cache.quem.em < CACHE_QUEM_MS) return cache.quem;
    const t = agora();
    const ini = (j, ms) => { const r = j && j.renova ? Date.parse(j.renova) : NaN; return Number.isFinite(r) ? Math.min(t, r - ms) : t - ms; };
    const casas = [{ slug: 'admin', nome: 'Admin', home: homeAdmin }].concat(trabalho().filter((a) => a.home_host).map((a) => ({ slug: a.slug, nome: a.nome, home: a.home_host })));
    const conta = (desde) => divide(casas.map((c) => ({ slug: c.slug, nome: c.nome, peso: pesoDe(c.home, desde) })));
    cache.quem = { em: t, sessao: conta(ini(u.sessao, 5 * 3600e3)), semana: conta(ini(u.semana, 7 * 86400e3)) };
    return cache.quem;
  }

  const hora = (iso) => new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const diaHora = (iso) => {
    const d = new Date(iso);
    const dia = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, weekday: 'long' }).format(d);
    return `${dia}, ${hora(iso)}`;
  };

  async function avisa(aviso) {
    if (!push) return;
    try { await push.enviar(Object.assign({ url: '/saude' }, aviso)); } catch (e) { log('aviso', `Limites: não consegui mandar o aviso "${aviso.titulo}": ${e.message}`); }
  }

  /** Troca o modelo dos agentes parados para `alvo` ('sonnet' ou 'default'). Devolve quantos faltam. */
  async function aplica(est, alvo) {
    let faltam = 0;
    for (const a of trabalho()) {
      if (est.economia.aplicado[a.slug] === alvo) continue;
      if (alvo === 'default' && !est.economia.aplicado[a.slug]) continue;   // nunca trocou: não há o que voltar
      let parado = false;
      try { parado = (await conversa.atividade(a)).estado === 'ocioso'; } catch (_) { parado = false; }
      if (!parado) { faltam++; continue; }
      try {
        const r = await conversa.comando(a, { comando: '/model', argumentos: alvo });
        if (r && r.status < 300) { est.economia.aplicado[a.slug] = alvo; log('info', `Modo economia: ${a.slug} agora usa ${alvo === 'sonnet' ? 'o Sonnet' : 'o modelo padrão'}.`); }
        else { faltam++; log('aviso', `Modo economia: ${a.slug} não aceitou /model ${alvo} (${r && r.corpo && r.corpo.erro || 'sem resposta'}). Tento de novo.`); }
      } catch (e) { faltam++; log('aviso', `Modo economia: ${a.slug}: ${e.message}. Tento de novo.`); }
    }
    return faltam;
  }

  /** Uma volta do vigia: avisos e modo economia. */
  async function tick() {
    if (rodando) return;
    rodando = true;
    try {
      const u = await uso(true);
      if (!u.semana || !u.sessao) return;
      const d = lerArquivo();
      const { config, estado } = d;
      const quem = quemUsou(u, true);
      if (config.avisar) {
        if (u.sessao.pct >= AVISO_SESSAO && estado.avisados.sessao !== u.sessao.renova) {
          estado.avisados.sessao = u.sessao.renova;
          const q = quem.sessao[0];
          await avisa({ titulo: `A sessão chegou a ${u.sessao.pct}%`, corpo: `Renova às ${hora(u.sessao.renova)}.${q ? ` Quem mais usou: ${q.nome}.` : ''}`, tag: 'limite-sessao' });
        }
        if (u.semana.pct >= AVISO_SEMANA && estado.avisados.semana !== u.semana.renova) {
          estado.avisados.semana = u.semana.renova;
          const q = quem.semana[0];
          await avisa({ titulo: `A semana chegou a ${u.semana.pct}%`, corpo: `${q ? `${q.nome} usou ${q.pct}%. ` : ''}Renova ${diaHora(u.semana.renova)}.`, tag: 'limite-semana' });
        }
      }
      const eco = estado.economia;
      const passou = eco.ate && agora() >= Date.parse(eco.ate);
      const deveLigar = config.economia.ligado && u.semana.pct >= config.economia.nivel && !passou;
      if (deveLigar && !eco.ativa) {
        Object.assign(eco, { ativa: true, desde: new Date(agora()).toISOString(), ate: u.semana.renova, aplicado: {} });
        log('info', `Modo economia ligado: a semana está em ${u.semana.pct}% (nível ${config.economia.nivel}%).`);
        await avisa({ titulo: 'Modo economia ligado', corpo: `A semana está em ${u.semana.pct}%. Os agentes passaram para o Sonnet até ${diaHora(u.semana.renova)}. Toque para ver ou desligar.`, tag: 'modo-economia' });
      } else if (eco.ativa && (!deveLigar || passou)) {
        Object.assign(eco, { ativa: false, desde: null, ate: null });
        log('info', 'Modo economia desligado: os agentes voltam ao modelo padrão.');
      }
      await aplica(estado, eco.ativa ? 'sonnet' : 'default').catch(() => {});
      grava(d);
    } catch (e) {
      log('aviso', `Limites: a volta do vigia falhou: ${e.message}`);
    } finally { rodando = false; }
  }

  function economia() {
    const e = lerArquivo().estado.economia;
    return { ativa: !!e.ativa, desde: e.desde, ate: e.ate, modelo: e.ativa ? 'Sonnet' : null };
  }

  async function rotas(req, res, url, sessao) {
    const p = url.pathname;
    if (p === '/api/v1/limites/economia' && req.method === 'GET') { H.enviaJson(res, 200, { ok: true, ...economia() }); return true; }
    if (p !== '/api/v1/limites' && p !== '/api/v1/limites/config') return false;
    if (!sessao || sessao.via === 'caixa') { H.erroJson(res, 403, 'O limite da conta é só do dono, pelo login do painel.'); return true; }
    if (p === '/api/v1/limites/config') {
      if (req.method !== 'POST') { H.erroJson(res, 405, 'Use POST.'); return true; }
      let b;
      try { b = await H.lerJson(req, 4096); } catch (e) { H.erroJson(res, 400, e.message); return true; }
      const d = lerArquivo();
      if (typeof b.avisar === 'boolean') d.config.avisar = b.avisar;
      if (b.economia && typeof b.economia.ligado === 'boolean') d.config.economia.ligado = b.economia.ligado;
      if (b.economia && b.economia.nivel != null) {
        if (!NIVEIS.includes(b.economia.nivel)) { H.erroJson(res, 400, `O nível do modo economia precisa ser ${NIVEIS.join(', ')}.`); return true; }
        d.config.economia.nivel = b.economia.nivel;
      }
      let mudouParalela = false;
      if (b.paralela && typeof b.paralela.ligado === 'boolean' && b.paralela.ligado !== d.config.paralela.ligado) { d.config.paralela.ligado = b.paralela.ligado; mudouParalela = true; }
      if (b.paralela && b.paralela.minutos != null) {
        if (!MINUTOS_PARALELA.includes(b.paralela.minutos)) { H.erroJson(res, 400, `O tempo da sessão paralela precisa ser ${MINUTOS_PARALELA.join(', ')} minutos.`); return true; }
        if (b.paralela.minutos !== d.config.paralela.minutos || !d.config.paralela.ligado) { d.config.paralela.minutos = b.paralela.minutos; d.config.paralela.ligado = true; mudouParalela = true; }
      }
      grava(d);
      if (mudouParalela) {
        const p = d.config.paralela;
        log('info', `Sessão paralela: ${p.ligado ? `trabalho de mais de ${p.minutos} min vai para card` : 'só quando o dono pedir'}; regravando as instruções dos agentes.`);
        regravar(trabalho(), log);
      }
      tick();   // aplica já (liga ou desliga o modo economia), sem esperar a próxima volta
      H.enviaJson(res, 200, { ok: true, config: d.config });
      return true;
    }
    if (req.method !== 'GET') { H.erroJson(res, 405, 'Use GET.'); return true; }
    const forca = url.searchParams.get('forca') === '1';
    const u = await uso(forca);
    const d = lerArquivo();
    H.enviaJson(res, 200, { ok: !u.erro || !!u.semana, erro: u.erro, plano: u.plano || null, sessao: u.sessao || null, semana: u.semana || null, extras: u.extras || null,
      quem: u.semana ? quemUsou(u, forca) : { sessao: [], semana: [] }, config: d.config, economia: economia(), niveis: NIVEIS, minutos_paralela: MINUTOS_PARALELA,
      avisos: { sessao: AVISO_SESSAO, semana: AVISO_SEMANA }, conferido_em: u.em ? new Date(u.em).toISOString() : null });
    return true;
  }

  return {
    rotas, tick, uso, economia,
    iniciar() { if (!timer) { timer = setInterval(tick, INTERVALO_MS); if (timer.unref) timer.unref(); setTimeout(tick, 5000).unref?.(); } },
    parar() { if (timer) clearInterval(timer); timer = null; },
  };
}

module.exports = { criarLimites, normaliza, pesoDe, divide, NIVEIS, MINUTOS_PARALELA };
