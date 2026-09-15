/** mailPrioritySubjectRules.service v1.0.0 — CRUD + snapshot "assuntos prioritários" (dispara Agente 4) */
import {
  getMailPrioritySubjectModel,
  type IMailPrioritySubject,
  type MailPrioritySubjectArea,
  type MailPrioritySubjectMatch,
  type MailPrioritySubjectOrgao,
} from '../models/MailPrioritySubject';

export interface MailPrioritySubjectDto {
  id: string;
  area: MailPrioritySubjectArea;
  matchType: MailPrioritySubjectMatch;
  value: string;
  orgao: MailPrioritySubjectOrgao;
  note: string;
  active: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

interface SnapshotRule {
  area: MailPrioritySubjectArea;
  matchType: MailPrioritySubjectMatch;
  value: string;
  orgao: MailPrioritySubjectOrgao;
}

let snapshot: SnapshotRule[] = [];

function toDto(doc: IMailPrioritySubject): MailPrioritySubjectDto {
  return {
    id: doc._id.toString(),
    area: doc.area,
    matchType: doc.matchType,
    value: doc.value,
    orgao: doc.orgao || '',
    note: String(doc.note ?? ''),
    active: doc.active !== false,
    createdBy: doc.createdBy,
    updatedBy: doc.updatedBy,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export async function loadMailPrioritySubjectRules(): Promise<void> {
  const docs = await getMailPrioritySubjectModel().find().lean().exec();
  snapshot = docs
    .filter((d) => d.active !== false)
    .map((d) => ({ area: d.area, matchType: d.matchType, value: d.value, orgao: d.orgao || '' }));
}

export async function reloadMailPrioritySubjectRules(): Promise<void> {
  await loadMailPrioritySubjectRules();
}

export function validateMailPrioritySubjectInput(
  area: string,
  matchType: string,
  value: string,
): { area: MailPrioritySubjectArea; matchType: MailPrioritySubjectMatch; value: string } {
  if (area !== 'assunto' && area !== 'corpo') {
    throw new Error('Área inválida — use "assunto" ou "corpo"');
  }
  if (matchType !== 'igual' && matchType !== 'contem') {
    throw new Error('Critério inválido — use "igual" ou "contem"');
  }
  const trimmed = String(value ?? '').trim();
  if (!trimmed) throw new Error('Valor é obrigatório');
  return { area, matchType, value: trimmed };
}

export interface PrioritySubjectMatchResult {
  matched: boolean;
  rule?: SnapshotRule;
}

function matchesRule(rule: SnapshotRule, assunto: string, corpo: string): boolean {
  const haystack = rule.area === 'assunto' ? assunto : corpo;
  if (!haystack) return false;
  if (rule.matchType === 'igual') {
    return haystack.trim().toLowerCase() === rule.value.trim().toLowerCase();
  }
  return haystack.toLowerCase().includes(rule.value.toLowerCase());
}

export function detectPrioritySubjectMatch(assunto: string, corpo: string): PrioritySubjectMatchResult {
  const a = String(assunto ?? '');
  const c = String(corpo ?? '');
  for (const rule of snapshot) {
    if (matchesRule(rule, a, c)) {
      return { matched: true, rule };
    }
  }
  return { matched: false };
}

export async function listMailPrioritySubjectRules(): Promise<MailPrioritySubjectDto[]> {
  const docs = await getMailPrioritySubjectModel().find().sort({ createdAt: -1 }).exec();
  return docs.map(toDto);
}

const VALID_SUBJECT_ORGAOS = new Set<MailPrioritySubjectOrgao>([
  'reclame_aqui', 'procon', 'bacen', 'consumidor_gov', '',
]);

export async function createMailPrioritySubjectRule(
  input: { area: string; matchType: string; value: string; note?: string; orgao?: string },
  actor: string,
): Promise<MailPrioritySubjectDto> {
  const { area, matchType, value } = validateMailPrioritySubjectInput(
    input.area,
    input.matchType,
    input.value,
  );
  const orgao = String(input.orgao ?? '').trim() as MailPrioritySubjectOrgao;
  if (!VALID_SUBJECT_ORGAOS.has(orgao)) throw new Error('Órgão inválido');
  const Model = getMailPrioritySubjectModel();

  const exists = await Model.findOne({ area, matchType, value }).exec();
  if (exists) throw new Error('Regra já cadastrada');

  const doc = await Model.create({
    area,
    matchType,
    value,
    orgao,
    note: String(input.note ?? '').trim(),
    active: true,
    createdBy: actor,
    updatedBy: actor,
  });

  await reloadMailPrioritySubjectRules();
  return toDto(doc);
}

export async function patchMailPrioritySubjectRule(
  id: string,
  patch: { active?: boolean; note?: string },
  actor: string,
): Promise<MailPrioritySubjectDto | null> {
  const Model = getMailPrioritySubjectModel();
  const doc = await Model.findById(id).exec();
  if (!doc) return null;

  if (typeof patch.active === 'boolean') doc.active = patch.active;
  if (patch.note !== undefined) doc.note = String(patch.note ?? '').trim();
  doc.updatedBy = actor;
  await doc.save();
  await reloadMailPrioritySubjectRules();
  return toDto(doc);
}

/** Expõe snapshot para testes unitários */
export function setMailPrioritySubjectSnapshotForTests(next: SnapshotRule[]): void {
  snapshot = next;
}

export async function deleteMailPrioritySubjectRule(id: string): Promise<boolean> {
  const Model = getMailPrioritySubjectModel();
  const result = await Model.findByIdAndDelete(id).exec();
  if (!result) return false;
  await reloadMailPrioritySubjectRules();
  return true;
}
