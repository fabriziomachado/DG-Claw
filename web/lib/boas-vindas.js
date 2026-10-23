'use strict';
// Boas-vindas (22/10/2026, pedido do dono): o que a pessoa conta nas telas de abertura do app.
//
//   Perfil: nome, área e o que resolver primeiro. Fica em <dataDir>/perfil-dono.json e vai para
//   todos os agentes de trabalho como um bloco marcado no MEMORY.md (que a sessão já importa) e no
//   retrato ~/.dgclaw/retratos/dono.json. O bloco é regravado a cada mudança; o resto do arquivo é
//   do agente e não é tocado.
//
//   Avisos: quais avisos de conversa tocam (pedido de decisão, entrega) e o silêncio à noite. Fica
//   em <dataDir>/preferencias-avisos.json. `avisar(aviso, tipo)` é o caminho dos avisos de conversa
//   e da Mesa: tipo desligado não toca; no silêncio o aviso não toca, é contado, e no fim do
//   silêncio sai um resumo só. Lembrete e aviso de teste não passam por aqui (a pessoa marcou a hora).
//
//   GET  /api/v1/boas-vindas          { ok, perfil, avisos }
//   POST /api/v1/boas-vindas/perfil   { nome, area, prioridades: [] }
//   POST /api/v1/boas-vindas/avisos   { pedidos, entregas, silencio: { ativo, de: "22:00", ate: "07:00" } }

const fs = require('node:fs');
const path = require('node:path');
const H = require('./http');
const { gravaArquivoSeguro } = require('./grava-seguro');

const AREAS = ['Reitoria', 'Tecnologia', 'Marketing', 'Atendimento', 'Secretaria', 'Coordenação', 'Outra'];
const PRIORIDADES = ['Relatórios e números', 'Chamados', 'Sistemas e servidores', 'E-mails', 'Conteúdo'];
const RX_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const PADRAO_AVISOS = { pedidos: true, entregas: true, silencio: { ativo: false, de: '22:00', ate: '07:00' } };
const INICIO = '<!-- s2bot:perfil-dono inicio (gravado pelo S2 Bot com o que o dono contou nas boas-vindas; ele muda pelo app) -->';
const FIM = '<!-- s2bot:perfil-dono fim -->';
const INTERVALO_MS = 60000;

function leJson(arquivo, padrao, log) {
  try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch (e) {
    if (e.code !== 'ENOENT') log('aviso', `Boas-vindas: não li ${arquivo} (${e.code || e.message}); sigo com o padrão.`);
    return padrao;
  }
}

/** Minutos desde a meia-noite no fuso dado. */
function minutosNoFuso(ms, tz) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const v = (t) => Number((p.find((x) => x.type === t) || {}).value);
  return v('hour') * 60 + v('minute');
}
const emMin = (h) => { const m = RX_HORA.exec(h); return Number(m[1]) * 60 + Number(m[2]); };

/** O silêncio vale agora? Aceita janela que vira a noite (22:00 às 07:00). */
function noSilencio(silencio, ms, tz) {
  if (!silencio || !silencio.ativo) return false;
  const agora = minutosNoFuso(ms, tz), de = emMin(silencio.de), ate = emMin(silencio.ate);
  if (de === ate) return false;
  return de < ate ? agora >= de && agora < ate : agora >= de || agora < ate;
}

function limpaTexto(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f<>`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function validaPerfil(c) {
  const nome = limpaTexto(c.nome, 60);
  if (!nome) return { erro: 'Diga o seu nome (até 60 caracteres).' };
  const area = c.area == null || c.area === '' ? '' : String(c.area);
  if (area && !AREAS.includes(area)) return { erro: `"area" precisa ser uma destas: ${AREAS.join(', ')}.` };
  const pri = Array.isArray(c.prioridades) ? c.prioridades : [];
  const fora = pri.filter((x) => !PRIORIDADES.includes(x));
  if (fora.length) return { erro: `Prioridade desconhecida: ${fora.join(', ')}. Use: ${PRIORIDADES.join(', ')}.` };
  return { perfil: { nome, area, prioridades: [...new Set(pri)] } };
}

function validaAvisos(c) {
  const s = c.silencio || {};
  const de = s.de == null ? PADRAO_AVISOS.silencio.de : String(s.de);
  const ate = s.ate == null ? PADRAO_AVISOS.silencio.ate : String(s.ate);
  if (!RX_HORA.test(de) || !RX_HORA.test(ate)) return { erro: 'As horas do silêncio vão no formato HH:MM, por exemplo "22:00" e "07:00".' };
  return { avisos: { pedidos: c.pedidos !== false, entregas: c.entregas !== false, silencio: { ativo: !!s.ativo, de, ate } } };
}

/** O bloco do MEMORY.md, em português simples. */
function blocoPerfil(p) {
  const linhas = [INICIO, '## O dono (contou nas boas-vindas do app)', `- Nome: ${p.nome}. Chame por esse nome.`];
  if (p.area) linhas.push(`- Área na Unesc: ${p.area}.`);
  if (p.prioridades.length) linhas.push(`- Quer que os agentes resolvam primeiro: ${p.prioridades.join(', ')}.`);
  linhas.push(FIM);
  return linhas.join('\n');
}

/** Troca (ou acrescenta no fim) o bloco marcado, sem mexer no resto do texto do agente. */
function comBloco(texto, bloco) {
  const i = texto.indexOf(INICIO), f = texto.indexOf(FIM);
  if (i >= 0 && f > i) return texto.slice(0, i) + bloco + texto.slice(f + FIM.length);
  return (texto.replace(/\s*$/, '') + '\n\n' + bloco + '\n').replace(/^\n+/, '');
}

function criarBoasVindas({ config, registro, caixa, push, log, agora }) {
  const relogio = agora || (() => Date.now());
  const arqPerfil = path.join(config.dataDir, 'perfil-dono.json');
  const arqAvisos = path.join(config.dataDir, 'preferencias-avisos.json');
  const arqGuardados = path.join(config.dataDir, 'avisos-no-silencio.json');
  const tz = config.tz;
  let timer = null;

  const grava = (arq, obj) => gravaArquivoSeguro(arq, JSON.stringify(obj, null, 2), { raiz: config.dataDir, modo: 0o600 });
  const perfil = () => leJson(arqPerfil, null, log);
  function avisos() {
    const a = leJson(arqAvisos, null, log);
    const v = a && validaAvisos(a);
    return v && v.avisos ? v.avisos : JSON.parse(JSON.stringify(PADRAO_AVISOS));
  }
  const guardados = () => leJson(arqGuardados, { pedidos: 0, entregas: 0, contador: null }, log);

  function trabalhadores() {
    const est = registro.estado();
    return est && est.ok ? est.agentes.filter((a) => a.tipo !== 'admin' && a.home_host) : [];
  }

  /** Leva o perfil para a casa de cada agente. Devolve { slug: 'ok' | motivo }. */
  function entregaPerfil(p) {
    const r = {};
    for (const ag of trabalhadores()) {
      try {
        caixa.gravaRetrato(ag, 'dono', { versao: 1, perfil: p });
        const st = fs.statSync(ag.home_host);
        const arq = path.join(fs.realpathSync(ag.home_host), 'MEMORY.md');
        let atual = '';
        try { atual = fs.readFileSync(arq, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        gravaArquivoSeguro(arq, comBloco(atual, blocoPerfil(p)), { raiz: ag.home_host, uid: st.uid, gid: st.gid, modo: 0o644 });
        r[ag.slug] = 'ok';
      } catch (e) {
        r[ag.slug] = e.message;
        log('erro', `Boas-vindas: não levei o perfil do dono para ${ag.slug}: ${e.message}`);
      }
    }
    return r;
  }

  /** Aviso de conversa ou da Mesa. tipo: 'pedido' ou 'entrega'. */
  function avisar(aviso, tipo) {
    const pref = avisos();
    if (tipo === 'pedido' && !pref.pedidos) return Promise.resolve({ pulado: 'pedidos desligados' });
    if (tipo === 'entrega' && !pref.entregas) return Promise.resolve({ pulado: 'entregas desligadas' });
    if (noSilencio(pref.silencio, relogio(), tz)) {
      const g = guardados();
      if (tipo === 'entrega') g.entregas++; else g.pedidos++;
      if (typeof aviso.contador === 'number') g.contador = aviso.contador;
      try { grava(arqGuardados, g); } catch (e) { log('erro', `Boas-vindas: não guardei o aviso do silêncio (${e.message}); ele fica só na Caixa de entrada.`); }
      return Promise.resolve({ guardado: true });
    }
    return push.enviar(aviso);
  }

  /** Fim do silêncio: um resumo só do que ficou esperando. */
  function tique() {
    const g = guardados();
    if (!g.pedidos && !g.entregas) return;
    if (noSilencio(avisos().silencio, relogio(), tz)) return;
    const partes = [];
    if (g.pedidos) partes.push(g.pedidos === 1 ? '1 pedido de decisão' : `${g.pedidos} pedidos de decisão`);
    if (g.entregas) partes.push(g.entregas === 1 ? '1 entrega' : `${g.entregas} entregas`);
    try { fs.unlinkSync(arqGuardados); } catch (e) { if (e.code !== 'ENOENT') { log('erro', `Boas-vindas: não apaguei ${arqGuardados} (${e.code}); não mando o resumo para não repetir.`); return; } }
    const aviso = { titulo: 'Enquanto você descansava', corpo: partes.join(' e ') + ' esperando por você.', tag: 'resumo-silencio', url: '/caixa' };
    if (typeof g.contador === 'number') aviso.contador = g.contador;
    push.enviar(aviso).catch((e) => log('erro', `Boas-vindas: não mandei o resumo do silêncio: ${e.message}`));
  }

  function iniciar() {
    if (timer) return;
    timer = setInterval(() => { try { tique(); } catch (e) { log('erro', `Boas-vindas: ${e.message}`); } }, INTERVALO_MS);
    if (timer.unref) timer.unref();
  }
  function parar() { if (timer) { clearInterval(timer); timer = null; } }

  async function tratar(req, res, url, sessao) {
    const p = url.pathname, m = req.method;
    if (p !== '/api/v1/boas-vindas' && !p.startsWith('/api/v1/boas-vindas/')) return false;
    if (!sessao || sessao.via === 'caixa') { H.erroJson(res, 403, 'As boas-vindas são só do dono, no navegador.'); return true; }
    if (p === '/api/v1/boas-vindas' && m === 'GET') {
      H.enviaJson(res, 200, { ok: true, perfil: perfil(), avisos: avisos(), areas: AREAS, prioridades: PRIORIDADES });
      return true;
    }
    if ((p === '/api/v1/boas-vindas/perfil' || p === '/api/v1/boas-vindas/avisos') && m === 'POST') {
      let c; try { c = await H.lerJson(req, 16 * 1024); } catch (e) { H.erroJson(res, e.status || 400, e.message); return true; }
      if (p.endsWith('/perfil')) {
        const v = validaPerfil(c);
        if (v.erro) { H.erroJson(res, 400, v.erro); return true; }
        const salvo = Object.assign({}, v.perfil, { atualizado_em: new Date(relogio()).toISOString() });
        try { grava(arqPerfil, salvo); } catch (e) { log('erro', `Boas-vindas: não gravei ${arqPerfil}: ${e.message}`); H.erroJson(res, 500, 'Não consegui guardar o perfil no servidor. Tente de novo.'); return true; }
        H.enviaJson(res, 200, { ok: true, perfil: salvo, agentes: entregaPerfil(v.perfil) });
        return true;
      }
      const v = validaAvisos(c);
      if (v.erro) { H.erroJson(res, 400, v.erro); return true; }
      try { grava(arqAvisos, v.avisos); } catch (e) { log('erro', `Boas-vindas: não gravei ${arqAvisos}: ${e.message}`); H.erroJson(res, 500, 'Não consegui guardar a escolha dos avisos. Tente de novo.'); return true; }
      H.enviaJson(res, 200, { ok: true, avisos: v.avisos });
      return true;
    }
    H.erroJson(res, 404, 'Rota de boas-vindas desconhecida. Veja o começo de web/lib/boas-vindas.js.');
    return true;
  }

  return { tratar, avisar, tique, iniciar, parar, perfil, avisos };
}

module.exports = { criarBoasVindas, noSilencio, comBloco, blocoPerfil, validaPerfil, validaAvisos, AREAS, PRIORIDADES };
