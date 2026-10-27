'use strict';
// Referências pelo servidor de verdade (25/10/2026): o Atalho manda imagem, a tela mostra, os ajustes valem.
const test = require('node:test');
const assert = require('node:assert');
const { subirWeb, cliente } = require('./ajuda');

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(40, 1)]);

test('Atalho manda imagem por multipart; só entra com Imagens ligado; a tela baixa o arquivo', async () => {
  const s = await subirWeb();
  try {
    await s.login();
    const chave = (await s.c.post('/api/v1/referencias/atalho')).json.chave;
    assert.match(chave, /^ref_/);
    const b = 'fronteiraXYZ';
    const corpo = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="arquivo"; filename="print.png"\r\nContent-Type: image/png\r\n\r\n`), PNG, Buffer.from(`\r\n--${b}--\r\n`)]);
    const fora = cliente(s.porta);
    const manda = () => fora.post('/api/referencias/entrada', { origin: false, corpo, headers: { Authorization: 'Bearer ' + chave, 'Content-Type': `multipart/form-data; boundary=${b}` } });
    let r = await manda();
    assert.strictEqual(r.status, 403);
    assert.match(r.json.mensagem, /Imagens está desligado/);
    r = await s.c.pedir('PUT', '/api/v1/referencias/ajustes', { json: { tipos: { imagem: true } } });
    assert.strictEqual(r.status, 200, r.texto);
    r = await manda();
    assert.strictEqual(r.status, 201, r.texto);
    assert.strictEqual(r.json.mensagem, 'Imagem guardada nas Referências.');
    const lista = (await s.c.get('/api/v1/referencias')).json;
    assert.strictEqual(lista.ajustes.tipos.imagem, true);
    assert.strictEqual(lista.itens[0].tipo, 'imagem');
    const arq = await s.c.get(`/api/v1/referencias/${r.json.id}/arquivo`);
    assert.strictEqual(arq.status, 200);
    assert.strictEqual(arq.headers['content-type'], 'image/png');
    assert.ok(PNG.equals(arq.buf));
    const semSessao = await fora.get(`/api/v1/referencias/${r.json.id}/arquivo`);
    assert.notStrictEqual(semSessao.status, 200);
  } finally { await s.fechar(); }
});
