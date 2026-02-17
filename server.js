require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();

// ✅ Health check (VERY IMPORTANT for Render)
app.get("/", (req, res) => {
  res.send("Omingle signaling server running");
});

// Create HTTP server
const server = http.createServer(app);

// Attach Socket.io
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ["websocket"] // WebSocket only
});

let waitingUser = null;

// --- helper to broadcast current online users ---
function broadcastOnline() {
  const online = io.sockets.sockets.size;
  io.emit("onlineCount", online);
}

// Optional API route
app.get("/api/online-count", (req, res) => {
  const online = io.sockets.sockets.size;
  res.json({ online });
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

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

  socket.on("signal", (data) => {
    socket.partner?.emit("signal", data);
  });

  socket.on("disconnect", () => {
    if (waitingUser === socket) waitingUser = null;
    socket.partner?.emit("peer-disconnected");

    broadcastOnline();
  });
});

// ✅ REQUIRED for Render (dynamic port)
const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
  console.log(`✅ Omingle signaling server running on port ${PORT}`);
});
