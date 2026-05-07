var Anthropic = require("@anthropic-ai/sdk");
var client = new Anthropic();

var SYSTEM_PROMPT = 'Voce categoriza tarefas de uma agencia de marketing digital. Para cada tarefa, retorne APENAS um JSON valido com category, subcategory e complexity.\n\nCategorias disponiveis:\n- midia_paga: Campanhas, otimizacao, orcamento, segmentacao, bid, criativos de ads\n  Subcategorias: campanha_nova, otimizacao, relatorio, orcamento, audiencia, criativo, tracking\n- social_media: Posts, stories, reels, calendario editorial, engajamento\n  Subcategorias: conteudo, calendario, engajamento, analise, stories_reels\n- crm: Automacoes, fluxos, segmentacao de base, nutrição, lead scoring\n  Subcategorias: automacao, segmentacao, integracao, fluxo, analise\n- ai_automacao: Chatbots, agentes AI, prompts, integracoes com AI\n  Subcategorias: chatbot, agente, automacao, integracao\n- tracking_dados: Pixels, CAPI, UTMs, dashboards, analytics, GTM\n  Subcategorias: pixel_capi, utm, dashboard, analytics, gtm\n- estrategia: Planejamento, reunioes estrategicas, planos de midia\n  Subcategorias: planejamento, plano_midia, reuniao, apresentacao\n- criacao: Design, video, copy (nao especifico de ads)\n  Subcategorias: design, video, copy, briefing\n- operacional: Tarefas administrativas, processos internos\n  Subcategorias: processo, administrativo, treinamento, documentacao\n\nComplexity: nota de 0 a 10 baseada em:\n- 0-2: Tarefas triviais (responder email, verificar status, tarefa de 5 min)\n- 3-4: Tarefas simples (ajustar bid, duplicar campanha, exportar relatorio)\n- 5-6: Tarefas moderadas (criar campanha do zero, configurar audiencia, relatorio detalhado)\n- 7-8: Tarefas complexas (setup CAPI, estrategia multicanal, integracao de sistemas)\n- 9-10: Tarefas muito complexas (reestruturar conta inteira, migrar tracking completo, projeto de longo prazo)\n\nResponda APENAS com JSON: {"category":"...","subcategory":"...","complexity":N}';

/**
 * Categoriza um card usando Claude API
 */
async function categorizeCard(title, description, labels) {
  try {
    var prompt = "Tarefa: " + title;
    if (description) prompt += "\nDescricao: " + description.substring(0, 500);
    if (labels && labels.length) prompt += "\nLabels: " + labels.join(", ");

    var message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    var text = message.content.filter(function(b) { return b.type === "text"; })
      .map(function(b) { return b.text; }).join("");
    var cleaned = text.replace(/```json\s*|```\s*/g, "").trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("[Categorizer] Erro:", err.message);
    return { category: "operacional", subcategory: "processo", complexity: 5 };
  }
}

/**
 * Detecta o cliente a partir do titulo do card, labels, ou board
 */
function detectClient(card, boardName) {
  var text = ((card.name || "") + " " + (boardName || "")).toLowerCase();
  var labels = (card.labels || []).map(function(l) { return (l.name || "").toLowerCase(); });
  var allText = text + " " + labels.join(" ");

  var clients = [
    { names: ["zupper", "viagens"], label: "Zupper Viagens" },
    { names: ["mbigucci", "bigucci"], label: "MBigucci" },
    { names: ["b&b", "bb hotel", "b&b hotel"], label: "B&B Hotels" },
    { names: ["ibh", "barbara helen", "instituto"], label: "IBH" },
  ];

  for (var i = 0; i < clients.length; i++) {
    for (var j = 0; j < clients[i].names.length; j++) {
      if (allText.indexOf(clients[i].names[j]) >= 0) return clients[i].label;
    }
  }

  // Tentar extrair do formato [Cliente] titulo
  var bracketMatch = (card.name || "").match(/^\[([^\]]+)\]/);
  if (bracketMatch) return bracketMatch[1];

  return boardName || "N/A";
}

module.exports = { categorizeCard: categorizeCard, detectClient: detectClient };
