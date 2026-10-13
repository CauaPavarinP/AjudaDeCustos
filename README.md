# Ajuda de Custo — Comercial • 101 do Brasil

Sistema para os colaboradores lançarem despesas de viagem (ajuda de custo) pelo celular, com um painel para o Comercial ver o extrato por **função** ou por **funcionário**.

## Como funciona

| Quem | Endereço | O que faz |
|---|---|---|
| Colaborador | `/` | Entra com **nome + código de 4 dígitos**, lança a despesa (tipo, data, valor e descrição) e vê o total do mês. |
| Maurício | `/admin` | Entra com usuário e senha, vê o extrato com filtros, exporta para Excel (CSV) e cadastra funcionários. |

- Tipos de despesa: Combustível, Alimentação, Hospedagem, Pedágio, Estacionamento, Outros. Em "Outros", a descrição é obrigatória.
- O código de acesso é gerado automaticamente no cadastro. O painel permite gerar um novo código ou desativar o funcionário. Os lançamentos antigos de quem foi desativado continuam no extrato.
- Cada lançamento guarda a função do funcionário **no momento do lançamento**. Assim, o extrato por função não muda se ele trocar de função depois.
- Depois de 5 tentativas erradas de login, o acesso fica bloqueado por 10 minutos.
- Esta versão **não** guarda foto do comprovante.

## Dados (Google Sheets)

Crie uma planilha nova e compartilhe com o e-mail da Service Account como **Editor**. Pode ser a mesma Service Account da Fila de Atendimento. Ao iniciar, o sistema cria sozinho as abas:

- `Funcionarios`: ID, Nome, Funcao, Telefone, Codigo, Ativo, CriadoEm
- `Lancamentos`: ID, Data, FuncionarioID, Funcionario, Funcao, Tipo, Valor, Descricao, CriadoEm

> Não renomeie as abas nem as colunas, e evite editar os IDs à mão.

Sem as variáveis do Google, e fora de produção, o sistema roda com os dados **em memória**, só para testes locais. Os dados somem ao reiniciar.

## Variáveis de ambiente

Veja `.env.example`. No Render, cadastre em **Environment → Environment Variables**:

| Variável | Para quê |
|---|---|
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | texto longo e aleatório |
| `ADMIN_USER` / `ADMIN_PASSWORD` | login do painel `/admin` |
| `SPREADSHEET_ID` | ID da planilha (trecho da URL entre `/d/` e `/edit`) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | e-mail da Service Account |
| `GOOGLE_PRIVATE_KEY` | chave privada da Service Account (com os `\n`) |

Nunca coloque essas informações no código nem no GitHub.

## Rodar localmente

```bash
npm install
cp .env.example .env   # preencha (ou apague as linhas do Google para testar em memória e troque NODE_ENV)
npm run dev
```

Depois, abra `http://localhost:3000` (colaborador) e `http://localhost:3000/admin` (painel).

## Publicar no Render

1. **New → Web Service** e conecte este repositório.
2. Build command: `npm install`. Start command: `npm start`.
3. Cadastre as variáveis de ambiente acima.
4. Health check path: `/health`.

## Estrutura

```
app.js              servidor Express: login, APIs do colaborador e do painel, CSV
services/store.js   leitura e gravação no Google Sheets (ou memória em testes)
public/index.html   tela do colaborador (celular)
public/app.js
public/admin.html   painel do Maurício
public/admin.js
public/style.css
```
