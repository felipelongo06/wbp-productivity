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

  // 3. Provavelmente cliente
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
