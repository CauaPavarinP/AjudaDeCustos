// Regras de negócio usadas pelo servidor (app.js da raiz) e pelas telas (admin.js e app.js do celular).
// Ficam num arquivo só para as duas pontas nunca discordarem (ex.: em que semana cai uma nota).
// No navegador viram window.Regras; no Node, require('./public/regras').
(function (raiz) {
  const STATUS = Object.freeze({ analise: 'Em análise', aprovada: 'Aprovada', recusada: 'Recusada' });
  const PAGO = 'Pago'; // status de um registro de pagamento (aba Periodos)
  const PAGA = 'Paga'; // como a tela mostra uma despesa aprovada que já foi paga
  // Situação de pagamento que o servidor manda em cada despesa do celular (d.periodo.status), além de PAGO
  const ABERTA = 'Aberta'; // ainda não paga: entra na semana a pagar
  const ANTERIOR = 'Anterior'; // aprovada antes do controle de pagamentos (ver "antiga")
  // Despesa antiga que o Maurício mandou incluir nos pagamentos (fica em periodoId; ver "antiga")
  const LIBERADA = 'liberada';
  // Marca no "pagoPor" do pagamento criado pelo botão "Já foram pagas" (pago fora do sistema)
  const ANTES_DO_SISTEMA = 'pago antes do sistema';
  const INICIO_SEMANA = 1; // dia em que a semana começa: 1 = segunda-feira (0 = domingo)

  const somaDias = (data, n) => {
    const d = new Date(data + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  // Primeiro dia (AAAA-MM-DD) da semana de uma data
  const semanaDe = data => somaDias(data, -((new Date(data + 'T00:00:00Z').getUTCDay() - INICIO_SEMANA + 7) % 7));
  const fimSemana = inicio => somaDias(inicio, 6);
  // Despesa sem periodoId (ou liberada) ainda não foi paga
  const naoPaga = d => !d.periodoId || d.periodoId === LIBERADA;
  // Aprovada antes do início do controle de pagamentos: pode já ter sido reembolsada fora do sistema,
  // então não entra sozinha nas semanas a pagar (o Maurício decide)
  const antiga = (d, inicioPeriodos) =>
    !d.periodoId && d.status === STATUS.aprovada && !!d.criadoEm && !!inicioPeriodos && d.criadoEm < inicioPeriodos;
  const antesDoSistema = pagamento => String(pagamento.pagoPor || '').includes(ANTES_DO_SISTEMA);

  const Regras = Object.freeze({
    STATUS, PAGO, PAGA, ABERTA, ANTERIOR, LIBERADA, ANTES_DO_SISTEMA, INICIO_SEMANA,
    semanaDe, fimSemana, naoPaga, antiga, antesDoSistema,
  });
  if (typeof module === 'object' && module.exports) module.exports = Regras;
  else raiz.Regras = Regras;
})(this);
