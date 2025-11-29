import { createServer } from "http";
import { Server } from "socket.io";

// Configuration
const PORT = parseInt(process.env.PORT || "10000", 10);
const HOST = "0.0.0.0";

console.log("=".repeat(60));
console.log("🚀 STARTING SOCKET.IO SERVER");
console.log("=".repeat(60));
console.log("Node:", process.version);
console.log("Platform:", process.platform);
console.log("CWD:", process.cwd());
console.log("ENV PORT:", process.env.PORT);
console.log("Using PORT:", PORT);
console.log("Using HOST:", HOST);
console.log("=".repeat(60));

// Allowed origins
const allowedOrigins = [
  "https://www.nexuswebsite.me",
  "https://nexuswebsite.me",
  "http://www.nexuswebsite.me",
  "http://nexuswebsite.me",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

console.log("Allowed Origins:");
allowedOrigins.forEach((origin) => console.log(`  - ${origin}`));
console.log("=".repeat(60));

// Create HTTP server with detailed request logging
const httpServer = createServer((req, res) => {
  const timestamp = new Date().toISOString();
  const origin = req.headers.origin || "no-origin";
  
  console.log(`[${timestamp}] HTTP ${req.method} ${req.url}`);
  console.log(`  Origin: ${origin}`);
  console.log(`  User-Agent: ${req.headers["user-agent"] || "unknown"}`);

  // Set CORS headers for all requests
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  // Handle OPTIONS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    console.log(`  Response: 200 OPTIONS OK`);
    return;
  }

  // Health check endpoint
  if (req.url === "/" || req.url === "/health") {
    const healthData = {
      status: "healthy",
      service: "nexus-socket-server",
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      port: PORT,
      host: HOST,
      nodeVersion: process.version,
      platform: process.platform,
      memory: {
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + "MB",
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + "MB",
      },
    };

    res.writeHead(200, { 
      "Content-Type": "application/json",
      "Cache-Control": "no-cache"
    });
    res.end(JSON.stringify(healthData, null, 2));
    console.log(`  Response: 200 Health Check OK`);
    return;
  }

  // Ping endpoint for keep-alive
  if (req.url === "/ping") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("pong");
    console.log(`  Response: 200 Ping OK`);
    return;
  }

  // 404 for other routes
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ 
    error: "Not Found", 
    path: req.url,
    availableEndpoints: ["/", "/health", "/ping"]
  }));
  console.log(`  Response: 404 Not Found`);
});

// Socket.IO setup
console.log("\n🔌 Initializing Socket.IO...");
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) {
        console.log("  ✅ Allowing request with no origin");
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        console.log(`  ✅ Allowing origin: ${origin}`);
        callback(null, true);
      } else {
        console.log(`  ❌ Blocking origin: ${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
});

console.log("✅ Socket.IO initialized\n");

// Connection tracking
const clients = new Map();
let totalConnections = 0;

io.on("connection", (socket) => {
  totalConnections++;
  const timestamp = new Date().toISOString();
  clients.set(socket.id, { 
    connectedAt: timestamp, 
    rooms: new Set(),
    connectionNumber: totalConnections
  });
  
  console.log(`[${timestamp}] 🟢 Client connected`);
  console.log(`  Socket ID: ${socket.id}`);
  console.log(`  Connection #${totalConnections}`);
  console.log(`  Active clients: ${clients.size}`);

  socket.on("join", (data) => {
    const timestamp = new Date().toISOString();
    
    if (!data || !data.chatId) {
      console.log(`[${timestamp}] ⚠️  Invalid join from ${socket.id}`);
      socket.emit("error", { message: "Invalid join data. chatId required." });
      return;
    }

    const { chatId, username } = data;
    socket.join(chatId);

    const client = clients.get(socket.id);
    if (client) client.rooms.add(chatId);

    const roomSize = io.sockets.adapter.rooms.get(chatId)?.size || 0;
    
    console.log(`[${timestamp}] 👤 User joined`);
    console.log(`  Socket: ${socket.id}`);
    console.log(`  Username: ${username || "anonymous"}`);
    console.log(`  Chat ID: ${chatId}`);
    console.log(`  Room size: ${roomSize}`);

    socket.emit("joined", { chatId, success: true, roomSize });
  });

  socket.on("sendMessage", (data) => {
    const timestamp = new Date().toISOString();
    
    if (!data || !data.chatId || !data.message) {
      console.log(`[${timestamp}] ⚠️  Invalid message from ${socket.id}`);
      socket.emit("error", { message: "Invalid message data." });
      return;
    }

    const { chatId, message, username, sender } = data;
    const room = io.sockets.adapter.rooms.get(chatId);

    if (!room || !room.has(socket.id)) {
      console.log(`[${timestamp}] ⚠️  ${socket.id} not in room ${chatId}`);
      socket.emit("error", { message: "Must join room first" });
      return;
    }

    const messageData = {
      chatId,
      message,
      username: username || sender || "Anonymous",
      sender: sender || username || "Anonymous",
      timestamp: new Date().toISOString(),
    };

    io.to(chatId).emit("receiveMessage", messageData);
    
    console.log(`[${timestamp}] 📨 Message broadcasted`);
    console.log(`  From: ${username || sender} (${socket.id})`);
    console.log(`  Room: ${chatId}`);
    console.log(`  Recipients: ${room.size}`);
    console.log(`  Message: ${message.substring(0, 50)}${message.length > 50 ? "..." : ""}`);
  });

  socket.on("disconnect", (reason) => {
    const timestamp = new Date().toISOString();
    const client = clients.get(socket.id);
    
    console.log(`[${timestamp}] 🔴 Client disconnected`);
    console.log(`  Socket ID: ${socket.id}`);
    console.log(`  Reason: ${reason}`);
    if (client) {
      console.log(`  Was in ${client.rooms.size} room(s)`);
    }
    console.log(`  Remaining clients: ${clients.size - 1}`);
    
    clients.delete(socket.id);
  });

  socket.on("error", (error) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ⚠️  Socket error for ${socket.id}:`, error);
  });
});

// Start server with detailed logging
console.log("=".repeat(60));
console.log("🌐 Starting HTTP server...");
console.log("=".repeat(60));

const server = httpServer.listen(PORT, HOST, () => {
  const addr = server.address();
  console.log("\n" + "=".repeat(60));
  console.log("✅✅✅ SERVER IS LIVE AND LISTENING ✅✅✅");
  console.log("=".repeat(60));
  console.log(`📍 Address: ${addr.address}`);
  console.log(`🔌 Port: ${addr.port}`);
  console.log(`🌐 Family: ${addr.family}`);
  console.log(`🏥 Health: http://${HOST}:${addr.port}/health`);
  console.log(`📡 WebSocket: Ready`);
  console.log("=".repeat(60));
  console.log("\n🎯 Server is ready to accept connections!\n");
});

// Error handling
server.on("error", (error) => {
  console.error("\n" + "=".repeat(60));
  console.error("❌ FATAL: HTTP SERVER ERROR");
  console.error("=".repeat(60));
  console.error("Error:", error.message);
  console.error("Code:", error.code);
  console.error("Stack:", error.stack);
  
  if (error.code === "EADDRINUSE") {
    console.error(`\n⚠️  Port ${PORT} is already in use!`);
  } else if (error.code === "EACCES") {
    console.error(`\n⚠️  Permission denied for port ${PORT}!`);
  }
  
  console.error("=".repeat(60));
  process.exit(1);
});

server.on("listening", () => {
  console.log("📢 Server 'listening' event fired");
});

server.on("connection", (socket) => {
  console.log(`🔗 New TCP connection from ${socket.remoteAddress}:${socket.remotePort}`);
});

// Graceful shutdown
const shutdown = (signal) => {
  console.log(`\n\n${"=".repeat(60)}`);
  console.log(`⏹️  ${signal} received - Shutting down gracefully...`);
  console.log("=".repeat(60));
  
  server.close(() => {
    console.log("✅ HTTP server closed");
    io.close(() => {
      console.log("✅ Socket.IO closed");
      console.log("👋 Goodbye!\n");
      process.exit(0);
    });
  });

  setTimeout(() => {
    console.error("❌ Forced shutdown after 10s timeout");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Error handlers
process.on("uncaughtException", (error) => {
  console.error("\n" + "=".repeat(60));
  console.error("❌ UNCAUGHT EXCEPTION");
  console.error("=".repeat(60));
  console.error("Error:", error.message);
  console.error("Stack:", error.stack);
  console.error("=".repeat(60));
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("\n" + "=".repeat(60));
  console.error("❌ UNHANDLED PROMISE REJECTION");
  console.error("=".repeat(60));
  console.error("Reason:", reason);
  console.error("Promise:", promise);
  console.error("=".repeat(60));
  process.exit(1);
});

// Keep-alive heartbeat
setInterval(() => {
  const uptime = Math.floor(process.uptime());
  const mins = Math.floor(uptime / 60);
  const secs = uptime % 60;
  console.log(`💓 Heartbeat - Uptime: ${mins}m ${secs}s | Clients: ${clients.size} | Connections: ${totalConnections}`);
}, 30000);

console.log("\n✅ All event handlers registered");
console.log("⏳ Waiting for server to start listening...\n");


// import { createServer } from "http";
// import { Server } from "socket.io";

// /**
//  * Socket.IO Server for Real-time Chat
//  *
//  * This standalone server handles WebSocket connections for the Nexus social media app.
//  * It manages chat rooms, message broadcasting, and user connections.
//  *
//  * Deployment: Railway/Render compatible
//  * Health Check: GET /health
//  */

// // ==================== Configuration ====================
// const PORT = parseInt(process.env.PORT || "10000", 10);
// const hostname = process.env.HOSTNAME || process.env.HOST || "0.0.0.0";
// const port = parseInt(process.env.PORT || "3001", 10);

// // Default allowed origins for nexuswebsite.me domain
// const defaultOrigins = [
//   "https://www.nexuswebsite.me",
//   "https://nexuswebsite.me",
//   "http://www.nexuswebsite.me",
//   "http://nexuswebsite.me",
// ];

// // Parse allowed origins from environment variable (comma-separated)
// const allowedOrigins = process.env.ALLOWED_ORIGINS
//   ? process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
//   : defaultOrigins;

// // ==================== Logging Utility ====================
// const log = {
//   info: (message, ...args) => {
//     const timestamp = new Date().toISOString();
//     console.log(`[${timestamp}] [INFO] ${message}`, ...args);
//   },
//   error: (message, ...args) => {
//     const timestamp = new Date().toISOString();
//     console.error(`[${timestamp}] [ERROR] ${message}`, ...args);
//   },
//   warn: (message, ...args) => {
//     const timestamp = new Date().toISOString();
//     console.warn(`[${timestamp}] [WARN] ${message}`, ...args);
//   },
//   debug: (message, ...args) => {
//     if (process.env.DEBUG === "true") {
//       const timestamp = new Date().toISOString();
//       console.log(`[${timestamp}] [DEBUG] ${message}`, ...args);
//     }
//   },
// };

// // ==================== HTTP Server Setup ====================
// const httpServer = createServer((req, res) => {
//   // Health check endpoint for Railway/Render health checks
//   if (req.url === "/" || req.url === "/health") {
//     res.writeHead(200, {
//       "Content-Type": "application/json",
//       "Access-Control-Allow-Origin": "*",
//     });
//     res.end(
//       JSON.stringify({
//         status: "ok",
//         service: "socket-server",
//         timestamp: new Date().toISOString(),
//         uptime: process.uptime(),
//       })
//     );
//     log.debug("Health check requested");
//     return;
//   }

//   // For all other routes, return 404
//   res.writeHead(404, { "Content-Type": "application/json" });
//   res.end(JSON.stringify({ error: "Not Found", path: req.url }));
//   log.warn(`404 - Route not found: ${req.url}`);
// });

// // ==================== Socket.IO Configuration ====================
// const io = new Server(httpServer, {
//   cors: {
//     origin: (origin, callback) => {
//       // Allow requests with no origin (like mobile apps, Postman, etc.)
//       if (!origin) {
//         return callback(null, true);
//       }

//       // Check if origin is in allowed list
//       if (allowedOrigins.includes(origin)) {
//         callback(null, true);
//       } else {
//         log.warn(`CORS blocked origin: ${origin}`);
//         callback(new Error("Not allowed by CORS"));
//       }
//     },
//     methods: ["GET", "POST"],
//     credentials: true,
//   },
//   transports: ["websocket", "polling"], // WebSocket first, polling as fallback
//   allowEIO3: true, // Allow Engine.IO v3 clients
//   pingTimeout: 60000, // 60 seconds
//   pingInterval: 25000, // 25 seconds
// });

// // Track connected clients
// const connectedClients = new Map();

// // ==================== Socket.IO Event Handlers ====================
// io.on("connection", (socket) => {
//   const clientId = socket.id;
//   const connectTime = new Date().toISOString();

//   log.info(`Client connected: ${clientId} at ${connectTime}`);
//   connectedClients.set(clientId, {
//     id: clientId,
//     connectedAt: connectTime,
//     rooms: new Set(),
//   });

//   // Handle join event - user joins a chat room
//   socket.on("join", (data) => {
//     try {
//       if (!data || !data.chatId) {
//         log.warn(`Invalid join data from ${clientId}:`, data);
//         socket.emit("error", {
//           message: "Invalid join data. chatId is required.",
//         });
//         return;
//       }

//       const { chatId, username } = data;
//       socket.join(chatId);

//       // Track room membership
//       const client = connectedClients.get(clientId);
//       if (client) {
//         client.rooms.add(chatId);
//       }

//       log.info(
//         `User ${
//           username || "anonymous"
//         } (${clientId}) joined chat room: ${chatId}`
//       );
//       log.debug(
//         `Total clients in room ${chatId}: ${
//           io.sockets.adapter.rooms.get(chatId)?.size || 0
//         }`
//       );

//       // Acknowledge successful join
//       socket.emit("joined", { chatId, success: true });
//     } catch (error) {
//       log.error(`Error handling join event from ${clientId}:`, error);
//       socket.emit("error", { message: "Failed to join chat room" });
//     }
//   });

//   // Handle sendMessage event - broadcast message to all users in chat room
//   socket.on("sendMessage", (data) => {
//     try {
//       if (!data || !data.chatId || !data.message) {
//         log.warn(`Invalid message data from ${clientId}:`, data);
//         socket.emit("error", {
//           message: "Invalid message data. chatId and message are required.",
//         });
//         return;
//       }

//       const { chatId, message, username, sender } = data;

//       // Verify sender is in the room
//       const room = io.sockets.adapter.rooms.get(chatId);
//       if (!room || !room.has(clientId)) {
//         log.warn(
//           `Client ${clientId} tried to send message to room ${chatId} without being in it`
//         );
//         socket.emit("error", { message: "You must join the chat room first" });
//         return;
//       }

//       // Broadcast message to all clients in the chat room
//       const messageData = {
//         chatId,
//         message,
//         username: username || sender,
//         sender: sender || username,
//         timestamp: new Date().toISOString(),
//       };

//       io.to(chatId).emit("receiveMessage", messageData);

//       log.info(
//         `Message broadcasted in room ${chatId} by ${
//           sender || username
//         } (${clientId})`
//       );
//       log.debug(`Message sent to ${room.size} client(s) in room ${chatId}`);
//     } catch (error) {
//       log.error(`Error handling sendMessage event from ${clientId}:`, error);
//       socket.emit("error", { message: "Failed to send message" });
//     }
//   });

//   // Handle disconnect event
//   socket.on("disconnect", (reason) => {
//     const client = connectedClients.get(clientId);
//     if (client) {
//       log.info(
//         `Client disconnected: ${clientId} (reason: ${reason}). Was in ${client.rooms.size} room(s)`
//       );
//       connectedClients.delete(clientId);
//     } else {
//       log.info(`Client disconnected: ${clientId} (reason: ${reason})`);
//     }
//   });

//   // Handle connection errors
//   socket.on("error", (error) => {
//     log.error(`Socket error for client ${clientId}:`, error);
//   });
// });

// // ==================== Server Startup ====================
// httpServer.listen(port, hostname, () => {
//   log.info(`========================================`);
//   log.info(`Socket.IO Server Started Successfully`);
//   log.info(`========================================`);
//   log.info(`Server URL: http://${hostname}:${port}`);
//   log.info(`Health Check: http://${hostname}:${port}/health`);
//   log.info(`Allowed Origins: ${allowedOrigins.join(", ")}`);
//   log.info(`Environment: ${process.env.NODE_ENV || "development"}`);
//   log.info(`========================================`);
// });

// // ==================== Error Handling ====================
// httpServer.on("error", (error) => {
//   log.error("HTTP Server Error:", error);
//   if (error.code === "EADDRINUSE") {
//     log.error(`Port ${port} is already in use. Please use a different port.`);
//   }
//   process.exit(1);
// });

// // Handle uncaught exceptions
// process.on("uncaughtException", (error) => {
//   log.error("Uncaught Exception:", error);
//   log.error("Stack trace:", error.stack);
//   // Give time for logs to flush
//   setTimeout(() => {
//     process.exit(1);
//   }, 1000);
// });

// // Handle unhandled promise rejections
// process.on("unhandledRejection", (reason, promise) => {
//   log.error("Unhandled Rejection at:", promise);
//   log.error("Reason:", reason);
//   // Give time for logs to flush
//   setTimeout(() => {
//     process.exit(1);
//   }, 1000);
// });

// // Graceful shutdown
// process.on("SIGTERM", () => {
//   log.info("SIGTERM received, shutting down gracefully...");
//   httpServer.close(() => {
//     log.info("HTTP server closed");
//     io.close(() => {
//       log.info("Socket.IO server closed");
//       process.exit(0);
//     });
//   });
// });

// process.on("SIGINT", () => {
//   log.info("SIGINT received, shutting down gracefully...");
//   httpServer.close(() => {
//     log.info("HTTP server closed");
//     io.close(() => {
//       log.info("Socket.IO server closed");
//       process.exit(0);
//     });
//   });
// });
