var express = require("express");
var { supabase } = require("../supabase");
var router = express.Router();

/**
 * Aplica filtro de visibilidade baseado no role do usuario
 */
function applyRoleFilter(query, user) {
  // Gestao: ve tudo
  if (user.role === "gestao") return query;

  // CS: ve apenas cards dos clientes que gerencia
  if (user.role === "cs") {
    if (user.clients && user.clients.length > 0) {
      return query.in("client", user.clients);
    }
    return query.eq("client", "__none__"); // sem clientes = sem dados
  }

  // Operacao: ve apenas cards onde esta assigned
  if (user.role === "operacao") {
    return query.contains("assigned_to", [user.trello_member_id || "__none__"]);
  }

  return query;
}

// ========== DASHBOARD OVERVIEW ==========

router.get("/overview", async function(req, res) {
  var orgId = req.orgId;
  var user = req.user;
  var days = parseInt(req.query.days) || 30;
  var since = new Date();
  since.setDate(since.getDate() - days);

  try {
    // Total cards ativos
    var activeQ = supabase.from("cards").select("id", { count: "exact", head: true })
      .eq("org_id", orgId).eq("status", "active");
    activeQ = applyRoleFilter(activeQ, user);
    var { count: activeCount } = await activeQ;

    // Concluidos no periodo
    var completedQ = supabase.from("cards").select("id", { count: "exact", head: true })
      .eq("org_id", orgId).eq("status", "completed").gte("completed_at", since.toISOString());
    completedQ = applyRoleFilter(completedQ, user);
    var { count: completedCount } = await completedQ;

    // Criados no periodo
    var createdQ = supabase.from("cards").select("id", { count: "exact", head: true })
      .eq("org_id", orgId).gte("created_at", since.toISOString());
    createdQ = applyRoleFilter(createdQ, user);
    var { count: createdCount } = await createdQ;

    // Tempo medio de conclusao (horas)
    var avgQ = supabase.from("cards").select("time_to_complete_hours")
      .eq("org_id", orgId).eq("status", "completed").not("time_to_complete_hours", "is", null)
      .gte("completed_at", since.toISOString());
    avgQ = applyRoleFilter(avgQ, user);
    var { data: avgData } = await avgQ;

    var avgHours = 0;
    if (avgData && avgData.length > 0) {
      var sum = avgData.reduce(function(s, c) { return s + (c.time_to_complete_hours || 0); }, 0);
      avgHours = Math.round((sum / avgData.length) * 10) / 10;
    }

    res.json({
      activeCards: activeCount || 0,
      completedCards: completedCount || 0,
      createdCards: createdCount || 0,
      avgCompletionHours: avgHours,
      period: days,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== POR CLIENTE ==========

router.get("/by-client", async function(req, res) {
  var orgId = req.orgId;
  var user = req.user;
  var days = parseInt(req.query.days) || 30;
  var since = new Date();
  since.setDate(since.getDate() - days);

  try {
    var q = supabase.from("cards")
      .select("client, status, time_to_complete_hours, created_at, completed_at")
      .eq("org_id", orgId).gte("created_at", since.toISOString());
    q = applyRoleFilter(q, user);
    var { data: cards } = await q;

    var byClient = {};
    (cards || []).forEach(function(c) {
      var cl = c.client || "N/A";
      if (!byClient[cl]) byClient[cl] = { client: cl, total: 0, completed: 0, active: 0, avgHours: 0, totalHours: 0 };
      byClient[cl].total++;
      if (c.status === "completed") { byClient[cl].completed++; byClient[cl].totalHours += (c.time_to_complete_hours || 0); }
      else byClient[cl].active++;
    });

    var result = Object.values(byClient).map(function(c) {
      c.avgHours = c.completed > 0 ? Math.round((c.totalHours / c.completed) * 10) / 10 : 0;
      c.completionRate = c.total > 0 ? Math.round((c.completed / c.total) * 100) : 0;
      delete c.totalHours;
      return c;
    }).sort(function(a, b) { return b.total - a.total; });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== POR CATEGORIA ==========

router.get("/by-category", async function(req, res) {
  var orgId = req.orgId;
  var user = req.user;
  var days = parseInt(req.query.days) || 30;
  var since = new Date();
  since.setDate(since.getDate() - days);

  try {
    var q = supabase.from("cards")
      .select("category, subcategory, status, time_to_complete_hours")
      .eq("org_id", orgId).gte("created_at", since.toISOString());
    q = applyRoleFilter(q, user);
    var { data: cards } = await q;

    var byCat = {};
    (cards || []).forEach(function(c) {
      var cat = c.category || "sem_categoria";
      if (!byCat[cat]) byCat[cat] = { category: cat, total: 0, completed: 0, avgHours: 0, totalHours: 0, subcategories: {} };
      byCat[cat].total++;
      if (c.status === "completed") { byCat[cat].completed++; byCat[cat].totalHours += (c.time_to_complete_hours || 0); }

      var sub = c.subcategory || "geral";
      if (!byCat[cat].subcategories[sub]) byCat[cat].subcategories[sub] = { count: 0, completed: 0 };
      byCat[cat].subcategories[sub].count++;
      if (c.status === "completed") byCat[cat].subcategories[sub].completed++;
    });

    var result = Object.values(byCat).map(function(c) {
      c.avgHours = c.completed > 0 ? Math.round((c.totalHours / c.completed) * 10) / 10 : 0;
      delete c.totalHours;
      return c;
    }).sort(function(a, b) { return b.total - a.total; });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== POR PESSOA ==========

router.get("/by-person", async function(req, res) {
  var orgId = req.orgId;
  var user = req.user;
  var days = parseInt(req.query.days) || 30;
  var since = new Date();
  since.setDate(since.getDate() - days);

  // Operacao so ve a si mesmo
  if (user.role === "operacao") {
    var q = supabase.from("cards")
      .select("status, time_to_complete_hours, category")
      .eq("org_id", orgId).contains("assigned_to", [user.trello_member_id || ""])
      .gte("created_at", since.toISOString());
    var { data: myCards } = await q;

    var completed = (myCards || []).filter(function(c) { return c.status === "completed"; });
    var totalHours = completed.reduce(function(s, c) { return s + (c.time_to_complete_hours || 0); }, 0);

    return res.json([{
      name: user.name,
      total: (myCards || []).length,
      completed: completed.length,
      active: (myCards || []).length - completed.length,
      avgHours: completed.length > 0 ? Math.round((totalHours / completed.length) * 10) / 10 : 0,
    }]);
  }

  try {
    var q2 = supabase.from("cards")
      .select("assigned_names, assigned_to, status, time_to_complete_hours")
      .eq("org_id", orgId).gte("created_at", since.toISOString());
    q2 = applyRoleFilter(q2, user);
    var { data: cards } = await q2;

    var byPerson = {};
    (cards || []).forEach(function(c) {
      var names = c.assigned_names || [];
      if (names.length === 0) names = ["Nao atribuido"];
      names.forEach(function(name) {
        if (!byPerson[name]) byPerson[name] = { name: name, total: 0, completed: 0, active: 0, totalHours: 0 };
        byPerson[name].total++;
        if (c.status === "completed") { byPerson[name].completed++; byPerson[name].totalHours += (c.time_to_complete_hours || 0); }
        else byPerson[name].active++;
      });
    });

    var result = Object.values(byPerson).map(function(p) {
      p.avgHours = p.completed > 0 ? Math.round((p.totalHours / p.completed) * 10) / 10 : 0;
      delete p.totalHours;
      return p;
    }).sort(function(a, b) { return b.total - a.total; });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== TIMELINE (criados vs concluidos por semana) ==========

router.get("/timeline", async function(req, res) {
  var orgId = req.orgId;
  var user = req.user;
  var days = parseInt(req.query.days) || 90;
  var since = new Date();
  since.setDate(since.getDate() - days);

  try {
    var q = supabase.from("cards")
      .select("created_at, completed_at, status")
      .eq("org_id", orgId).gte("created_at", since.toISOString());
    q = applyRoleFilter(q, user);
    var { data: cards } = await q;

    // Agrupar por semana
    var weeks = {};
    (cards || []).forEach(function(c) {
      var createdWeek = getWeekKey(new Date(c.created_at));
      if (!weeks[createdWeek]) weeks[createdWeek] = { week: createdWeek, created: 0, completed: 0 };
      weeks[createdWeek].created++;

      if (c.completed_at) {
        var completedWeek = getWeekKey(new Date(c.completed_at));
        if (!weeks[completedWeek]) weeks[completedWeek] = { week: completedWeek, created: 0, completed: 0 };
        weeks[completedWeek].completed++;
      }
    });

    var result = Object.values(weeks).sort(function(a, b) { return a.week.localeCompare(b.week); });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== CARDS RECENTES ==========

router.get("/recent-cards", async function(req, res) {
  var orgId = req.orgId;
  var user = req.user;
  var limit = parseInt(req.query.limit) || 20;
  var status = req.query.status || null;

  try {
    var q = supabase.from("cards")
      .select("id, title, client, category, subcategory, list_name, status, assigned_names, created_at, completed_at, time_to_complete_hours, board_name")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) q = q.eq("status", status);
    q = applyRoleFilter(q, user);
    var { data: cards } = await q;

    res.json(cards || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getWeekKey(date) {
  var d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}

module.exports = router;
