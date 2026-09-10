/**
 * checks/mensageria v1.1.0 — E07 (modelos cadastrados) e E08 (e-mail real de cliente)
 *
 * E07 lê os modelos ATIVOS de desk_config.email_conteudos (saudação + corpo) e
 * manda pra IA revisar tom, clareza e instrução — não o disparo em si (isso é
 * E01-E06), o TEXTO.
 *
 * E08 vai além: pega uma amostra pequena e recente de e-mails que REALMENTE
 * saíram para CLIENTE REAL (nunca ticket de QA) e manda o texto pra mesma
 * revisão — com o primeiro nome do cliente trocado por "[cliente]" antes de
 * sair desta máquina. Autorizado explicitamente por decisão de produto (ver
 * qa/CONTEXTO-AGENTE-QA.md); é a única checagem do agente que lê conteúdo de
 * ticket de cliente real, e mesmo assim nunca o CPF ou o nome completo saem
 * daqui — só o texto já redigido.
 *
 * Nenhuma das duas tem orientação base de reserva: sem IA configurada, ou se
 * a chamada falhar, o caso sai como Bloqueado — nunca como "Sim" por omissão.
 */
import type { Contexto } from '../contexto';
import { amostraEmailsReais, colConteudos, nomeClienteParaRedigir } from '../db';
import { revisarEmailsReais, revisarMensageria, type AmostraParaIa, type TemplateParaIa } from '../ia';
import { ok, parcial, bloqueado } from '../resultado';

const AMOSTRA_LIMITE = 5;

/** Troca o primeiro nome do cliente por "[cliente]" em todo o texto, antes de ele sair da máquina. */
function redigirNome(texto: string, nomeCompleto: string): string {
  const primeiroNome = nomeCompleto.trim().split(/\s+/)[0];
  if (!primeiroNome || primeiroNome.length < 2) return texto;
  const escapado = primeiroNome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return texto.replace(new RegExp(`\\b${escapado}\\b`, 'gi'), '[cliente]');
}

function tipoGatilho(gatilho: unknown): string {
  const criterios: any[] = Array.isArray((gatilho as any)?.criterios) ? (gatilho as any).criterios : [];
  if (criterios.some((c) => c?.tipo === 'gatilho_interno')) return 'pesquisa de satisfação (CSAT)';
  const tipos = [...new Set(criterios.map((c) => String(c?.tipo ?? '')).filter(Boolean))];
  return tipos.length ? tipos.join(' + ') : 'sem gatilho configurado';
}

export async function checarMensageria(ctx: Contexto): Promise<void> {
  const { coletor } = ctx;

  await coletor.checar('E07', async () => {
    if (!ctx.temBanco) return bloqueado('Sem acesso ao banco para ler os modelos de e-mail.');

    const col = await colConteudos();
    const docs = await col.find({ ativo: true }).toArray();
    const templates: TemplateParaIa[] = docs
      .map((d: any) => ({
        nome: String(d.nome ?? ''),
        saudacao: String(d.saudacao ?? ''),
        corpo: String(d.corpo ?? ''),
        tipoGatilho: tipoGatilho(d.gatilho),
      }))
      .filter((t) => t.saudacao.trim() || t.corpo.trim());

    if (!templates.length) {
      return bloqueado('Nenhum modelo ativo com texto para revisar — ver caso E06.');
    }

    const revisao = await revisarMensageria(templates);
    if (revisao.erro) {
      return bloqueado(`Não foi possível revisar a mensageria por IA: ${revisao.erro}`);
    }
    if (!revisao.achados.length) {
      return ok(`IA revisou ${templates.length} modelo(s) ativo(s) e não achou problema de tom ou instrução.`);
    }

    const resumo = revisao.achados.map((a) => `"${a.nome}": ${a.problema}`).join(' | ');
    return parcial(`IA encontrou ${revisao.achados.length} ponto(s) de atenção — ${resumo}`);
  });

  // E08 — amostra de e-mail real enviado a cliente (nunca ticket de QA)
  await coletor.checar('E08', async () => {
    if (!ctx.temBanco) return bloqueado('Sem acesso ao banco para ler e-mails enviados a clientes.');

    const amostra = await amostraEmailsReais(AMOSTRA_LIMITE);
    if (!amostra.length) {
      return bloqueado('Nenhum e-mail automático recente para cliente real encontrado para auditar.');
    }

    const amostrasParaIa: AmostraParaIa[] = [];
    for (const item of amostra) {
      const nome = await nomeClienteParaRedigir(item.cpfParaRedigir);
      amostrasParaIa.push({
        referencia: `${item.protocolo} (${item.modelo})`,
        modelo: item.modelo,
        textoRedigido: redigirNome(item.texto, nome),
      });
    }

    const revisao = await revisarEmailsReais(amostrasParaIa);
    if (revisao.erro) {
      return bloqueado(`Não foi possível revisar e-mail real por IA: ${revisao.erro}`);
    }
    if (!revisao.achados.length) {
      return ok(`IA revisou ${amostra.length} e-mail(s) real(is) recente(s) e não achou problema de tom ou instrução.`);
    }

    const resumo = revisao.achados.map((a) => `${a.nome}: ${a.problema}`).join(' | ');
    return parcial(`IA encontrou ${revisao.achados.length} ponto(s) de atenção em e-mail real — ${resumo}`);
  });
}
