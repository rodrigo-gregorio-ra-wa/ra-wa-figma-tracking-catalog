// app.js
// Le catalog.json (gerado pelo figma-sync.js) e monta os cards do catalogo.
// Escrito em estilo ES5, sem bibliotecas externas.

(function () {
  'use strict';

  var CATALOG_URL = 'catalog.json';

  function formatarData(isoString) {
    if (!isoString) {
      return '';
    }

    var data = new Date(isoString);

    if (isNaN(data.getTime())) {
      return '';
    }

    var dia   = String(data.getDate()).padStart(2, '0');
    var mes   = String(data.getMonth() + 1).padStart(2, '0');
    var ano   = data.getFullYear();

    return 'Atualizado em ' + dia + '/' + mes + '/' + ano;
  }

  function criarCard(arquivo) {
    var link = document.createElement('a');
    link.className = 'card';
    link.href       = arquivo.url || '#';
    link.target     = '_blank';
    link.rel        = 'noopener noreferrer';

    var img = document.createElement('img');
    img.className = 'card-thumb';
    img.alt       = arquivo.nome;
    img.src       = arquivo.thumbnail || '';
    img.loading   = 'lazy';

    var corpo = document.createElement('div');
    corpo.className = 'card-corpo';

    var nome = document.createElement('p');
    nome.className   = 'card-nome';
    nome.textContent = arquivo.nome;

    var data = document.createElement('p');
    data.className   = 'card-data';
    data.textContent = formatarData(arquivo.atualizado);

    corpo.appendChild(nome);
    corpo.appendChild(data);

    link.appendChild(img);
    link.appendChild(corpo);

    return link;
  }

  function renderizarGrade(elementoGrade, arquivos) {
    elementoGrade.innerHTML = '';

    if (!arquivos || arquivos.length === 0) {
      var vazio = document.createElement('p');
      vazio.className   = 'vazio';
      vazio.textContent = 'Nenhum arquivo encontrado nesta pasta ainda.';
      elementoGrade.appendChild(vazio);
      return;
    }

    for (var i = 0; i < arquivos.length; i = i + 1) {
      elementoGrade.appendChild(criarCard(arquivos[i]));
    }
  }

  function carregarCatalogo() {
    var textoAtualizacao = document.getElementById('texto-atualizacao');
    var gradeProducao     = document.getElementById('grade-producao');
    var gradeWip          = document.getElementById('grade-wip');

    fetch(CATALOG_URL, { cache: 'no-store' })
      .then(function (resposta) {
        if (!resposta.ok) {
          throw new Error('Nao foi possivel carregar catalog.json (status ' + resposta.status + ')');
        }
        return resposta.json();
      })
      .then(function (catalogo) {
        renderizarGrade(gradeProducao, catalogo.producao);
        renderizarGrade(gradeWip, catalogo.workInProgress);
        textoAtualizacao.textContent = formatarData(catalogo.geradoEm) || 'Catalogo carregado.';
      })
      .catch(function (erro) {
        textoAtualizacao.textContent = 'Erro ao carregar o catalogo: ' + erro.message;
      });
  }

  document.addEventListener('DOMContentLoaded', carregarCatalogo);
}());
