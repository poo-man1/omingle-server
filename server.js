require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const fetch = (...args) =>
  import("node-fetch").then(({ default: f }) => f(...args));

const app = express();

app.get("/", (req, res) => res.send("Omingle signaling server running ✅"));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: [
      "https://omingle.netlify.app",
      "https://gomingle.xyz",
      "https://www.gomingle.xyz"
    ],
    methods: ["GET", "POST"]
  },
  transports: ["polling", "websocket"],
  pingTimeout: 30000,
  pingInterval: 10000
});

// ✅ Keep Render alive
const SELF_URL = process.env.SELF_URL || "https://gaaji-server.onrender.com";
setInterval(() => {
  fetch(SELF_URL).catch(e => console.log("Ping failed:", e.message));
}, 14 * 60 * 1000);

let waitingUser = null;
const reportCounts = {};

function broadcastOnline() {
  io.emit("onlineCount", io.sockets.sockets.size);
}

app.get("/api/online-count", (req, res) => {
  res.json({ online: io.sockets.sockets.size });
});

function matchUser(socket) {
  // ✅ GUARD: already has a partner, don't match again
  if (socket.partner) {
    console.log("Skip match — already has partner:", socket.id);
    return;
  }

  // ✅ GUARD: already waiting, don't add twice
  if (waitingUser === socket) {
    console.log("Skip match — already waiting:", socket.id);
    return;
  }

  if (waitingUser && waitingUser.connected && !waitingUser.partner) {
    // Pair them
    socket.partner = waitingUser;
    waitingUser.partner = socket;

    socket.emit("matched", { initiator: true });
    waitingUser.emit("matched", { initiator: false });

    console.log(`✅ Matched: ${socket.id} <-> ${waitingUser.id}`);
    waitingUser = null;
  } else {
    // Wait for next person
    waitingUser = socket;
    socket.emit("waiting");
    console.log(`⏳ Waiting: ${socket.id}`);
  }
}

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);
  broadcastOnline();

  // ✅ Small delay to prevent race on reconnect
  setTimeout(() => matchUser(socket), 300);

  socket.on("signal", (data) => {
    if (socket.partner && socket.partner.connected) {
      socket.partner.emit("signal", data);
    }
  });

  socket.on("chat", (msg) => {
    if (typeof msg !== "string" || msg.length > 500) return;
    socket.partner?.emit("chat", msg);
  });

  socket.on("next", () => {
    // ✅ Clear partner on both sides before re-matching
    if (socket.partner) {
      const old = socket.partner;
      old.partner = null;
      old.emit("peer-disconnected");
      // Re-queue old partner after short delay
      setTimeout(() => matchUser(old), 300);
    }
    socket.partner = null;
    setTimeout(() => matchUser(socket), 300);
  });

  socket.on("report", () => {
    const partner = socket.partner;
    if (!partner) return;
    reportCounts[partner.id] = (reportCounts[partner.id] || 0) + 1;
    if (reportCounts[partner.id] >= 3) {
      partner.emit("banned");
      partner.disconnect();
      delete reportCounts[partner.id];
    } else {
      partner.emit("reported");
    }
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);

    // ✅ Clear from waiting queue
    if (waitingUser === socket) waitingUser = null;

    // ✅ Notify partner and re-queue them
    if (socket.partner) {
      const old = socket.partner;
      old.partner = null;
      old.emit("peer-disconnected");
      setTimeout(() => matchUser(old), 500);
    }

    delete reportCounts[socket.id];
    broadcastOnline();
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`✅ Omingle server running on port ${PORT}`);
});
