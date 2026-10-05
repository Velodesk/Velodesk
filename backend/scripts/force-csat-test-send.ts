/**
 * force-csat-test-send — cria um ticket temporário resolvido pra <email>, força o envio do
 * CSAT inicial e da repescagem, e remove o ticket no final. Uso pontual de teste, a pedido do
 * usuário — roda contra o Mongo do ambiente atual (respeita backend/.env).
 */
import { connectDatabase } from '../src/config/database';
import { ChamadoN1 } from '../src/models/ChamadoN1';
import { sendCsatEmailAsync, sendCsatRepescagemEmailAsync } from '../src/services/csatEmail.service';

const TARGET_EMAIL = (process.argv[2] || 'nathalia.villanova@velotax.com.br').trim().toLowerCase();
const PROTOCOLO = `9999${Date.now().toString().slice(-6)}`;

async function main() {
  await connectDatabase();

  const now = new Date();
  const chamado = await ChamadoN1.create({
    chamadoProtocolo: PROTOCOLO,
    chamadoTitulo: 'Verificação manual de envio de CSAT',
    createdAt: now,
    updatedAt: now,
    tabulacao: [
      {
        tipo: 'produto',
        produto: 'Verificação interna',
        motivo: 'Teste de envio de e-mail',
        detalhe: '',
        canal: 'email',
        responsavel: '',
        atribuido: '',
      },
    ],
    registro: [
      {
        data: now,
        origin: 'cliente',
        autor: 'Verificação manual',
        mensagemPublica: 'Mensagem de verificação de envio de CSAT.',
        anexosMensagemPublica: [],
        anotacaoInterna: '',
        anexosAnotacaoInterna: [],
        alteracoes: [],
        metadados: { emailFrom: TARGET_EMAIL },
        status: 'resolvido',
      },
    ],
  });

  console.log('Ticket temporário criado:', chamado.chamadoProtocolo, 'destinatário:', TARGET_EMAIL);

  try {
    console.log('--- Forçando CSAT inicial ---');
    await sendCsatEmailAsync(chamado);

    const reloaded = await ChamadoN1.findOne({ chamadoProtocolo: PROTOCOLO });
    if (!reloaded) throw new Error('Ticket sumiu após o primeiro envio.');

    console.log('--- Forçando CSAT repescagem ---');
    await sendCsatRepescagemEmailAsync(reloaded);

    const final = await ChamadoN1.findOne({ chamadoProtocolo: PROTOCOLO }).lean();
    console.log('csat final:', JSON.stringify(final?.csat));
  } finally {
    await ChamadoN1.deleteOne({ chamadoProtocolo: PROTOCOLO });
    console.log('Ticket temporário removido.');
  }

  console.log('Concluído.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Falhou:', err);
  process.exit(1);
});
