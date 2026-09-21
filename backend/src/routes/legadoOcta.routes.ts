/** legadoOcta.routes v1.0.0 — leitura do arquivo legado Octadesk, somente consulta */
import { Router, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import type { AuthPayload } from '../middleware/auth';
import { permissionMiddleware } from '../middleware/permission';
import { connectLegacyOcta } from '../config/legacyOctaConnection';
import { getTicketLegadoOctaModel } from '../models/TicketLegadoOcta';

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

export default router;
