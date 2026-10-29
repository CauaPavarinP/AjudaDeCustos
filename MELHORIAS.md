# Melhorias futuras: Ajuda de Custo

Marque com `[x]` o que for feito. Os números entre parênteses (#7, #8…) são da auditoria de 28/10/2026.

## Prioridade alta

- [x] **Outro login de administrador.** *Feito na branch `claude/banco-de-dados` (tabela Administradores; funciona com planilha ou banco).* Hoje existe um único login de admin (`ADMIN_USER`/`ADMIN_PASSWORD` no Render) e tudo fica registrado como "Maurício".
  - Criar logins separados, cada um com usuário e senha próprios.
  - Mostrar o nome certo em "aprovado por" e "pago por".
  - Permitir desativar um admin sem afetar o outro.
  - Funciona com a planilha atual e não precisa de banco de dados.
- [ ] **Logo da empresa no PDF** (aguardando a imagem do Maurício).
- [ ] **Confirmar com o Maurício** que a semana de pagamento é de **segunda a domingo**.
- [ ] **Obrigar a troca da senha temporária no primeiro acesso** do colaborador (M1).

## Segurança e dados

- [ ] Login: o tempo de resposta não deve revelar se o usuário existe (#7).
- [ ] API só aceita valor como número: hoje `"0.500"` vira 500 (#11).
- [ ] Validar a data inteira antes de cortar: hoje `2026-10-20xyz` é aceita (#12).
- [ ] Editar colaborador pela API sem os dados bancários não deve apagá-los (#13).
- [x] `jaPagas` só aceita `true` (#14). Feito junto com o item 1 da auditoria.
- [ ] Mensagem certa para "dados grandes demais" fora das rotas de foto (#15).

## Regras de pagamento

- [ ] Limitar a data da nota, por exemplo a no máximo 1 ano atrás (#8).
- [ ] Mensagem de data: dizer "não pode ser no futuro" em vez de "ano entre 2000 e 2027" (#9).
- [ ] Nota antiga reaberta não deve travar o pagamento da semana (#10).

## Painel do Maurício

- [ ] Mostrar o ano nos períodos que viram o ano (caixa das antigas e coluna Período) (#16, #17).
- [ ] Nome do PDF com o ano inicial quando for diferente do final (#18).
- [ ] Trocar textos antigos de "períodos" no PDF mensal (#19).
- [ ] Mostrar "Paga" em todos os lugares: modal, "Ver notas" e Backup (#20).
- [ ] PDF: nome e cidade longos sem cortar com "…" (#21).
- [ ] PDF: letras estrangeiras e emoji sem virar "?" (#22).
- [ ] PDF mensal avisar quando há despesas em análise fora do total (#23).
- [ ] Excel de despesas: "Total" separado por status ou rotulado (#24).
- [ ] Backup: tirar colunas antigas e mostrar a semana em vez do código (#25).

## App do colaborador

- [ ] Texto certo quando o filtro "Todas" está vazio (#26).
- [ ] Mostrar o ano na data quando a despesa for de outro ano (#27).
- [ ] Detalhe sem foto: não mostrar duas áreas de foto (#28).
- [ ] Card "A receber": esconder quando não houver aprovadas e deixar claro "todos os meses" (#29).
- [ ] Padronizar textos com o painel: "Lançada" × "Enviada" e formato da semana (#30).
- [ ] Tratar erro no console ao trocar de mês com a sessão vencida (#31).
- [ ] Acessibilidade: rótulos no seletor de mês e nas categorias (#32).
- [ ] App instalado abrir sem internet (service worker) (M2).

## Documentação

- [ ] README: abas Periodos e Config e colunas novas; remover comentário velho de "fechar período" (#33).

## Futuro (quando o sistema crescer)

- [ ] **Mudar para banco de dados (PostgreSQL).** *Em teste na branch `claude/banco-de-dados` (Supabase); falta o Maurício decidir e fazer a migração em produção.* Não é necessário hoje (10 colaboradores e 2 admins). Fazer quando acontecer algo destes:
  - precisar de mais de um servidor no Render, porque as travas atuais só funcionam com um;
  - aparecerem erros de limite do Google Sheets nos logs;
  - o painel ficar lento;
  - passar de algumas dezenas de colaboradores.

  Observações:
  - A troca fica concentrada em `services/store.js`, que é por onde passa todo acesso aos dados.
  - Confira o custo do banco antes de decidir, porque o gratuito do Render expira.
  - Será preciso migrar os dados da planilha e testar tudo de novo.
  - Hoje dá para ver os dados direto na planilha; com banco, só pelo painel.
