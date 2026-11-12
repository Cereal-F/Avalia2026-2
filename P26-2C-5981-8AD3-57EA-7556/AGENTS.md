# Documentação de Engenharia de Agentes e Harness (P26-2C-5981-8AD3-57EA-7556)

Este documento descreve os agentes usados no projeto Batalha Naval Tático, o harness em que operaram, as skills que cada um seguiu e o que cada um entregou. Os arquivos das skills estão em [`skills/`](./skills/) e os testes em [`tests/`](./tests/).

## 1. Harness e modelo

- **Harness:** Claude Code, ambiente de agente sobre o Claude Agent SDK. A sessão principal delega tarefas a subagentes pela ferramenta Agent.
- **Modelo:** Claude Haiku 5.5 (`claude-haiku-5-5`), usado pela sessão principal e pelos subagentes.
- **Ferramentas disponíveis aos agentes:** leitura e busca de arquivos, shell (para executar Node.js nos testes) e escrita apenas em uma pasta de trabalho fora do repositório. Nenhum agente editou o código do projeto.

## 2. Como os agentes foram usados

A implementação inicial (regras de negócio, Functions, D1, interface e login) foi escrita pela sessão principal, antes dos agentes. Os três agentes foram disparados depois, em paralelo, como revisão independente, auditoria e validação. Cada um recebeu escopo, papel e a skill correspondente.

A coordenação segue este fluxo:

1. A sessão principal define o escopo de cada agente e os requisitos do enunciado.
2. Os três agentes trabalham em paralelo, cada um com um papel distinto.
3. A sessão principal consolida os achados, decide o que corrigir e aplica as correções.
4. Os testes são executados de novo e o repositório recebe o commit.

## 3. Agentes criados e entregas

### Agente 1: Arquiteto Serverless, Cloudflare D1 e Segurança Discord OAuth2

- **Tarefa:** auditoria somente leitura de `functions/`, `src/` e `migrations/`.
- **Skill utilizada:** [`skills/serverless-d1-discord/SKILL.md`](./skills/serverless-d1-discord/SKILL.md)
- **Resultado:** 9 achados (0 de gravidade alta, 4 médios, 5 baixos).
- **Corrigidos:**
  - Login sem `state`, o que permitia CSRF no OAuth. Agora há um `state` aleatório em cookie HttpOnly, conferido no callback.
  - Sessão sem expiração. Agora o token tem `exp` e é rejeitado após 24 horas.
  - Posicionamento que podia sobrescrever uma frota já confirmada em requisições concorrentes.
- **Não corrigidos (documentados na seção 5):** atomicidade entre troca de vez e gravação do tiro, duas escritas separadas na finalização, mensagens de erro do banco repassadas ao cliente, criação duplicada de partida contra o bot e esquema definido em três lugares.

### Agente 2: Especialista em Interface Web Vanilla (HTML5, CSS3 e DOM)

- **Tarefa:** revisão somente leitura de `public/`.
- **Skill utilizada:** [`skills/vanilla-dom-ui/SKILL.md`](./skills/vanilla-dom-ui/SKILL.md)
- **Resultado:** 10 achados.
- **Corrigidos:**
  - A grade de tabuleiros causava rolagem horizontal em telas estreitas (abaixo de cerca de 330 px).
  - O polling da partida parava após um erro de rede e deixava a tela congelada.
  - As grades eram recriadas a cada 3 segundos durante o posicionamento, o que fazia cliques se perderem e a prévia desaparecer. Agora a tela só é redesenhada quando o estado muda.
  - Respostas antigas podiam sobrescrever estado mais recente, e havia mais de uma cadeia de polling em paralelo.
  - Os botões de criar partida e de confirmar frota ficam bloqueados durante a requisição.
  - Mensagens de uma partida anterior permaneciam ao abrir outra.
  - O atributo `role="grid"` sem a estrutura de linhas e células foi removido, porque era ARIA inválida.
- **Não corrigidos:** o rótulo das células não informa acerto ou água a leitores de tela, e o contraste da água não atingida na grade é baixo.

### Agente 3: Agente de Teste e Validação (obrigatório)

- **Tarefa:** testes automatizados das regras de negócio, da API (com um D1 simulado em memória) e execução do validador oficial.
- **Skill utilizada:** [`skills/teste-validacao/SKILL.md`](./skills/teste-validacao/SKILL.md)
- **Entregas:** [`tests/teste-regras.mjs`](./tests/teste-regras.mjs), [`tests/teste-bot.mjs`](./tests/teste-bot.mjs) e [`tests/teste-integracao.mjs`](./tests/teste-integracao.mjs).
- **Resultado:**
  - Regras e bot: passaram.
  - Integração: 15 de 15 testes passaram em 10 rodadas seguidas. Os testes cobrem posicionamento inválido, disparo fora da vez, disparo repetido, coordenada inválida, ocultação da frota do oponente, jogada do bot, placar e partida completa contra o bot, nos dois desfechos (vitória do jogador e vitória do bot).
  - `validar-local.mjs`: 8 de 9 itens. O item 9 (deploy online) depende de acesso à rede e foi confirmado manualmente pelo aluno.
- **Correção durante a validação:** um dos testes de partida completa esperava sempre a vitória do bot e falhava quando o jogador vencia. A asserção foi corrigida para aceitar os dois desfechos. O código do jogo não foi alterado por isso.
- **Limitações:** o D1 é simulado. Ele não reproduz restrições CHECK nem transações do D1 real. Os testes não cobrem o fluxo OAuth com o Discord nem a interface no navegador. A interface foi revisada por leitura de código e checagem de sintaxe, e o teste de dois jogadores em computadores diferentes foi feito manualmente pelo aluno.

## 4. Skills utilizadas

| Skill | Arquivo | Agente que a seguiu | Regra principal |
|---|---|---|---|
| Arquitetura serverless, D1 e Discord OAuth2 | [`skills/serverless-d1-discord/SKILL.md`](./skills/serverless-d1-discord/SKILL.md) | Agente 1 | Validação na borda, consultas parametrizadas e sessão assinada em cookie HttpOnly |
| Interface em Vanilla JS | [`skills/vanilla-dom-ui/SKILL.md`](./skills/vanilla-dom-ui/SKILL.md) | Agente 2 | Sem frameworks de UI, sem sombra em texto e chave no rodapé |
| Teste e validação | [`skills/teste-validacao/SKILL.md`](./skills/teste-validacao/SKILL.md) | Agente 3 | Isolamento da subpasta, testes de rejeição HTTP e validador oficial |

## 5. Pendências conhecidas

- **Atomicidade:** a troca de vez e a gravação do tiro não estão em uma transação do D1 (`batch`). A guarda de vez impede jogadas duplicadas, mas uma falha entre as duas escritas pode deixar a partida presa.
- **Finalização:** o status da partida e o placar são gravados em duas escritas separadas. Uma falha entre elas não é recuperada automaticamente.
- **Partida contra o bot:** não há limite de criação simultânea. O botão fica bloqueado durante a requisição, mas uma requisição repetida ainda pode gerar outra partida.
- **Mensagens de erro:** erros do banco são repassados ao cliente. Isso facilita o diagnóstico, mas expõe detalhes internos.
- **Esquema:** o esquema está definido em três lugares: `migrations/0001_init.sql` (que inclui a tabela `project_records`, não usada pelo jogo), `migrations/0002_batalha.sql` e a constante `SCHEMA` em `src/batalha.js`. A tabela `discord_users` é criada em tempo de execução.
- **Segredo da sessão:** sem `SESSION_SECRET`, a chave de assinatura cai para `DISCORD_CLIENT_SECRET`.

## 6. Como reproduzir a validação

A partir da pasta do projeto:

```bash
node tests/teste-regras.mjs
node tests/teste-bot.mjs
node tests/teste-integracao.mjs
```

A partir da raiz do repositório:

```bash
node validar-local.mjs P26-2C-5981-8AD3-57EA-7556
```
