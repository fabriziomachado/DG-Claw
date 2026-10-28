'use strict';
// lib/github-app.js: o GitHub como app de cada agente (chave no servidor, senha de 1 h na caixa).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { criarGithubApp, jwtDoApp } = require('../lib/github-app');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' });

function cenario() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-app-'));
  const casa = path.join(raiz, 'casa');
  fs.mkdirSync(path.join(casa, '.dgclaw'), { recursive: true, mode: 0o700 });
  fs.chmodSync(raiz, 0o755);
  if (process.getuid && process.getuid() === 0) { fs.chownSync(casa, 4242, 4242); fs.chownSync(path.join(casa, '.dgclaw'), 4242, 4242); }
  const registro = { estado: () => ({ ok: true, agentes: [
    { slug: 'admin', nome: 'Admin', tipo: 'admin', home_host: '/root' },
    { slug: 'tech', nome: 'Tech', tipo: 'agente', home_host: casa, home_container: '/home/agente', container: 'dgclaw-tech' },
  ] }) };
  const chamadas = [];
  const comandos = [];
  // GitHub de mentira: duas instalações, uma do dono (aceita pelo fluxo) e uma de um estranho.
  const instalacoes = [
    { id: 11, account: { login: 'Unesc-PMP', type: 'Organization' }, repository_selection: 'selected', created_at: '2026-10-28T12:00:00Z' },
    { id: 99, account: { login: 'estranho', type: 'User' }, repository_selection: 'all', created_at: '2026-10-28T12:00:00Z' },
  ];
  const buscar = async (u, o) => {
    chamadas.push({ u, metodo: o.method, auth: o.headers.Authorization || '' });
    const ok = (corpo) => ({ ok: true, status: 200, text: async () => JSON.stringify(corpo) });
    if (u.endsWith('/app-manifests/codigo123/conversions')) return ok({ id: 7, slug: 's2-bot-tech', name: 'S2-bot (tech)', html_url: 'https://github.com/apps/s2-bot-tech', owner: { login: 'fabriziomachado' }, client_id: 'Iv1', pem: PEM });
    if (u.includes('/users/')) return ok({ id: 555 });
    if (u.endsWith('/app/installations?per_page=100')) return ok(instalacoes);
    if (/\/app\/installations\/\d+$/.test(u)) return ok({ id: 11 });
    if (/access_tokens$/.test(u)) return ok({ token: 'ghs_' + u.split('/').slice(-2)[0], expires_at: '2026-10-28T13:00:00Z' });
    if (u.includes('/installation/repositories')) return ok({ repositories: [{ name: 'portal-academico' }, { name: 'infra' }] });
    return { ok: false, status: 404, text: async () => '{"message":"Not Found"}' };
  };
  const rodar = async (cmd, args) => { comandos.push([cmd, ...args].join(' ')); return { ok: true, saida: '', erro: '' }; };
  const gh = criarGithubApp({ dataDir: path.join(raiz, 'dados'), registro, log: () => {}, buscar, rodar });
  return { raiz, casa, gh, chamadas, comandos, instalacoes };
}

function resposta() {
  const r = { status: 0, cab: {}, corpo: '' };
  r.writeHead = (st, cab) => { r.status = st; r.cab = cab || {}; };
  r.end = (t) => { r.corpo = t || ''; };
  return r;
}
const dono = { usuario: 'dono' };
async function pagina(gh, rota, sessao) {
  const res = resposta();
  const tratou = await gh.tratarPagina({ method: 'GET' }, res, new URL('https://painel.exemplo' + rota), sessao === undefined ? dono : sessao, 'http://painel.exemplo');
  return { tratou, ...res };
}
const stateDe = (loc) => new URL(loc).searchParams.get('state');

test('Conectar sem app entrega o manifesto ao GitHub com o nome do agente', async () => {
  const { gh } = cenario();
  const r = await pagina(gh, '/github/tech/conectar');
  assert.strictEqual(r.status, 200);
  assert.match(r.corpo, /action="https:\/\/github\.com\/settings\/apps\/new\?state=[0-9a-f]{32}"/);
  const manifesto = JSON.parse(/name="manifest" value="([^"]+)"/.exec(r.corpo)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  assert.strictEqual(manifesto.name, 'S2-bot (tech)');
  assert.strictEqual(manifesto.public, true);
  assert.strictEqual(manifesto.redirect_url, 'https://painel.exemplo/github/tech/criado');
  assert.strictEqual(manifesto.setup_url, 'https://painel.exemplo/github/tech/instalado');
  assert.deepStrictEqual(manifesto.default_permissions, { contents: 'write', pull_requests: 'write', issues: 'write', metadata: 'read' });
  assert.match(r.cab['Content-Security-Policy'], /form-action https:\/\/github\.com/);
});

test('a caixa de um agente e o Admin não conectam GitHub', async () => {
  const { gh } = cenario();
  assert.strictEqual((await pagina(gh, '/github/tech/conectar', { via: 'caixa', agente: 'tech' })).status, 403);
  assert.strictEqual((await pagina(gh, '/github/admin/conectar')).status, 404);
  const res = resposta();
  await gh.tratarApi({ method: 'GET' }, res, new URL('https://x/api/v1/github'), { via: 'caixa', agente: 'tech' });
  assert.strictEqual(res.status, 403);
});

test('volta do Create sem o state daqui é recusada', async () => {
  const { gh, chamadas } = cenario();
  const r = await pagina(gh, '/github/tech/criado?code=codigo123&state=' + 'a'.repeat(32));
  assert.strictEqual(r.status, 400);
  assert.strictEqual(chamadas.length, 0);
});

test('fluxo inteiro: cria o app, instala, e a caixa recebe só a senha de 1 h', async () => {
  const { gh, raiz, casa, comandos, chamadas } = cenario();
  const c = await pagina(gh, '/github/tech/conectar');
  const state = /state=([0-9a-f]{32})/.exec(c.corpo)[1];
  const criado = await pagina(gh, `/github/tech/criado?code=codigo123&state=${state}`);
  assert.strictEqual(criado.status, 302);
  assert.match(criado.cab.Location, /^https:\/\/github\.com\/apps\/s2-bot-tech\/installations\/new\?state=[0-9a-f]{32}$/);
  const pem = path.join(raiz, 'dados', 'github', 'tech.pem');
  assert.strictEqual(fs.statSync(pem).mode & 0o777, 0o600);

  const inst = await pagina(gh, `/github/tech/instalado?installation_id=11&setup_action=install&state=${stateDe(criado.cab.Location)}`);
  assert.strictEqual(inst.cab.Location, '/integracoes?a=tech&github=ok');

  const tokens = JSON.parse(fs.readFileSync(path.join(casa, '.dgclaw', 'github', 'tokens.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(tokens.contas), ['unesc-pmp']);   // o estranho ficou de fora
  assert.strictEqual(tokens.contas['unesc-pmp'].token, 'ghs_11');
  assert.strictEqual(tokens.padrao, 'unesc-pmp');
  const naCaixa = fs.readdirSync(path.join(casa, '.dgclaw', 'github')).join(' ');
  assert.doesNotMatch(naCaixa, /pem/);
  assert.doesNotMatch(fs.readFileSync(path.join(casa, '.dgclaw', 'github', 'tokens.json'), 'utf8'), /PRIVATE KEY/);
  assert.ok(!chamadas.some((x) => /installations\/99\/access_tokens/.test(x.u)), 'não pede senha para instalação de estranho');
  assert.ok(comandos.some((x) => x.includes('mcp add-json -s user github-unesc-pmp') && x.includes('cabecalho.py unesc-pmp')));
  assert.ok(comandos.some((x) => x.includes('credential.https://github.com.helper')));
  assert.ok(comandos.some((x) => x.includes('user.email 555+s2-bot-tech[bot]@users.noreply.github.com')));

  const res = resposta();
  await gh.tratarApi({ method: 'GET' }, res, new URL('https://x/api/v1/github'), dono);
  const r = JSON.parse(res.corpo).agentes.tech;
  assert.strictEqual(r.bot, 's2-bot-tech[bot]');
  assert.deepStrictEqual(r.instalacoes[0].repos, ['infra', 'portal-academico']);
  assert.strictEqual(r.instalacoes[0].ajustar, 'https://github.com/organizations/Unesc-PMP/settings/installations/11');
  assert.strictEqual(r.reiniciar, true);
  assert.doesNotMatch(res.corpo, /ghs_|PRIVATE/);

  // renovar de novo não religa o conector que já existe
  const antes = comandos.length;
  await gh.renovar('tech');
  assert.strictEqual(comandos.length, antes);
});

test('pedido para a organização: a instalação aprovada depois é aceita uma vez', async () => {
  const { gh, casa, instalacoes } = cenario();
  const c = await pagina(gh, '/github/tech/conectar');
  const criado = await pagina(gh, `/github/tech/criado?code=codigo123&state=${/state=([0-9a-f]{32})/.exec(c.corpo)[1]}`);
  instalacoes.length = 0;
  const pedido = await pagina(gh, '/github/tech/instalado?setup_action=request&state=' + stateDe(criado.cab.Location));
  assert.strictEqual(pedido.cab.Location, '/integracoes?a=tech&github=pedido');
  instalacoes.push({ id: 12, account: { login: 'Unesc-PMP', type: 'Organization' }, repository_selection: 'all', created_at: new Date(Date.now() + 1000).toISOString() });
  await gh.renovar('tech');
  const tokens = JSON.parse(fs.readFileSync(path.join(casa, '.dgclaw', 'github', 'tokens.json'), 'utf8'));
  assert.strictEqual(tokens.contas['unesc-pmp'].token, 'ghs_12');
  assert.strictEqual(gh.resumo('tech').pedido_pendente, false);
});

test('o JWT do app é RS256 e vale para a chave pública', () => {
  const j = jwtDoApp(7, PEM, 1000);
  const [c, p, a] = j.split('.');
  assert.deepStrictEqual(JSON.parse(Buffer.from(p, 'base64url')), { iat: 940, exp: 1540, iss: '7' });
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${c}.${p}`), publicKey, Buffer.from(a, 'base64url')));
});
