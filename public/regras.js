// Regras de negócio usadas pelo servidor (app.js da raiz) e pelas telas (admin.js e app.js do celular).
// Ficam num arquivo só para as duas pontas nunca discordarem (ex.: se uma despesa já foi enviada).
// No navegador viram window.Regras; no Node, require('./public/regras').
(function (raiz) {
  const STATUS = Object.freeze({ analise: 'Em análise', aprovada: 'Aprovada', recusada: 'Recusada' });
  // Período de pagamento (aba Periodos): o colaborador junta as despesas ainda não enviadas e "fecha o período";
  // o Maurício confere e paga. Cada despesa enviada guarda o ID do período em periodoId.
  const ENVIADO = 'Enviado'; // período fechado, aguardando pagamento
  const PAGO = 'Pago'; // período pago
  const PAGA = 'Paga'; // como a tela mostra uma despesa aprovada que já foi paga
  const ANTERIOR = 'Anterior'; // aprovada antes do controle de pagamentos (ver "antiga")
  // Despesa antiga que o Maurício mandou incluir nos pagamentos (fica em periodoId; volta a ser "não enviada")
  const LIBERADA = 'liberada';
  // Marca no "pagoPor" do pagamento criado pelo botão "Já foram pagas" (pago fora do sistema)
  const ANTES_DO_SISTEMA = 'pago antes do sistema';

  // Despesa que ainda não está em nenhum período (o colaborador ainda vai enviar)
  const naoEnviada = d => !d.periodoId || d.periodoId === LIBERADA;
  // Aprovada antes do início do controle de pagamentos: pode já ter sido reembolsada fora do sistema,
  // então não entra sozinha num período (o Maurício decide)
  const antiga = (d, inicioPeriodos) =>
    !d.periodoId && d.status === STATUS.aprovada && !!d.criadoEm && !!inicioPeriodos && d.criadoEm < inicioPeriodos;
  const antesDoSistema = pagamento => String(pagamento.pagoPor || '').includes(ANTES_DO_SISTEMA);

  const Regras = Object.freeze({
    STATUS, ENVIADO, PAGO, PAGA, ANTERIOR, LIBERADA, ANTES_DO_SISTEMA,
    naoEnviada, antiga, antesDoSistema,
  });
  if (typeof module === 'object' && module.exports) module.exports = Regras;
  else raiz.Regras = Regras;
})(this);
