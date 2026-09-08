# Aba "Consulta" — resultado real da API (protocolos 2609030007, 2609030014, 2609030009)

Consulta executada **agora** (03/09/2026) diretamente contra a API real `https://customer-data.velotax.com.br`, usando o serviço [backend/src/services/customerDataApi.service.ts](../backend/src/services/customerDataApi.service.ts) com os CPFs dos clientes de cada ticket. Health check: `configured: true`, `upstreamStatus: Up`.

⚠️ Isso é uma **foto atual** do cadastro/contratos desses clientes, não o dado exato que a API teria devolvido no momento em que o atendente abriu a aba Consulta (a resposta não é persistida — ver observação no fim). Como as ligações foram feitas hoje mesmo, a diferença deve ser mínima, mas qualquer pagamento/atualização entre o atendimento e agora já estaria refletida aqui.

JSON bruto completo: [docs/tmp-consulta-360-real-output.json](tmp-consulta-360-real-output.json)

---

## Protocolo 2609030007 — CPF 057.505.316-00 (Ines Aparecida de Oliveira Santos)

**O que o atendente disse no ticket:** "Deseja empréstimo. Ciente que a oferta não está disponível. Aguardar até 30 dias." (tabulação: Empréstimo Pessoal → Elegibilidade)

**O que a API realmente retornou:**
- Cadastro: ativa, origem `IRPF-MOBILE`, criada em 06/05/2026, e-mail `inesaparecida106@gmail.com`, telefone `32999264941`.
- Flags de produto: só tem histórico de **Empréstimo Pessoal** (`emprestimoPessoal: true`); nenhum outro produto.
- Contrato de Empréstimo Pessoal: 1 contrato **quitado** (`PAID`/Emitido), nº 4560578, principal R$ 350,00, total devido R$ 703,28, desembolsado em 06/05/2026, 4 parcelas — todas pagas (a última paga hoje, 03/09).
- Elegibilidade para novo crédito: `available: false`, `reasonCode: not_available`, "Crédito não disponível no momento", com `expiresAt` (nova checagem) em 03/10/2026.

**Conferência:** a informação passada pelo atendente bate com a API — cliente já quitou o empréstimo anterior e não está elegível para novo crédito agora; o prazo de reavaliação real informado pela API é **03/10/2026** (≈30 dias), consistente com o que foi dito ao cliente.

---

## Protocolo 2609030014 — CPF 811.983.020-20 (Alexsandro Mello)

**O que o atendente disse no ticket:** "opção [Antecipação de Salário] não está disponível para contratação... orientado a aguardar a disponibilização do serviço em seu aplicativo" (produto novo, em fase de testes).

**O que a API realmente retornou:**
- Cadastro: ativo, origem `IRPF-MOBILE`, criado em 18/07/2026, e-mail `fgcell724@gmail.com`, telefone `51992913411`.
- Flags de produto: só tem histórico de **Antecipação de Salário** (`antecipacaoSalario: true`).
- Contrato de Antecipação de Salário: 1 contrato **quitado** (`PAID`/Emitido), nº 8268989, principal R$ 50,00, total devido R$ 74,69, desembolsado em 14/08/2026, parcela única paga em 02/09/2026.
- Elegibilidade para nova antecipação: `available: false`, `reasonCode: not_available`, "Crédito não disponível no momento" (sem `expiresAt` neste caso).

**Conferência:** aqui há uma diferença relevante — o cliente **já contratou e quitou** uma Antecipação de Salário em agosto/2026. A explicação do atendente ("produto novo, ainda não disponível para contratação") não reflete o que a API mostra: o produto está disponível e o cliente já usou; o que está indisponível agora é uma **nova rodada de crédito** (elegibilidade `false`), não o produto em si. Vale revisar esse atendimento — a orientação dada pode ter confundido "sem oferta de crédito no momento" com "produto ainda não lançado".

---

## Protocolo 2609030009 — CPF 131.075.734-85 (Iranilda Maria dos Santos Oliveira)

**O que o atendente disse no ticket:** "será realizada uma nova tentativa de depósito ao longo do dia... aguardar e acompanhar a conta no aplicativo do banco" (dúvida sobre recebimento da Antecipação de Salário).

**O que a API realmente retornou:**
- Cadastro: ativa, origem `VELOTAX-WEB`, criada em 27/06/2026, e-mail `lann.santos323@gmail.com`, telefone `87996777619`.
- Flags de produto: só **Antecipação de Salário** (`antecipacaoSalario: true`).
- Contratos de Antecipação de Salário (2):
  1. Nº 8806674 — R$ 50,00, quitado (`PAID`), desembolsado em 24/08/2026, parcela paga em 02/09/2026.
  2. Nº 9386217 — R$ 50,00, status **"Em andamento" com `providerStatus: DISBURSEMENT_ATTEMPT_FAILED` ("Erro ao desembolsar")**, desembolso tentado em 03/09/2026, próxima parcela prevista para 11/09/2026 ainda não paga.
- Elegibilidade para nova antecipação: `available: false`, "Crédito não disponível no momento", `expiresAt` 13/09/2026.

**Conferência:** a informação do atendente está **coerente com a API** — há de fato uma tentativa de desembolso que falhou (`DISBURSEMENT_ATTEMPT_FAILED`) no contrato 9386217, aberto hoje. A orientação de aguardar nova tentativa de depósito está alinhada ao status real (o contrato ainda está "em andamento", não foi cancelado).

---

## Observações finais

- A API não retorna nenhum campo relativo à ligação/URA em si (isso é dado do próprio ticket, não da Consulta 360).
- Nenhum dos 3 clientes tem produtos de IRPF, Clube Velotax, Seguros ou Crédito Trabalhador — todos os flags desses produtos vieram `false`.
- Estrutura completa de cada contrato retornado: `productType, principal, totalAmountDue, disbursedAt, contractStatus, contractStatusLabel, providerStatus, providerStatusLabel, contractNumber, hasInsurance, financeFee, installments[], nextInstallment?, paidInstallmentNumbers[]`; e de cada parcela: `number, dueDate, amountDue, amountPaid, paid, paidAt?, paymentType?, status`.
- Assim como levantado antes: essa chamada não fica registrada em log/banco depois de feita — este documento e o JSON anexo são o único registro do que a API respondeu neste momento.
