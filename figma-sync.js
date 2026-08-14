// figma-sync.js
//
// Gera/atualiza o catalog.json (consumido pelo site estatico em app.js) com os arquivos de
// duas categorias: "producao" (mapas de trackeamento ja implementados) e "workInProgress"
// (mapas em desenvolvimento).
//
// Pra cada categoria, o script decide como buscar os arquivos, nessa ordem de prioridade:
//
//   1. Lista de file ids (FIGMA_FILE_IDS_PRODUCAO / FIGMA_FILE_IDS_WIP) - se estiver
//      preenchida, busca cada arquivo direto por /v1/files/:id. E o unico caminho que
//      comprovadamente funciona com token de conta sem permissao de admin no Team.
//   2. Pasta/folder (FIGMA_FOLDER_PRODUCAO / FIGMA_FOLDER_WIP) - se nao houver lista de
//      ids, tenta escanear a pasta inteira: primeiro a rota nova (/v2/folders/:id/files),
//      com fallback pra rota classica (/v1/projects/:id/files) se a nova devolver 404.
//
// Ou seja, ao todo sao ate 4 tentativas possiveis por categoria: file ids, v2/folders,
// v1/projects (fallback da anterior) e, so como diagnostico solto (nao bloqueia nada),
// a listagem de pastas do Team via FIGMA_TEAM_ID.
//
// Variaveis de ambiente:
//   FIGMA_TOKEN                -> obrigatoria. Personal Access Token do Figma.
//
//   FIGMA_FILE_IDS_PRODUCAO    -> opcional (prioridade 1). Lista de file ids da categoria
//   FIGMA_FILE_IDS_WIP            "producao"/"work in progress". Aceita um id por linha,
//                                  ids separados por virgula, ou um array JSON de strings
//                                  (ex: ["abc123","def456"]). O file id e o trecho da URL
//                                  do arquivo logo depois de /file/, /design/ ou /board/.
//
//   FIGMA_FOLDER_PRODUCAO      -> opcional (prioridade 2, usado so se a lista de ids acima
//   FIGMA_FOLDER_WIP               estiver vazia). ID da pasta/folder no Figma (numero
//                                  depois de /project/ na URL da pasta).
//
//   FIGMA_TEAM_ID              -> opcional. Se definida, lista as pastas de nivel superior
//                                  do Team so para diagnostico (log), sem bloquear o script.
//
//   DEBUG=1                    -> opcional. Imprime a resposta bruta da API antes de mapear
//                                  os campos.
//
// Pelo menos uma das duas fontes (lista de ids OU pasta) precisa estar preenchida pra cada
// categoria (producao e work in progress) - senao o script para com erro.
//
// Uso: node figma-sync.js

var https = require('https');
var fs    = require('fs');
var path  = require('path');

var FIGMA_TOKEN             = process.env.FIGMA_TOKEN;
var FIGMA_FILE_IDS_PRODUCAO = process.env.FIGMA_FILE_IDS_PRODUCAO || '';
var FIGMA_FILE_IDS_WIP      = process.env.FIGMA_FILE_IDS_WIP || '';
var FIGMA_FOLDER_PRODUCAO   = process.env.FIGMA_FOLDER_PRODUCAO || '';
var FIGMA_FOLDER_WIP        = process.env.FIGMA_FOLDER_WIP || '';
var FIGMA_TEAM_ID           = process.env.FIGMA_TEAM_ID || null;
var DEBUG                   = process.env.DEBUG === '1';

var OUTPUT_PATH = path.join(__dirname, 'catalog.json');

if (!FIGMA_TOKEN) {
  console.error('Falta a variavel de ambiente FIGMA_TOKEN.');
  process.exit(1);
}

if (!FIGMA_FILE_IDS_PRODUCAO && !FIGMA_FOLDER_PRODUCAO) {
  console.error('Categoria "producao" sem fonte configurada: defina FIGMA_FILE_IDS_PRODUCAO ou FIGMA_FOLDER_PRODUCAO.');
  process.exit(1);
}

if (!FIGMA_FILE_IDS_WIP && !FIGMA_FOLDER_WIP) {
  console.error('Categoria "work in progress" sem fonte configurada: defina FIGMA_FILE_IDS_WIP ou FIGMA_FOLDER_WIP.');
  process.exit(1);
}

// Faz uma chamada GET na API do Figma e devolve o corpo (JSON) via callback.
function figmaGet(pathname, callback) {
  var options = {
    hostname : 'api.figma.com',
    path     : pathname,
    method   : 'GET',
    headers  : { 'X-Figma-Token': FIGMA_TOKEN }
  };

  var request = https.request(options, function (response) {
    var chunks = [];

    response.on('data', function (chunk) {
      chunks.push(chunk);
    });

    response.on('end', function () {
      var body = Buffer.concat(chunks).toString('utf8');

      if (response.statusCode < 200 || response.statusCode >= 300) {
        var httpError = new Error('Figma API respondeu ' + response.statusCode + ' para ' + pathname + ': ' + body);
        httpError.statusCode = response.statusCode;
        callback(httpError, null);
        return;
      }

      try {
        callback(null, JSON.parse(body));
      } catch (parseError) {
        callback(parseError, null);
      }
    });
  });

  request.on('error', function (error) {
    callback(error, null);
  });

  request.end();
}

// Converte o valor bruto de uma variavel de lista de ids em um array de strings limpo.
// Aceita 3 formatos: array JSON (ex: ["abc","def"]), um id por linha, ou ids separados
// por virgula. Tambem aceita uma mistura de linhas e virgulas no mesmo valor.
function parseListaDeIds(valorBruto) {
  var texto = (valorBruto || '').trim();

  if (!texto) {
    return [];
  }

  if (texto.charAt(0) === '[') {
    try {
      var arrayJson = JSON.parse(texto);
      return arrayJson
        .map(function (item) { return String(item).trim(); })
        .filter(function (item) { return item.length > 0; });
    } catch (erroParse) {
      console.log('[aviso] Nao consegui interpretar a lista de ids como array JSON, tentando linha/virgula: ' + erroParse.message);
    }
  }

  return texto
    .split(/[\n,]/)
    .map(function (item) { return item.trim(); })
    .filter(function (item) { return item.length > 0; });
}

// Extrai, de forma defensiva, os campos que interessam de um arquivo retornado pela API.
// Nomes de campo podem variar entre versoes/rotas da API do Figma; por isso tenta varias
// alternativas antes de desistir. Rode com DEBUG=1 para inspecionar a resposta bruta e
// ajustar esta funcao caso a Figma mude o formato.
//
// idConhecido e opcional: quando o arquivo foi buscado direto por /v1/files/:id (lista de
// ids), ja sabemos o file id de antemao (a resposta desse endpoint nao repete o id/key).
function mapFile(rawFile, idConhecido) {
  var fileKey = idConhecido || rawFile.key || rawFile.file_key || rawFile.id;
  var updated = rawFile.last_modified || rawFile.lastModified || rawFile.updated_at || null;

  return {
    nome        : rawFile.name || '(sem nome)',
    thumbnail   : rawFile.thumbnail_url || rawFile.thumbnailUrl || null,
    atualizado  : updated,
    url         : fileKey ? ('https://www.figma.com/file/' + fileKey) : null
  };
}

// ---------------------------------------------------------------------------------------
// Caminho 1 (prioridade): buscar arquivos direto por file id (/v1/files/:id).
// ---------------------------------------------------------------------------------------

// Busca um unico arquivo por id. Nunca aborta a categoria inteira por causa de um id com
// problema (arquivo apagado, sem acesso etc.) - so registra o erro e segue pros proximos.
function buscarArquivoPorId(fileId, callback) {
  figmaGet('/v1/files/' + fileId, function (erro, data) {
    if (erro) {
      console.log('[aviso] Nao consegui buscar o arquivo ' + fileId + ': ' + erro.message);
      callback(null, null);
      return;
    }

    if (DEBUG) {
      console.log('--- resposta bruta do arquivo ' + fileId + ' ---');
      console.log(JSON.stringify(data, null, 2));
    }

    callback(null, mapFile(data, fileId));
  });
}

// Busca uma lista de file ids, um de cada vez (sequencial, pra nao estourar rate limit),
// e devolve so os que deram certo.
function buscarArquivosPorIds(ids, callback) {
  var resultados = [];

  function proximo(indice) {
    if (indice >= ids.length) {
      callback(null, resultados);
      return;
    }

    buscarArquivoPorId(ids[indice], function (erro, arquivo) {
      if (arquivo) {
        resultados.push(arquivo);
      }
      proximo(indice + 1);
    });
  }

  proximo(0);
}

// ---------------------------------------------------------------------------------------
// Caminho 2 (fallback): escanear a pasta inteira (v2/folders, com fallback pra v1/projects).
// ---------------------------------------------------------------------------------------

// Converte a resposta bruta da API (v2 ou v1) na lista final de arquivos.
function processarRespostaDaPasta(folderId, data, callback) {
  if (DEBUG) {
    console.log('--- resposta bruta da pasta ' + folderId + ' ---');
    console.log(JSON.stringify(data, null, 2));
  }

  var arquivosBrutos = data.files || data.items || [];
  var arquivos        = arquivosBrutos.map(function (rawFile) { return mapFile(rawFile, null); });

  callback(null, arquivos);
}

// Lista os arquivos de uma pasta do Figma. Tenta a rota nova (v2/folders); se a conta usa o
// modelo classico de Projects (sem pastas aninhadas), a v2 devolve 404 e o script cai para
// a rota classica v1/projects, que usa o mesmo ID (o numero que aparece depois de /project/
// na URL da pasta).
function listarArquivosDaPasta(folderId, callback) {
  figmaGet('/v2/folders/' + folderId + '/files', function (erroV2, dataV2) {
    if (!erroV2) {
      processarRespostaDaPasta(folderId, dataV2, callback);
      return;
    }

    if (erroV2.statusCode !== 404) {
      callback(erroV2, null);
      return;
    }

    if (DEBUG) {
      console.log('/v2/folders/' + folderId + '/files deu 404, tentando /v1/projects/' + folderId + '/files ...');
    }

    figmaGet('/v1/projects/' + folderId + '/files', function (erroV1, dataV1) {
      if (erroV1) {
        callback(erroV1, null);
        return;
      }

      processarRespostaDaPasta(folderId, dataV1, callback);
    });
  });
}

// ---------------------------------------------------------------------------------------
// Escolhe o caminho certo pra cada categoria: lista de ids tem prioridade sobre pasta.
// ---------------------------------------------------------------------------------------
function obterArquivosDaCategoria(nomeCategoria, idsBrutos, folderId, callback) {
  var ids = parseListaDeIds(idsBrutos);

  if (ids.length > 0) {
    console.log('[' + nomeCategoria + '] usando lista de ' + ids.length + ' file id(s).');
    buscarArquivosPorIds(ids, callback);
    return;
  }

  console.log('[' + nomeCategoria + '] sem lista de ids configurada, tentando escanear a pasta ' + folderId + ' ...');
  listarArquivosDaPasta(folderId, callback);
}

// ---------------------------------------------------------------------------------------
// Diagnostico solto (nao bloqueia nada): lista as pastas de nivel superior de um Team.
// ---------------------------------------------------------------------------------------
function diagnosticoPastasDoTime(callback) {
  if (!FIGMA_TEAM_ID) {
    callback();
    return;
  }

  figmaGet('/v2/teams/' + FIGMA_TEAM_ID + '/folders', function (erro, data) {
    if (erro) {
      console.log('[diagnostico] Nao foi possivel listar as pastas do Team ' + FIGMA_TEAM_ID + ': ' + erro.message);
      callback();
      return;
    }

    var pastas = data.folders || data.items || [];

    console.log('[diagnostico] ' + pastas.length + ' pasta(s) de nivel superior encontrada(s) no Team ' + FIGMA_TEAM_ID + ':');

    pastas.forEach(function (pasta) {
      var idPasta = pasta.id || pasta.key || '(sem id)';
      console.log('[diagnostico]   id=' + idPasta + '  nome="' + pasta.name + '"');
    });

    if (DEBUG) {
      console.log('[diagnostico] resposta bruta de /v2/teams/' + FIGMA_TEAM_ID + '/folders:');
      console.log(JSON.stringify(data, null, 2));
    }

    callback();
  });
}

diagnosticoPastasDoTime(function () {
  obterArquivosDaCategoria('producao', FIGMA_FILE_IDS_PRODUCAO, FIGMA_FOLDER_PRODUCAO, function (erroProducao, arquivosProducao) {
    if (erroProducao) {
      console.error('Erro ao obter arquivos de producao:', erroProducao.message);
      process.exit(1);
    }

    obterArquivosDaCategoria('work in progress', FIGMA_FILE_IDS_WIP, FIGMA_FOLDER_WIP, function (erroWip, arquivosWip) {
      if (erroWip) {
        console.error('Erro ao obter arquivos de work in progress:', erroWip.message);
        process.exit(1);
      }

      var catalogo = {
        geradoEm         : new Date().toISOString(),
        producao         : arquivosProducao,
        workInProgress   : arquivosWip
      };

      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(catalogo, null, 2) + '\n', 'utf8');

      console.log('catalog.json atualizado:');
      console.log('  producao:          ' + arquivosProducao.length + ' arquivo(s)');
      console.log('  work in progress:  ' + arquivosWip.length + ' arquivo(s)');
    });
  });
});
