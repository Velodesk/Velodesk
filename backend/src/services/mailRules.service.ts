/** mailRules.service v1.0.1 — CRUD + snapshot inbound mail_ignorado/spam/priority */
import type { Model } from 'mongoose';
import type { IMailRule, MailRuleType } from '../models/mailRule.shared';
import { getMailIgnoradoModel } from '../models/MailIgnorado';
import { getMailSpamModel } from '../models/MailSpam';
import { getMailPriorityModel } from '../models/MailPriority';
import { normalizeEmail } from './cliente.service';
import type { InboundEmailPayload } from './inbound-email/types';

export type MailRulesListKey = 'ignorado' | 'spam' | 'priority';

export type MailRuleMatch = 'spam' | 'ignored' | 'priority';

export interface MailRuleDto {
  id: string;
  type: MailRuleType;
  value: string;
  note: string;
  active: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

interface RuleSnapshot {
  emails: Set<string>;
  domains: Set<string>;
}

interface MailRulesSnapshot {
  ignorado: RuleSnapshot;
  spam: RuleSnapshot;
  priority: RuleSnapshot;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let snapshot: MailRulesSnapshot = {
  ignorado: { emails: new Set(), domains: new Set() },
  spam: { emails: new Set(), domains: new Set() },
  priority: { emails: new Set(), domains: new Set() },
};

function emptySnapshot(): MailRulesSnapshot {
  return {
    ignorado: { emails: new Set(), domains: new Set() },
    spam: { emails: new Set(), domains: new Set() },
    priority: { emails: new Set(), domains: new Set() },
  };
}

function listKeyToModel(list: MailRulesListKey): Model<IMailRule> {
  if (list === 'ignorado') return getMailIgnoradoModel();
  if (list === 'spam') return getMailSpamModel();
  return getMailPriorityModel();
}

export function normalizeMailRuleDomain(raw: string): string {
  const trimmed = String(raw ?? '').trim().toLowerCase();
  if (!trimmed) return '';
  return trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
}

export function normalizeMailRuleValue(type: MailRuleType, raw: string): string {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return '';
  if (type === 'domain') return normalizeMailRuleDomain(value);
  return normalizeEmail(value);
}

export function validateMailRuleInput(type: MailRuleType, raw: string): string {
  const value = normalizeMailRuleValue(type, raw);
  if (!value) throw new Error('Valor da regra é obrigatório');
  if (type === 'email' && !EMAIL_RE.test(value)) {
    throw new Error('E-mail inválido');
  }
  if (type === 'domain') {
    if (!value.includes('.') || value.includes('@')) {
      throw new Error('Domínio inválido');
    }
  }
  return value;
}

function toDto(doc: IMailRule): MailRuleDto {
  return {
    id: doc._id.toString(),
    type: doc.type,
    value: doc.value,
    note: String(doc.note ?? ''),
    active: doc.active !== false,
    createdBy: doc.createdBy,
    updatedBy: doc.updatedBy,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

interface MailRuleSnapshotDoc {
  type: MailRuleType;
  value: string;
  active?: boolean;
}

function applyDocsToSnapshot(list: MailRulesListKey, docs: MailRuleSnapshotDoc[], target: MailRulesSnapshot) {
  const bucket = target[list];
  bucket.emails.clear();
  bucket.domains.clear();
  docs.forEach((doc) => {
    if (doc.active === false) return;
    if (doc.type === 'email') bucket.emails.add(doc.value);
    else bucket.domains.add(doc.value);
  });
}

export async function loadMailRules(): Promise<void> {
  const [ignorado, spam, priority] = await Promise.all([
    getMailIgnoradoModel().find().lean().exec(),
    getMailSpamModel().find().lean().exec(),
    getMailPriorityModel().find().lean().exec(),
  ]);

  const next = emptySnapshot();
  applyDocsToSnapshot('ignorado', ignorado, next);
  applyDocsToSnapshot('spam', spam, next);
  applyDocsToSnapshot('priority', priority, next);
  snapshot = next;
}

export async function reloadMailRules(): Promise<void> {
  await loadMailRules();
}

function matchesBucket(email: string, domain: string, bucket: RuleSnapshot): boolean {
  if (bucket.emails.has(email)) return true;
  if (domain && bucket.domains.has(domain)) return true;
  return false;
}

export function isPriorityEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const domain = normalized.includes('@') ? normalized.split('@')[1] : '';
  return matchesBucket(normalized, domain, snapshot.priority);
}

export function matchMailRule(payload: InboundEmailPayload): MailRuleMatch | null {
  const email = normalizeEmail(payload.from.email);
  if (!email) return null;
  const domain = email.includes('@') ? email.split('@')[1] : '';

  if (matchesBucket(email, domain, snapshot.spam)) return 'spam';
  if (matchesBucket(email, domain, snapshot.ignorado)) return 'ignored';
  if (matchesBucket(email, domain, snapshot.priority)) return 'priority';
  return null;
}

export async function listMailRules(list: MailRulesListKey): Promise<MailRuleDto[]> {
  const Model = listKeyToModel(list);
  const docs = await Model.find().sort({ createdAt: -1 }).exec();
  return docs.map(toDto);
}

export async function createMailRule(
  list: MailRulesListKey,
  input: { type: MailRuleType; value: string; note?: string },
  actor: string,
): Promise<MailRuleDto> {
  const type = input.type;
  if (type !== 'email' && type !== 'domain') {
    throw new Error('Tipo de regra inválido');
  }
  const value = validateMailRuleInput(type, input.value);
  const Model = listKeyToModel(list);

  const exists = await Model.findOne({ type, value }).exec();
  if (exists) throw new Error('Regra já cadastrada');

  const doc = await Model.create({
    type,
    value,
    note: String(input.note ?? '').trim(),
    active: true,
    createdBy: actor,
    updatedBy: actor,
  });

  await reloadMailRules();
  return toDto(doc);
}

export async function deleteMailRule(list: MailRulesListKey, id: string): Promise<boolean> {
  const Model = listKeyToModel(list);
  const result = await Model.findByIdAndDelete(id).exec();
  if (!result) return false;
  await reloadMailRules();
  return true;
}

export async function patchMailRule(
  list: MailRulesListKey,
  id: string,
  patch: { active?: boolean; note?: string },
  actor: string,
): Promise<MailRuleDto | null> {
  const Model = listKeyToModel(list);
  const doc = await Model.findById(id).exec();
  if (!doc) return null;

  if (typeof patch.active === 'boolean') doc.active = patch.active;
  if (patch.note !== undefined) doc.note = String(patch.note ?? '').trim();
  doc.updatedBy = actor;
  await doc.save();
  await reloadMailRules();
  return toDto(doc);
}

/** Expõe snapshot para testes unitários */
export function getMailRulesSnapshotForTests(): MailRulesSnapshot {
  return snapshot;
}

export function setMailRulesSnapshotForTests(next: MailRulesSnapshot): void {
  snapshot = next;
}
