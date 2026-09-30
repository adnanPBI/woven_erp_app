'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const { installApiGuard, installPublicAssets } = require('../lib/http-boundaries');
test('public assets load while private source and unauthenticated APIs stay inaccessible', async () => {
    const app = express();
    app.use((req, res, next) => {
        if (req.headers['x-test-role']) req.session = { user: { role: req.headers['x-test-role'] } };
        next();
    });
    installApiGuard(app);
    installPublicAssets(app, path.resolve(__dirname, '..'));
    app.get('/main/api/example', (req, res) => res.json({ ok: true }));
    app.get('/main/api/debug/example', (req, res) => res.json({ ok: true }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        for (const url of ['/main/server.js', '/main/package.json', '/main/.env', '/main/sync/package.json', '/main/lib/http-boundaries.js']) {
            assert.equal((await fetch(base + url)).status, 404, url);
        }
        assert.equal((await fetch(base + '/main/main.js')).status, 200);
        assert.equal((await fetch(base + '/main/public/js/erp-async-search-dropdown.js')).status, 200);
        assert.equal((await fetch(base + '/main/api/example')).status, 401);
        assert.equal((await fetch(base + '/main/api/example', { headers: { 'x-test-role': 'user' } })).status, 200);
        assert.equal((await fetch(base + '/main/api/debug/example', { headers: { 'x-test-role': 'user' } })).status, 403);
        assert.equal((await fetch(base + '/main/api/debug/example', { headers: { 'x-test-role': 'admin' } })).status, 200);
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});
