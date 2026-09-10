/**
 * api v1.0.0 — cliente HTTP do Velodesk para o agente de QA
 *
 * Nunca lança por status HTTP: devolve { status, body } para a checagem decidir.
 * Toda chamada 5xx é anotada no coletor (caso X01).
 */
import { cfg } from './config';

export interface Resposta<T = any> {
  status: number;
  ok: boolean;
  body: T;
  ms: number;
  url: string;
}

type Registrador = { registrar5xx: (d: string) => void } | null;

export class ApiVelodesk {
  private token = '';
  private registrador: Registrador = null;

  constructor(private readonly base = cfg.apiUrl) {}

  usarRegistrador(r: Registrador) {
    this.registrador = r;
  }

  get temToken() {
    return Boolean(this.token);
  }

  private async chamar<T = any>(
    metodo: string,
    caminho: string,
    opts: { body?: unknown; headers?: Record<string, string>; auth?: boolean; timeoutMs?: number } = {},
  ): Promise<Resposta<T>> {
    const url = `${this.base}${caminho}`;
    const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers ?? {}) };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.auth !== false && this.token) headers.Authorization = `Bearer ${this.token}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 45_000);
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: metodo,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: ctrl.signal,
      });
      const ms = Date.now() - t0;
      const texto = await res.text();
      let body: any = texto;
      try {
        body = texto ? JSON.parse(texto) : null;
      } catch {
        /* mantém texto cru (ex.: HTML da página /csat) */
      }
      if (res.status >= 500) {
        this.registrador?.registrar5xx(`${metodo} ${caminho} → ${res.status}`);
      }
      return { status: res.status, ok: res.ok, body, ms, url };
    } catch (err) {
      const ms = Date.now() - t0;
      const msg = err instanceof Error ? err.message : String(err);
      this.registrador?.registrar5xx(`${metodo} ${caminho} → sem resposta (${msg})`);
      return { status: 0, ok: false, body: { message: msg } as any, ms, url };
    } finally {
      clearTimeout(timer);
    }
  }

  get = <T = any>(c: string, o?: Parameters<ApiVelodesk['chamar']>[2]) => this.chamar<T>('GET', c, o);
  post = <T = any>(c: string, body?: unknown, o?: Parameters<ApiVelodesk['chamar']>[2]) =>
    this.chamar<T>('POST', c, { ...o, body });
  put = <T = any>(c: string, body?: unknown, o?: Parameters<ApiVelodesk['chamar']>[2]) =>
    this.chamar<T>('PUT', c, { ...o, body });

  // ── sondas sem autenticação ─────────────────────────────────────────────
  health = () => this.get('/api/health', { auth: false });
  healthEmail = () => this.get('/api/inbound/email/health', { auth: false });
  healthInboundTickets = () => this.get('/api/inbound/tickets/health', { auth: false });
  paginaCsat = () => this.get('/csat?protocolo=0000000000&nota=5', { auth: false });

  // ── autenticação ────────────────────────────────────────────────────────
  async login(email: string, password: string) {
    const r = await this.post('/api/login', { email, password }, { auth: false });
    if (r.ok && r.body?.token) this.token = String(r.body.token);
    return r;
  }

  // ── tickets ─────────────────────────────────────────────────────────────
  stats = () => this.get('/api/stats');
  moduleStatus = () => this.get('/api/module-status');
  ticketPorProtocolo = (protocolo: string) =>
    this.get(`/api/tickets/by-protocol/${encodeURIComponent(protocolo)}`);
  ticket = (id: string) => this.get(`/api/tickets/${id}`);
  mensagem = (id: string, body: Record<string, unknown>) => this.post(`/api/tickets/${id}/messages`, body);
  commit = (id: string, body: Record<string, unknown>) => this.post(`/api/tickets/${id}/commit`, body);
  queueCounts = () => this.get('/api/boxes/queue-counts');

  /**
   * Cria ticket pela origem dedicada "qa-teste" do canal de entrada (header de
   * secret, sem JWT) — não popula tabulacao[].canal, então não polui métricas/
   * relatórios/critérios de e-mail que filtram por canal real.
   */
  criarTicketEntrada = (payload: Record<string, unknown>) =>
    this.post('/api/inbound/tickets', payload, {
      auth: false,
      headers: { 'x-inbound-qa-teste-secret': cfg.inboundQaTesteSecret },
    });

  fundir = (body: { activeId: string; inactiveIds: string[]; cpf: string }) =>
    this.post('/api/ticket-fusao', body);

  // ── CSAT ────────────────────────────────────────────────────────────────
  responderCsat = (body: { protocolo: string; nota: unknown; comentario?: string }) =>
    this.post('/api/csat', body, { auth: false });
}
