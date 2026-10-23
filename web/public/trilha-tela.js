'use strict';
/* trilha-tela.js: a parte pura da trilha de comandos, do cartão de permissão e do aviso de fila.

   Sem DOM e sem rede: agrupa os itens da trilha, monta os rótulos e os textos. O desenho e as
   chamadas ficam em conversa.js; aqui fica o que se testa com node:test (web/test/trilha-tela.test.js). */
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.DGTrilha = m;
})(this, function () {
  const ehTrilha = m => !!m && m.origin === 'trilha' && !!m.trilha;

  /** Junta os itens da trilha que vêm em sequência (sem mensagem no meio). Devolve [{ trilha:[...] } | { msg }]. */
  function agrupa(lista) {
    const saida = [];
    for (const m of lista) {
      if (ehTrilha(m)) {
        const ultimo = saida[saida.length - 1];
        if (ultimo && ultimo.trilha) ultimo.trilha.push(m);
        else saida.push({ trilha: [m] });
      } else saida.push({ msg: m });
    }
    return saida;
  }

  /** Como agrupa(), mas junta todos os passos de um mesmo pedido (até a próxima fala do dono), mesmo com
      falas do agente no meio. O grupo fica na posição do primeiro passo. (18/10/2026: "Fez 5 passos") */
  function agrupaPorTurno(lista) {
    const saida = [];
    let grupo = null;
    for (const m of lista) {
      if (ehTrilha(m)) {
        if (grupo) grupo.trilha.push(m);
        else { grupo = { trilha: [m] }; saida.push(grupo); }
      } else {
        if (m && m.origin === 'dono') grupo = null;
        saida.push({ msg: m });
      }
    }
    return saida;
  }

  const base = c => String(c || '').split('/').filter(Boolean).pop() || String(c || '');
  const umaLinha = c => String(c || '').replace(/\s+/g, ' ').trim();

  /** A descrição que o agente escreveu para o comando, ou '' quando o título é só o próprio comando. */
  function descricaoBash(t) {
    const tit = umaLinha(t.titulo).replace(/…$/, '');
    if (!tit) return '';
    return umaLinha(t.comando).startsWith(tit) ? '' : umaLinha(t.titulo);
  }

  // Do comando para uma frase que o dono entende (18/10/2026: "algo mais humanamente compreensível").
  // Vale quando o agente não escreveu a descrição. O comando inteiro continua no detalhe do passo.
  const LER = new Set(['cat', 'head', 'tail', 'less', 'more', 'wc', 'jq', 'sed', 'awk', 'pdftotext', 'file', 'stat', 'diff']);
  const LUGAR = new Set(['ls', 'find', 'tree', 'du', 'df']);
  const POR_NOME = {
    grep: 'Procurando nos arquivos', rg: 'Procurando nos arquivos', mkdir: 'Criando uma pasta', cp: 'Copiando arquivos',
    mv: 'Movendo arquivos', rm: 'Apagando arquivos temporários', touch: 'Criando um arquivo', chmod: 'Ajustando permissões',
    sleep: 'Esperando um pouco', echo: 'Anotando', printf: 'Anotando', tee: 'Gravando um arquivo', date: 'Conferindo a hora',
    ffmpeg: 'Processando áudio ou vídeo', ffprobe: 'Examinando um áudio ou vídeo', zip: 'Compactando arquivos', unzip: 'Abrindo um zip',
    tar: 'Compactando arquivos', pip: 'Instalando pacotes', pip3: 'Instalando pacotes', npm: 'Instalando pacotes', npx: 'Rodando uma ferramenta',
    sqlite3: 'Consultando o banco de dados', psql: 'Consultando o banco de dados', mysql: 'Consultando o banco de dados',
    'dgclaw-abrir-zip': 'Abrindo um zip', crontab: 'Ajustando uma rotina agendada', systemctl: 'Conferindo um serviço',
    ps: 'Conferindo o que está rodando', pgrep: 'Conferindo o que está rodando', kill: 'Parando um processo', pkill: 'Parando um processo',
    gh: 'Falando com o GitHub', which: 'Conferindo uma ferramenta', 'dgclaw-api': 'Falando com o S2 Bot', claude: 'Chamando o Claude', codex: 'Chamando o Codex', gemini: 'Chamando o Gemini',
  };
  const GIT = { status: 'Conferindo o Git', diff: 'Conferindo as mudanças no Git', log: 'Olhando o histórico do Git', add: 'Preparando uma versão no Git',
    commit: 'Salvando uma versão no Git', push: 'Enviando ao GitHub', pull: 'Buscando atualizações no Git', clone: 'Baixando um repositório', checkout: 'Trocando de ramo no Git' };
  const nomeArq = a => { const b = base(String(a || '').replace(/^['"]|['"]$/g, '')); return b && !/^[-$<>|&]/.test(b) ? b : ''; };

  const host = t => ((/https?:\/\/([^/\s"'?:]+)/.exec(t) || [])[1] || '').replace(/^www\./, '');
  /** Script escrito na hora (python3 - <<EOF, node -e): uma olhada no conteúdo diz o assunto. */
  function assuntoDoScript(c) {
    if (/matplotlib|plotly|seaborn|\.savefig\(/.test(c)) return 'Gerando um gráfico';
    if (/\b(requests|urllib|httpx|fetch)\b/.test(c) && host(c)) return 'Consultando ' + host(c);
    if (/\b(pandas|openpyxl|xlsx|csv)\b/.test(c)) return 'Analisando os dados';
    if (/\bsqlite3\b|\bSELECT\b/.test(c)) return 'Consultando o banco de dados';
    return '';
  }

  function humanoComando(cmd) {
    let c = String(cmd || '').trim();
    // tira o preparo que não diz nada: cd, umask, set, export, variáveis no começo
    for (let i = 0; i < 8; i++) {
      const m = /^(?:cd\s+\S+|umask\s+\d+|set\s+-\S+|export\s+\w+=\S*|\w+=(?:'[^']*'|"[^"]*"|\S*))\s*(?:&&|;|\n)\s*/.exec(c)
        || /^(?:[A-Z_][A-Z0-9_]*=(?:'[^']*'|"[^"]*"|\S*)\s+)+/.exec(c);
      if (!m) break;
      c = c.slice(m[0].length);
    }
    const linha = c.split('\n')[0];
    if (/^for\s|^while\s/.test(linha)) {
      if (/\b(curl|wget)\b/.test(c) && host(c)) return 'Consultando ' + host(c);
      return 'Repetindo um passo em vários itens';
    }
    const pal = (linha.split(/\s*(?:\||&&|;)\s*/)[0] || '').split(/\s+/).filter(Boolean);
    let prog = base(pal[0] || '');
    if ((prog === 'sudo' || prog === 'timeout' || prog === 'nohup' || prog === 'time') && pal.length > 1) { pal.shift(); if (prog === 'timeout') pal.shift(); prog = base(pal[0] || ''); }
    const args = pal.slice(1).filter(a => !a.startsWith('-'));
    if (/^python\d?(\.\d+)?$/.test(prog) || prog === 'node' || prog === 'bash' || prog === 'sh' || prog === 'uv') {
      if (pal.includes('-m') && pal[pal.indexOf('-m') + 1]) return 'Rodando ' + pal[pal.indexOf('-m') + 1];
      const script = args.find(a => /\.(py|js|mjs|sh)$/.test(a));
      if (script) return 'Rodando o script ' + nomeArq(script);
      return assuntoDoScript(c) || 'Rodando um script' + (/^python/.test(prog) ? ' em Python' : '');
    }
    if (/\.(py|js|mjs|sh)$/.test(prog)) return 'Rodando o script ' + prog;
    if (prog === 'curl' || prog === 'wget' || prog === 'http') {
      const url = (/https?:\/\/([^/\s"'?:]+)/.exec(linha) || [])[1];
      return url ? 'Consultando ' + url.replace(/^www\./, '') : 'Consultando um site';
    }
    if (prog === 'git') {
      const sub = pal.slice(1).find(a => !a.startsWith('-') && !a.includes('=') && !a.includes('/'));
      return GIT[sub] || 'Mexendo no Git';
    }
    if (LER.has(prog)) { const a = nomeArq(args[args.length - 1]); return a && !/[{}()]/.test(a) ? 'Lendo ' + a : 'Lendo um arquivo'; }
    if (LUGAR.has(prog)) { const a = nomeArq(args[0]); return a && a !== '.' ? 'Olhando a pasta ' + a : 'Olhando os arquivos'; }
    if (POR_NOME[prog]) return POR_NOME[prog];
    if (/chrom(e|ium)|firefox|playwright/.test(prog)) return 'Abrindo o navegador';
    if (host(linha)) return 'Consultando ' + host(linha);
    return 'Rodando um comando';
  }

  /** O que a linha de um passo mostra, em linguagem de gente: a descrição do agente ou o comando traduzido. */
  function rotuloPasso(t) {
    if (!t) return '';
    const f = t.ferramenta;
    if (f === 'Bash') return (descricaoBash(t) || humanoComando(t.comando || t.titulo)).slice(0, 160);
    if (f === 'Read' || f === 'Write' || f === 'Edit' || f === 'MultiEdit' || f === 'NotebookEdit') {
      return base(String(t.titulo || '').replace(/^(gravou|editou)\s+/, ''));
    }
    return String(t.titulo || '');
  }
  /** Família do passo, para o ícone. */
  function tipoPasso(f) {
    if (f === 'Bash') return 'terminal';
    if (f === 'Read') return 'ler';
    if (f === 'Write' || f === 'Edit' || f === 'MultiEdit' || f === 'NotebookEdit') return 'editar';
    if (f === 'Grep' || f === 'Glob') return 'buscar';
    if (f === 'WebFetch' || f === 'WebSearch') return 'web';
    if (f === 'Skill') return 'skill';
    if (f === 'Task' || f === 'Agent') return 'ajuda';
    return 'outro';
  }
  /** 8 s, 1 min 12 s, 2 min, 1 h 5 min */
  function duracao(seg) {
    const s = Math.max(0, Math.round(seg));
    if (s < 60) return s + ' s';
    const m = Math.floor(s / 60), r = s % 60;
    if (m < 60) return r && m < 10 ? m + ' min ' + r + ' s' : m + ' min';
    return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  }

  /** Texto da linha fechada de um grupo. */
  function rotuloGrupo(itens) {
    if (itens.length === 1) return 'rodou: ' + itens[0].trilha.titulo;
    const erros = itens.filter(i => i.trilha.erro).length;
    return 'rodou ' + itens.length + ' comandos' + (erros ? ' (' + erros + ' com erro)' : '');
  }

  /** Por que a mensagem está na fila, na frase que o balão mostra. */
  function textoFila(motivo, estaEsperandoPermissao) {
    if (motivo !== 'permissao' && motivo !== 'resposta' && motivo !== 'pergunta') return '';
    if (motivo === 'pergunta') return 'na fila: o agente fez uma pergunta e espera a resposta dela';
    // se o agente passou a esperar permissão depois do envio, essa é a razão de verdade
    if (estaEsperandoPermissao || motivo === 'permissao') return 'na fila: o agente está esperando a sua permissão';
    return 'na fila: o agente ainda está respondendo a anterior';
  }

  /** O que o cartão de permissão descreve: "Bash: <comando>" ou um aviso de que o detalhe não veio. */
  function descricaoPedido(p) {
    if (!p || !p.titulo) return 'O agente não informou o que quer fazer. Abra o terminal dele para ver.';
    return p.ferramenta + ': ' + (p.comando || p.titulo);
  }

  return { agrupa, agrupaPorTurno, rotuloPasso, humanoComando, tipoPasso, duracao, rotuloGrupo, textoFila, descricaoPedido, ehTrilha };
});
