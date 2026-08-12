# Catalogo de Mapas de Trackeamento - Guia de Setup

Site estatico que le duas pastas do Figma (producao e work in progress) e monta um catalogo visual, atualizado automaticamente por um job agendado no GitHub Actions.

Arquitetura: GitHub Actions (roda `figma-sync.js` a cada 20 min, chama a API do Figma e commita `catalog.json`) -> Cloudflare Pages (hospeda o site estatico, redeploy automatico a cada commit) -> Cloudflare Access (restringe o acesso a e-mails @reclameaqui.com.br).

Por que Cloudflare Pages/Access e nao GitHub Pages/Netlify/Vercel puro: como voce pediu acesso restrito ao time do RA com hospedagem gratuita, e senha/SSO em Netlify e Vercel so existe em plano pago (GitHub Pages tambem so fica privado em plano Enterprise), troquei para Cloudflare Pages (mesma categoria, gratuito) + Cloudflare Access (login por e-mail, gratuito para ate 50 pessoas). Se preferir pagar um plano Pro do Netlify/Vercel ou usar infra propria do RA, o site estatico funciona igual, so muda onde ele e hospedado.

## 1. Gerar o token do Figma

1. No Figma, vá em **Configuracoes da conta > Security > Personal access tokens**.
2. Crie um token novo com o scope **`folders:read`**.
3. Guarde o valor gerado - ele não aparece de novo depois.

Voce precisa ser membro do Team onde as duas pastas estao, com permissao de visualizacao.

## 2. Descobrir o ID de cada pasta

Abra cada pasta no navegador (a de producao e a de work in progress). A URL tem esse formato:

```
https://www.figma.com/files/1194314931349749477/project/495482832?fuid=1567979412225723240
```

Nessa URL:

- `1194314931349749477` (logo depois de `/files/`) e o `team_id` - o script nao usa esse numero, e so contexto.
- `495482832` (depois de `/project/`) e o `folder_id` que voce vai colocar em `FIGMA_FOLDER_PRODUCAO` ou `FIGMA_FOLDER_WIP`.
- `?fuid=...` e o ID do seu usuario dentro do Figma - ignore, nao faz parte do folder_id.

Repita para as duas pastas (producao e work in progress) e guarde os dois numeros de `/project/`.

## 3. Criar o repositorio no GitHub

1. Crie um repositorio **privado** (ex: `figma-tracking-catalog`) na organizacao do RA no GitHub.
2. Suba todos os arquivos deste pacote para a raiz do repositorio (mantendo a pasta `.github/workflows/`).

## 4. Configurar os secrets do repositorio

Em **Settings > Secrets and variables > Actions**, crie 3 secrets:

| Nome | Valor |
|---|---|
| `FIGMA_TOKEN` | o token gerado no passo 1 |
| `FIGMA_FOLDER_PRODUCAO` | o folder_id da pasta de producao |
| `FIGMA_FOLDER_WIP` | o folder_id da pasta de work in progress |

## 5. Rodar o workflow pela primeira vez

Vá na aba **Actions** do repositorio, selecione o workflow "Atualizar catalogo de mapas de trackeamento" e clique em **Run workflow** para gerar o primeiro `catalog.json` com dados reais. Depois disso ele roda solo a cada 20 minutos (ajustavel no `cron` do arquivo `.github/workflows/update-catalog.yml`).

Se a resposta da API vier com campos diferentes do esperado (nome, thumbnail ou data em branco no site), rode localmente com depuracao:

```bash
FIGMA_TOKEN=xxx FIGMA_FOLDER_PRODUCAO=xxx FIGMA_FOLDER_WIP=xxx DEBUG=1 node figma-sync.js
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

- O Figma nao tem um evento de webhook para "arquivo criado" (so `FILE_UPDATE`, `FILE_DELETE`, `FILE_VERSION_UPDATE`, `LIBRARY_PUBLISH`, `FILE_COMMENT`, `DEV_MODE_STATUS_UPDATE`). Por isso a deteccao de arquivo novo e por polling (a cada 20 min), nao instantanea.
- Os nomes de campo retornados pela API do Figma para listagem de arquivos em uma pasta podem variar; use o modo `DEBUG=1` (passo 5) se o catalogo aparecer com dados faltando.
- O link de cada card aponta para `https://www.figma.com/file/<key>`. Se o seu Team usa URLs no formato novo `/design/<key>/...`, o link ainda funciona (o Figma redireciona automaticamente).
