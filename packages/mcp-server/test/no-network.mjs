// Loaded before the stdio entry point. Discovery must work without any network.
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";

function deny() {
  process.stderr.write("[metadata-contract] UNEXPECTED_NETWORK_REQUEST\n");
  throw new Error("Network access is forbidden during metadata discovery");
}

globalThis.fetch = deny;
http.request = http.get = deny;
https.request = https.get = deny;
net.connect = net.createConnection = deny;
net.Socket.prototype.connect = deny;
tls.connect = deny;
syncBuiltinESMExports();
