require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();

// Health check (VERY IMPORTANT for Render)
app.get("/", (req, res) => {
  res.send("Omingle signaling server running");
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

io.on("connection", socket => {
  console.log("User connected:", socket.id);

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
  });
});

// ✅ THIS MUST BE LAST
server.listen(process.env.PORT, () => {
  console.log("✅ Omingle signaling server running");
});

