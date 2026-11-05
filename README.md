# Ajuda de Custo — Comercial • 101 do Brasil

Substitui a planilha "Resumo prestação de contas" do Comercial. O colaborador lança as despesas pelo celular e o Maurício lança prestações, aprova as despesas e vê os resumos no painel.

## Como funciona

| Quem | Endereço | O que faz |
|---|---|---|
| Colaborador | `/` | Entra com **usuário + senha**, lança despesas (categoria, valor, data e observação), acompanha o status (*Em análise*, *Aprovada*, *Recusada*) e troca a senha em Perfil. |
| Maurício | `/admin` | Lança prestações de contas, aprova ou recusa as despesas do celular, vê os resumos por colaborador e por função, exporta para Excel (.xlsx), baixa backup e cadastra colaboradores e funções. |

- **Categorias:** Combustível, Alimentação, Degustação, Hotel, Transporte e Outros. Em "Outros", a observação é obrigatória.
- **Despesas do celular:** ficam *Em análise* até o Maurício aprovar. A tela "Despesas do celular" do painel lista todas (filtro por status: Em análise, Aprovada, Recusada) e tem **Desfazer**, que volta uma despesa aprovada ou recusada para *Em análise*. As aprovadas entram nos lançamentos e nos resumos, somadas por colaborador e mês, com a etiqueta **APP**. O colaborador só pode excluir uma despesa enquanto ela está em análise.
- **Colaboradores:** o Maurício cadastra. A senha inicial é gerada automaticamente e aparece **uma única vez**. Se o colaborador esquecer a senha, o Maurício gera uma nova em "Nova senha". Quem é desativado não entra mais, mas o histórico continua nos resumos. **Excluir** só é permitido para quem ainda não tem nenhum lançamento (cadastro feito por engano); quem tem histórico deve ser desativado.
- **Funções:** cadastradas e excluídas na tela Colaboradores (o × ao lado do nome). Só dá para excluir uma função que nenhum colaborador usa; os lançamentos antigos guardam o nome da função, então os resumos não mudam.
- **Função:** cada lançamento guarda a função do colaborador no momento em que foi feito.
- **Detalhe dos resumos:** em "Resumo por colaborador" e "Resumo por função", clicar num valor da tabela abre o que formou aquele número: as despesas aprovadas do celular, uma a uma (com "ver nota"), e as prestações do painel com o valor daquela categoria (com "abrir"). Clicar no Total mostra todas as categorias, separadas.
- **Mês de referência:** por padrão, o mês da data inicial (regra final ainda a definir com o Maurício).
- **Login:** dura 12 horas. A sessão fica num cookie assinado com o `SESSION_SECRET`, então ninguém é deslogado quando o Render reinicia ou "dorme". Quando a senha muda ("Nova senha" no painel, troca em Perfil ou troca do `ADMIN_PASSWORD`), os outros aparelhos logados com a senha antiga são desconectados. **Sair** também invalida o login em todos os aparelhos daquela pessoa (um cookie copiado, de um celular perdido, por exemplo, não serve mais), e desativar um colaborador derruba os logins dele, mesmo que ele seja reativado depois.
- **Segurança:** senhas com scrypt; bloqueio de 10 minutos depois de 5 tentativas erradas de login no mesmo aparelho, ou de 20 tentativas erradas na mesma conta vindas de qualquer lugar. Trocar o `SESSION_SECRET` desconecta todo mundo. Trocar a senha em Perfil também tem limite de 5 tentativas erradas. Cada colaborador pode enviar até 20 despesas ou fotos por minuto (e 150 por dia), para ninguém esgotar a cota do Cloudinary e da planilha. As páginas só rodam código e carregam imagens do próprio sistema (cabeçalho de segurança CSP). Em produção, o log avisa se o `SESSION_SECRET` tiver menos de 32 caracteres ou se a `ADMIN_PASSWORD` for fraca. Quando o Google limita as gravações (muitas por minuto), o sistema espera e tenta de novo, em vez de parar no meio de um fechamento ou pagamento.
- **Excel:** os botões "Exportar Excel" geram um `.xlsx` com colunas ajustadas e valores em formato numérico.
- **Períodos e pagamento:**
  - **No app:** o colaborador lança as notas e, quando quiser (ex.: de 18 a 27), toca em **"Fechar período e enviar"**. Todas as despesas ainda não enviadas, em análise ou aprovadas, viram um período, com as datas da nota mais antiga à mais recente. Elas ficam travadas: não dá mais para excluir nem trocar a foto. Despesas lançadas depois entram no próximo período.
  - **No painel, aba Pagamentos:** lista os períodos enviados, com:
    - "Ver notas", para aprovar ou recusar;
    - "PDF", a folha do período, com o carimbo "PAGO EM" quando pago;
    - "✔ Pagar", só depois de analisar todas as notas; grava o valor pago, que é a soma das aprovadas;
    - "Reabrir", que desfaz o envio e devolve as despesas ao colaborador como não enviadas;
    - "Desfazer pagamento", que volta o período para "Aguardando pagamento".
  - O Maurício também pode fechar o período por um colaborador, no botão **"Fechar período por um colaborador"**.
  - Despesas de período pago aparecem como **"Paga"** no app e no painel e não podem ser alteradas.
  - Prestações lançadas no painel não entram nos períodos.
- **Despesas antigas:** na primeira vez que o servidor sobe com o controle de pagamentos, ele grava a data de início (aba Config). Despesas aprovadas antes disso não entram sozinhas num período, porque podem já ter sido reembolsadas. A aba Pagamentos mostra um aviso, e o Maurício decide por colaborador:
  - **"Já foram pagas"**: viram um pagamento marcado como pago antes do sistema;
  - **"Incluir para pagar"**: viram um período enviado.
- **Pagamentos já feitos por semana** (versão anterior) continuam registrados como períodos pagos. Despesas que ainda não tinham sido pagas aparecem como "não enviadas", e o colaborador as envia fechando o período.
- **PDF:** no "Resumo por colaborador", o botão "Exportar PDF" gera a folha "Prestação de contas" (mesmo modelo da folha em papel) do colaborador, ano e mês escolhidos (mês "Todos" = o ano inteiro): uma página por mês com gasto, com o quadro por categoria e o total. Telefone, cidade e UF vêm do cadastro do colaborador (campos opcionais em Colaboradores); se estiverem vazios, saem em branco para preencher à mão. Embaixo do quadro saem os dados bancários do colaborador (banco, agência, conta, CPF e PIX), também opcionais no cadastro; só aparecem as linhas preenchidas. Esses dados ficam só no painel (o app do colaborador não os recebe) e entram no backup — guarde o arquivo de backup em local de acesso restrito. No painel, "Baixar backup" (ao lado do botão Sair) gera um `.xlsx` com todas as abas (sem as senhas).
- **Foto da nota (opcional):** no celular, "Tirar foto" (câmera) ou "Galeria". A foto é reduzida no próprio celular antes de enviar. Enquanto a despesa está em análise, o colaborador pode adicionar ou trocar a foto no detalhe. No painel, "📷 Ver nota" abre a foto (clique para ampliar) ao lado dos dados, com Aprovar e Recusar. As fotos ficam no Cloudinary em modo privado: só abrem pelo sistema, para quem está logado.
- **Comprovantes da prestação:** na Nova prestação (ou ao editar), "📎 Anexar fotos das notas" aceita até 10 fotos (JPG/PNG, da pasta do computador). As fotos novas são enviadas ao salvar; dá para ver em tamanho grande, navegar entre elas e remover. Nos Lançamentos, 📎N mostra quantas fotos a prestação tem.

## Dados (Google Sheets)

Crie uma planilha nova e compartilhe com o e-mail da Service Account como **Editor**. Pode ser a mesma Service Account da Fila de Atendimento. Ao iniciar, o sistema cria sozinho as abas:

- `Colaboradores`: ID, Nome, Usuario, Funcao, Ativo, SenhaHash, CriadoEm, Telefone, Cidade, UF, Banco, Agencia, Conta, CPF, PIX, SessaoEpoca (as colunas a partir de Telefone são opcionais e criadas sozinhas; SessaoEpoca é preenchida pelo sistema quando a pessoa sai ou é desativada)
- `Funcoes`: ID, Nome, CriadoEm
- `Prestacoes`: ID, ColaboradorID, Colaborador, Funcao, DataInicial, DataFinal, MesReferencia, Combustivel, Alimentacao, Degustacao, Hotel, Transporte, Outros, Total, Observacao, CriadoEm, Fotos (referências das fotos separadas por `|`; criada sozinha)
- `Despesas`: ID, ColaboradorID, Colaborador, Funcao, Data, Categoria, Valor, Observacao, Status, EnviadaEm, AvaliadaEm, AvaliadaPor, Foto, PeriodoID (as colunas Foto e PeriodoID são criadas sozinhas em planilhas que já existem). PeriodoID fica vazio enquanto a despesa não foi enviada; depois guarda o ID do período (ou `liberada`, para uma despesa antiga que voltou a poder entrar num período)
- `Periodos`: ID, ColaboradorID, Colaborador, DataInicial, DataFinal, Status (`Enviado` ou `Pago`), FechadoEm, FechadoPor, PagoEm, PagoPor, ValorPago
- `Config`: ID, Valor. Guarda `inicioPeriodos`, a data em que o controle de pagamentos começou, e `sessaoAdmin`, que muda quando o painel é encerrado em Sair (não altere)

> Não renomeie as abas nem as colunas, e não edite os IDs nem a coluna SenhaHash à mão.

Sem as variáveis do Google, e fora de produção, o sistema roda com os dados **em memória**, só para testes locais. Os dados somem ao reiniciar. Nesse modo, o login do painel é `admin` / `admin`.

## Variáveis de ambiente

Veja `.env.example`. No Render, cadastre em **Environment → Environment Variables**:

| Variável | Para quê |
|---|---|
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | texto longo e aleatório |
| `ADMIN_USER` / `ADMIN_PASSWORD` | login do painel `/admin` |
| `ADMIN_NOME` | opcional; nome exibido no painel e em "aprovada por" (padrão: Maurício) |
| `SPREADSHEET_ID` | ID da planilha (trecho da URL entre `/d/` e `/edit`) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | e-mail da Service Account |
| `GOOGLE_PRIVATE_KEY` | chave privada da Service Account (pode colar com os `\n`) |
| `CLOUDINARY_URL` | opcional; liga as fotos das notas. Formato `cloudinary://API_KEY:API_SECRET@CLOUD_NAME` (veja abaixo) |

Em produção, o servidor não sobe se faltar alguma delas e mostra no log qual está faltando.

Nunca coloque essas informações no código nem no GitHub.

## Fotos das notas (Cloudinary)

1. Crie uma conta gratuita em [cloudinary.com](https://cloudinary.com).
2. No painel do Cloudinary, copie o **API environment variable** (começa com `cloudinary://`). Ele aparece na página de API Keys / Dashboard.
3. No Render, cadastre a variável `CLOUDINARY_URL` com esse valor (sem o `CLOUDINARY_URL=` da frente, se vier junto).
4. Depois do deploy, `/health` deve mostrar `"fotos":"cloudinary"`.

As fotos ficam na pasta `ajuda-de-custo` do Cloudinary, em modo privado. Na planilha, a coluna `Foto` da aba `Despesas` guarda só a referência da foto. Sem a variável, o sistema funciona normalmente e o celular mostra "Foto indisponível no momento".

**Segurança das fotos:**
- O sistema nunca entrega o endereço do Cloudinary para o navegador: o painel e o celular pegam a foto pelo próprio sistema, que confere o login (o colaborador só vê as dele).
- Sem assinatura, o endereço da foto no Cloudinary não abre. Mas o link **copiado pelo painel do Cloudinary** já vem assinado e abre para qualquer pessoa que o tenha, sem expirar.
- Por isso: (1) só pessoas autorizadas têm login no Cloudinary; (2) não se compartilha link copiado do painel do Cloudinary — para ver notas, use o sistema.

## App na tela inicial do celular

O site do colaborador pode ser "instalado" como app (ícone próprio, abre sem a barra do navegador):
- **Android (Chrome):** menu ⋮ → "Adicionar à tela inicial" ou "Instalar app".
- **iPhone (Safari):** botão Compartilhar → "Adicionar à Tela de Início".

A tela Perfil do app mostra essas instruções enquanto ele não estiver instalado.

## Rodar localmente

Precisa do **Node.js 24** (versão LTS, a mesma usada no Render). A versão 22 também funciona; o `npm install` só mostra um aviso.

```bash
npm install          # no Windows/PowerShell: npm.cmd install
npm run dev          # no Windows/PowerShell: npm.cmd run dev
```

Sem `.env`, roda em memória. Para testar com a planilha, copie `.env.example` para `.env` e preencha.

Depois, abra `http://localhost:3000` (colaborador) e `http://localhost:3000/admin` (painel).

### Testes automáticos

```bash
npm test             # no Windows/PowerShell: npm.cmd test
npm run lint         # verificador de código (ESLint): variável não usada, nome digitado errado...
```

Sobem o servidor numa porta separada, **sempre em memória** (ignoram o `.env`: nada é gravado na planilha nem no Cloudinary) e conferem login, despesas, fotos, aprovação, Desfazer, troca de senha e as travas de exclusão. Rode antes de cada `git push`.

## Publicar no Render

1. **New → Web Service** e conecte este repositório.
2. Build command: `npm install`. Start command: `npm start`.
3. Cadastre as variáveis de ambiente acima.
4. Health check path: `/health`. Depois do deploy, `/health` deve mostrar `"armazenamento":"sheets"`.

## Se parar de funcionar

- **Tela em branco ou tela antiga:** recarregue com Ctrl + F5.
- **Deploy falha com "Variável de ambiente X não definida":** cadastre a variável no Render e faça um novo deploy.
- **Erro ao acessar a planilha:** confira se ela está compartilhada com a Service Account como Editor e se o `SPREADSHEET_ID` está certo.
- **Plano gratuito do Render:** o serviço "dorme" depois de cerca de 15 minutos sem uso, e o primeiro acesso seguinte pode demorar perto de 1 minuto. Quem estava logado continua logado. Para evitar a demora, dá para usar um serviço externo que acesse `/health` a cada 10 minutos (ex.: UptimeRobot), mas **atenção**: as horas gratuitas do Render são somadas entre todos os serviços gratuitos do workspace, e manter dois serviços acordados o mês inteiro passa do limite. Confira o plano antes de ligar isso.

## Backup

- **Automático do Google:** a planilha guarda o histórico de versões (no Google Sheets: Arquivo → Histórico de versões). Dá para voltar a uma versão anterior se alguém apagar algo por engano.
- **Manual (recomendado uma vez por mês):** no painel, clique em **Baixar backup** (ao lado do botão Sair) e guarde o arquivo em uma pasta da empresa. Ou, na planilha, Arquivo → Fazer uma cópia.

## Estrutura

```
app.js              servidor Express: login, APIs do colaborador e do painel, aprovação
services/store.js   leitura e gravação no Google Sheets (ou memória em testes)
services/fotos.js   fotos das notas no Cloudinary (ou memória em testes)
public/index.html   app do colaborador (celular)
public/app.js
public/admin.html   painel do Maurício
public/admin.js
public/regras.js    regras usadas pelo servidor E pelas telas (status, período enviado/pago, despesa antiga)
public/xlsx.js      gera os arquivos Excel (.xlsx) no navegador
public/pdf.js       gera o PDF "Prestação de contas" no navegador
public/dialogo.js   janelas de aviso e confirmação
public/foto.js      reduz a foto no navegador antes de enviar (celular e painel)
public/manifest.webmanifest + public/icons/   app na tela inicial do celular
test/api.test.js    testes automáticos (npm test)
eslint.config.js    configuração do verificador de código (npm run lint)
public/style.css    estilos das duas partes
```
