'use strict';
// dgui.js: o bloco ```dgui vira componentes (KPI, tabela, gráfico) com todo texto escapado.
const test = require('node:test');
const assert = require('node:assert');
const dgui = require('../public/dgui.js');

const bloco = (obj) => 'dgui\n' + JSON.stringify(obj);

test('bloco que não é dgui devolve null', () => {
  assert.strictEqual(dgui.blocoParaHtml('js\nconsole.log(1)'), null);
  assert.strictEqual(dgui.blocoParaHtml('dgcofre\nCHAVE'), null);
});

test('KPI mostra valor, variação e a cor certa para "baixa é bom"', () => {
  const h = dgui.blocoParaHtml(bloco({ tipo: 'kpi', titulo: 'Evasão', valor: '65,3%', variacao: '+4,1 p.p.', tendencia: 'alta', bom: 'baixa' }));
  assert.match(h, /dgui-kpi-valor">65,3%</);
  assert.match(h, /dgui-kpi-var ruim/);
  assert.match(h, /▲/);
});

test('tabela alinha números à direita e guarda o número para ordenar', () => {
  const h = dgui.blocoParaHtml(bloco({ tipo: 'tabela', colunas: ['Curso', 'Matrículas'], linhas: [['Direito', '2.762'], ['Psicologia', 1694]] }));
  assert.match(h, /data-num="2762"/);
  assert.match(h, /data-num="1694"/);
  assert.match(h, /<td style="text-align:right" data-num="2762">2\.762<\/td>/);
  assert.match(h, /data-dgui-ordena="1"/);
});

test('texto do agente sai escapado (nada de HTML ou script)', () => {
  const h = dgui.blocoParaHtml(bloco({ tipo: 'tabela', titulo: '<img src=x onerror=alert(1)>', colunas: ['<b>a</b>'], linhas: [['<script>x</script>']] }));
  assert.ok(!h.includes('<img'));
  assert.ok(!h.includes('<script>'));
  assert.ok(!h.includes('<b>a</b>'));
  assert.match(h, /&lt;script&gt;/);
});

test('gráficos de barras, colunas, linhas e pizza desenham', () => {
  const base = { tipo: 'grafico', titulo: 'Taxa', unidade: '%', categorias: ['A', 'B', 'C'], series: [{ nome: '2024', valores: [10, '20,5', 30] }] };
  assert.match(dgui.blocoParaHtml(bloco({ ...base, forma: 'barras' })), /dgui-barra dgui-c0/);
  assert.match(dgui.blocoParaHtml(bloco({ ...base, forma: 'colunas' })), /<rect class="dgui-c0"/);
  assert.match(dgui.blocoParaHtml(bloco({ ...base, forma: 'linhas' })), /<polyline class="dgui-linha dgui-c0"/);
  assert.match(dgui.blocoParaHtml(bloco({ ...base, forma: 'pizza' })), /<path class="dgui-c2"/);
});

test('painel agrupa KPIs seguidos numa fileira', () => {
  const h = dgui.blocoParaHtml(bloco({ tipo: 'painel', titulo: 'P', itens: [{ tipo: 'kpi', valor: '1' }, { tipo: 'kpi', valor: '2' }, { tipo: 'tabela', colunas: ['x'], linhas: [['y']] }] }));
  assert.strictEqual((h.match(/class="dgui-kpis"/g) || []).length, 1);
  assert.strictEqual((h.match(/class="dgui-kpi"/g) || []).length, 2);
});

test('JSON inválido vira aviso com o bloco cru escapado', () => {
  const h = dgui.blocoParaHtml('dgui\n{"tipo": "kpi", <x>');
  assert.match(h, /dgui-aviso/);
  assert.match(h, /&lt;x&gt;/);
});

test('números brasileiros', () => {
  assert.strictEqual(dgui.numero('2.762'), 2762);
  assert.strictEqual(dgui.numero('65,3%'), 65.3);
  assert.strictEqual(dgui.numero('R$ 1.234,50'), 1234.5);
  assert.strictEqual(dgui.numero('Direito'), null);
});

test('perguntas sugeridas viram botões e a fonte aparece no rodapé', () => {
  const h = dgui.blocoParaHtml(bloco({ tipo: 'painel', titulo: 'P', fonte: 'Power BI', atualizado: '22/07/2025',
    itens: [{ tipo: 'grafico', forma: 'barras', categorias: ['A'], series: [{ valores: [1] }] }],
    sugestoes: ['Interprete o gráfico', '<b>x</b>'] }));
  assert.strictEqual((h.match(/data-dgui-pergunta=/g) || []).length, 2);
  assert.ok(!h.includes('<b>x</b>'));
  assert.strictEqual((h.match(/class="dgui-fonte"/g) || []).length, 1);
  assert.match(h, /Power BI · atualizado em 22\/07\/2025/);
  assert.match(h, /data-dgui-acao="baixar"/);
});

test('CSV com ponto e vírgula, BOM e aspas quando precisa', () => {
  const csv = dgui.csvDe({ colunas: ['Curso', { nome: '%' }], linhas: [['Direito; noturno', '7,5%'], ['Psicologia "EAD"', 8]] });
  assert.ok(csv.startsWith('﻿Curso;%'));
  assert.match(csv, /"Direito; noturno";7,5%/);
  assert.match(csv, /"Psicologia ""EAD""";8/);
});

test('painel sem sugestões do agente ganha perguntas de análise padrão', () => {
  const h = dgui.blocoParaHtml(bloco({ tipo: 'painel', itens: [{ tipo: 'grafico', categorias: ['A'], series: [{ nome: '1', valores: [1] }, { nome: '2', valores: [2] }] }] }));
  assert.strictEqual((h.match(/data-dgui-pergunta=/g) || []).length, 4);
  assert.match(h, /Interprete este painel/);
  assert.match(h, /maiores variações/);
  assert.ok(!dgui.blocoParaHtml(bloco({ tipo: 'kpi', valor: '1' })).includes('data-dgui-pergunta'));
});

test('leitura mostra destaques e recolhe o detalhe, com texto escapado', () => {
  const h = dgui.blocoParaHtml(bloco({ tipo: 'leitura', destaques: [{ tipo: 'alerta', texto: 'EAD concentra <b>' }, 'Prioridade: 1º semestre'],
    detalhe: '**Diagnóstico:** alto.\n\n- um\n- dois\n<script>x</script>' }));
  assert.strictEqual((h.match(/<li><svg/g) || []).length, 2);
  assert.match(h, /<details class="dgui-leitura-det"><summary>Ver análise completa<\/summary>/);
  assert.match(h, /<b>Diagnóstico:<\/b>/);
  assert.ok(!h.includes('<script>'));
  assert.ok(!h.includes('concentra <b>'));
});

test('no painel, a leitura vira faixas fechadas no pé do cartão, antes dos Dados (19/10/2026)', () => {
  const h = dgui.blocoParaHtml(bloco({ tipo: 'painel', titulo: 'P', itens: [
    { tipo: 'grafico', formato: 'barras', categorias: ['a'], series: [{ nome: 's', valores: [1] }] },
    { tipo: 'tabela', colunas: ['a'], linhas: [['1']] },
    { tipo: 'leitura', destaques: ['x', 'y'], detalhe: 'texto longo' }] }));
  assert.ok(!h.includes('class="dgui-leitura"'), 'a leitura não fica como bloco solto');
  const leit = h.indexOf('Leitura do especialista'), anal = h.indexOf('Análise completa'), dados = h.indexOf('<b>Dados</b>');
  assert.ok(leit > 0 && anal > leit && dados > anal, 'ordem: leitura, análise completa, dados');
  assert.ok(h.includes('2 destaques'));
  assert.equal((h.match(/class="dgui-faixa-corpo" hidden/g) || []).length, 2, 'as duas faixas da leitura chegam fechadas');
  assert.ok(h.lastIndexOf('</div>') > dados, 'tudo dentro do cartão');
});

test('fora de um painel, a leitura continua um bloco aberto', () => {
  const h = dgui.blocoParaHtml(bloco({ tipo: 'leitura', destaques: ['x'] }));
  assert.ok(h.includes('class="dgui-leitura"'));
});

test('normaliza: painel em formato alternativo (componentes, kpi com itens, dados [{rotulo,valor}], leitura texto, sugestões) desenha sem erro', () => {
  const D = require('../public/dgui.js');
  const bloco = 'dgui\n' + JSON.stringify({ titulo: 'Portfólio', componentes: [
    { tipo: 'kpi', itens: [{ rotulo: 'Atrasados', valor: '10', detalhe: 'de 11' }, { rotulo: 'Sem prazo', valor: '17' }] },
    { tipo: 'grafico', formato: 'barras', titulo: 'Dias', dados: [{ rotulo: 'A', valor: 708 }, { rotulo: 'B', valor: 688 }] },
    { tipo: 'leitura', texto: 'Só um está em dia.' },
    { tipo: 'sugestoes', itens: ['Por que?', 'Quais sem prazo?'] },
  ] });
  const h = D.blocoParaHtml(bloco);
  assert.ok(!/Não consegui/.test(h), h.slice(0, 300));
  assert.equal((h.match(/class="dgui-kpi"/g) || []).length, 2);
  assert.ok(h.includes('Atrasados') && h.includes('de 11'));
  assert.ok(/dgui-grafico/.test(h) && h.includes('Só um está em dia.'));
  assert.ok(h.includes('Quais sem prazo?'));
  const certo = { tipo: 'kpi', titulo: 'X', valor: '1' };
  assert.deepEqual(D.normaliza(certo), certo, 'o formato certo passa igual');
});

test('interativo: pontos tocáveis e legenda clicável nos gráficos', () => {
  const D = require('../public/dgui.js');
  const g = (forma) => D.blocoParaHtml('dgui\n' + JSON.stringify({ tipo: 'grafico', forma, titulo: 'T', categorias: ['a', 'b'], series: [{ nome: 'S1', valores: [1, 2] }, { nome: 'S2', valores: [3, 4] }] }));
  for (const f of ['barras', 'colunas', 'linhas']) {
    const h = g(f);
    assert.equal((h.match(/data-dgui-ponto="1"/g) || []).length, 4, f);
    assert.equal((h.match(/data-dgui-serie="/g) || []).length, 2, f);
    assert.ok(!/ (cx|x)=""/.test(h), f + ': atributo quebrado');
  }
});

test('filtros no painel: desenha a variante padrão e avisa quando falta a combinação', () => {
  const D = require('../public/dgui.js');
  const kpi = (v) => [{ tipo: 'kpi', titulo: 'N', valor: v }];
  const h = D.blocoParaHtml('dgui\n' + JSON.stringify({ tipo: 'painel', titulo: 'P',
    filtros: [{ nome: 'Ano', opcoes: ['2024', '2025'], padrao: '2025' }], variantes: { 2024: kpi('7'), 2025: kpi('9') } }));
  assert.ok(h.includes('data-dgui-filtro') && h.includes('aria-pressed="true">2025<'));
  assert.ok(/dgui-kpi-valor">9</.test(h) && !/dgui-kpi-valor">7</.test(h));
  const falta = D.blocoParaHtml('dgui\n' + JSON.stringify({ tipo: 'painel', filtros: [{ nome: 'Ano', opcoes: ['2023'] }], variantes: { 2025: kpi('9') } }));
  assert.ok(falta.includes('Sem dados para 2023'));
});

test('carrossel: um cartão por item, conteúdo dgui dentro, "Escolher esta" e imagem só do próprio DG Claw', () => {
  const D = require('../public/dgui.js');
  const h = D.blocoParaHtml('dgui\n' + JSON.stringify({ tipo: 'carrossel', escolher: true, itens: [
    { titulo: 'A', detalhe: 'a', imagem: '/api/v1/media/x1', conteudo: { tipo: 'kpi', titulo: 'K', valor: '1' } },
    { titulo: 'B', recomendada: true, imagem: 'https://fora.example/x.png' },
  ] }));
  assert.equal((h.match(/class="dg-car-sl/g) || []).length, 2);
  assert.ok(h.includes('data-dgui-opcao="Escolho: A"') && h.includes('recomendada'));
  assert.ok(h.includes('src="/api/v1/media/x1"') && !h.includes('fora.example'), 'imagem de fora não entra');
  assert.ok(/dgui-kpi-valor">1</.test(h) && (h.match(/<i/g) || []).length >= 2);
  assert.ok(D.blocoParaHtml('dgui\n{"tipo":"carrossel","itens":[]}').includes('Não consegui desenhar'));
});

test('passos: numerados com o código no bloco da conversa (barra com língua e Copiar)', () => {
  const D = require('../public/dgui.js');
  const h = D.blocoParaHtml('dgui\n' + JSON.stringify({ tipo: 'passos', itens: [
    { titulo: 'Crie o usuário', texto: 'Sem shell.', codigo: 'sudo adduser x', lingua: 'bash' },
    { titulo: 'Teste', codigo: 'ssh -N x' },
  ] }));
  assert.equal((h.match(/<li>/g) || []).length, 2);
  assert.ok(h.includes('class="dg-passos"') && h.includes('class="cod-bar"') && h.includes('>Bash<') && h.includes('>Copiar<'));
  assert.ok(h.includes('sudo adduser x') && h.includes('>texto<'));
  assert.ok(!/Continue a análise/.test(h), 'passos não ganha perguntas sugeridas');
});

test('para-admin desenha o botão só com data válida, sem texto do agente', () => {
  const h = dgui.blocoParaHtml(bloco({ tipo: 'para-admin', relatorio: '2026-10-23', titulo: '<b>x</b>' }));
  assert.match(h, /data-dgui-para-admin="2026-10-23"/);
  assert.match(h, /Relatório de segurança de 23\/10\/2026/);
  assert.ok(!h.includes('<b>x</b>'));
  assert.match(dgui.blocoParaHtml(bloco({ tipo: 'para-admin', relatorio: '2026-10-23"><img' })), /dgui-aviso/);
  assert.match(dgui.blocoParaHtml(bloco({ tipo: 'para-admin' })), /dgui-aviso/);
});
