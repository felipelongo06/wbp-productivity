var fetch = require("node-fetch");
var { supabase } = require("./supabase");
var { categorizeCard } = require("./categorizer");
var { parseLabels } = require("./label-parser");

var TRELLO_API = "https://api.trello.com/1";
var COMPLETED_LIST_NAMES = ["concluido", "concluído", "done", "finalizado", "concluído", "concluido"];

async function syncOrganization(orgId) {
  var { data: conn } = await supabase.from("trello_connections").select("*").eq("org_id", orgId).single();
  if (!conn) return;
  var authParams = "key=" + conn.trello_api_key + "&token=" + conn.trello_token;
  for (var b = 0; b < conn.board_ids.length; b++) {
    await syncBoard(orgId, conn.board_ids[b], authParams, conn);
  }
}

async function syncBoard(orgId, boardId, authParams, conn) {
  try {
    var boardRes = await fetch(TRELLO_API + "/boards/" + boardId + "?fields=name&" + authParams);
    var board = await boardRes.json();
    var boardName = board.name || boardId;

    var listsRes = await fetch(TRELLO_API + "/boards/" + boardId + "/lists?fields=id,name&" + authParams);
    var lists = await listsRes.json();
    var listMap = {};
    lists.forEach(function(l) { listMap[l.id] = l.name; });

    var cardsRes = await fetch(TRELLO_API + "/boards/" + boardId + "/cards/all?fields=name,desc,idList,labels,idMembers,due,closed,dateLastActivity&members=true&" + authParams);
    var cards = await cardsRes.json();
    if (!Array.isArray(cards)) return;

    console.log("[Sync] " + boardName + ": " + cards.length + " cards");

    var newCards = 0, updatedCards = 0;

    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var listName = listMap[card.idList] || "Desconhecido";
      var isCompleted = card.closed || COMPLETED_LIST_NAMES.some(function(n) {
        return listName.toLowerCase().indexOf(n) >= 0;
      });

      // Parsear labels para prioridade, responsavel, cliente
      var parsed = parseLabels(card.labels || []);
      var labelNames = (card.labels || []).map(function(l) { return l.name; });

      // Cliente: label > titulo [Cliente] > board name
      var client = parsed.client;
      if (!client) {
        var bracketMatch = (card.name || "").match(/^\[([^\]]+)\]/);
        if (bracketMatch) client = bracketMatch[1];
        else client = boardName;
      }

      var { data: existing } = await supabase.from("cards")
        .select("id, list_name, status, category")
        .eq("org_id", orgId).eq("trello_card_id", card.id).single();

      if (!existing) {
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
          priority: parsed.priority,
          responsible: parsed.responsible,
          assigned_to: card.idMembers || [],
          assigned_names: parsed.responsible ? [parsed.responsible] : [],
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
        var updates = {
          list_name: listName,
          title: card.name,
          priority: parsed.priority,
          responsible: parsed.responsible,
          assigned_names: parsed.responsible ? [parsed.responsible] : [],
          labels: card.labels || [],
          client: client,
          last_synced_at: new Date().toISOString(),
        };

        if (isCompleted && existing.status !== "completed") {
          updates.status = "completed";
          updates.completed_at = new Date().toISOString();
        } else if (!isCompleted && existing.status === "completed") {
          updates.status = "active";
          updates.completed_at = null;
        }

        if (existing.list_name !== listName) {
          await supabase.from("card_movements").insert({
            card_id: existing.id, org_id: orgId,
            from_list: existing.list_name, to_list: listName, moved_at: new Date().toISOString(),
          });
        }

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
    console.error("[Sync] Erro board " + boardId + ":", err.message);
  }
}

async function syncAll() {
  var { data: orgs } = await supabase.from("organizations").select("id");
  if (!orgs) return;
  for (var i = 0; i < orgs.length; i++) await syncOrganization(orgs[i].id);
}

module.exports = { syncAll: syncAll, syncOrganization: syncOrganization };
