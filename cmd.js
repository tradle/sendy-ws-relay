#!/usr/bin/env node

const Relay = require('./')
const port = Number(process.argv[2]) || 42824
const relay = new Relay({ port })
console.log('running on port ' + port)
