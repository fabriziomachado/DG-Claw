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
  assert.strictEqual((h.match(/<li class=/g) || []).length, 2);
  assert.match(h, /<details class="dgui-leitura-det"><summary>Ver análise completa<\/summary>/);
  assert.match(h, /<b>Diagnóstico:<\/b>/);
  assert.ok(!h.includes('<script>'));
  assert.ok(!h.includes('concentra <b>'));
});
