/** test-casos-especiais-precheck.ts v1.1.0 — smoke do pre-check Agente 4 (sem LLM/DB) */
import type { IChamadoN1 } from '../src/models/ChamadoN1';
import { detectCasoEspecialSignal } from '../src/services/agents/casosEspeciaisPrecheck';
import { setMailPrioritySubjectSnapshotForTests } from '../src/services/mailPrioritySubjectRules.service';

function mockChamado(partial: Partial<IChamadoN1>): IChamadoN1 {
  return {
    chamadoProtocolo: 'VD-20260807-0001',
    chamadoTitulo: partial.chamadoTitulo ?? '',
    cliente: [],
    tabulacao: partial.tabulacao ?? [{
      tipoChamado: 'Solicitação',
      produto: '',
      motivo: '',
      detalhe: '',
      responsavel: '',
      atribuido: '',
    }],
    registro: partial.registro ?? [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  } as IChamadoN1;
}

const cases: Array<{ name: string; chamado: IChamadoN1; expect: { triggered: boolean; fastPath?: boolean } }> = [
  {
    name: 'E-mail institucional Procon',
    chamado: mockChamado({
      registro: [{
        data: new Date(),
        origin: 'cliente',
        autor: 'Procon SP',
        mensagemPublica: 'Notificação de demanda registrada protocolo 12345',
        anexosMensagemPublica: [],
        anotacaoInterna: '',
        anexosAnotacaoInterna: [],
        alteracoes: [],
        metadados: { emailFrom: 'notificacoes@procon.sp.gov.br', source: 'email-inbound' },
        status: 'novo',
      }],
    }),
    expect: { triggered: true, fastPath: false },
  },
  {
    name: 'Ameaça cliente — vou no Procon (sem regra cadastrada em Config)',
    chamado: mockChamado({
      chamadoTitulo: 'Reclamação',
      registro: [{
        data: new Date(),
        origin: 'cliente',
        autor: 'Cliente',
        mensagemPublica: 'Se não resolver vou no Procon',
        anexosMensagemPublica: [],
        anotacaoInterna: '',
        anexosAnotacaoInterna: [],
        alteracoes: [],
        metadados: { source: 'email-inbound', emailFrom: 'cliente@gmail.com' },
        status: 'novo',
      }],
    }),
    // Gatilho por palavra-chave livre no corpo saiu do código (vive só em Config > E-mail >
    // Assuntos Prioritários) — sem regra cadastrada, uma menção solta no corpo não dispara
    // o Agente 4 sozinha. Ver caso seguinte para o cenário com regra cadastrada.
    expect: { triggered: false },
  },
  {
    name: 'Menção a Bacen com regra de Assunto Prioritário cadastrada — dispara mas NÃO faz fast-path',
    chamado: mockChamado({
      chamadoTitulo: 'Dúvida',
      registro: [{
        data: new Date(),
        origin: 'cliente',
        autor: 'Cliente',
        mensagemPublica: 'Vocês seguem alguma regra do Banco Central pra isso?',
        anexosMensagemPublica: [],
        anotacaoInterna: '',
        anexosAnotacaoInterna: [],
        alteracoes: [],
        metadados: { source: 'email-inbound', emailFrom: 'cliente@gmail.com' },
        status: 'novo',
      }],
    }),
    // Regressão que causava classificação errada em produção: uma regra de Assunto Prioritário
    // com órgão definido ("contém" no corpo) pulava direto pro fast-path (caso_formal_real),
    // sem passar pelo LLM — mesmo sendo só uma citação retórica, não notificação nem ameaça.
    // Precheck deve disparar o Agente 4 (LLM decide), mas nunca fast-pathear por conteúdo.
    expect: { triggered: true, fastPath: false },
  },
  {
    name: 'Falso positivo — proconcurso',
    chamado: mockChamado({
      registro: [{
        data: new Date(),
        origin: 'cliente',
        autor: 'Cliente',
        mensagemPublica: 'Estou estudando para proconcurso federal',
        anexosMensagemPublica: [],
        anotacaoInterna: '',
        anexosAnotacaoInterna: [],
        alteracoes: [],
        metadados: { source: 'email-inbound' },
        status: 'novo',
      }],
    }),
    expect: { triggered: false },
  },
  {
    name: 'Canal formal RA já carimbado',
    chamado: mockChamado({
      registro: [{
        data: new Date(),
        origin: 'cliente',
        autor: 'Consumidor',
        mensagemPublica: 'Reclamação publicada',
        anexosMensagemPublica: [],
        anotacaoInterna: '',
        anexosAnotacaoInterna: [],
        alteracoes: [],
        metadados: { source: 'reclame-aqui' },
        status: 'novo',
      }],
    }),
    expect: { triggered: true },
  },
  {
    name: 'Ticket comum sem sinal',
    chamado: mockChamado({
      registro: [{
        data: new Date(),
        origin: 'cliente',
        autor: 'Cliente',
        mensagemPublica: 'Como altero meu e-mail cadastrado?',
        anexosMensagemPublica: [],
        anotacaoInterna: '',
        anexosAnotacaoInterna: [],
        alteracoes: [],
        metadados: { source: 'email-inbound' },
        status: 'novo',
      }],
    }),
    expect: { triggered: false },
  },
];

// Simula uma regra cadastrada em Config > E-mail > Assuntos Prioritários (área=corpo,
// critério=contém) com órgão definido, sem precisar de conexão real ao desk_config.
setMailPrioritySubjectSnapshotForTests([
  { area: 'corpo', matchType: 'contem', value: 'banco central', orgao: 'bacen' },
]);

let failed = 0;

for (const item of cases) {
  const result = detectCasoEspecialSignal(item.chamado);
  const okTriggered = result.triggered === item.expect.triggered;
  const okFast = item.expect.fastPath === undefined || result.fastPathReal === item.expect.fastPath;
  const ok = okTriggered && okFast;
  if (!ok) failed += 1;
  console.log(`${ok ? 'OK' : 'FAIL'} — ${item.name}`, {
    triggered: result.triggered,
    fastPathReal: result.fastPathReal,
    origemProvavel: result.origemProvavel,
    signals: result.signals,
  });
}

if (failed > 0) {
  console.error(`\n${failed} cenário(s) falharam`);
  process.exit(1);
}

console.log('\nTodos os cenários de pre-check passaram.');
