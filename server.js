require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();

// Health check (VERY IMPORTANT for Render)
app.get("/", (req, res) => {
  res.send("Gaaji signaling server running");
});

// (Optional) Polling endpoint as fallback for clients without WS
app.get("/api/online-count", (req, res) => {
  const online = io.sockets.sockets.size;
  res.json({ online });
});

// Create HTTP server ONCE
const server = http.createServer(app);

// Attach Socket.io ONCE (this is the fix)
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ["websocket"] // disable polling safely
});

let waitingUser = null;

// --- helper to broadcast current online users ---
function broadcastOnline() {
  const online = io.sockets.sockets.size; // Socket.IO v4
  io.emit("onlineCount", online);
}

io.on("connection", socket => {
  console.log("User connected:", socket.id);

  // broadcast on connect
  broadcastOnline();

  if (waitingUser) {
    socket.partner = waitingUser;
    waitingUser.partner = socket;

    socket.emit("matched", { initiator: true });
    waitingUser.emit("matched", { initiator: false });

    waitingUser = null;
  } else {
    waitingUser = socket;
  }

  socket.on("signal", data => {
    socket.partner?.emit("signal", data);
  });

  socket.on("disconnect", () => {
    if (waitingUser === socket) waitingUser = null;
    socket.partner?.emit("peer-disconnected");

    // broadcast on disconnect
    broadcastOnline();
  });
});

// ✅ THIS MUST BE LAST
server.listen(process.env.PORT, () => {
  console.log("✅ Gaaji signaling server running");
});
