'use strict';
const crypto = require('crypto');

function requireAdmin(req, res, next) {
  if (req.session?.adminEmail) {
    res.locals.adminEmail = req.session.adminEmail;
    return next();
  }
  return res.redirect('/admin/login');
}

/** Proteção CSRF simples baseada em token de sessão (formulários do painel). */
function csrf(req, res, next) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString('base64url');
  res.locals.csrfToken = req.session.csrfToken;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const sent = req.body?._csrf || req.get('x-csrf-token') || '';
    const a = Buffer.from(String(sent));
    const b = Buffer.from(req.session.csrfToken);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(403).render('error', { title: 'Sessão expirada', message: 'Recarregue a página e tente novamente.' });
    }
  }
  return next();
}

module.exports = { requireAdmin, csrf };
