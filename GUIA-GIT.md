# Guia de Git do dia a dia

Comandos para usar no terminal do VS Code, dentro da pasta do projeto.
No PowerShell do Windows, o `git` funciona normal; o `npm` vira `npm.cmd`.

## Conceitos rápidos

| Termo | O que é |
|---|---|
| **Commit** | Um ponto salvo do projeto, com a descrição do que mudou. |
| **Branch** | Uma linha do tempo paralela: dá para mexer sem afetar a produção. |
| **`main`** | A branch oficial. O Render publica o que estiver nela. |
| **Push** | Enviar os seus commits para o GitHub. |
| **Pull** | Trazer do GitHub as mudanças novas e aplicar no seu computador. |
| **Fetch** | Só verificar o que há de novo no GitHub, sem aplicar. |
| **Pull Request (PR)** | Pedido para levar as mudanças de uma branch para a `main`. É onde se revisa antes de ir para a produção. |
| **Merge** | Aceitar o PR: as mudanças entram na `main` e o Render publica sozinho. |
| **Conflito** | Duas branches mudaram a mesma linha de jeitos diferentes; o Git pergunta qual fica. |

## Ver onde estou

```powershell
git branch --show-current     # em qual branch estou
git status                    # o que mudou e ainda não foi salvo
git branch -a                 # lista todas as branches (locais e do GitHub)
git log --oneline -10         # últimos 10 commits
```

## Trocar de branch

```powershell
git fetch origin                                     # vê o que há de novo no GitHub
git checkout claude/ajuda-custo-render-deploy-r1rklb # branch das mudanças novas (PR aberto)
git checkout claude/banco-de-dados                   # branch do banco de dados (teste)
git checkout main                                    # volta para a produção
npm.cmd install                                      # rode sempre depois de trocar (as bibliotecas podem mudar)
```

## Atualizar com o que está no GitHub

```powershell
git pull        # traz e aplica as mudanças novas da branch em que você está
```

## Guardar alterações antes de trocar de branch

Se o `git status` mostrar arquivos modificados que você não quer perder:

```powershell
git stash        # guarda as mudanças numa "gaveta"
git stash pop    # tira da gaveta (depois de voltar para a branch)
```

## Desfazer mudanças locais

⚠️ Cuidado: apaga o que você mexeu e ainda não salvou num commit.

```powershell
git restore nome-do-arquivo   # desfaz as mudanças de um arquivo
git restore .                 # desfaz tudo que não foi commitado
```

## Rodar e testar o sistema

```powershell
npm.cmd run dev    # sobe o sistema: localhost:3000 (app) e localhost:3000/admin (painel)
npm.cmd test       # testes automáticos
npm.cmd run lint   # procura erros no código
```

Para parar o servidor: **Ctrl + C**.

Sem as variáveis do Google no `.env`, o sistema roda em memória: não mexe na planilha real e os dados somem ao reiniciar.

## Salvar e enviar uma mudança sua

```powershell
git add .                              # marca tudo para o commit
git commit -m "Descreve o que mudou"   # salva o ponto na história
git push                               # envia para o GitHub
```

Depois, no GitHub, abra um Pull Request para a `main`. O merge publica no Render.

## Rotina segura para testar uma branch

1. `git status` (se tiver algo modificado, `git stash`)
2. `git fetch origin`
3. `git checkout <branch>`
4. `git pull`
5. `npm.cmd install`
6. `npm.cmd run dev`
