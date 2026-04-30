var express = require("express");
var { supabase } = require("../supabase");
var { syncOrganization } = require("../trello-sync");
var { requireRole } = require("../auth");
var router = express.Router();

// ========== USUARIO ATUAL ==========

router.get("/me", function(req, res) {
  res.json({
    id: req.user.id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
    clients: req.user.clients,
    org: req.user.organizations,
    trello_member_id: req.user.trello_member_id,
  });
});

// ========== GESTAO: GERENCIAR USUARIOS ==========

router.get("/users", requireRole("gestao"), async function(req, res) {
  var { data } = await supabase.from("users").select("*").eq("org_id", req.orgId).order("name");
  res.json(data || []);
});

router.post("/users", requireRole("gestao"), async function(req, res) {
  var { email, name, role, clients, trello_member_id } = req.body;
  if (!email || !name || !role) return res.status(400).json({ error: "email, name e role obrigatorios" });

  // Criar usuario no Supabase Auth
  var { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
    email: email,
    password: req.body.password || email.split("@")[0] + "2026!",
    email_confirm: true,
  });
  if (authErr) return res.status(400).json({ error: authErr.message });

  // Criar perfil
  var { data, error } = await supabase.from("users").insert({
    auth_id: authUser.user.id,
    org_id: req.orgId,
    email: email,
    name: name,
    role: role,
    clients: clients || [],
    trello_member_id: trello_member_id || null,
  }).select().single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.put("/users/:id", requireRole("gestao"), async function(req, res) {
  var updates = {};
  if (req.body.name) updates.name = req.body.name;
  if (req.body.role) updates.role = req.body.role;
  if (req.body.clients) updates.clients = req.body.clients;
  if (req.body.trello_member_id !== undefined) updates.trello_member_id = req.body.trello_member_id;
  if (req.body.active !== undefined) updates.active = req.body.active;

  var { data, error } = await supabase.from("users").update(updates)
    .eq("id", req.params.id).eq("org_id", req.orgId).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// ========== GESTAO: CONEXAO TRELLO ==========

router.get("/trello-connection", async function(req, res) {
  var { data } = await supabase.from("trello_connections").select("*").eq("org_id", req.orgId).single();
  if (data) { data.trello_token = "***" + data.trello_token.slice(-8); }
  res.json(data || null);
});

router.post("/trello-connection", requireRole("gestao"), async function(req, res) {
  var { trello_api_key, trello_token, board_ids } = req.body;
  if (!trello_api_key || !trello_token) return res.status(400).json({ error: "API key e token obrigatorios" });

  // Buscar nomes dos boards
  var boardNames = {};
  for (var i = 0; i < (board_ids || []).length; i++) {
    try {
      var r = await (require("node-fetch"))("https://api.trello.com/1/boards/" + board_ids[i] + "?fields=name&key=" + trello_api_key + "&token=" + trello_token);
      var b = await r.json();
      boardNames[board_ids[i]] = b.name || board_ids[i];
    } catch(e) {}
  }

  // Upsert conexao
  var { data: existing } = await supabase.from("trello_connections").select("id").eq("org_id", req.orgId).single();

  var connData = {
    org_id: req.orgId, trello_api_key: trello_api_key, trello_token: trello_token,
    board_ids: board_ids || [], board_names: boardNames, connected_by: req.user.id,
  };

  if (existing) {
    await supabase.from("trello_connections").update(connData).eq("id", existing.id);
  } else {
    await supabase.from("trello_connections").insert(connData);
  }

  res.json({ success: true, boards: boardNames });
});

// ========== SYNC MANUAL ==========

router.post("/sync", requireRole("gestao", "cs"), async function(req, res) {
  res.json({ status: "started" });
  syncOrganization(req.orgId).catch(function(e) { console.error("[Sync] Erro:", e); });
});

module.exports = router;
