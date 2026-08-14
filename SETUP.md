# Catalogo de Mapas de Trackeamento - Guia de Setup

Site estatico que le duas pastas do Figma (producao e work in progress) e monta um catalogo visual, atualizado automaticamente por um job agendado no GitHub Actions.

Arquitetura: GitHub Actions (roda `figma-sync.js` a cada 20 min, chama a API do Figma e commita `catalog.json`) -> Cloudflare Pages (hospeda o site estatico, redeploy automatico a cada commit) -> Cloudflare Access (restringe o acesso a e-mails @reclameaqui.com.br).

Por que Cloudflare Pages/Access e nao GitHub Pages/Netlify/Vercel puro: como voce pediu acesso restrito ao time do RA com hospedagem gratuita, e senha/SSO em Netlify e Vercel so existe em plano pago (GitHub Pages tambem so fica privado em plano Enterprise), troquei para Cloudflare Pages (mesma categoria, gratuito) + Cloudflare Access (login por e-mail, gratuito para ate 50 pessoas). Se preferir pagar um plano Pro do Netlify/Vercel ou usar infra propria do RA, o site estatico funciona igual, so muda onde ele e hospedado.

## 1. Gerar o token do Figma

1. No Figma, vá em **Configuracoes da conta > Security > Personal access tokens**.
2. Crie um token novo com os scopes **`file_content:read`** e **`file_metadata:read`** (esses dois sao suficientes pro caminho recomendado, que busca arquivo por arquivo direto). Se quiser manter a opcao de escanear a pasta inteira como fallback futuro (caso alguem vire admin do Time), marque tambem `folders:read`.
3. Guarde o valor gerado - ele não aparece de novo depois.

## 2. Levantar os file ids (caminho recomendado)

Pra cada arquivo que deve aparecer no catalogo, abra ele no Figma e copie o **file id**: o trecho da URL logo depois de `/file/`, `/design/` ou `/board/` (mapas de trackeamento em FigJam usam `/board/`). Exemplo:

```
https://www.figma.com/board/vH82wIl3fJ4hxZThXfaPHn/B2B---Fluxo-Padrao---Cadastro-Externo?t=...
```

Aqui o file id e `vH82wIl3fJ4hxZThXfaPHn`.

Monte duas listas (uma pra producao, outra pra work in progress) com esses ids - um por linha e o formato mais facil de manter:

```
vH82wIl3fJ4hxZThXfaPHn
outroFileIdAqui123456
maisUmFileIdAqui789
```

Voce vai colar cada lista inteira num campo unico (passo 4) - da pra usar quebra de linha, virgula, ou um array JSON tipo `["id1","id2"]`, o script aceita os 3 formatos.

### Alternativa: escanear a pasta inteira (so funciona com permissao de admin no Time)

Se no futuro alguem virar admin do Time no Figma (ou o admin gerar o token), da pra usar `FIGMA_FOLDER_PRODUCAO`/`FIGMA_FOLDER_WIP` em vez da lista de ids - o script prioriza a lista de ids automaticamente, entao os dois mecanismos podem conviver sem conflito. O id da pasta e o numero que aparece depois de `/project/` na URL da pasta, por exemplo `495482832` em `https://www.figma.com/files/1194314931349749477/project/495482832?fuid=...`.

## 3. Criar o repositorio no GitHub

1. Crie um repositorio **privado** (ex: `figma-tracking-catalog`) na organizacao do RA no GitHub.
2. Suba todos os arquivos deste pacote para a raiz do repositorio (mantendo a pasta `.github/workflows/`).

## 4. Configurar os secrets e as variaveis do repositorio

Em **Settings > Secrets and variables > Actions** ha duas abas: **Secrets** (valores escondidos, tipo token) e **Variables** (valores visiveis, bons pra coisas que nao sao sensiveis e que o time vai editar com frequencia - e o caso da lista de file ids).

Na aba **Secrets**, crie:

| Nome | Valor |
|---|---|
| `FIGMA_TOKEN` | o token gerado no passo 1 |
| `FIGMA_FOLDER_PRODUCAO` | *(opcional, so se for usar a alternativa de pasta)* o folder_id da pasta de producao |
| `FIGMA_FOLDER_WIP` | *(opcional)* o folder_id da pasta de work in progress |
| `FIGMA_TEAM_ID` | *(opcional, so diagnostico)* o team_id do Time no Figma |

Na aba **Variables**, crie:

| Nome | Valor |
|---|---|
| `FIGMA_FILE_IDS_PRODUCAO` | a lista de file ids da categoria producao (um por linha, do passo 2) |
| `FIGMA_FILE_IDS_WIP` | a lista de file ids da categoria work in progress |

Toda vez que um mapa de trackeamento novo for feito, e so voltar nessa variavel e adicionar mais uma linha com o file id novo - nao precisa mexer em codigo nem no workflow.

## 5. Rodar o workflow pela primeira vez

Vá na aba **Actions** do repositorio, selecione o workflow "Atualizar catalogo de mapas de trackeamento" e clique em **Run workflow** para gerar o primeiro `catalog.json` com dados reais. Depois disso ele roda solo a cada 20 minutos (ajustavel no `cron` do arquivo `.github/workflows/update-catalog.yml`).

Confira o log dessa primeira execucao (clique no job **sync** dentro do "Run workflow" concluido) - as primeiras linhas, prefixadas com `[diagnostico]`, mostram as pastas que a API conseguiu listar dentro do Team. Se a lista aparecer vazia ou der erro ali, mas o restante do script funcionar normalmente, o problema fica isolado: a listagem de pastas do Time nao funciona pra essa conta, mas o acesso as duas pastas configuradas (`FIGMA_FOLDER_PRODUCAO`/`FIGMA_FOLDER_WIP`) pode funcionar de qualquer forma - sao chamadas independentes.

Se a resposta da API vier com campos diferentes do esperado (nome, thumbnail ou data em branco no site), rode localmente com depuracao:

```bash
FIGMA_TOKEN=xxx FIGMA_FILE_IDS_PRODUCAO="id1,id2" FIGMA_FILE_IDS_WIP="id3,id4" DEBUG=1 node figma-sync.js
```

Isso imprime a resposta bruta da API - ajuste os nomes de campo na funcao `mapFile` em `figma-sync.js` se necessario.

## 6. Publicar no Cloudflare Pages

1. Crie uma conta gratuita em `dash.cloudflare.com` (ou use a existente do RA).
2. **Workers & Pages > Create > Pages > Connect to Git** e selecione o repositorio.
3. Build command: deixe em branco (nao ha build). Output directory: `/` (raiz).
4. Deploy. O Cloudflare vai gerar uma URL do tipo `figma-tracking-catalog.pages.dev`, e vai redeployar automaticamente a cada commit (inclusive os commits automaticos do workflow).

## 7. Restringir acesso com Cloudflare Access (Zero Trust)

1. No painel Cloudflare, vá em **Zero Trust > Access > Applications > Add an application > Self-hosted**.
2. Aponte para o dominio do Pages criado no passo 6.
3. Crie uma politica permitindo apenas e-mails terminados em `@reclameaqui.com.br` (login por codigo enviado por e-mail, sem precisar de senha compartilhada).
4. Salve. A partir dai, qualquer pessoa que abrir o site vai precisar logar com o e-mail corporativo antes de ver o catalogo.

O plano gratuito do Cloudflare Access cobre ate 50 usuarios autenticados - suficiente para uso interno de um time.

## Limitacoes conhecidas

- O Figma nao tem um evento de webhook para "arquivo criado" (so `FILE_UPDATE`, `FILE_DELETE`, `FILE_VERSION_UPDATE`, `LIBRARY_PUBLISH`, `FILE_COMMENT`, `DEV_MODE_STATUS_UPDATE`). Por isso a deteccao de arquivo novo e por polling (a cada 20 min), nao instantanea - e no caminho de lista de ids, "detectar" um arquivo novo tambem depende de alguem adicionar a linha na variavel, nao e automatico.
- Listar a pasta inteira (`FIGMA_FOLDER_PRODUCAO`/`FIGMA_FOLDER_WIP`) exige nivel de permissao de admin do Time no Figma pra essa conta - testamos com Personal Access Token e com OAuth (incluindo o escopo legado `projects:read`) e os dois deram erro de permissao. Por isso o caminho recomendado e a lista de file ids, que so precisa de acesso de leitura ao arquivo em si.
- Existem duas versoes da API pra listar arquivos de uma pasta, usadas soh se a lista de ids estiver vazia: a nova (`/v2/folders/:id/files`) e a classica (`/v1/projects/:id/files`, que exige o escopo depreciado `projects:read`). O script tenta a nova primeiro e cai pra classica se a nova devolver 404.
- Os nomes de campo retornados pela API do Figma podem variar; use o modo `DEBUG=1` (passo 5) se o catalogo aparecer com dados faltando.
- O link de cada card aponta para `https://www.figma.com/file/<key>`. Mesmo pra arquivos que sao boards do FigJam (URL original com `/board/`) ou usam o formato novo `/design/<key>/...`, esse link funciona - o Figma redireciona automaticamente.
