# Ajuda de Custo — Comercial • 101 do Brasil

Substitui a planilha "Resumo prestação de contas" do Comercial. O colaborador lança as despesas pelo celular e o Maurício lança prestações, aprova as despesas e vê os resumos no painel.

## Como funciona

| Quem | Endereço | O que faz |
|---|---|---|
| Colaborador | `/` | Entra com **usuário + senha**, lança despesas (categoria, valor, data e observação), acompanha o status (*Em análise*, *Aprovada*, *Recusada*) e troca a senha em Perfil. |
| Maurício | `/admin` | Lança prestações de contas, aprova ou recusa as despesas do celular, vê os resumos por colaborador e por função, exporta para Excel (CSV) e cadastra colaboradores e funções. |

- **Categorias:** Combustível, Alimentação, Degustação, Hotel, Transporte e Outros. Em "Outros", a observação é obrigatória.
- **Despesas do celular:** ficam *Em análise* até o Maurício aprovar. As aprovadas entram nos lançamentos e nos resumos, somadas por colaborador e mês, com a etiqueta **APP**. O colaborador só pode excluir uma despesa enquanto ela está em análise.
- **Colaboradores:** o Maurício cadastra. A senha inicial é gerada automaticamente e aparece **uma única vez**. Se o colaborador esquecer a senha, o Maurício gera uma nova em "Nova senha". Quem é desativado não entra mais, mas o histórico continua nos resumos.
- **Função:** cada lançamento guarda a função do colaborador no momento em que foi feito.
- **Mês de referência:** por padrão, o mês da data inicial (regra final ainda a definir com o Maurício).
- **Segurança:** senhas com scrypt; bloqueio de 10 minutos depois de 5 tentativas erradas de login.
- **Foto da nota:** fase 2 (ainda não guarda comprovante).

## Dados (Google Sheets)

Crie uma planilha nova e compartilhe com o e-mail da Service Account como **Editor**. Pode ser a mesma Service Account da Fila de Atendimento. Ao iniciar, o sistema cria sozinho as abas:

- `Colaboradores`: ID, Nome, Usuario, Funcao, Ativo, SenhaHash, CriadoEm
- `Funcoes`: ID, Nome, CriadoEm
- `Prestacoes`: ID, ColaboradorID, Colaborador, Funcao, DataInicial, DataFinal, MesReferencia, Combustivel, Alimentacao, Degustacao, Hotel, Transporte, Outros, Total, Observacao, CriadoEm
- `Despesas`: ID, ColaboradorID, Colaborador, Funcao, Data, Categoria, Valor, Observacao, Status, EnviadaEm, AvaliadaEm, AvaliadaPor

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

Em produção, o servidor não sobe se faltar alguma delas e mostra no log qual está faltando.

Nunca coloque essas informações no código nem no GitHub.

## Rodar localmente

Precisa do **Node.js 22 ou mais novo**.

```bash
npm install          # no Windows/PowerShell: npm.cmd install
npm run dev          # no Windows/PowerShell: npm.cmd run dev
```

Sem `.env`, roda em memória. Para testar com a planilha, copie `.env.example` para `.env` e preencha.

Depois, abra `http://localhost:3000` (colaborador) e `http://localhost:3000/admin` (painel).

## Publicar no Render

1. **New → Web Service** e conecte este repositório.
2. Build command: `npm install`. Start command: `npm start`.
3. Cadastre as variáveis de ambiente acima.
4. Health check path: `/health`. Depois do deploy, `/health` deve mostrar `"armazenamento":"sheets"`.

## Se parar de funcionar

- **Tela em branco ou tela antiga:** recarregue com Ctrl + F5.
- **Deploy falha com "Variável de ambiente X não definida":** cadastre a variável no Render e faça um novo deploy.
- **Erro ao acessar a planilha:** confira se ela está compartilhada com a Service Account como Editor e se o `SPREADSHEET_ID` está certo.
- **Plano gratuito do Render:** o serviço "dorme" depois de um tempo sem uso; o primeiro acesso pode demorar perto de 1 minuto, e quem estava logado precisa entrar de novo.

## Estrutura

```
app.js              servidor Express: login, APIs do colaborador e do painel, aprovação
services/store.js   leitura e gravação no Google Sheets (ou memória em testes)
public/index.html   app do colaborador (celular)
public/app.js
public/admin.html   painel do Maurício
public/admin.js
public/style.css    estilos das duas partes
```
