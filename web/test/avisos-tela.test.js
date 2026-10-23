'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../public/avisos');

const pub = n => fs.readFileSync(path.join(__dirname, '../public', n), 'utf8');
const agora = new Date(2026, 9, 17, 16, 0, 0);          // sáb 17/10/2026, hora local
const em = (d, h, mi) => new Date(2026, 9, d, h, mi, 0).toISOString();

test('rótulo de dia: Hoje, Ontem e dia da semana com data', () => {
  assert.equal(A.rotuloDia(em(17, 9, 0), agora), 'Hoje');
  assert.equal(A.rotuloDia(em(16, 23, 59), agora), 'Ontem');
  assert.equal(A.rotuloDia(em(16 - 1, 10, 0), agora), 'qui, 15/10');
  assert.equal(A.rotuloDia(em(9, 10, 0), agora), 'sex, 09/10');
  assert.equal(A.rotuloDia('lixo', agora), 'Sem data');
});

test('agrupar por dia mantém a ordem e junta o mesmo dia', () => {
  const g = A.agruparPorDia([
    { id: 3, criado_em: em(17, 15, 0) }, { id: 2, criado_em: em(17, 9, 0) }, { id: 1, criado_em: em(15, 8, 0) },
  ], agora);
  assert.deepEqual(g.map(x => x.rotulo), ['Hoje', 'qui, 15/10']);
  assert.deepEqual(g[0].avisos.map(a => a.id), [3, 2]);
});

test('aviso: escapa tudo e só linka http/https com rel=noopener', () => {
  const h = A.htmlAviso({
    id: 1, agente: 'x', agente_nome: '<img src=x>', tipo: 'entrega', texto: '<script>alert(1)</script>',
    link: 'https://ex.com/?a=1&b="2"', assunto: '<b>', tags: ['<i>'], criado_em: em(17, 15, 59), para: ['todos'], ativo: true,
  });
  assert.doesNotMatch(h, /<script>|<img src=x>|<b>|<i>/);
  assert.match(h, /rel="noopener noreferrer"/);
  assert.match(h, /&amp;b=&quot;2&quot;/);
  assert.match(h, /data-av-retirar="1"/);
  const js = A.htmlAviso({ id: 2, tipo: 'entrega', texto: 'a', link: 'javascript:alert(1)', criado_em: em(17, 1, 0) });
  assert.doesNotMatch(js, /javascript:/);
});

test('aviso retirado ou substituído aparece apagado, com motivo e sem botão Retirar', () => {
  const h = A.htmlAviso({ id: 5, agente: 'dono', tipo: 'decisao', texto: 'x', ativo: false,
    retirado_em: em(17, 10, 5), retirado_por: 'dono', motivo_retirada: 'postei errado', criado_em: em(17, 10, 0) });
  assert.match(h, /av-apagado/);
  assert.match(h, /postei errado/);
  assert.doesNotMatch(h, /data-av-retirar/);
  const s = A.htmlAviso({ id: 6, tipo: 'decisao', texto: 'x', ativo: false, substituido_por: 9, criado_em: em(17, 10, 0) });
  assert.match(s, /Substituído pelo aviso #9/);
});

test('campo de motivo só abre no aviso escolhido', () => {
  const a = { id: 7, tipo: 'pedido', texto: 'x', ativo: true, criado_em: em(17, 10, 0) };
  assert.match(A.htmlAviso(a, { motivoAberto: 7 }), /data-av-retirada="7"/);
  assert.doesNotMatch(A.htmlAviso(a, { motivoAberto: 8 }), /data-av-retirada/);
});

test('resumo das entregas: chegou, recado entregue e falha com motivo', () => {
  const r = A.resumirEntregas({ entregas: {
    marina: { retrato_em: em(17, 15, 59), recado_em: null, erro: null },
    lara: { retrato_em: em(17, 15, 59), recado_em: em(17, 16, 1), erro: null },
    luna: { retrato_em: null, recado_em: null, erro: 'runner fora do ar' },
  } });
  assert.equal(r[0].texto, 'chegou para marina às 15:59');
  assert.equal(r[1].texto, 'recado entregue a lara às 16:01');
  assert.equal(r[2].texto, 'falhou para luna: runner fora do ar');
  assert.equal(r[2].estado, 'falha');
  assert.deepEqual(A.resumirEntregas({}), []);
});

test('validação do formulário', () => {
  const ok = A.validaForm({ tipo: 'decisao', texto: ' Lives às 14h. ', link: ' https://x.com ', assunto: ' Lives ' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.dados, { tipo: 'decisao', para: ['todos'], texto: 'Lives às 14h.', link: 'https://x.com', assunto: 'Lives' });
  assert.ok(A.validaForm({ tipo: 'decisao', texto: '' }).erros.texto);
  assert.ok(A.validaForm({ tipo: 'decisao', texto: 'a'.repeat(281) }).erros.texto);
  assert.equal(A.validaForm({ tipo: 'decisao', texto: 'a'.repeat(280) }).ok, true);
  assert.ok(A.validaForm({ tipo: 'decisao', texto: 'a\nb\nc' }).erros.texto);
  assert.equal(A.validaForm({ tipo: 'decisao', texto: 'a\nb' }).ok, true);
  assert.ok(A.validaForm({ tipo: 'decisao', texto: 'a', link: 'ftp://x' }).erros.link);
  assert.ok(A.validaForm({ tipo: 'decisao', texto: 'a', link: 'javascript:alert(1)' }).erros.link);
  assert.ok(A.validaForm({ tipo: 'decisao', texto: 'a', assunto: 'x'.repeat(61) }).erros.assunto);
  assert.ok(A.validaForm({ tipo: 'nada', texto: 'a' }).erros.tipo);
  assert.ok(A.validaForm({ tipo: 'pedido', texto: 'a', para: [] }).erros.para);
  assert.equal(A.validaForm({ tipo: 'pedido', texto: 'a', para: ['marina'] }).ok, true);
});

test('erros 400 da API viram campo a campo', () => {
  assert.deepEqual(A.errosDaApi({ texto: 'vazio' }), { texto: 'vazio' });
  assert.deepEqual(A.errosDaApi([{ campo: 'link', erro: 'inválido' }, 'solto']), { link: 'inválido', geral: 'solto' });
  assert.deepEqual(A.errosDaApi(null), {});
});

test('query dos filtros', () => {
  assert.equal(A.queryFiltros({}), '');
  assert.equal(A.queryFiltros({ agente: 'lara', tipo: 'pedido', retirados: true }), '?agente=lara&tipo=pedido&incluir_retirados=1');
  assert.equal(A.queryFiltros({ agente: 'a b' }), '?agente=a%20b');
});

test('a lista tem os 7 tipos e a página carrega o que precisa', () => {
  assert.equal(A.TIPOS.length, 7);
  const h = pub('avisos.html');
  assert.match(h, /id="avisosRaiz"/);
  assert.ok(h.indexOf('/tour.js') < h.indexOf('/avisos.js'));
  assert.match(h, /avisos\.css/);
  // Sem item próprio no menu: o quadro abre pela aba Avisos da Mesa de tarefas.
  const mesa = pub('mesa.html');
  assert.match(mesa, /^<link rel="stylesheet" href="\/avisos\.css">$/m);
  assert.ok(mesa.indexOf('<script src="/mesa.js">') < mesa.indexOf('<script src="/avisos.js">'));
});

test('nenhum travessão nos arquivos da tela', () => {
  for (const f of ['avisos.js', 'avisos.css', 'avisos.html']) assert.doesNotMatch(pub(f), /[—–]/, f);
});

test('o link colado no texto vira o link do aviso e não conta nas 280 letras', () => {
  assert.deepEqual(A.separaLink('Relatório pronto: https://x.com/r.pdf.'), { texto: 'Relatório pronto:', link: 'https://x.com/r.pdf' });
  assert.deepEqual(A.separaLink('veja https://a.b/c e responda'), { texto: 'veja e responda', link: 'https://a.b/c' });
  assert.deepEqual(A.separaLink('sem link aqui'), { texto: 'sem link aqui', link: '' });
  assert.deepEqual(A.separaLink('linha 1\nhttps://a.b/c'), { texto: 'linha 1', link: 'https://a.b/c' });
});
