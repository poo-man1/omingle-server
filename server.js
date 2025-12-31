// 1️⃣ Load environment variables (.env file)
require("dotenv").config();

// 2️⃣ Import required modules
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

// 3️⃣ Create Express app
const app = express();

// 4️⃣ Create HTTP server (IMPORTANT for Socket.io + WebRTC)
const server = http.createServer(app);

// 5️⃣ Initialize Socket.io with CORS enabled
const io = new Server(server, {
  cors: {
    origin: "*", // allow Netlify / any frontend
    methods: ["GET", "POST"]
  }
});

// 6️⃣ Store one waiting user for random matching
let waitingUser = null;

// 7️⃣ Temporary ban storage (socket.id → expiry time)
const bannedUsers = new Map();

// 8️⃣ Function to check ban status
function isBanned(socketId) {
  return bannedUsers.has(socketId) &&
         bannedUsers.get(socketId) > Date.now();
}

// 9️⃣ Cleanup function when user disconnects
function cleanup(socket) {
  if (socket.partner) {
    socket.partner.partner = null;
    socket.partner.emit("peer-disconnected");
  }
}

// 🔟 Handle socket connections
io.on("connection", socket => {

  console.log("User connected:", socket.id);

  // 🔒 Check if user is banned
  if (isBanned(socket.id)) {
    socket.emit("banned");
    socket.disconnect();
    return;
  }

  // 🔁 Random matching logic
  if (waitingUser) {
    socket.partner = waitingUser;
    waitingUser.partner = socket;

    // One initiator, one receiver
    socket.emit("matched", { initiator: true });
    waitingUser.emit("matched", { initiator: false });

    waitingUser = null;
  } else {
    waitingUser = socket;
    socket.emit("waiting");
  }

  // 🔄 WebRTC signaling (offer, answer, ICE)
  socket.on("signal", data => {
    if (socket.partner) {
      socket.partner.emit("signal", data);
    }
  });

  // 💬 Text chat relay
  socket.on("chat", msg => {
    if (!msg || msg.length > 300) return;
    socket.partner?.emit("chat", msg);
  });

  // 🚨 Report system
  socket.on("report", () => {
    if (socket.partner) {
      // Ban reported user for 10 minutes
      bannedUsers.set(
        socket.partner.id,
        Date.now() + 10 * 60 * 1000
      );

      socket.partner.emit("reported");
      socket.partner.disconnect();
    }
  });

  // ❌ Handle disconnect
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    if (waitingUser === socket) {
      waitingUser = null;
    }

    cleanup(socket);
  });
});

// 🚀 START SERVER (THIS IS THE LINE YOU ASKED ABOUT)
server.listen(process.env.PORT || 3000, () => {
  console.log("✅ Gaaji signaling server running");
});
