var express = require("express");
var { supabase } = require("../supabase");
var { PRIORITY_DISPLAY } = require("../label-parser");
var router = express.Router();

function applyRoleFilter(query, user) {
  if (user.role === "gestao") return query;
  if (user.role === "cs") {
    if (user.clients && user.clients.length > 0) return query.in("client", user.clients);
    return query.eq("client", "__none__");
  }
  if (user.role === "operacao") return query.eq("responsible", user.name);
  return query;
}

function applyExtraFilters(query, req) {
  if (req.query.client && req.query.client !== "all") query = query.eq("client", req.query.client);
  if (req.query.person && req.query.person !== "all") query = query.eq("responsible", req.query.person);
  if (req.query.complexity && req.query.complexity !== "all") {
    var parts = req.query.complexity.split("-");
    if (parts.length === 2) {
      query = query.gte("complexity", parseInt(parts[0])).lte("complexity", parseInt(parts[1]));
    }
  }
  return query;
}

router.get("/filters", async function(req, res) {
  var orgId = req.orgId, user = req.user;
  try {
    var q = supabase.from("cards").select("client, responsible").eq("org_id", orgId);
    q = applyRoleFilter(q, user);
    var { data: cards } = await q;
    var cs = {}, ps = {};
    (cards || []).forEach(function(c) {
      if (c.client) cs[c.client] = true;
      if (c.responsible) ps[c.responsible] = true;
    });
    res.json({ clients: Object.keys(cs).sort(), people: Object.keys(ps).sort() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/overview", async function(req, res) {
  var orgId = req.orgId, user = req.user, days = parseInt(req.query.days) || 30;
  var since = new Date(); since.setDate(since.getDate() - days);
  try {
    var aq = supabase.from("cards").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "active");
    aq = applyExtraFilters(applyRoleFilter(aq, user), req);
    var { count: activeCount } = await aq;

    var cq = supabase.from("cards").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "completed").gte("completed_at", since.toISOString());
    cq = applyExtraFilters(applyRoleFilter(cq, user), req);
    var { count: completedCount } = await cq;

    var crq = supabase.from("cards").select("id", { count: "exact", head: true }).eq("org_id", orgId).gte("created_at", since.toISOString());
    crq = applyExtraFilters(applyRoleFilter(crq, user), req);
    var { count: createdCount } = await crq;

    var avq = supabase.from("cards").select("time_to_complete_hours").eq("org_id", orgId).eq("status", "completed").not("time_to_complete_hours", "is", null).gte("completed_at", since.toISOString());
    avq = applyExtraFilters(applyRoleFilter(avq, user), req);
    var { data: avgData } = await avq;
    var avgHours = 0;
    if (avgData && avgData.length > 0) { var sum = avgData.reduce(function(s, c) { return s + (c.time_to_complete_hours || 0); }, 0); avgHours = Math.round((sum / avgData.length) * 10) / 10; }

    var tq = supabase.from("cards").select("id", { count: "exact", head: true }).eq("org_id", orgId);
    tq = applyExtraFilters(applyRoleFilter(tq, user), req);
    var { count: totalCount } = await tq;

    var oq = supabase.from("cards").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "active").lt("due_date", new Date().toISOString()).not("due_date", "is", null);
    oq = applyExtraFilters(applyRoleFilter(oq, user), req);
    var { count: overdueCount } = await oq;

    var acq = supabase.from("cards").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "completed");
    acq = applyExtraFilters(applyRoleFilter(acq, user), req);
    var { count: allCompletedCount } = await acq;

    var rate = (totalCount || 0) > 0 ? Math.round(((allCompletedCount || 0) / (totalCount || 1)) * 100) : 0;

    res.json({ totalCards: totalCount || 0, activeCards: activeCount || 0, completedCards: completedCount || 0,
      createdCards: createdCount || 0, overdueCards: overdueCount || 0, completionRate: rate, avgCompletionHours: avgHours, period: days });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/by-client", async function(req, res) {
  var orgId = req.orgId, user = req.user, days = parseInt(req.query.days) || 30;
  var since = new Date(); since.setDate(since.getDate() - days);
  try {
    var q = supabase.from("cards").select("client, status, time_to_complete_hours").eq("org_id", orgId).gte("created_at", since.toISOString());
    q = applyExtraFilters(applyRoleFilter(q, user), req);
    var { data: cards } = await q;
    var m = {};
    (cards || []).forEach(function(c) { var k = c.client || "N/A"; if (!m[k]) m[k] = { client: k, total: 0, completed: 0, active: 0, th: 0 }; m[k].total++;
      if (c.status === "completed") { m[k].completed++; m[k].th += (c.time_to_complete_hours || 0); } else m[k].active++; });
    res.json(Object.values(m).map(function(c) { c.avgHours = c.completed > 0 ? Math.round((c.th / c.completed) * 10) / 10 : 0; c.completionRate = c.total > 0 ? Math.round((c.completed / c.total) * 100) : 0; delete c.th; return c; }).sort(function(a, b) { return b.total - a.total; }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/by-category", async function(req, res) {
  var orgId = req.orgId, user = req.user, days = parseInt(req.query.days) || 30;
  var since = new Date(); since.setDate(since.getDate() - days);
  try {
    var q = supabase.from("cards").select("category, status, time_to_complete_hours").eq("org_id", orgId).gte("created_at", since.toISOString());
    q = applyExtraFilters(applyRoleFilter(q, user), req);
    var { data: cards } = await q;
    var m = {};
    (cards || []).forEach(function(c) { var k = c.category || "sem_categoria"; if (!m[k]) m[k] = { category: k, total: 0, completed: 0, th: 0 }; m[k].total++;
      if (c.status === "completed") { m[k].completed++; m[k].th += (c.time_to_complete_hours || 0); } });
    res.json(Object.values(m).map(function(c) { c.avgHours = c.completed > 0 ? Math.round((c.th / c.completed) * 10) / 10 : 0; delete c.th; return c; }).sort(function(a, b) { return b.total - a.total; }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/by-priority", async function(req, res) {
  var orgId = req.orgId, user = req.user, days = parseInt(req.query.days) || 30;
  var since = new Date(); since.setDate(since.getDate() - days);
  try {
    var q = supabase.from("cards").select("priority, status").eq("org_id", orgId).gte("created_at", since.toISOString());
    q = applyExtraFilters(applyRoleFilter(q, user), req);
    var { data: cards } = await q;
    var total = (cards || []).length;
    var m = {};
    (cards || []).forEach(function(c) {
      var k = c.priority || "neutra";
      if (!m[k]) m[k] = { priority: k, label: PRIORITY_DISPLAY[k] || k, total: 0, completed: 0, active: 0, pct: 0 };
      m[k].total++;
      if (c.status === "completed") m[k].completed++; else m[k].active++;
    });
    var result = Object.values(m).map(function(p) { p.pct = total > 0 ? Math.round((p.total / total) * 100) : 0; return p; });
    var order = ['altissima', 'alta', 'media', 'baixa', 'neutra'];
    result.sort(function(a, b) { return order.indexOf(a.priority) - order.indexOf(b.priority); });
    res.json({ total: total, priorities: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/by-person", async function(req, res) {
  var orgId = req.orgId, user = req.user, days = parseInt(req.query.days) || 30;
  var since = new Date(); since.setDate(since.getDate() - days);
  try {
    var q = supabase.from("cards").select("responsible, status, time_to_complete_hours").eq("org_id", orgId).gte("created_at", since.toISOString());
    q = applyExtraFilters(applyRoleFilter(q, user), req);
    var { data: cards } = await q;
    var m = {};
    (cards || []).forEach(function(c) {
      var k = c.responsible || "Nao atribuido";
      if (!m[k]) m[k] = { name: k, total: 0, completed: 0, active: 0, th: 0 };
      m[k].total++;
      if (c.status === "completed") { m[k].completed++; m[k].th += (c.time_to_complete_hours || 0); } else m[k].active++;
    });
    res.json(Object.values(m).map(function(p) { p.avgHours = p.completed > 0 ? Math.round((p.th / p.completed) * 10) / 10 : 0; delete p.th; return p; }).sort(function(a, b) { return b.total - a.total; }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/timeline", async function(req, res) {
  var orgId = req.orgId, user = req.user, days = parseInt(req.query.days) || 90;
  var since = new Date(); since.setDate(since.getDate() - days);
  try {
    var q = supabase.from("cards").select("created_at, completed_at, status").eq("org_id", orgId).gte("created_at", since.toISOString());
    q = applyExtraFilters(applyRoleFilter(q, user), req);
    var { data: cards } = await q;
    var weeks = {};
    (cards || []).forEach(function(c) { var cw = wk(new Date(c.created_at)); if (!weeks[cw]) weeks[cw] = { week: cw, created: 0, completed: 0 }; weeks[cw].created++;
      if (c.completed_at) { var dw = wk(new Date(c.completed_at)); if (!weeks[dw]) weeks[dw] = { week: dw, created: 0, completed: 0 }; weeks[dw].completed++; } });
    res.json(Object.values(weeks).sort(function(a, b) { return a.week.localeCompare(b.week); }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/recent-cards", async function(req, res) {
  var orgId = req.orgId, user = req.user, limit = parseInt(req.query.limit) || 20;
  try {
    var q = supabase.from("cards")
      .select("id, title, client, category, priority, responsible, complexity, list_name, status, created_at, completed_at, time_to_complete_hours, due_date, trello_card_id")
      .eq("org_id", orgId).order("created_at", { ascending: false }).limit(limit);
    if (req.query.status) q = q.eq("status", req.query.status);
    q = applyExtraFilters(applyRoleFilter(q, user), req);
    var { data } = await q;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/all-cards", async function(req, res) {
  var orgId = req.orgId, user = req.user;
  var page = parseInt(req.query.page) || 1;
  var perPage = parseInt(req.query.per_page) || 10;
  var offset = (page - 1) * perPage;
  try {
    var countQ = supabase.from("cards").select("id", { count: "exact", head: true }).eq("org_id", orgId);
    countQ = applyExtraFilters(applyRoleFilter(countQ, user), req);
    var { count: total } = await countQ;
    var sortField = req.query.sort || "created_at";
    var sortDir = req.query.dir === "asc" ? true : false;
    var validSorts = ["created_at", "complexity", "priority", "title", "client"];
    if (validSorts.indexOf(sortField) < 0) sortField = "created_at";

    var q = supabase.from("cards")
      .select("id, title, client, category, priority, responsible, complexity, list_name, status, created_at, completed_at, time_to_complete_hours, due_date, trello_card_id")
      .eq("org_id", orgId).order(sortField, { ascending: sortDir }).range(offset, offset + perPage - 1);
    q = applyExtraFilters(applyRoleFilter(q, user), req);
    var { data } = await q;
    res.json({ cards: data || [], total: total || 0, page: page, perPage: perPage, totalPages: Math.ceil((total || 0) / perPage) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function wk(d) { var x = new Date(d); x.setDate(x.getDate() - x.getDay()); return x.toISOString().slice(0, 10); }

module.exports = router;
