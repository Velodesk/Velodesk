/** workflowConfigSeed v2.0.0 — seed reembolso-7dias em bifurcação real (rotas com passos aninhados); repairReprovacaoSemDestino removida (superada pela migração migrate-workflow-rotas-to-nested) */
import { Types } from 'mongoose';
import { getGrupoResponsabilidadeModel } from '../models/GrupoResponsabilidade';
import { getWorkflowDefinicaoModel, IWorkflowDefinicao } from '../models/WorkflowDefinicao';
import { DEFAULT_GRUPOS, invalidateGrupoCache } from './grupoResponsabilidade.service';
import { invalidateWorkflowCache } from './workflowDefinicao.service';

function isAberturaPasso(nome?: string): boolean {
  const n = String(nome || '').trim().toLowerCase();
  return n === 'abertura' || n.startsWith('abertura n1') || n.includes('ticket criado') || n.includes('início — ticket');
}

async function repairWorkflowPassos(doc: IWorkflowDefinicao): Promise<boolean> {
  const passos = [...(doc.passos || [])].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  const filtered = passos.filter((p) => !isAberturaPasso(p.passo?.nome));
  if (filtered.length === 0 || filtered.length === passos.length) {
    const first = passos[0];
    if (first?._id && String(doc.passoInicialId || '') !== String(first._id)) {
      doc.passoInicialId = first._id;
      await doc.save();
    }
    return true;
  }

  filtered.forEach((p, index) => {
    p.ordem = index;
  });
  doc.passos = filtered;
  doc.passoInicialId = filtered[0]?._id ?? null;
  await doc.save();
  return true;
}

/**
 * Casos especiais (Bacen/Procon/Consumidor.Gov/Reclame Aqui) não usam workflow dedicado por órgão:
 * migrar o ticket para a collection chamados_reclamacoes do órgão já contextualiza o caso. O ticket
 * segue elegível a qualquer workflow real (ex.: reembolso) cuja tabulação combine com o gatilho.
 * Desativa (não apaga — histórico de tickets que já rodaram por aqui continua íntegro) os 4
 * workflows "*-tratativa" que tinham gatilho por canal (Bacen/Procon/RA/Consumidor.Gov).
 */
const CASOS_ESPECIAIS_TRATATIVA_WORKFLOW_SLUGS = [
  'reclame-aqui-tratativa',
  'procon-tratativa',
  'consumidor-gov-tratativa',
  'bacen-tratativa',
] as const;

async function deactivateCasosEspeciaisTratativaWorkflows(): Promise<void> {
  const Workflow = getWorkflowDefinicaoModel();
  const result = await Workflow.updateMany(
    { slug: { $in: [...CASOS_ESPECIAIS_TRATATIVA_WORKFLOW_SLUGS] }, ativo: { $ne: false } },
    { $set: { ativo: false, updatedBy: 'seed' } },
  );
  if (result.modifiedCount) {
    console.log(`Seed: ${result.modifiedCount} workflow(s) *-tratativa desativado(s) (casos especiais sem workflow dedicado)`);
  }
}

export async function seedWorkflowConfig(): Promise<void> {
  await deactivateCasosEspeciaisTratativaWorkflows();

  const Grupo = getGrupoResponsabilidadeModel();
  const grupoCount = await Grupo.countDocuments();
  if (grupoCount === 0) {
    await Grupo.insertMany(
      DEFAULT_GRUPOS.map((g) => ({ ...g, updatedBy: 'seed' })),
    );
    console.log(`Seed: ${DEFAULT_GRUPOS.length} grupo(s) de responsabilidade criados`);
  } else {
    for (const grupo of DEFAULT_GRUPOS) {
      const exists = await Grupo.findOne({ slug: grupo.slug }).select('_id').lean();
      if (!exists) {
        await Grupo.create({ ...grupo, updatedBy: 'seed' });
        console.log(`Seed: grupo ${grupo.slug} criado`);
      }
    }
  }

  const Workflow = getWorkflowDefinicaoModel();
  const wfExists = await Workflow.findOne({ slug: 'reembolso-7dias' }).select('_id').lean();
  if (!wfExists) {
    const passoElegibilidadeId = new Types.ObjectId();
    const passoAprovacaoId = new Types.ObjectId();

    await Workflow.create({
      slug: 'reembolso-7dias',
      titulo: 'REEMBOLSO DENTRO DOS 7 DIAS',
      descricao: 'Fluxo de reembolso com aprovação financeira',
      ordem: 0,
      ativo: true,
      gatilho: {
        tipo: 'tabulacao',
        criterios: [
          { fonte: 'tabulacao', campo: 'tipoChamado', operador: 'equals', valor: 'Solicitação' },
          { fonte: 'tabulacao', campo: 'produto', operador: 'contains', valor: 'produto x' },
          { fonte: 'tabulacao', campo: 'motivo', operador: 'contains', valor: 'reembolso' },
        ],
      },
      passos: [
        {
          _id: passoElegibilidadeId,
          ordem: 0,
          passo: {
            nome: 'Elegibilidade',
            descricao: 'N1 confirma elegibilidade do reembolso.',
            slaHoras: 2,
            atribuicao: { tipo: 'funcao', funcaoSlug: 'atendimento', grupoSlug: '', colaborador: '' },
            acao: { tipo: 'manual', rotas: [] },
          },
        },
        {
          _id: passoAprovacaoId,
          ordem: 1,
          passo: {
            nome: 'Aprovação financeiro',
            descricao: 'Financeiro analisa e decide.',
            slaHoras: 4,
            atribuicao: { tipo: 'funcao', funcaoSlug: 'financeiro', grupoSlug: '', colaborador: '' },
            acao: {
              tipo: 'aprovacao',
              // Bifurcação real: cada rota tem sua própria sub-sequência de etapas — não
              // compartilham array, então reprovação nunca corre risco de cair no
              // "Estorno processado" (etapa exclusiva do caminho de aprovação).
              rotas: [
                {
                  variavel: 'approve',
                  rotulo: 'Aprovar',
                  statusTicket: 'em-andamento',
                  passos: [
                    {
                      ordem: 0,
                      passo: {
                        nome: 'Estorno processado',
                        descricao: 'Financeiro processa estorno.',
                        slaHoras: 8,
                        atribuicao: { tipo: 'funcao', funcaoSlug: 'financeiro', grupoSlug: '', colaborador: '' },
                        acao: { tipo: 'manual', rotas: [] },
                      },
                    },
                    {
                      ordem: 1,
                      passo: {
                        nome: 'Retorno ao cliente',
                        descricao: 'N1 comunica resultado ao cliente.',
                        slaHoras: 2,
                        atribuicao: { tipo: 'funcao', funcaoSlug: 'atendimento', grupoSlug: '', colaborador: '' },
                        acao: { tipo: 'manual', rotas: [] },
                      },
                    },
                  ],
                },
                {
                  variavel: 'reject',
                  rotulo: 'Reprovar',
                  statusTicket: 'pendente',
                  // Reprovação nunca cai numa etapa automática nem no estorno: vai direto
                  // para a devolutiva manual, num nó próprio deste ramo.
                  passos: [
                    {
                      ordem: 0,
                      passo: {
                        nome: 'Retorno ao cliente',
                        descricao: 'N1 comunica resultado ao cliente.',
                        slaHoras: 2,
                        atribuicao: { tipo: 'funcao', funcaoSlug: 'atendimento', grupoSlug: '', colaborador: '' },
                        acao: { tipo: 'manual', rotas: [] },
                      },
                    },
                  ],
                },
                { variavel: 'request_info', rotulo: 'Pedir informação', statusTicket: 'pendente', passos: [] },
              ],
            },
          },
        },
      ],
      passoInicialId: passoElegibilidadeId,
      updatedBy: 'seed',
    });

    console.log('Seed: workflow reembolso-7dias criado');
  }

  // ENCAMINHAMENTO / escalonar-* NÃO são mais seedados nem recriados no startup.
  // Criação e remoção ficam a cargo do responsável da área (config de workflows).

  const repairSlugs = ['reembolso-7dias'];
  for (const slug of repairSlugs) {
    const doc = await Workflow.findOne({ slug });
    if (doc) {
      await repairWorkflowPassos(doc);
    }
  }

  invalidateGrupoCache();
  invalidateWorkflowCache();
}
