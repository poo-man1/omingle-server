require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();

app.get("/", (req, res) => {
  res.send("Omingle signaling server running");
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket", "polling"] // ✅ added polling as fallback
});

let waitingUser = null;
const reportCounts = {}; // track reports per socket id

function broadcastOnline() {
  const online = io.sockets.sockets.size;
  io.emit("onlineCount", online);
}

app.get("/api/online-count", (req, res) => {
  res.json({ online: io.sockets.sockets.size });
});

function matchUser(socket) {
  if (waitingUser && waitingUser.id !== socket.id) {
    // Pair them
    socket.partner = waitingUser;
    waitingUser.partner = socket;

    socket.emit("matched", { initiator: true });
    waitingUser.emit("matched", { initiator: false });

    waitingUser = null;
  } else {
    waitingUser = socket;
    socket.emit("waiting"); // ✅ tell client they're in queue
  }
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  broadcastOnline();

  // ✅ Match on connect
  matchUser(socket);

  // ✅ WebRTC signaling — relay to partner
  socket.on("signal", (data) => {
    socket.partner?.emit("signal", data);
  });

  // ✅ Chat relay
  socket.on("chat", (msg) => {
    if (typeof msg !== "string" || msg.length > 500) return;
    socket.partner?.emit("chat", msg);
  });

  // ✅ Next — disconnect from current partner and re-queue
  socket.on("next", () => {
    if (socket.partner) {
      socket.partner.emit("peer-disconnected");
      socket.partner.partner = null;
      // Re-queue the old partner too
      matchUser(socket.partner);
    }
    socket.partner = null;
    matchUser(socket);
  });

  // ✅ Report handling
  socket.on("report", () => {
    const partnerId = socket.partner?.id;
    if (!partnerId) return;

    reportCounts[partnerId] = (reportCounts[partnerId] || 0) + 1;
    console.log(`User ${partnerId} reported. Count: ${reportCounts[partnerId]}`);

    if (reportCounts[partnerId] >= 3) {
      socket.partner?.emit("banned");
      socket.partner?.disconnect();
      delete reportCounts[partnerId];
    } else {
      socket.partner?.emit("reported");
    }
  });

  // ✅ Disconnect cleanup
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    if (waitingUser === socket) waitingUser = null;

    if (socket.partner) {
      socket.partner.emit("peer-disconnected");
      socket.partner.partner = null;
      // Re-queue partner so they don't get stuck
      matchUser(socket.partner);
    }

    delete reportCounts[socket.id];
    broadcastOnline();
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`✅ Omingle signaling server running on port ${PORT}`);
});
