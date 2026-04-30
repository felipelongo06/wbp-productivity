var fetch = require("node-fetch");
var { supabase } = require("./supabase");
var { categorizeCard, detectClient } = require("./categorizer");

var TRELLO_API = "https://api.trello.com/1";
var COMPLETED_LIST_NAMES = ["concluido", "concluído", "done", "finalizado", "✅ concluído", "✅ concluido"];

/**
 * Sincroniza cards de todos os boards conectados de uma organizacao
 */
async function syncOrganization(orgId) {
  // Buscar conexao Trello da org
  var { data: conn } = await supabase
    .from("trello_connections")
    .select("*")
    .eq("org_id", orgId)
    .single();

  if (!conn) { console.log("[Sync] Nenhuma conexao Trello para org " + orgId); return; }

  var authParams = "key=" + conn.trello_api_key + "&token=" + conn.trello_token;

  for (var b = 0; b < conn.board_ids.length; b++) {
    var boardId = conn.board_ids[b];
    await syncBoard(orgId, boardId, authParams, conn);
  }
}

/**
 * Sincroniza um board especifico
 */
async function syncBoard(orgId, boardId, authParams, conn) {
  try {
    // Buscar info do board
    var boardRes = await fetch(TRELLO_API + "/boards/" + boardId + "?fields=name&" + authParams);
    var board = await boardRes.json();
    var boardName = board.name || boardId;

    // Buscar listas do board
    var listsRes = await fetch(TRELLO_API + "/boards/" + boardId + "/lists?fields=id,name&" + authParams);
    var lists = await listsRes.json();
    var listMap = {};
    lists.forEach(function(l) { listMap[l.id] = l.name; });

    // Buscar todos os cards (abertos e fechados)
    var cardsRes = await fetch(TRELLO_API + "/boards/" + boardId + "/cards/all?fields=name,desc,idList,labels,idMembers,due,closed,dateLastActivity&members=true&" + authParams);
    var cards = await cardsRes.json();

    if (!Array.isArray(cards)) { console.error("[Sync] Resposta invalida para board " + boardId); return; }

    console.log("[Sync] Board " + boardName + ": " + cards.length + " cards");

    var newCards = 0;
    var updatedCards = 0;

    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var listName = listMap[card.idList] || "Desconhecido";
      var isCompleted = card.closed || COMPLETED_LIST_NAMES.some(function(n) {
        return listName.toLowerCase().indexOf(n) >= 0;
      });

      // Verificar se card ja existe
      var { data: existing } = await supabase
        .from("cards")
        .select("id, list_name, status, category")
        .eq("org_id", orgId)
        .eq("trello_card_id", card.id)
        .single();

      var memberNames = (card.members || []).map(function(m) { return m.fullName || m.username; });
      var memberIds = card.idMembers || [];
      var labelNames = (card.labels || []).map(function(l) { return l.name; });

      if (!existing) {
        // Card novo — categorizar com AI
        var client = detectClient(card, boardName);
        var cat = await categorizeCard(card.name, card.desc, labelNames);

        var cardData = {
          org_id: orgId,
          trello_card_id: card.id,
          board_id: boardId,
          board_name: boardName,
          title: card.name,
          description: card.desc || null,
          list_name: listName,
          client: client,
          category: cat.category,
          subcategory: cat.subcategory,
          assigned_to: memberIds,
          assigned_names: memberNames,
          status: isCompleted ? "completed" : "active",
          created_at: card.dateLastActivity || new Date().toISOString(),
          completed_at: isCompleted ? new Date().toISOString() : null,
          due_date: card.due || null,
          labels: card.labels || [],
          last_synced_at: new Date().toISOString(),
        };

        await supabase.from("cards").insert(cardData);
        newCards++;
      } else {
        // Card existente — atualizar
        var updates = {
          list_name: listName,
          assigned_to: memberIds,
          assigned_names: memberNames,
          title: card.name,
          labels: card.labels || [],
          last_synced_at: new Date().toISOString(),
        };

        // Detectar conclusao
        if (isCompleted && existing.status !== "completed") {
          updates.status = "completed";
          updates.completed_at = new Date().toISOString();
        } else if (!isCompleted && existing.status === "completed") {
          updates.status = "active";
          updates.completed_at = null;
        }

        // Detectar movimentacao
        if (existing.list_name !== listName) {
          await supabase.from("card_movements").insert({
            card_id: existing.id,
            org_id: orgId,
            from_list: existing.list_name,
            to_list: listName,
            moved_at: new Date().toISOString(),
          });
        }

        // Categorizar se nao tinha
        if (!existing.category) {
          var cat2 = await categorizeCard(card.name, card.desc, labelNames);
          updates.category = cat2.category;
          updates.subcategory = cat2.subcategory;
        }

        await supabase.from("cards").update(updates).eq("id", existing.id);
        updatedCards++;
      }
    }

    console.log("[Sync] " + boardName + ": " + newCards + " novos, " + updatedCards + " atualizados");
  } catch (err) {
    console.error("[Sync] Erro no board " + boardId + ":", err.message);
  }
}

/**
 * Sincroniza todas as organizacoes
 */
async function syncAll() {
  var { data: orgs } = await supabase.from("organizations").select("id");
  if (!orgs) return;
  for (var i = 0; i < orgs.length; i++) {
    await syncOrganization(orgs[i].id);
  }
}

module.exports = { syncAll: syncAll, syncOrganization: syncOrganization };
