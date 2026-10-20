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
      if (m.tipo === 'aviso' || m.tipo === 'pedido') {
        const rot = m.para && m.para.length && m.para[0] !== 'todos' ? m.paraNomes.map((n) => '@' + n).join(' ') : '@todos';
        extra.push({ id: 'menq-' + m.id, ep: m.ep, origin: 'dono', text: rot + ' ' + m.texto, kind: 'text', media: null, fmt: 'text', reacoes: [], cita: null, via: 'mencao', quem: 'pessoa', mencaoPergunta: { varios: true } });
        extra.push({ id: 'menr-' + m.id, ep: m.epResposta || m.ep + 0.001, origin: 'mencao', text: m.resposta || '', kind: 'text', media: null, fmt: 'text', reacoes: [], cita: null, via: 'mencao', quem: m.donoPor || 'dono',
          mencao: { tipo: m.tipo, para: m.para, paraNomes: m.paraNomes, texto: m.texto, estado: m.estado, donoPor: m.donoPor || null, donoNome: m.donoNome || null, motivo: m.motivo || null, avisoId: m.avisoId || null } });
        continue;
      }
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

  /* ── @todos / @vários: Avisar e Pedir (19/10/2026) ──────────────────────────────
     Avisar: a tela posta o aviso no quadro (POST /api/v1/avisos, autor "dono") e registra aqui o cartão.
     Pedir: o pedido fica aqui; cada agente recebe um <plataforma recado="pedido">; o primeiro que chamar
     POST /api/v1/pedidos/<id>/pegar (pela caixa) fica com ele, os outros recebem 409. Ao terminar, ele
     chama POST /api/v1/pedidos/<id>/entregar {resposta}, e a resposta vira o cartão na conversa onde o dono
     pediu. Sem ninguém pegar em 20 minutos, o cartão diz isso. */
  const participantes = () => (registro.estado().agentes || []).filter((a) => a.tipo !== 'admin');
  function nomesDe(para) {
    if (!para || !para.length || para[0] === 'todos') return participantes().map((a) => a.nome);
    return para.map((s) => (registro.obter(s) || { nome: s }).nome);
  }
  function registrarAviso(de, { texto, para, avisoId }) {
    const id = crypto.randomBytes(8).toString('hex');
    const lista = Array.isArray(para) && para.length ? para : ['todos'];
    const item = { id, tipo: 'aviso', texto: String(texto || '').slice(0, 300), para: lista, paraNomes: nomesDe(lista), avisoId: avisoId || null, ep: agora() / 1000, estado: 'avisado' };
    grava(de.slug, ler(de.slug).itens.concat(item));
    return { status: 200, corpo: { ok: true, id } };
  }
  const SEM_DONO_MS = 20 * 60 * 1000;
  async function pedir(de, { texto, para }) {
    const t = String(texto || '').trim();
    if (!t) return { status: 400, corpo: { ok: false, erro: 'Escreva o pedido depois do @todos.' } };
    if (t.length > LIMITE_PERGUNTA) return { status: 413, corpo: { ok: false, erro: `O pedido passou de ${LIMITE_PERGUNTA} caracteres.` } };
    const lista = Array.isArray(para) && para.length && para[0] !== 'todos' ? para.filter((s) => { const a = registro.obter(s); return a && a.tipo !== 'admin'; }) : ['todos'];
    const alvos = lista[0] === 'todos' ? participantes() : lista.map((s) => registro.obter(s));
    if (!alvos.length) return { status: 400, corpo: { ok: false, erro: 'Nenhum agente para receber o pedido.' } };
    const id = crypto.randomBytes(8).toString('hex');
    const item = { id, tipo: 'pedido', texto: t, para: lista, paraNomes: alvos.map((a) => a.nome), de: de.slug, deNome: de.nome, ep: agora() / 1000, estado: 'aberto', donoPor: null };
    grava(de.slug, ler(de.slug).itens.concat(item));
    indicePedidos.set(id, de.slug);
    const recado = (a) => `<plataforma recado="pedido" id="${id}">Pedido do dono para a equipe (${alvos.map((x) => x.nome).join(', ')}): "${t}"\n\n` +
      `Se for da sua área e você puder fazer agora, PEGUE antes de começar: dgclaw-api POST /api/v1/pedidos/${id}/pegar\n` +
      `- Se a resposta for ok, o pedido é seu: crie a tarefa na Mesa (dgclaw-mesa criar --origem "dono, pedido para a equipe: ${t.slice(0, 60).replace(/"/g, "'")}"), faça, e no fim entregue o resultado em poucas linhas com: dgclaw-api POST /api/v1/pedidos/${id}/entregar '{"resposta":"..."}'. Pode pedir ajuda a outro agente pelo quadro de avisos.\n` +
      `- Se vier 409 (outro já pegou) ou se não for com você: não faça nada e não escreva ao dono por causa deste recado.`;
    await Promise.all(alvos.map(async (a) => {
      try { await conversa.entregar(a, recado(a), { cru: true }); } catch (e) { log('aviso', `Pedido ${id}: não entreguei a ${a.slug} (${e.message}).`); }
    }));
    setTimeout(() => {
      const m = ler(de.slug).itens.find((x) => x.id === id);
      if (m && m.estado === 'aberto') atualiza(de.slug, id, { estado: 'sem_dono', motivo: 'ninguém pegou em 20 minutos' });
    }, SEM_DONO_MS).unref?.();
    return { status: 200, corpo: { ok: true, id } };
  }
  const indicePedidos = new Map();   // id -> slug da conversa onde nasceu
  function achaPedido(id) {
    if (!indicePedidos.has(id)) {
      let nomes = [];
      try { nomes = fs.readdirSync(pasta).filter((n) => n.endsWith('.json')); } catch (_) { /* vazio */ }
      for (const n of nomes) { const slug = n.slice(0, -5); for (const m of ler(slug).itens) if (m.tipo === 'pedido') indicePedidos.set(m.id, slug); }
    }
    const slug = indicePedidos.get(id);
    const m = slug ? ler(slug).itens.find((x) => x.id === id) : null;
    return m ? { slug, m } : null;
  }
  function pegar(agenteSlug, id) {
    const p = achaPedido(id);
    if (!p) return { status: 404, corpo: { ok: false, erro: 'Não existe esse pedido.' } };
    const { slug, m } = p;
    if (m.para[0] !== 'todos' && !m.para.includes(agenteSlug)) return { status: 403, corpo: { ok: false, erro: 'Esse pedido não é para você.' } };
    if (m.donoPor && m.donoPor !== agenteSlug) return { status: 409, corpo: { ok: false, erro: `O ${m.donoNome || m.donoPor} já pegou esse pedido. Não faça nada.`, donoPor: m.donoPor } };
    if (m.estado === 'feito') return { status: 409, corpo: { ok: false, erro: 'Esse pedido já foi feito.' } };
    const ag = registro.obter(agenteSlug);
    atualiza(slug, id, { donoPor: agenteSlug, donoNome: ag ? ag.nome : agenteSlug, estado: 'fazendo', epPegou: agora() / 1000 });
    return { status: 200, corpo: { ok: true, id, texto: m.texto, mensagem: 'O pedido é seu. Faça e entregue com /entregar.' } };
  }
  function entregarPedido(agenteSlug, id, { resposta }) {
    const p = achaPedido(id);
    if (!p) return { status: 404, corpo: { ok: false, erro: 'Não existe esse pedido.' } };
    const { slug, m } = p;
    if (m.donoPor !== agenteSlug) return { status: 403, corpo: { ok: false, erro: 'Só quem pegou o pedido entrega.' } };
    const r = String(resposta || '').trim();
    if (!r) return { status: 400, corpo: { ok: false, erro: 'Mande a resposta em "resposta".' } };
    atualiza(slug, id, { estado: 'feito', resposta: r.slice(0, LIMITE_RESPOSTA), epResposta: agora() / 1000 });
    return { status: 200, corpo: { ok: true } };
  }

  /** Retoma as esperas que estavam no meio quando o Web reiniciou. */
  function retoma() {
    let nomes = [];
    try { nomes = fs.readdirSync(pasta).filter((n) => n.endsWith('.json')); } catch (_) { return; }
    for (const n of nomes) {
      const slug = n.slice(0, -5);
      for (const m of ler(slug).itens) if (!m.tipo && m.estado === 'perguntando') espera(slug, m.id).catch(() => {});
      for (const m of ler(slug).itens) if (m.tipo === 'pedido' && m.estado === 'aberto') {
        const falta = SEM_DONO_MS - (agora() - m.ep * 1000);
        if (falta <= 0) atualiza(slug, m.id, { estado: 'sem_dono', motivo: 'ninguém pegou em 20 minutos' });
        else setTimeout(() => { const x = ler(slug).itens.find((y) => y.id === m.id); if (x && x.estado === 'aberto') atualiza(slug, m.id, { estado: 'sem_dono', motivo: 'ninguém pegou em 20 minutos' }); }, falta).unref?.();
      }
    }
  }

  return { criar, junta, retoma, ler, registrarAviso, pedir, pegar, entregarPedido };
}

module.exports = { criarMencoes };
