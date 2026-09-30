'use strict';
const path = require('path');
function installApiGuard(app) {
    app.use('/main/api', (req, res, next) => {
        if (req.method === 'OPTIONS' || ['/login', '/register'].includes(req.path)) return next();
        if (!req.session?.user) return res.status(401).json({ error: 'Authentication required' });
        if (/^\/(debug|diagnostics)(\/|$)/.test(req.path) && req.session.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        next();
    });
}
function installPublicAssets(app, root) {
    // Never serve the repository root, which contains private sync/config code.
    for (const name of ['main.html', 'main.js', 'rbac-fix.js']) {
        app.get('/main/' + name, (req, res) => res.sendFile(path.join(root, name)));
    }
    app.use('/main/public', require('express').static(path.join(root, 'public'), { dotfiles: 'deny' }));
}
module.exports = { installApiGuard, installPublicAssets };
