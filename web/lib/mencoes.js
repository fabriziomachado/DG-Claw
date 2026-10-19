'use strict';
// Mencionar outro agente na conversa (19/10/2026, ideia 1 do plano a partir do filament-chat).
//
// Na conversa do Help o dono escreve "@Data quantos chamados por curso em 2025?". O Web:
//   1. manda a pergunta ao Data como mensagem do dono, marcada "[pergunta feita na conversa do Help]"
//      (o dono vê a pergunta e o trabalho na conversa do Data, como sempre);
//   2. espera o Data responder e ficar parado, e guarda a última resposta dele;
//   3. mostra na conversa do Help a pergunta e um cartão com a resposta do Data (itens que o Web
//      junta à thread do Help, ver `junta`);
//   4. entrega ao Help um <plataforma recado="mencao"> (some da tela) com a pergunta e a resposta,
//      para ele continuar a partir dela.
// Guardado em <dataDir>/mencoes/<slug de origem>.json (600). Uma espera por menção, retomada se o Web
// reiniciar no meio. Só o dono, no navegador.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LIMITE_PERGUNTA = 2000;
const LIMITE_RESPOSTA = 12000;
const ESPERA_MAX_MS = 30 * 60 * 1000;
const QUIETO_MS = 8000;
const PASSO_MS = 4000;

function criarMencoes({ config, registro, conversa, log = () => {}, agora = Date.now, passoMs = PASSO_MS, quietoMs = QUIETO_MS }) {
  const pasta = path.join(config.dataDir, 'mencoes');
  const cache = new Map();   // slug -> { itens, versao }
  const esperando = new Set();

  const arq = (slug) => path.join(pasta, `${slug}.json`);
  function ler(slug) {
    if (cache.has(slug)) return cache.get(slug);
    let itens = [];
    try { const d = JSON.parse(fs.readFileSync(arq(slug), 'utf8')); if (Array.isArray(d.itens)) itens = d.itens; } catch (e) {
      if (e.code !== 'ENOENT') log('aviso', `Menções de ${slug} ilegíveis (${e.message}); sigo sem elas.`);
    }
    const v = { itens, versao: itens.length + ':' + (itens.length ? itens[itens.length - 1].estado : '') };
    cache.set(slug, v);
    return v;
  }
  function grava(slug, itens) {
    fs.mkdirSync(pasta, { recursive: true, mode: 0o700 });
    const tmp = `${arq(slug)}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ itens: itens.slice(-200) }), { mode: 0o600 });
    fs.renameSync(tmp, arq(slug));
    cache.set(slug, { itens: itens.slice(-200), versao: crypto.randomBytes(6).toString('hex') });
  }
  function atualiza(slug, id, mud) {
    const { itens } = ler(slug);
    const i = itens.findIndex((x) => x.id === id);
    if (i < 0) return;
    const novos = itens.slice(); novos[i] = Object.assign({}, novos[i], mud);
    grava(slug, novos);
  }

  /** Itens para a tela do agente de origem: a pergunta (balão do dono) e o cartão da resposta. */
  function junta(slug, t) {
    const { itens, versao } = ler(slug);
    if (!itens.length) return t;
    const extra = [];
    for (const m of itens) {
      if (m.ep <= (t.corte || 0)) continue;
      extra.push({ id: 'menq-' + m.id, ep: m.ep, origin: 'dono', text: '@' + m.paraNome + ' ' + m.pergunta, kind: 'text', media: null, fmt: 'text', reacoes: [], cita: null, via: 'mencao', quem: 'pessoa', mencaoPergunta: { para: m.para } });
      extra.push({ id: 'menr-' + m.id, ep: m.epResposta || m.ep + 0.001, origin: 'mencao', text: m.resposta || '', kind: 'text', media: null, fmt: 'text', reacoes: [], cita: null, via: 'mencao', quem: m.para,
        mencao: { para: m.para, paraNome: m.paraNome, deNome: m.deNome, estado: m.estado, motivo: m.motivo || null } });
    }
    const msgs = t.msgs.concat(extra).sort((a, b) => a.ep - b.ep);
    return Object.assign({}, t, { msgs, versao: String(t.versao) + '|m' + versao });
  }

  const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
  async function espera(slugDe, id) {
    const chave = slugDe + '/' + id;
    if (esperando.has(chave)) return;
    esperando.add(chave);
    try {
      const m = ler(slugDe).itens.find((x) => x.id === id);
      if (!m) return;
      const para = registro.obter(m.para), de = registro.obter(slugDe);
      if (!para || !de) { atualiza(slugDe, id, { estado: 'falhou', motivo: 'o agente não existe mais' }); return; }
      let ultimaMudanca = agora(), visto = '';
      while (agora() - m.ep * 1000 < ESPERA_MAX_MS) {
        await dorme(passoMs);
        let t, est;
        try { t = await conversa.thread(para); est = await conversa.atividade(para); } catch (e) { continue; }
        const resp = t.msgs.filter((x) => x.origin === 'agente' && x.ep > m.epEnviado && String(x.text || '').trim());
        const chaveVista = resp.map((x) => x.id).join(',');
        if (chaveVista !== visto) { visto = chaveVista; ultimaMudanca = agora(); }
        if (!resp.length || (est && est.estado === 'trabalhando') || agora() - ultimaMudanca < quietoMs) continue;
        const ult = resp[resp.length - 1];
        const resposta = String(ult.text).slice(0, LIMITE_RESPOSTA);
        atualiza(slugDe, id, { estado: 'respondida', resposta, epResposta: ult.ep });
        const recado = `<plataforma recado="mencao" de="${para.slug}">O dono perguntou ao ${para.nome}, aqui na sua conversa: "${m.pergunta}"\n\n` +
          `O ${para.nome} respondeu:\n${resposta}\n\nO dono já vê essa resposta num cartão na conversa. Continue a partir dela, ` +
          `de forma curta, respondendo ao dono pelo mcp__dgchat__reply no chat ${de.chat_id || 'c_' + de.slug}. Se não tiver nada a acrescentar, diga em uma frase.</plataforma>`;
        try { await conversa.entregar(de, recado, { cru: true }); } catch (e) { log('aviso', `Menção ${chave}: não entreguei o recado ao ${de.slug} (${e.message}).`); }
        return;
      }
      atualiza(slugDe, id, { estado: 'falhou', motivo: 'o agente não respondeu em 30 minutos' });
    } finally { esperando.delete(chave); }
  }

  async function criar(de, { para: paraSlug, pergunta }) {
    const p = String(pergunta || '').trim();
    if (!p) return { status: 400, corpo: { ok: false, erro: 'Escreva a pergunta depois do @nome do agente.' } };
    if (p.length > LIMITE_PERGUNTA) return { status: 413, corpo: { ok: false, erro: `A pergunta passou de ${LIMITE_PERGUNTA} caracteres.` } };
    const para = registro.obter(String(paraSlug || ''));
    if (!para || para.tipo === 'admin' || para.slug === de.slug) return { status: 400, corpo: { ok: false, erro: 'Esse agente não pode ser mencionado aqui.' } };
    const r = await conversa.enviar(para, { text: `[pergunta feita na conversa do ${de.nome}] ${p}` });
    if (r.status >= 300) return { status: r.status, corpo: Object.assign({ ok: false }, r.corpo) };
    const id = crypto.randomBytes(8).toString('hex');
    const item = { id, para: para.slug, paraNome: para.nome, deNome: de.nome, pergunta: p, ep: agora() / 1000, epEnviado: (r.corpo && r.corpo.ep_enviado) || agora() / 1000 - 1, estado: 'perguntando' };
    grava(de.slug, ler(de.slug).itens.concat(item));
    espera(de.slug, id).catch((e) => log('erro', `Menção ${de.slug}/${id}: ${e.message}`));
    return { status: 200, corpo: { ok: true, id, para: para.slug } };
  }

  /** Retoma as esperas que estavam no meio quando o Web reiniciou. */
  function retoma() {
    let nomes = [];
    try { nomes = fs.readdirSync(pasta).filter((n) => n.endsWith('.json')); } catch (_) { return; }
    for (const n of nomes) {
      const slug = n.slice(0, -5);
      for (const m of ler(slug).itens) if (m.estado === 'perguntando') espera(slug, m.id).catch(() => {});
    }
  }

  return { criar, junta, retoma, ler };
}

module.exports = { criarMencoes };
