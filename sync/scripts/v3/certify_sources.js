#!/usr/bin/env node
'use strict';
// Compatibility entry point. v3.2.3 manifest certification must always use
// the normalization-aware certifier, even when an operator invokes the old name.
require('./certify_sources_v323');
