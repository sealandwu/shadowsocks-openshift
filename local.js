(function() {
  var Encryptor, HTTPPROXY, HttpsProxyAgent, KEY, LOCAL_ADDRESS, METHOD, PORT, REMOTE_PORT, SCHEME, SERVER, WebSocket, config, configContent, configFromArgs, fs, getServer, http, inetNtoa, k, net, options, parseArgs, path, prepareServer, ref, s, server, timeout, url, v;
  net = require('net');
  url = require('url');
  http = require('http');
  fs = require('fs');
  path = require('path');
  WebSocket = require('ws');
  parseArgs = require('minimist');
  HttpsProxyAgent = require('https-proxy-agent');
  Encryptor = require('./encrypt').Encryptor;
  options = {
    alias: {
      'b': 'local_address',
      'l': 'local_port',
      's': 'server',
      'r': 'remote_port',
      'k': 'password',
      'c': 'config_file',
      'm': 'method'
    },
    string: ['local_address', 'server', 'password', 'config_file', 'method', 'scheme'],
    "default": {
      'config_file': path.resolve(__dirname, "config.json")
    }
  };
  inetNtoa = function(buf) {
    return buf[0] + '.' + buf[1] + '.' + buf[2] + '.' + buf[3];
  };
  configFromArgs = parseArgs(process.argv.slice(2), options);
  configContent = fs.readFileSync(configFromArgs.config_file);
  config = JSON.parse(configContent);
  for (k in configFromArgs) {
    v = configFromArgs[k];
    config[k] = v;
  }
  SCHEME = config.scheme;
  SERVER = config.server;
  REMOTE_PORT = config.remote_port;
  LOCAL_ADDRESS = config.local_address;
  PORT = config.local_port;
  KEY = config.password;
  METHOD = config.method;
  timeout = Math.floor(config.timeout * 1000);
  if ((ref = METHOD.toLowerCase()) === '' || ref === 'null' || ref === 'table') {
    METHOD = null;
  }
  HTTPPROXY = process.env.http_proxy;
  // if (HTTPPROXY) {
  //   console.log('http proxy:', HTTPPROXY);
  // }
  prepareServer = function(address) {
    var serverUrl;
    serverUrl = url.parse(address);
    serverUrl.slashes = true;
    if (serverUrl.protocol == null) {
      serverUrl.protocol = SCHEME;
    }
    if (serverUrl.hostname === null) {
      serverUrl.hostname = address;
      serverUrl.pathname = '/';
    }
    if (serverUrl.port == null) {
      serverUrl.port = REMOTE_PORT;
    }
    return url.format(serverUrl);
  };
  if (SERVER instanceof Array) {
    SERVER = (function() {
      var j, len, results;
      results = [];
      for (j = 0, len = SERVER.length; j < len; j++) {
        s = SERVER[j];
        results.push(prepareServer(s));
      }
      return results;
    })();
  } else {
    SERVER = prepareServer(SERVER);
  }
  getServer = function() {
    if (SERVER instanceof Array) {
      return SERVER[Math.floor(Math.random() * SERVER.length)];
    } else {
      return SERVER;
    }
  };
  server = net.createServer(function(connection) {
    var aServer, addrLen, addrToSend, cachedPieces, encryptor, headerLength, ping, remoteAddr, remotePort, stage, ws;
    // console.log('local connected');
    server.getConnections(function(err, count) {
      // if (err) {
      //   console.log('err:', err);
      // }
      // console.log('concurrent connections:', count);
    });
    encryptor = new Encryptor(KEY, METHOD);
    stage = 0;
    headerLength = 0;
    cachedPieces = [];
    addrLen = 0;
    ws = null;
    ping = null;
    remoteAddr = null;
    remotePort = null;
    addrToSend = '';
    aServer = getServer();
    connection.on('data', function(data) {
      var addrtype, agent, buf, cmd, e, endpoint, error, opts, parsed, ref1, reply, tempBuf;
      if (stage === 5) {
        data = encryptor.encrypt(data);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data, {
            binary: true
          });
          if (ws.bufferedAmount > 0) {
            connection.pause();
          }
        }
        return;
      }
      if (stage === 0) {
        tempBuf = new Buffer(2);
        tempBuf.write('\u0005\u0000', 0);
        connection.write(tempBuf);
        stage = 1;
        return;
      }
      if (stage === 1) {
        try {
          cmd = data[1];
          addrtype = data[3];
          if (cmd !== 1) {
            // console.log('unsupported cmd:', cmd);
            reply = new Buffer('\u0005\u0007\u0000\u0001', 'binary');
            connection.end(reply);
            return;
          }
          if (addrtype === 3) {
            addrLen = data[4];
          } else if (addrtype !== 1) {
            // console.log('unsupported addrtype:', addrtype);
            connection.end();
            return;
          }
          addrToSend = data.slice(3, 4).toString('binary');
          if (addrtype === 1) {
            remoteAddr = inetNtoa(data.slice(4, 8));
            addrToSend += data.slice(4, 10).toString('binary');
            remotePort = data.readUInt16BE(8);
            headerLength = 10;
          } else {
            remoteAddr = data.slice(5, 5 + addrLen).toString('binary');
            addrToSend += data.slice(4, 5 + addrLen + 2).toString('binary');
            remotePort = data.readUInt16BE(5 + addrLen);
            headerLength = 5 + addrLen + 2;
          }
          buf = new Buffer(10);
          buf.write('\u0005\u0000\u0000\u0001', 0, 4, 'binary');
          buf.write('\u0000\u0000\u0000\u0000', 4, 4, 'binary');
          buf.writeInt16BE(remotePort, 8);
          connection.write(buf);
          if (HTTPPROXY) {
            endpoint = aServer;
            parsed = url.parse(endpoint);
            opts = url.parse(HTTPPROXY);
            opts.secureEndpoint = (ref1 = parsed.protocol) != null ? ref1 : parsed.protocol === {
              'wss:': false
            };
            agent = new HttpsProxyAgent(opts);
            ws = new WebSocket(aServer, {
              protocol: 'binary',
              agent: agent
            });
          } else {
            ws = new WebSocket(aServer, {
              protocol: 'binary'
            });
          }
          ws.on('open', function() {
            var addrToSendBuf, i, piece;
            ws._socket.on('error', function(e) {
              // console.log('remote ' + remoteAddr + ':' + remotePort + ' ' + e);
              connection.destroy();
              return server.getConnections(function(err, count) {
                // console.log('concurrent connections:', count);
              });
            });
            // console.log('connecting ' + remoteAddr + ' via ' + aServer);
            addrToSendBuf = new Buffer(addrToSend, 'binary');
            addrToSendBuf = encryptor.encrypt(addrToSendBuf);
            ws.send(addrToSendBuf, {
              binary: true
            });
            i = 0;
            while (i < cachedPieces.length) {
              piece = cachedPieces[i];
              piece = encryptor.encrypt(piece);
              ws.send(piece, {
                binary: true
              });
              i++;
            }
            cachedPieces = null;
            stage = 5;
            ping = setInterval(function() {
              return ws.ping('', null, true);
            }, 50 * 1000);
            ws._socket.on('drain', function() {
              return connection.resume();
            });
          });
          ws.on('message', function(data, flags) {
            data = encryptor.decrypt(data);
            if (!connection.write(data)) {
              return ws._socket.pause();
            }
          });
          ws.on('close', function() {
            clearInterval(ping);
            // console.log('remote disconnected');
            return connection.destroy();
          });
          ws.on('error', function(e) {
            // console.log('remote ' + remoteAddr + ':' + remotePort + ' error: ' + e);
            connection.destroy();
            return server.getConnections(function(err, count) {
              // console.log('concurrent connections:', count);
            });
          });
          if (data.length > headerLength) {
            buf = new Buffer(data.length - headerLength);
            data.copy(buf, 0, headerLength);
            cachedPieces.push(buf);
            buf = null;
          }
          return stage = 4;
        } catch (error) {
          e = error;
          // console.log(e);
          return connection.destroy();
        }
      } else {
        if (stage === 4) {
          return cachedPieces.push(data);
        }
      }
    });
    connection.on('end', function() {
      // console.log('local disconnected');
      if (ws) {
        ws.terminate();
      }
      return server.getConnections(function(err, count) {
        // console.log('concurrent connections:', count);
      });
    });
    connection.on('error', function(e) {
      // console.log('local error: ' + e);
      if (ws) {
        ws.terminate();
      }
      return server.getConnections(function(err, count) {
        // console.log('concurrent connections:', count);
      });
    });
    connection.on('drain', function() {
      if (ws && ws._socket) {
        return ws._socket.resume();
      }
    });
    return connection.setTimeout(timeout, function() {
      // console.log('local timeout');
      connection.destroy();
      if (ws) {
        return ws.terminate();
      }
    });
  });
  server.listen(PORT, LOCAL_ADDRESS, function() {
    var address;
    address = server.address();
    return console.log('server listening at', address);
  });
  server.on('error', function(e) {
    if (e.code === 'EADDRINUSE') {
      console.log('address in use, aborting');
    }
    return process.exit(1);
  });
}).call(this);