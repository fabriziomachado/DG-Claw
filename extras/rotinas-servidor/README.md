# Rotinas do servidor

Roteiros que rodam no próprio servidor, como root e fora das caixas dos agentes. A Saúde do servidor
mostra cada um (última vez, próxima, últimos 7 dias) e avisa no celular quando um falha
(`web/lib/rotinas-servidor.js`). Uma rotina só aparece na tela se o timer dela estiver instalado.

Não fazem parte da instalação padrão: cada servidor escolhe quais quer.

| Rotina | Roteiro | Quando | Pede |
|---|---|---|---|
| Cópia de segurança | `dgclaw-copia-diaria` (+ `dgclaw-copia-chave`) | todo dia, 03:30 de Brasília | `age`, `zstd`, `gpg`; a chave criada com `dgclaw-copia-chave preparar <slug> <VARIAVEL>` |
| Varredura de segurança | `dgclaw-varredura-seguranca` | todo dia, 06:00 de Brasília | `trivy`; grava o resultado na casa do agente `SLUG` (padrão `tech`) |
| Vigia de tráfego | `dgclaw-vigia-trafego` | a cada 5 minutos | os avisos do Web (`web/lib/push.js`); limite em `DGCLAW_VIGIA_TRAFEGO_MB` |

## Instalar

```bash
sudo install -m 755 extras/rotinas-servidor/sbin/* /usr/local/sbin/
sudo install -m 644 extras/rotinas-servidor/systemd/* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dgclaw-copia-diaria.timer dgclaw-varredura-seguranca.timer dgclaw-vigia-trafego.timer
```

A cópia trancada só começa depois da chave: sem `/etc/dgclaw/copia/destinatario.txt` ela falha de
propósito (e a falha aparece na Saúde do servidor).
