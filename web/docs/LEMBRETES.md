# Lembretes que insistem até você confirmar

O agente agenda um lembrete para o dono ("me lembra amanhã às 9h de ligar pro contador").
Na hora marcada o DG Claw avisa e **repete o aviso em intervalos** até o dono tocar
**Feito** ou **Adiar**. Quem dispara é o DG Claw Web, que é um serviço do servidor e volta
sozinho depois de um reinício. Nada depende da sessão do agente estar aberta, nem do
Bunker, nem de serviço externo.

Cada vez que o lembrete toca, o aviso sai por três caminhos ao mesmo tempo:

1. **Na tela do DG Claw**: uma faixa ⏰ no alto de qualquer conversa, com os botões
   **Feito** e **Adiar**. Some quando alguém confirma, em qualquer aparelho.
2. **No celular e no computador**, mesmo com a tela fechada, nos aparelhos em que o dono
   ativou os [avisos no aparelho](AVISOS-NO-APARELHO.md). O aviso traz os mesmos dois botões.
   O aviso novo substitui o anterior e toca de novo, em vez de empilhar.
3. **Pelo agente**: o Web entrega ao agente um recado curto ("hora do lembrete, avise o
   dono"). Se o agente tem Telegram ou WhatsApp conectado, ele manda a mensagem por lá; quando
   o dono responde "feito" ou "adia meia hora", o agente confirma pela API. Desligável por
   lembrete (`pelo_agente: false`).

Três palavras:

- **lembrete**: a regra (o que lembrar, de qual agente, quando);
- **ocorrência**: cada vez agendada (o "segunda às 09:00" desta semana). Cada uma tem o seu
  Feito;
- **envio**: um aviso por todos os caminhos. O 1º sai na hora; os outros a cada intervalo.

O fuso é o do Web (`DGCLAW_WEB_TZ`, ou o do servidor). Toda hora que entra e sai está nele, e
a resposta da API traz o fuso em `agendador.fuso`.

## O lembrete

```json
{
  "id": "lem_2f8b1819",
  "agente": "luna",
  "texto": "ligar pro contador",
  "regra": {"tipo": "unico", "data": "2026-10-20", "hora": "14:30"},
  "regra_texto": "uma vez, em 20/10/2026 às 14:30",
  "fim": null,
  "intervalo_min": 5,
  "teto_envios": 12,
  "pelo_agente": true,
  "titulo": "⏰ Hora do lembrete",
  "estado": "ativo",
  "proxima": "2026-10-20T14:30:00-03:00",
  "criado_por": "agente:luna",
  "criado_em": "2026-10-17T16:02:11-03:00",
  "atualizado_em": "2026-10-17T16:02:11-03:00",
  "ultimas_ocorrencias": []
}
```

| Campo | Escreve? | O que é |
| --- | --- | --- |
| `texto` | sim, obrigatório | o que lembrar (1 a 500 caracteres). Vai no aviso |
| `agente` | sim | de qual agente é o lembrete (a faixa mostra o nome e o recado vai para ele). O dono escolhe; quando quem chama é o próprio agente, é sempre ele e o campo pode faltar |
| `regra` | sim, obrigatório (ou `daqui_min`) | quando (tabela abaixo) |
| `daqui_min` | só no `POST` | atalho: inteiro de 1 a 10080. O Web calcula a regra `unico` a partir de agora. Evita erro de fuso e de conta. Não vai junto com `regra` |
| `fim` | sim, opcional | `"AAAA-MM-DD"`: último dia em que ainda pode tocar. `null` tira o fim |
| `intervalo_min` | sim, opcional | de 1 a 120: de quantos em quantos minutos insistir. Padrão 5 |
| `teto_envios` | sim, opcional | de 1 a 60: quantos avisos no máximo por ocorrência. Padrão 12 (uma hora, com o intervalo padrão) |
| `pelo_agente` | sim, opcional | `false` não entrega o recado ao agente (só tela e aparelho). Padrão `true` |
| `titulo` | sim, opcional | até 80 caracteres. Padrão "⏰ Hora do lembrete" |
| `estado` | não | `ativo`, `pausado` ou `encerrado` (a regra acabou: único que já tocou, ou passou do fim) |
| `proxima` | não | a próxima vez que toca. `null` quando pausado ou encerrado |
| `regra_texto` | não | a regra em português, pronta para mostrar |
| `criado_por` | não | `dono:<usuário>` ou `agente:<slug>` |
| `ultimas_ocorrencias` | não | 3 na lista, 10 no `GET /<id>` |

Nos campos opcionais, `null` volta ao padrão e a resposta sempre traz o valor efetivo.
Campo desconhecido, ou campo calculado (`proxima`, `estado`...), volta 400 dizendo quais se
escrevem. `hora`, `dias` e companhia no nível de cima voltam 400 lembrando que ficam dentro de
`regra`.

## As regras

| `tipo` | Campos | Exemplo | Em português |
| --- | --- | --- | --- |
| `unico` | `data`, `hora` | `{"tipo":"unico","data":"2026-10-20","hora":"14:30"}` | uma vez, em 20/10/2026 às 14:30 |
| `diario` | `hora` | `{"tipo":"diario","hora":"08:00"}` | todo dia às 08:00 |
| `semanal` | `dias`, `hora` | `{"tipo":"semanal","dias":["seg","qua"],"hora":"09:00"}` | toda segunda e quarta às 09:00 |
| `a_cada_n_dias` | `n`, `inicio`, `hora` | `{"tipo":"a_cada_n_dias","n":3,"inicio":"2026-10-17","hora":"20:00"}` | a cada 3 dias às 20:00 (desde 17/10/2026) |

- `hora`: `"HH:MM"`, 24 horas (`"9:05"` vale e vira `"09:05"`).
- `data`, `inicio`, `fim`: `"AAAA-MM-DD"`.
- `dias`: lista com `seg`, `ter`, `qua`, `qui`, `sex`, `sab`, `dom` (o nome por extenso também
  vale: `"quarta"`, `"sábado"`, `"segunda-feira"`).
- `n`: de 1 a 365, contado a partir de `inicio`.
- `unico` no passado volta 400 ("já passou"), e também uma regra cujo `fim` não deixa nenhum
  horário no futuro.
- Até 200 lembretes ativos ou pausados por agente: passou disso, 409 explicando.

## A ocorrência

```json
{
  "id": "oc_2f8b1819_202610201430",
  "lembrete_id": "lem_2f8b1819",
  "agente": "luna",
  "texto": "ligar pro contador",
  "agendada_para": "2026-10-20T14:30:00-03:00",
  "estado": "feito",
  "atrasado": false,
  "envios": [
    {"n": 1, "em": "2026-10-20T14:30:04-03:00",
     "push": {"inscricoes": 1, "ok": 1, "removidas": 0, "falhas": []},
     "agente": {"ok": true}}
  ],
  "total_envios": 1,
  "envio": 1,
  "teto": 12,
  "proximo_envio_em": null,
  "adiada_ate": null,
  "adiamentos": 0,
  "feito_em": "2026-10-20T14:31:40-03:00",
  "feito_por": "dono:danilo",
  "feito_origem": "telegram",
  "tarde": false,
  "encerrada_em": "2026-10-20T14:31:40-03:00",
  "motivo": null
}
```

| `estado` | O que quer dizer |
| --- | --- |
| `insistindo` | os avisos estão saindo a cada intervalo. `proximo_envio_em` diz quando sai o próximo |
| `adiada` | o dono tocou Adiar. Volta a insistir em `adiada_ate`, com a contagem do teto zerada |
| `feito` | alguém confirmou. `tarde: true` quando a confirmação veio depois do teto |
| `sem_resposta` | chegou ao teto sem confirmação. Ainda dá para confirmar (fica `tarde: true`) |
| `perdida` | o Web estava fora do ar na hora e voltou mais de 1 hora depois. Nenhum aviso saiu |
| `cancelada` | o lembrete foi pausado ou apagado no meio da insistência (`motivo` diz qual) |

`envio` é o número do aviso no ciclo atual (o "aviso 3 de 12" da faixa); `total_envios` conta todos, inclusive os de
antes de um adiamento. `feito_por` é `dono:<usuário>` ou `agente:<slug>`, e `feito_origem` é o texto opcional
que quem confirmou mandou em `origem` (ex.: `telegram`).

`push` de cada envio é o resultado da entrega no aparelho; `{"inscricoes": 0}` quer dizer que
nenhum aparelho está ativado e só a faixa e o agente avisaram. `agente` é o resultado do recado
ao agente: `{"ok": false, "erro": "..."}` quando o agente estava fora do ar, e `null` quando
`pelo_agente` é `false`.

### A insistência, o teto e o adiar

- O 1º envio sai na hora marcada (o agendador confere a cada 15 s).
- Sem confirmação, o envio `n` sai em `1º envio + (n-1) × intervalo_min`, até o teto. Passado
  `teto × intervalo_min` do 1º envio, a ocorrência vira `sem_resposta`.
- **Feito** em qualquer caminho (faixa, aviso no aparelho, agente, API) para tudo daquela
  ocorrência. As outras ocorrências do mesmo lembrete não mudam.
- **Adiar** pede quantos minutos (10, 30, 60 ou outro valor de 1 a 1440). A ocorrência vira
  `adiada` e volta a insistir em `adiada_ate`, como se tocasse de novo: 1º envio na volta, e o teto
  conta de novo a partir dali. Até 20 adiamentos por ocorrência.

### Web fora do ar na hora marcada

Ao voltar, o agendador olha cada lembrete ativo:

- a hora passou há **menos de 1 hora**: dispara na volta e marca `atrasado: true`;
- passou **mais de 1 hora**: registra a ocorrência como `perdida` e segue para a próxima (até 50
  perdidas por lembrete, para um servidor desligado por semanas não gerar milhares);
- insistência que estava no meio continua de onde dá; se a janela já fechou, vira
  `sem_resposta` sem mandar uma rajada atrasada;
- adiada cujo `adiada_ate` passou volta a insistir na hora.

Pausado não acumula nada: ao retomar, segue da próxima hora a partir de agora.

## Rotas

Todas com a sessão do login, ou pela [caixa do agente](CAIXA-DO-AGENTE.md) (o agente usa
`dgclaw-api`). Escritas pelo navegador exigem `Origin` do próprio Web.

| Rota | O que faz |
| --- | --- |
| `GET /api/v1/lembretes` | lista. Filtros `?agente=` e `?estado=` (`ativo`, `pausado`, `encerrado`). Traz `agendador` (`ultimo_tique_em`, `intervalo_s`, `fuso`, `erro`) e `insistindo` (as ocorrências que estão tocando agora, de todos os agentes visíveis para quem chamou) |
| `POST /api/v1/lembretes` | cria (201). Corpo: `texto` e `regra` (ou `daqui_min`), opcionais `agente`, `fim`, `intervalo_min`, `teto_envios`, `pelo_agente`, `titulo` |
| `POST /api/v1/lembretes/disparar` | dispara AGORA (201): cria um lembrete `unico` já encerrado e faz o 1º envio antes de responder. Corpo como o do `POST`, sem `regra` nem `daqui_min` |
| `GET /api/v1/lembretes/<id>` | um lembrete, com as 10 últimas ocorrências |
| `PATCH /api/v1/lembretes/<id>` | edita: cada campo que vier substitui o atual (`regra` vai inteira). Mudar `regra` ou `fim` recalcula a próxima. Insistência em curso continua com o texto antigo |
| `POST /api/v1/lembretes/<id>/pausar` | pausa. Insistência em curso vira `cancelada`. `ja_estava: true` se já estava pausado |
| `POST /api/v1/lembretes/<id>/retomar` | retoma a partir de agora. Se a regra já acabou, volta 200 com `aviso` explicando |
| `DELETE /api/v1/lembretes/<id>` | apaga de vez. Insistência em curso vira `cancelada` |
| `GET /api/v1/lembretes/<id>/ocorrencias?limit=30` | as ocorrências, a mais nova primeiro (até 60 guardadas por lembrete) |
| `POST /api/v1/lembretes/ocorrencias/<oc>/feito` | confirma. Corpo opcional `{"origem":"telegram"}`. Já feita: 200 com `ja_estava: true`. `perdida` ou `cancelada`: 409 |
| `POST /api/v1/lembretes/ocorrencias/<oc>/adiar` | adia. Corpo `{"minutos": 30}` (padrão 10). Feita, perdida ou cancelada: 409. Passou de 20 adiamentos: 409 |
| `GET /api/v1/lembretes/docs.md` | este documento |

**Quem pode o quê.** O dono vê e mexe em tudo. O agente, pela caixa, só vê e mexe nos
lembretes dele: lembrete de outro agente volta 404 (como se não existisse), e `agente` com
outro slug no corpo volta 403 dizendo que o agente só cria lembretes para si mesmo.

**Erros.** Formato geral `{"ok": false, "erro": "...", "erros": {"campo": "motivo"}}`: o `erro`
resume em português e `erros` aponta cada campo. `404` diz qual id não existe e onde listar.
`503` quer dizer que o arquivo dos lembretes está ilegível: nada é gravado por cima, e a mensagem
diz o caminho e o que fazer.

## Exemplos (o agente, pela caixa)

```bash
# daqui a 20 minutos
dgclaw-api POST /api/v1/lembretes '{"texto":"tirar o bolo do forno","daqui_min":20}'

# uma vez, segunda às 14:30
dgclaw-api POST /api/v1/lembretes '{"texto":"ligar pro contador","regra":{"tipo":"unico","data":"2026-10-20","hora":"14:30"}}'

# todo dia às 08:00 até o fim do ano, insistindo de 10 em 10 minutos
dgclaw-api POST /api/v1/lembretes '{"texto":"tomar o remédio","fim":"2026-12-31","intervalo_min":10,"regra":{"tipo":"diario","hora":"08:00"}}'

# o que está agendado, e o que está tocando agora
dgclaw-api GET /api/v1/lembretes

# o dono respondeu "feito" no Telegram
dgclaw-api POST /api/v1/lembretes/ocorrencias/oc_2f8b1819_202610201430/feito '{"origem":"telegram"}'

# o dono pediu "me lembra de novo daqui a meia hora"
dgclaw-api POST /api/v1/lembretes/ocorrencias/oc_2f8b1819_202610201430/adiar '{"minutos":30}'
```

Pelo navegador ou `curl` com a sessão, as rotas e os corpos são os mesmos.

## O recado que o agente recebe

Em cada envio com `pelo_agente: true`, o Web entrega ao agente (pelo runner, quando a sessão
estiver livre) um recado assim:

```text
[LEMBRETE] envio 2 de 12: "ligar pro contador" (marcado para 14:30).
Ocorrência oc_2f8b1819_202610201430. Avise o dono pelo canal que ele usa com você.
Quando ele disser que fez: dgclaw-api POST /api/v1/lembretes/ocorrencias/oc_2f8b1819_202610201430/feito
Se pedir para adiar: dgclaw-api POST /api/v1/lembretes/ocorrencias/oc_2f8b1819_202610201430/adiar '{"minutos":N}'
```

O recado chega embrulhado em `<plataforma recado="lembrete" tipo="aviso" ts="...">...</plataforma>`, o envelope de
recado da máquina. Por isso a conversa não o mostra como se o dono tivesse escrito (o leitor da conversa
esconde esse envelope), e o agente sabe que foi o sistema. O texto do lembrete tem o `<` trocado por `&lt;`
dentro do recado, para ninguém fechar o envelope no meio.

A skill `lembretes` ensina o agente a agir com esse recado. Se o agente estiver fora do ar, o
envio registra o erro e a faixa e o aviso no aparelho seguem normalmente.

## Na tela

- **Faixa ⏰** em todas as conversas (`/a/<agente>`): uma linha por ocorrência tocando, com o
  nome do agente, o texto, "aviso 3 de 12", e os botões **Feito** e **Adiar** (10 min, 30 min,
  1 h). Atualiza a cada 15 s e quando a aba volta ao foco.
- **Aba Lembretes** do Board (`/mesa#lembretes`), a mesma que abre sozinha em `/lembretes` (menu
  lateral): no topo, se os avisos estão ativos neste aparelho (Ativar, aviso de teste, desligar); o
  campo com "quando" e "de qual agente" em pílulas e, atrás do ícone de ajustes, a insistência, o
  máximo de avisos, o último dia e o aviso pelo agente; filtros (ativos, pausados, encerrados, todos e
  as fotos dos agentes); a lista em grupos (tocando agora com Feito e Adiar, hoje, amanhã, mais
  adiante, pausados, encerrados), com histórico, pausar, retomar e apagar no "⋯". Hoje e amanhã
  seguem o fuso do servidor. Código em `public/lembretes-aba.js` e `lembretes-aba.css`; as contas do
  formulário continuam em `public/lembretes.js`.
- A faixa e a aba têm o **Tutorial** (visita guiada) no cabeçalho.

## Onde fica cada coisa

- `<DGCLAW_WEB_DATA>/lembretes/lembretes.json`: lembretes e ocorrências, gravado por troca
  atômica com modo 0600. Entra no backup. Arquivo ilegível nunca é trocado por um vazio.
- A chave e os aparelhos dos avisos ficam em `<DGCLAW_WEB_DATA>/push/` (ver
  [avisos no aparelho](AVISOS-NO-APARELHO.md)).

## Lembrete ou rotina?

- **Lembrete** (esta página): avisar **o dono** de alguma coisa, insistindo até ele confirmar.
- **Rotina** (skill `agenda`): o **agente** fazer um trabalho num horário (mandar o resumo do
  dia, conferir o e-mail). A rotina pode, ela mesma, criar um lembrete quando precisar da
  confirmação do dono.
