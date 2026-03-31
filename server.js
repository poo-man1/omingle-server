require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();

// ✅ Health check
app.get("/", (req, res) => {
  res.send("Omingle signaling server running");
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ["websocket"]
});

let waitingUser = null;

// ================================
// 🔁 ONLINE COUNT
// ================================
function broadcastOnline() {
  const online = io.sockets.sockets.size;
  io.emit("onlineCount", online);
  console.log("Online users:", online);
}

// ================================
// 🔌 SOCKET CONNECTION
// ================================
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  broadcastOnline();

  socket.partner = null;

  // ================================
  // 🎯 MATCHING LOGIC (FIXED)
  // ================================
  if (waitingUser && waitingUser !== socket) {
    // Pair both users
    socket.partner = waitingUser;
    waitingUser.partner = socket;

    socket.emit("matched", { initiator: true });
    waitingUser.emit("matched", { initiator: false });

    waitingUser = null;
  } else {
    waitingUser = socket;
  }

  // ================================
  // 🔁 SIGNAL RELAY
  // ================================
  socket.on("signal", (data) => {
    if (socket.partner) {
      socket.partner.emit("signal", data);
    }
  });

  // ================================
  // 🔄 NEXT / RESET SUPPORT
  // ================================
  socket.on("next", () => {
    if (socket.partner) {
      socket.partner.emit("peer-disconnected");
      socket.partner.partner = null;
    }

    socket.partner = null;

    if (waitingUser === socket) {
      waitingUser = null;
    }

    // Put user back in queue
    if (waitingUser) {
      socket.partner = waitingUser;
      waitingUser.partner = socket;

      socket.emit("matched", { initiator: true });
      waitingUser.emit("matched", { initiator: false });

      waitingUser = null;
    } else {
      waitingUser = socket;
    }
  });

  // ================================
  // ❌ DISCONNECT HANDLING (FIXED)
  // ================================
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    if (waitingUser === socket) {
      waitingUser = null;
    }

    if (socket.partner) {
      socket.partner.emit("peer-disconnected");
      socket.partner.partner = null;
    }

    broadcastOnline();
  });
});

// ================================
// 🚀 START SERVER
// ================================
const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
  console.log(`✅ Omingle signaling server running on port ${PORT}`);
});
