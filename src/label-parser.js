/**
 * Parseia labels do Trello em 3 categorias: prioridade, responsavel, cliente
 */

var PRIORITY_LABELS = {
  'altissima': 'altissima',
  'altíssima': 'altissima',
  'urgente': 'altissima',
  'alta': 'alta',
  'media': 'media',
  'média': 'media',
  'baixa': 'baixa',
  'neutra': 'neutra',
  'normal': 'neutra',
};

var PRIORITY_DISPLAY = {
  'altissima': 'Altissima',
  'alta': 'Alta',
  'media': 'Media',
  'baixa': 'Baixa',
  'neutra': 'Neutra',
};

var PRIORITY_COLORS_BY_TRELLO = {
  'red': 'altissima',
  'orange': 'alta',
  'yellow': 'media',
  'green': 'baixa',
  'sky': 'neutra',
  'blue': null,
  'purple': null,
  'pink': null,
  'black': null,
  'lime': null,
};

/**
 * Classifica uma label individual
 * @returns {{ type: 'priority'|'person'|'client'|'unknown', value: string }}
 */
function classifyLabel(label) {
  var name = (label.name || '').trim();
  var nameLower = name.toLowerCase();
  var color = (label.color || '').toLowerCase();

  if (!name) return { type: 'unknown', value: '' };

  // 1. Checar se e prioridade pelo nome
  if (PRIORITY_LABELS[nameLower]) {
    return { type: 'priority', value: PRIORITY_LABELS[nameLower] };
  }

  // 2. Checar se e prioridade pela cor do Trello (com emoji no nome tipo "🟡 Alta")
  var cleanName = name.replace(/^[\u{1F300}-\u{1F9FF}\s]+/u, '').trim().toLowerCase();
  if (PRIORITY_LABELS[cleanName]) {
    return { type: 'priority', value: PRIORITY_LABELS[cleanName] };
  }

  // 3. Se o nome parece um nome de pessoa (1-2 palavras, sem caracteres especiais de empresa)
  // Heuristica: nomes de pessoa sao 1-2 palavras curtas sem numeros/simbolos
  var words = name.split(/\s+/);
  var looksLikePerson = words.length <= 3 &&
    words.every(function(w) { return /^[A-ZÀ-Ú][a-zà-ú]+$/.test(w); }) &&
    !nameLower.match(/hotel|viagen|grupo|instituto|agencia|midia|paga|ads|meta|google|social|crm|tracking/);

  if (looksLikePerson) {
    return { type: 'person', value: name };
  }

  // 4. Provavelmente cliente
  return { type: 'client', value: name };
}

/**
 * Parseia todas as labels de um card
 * @param {Array} labels - Array de labels do Trello [{name, color, id}]
 * @returns {{ priority: string, responsible: string|null, client: string|null, other: string[] }}
 */
function parseLabels(labels) {
  var result = {
    priority: 'neutra',
    responsible: null,
    client: null,
    other: [],
  };

  if (!labels || !labels.length) return result;

  for (var i = 0; i < labels.length; i++) {
    var classified = classifyLabel(labels[i]);
    switch (classified.type) {
      case 'priority':
        result.priority = classified.value;
        break;
      case 'person':
        // Se ja tem um responsavel, pega o primeiro
        if (!result.responsible) result.responsible = classified.value;
        break;
      case 'client':
        if (!result.client) result.client = classified.value;
        break;
      default:
        result.other.push(classified.value);
    }
  }

  return result;
}

module.exports = { parseLabels: parseLabels, PRIORITY_DISPLAY: PRIORITY_DISPLAY };
