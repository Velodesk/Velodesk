/** legadoOcta.routes v1.0.0 — leitura do arquivo legado Octadesk, somente consulta */
import { Router, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import type { AuthPayload } from '../middleware/auth';
import { permissionMiddleware } from '../middleware/permission';
import { connectLegacyOcta } from '../config/legacyOctaConnection';
import { getTicketLegadoOctaModel } from '../models/TicketLegadoOcta';
import { getWhatsappLegadoOctaModel } from '../models/WhatsappLegadoOcta';
import { Types } from 'mongoose';

const router = Router();

const ACESSO_MODULO = 'acesso';
const ACESSO_KEY = 'legado-octa';

router.use(authMiddleware);
router.use(permissionMiddleware(ACESSO_MODULO, ACESSO_KEY));

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;

function onlyDigits(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

router.get('/tickets', async (req, res: Response<unknown, { user?: AuthPayload }>) => {
  await connectLegacyOcta();
  const Model = getTicketLegadoOctaModel();

  const cpf = onlyDigits(String(req.query.cpf || ''));
  const protocolo = onlyDigits(String(req.query.protocolo || ''));
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Number(req.query.pageSize) || PAGE_SIZE_DEFAULT));

  const filter: Record<string, unknown> = {};
  if (cpf) filter.requesterCpf = cpf;
  if (protocolo) {
    // Correspondência exata (índice) — protocoloExibicao já é zero-padded a 10 dígitos.
    // $regex sem âncora aqui faria full scan nos 252 mil docs (medido: consulta nunca retorna).
    filter.$or = [
      { protocoloExibicao: protocolo.padStart(10, '0') },
      { octadeskNumber: Number(protocolo) || -1 },
    ];
  }

  const [items, total] = await Promise.all([
    Model.find(filter, {
      octadeskNumber: 1,
      protocoloExibicao: 1,
      summary: 1,
      topicGroupName: 1,
      topicName: 1,
      requesterName: 1,
      requesterCpf: 1,
      openDate: 1,
    })
      .sort({ openDate: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    Model.countDocuments(filter),
  ]);

  res.json({ items, total, page, pageSize });
});

router.get('/tickets/:number', async (req, res: Response<unknown, { user?: AuthPayload }>) => {
  await connectLegacyOcta();
  const Model = getTicketLegadoOctaModel();

  const octadeskNumber = Number(req.params.number);
  if (!Number.isFinite(octadeskNumber)) {
    return res.status(400).json({ message: 'Número de ticket inválido' });
  }

  const ticket = await Model.findOne({ octadeskNumber }).lean();
  if (!ticket) {
    return res.status(404).json({ message: 'Ticket legado não encontrado' });
  }

  res.json(ticket);
});

router.get('/whatsapp', async (req, res: Response<unknown, { user?: AuthPayload }>) => {
  await connectLegacyOcta();
  const Model = getWhatsappLegadoOctaModel();

  const cpf = onlyDigits(String(req.query.cpf || ''));
  const phone = onlyDigits(String(req.query.phone || ''));
  const protocolo = String(req.query.protocolo || '').trim().toUpperCase();
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Number(req.query.pageSize) || PAGE_SIZE_DEFAULT));

  const filter: Record<string, unknown> = {};
  if (cpf) filter.clientCpf = cpf;
  if (phone) filter.clientPhone = phone;
  if (protocolo) filter.protocoloExibicao = protocolo;

  const [items, total] = await Promise.all([
    Model.find(filter, {
      octadeskRoomId: 1,
      protocoloExibicao: 1,
      clientName: 1,
      clientPhone: 1,
      clientCpf: 1,
      startedAt: 1,
      lastMessageAt: 1,
    })
      .sort({ lastMessageAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    Model.countDocuments(filter),
  ]);

  res.json({ items, total, page, pageSize });
});

router.get('/whatsapp/:id', async (req, res: Response<unknown, { user?: AuthPayload }>) => {
  await connectLegacyOcta();
  const Model = getWhatsappLegadoOctaModel();

  const id = String(req.params.id || '');
  const filter = Types.ObjectId.isValid(id) ? { _id: id } : { octadeskRoomId: id };
  const conversa = await Model.findOne(filter).lean();
  if (!conversa) {
    return res.status(404).json({ message: 'Conversa legada não encontrada' });
  }

  res.json(conversa);
});

router.get('/search', async (req, res: Response<unknown, { user?: AuthPayload }>) => {
  await connectLegacyOcta();
  const TicketModel = getTicketLegadoOctaModel();
  const WhatsappModel = getWhatsappLegadoOctaModel();

  const q = onlyDigits(String(req.query.q || ''));
  if (!q) return res.json({ tickets: [], whatsapp: [] });

  const ticketFilter = {
    $or: [
      { requesterCpf: q },
      { protocoloExibicao: q.padStart(10, '0') },
      { octadeskNumber: Number(q) || -1 },
    ],
  };
  const whatsappFilter = {
    $or: [
      { clientCpf: q },
      { clientPhone: q },
      { protocoloExibicao: q.toUpperCase() },
    ],
  };

  const [tickets, whatsapp] = await Promise.all([
    TicketModel.find(ticketFilter, {
      octadeskNumber: 1, protocoloExibicao: 1, summary: 1, requesterName: 1, requesterCpf: 1, openDate: 1,
    }).limit(PAGE_SIZE_DEFAULT).lean(),
    WhatsappModel.find(whatsappFilter, {
      octadeskRoomId: 1, protocoloExibicao: 1, clientName: 1, clientCpf: 1, clientPhone: 1, lastMessageAt: 1,
    }).limit(PAGE_SIZE_DEFAULT).lean(),
  ]);

  res.json({ tickets, whatsapp });
});

export default router;
