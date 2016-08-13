
var EventEmitter = require('events').EventEmitter
var util = require('util')
var debug = require('debug')('websocket-relay')
var protobuf = require('protocol-buffers')
var WSPacket = protobuf(require('sendy-protobufs').ws).Packet
var http = require('http')
var typeforce = require('typeforce')
var omit = require('object.omit')
var io = require('socket.io')

function Server (opts) {
  var self = this

  typeforce({
    port: '?Number',
    path: '?String',
    server: '?Object'
  }, opts)

  EventEmitter.call(this)

  this._queues = {}
  this._sockets = {}
  this._server = opts.server
  if (!this._server) {
    if (!opts.port) throw new Error('expected "server" or "port"')

    this._server = http.createServer(function (req, res) {
      res.writeHead(500)
      res.end('This is a websockets endpoint!')
    })

    this._server.listen(opts.port)
  }

  this._io = io(this._server, { path: opts.path || '/' })
  this._io.on('connection', function (socket) {
    self._onconnection(socket)
  })
}

util.inherits(Server, EventEmitter)
module.exports = Server

Server.prototype._onconnection = function (socket) {
  var self = this
  var query = socket.request._query
  var handle = query.from
  var pubKey = query.pubKey
  this._registerSocket(query, socket)

  socket.on('error', onerror)
  socket.once('disconnect', ondisconnect)
  socket.on('message', onmessage)

  function onerror (err) {
    debug('disconnecting, socket for client ' + handle + ' experienced an error', err)
    socket.disconnect()
  }

  function ondisconnect () {
    if (self._destroyed || !handle) return

    debug(handle + ' disconnected')
    try {
      delete self._sockets[handle][pubKey]
    } catch (err) {
    }

    handle = null
    self.emit('disconnect', handle)
    socket.removeListener('error', onerror)
    socket.removeListener('message', onmessage)
  }

  function onmessage (msg) {
    try {
      msg = WSPacket.decode(msg)
    } catch (err) {
      return socket.emit('error', { message: 'invalid message', data: msg })
    }

    if (!handle && msg.from) {
      handle = msg.from
    }

    self._registerSocket({
      from: handle,
      pubKey: msg.pubKey
    }, socket)

    debug('got message from ' + handle + ' to ' + msg.to + ' with length ' + msg.data.length)

    if (!msg.data) return

    var to = msg.to
    var toSockets = self._sockets[to]
    if (toSockets) {
      // just in case cleanup
      for (var pubKey in toSockets) {
        var s = toSockets[pubKey]
        if (!s.connected) {
          delete toSockets[pubKey]
        }
      }

      if (!Object.keys(toSockets).length) {
        delete self._sockets[to]
        toSockets = null
      }
    }

    if (!toSockets) {
      return socket.emit('404', to)
    }

    msg = WSPacket.encode({
      from: handle,
      to: to,
      data: msg.data
    })

    for (var pubKey in toSockets) {
      var s = toSockets[pubKey]
      s.emit('message', msg)
    }
  }
}

Server.prototype._registerSocket = function (query, socket) {
  const handle = query.from
  const pubKey = query.pubKey || ''
  const socketsByPubKey = this._sockets[handle] = this._sockets[handle] || {}

  if (socketsByPubKey[pubKey]) return

  for (var pk in socketsByPubKey) {
    if (socketsByPubKey[pk] === socket) return
  }

  debug('registered ' + handle)
  socketsByPubKey[pubKey] = socket
  this.emit('connect', handle)
}

Server.prototype.getConnectedClients = function () {
  return Object.keys(this._sockets)
}

Server.prototype.hasClient = function (handle) {
  return handle in this._sockets
}

Server.prototype.destroy = function (cb) {
  if (this._destroyed) return

  this._destroyed = true
  debug('destroying')

  for (var handle in this._sockets) {
    var socketsByPubKey = this._sockets[handle]
    for (var pubKey in socketsByPubKey) {
      socketsByPubKey[pubKey].disconnect()
    }
    // s.removeAllListeners()
  }

  delete this._sockets
  this._io.close()
  this._server.close()
  if (cb) process.nextTick(cb)
}
