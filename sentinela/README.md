# Sentinela Velodesk — versão Vercel

Versão auto-hospedada do dashboard de monitoramento do QA (Claudio Q.A.),
como alternativa ao Artifact do Claude. Site estático + 1 função serverless,
sem banco de dados próprio — busca o resultado direto do backend do Velodesk
a cada carregamento (~60s de polling).

**VERSION: v1.0.0 | DATE: 2026-09-17**

## Como funciona

```
index.html  →  fetch('/api/dados')  →  api/dados.js  →  backend do Velodesk
(navegador)                            (servidor,           (produção)
                                      guarda o segredo)
```

`api/dados.js` é uma função serverless da Vercel: guarda o segredo
`x-inbound-qa-teste-secret` do lado do servidor e chama as 2 rotas de leitura
que já existem em produção (`GET /api/inbound/qa-sentinela/estado` e
`.../runs`) — as mesmas que o dashboard no Artifact do Claude usa. O
navegador nunca vê o segredo.

Sem banco de dados, sem sincronização manual: cada carregamento da página
busca o dado mais recente na hora.

## Deploy no Vercel

1. Criar um novo projeto no Vercel apontando pra esta pasta (`sentinela/`)
   como root directory — igual já é feito pra `frontend/`.
2. Em **Settings → Environment Variables**, adicionar:

   | Variável | Valor |
   |---|---|
   | `QA_INBOUND_QA_TESTE_SECRET` | o mesmo segredo já usado pelo agente de QA (35 caracteres `[a-z0-9]`) |
   | `QA_BASE_URL` | opcional — só se a API não estiver em `https://velodesk-278491073220.us-east1.run.app` |

3. Deploy. Sem build step (é HTML estático + 1 função `/api`), então não
   precisa de `vercel.json` nem `package.json` com dependências.

## Por que não usa banco de dados

O Artifact do Claude guarda o estado num banco embutido, atualizado por uma
sessão do Claude ou pela própria página. Essa versão não precisa disso: como
o backend do Velodesk já expõe o dado via API, a página busca direto na hora
— mais simples, e sempre atualizado (sem depender de nenhuma sincronização
rodando por trás).

## Relação com o Artifact do Claude

Essa versão **não substitui automaticamente** o Artifact — as duas podem
coexistir enquanto o time decide qual fica como referência oficial. Nenhuma
mudança aqui afeta o dashboard publicado em claude.ai.
