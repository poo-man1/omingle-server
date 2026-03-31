require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

// ✅ node-fetch for keep-alive ping (run: npm install node-fetch)
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app = express();

// ✅ Health check — required for Render
app.get("/", (req, res) => {
  res.send("Omingle signaling server running");
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["https://omingle.netlify.app","*"],
    methods: ["GET", "POST"]
  },
  transports: ["polling", "websocket"], // ✅ polling first — survives Render cold start
  pingTimeout: 30000,
  pingInterval: 10000
});

// ✅ Keep Render free tier alive — pings itself every 14 minutes
const SELF_URL = process.env.SELF_URL || "https://gaaji-server.onrender.com";
setInterval(() => {
  fetch(SELF_URL)
    .then(() => console.log("✅ Keep-alive ping sent"))
    .catch(err => console.log("⚠️ Ping failed:", err.message));
}, 14 * 60 * 1000);

let waitingUser = null;
const reportCounts = {};

function broadcastOnline() {
  const online = io.sockets.sockets.size;
  io.emit("onlineCount", online);
  console.log("Online users:", online);
}

app.get("/api/online-count", (req, res) => {
  res.json({ online: io.sockets.sockets.size });
});

// ✅ Match or queue a socket
function matchUser(socket) {
  if (waitingUser && waitingUser.id !== socket.id && waitingUser.connected) {
    socket.partner = waitingUser;
    waitingUser.partner = socket;

    socket.emit("matched", { initiator: true });
    waitingUser.emit("matched", { initiator: false });

    console.log(`Matched: ${socket.id} <-> ${waitingUser.id}`);
    waitingUser = null;
  } else {
    waitingUser = socket;
    socket.emit("waiting");
    console.log(`Waiting: ${socket.id}`);
  }
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  broadcastOnline();
  matchUser(socket);

  // ✅ WebRTC signaling relay
  socket.on("signal", (data) => {
    if (socket.partner && socket.partner.connected) {
      socket.partner.emit("signal", data);
    }
  });

  // ✅ Chat relay with safety limit
  socket.on("chat", (msg) => {
    if (typeof msg !== "string" || msg.length > 500) return;
    if (socket.partner && socket.partner.connected) {
      socket.partner.emit("chat", msg);
    }
  });

  // ✅ Next — skip to new stranger, no page reload
  socket.on("next", () => {
    if (socket.partner) {
      socket.partner.emit("peer-disconnected");
      const oldPartner = socket.partner;
      socket.partner = null;
      oldPartner.partner = null;
      matchUser(oldPartner); // re-queue old partner
    }
    matchUser(socket);
  });

  // ✅ Report — auto-ban after 3 reports
  socket.on("report", () => {
    const partnerId = socket.partner?.id;
    if (!partnerId) return;
    reportCounts[partnerId] = (reportCounts[partnerId] || 0) + 1;
    console.log(`User ${partnerId} reported. Total: ${reportCounts[partnerId]}`);
    if (reportCounts[partnerId] >= 3) {
      socket.partner?.emit("banned");
      socket.partner?.disconnect();
      delete reportCounts[partnerId];
    } else {
      socket.partner?.emit("reported");
    }
  });

  // ✅ Disconnect — clean up and re-queue partner
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    if (waitingUser === socket) waitingUser = null;
    if (socket.partner) {
      socket.partner.emit("peer-disconnected");
      const oldPartner = socket.partner;
      socket.partner = null;
      oldPartner.partner = null;
      matchUser(oldPartner);
    }
    delete reportCounts[socket.id];
    broadcastOnline();
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`✅ Omingle signaling server running on port ${PORT}`);
});
