/**
 * test-produto-index — testa a varredura mecânica de produto (sem LLM, sem banco).
 * Catálogo = os 12 produtos ativos reais do desk_config.tabulacao_campos do dev.
 */
import { detectProdutoNoTexto, resolveProdutoHint } from '../src/services/agents/produtoIndex.util';
import type { TabulationActiveDto } from '../src/services/tabulation.service';

const nomes = [
  'Emprestimo Pessoal', 'Antecipação 2026', 'Antecipação do Salário', 'Conta Velotax', 'Conta Celcoin',
  'Seguros', 'Calculadora', 'Sem Contato', 'Cupons', 'Renegociação de Parceiros', 'Indique e Ganhe',
  'Antecipação Outros Anos',
];
const motivos: Record<string, string[]> = {
  'Emprestimo Pessoal': ['Informações Para Contratação ', 'Pagamento', 'Status da Contratação'],
};
const config = {
  produtos: nomes.map((produto) => ({
    produto, ativo: true,
    motivos: (motivos[produto] ?? []).map((motivo) => ({ motivo, ativo: true, detalhes: [] })),
  })),
  opcoes: { tipoChamado: [], canalContato: [] },
} as unknown as TabulationActiveDto;

let falhas = 0;
function check(nome: string, ok: boolean, detalhe: unknown) {
  if (!ok) falhas += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} — ${nome}`, ok ? '' : detalhe);
}

// texto real do ticket de simulação do usuário (2610080023)
let r = detectProdutoNoTexto('quero saber se o emprestimo pessoal está disponivel para mim', config);
check('frase do produto, sem acento/caixa → único', r.status === 'unico' && r.produto === 'Emprestimo Pessoal', r);

r = detectProdutoNoTexto('Meu EMPRÉSTIMO PESSOAL, preciso do extrato.', config);
check('com acento e caixa alta → único', r.status === 'unico' && r.produto === 'Emprestimo Pessoal', r);

r = detectProdutoNoTexto('Quero cancelar meus seguros', config);
check('nome de produto de uma palavra → único', r.status === 'unico' && r.produto === 'Seguros', r);

r = detectProdutoNoTexto('Tenho um seguro e um empréstimo atrasado', config);
check('plural/singular tolerado + sem falso positivo de "empréstimo" sozinho', r.status === 'unico' && r.produto === 'Seguros', r);

r = detectProdutoNoTexto('Sobre o emprestimo pessoal e também sobre meus seguros', config);
check('dois produtos → ambíguo (cai na LLM)', r.status === 'ambiguo' && r.candidatos.length === 2, r);

r = detectProdutoNoTexto('Quero a antecipação do salário', config);
check('nome mais específico vence o contido', r.status === 'unico' && r.produto === 'Antecipação do Salário', r);

r = detectProdutoNoTexto('Bom dia, preciso de ajuda com minha parcela', config);
check('sem menção a produto → nenhum', r.status === 'nenhum', r);

r = detectProdutoNoTexto('Quero renegociar meu contrato', config);
check('"renegociar" solto não vira produto "Renegociação de Parceiros"', r.status === 'nenhum', r);

let h = resolveProdutoHint({ tabulacaoOrigem: { produto: 'emprestimo pessoal', motivo: 'pagamento' }, texto: 'qualquer coisa' }, config);
check('origem válida (produto+motivo) → usa a origem, sem varrer texto', h?.fonte === 'origem' && h.produto === 'Emprestimo Pessoal' && h.motivo === 'Pagamento', h);

h = resolveProdutoHint({ tabulacaoOrigem: { produto: 'Emprestimo Pessoal', motivo: '' }, texto: '' }, config);
check('origem só com produto → produto, motivo em branco', h?.fonte === 'origem' && h.produto === 'Emprestimo Pessoal' && h.motivo === '', h);

h = resolveProdutoHint({ tabulacaoOrigem: { produto: 'Produto Que Não Existe', motivo: '' }, texto: 'meu emprestimo pessoal' }, config);
check('origem inválida → ignora e usa o índice', h?.fonte === 'indice' && h.produto === 'Emprestimo Pessoal', h);

h = resolveProdutoHint({ tabulacaoOrigem: null, texto: 'oi' }, config);
check('nada confiável → null (LLM é a primeira leitura)', h === null, h);

console.log(falhas ? `\n${falhas} cenário(s) falharam` : '\nTodos os cenários passaram.');
process.exit(falhas ? 1 : 0);
