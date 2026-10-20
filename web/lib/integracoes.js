'use strict';
// Integrações: tudo o que liga cada agente ao mundo, num lugar só (18/10/2026).
//
//   GET    /api/v1/integracoes                         resumo de todos (cacheado; ?recarregar=1 refaz)
//   POST   /api/v1/integracoes/<slug>/conectores       {nome, endereco}: adiciona um conector MCP (HTTP)
//   DELETE /api/v1/integracoes/<slug>/conectores/<nome> remove um conector adicionado à mão
//   POST   /api/v1/integracoes/<slug>/plugins          {id, ligado}: liga ou desliga um plugin
//   POST   /api/v1/integracoes/<slug>/reiniciar        reinicia o agente (conector e plugin só valem depois)
//
// De onde vem cada coisa (tudo lido no host):
//   conectores  `claude mcp list` rodado como o próprio agente, dentro da caixa dele (é o que o agente
//               enxerga de verdade: conta do Claude, plugins e os adicionados à mão). O do Admin roda
//               aqui no host, com o mesmo ambiente do serviço dele.
//   plugins     <casa>/.claude/plugins/installed_plugins.json e enabledPlugins do settings.json
//   skills      <casa>/.claude/skills/*/SKILL.md (a descrição do cabeçalho)
//   chaves      os NOMES do cofre.env do agente; da plataforma, os nomes do web.env. Valor nunca sai daqui.
//   canais      <casa>/.dgclaw/telegram/.env e <casa>/.dgclaw/whatsapp/estado.json
//
// Só o dono, pela sessão do navegador: a caixa dos agentes não alcança estas rotas (nenhuma
// caixa.permitir), e mesmo assim a sessão "via caixa" é recusada aqui. Nada passa por shell: cada
// comando é execFile com argumentos separados, e nome e endereço são conferidos antes.

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CACHE_MS = 90 * 1000;
const RX_NOME = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const RX_PLUGIN = /^[A-Za-z0-9._-]{1,80}@[A-Za-z0-9._-]{1,80}$/;
const WEB_ENV = '/etc/dgclaw/web.env';

// Chaves da plataforma que valem mostrar, com o que cada uma liga.
const CHAVES_PLATAFORMA = {
  GROQ_API_KEY: 'microfone (transcrição pela Groq)',
  OPENAI_API_KEY: 'microfone e modo escondido (OpenAI)',
  ELEVENLABS_API_KEY: 'microfone e voz (ElevenLabs)',
  ANTHROPIC_API_KEY: 'modo escondido completo (Claude Haiku)',
};

function roda(cmd, args, opcoes) {
  return new Promise((ok) => {
    execFile(cmd, args, { timeout: 90000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, ...opcoes }, (err, stdout, stderr) => {
      ok({ ok: !err, codigo: err && err.code, saida: String(stdout || ''), erro: String(stderr || (err && err.message) || '') });
    });
  });
}

/** Linha do `claude mcp list` -> { nome, endereco, origem, estado, detalhe }. */
function linhaMcp(linha) {
  const m = /^(.+?): (.*?) - (.+)$/.exec(linha.trim());
  if (!m) return null;
  const [, nomeBruto, endBruto, estBruto] = m;
  const estado = /Connected/.test(estBruto) ? 'conectado'
    : /Needs authentication/i.test(estBruto) ? 'precisa_entrar'
    : /Not configured/i.test(estBruto) ? 'nao_configurado'
    : /Failed|✘/.test(estBruto) ? 'falha'
    : /Pending approval/i.test(estBruto) ? 'pendente' : 'desconhecido';
  let nome = nomeBruto, origem = 'manual', plugin = '';
  if (nome.startsWith('claude.ai ')) { origem = 'conta'; nome = nome.slice(10); }
  else if (nome.startsWith('plugin:')) { const p = nome.split(':'); origem = 'plugin'; plugin = p[1] || ''; nome = p.slice(2).join(':') || p[1]; }
  const endereco = endBruto.replace(/\s*\((HTTP|SSE|stdio)\)\s*$/i, '').trim();
  const tipo = /^https?:\/\//.test(endereco) ? 'http' : (endereco ? 'comando' : '');
  return { nome, origem, plugin, endereco: tipo === 'comando' ? '' : endereco, tipo, estado, detalhe: estBruto.replace(/^[✔✘!-]\s*/, '').slice(0, 160) };
}

function lerJson(arq) { try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch (_) { return null; } }

function descricaoSkill(arq) {
  let t = '';
  try { t = fs.readFileSync(arq, 'utf8').slice(0, 4000); } catch (_) { return ''; }
  const m = /^---[\s\S]*?\ndescription:\s*(.+)\n[\s\S]*?---/m.exec(t);
  if (!m) return '';
  // primeira frase, sem o "Usada quando..." que é instrução para o agente
  return m[1].trim().replace(/^["']|["']$/g, '').split(/(?<=\.)\s/)[0].slice(0, 220);
}

function nomesDeEnv(arq) {
  let t = '';
  try { t = fs.readFileSync(arq, 'utf8'); } catch (_) { return []; }
  const nomes = [];
  for (const l of t.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l);
    if (m && m[2].trim() !== '' && m[2].trim() !== "''" && m[2].trim() !== '""') nomes.push(m[1]);
  }
  return nomes;
}

function criarIntegracoes({ registro, log }) {
  const cache = new Map();   // slug -> { quando, dados }

  const casa = (a) => a.home_host || '';
  const ehAdmin = (a) => a.tipo === 'admin';
  const dirClaude = (a) => (ehAdmin(a) ? '/root/.claude' : path.join(casa(a), '.claude'));

  /* As chaves do cofre do agente, para conferir os conectores como o agente de verdade os vê. Conector que
     usa ${CHAVE} no cabeçalho (ex.: ploi, Authorization: Bearer ${PLOI_API_TOKEN}) falhava aqui com 401 e
     aparecia como "precisa de login", porque o `podman exec` não carrega o cofre (20/10/2026). Os VALORES
     vão só no ambiente do processo do podman; na linha de comando entram só os NOMES (`-e NOME`). */
  function cofreDe(a) {
    const vals = {};
    if (!a.cofre_arquivo) return vals;
    let t = '';
    try { t = fs.readFileSync(a.cofre_arquivo, 'utf8'); } catch (_) { return vals; }
    for (const l of t.split('\n')) {
      const m = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/.exec(l);
      if (m) vals[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
    return vals;
  }
  async function conectores(a) {
    const cofre = ehAdmin(a) ? {} : cofreDe(a);
    const r = ehAdmin(a)
      ? await roda('claude', ['mcp', 'list'], { cwd: casa(a) || '/opt/dgclaw/admin', env: { ...process.env, HOME: '/root', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' } })
      : await roda('podman', ['exec', '-u', 'agente', '-w', a.home_container || '/home/agente', ...Object.keys(cofre).flatMap((n) => ['-e', n]),
          a.container || `dgclaw-${a.slug}`, 'claude', 'mcp', 'list'], { env: { ...process.env, ...cofre } });
    if (!r.ok && !r.saida) return { erro: `não consegui listar os conectores de ${a.nome} (${(r.erro || 'sem resposta').replace(/\s+/g, ' ').slice(0, 160)})`, itens: [] };
    return { itens: r.saida.split('\n').map(linhaMcp).filter(Boolean) };
  }

  function plugins(a) {
    const inst = lerJson(path.join(dirClaude(a), 'plugins', 'installed_plugins.json')) || {};
    const conf = lerJson(path.join(dirClaude(a), 'settings.json')) || {};
    const ligados = conf.enabledPlugins || {};
    return Object.entries(inst.plugins || {}).map(([id, v]) => ({
      id, nome: id.split('@')[0], loja: id.split('@')[1] || '',
      versao: Array.isArray(v) && v[0] ? v[0].version || '' : '',
      ligado: ligados[id] === true,
    }));
  }

  function skills(a) {
    const dir = ehAdmin(a) ? path.join(casa(a), '.claude', 'skills') : path.join(dirClaude(a), 'skills');
    let nomes = [];
    try { nomes = fs.readdirSync(dir).filter((n) => !n.startsWith('.')).sort(); } catch (_) { return []; }
    return nomes.map((n) => {
      let arq = path.join(dir, n, 'SKILL.md');
      // link para a imagem (/opt/dgclaw/app/skills/...): o mesmo caminho existe no host
      try { const alvo = fs.readlinkSync(path.join(dir, n)); if (path.isAbsolute(alvo)) arq = path.join(alvo, 'SKILL.md'); } catch (_) { /* pasta comum */ }
      return { nome: n, descricao: descricaoSkill(arq) };
    }).filter((s) => s.descricao || fs.existsSync(path.join(dir, s.nome)));
  }

  function canais(a) {
    if (ehAdmin(a)) return [];
    const tg = nomesDeEnv(path.join(casa(a), '.dgclaw', 'telegram', '.env')).includes('TELEGRAM_BOT_TOKEN');
    const est = lerJson(path.join(casa(a), '.dgclaw', 'whatsapp', 'estado.json'));
    const wa = est ? String(est.estado || est.status || (est.conectado ? 'conectado' : 'pareado')) : '';
    return [
      { nome: 'Telegram', estado: tg ? 'configurado' : 'desligado' },
      { nome: 'WhatsApp', estado: wa || 'desligado' },
    ];
  }

  async function resumoAgente(a, recarregar) {
    const c = cache.get(a.slug);
    if (c && !recarregar && Date.now() - c.quando < CACHE_MS) return c.dados;
    const mcp = await conectores(a);
    const dados = {
      slug: a.slug, nome: a.nome, tipo: a.tipo, cor: a.cor || '', avatar: a.avatar || '',
      somente_leitura: ehAdmin(a),
      conectores: mcp.itens, erro_conectores: mcp.erro || null,
      plugins: plugins(a), skills: skills(a),
      chaves: a.cofre_arquivo ? nomesDeEnv(a.cofre_arquivo) : [],
      tem_cofre: !!a.cofre_arquivo,
      canais: canais(a),
      lido_em: new Date().toISOString(),
    };
    cache.set(a.slug, { quando: Date.now(), dados });
    return dados;
  }

  function plataforma() {
    const nomes = nomesDeEnv(WEB_ENV);
    return { chaves: Object.keys(CHAVES_PLATAFORMA).map((n) => ({ nome: n, para: CHAVES_PLATAFORMA[n], ligada: nomes.includes(n) })) };
  }

  const json = (res, status, corpo) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(corpo)); };
  const erro = (res, status, motivo) => json(res, status, { ok: false, erro: motivo });
  function lerCorpo(req) {
    return new Promise((ok, falha) => {
      let t = ''; req.setEncoding('utf8');
      req.on('data', (d) => { t += d; if (t.length > 8192) { falha(new Error('pedido grande demais')); req.destroy(); } });
      req.on('end', () => { try { ok(t ? JSON.parse(t) : {}); } catch (_) { falha(new Error('o corpo não é JSON válido')); } });
      req.on('error', falha);
    });
  }

  function agenteDe(slug) {
    const est = registro.estado();
    if (!est.ok) return { erro: est.erro };
    const a = est.agentes.find((x) => x.slug === slug);
    return a ? { a } : { erro: `Não existe agente "${String(slug).slice(0, 40)}".` };
  }
  const execNaCaixa = (a, args) => roda('podman', ['exec', '-u', 'agente', '-w', a.home_container || '/home/agente', a.container || `dgclaw-${a.slug}`, ...args]);

  async function tratar(req, res, url, sessao) {
    const p = url.pathname, m = req.method;
    if (p !== '/api/v1/integracoes' && !p.startsWith('/api/v1/integracoes/')) return false;
    if (!sessao || sessao.via === 'caixa') { erro(res, 403, 'As integrações só são vistas e mudadas pelo dono, no navegador.'); return true; }

    if (p === '/api/v1/integracoes' && m === 'GET') {
      const est = registro.estado();
      if (!est.ok) { erro(res, 503, est.erro); return true; }
      const recarregar = url.searchParams.get('recarregar') === '1';
      const agentes = await Promise.all(est.agentes.map((a) => resumoAgente(a, recarregar)));
      json(res, 200, { ok: true, plataforma: plataforma(), agentes });
      return true;
    }

    const mm = /^\/api\/v1\/integracoes\/([^/]+)\/(conectores|plugins|reiniciar)(?:\/([^/]+))?$/.exec(p);
    if (!mm) { erro(res, 404, 'Rota de integrações desconhecida.'); return true; }
    const { a, erro: e } = agenteDe(decodeURIComponent(mm[1]));
    if (!a) { erro(res, 404, e); return true; }
    if (a.tipo === 'admin') { erro(res, 403, 'As integrações do Admin não são mudadas por esta tela: peça ao Admin no chat.'); return true; }

    if (mm[2] === 'conectores' && m === 'POST' && !mm[3]) {
      let c; try { c = await lerCorpo(req); } catch (x) { erro(res, 400, x.message); return true; }
      const nome = String(c.nome || '').trim().toLowerCase();
      const endereco = String(c.endereco || '').trim();
      if (!RX_NOME.test(nome)) { erro(res, 400, 'Nome inválido: use só letras minúsculas, números, hífen e sublinhado (até 40), começando por letra ou número.'); return true; }
      let u; try { u = new URL(endereco); } catch (_) { u = null; }
      if (!u || u.protocol !== 'https:' || u.username || u.password) { erro(res, 400, 'Endereço inválido: use um endereço https:// completo, sem usuário ou senha nele.'); return true; }
      const r = await execNaCaixa(a, ['claude', 'mcp', 'add', '-s', 'user', '--transport', 'http', nome, u.href]);
      cache.delete(a.slug);
      if (!r.ok) { erro(res, 422, `Não consegui adicionar: ${(r.erro || r.saida).replace(/\s+/g, ' ').slice(0, 200)}`); return true; }
      log('info', `Integrações: conector ${nome} (${u.host}) adicionado em ${a.slug}.`);
      json(res, 200, { ok: true, mensagem: `Conector ${nome} adicionado. Ele passa a valer quando ${a.nome} reiniciar.` });
      return true;
    }
    if (mm[2] === 'conectores' && m === 'DELETE' && mm[3]) {
      const nome = decodeURIComponent(mm[3]);
      if (!RX_NOME.test(nome)) { erro(res, 400, 'Nome de conector inválido.'); return true; }
      const r = await execNaCaixa(a, ['claude', 'mcp', 'remove', '-s', 'user', nome]);
      cache.delete(a.slug);
      if (!r.ok) { erro(res, 422, `Não consegui remover (só os adicionados à mão saem por aqui): ${(r.erro || r.saida).replace(/\s+/g, ' ').slice(0, 200)}`); return true; }
      log('info', `Integrações: conector ${nome} removido de ${a.slug}.`);
      json(res, 200, { ok: true, mensagem: `Conector ${nome} removido. Vale quando ${a.nome} reiniciar.` });
      return true;
    }
    if (mm[2] === 'plugins' && m === 'POST' && !mm[3]) {
      let c; try { c = await lerCorpo(req); } catch (x) { erro(res, 400, x.message); return true; }
      const id = String(c.id || '');
      if (!RX_PLUGIN.test(id) || typeof c.ligado !== 'boolean') { erro(res, 400, 'Plugin inválido: mande {id: "nome@loja", ligado: true|false}.'); return true; }
      if (!plugins(a).some((x) => x.id === id)) { erro(res, 404, `O plugin ${id} não está instalado em ${a.nome}.`); return true; }
      const arq = path.join(dirClaude(a), 'settings.json');
      let st, conf;
      try { st = fs.statSync(arq); conf = JSON.parse(fs.readFileSync(arq, 'utf8')); } catch (x) { erro(res, 500, `Não consegui ler as configurações de ${a.nome}: ${x.code || x.message}`); return true; }
      conf.enabledPlugins = { ...(conf.enabledPlugins || {}), [id]: c.ligado };
      const tmp = `${arq}.tmp-${process.pid}`;
      try {
        fs.writeFileSync(tmp, JSON.stringify(conf, null, 2) + '\n', { mode: st.mode & 0o777 });
        fs.chownSync(tmp, st.uid, st.gid);
        fs.renameSync(tmp, arq);
      } catch (x) { try { fs.unlinkSync(tmp); } catch (_) { /* já foi */ } erro(res, 500, `Não consegui gravar: ${x.code || x.message}`); return true; }
      cache.delete(a.slug);
      log('info', `Integrações: plugin ${id} ${c.ligado ? 'ligado' : 'desligado'} em ${a.slug}.`);
      json(res, 200, { ok: true, mensagem: `Plugin ${id.split('@')[0]} ${c.ligado ? 'ligado' : 'desligado'}. Vale quando ${a.nome} reiniciar.` });
      return true;
    }
    if (mm[2] === 'reiniciar' && m === 'POST' && !mm[3]) {
      const r = await roda('podman', ['exec', a.container || `dgclaw-${a.slug}`, 'systemctl', 'restart', 'dgclaw-runner'], { timeout: 60000 });
      cache.delete(a.slug);
      if (!r.ok) { erro(res, 500, `Não consegui reiniciar ${a.nome}: ${r.erro.replace(/\s+/g, ' ').slice(0, 200)}`); return true; }
      log('info', `Integrações: ${a.slug} reiniciado pela tela.`);
      json(res, 200, { ok: true, mensagem: `${a.nome} reiniciado. As mudanças já valem.` });
      return true;
    }
    erro(res, 405, 'Método inválido para esta rota de integrações.');
    return true;
  }

  return { tratar, linhaMcp };
}

module.exports = { criarIntegracoes, linhaMcp };
