// figma-sync.js
//
// Consulta a API do Figma (v2) usando apenas a permissão "folders:read".
// O script lista as pastas do Time dinamicamente e encontra as pastas
// de Produção e Work in Progress automaticamente pelo nome.

const fs = require('fs');
const path = require('path');

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FIGMA_TEAM_ID = process.env.FIGMA_TEAM_ID;

// Você pode passar esses nomes via variável de ambiente, mas os padrões já estão aqui
const NOME_PRODUCAO = process.env.FIGMA_NOME_PRODUCAO || 'producao';
const NOME_WIP = process.env.FIGMA_NOME_WIP || 'work in progress';

const OUTPUT_PATH = path.join(__dirname, 'catalog.json');

if (!FIGMA_TOKEN || !FIGMA_TEAM_ID) {
  console.error('ERRO: Faltam as variáveis FIGMA_TOKEN ou FIGMA_TEAM_ID.');
  process.exit(1);
}

// Remove acentos e converte para minúsculas para facilitar a busca pelo nome
const normalize = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Função auxiliar para fazer requisições à API do Figma
async function figmaFetch(endpoint) {
  const url = `https://api.figma.com${endpoint}`;
  const response = await fetch(url, {
    headers: { 'X-Figma-Token': FIGMA_TOKEN }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erro HTTP ${response.status} na rota ${endpoint}: ${errorText}`);
  }

  return await response.json();
}

async function run() {
  try {
    console.log(`Buscando pastas no Time ${FIGMA_TEAM_ID}...`);
    const teamData = await figmaFetch(`/v2/teams/${FIGMA_TEAM_ID}/folders`);
    
    const pastas = teamData.folders || teamData.items || [];
    
    if (pastas.length === 0) {
      throw new Error("Nenhuma pasta encontrada na raiz deste time. Verifique se o token tem acesso.");
    }

    // Busca as pastas ignorando diferenças de acentuação ou maiúsculas
    const pastaProducao = pastas.find(p => normalize(p.name).includes(normalize(NOME_PRODUCAO)));
    const pastaWip = pastas.find(p => normalize(p.name).includes(normalize(NOME_WIP)));

    if (!pastaProducao || !pastaWip) {
      console.log('Pastas disponíveis no time:', pastas.map(p => p.name).join(', '));
      throw new Error(`Não foi possível encontrar as pastas pelo nome. Veja a lista acima e ajuste as variáveis de ambiente se necessário.`);
    }

    console.log(`✓ Pasta encontrada: ${pastaProducao.name} (ID Real gerado: ${pastaProducao.id})`);
    console.log(`✓ Pasta encontrada: ${pastaWip.name} (ID Real gerado: ${pastaWip.id})`);

    // Agora busca os arquivos usando o ID Real na rota V2
    console.log('\nListando arquivos de Produção...');
    const dataProducao = await figmaFetch(`/v2/folders/${pastaProducao.id}/files`);
    const arquivosProducao = (dataProducao.files || dataProducao.items || []).map(mapFile);

    console.log('Listando arquivos de Work In Progress...');
    const dataWip = await figmaFetch(`/v2/folders/${pastaWip.id}/files`);
    const arquivosWip = (dataWip.files || dataWip.items || []).map(mapFile);

    const catalogo = {
      geradoEm: new Date().toISOString(),
      producao: arquivosProducao,
      workInProgress: arquivosWip
    };

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(catalogo, null, 2) + '\n', 'utf8');

    console.log('\ncatalog.json atualizado com sucesso!');
    console.log(`  produção:         ${arquivosProducao.length} arquivo(s)`);
    console.log(`  work in progress: ${arquivosWip.length} arquivo(s)`);

  } catch (erro) {
    console.error('\nFalha no processo:', erro.message);
    process.exit(1);
  }
}

function mapFile(rawFile) {
  const fileKey = rawFile.key || rawFile.file_key || rawFile.id;
  const updated = rawFile.last_modified || rawFile.lastModified || rawFile.updated_at || null;

  return {
    nome: rawFile.name || '(sem nome)',
    thumbnail: rawFile.thumbnail_url || rawFile.thumbnailUrl || null,
    atualizado: updated,
    url: fileKey ? ('https://www.figma.com/file/' + fileKey) : null
  };
}

run();
