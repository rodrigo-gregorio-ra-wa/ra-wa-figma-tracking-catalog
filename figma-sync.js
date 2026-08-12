// figma-sync.js
//
// Consulta a API do Figma (v2) em duas pastas (folders) de um Team:
//   - pasta "producao"        -> mapas de trackeamento ja implementados
//   - pasta "work_in_progress" -> mapas de trackeamento em desenvolvimento
//
// Gera/atualiza o arquivo catalog.json, consumido pelo site estatico (app.js).
//
// Variaveis de ambiente necessarias:
//   FIGMA_TOKEN               -> Personal Access Token do Figma (scope: folders:read)
//   FIGMA_FOLDER_PRODUCAO     -> ID da pasta com os arquivos em producao
//   FIGMA_FOLDER_WIP          -> ID da pasta com os arquivos em work in progress
//
// Variavel opcional:
//   DEBUG=1                   -> imprime a resposta bruta da API antes de mapear os campos
//
// Uso: node figma-sync.js

var https = require('https');
var fs    = require('fs');
var path  = require('path');

var FIGMA_TOKEN           = process.env.FIGMA_TOKEN;
var FIGMA_FOLDER_PRODUCAO = process.env.FIGMA_FOLDER_PRODUCAO;
var FIGMA_FOLDER_WIP      = process.env.FIGMA_FOLDER_WIP;
var DEBUG                 = process.env.DEBUG === '1';

var OUTPUT_PATH = path.join(__dirname, 'catalog.json');

if (!FIGMA_TOKEN || !FIGMA_FOLDER_PRODUCAO || !FIGMA_FOLDER_WIP) {
  console.error('Faltam variaveis de ambiente: FIGMA_TOKEN, FIGMA_FOLDER_PRODUCAO, FIGMA_FOLDER_WIP.');
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
        callback(new Error('Figma API respondeu ' + response.statusCode + ' para ' + pathname + ': ' + body), null);
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

// Extrai, de forma defensiva, os campos que interessam de um arquivo retornado pela API.
// Nomes de campo podem variar entre versoes da API do Figma; por isso tenta varias
// alternativas antes de desistir. Rode com DEBUG=1 para inspecionar a resposta bruta
// e ajustar esta funcao caso a Figma mude o formato.
function mapFile(rawFile) {
  var fileKey = rawFile.key || rawFile.file_key || rawFile.id;
  var updated = rawFile.last_modified || rawFile.lastModified || rawFile.updated_at || null;

  return {
    nome        : rawFile.name || '(sem nome)',
    thumbnail   : rawFile.thumbnail_url || rawFile.thumbnailUrl || null,
    atualizado  : updated,
    url         : fileKey ? ('https://www.figma.com/file/' + fileKey) : null
  };
}

// Lista os arquivos de uma pasta (folder) do Figma.
function listarArquivosDaPasta(folderId, callback) {
  figmaGet('/v2/folders/' + folderId + '/files', function (error, data) {
    if (error) {
      callback(error, null);
      return;
    }

    if (DEBUG) {
      console.log('--- resposta bruta da pasta ' + folderId + ' ---');
      console.log(JSON.stringify(data, null, 2));
    }

    var arquivosBrutos = data.files || data.items || [];
    var arquivos        = arquivosBrutos.map(mapFile);

    callback(null, arquivos);
  });
}

listarArquivosDaPasta(FIGMA_FOLDER_PRODUCAO, function (erroProducao, arquivosProducao) {
  if (erroProducao) {
    console.error('Erro ao listar pasta de producao:', erroProducao.message);
    process.exit(1);
  }

  listarArquivosDaPasta(FIGMA_FOLDER_WIP, function (erroWip, arquivosWip) {
    if (erroWip) {
      console.error('Erro ao listar pasta de work in progress:', erroWip.message);
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
