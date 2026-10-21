'use strict';
// lib/historico.js: a busca e as memórias rodam na caixa do agente, só para o dono, só leitura.
const test = require('node:test');
const assert = require('node:assert');
const { criarHistorico, listaMemorias, grupoDe, sugestoesValidas } = require('../lib/historico');

function resposta() {
  const r = { status: 0, corpo: null };
  r.writeHead = (st) => { r.status = st; };
  r.end = (txt) => { r.corpo = JSON.parse(txt); };
  return r;
}
const registro = { estado: () => ({ ok: true, agentes: [{ slug: 'admin', tipo: 'admin' }, { slug: 'ana', tipo: 'agente', container: 'dgclaw-ana' }] }) };
const dono = { usuario: 'dono' };

function comRoda(respostas) {
  const chamadas = [];
  const roda = async (cmd, args) => {
    chamadas.push(args);
    const r = respostas.find((x) => args.includes(x.quando));
    return r ? { ok: true, saida: r.saida, erro: '', ...r.extra } : { ok: true, saida: '', erro: '' };
  };
  return { roda, chamadas };
}

test('grupos dos arquivos de memória', () => {
  assert.strictEqual(grupoDe('working-memory.md'), 'Em andamento');
  assert.strictEqual(grupoDe('MEMORY.md'), 'Regras e fatos');
  assert.strictEqual(grupoDe('memory/skills-aprendidas.md'), 'Skills aprendidas');
  assert.strictEqual(grupoDe('memory/2026-10-17.md'), 'Diário');
  assert.strictEqual(grupoDe('memory/relationships.json'), 'Outras anotações');
});

test('a lista ignora o que está fora da casa ou fora do padrão', () => {
  const l = listaMemorias([
    '/home/agente/memory/2026-10-17.md\t10\t1760000000.5',
    '/home/agente/MEMORY.md\t20\t1760000001',
    '/etc/passwd\t1\t1',
    '/home/agente/memory/../CLAUDE.md\t1\t1',
    '/home/agente/memory/x.sh\t1\t1',
  ].join('\n'));
  assert.deepStrictEqual(l.map((x) => x.arquivo), ['MEMORY.md', 'memory/2026-10-17.md']);
});

test('a caixa de um agente não abre o histórico', async () => {
  const h = criarHistorico({ registro, log: () => {}, roda: comRoda([]).roda });
  const res = resposta();
  assert.strictEqual(await h.tratar({ method: 'GET' }, res, new URL('http://x/api/v1/historico/ana'), { via: 'caixa', agente: 'ana' }), true);
  assert.strictEqual(res.status, 403);
});

test('a busca roda como o agente, dentro da caixa dele, com os argumentos separados', async () => {
  const { roda, chamadas } = comRoda([{ quando: 'buscar', saida: JSON.stringify({ aviso: '', resultados: [{ tipo: 'conversa', quando: '18/10', ts: '2026-10-18T03:46:41', dia: '2026-10-18', canal: 'painel', papel: 'dono', ref: '', trecho: 'o «benchmark»' }] }) }]);
  const h = criarHistorico({ registro, log: () => {}, roda });
  const res = resposta();
  await h.tratar({ method: 'GET' }, res, new URL('http://x/api/v1/historico/ana/busca?q=benchmark%3B%20rm&so=conversas'), dono);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.corpo.resultados[0].trecho, 'o «benchmark»');
  const busca = chamadas.find((a) => a.includes('buscar'));
  assert.deepStrictEqual(busca.slice(0, 6), ['exec', '-u', 'agente', '-w', '/home/agente', 'dgclaw-ana']);
  assert.ok(busca.includes('benchmark; rm'));
  assert.deepStrictEqual(busca.slice(-2), ['--so', 'conversas']);
  assert.ok(chamadas.some((a) => a.includes('reindex')));
});

test('busca vazia, filtro estranho e data errada são recusados', async () => {
  const h = criarHistorico({ registro, log: () => {}, roda: comRoda([]).roda });
  for (const q of ['busca?q=a', 'busca?q=ok&so=tudo', 'busca?q=ok&desde=ontem']) {
    const res = resposta();
    await h.tratar({ method: 'GET' }, res, new URL('http://x/api/v1/historico/ana/' + q), dono);
    assert.strictEqual(res.status, 400, q);
  }
});

test('só abre arquivo que está na lista de memórias', async () => {
  const lista = '/home/agente/MEMORY.md\t20\t1760000001\n';
  const { roda, chamadas } = comRoda([{ quando: '-printf', saida: lista }, { quando: 'head', saida: '# Memória' }]);
  const h = criarHistorico({ registro, log: () => {}, roda });
  let res = resposta();
  await h.tratar({ method: 'GET' }, res, new URL('http://x/api/v1/historico/ana/memoria?arquivo=MEMORY.md'), dono);
  assert.strictEqual(res.corpo.texto, '# Memória');
  for (const arq of ['CLAUDE.md', 'memory/../CLAUDE.md', 'memory/2026-01-01.md']) {
    res = resposta();
    await h.tratar({ method: 'GET' }, res, new URL('http://x/api/v1/historico/ana/memoria?arquivo=' + encodeURIComponent(arq)), dono);
    assert.ok(res.status === 400 || res.status === 404, arq);
  }
  assert.strictEqual(chamadas.filter((a) => a.includes('head')).length, 1);
});

test('o Admin só tem as conversas arquivadas e o histórico não muda nada', async () => {
  const { roda, chamadas } = comRoda([]);
  const h = criarHistorico({ registro, log: () => {}, roda });
  let res = resposta();
  await h.tratar({ method: 'GET' }, res, new URL('http://x/api/v1/historico/admin'), dono);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.corpo.so_arquivadas, true);
  for (const rota of ['busca?q=teste', 'memorias', 'sugestoes']) {
    res = resposta();
    await h.tratar({ method: 'GET' }, res, new URL('http://x/api/v1/historico/admin/' + rota), dono);
    assert.strictEqual(res.status, 404, rota);
  }
  res = resposta();
  await h.tratar({ method: 'GET' }, res, new URL('http://x/api/v1/historico/admin/arquivadas'), dono);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(chamadas.length, 0);
  res = resposta();
  await h.tratar({ method: 'POST' }, res, new URL('http://x/api/v1/historico/ana/busca'), dono);
  assert.strictEqual(res.status, 405);
});

test('sugestões do agente: só texto curto, até 4, sem repetição, tipo conhecido', () => {
  const l = sugestoesValidas(JSON.stringify({ sugestoes: [
    { texto: 'Qual curso EAD tem a maior evasão?', tipo: 'objetivo' },
    { texto: 'Qual curso EAD tem a maior evasão?', tipo: 'insight' },
    { texto: '<img src=x onerror=alert(1)>', tipo: 'continuar' },
    { texto: 'ok' }, 'Retome a correção do DB_Evasão', { texto: 'x'.repeat(200) },
    { texto: 'Compare 2024 com 2023', tipo: 'qualquer' }, { texto: 'Quinta sugestão aqui' }, { texto: 'Sexta sugestão aqui' },
  ] }));
  assert.deepStrictEqual(l.map((x) => x.tipo), ['objetivo', 'continuar', '', '']);
  assert.ok(!l.some((x) => /[<>]/.test(x.texto)));
  assert.strictEqual(l.length, 4);
  assert.deepStrictEqual(sugestoesValidas('não é json'), []);
});
