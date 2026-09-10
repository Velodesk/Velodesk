/**
 * resultado v1.0.0 — coleta dos resultados da rodada
 */
import { caso, type CasoCatalogo, type Situacao } from './catalogo';

/** Ticket de QA usado numa checagem — permite o dashboard linkar direto pro Desk. */
export interface TicketRef {
  id: string;
  protocolo: string;
  /** Só faz sentido em mesclas: "ativo" ou "inativo". */
  papel?: string;
}

export interface Resultado {
  caso: CasoCatalogo;
  situacao: Situacao;
  /** Texto em linguagem simples que vai para a coluna Observação. */
  observacao: string;
  /** Milissegundos gastos na checagem. */
  duracaoMs: number;
  /** Caminho do print, quando houver. */
  print?: string;
  /** Ticket(s) de QA que essa checagem usou — ausente em casos agregados (contadores, saúde, etc.). */
  tickets?: TicketRef[];
}

export interface Metrica {
  nome: string;
  valor: number | string;
  situacao: 'Normal' | 'Atenção' | 'Alerta';
  observacao?: string;
}

export class Coletor {
  readonly resultados: Resultado[] = [];
  readonly metricas: Metrica[] = [];
  readonly erros5xx: string[] = [];

  private registrar(id: string, situacao: Situacao, observacao: string, duracaoMs: number, print?: string, tickets?: TicketRef[]) {
    const c = caso(id);
    // Falha em caso já mapeado pelo time não é regressão nova.
    const final: Situacao = situacao === 'Nao' && c.conhecida ? 'Falha conhecida' : situacao;
    const obs = final === 'Falha conhecida' ? `${observacao} | Já mapeado: ${c.conhecida}` : observacao;
    this.resultados.push({ caso: c, situacao: final, observacao: obs, duracaoMs, print, tickets });
  }

  /** Executa uma checagem, cronometra e registra o resultado. */
  async checar(
    id: string,
    fn: () => Promise<{ situacao: Situacao; observacao: string; print?: string; tickets?: TicketRef[] }>,
  ) {
    const t0 = Date.now();
    try {
      const r = await fn();
      this.registrar(id, r.situacao, r.observacao, Date.now() - t0, r.print, r.tickets);
      return r.situacao;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.registrar(id, 'Nao', `Erro inesperado durante a checagem: ${msg}`, Date.now() - t0);
      return 'Nao' as Situacao;
    }
  }

  /** Marca um caso como não executado nesta rodada, com o motivo. */
  naoExecutado(id: string, motivo: string, situacao: Situacao = 'Nao testado') {
    this.registrar(id, situacao, motivo, 0);
  }

  metrica(m: Metrica) {
    this.metricas.push(m);
  }

  registrar5xx(descricao: string) {
    this.erros5xx.push(descricao);
  }

  get resumo() {
    const conta = (s: Situacao) => this.resultados.filter((r) => r.situacao === s).length;
    return {
      total: this.resultados.length,
      ok: conta('Sim'),
      parcial: conta('Parcial'),
      falhas: conta('Nao'),
      conhecidas: conta('Falha conhecida'),
      bloqueados: conta('Bloqueado'),
      naoTestaveis: conta('Nao testavel'),
      naoTestados: conta('Nao testado'),
    };
  }
}

export const ok = (observacao: string) => ({ situacao: 'Sim' as Situacao, observacao });
export const falha = (observacao: string) => ({ situacao: 'Nao' as Situacao, observacao });
export const parcial = (observacao: string) => ({ situacao: 'Parcial' as Situacao, observacao });
export const bloqueado = (observacao: string) => ({ situacao: 'Bloqueado' as Situacao, observacao });

/** Anexa o(s) ticket(s) de QA usados na checagem ao resultado — o dashboard usa isso pra linkar pro Desk. */
export function comTicket<T extends { situacao: Situacao; observacao: string; print?: string }>(
  resultado: T,
  ...tickets: TicketRef[]
): T & { tickets: TicketRef[] } {
  return { ...resultado, tickets };
}
