require("dotenv").config();
var express = require("express");
var cors = require("cors");
var path = require("path");
var cron = require("node-cron");

var { authMiddleware } = require("./src/auth");
var metricsRoutes = require("./src/routes/metrics");
var adminRoutes = require("./src/routes/admin");
var { syncAll } = require("./src/trello-sync");

var app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// API com autenticacao
app.use("/api/metrics", authMiddleware, metricsRoutes);
app.use("/api/admin", authMiddleware, adminRoutes);

// Health check (sem auth)
app.get("/api/health", function(req, res) {
  res.json({ status: "ok", uptime: process.uptime() });
});

// SPA fallback
app.get("*", function(req, res) {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Sync Trello a cada 5 minutos
cron.schedule("*/5 * * * *", function() {
  console.log("[Cron] Sincronizando Trello...");
  syncAll().catch(function(e) { console.error("[Cron] Erro:", e); });
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log("[Server] WBP Productivity na porta " + PORT);
  // Sync inicial
  setTimeout(function() {
    syncAll().catch(function(e) { console.error("[Sync inicial]", e); });
  }, 5000);
});
