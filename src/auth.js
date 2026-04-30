var { supabase } = require("./supabase");

/**
 * Middleware: verifica token Supabase e carrega usuario com role
 */
async function authMiddleware(req, res, next) {
  var token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Token necessario" });

  try {
    // Verificar token com Supabase
    var { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) return res.status(401).json({ error: "Token invalido" });

    // Buscar usuario no banco com role
    var { data: user, error: userError } = await supabase
      .from("users")
      .select("*, organizations(id, name, slug)")
      .eq("auth_id", authData.user.id)
      .single();

    if (userError || !user) return res.status(403).json({ error: "Usuario nao encontrado no sistema" });
    if (!user.active) return res.status(403).json({ error: "Usuario desativado" });

    req.user = user;
    req.orgId = user.org_id;
    next();
  } catch (err) {
    res.status(500).json({ error: "Erro de autenticacao" });
  }
}

/**
 * Middleware: requer role minimo
 */
function requireRole() {
  var allowedRoles = Array.from(arguments);
  return function(req, res, next) {
    if (!req.user) return res.status(401).json({ error: "Nao autenticado" });
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Sem permissao. Role necessario: " + allowedRoles.join(" ou ") });
    }
    next();
  };
}

module.exports = { authMiddleware: authMiddleware, requireRole: requireRole };
