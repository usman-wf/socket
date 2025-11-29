import { createServer } from "node:http";
import { Server } from "socket.io";

/**
 * Socket.IO Server for Real-time Chat
 *
 * This standalone server handles WebSocket connections for the Nexus social media app.
 * It manages chat rooms, message broadcasting, and user connections.
 *
 * Deployment: Railway/Render compatible
 * Health Check: GET /health
 */

// ==================== Configuration ====================
const hostname = process.env.HOSTNAME || process.env.HOST || "0.0.0.0";
const port = parseInt(process.env.PORT || "3001", 10);

// Default allowed origins for nexuswebsite.me domain
const defaultOrigins = [
  "https://www.nexuswebsite.me",
  "https://nexuswebsite.me",
  "http://www.nexuswebsite.me",
  "http://nexuswebsite.me",
];

// Parse allowed origins from environment variable (comma-separated)
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
  : defaultOrigins;

// ==================== Logging Utility ====================
const log = {
  info: (message, ...args) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [INFO] ${message}`, ...args);
  },
  error: (message, ...args) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [ERROR] ${message}`, ...args);
  },
  warn: (message, ...args) => {
    const timestamp = new Date().toISOString();
    console.warn(`[${timestamp}] [WARN] ${message}`, ...args);
  },
  debug: (message, ...args) => {
    if (process.env.DEBUG === "true") {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [DEBUG] ${message}`, ...args);
    }
  },
};

// ==================== HTTP Server Setup ====================
const httpServer = createServer((req, res) => {
  // Health check endpoint for Railway/Render health checks
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(
      JSON.stringify({
        status: "ok",
        service: "socket-server",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      })
    );
    log.debug("Health check requested");
    return;
  }

  // For all other routes, return 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found", path: req.url }));
  log.warn(`404 - Route not found: ${req.url}`);
});

// ==================== Socket.IO Configuration ====================
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, Postman, etc.)
      if (!origin) {
        return callback(null, true);
      }

      // Check if origin is in allowed list
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        log.warn(`CORS blocked origin: ${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"], // WebSocket first, polling as fallback
  allowEIO3: true, // Allow Engine.IO v3 clients
  pingTimeout: 60000, // 60 seconds
  pingInterval: 25000, // 25 seconds
});

// Track connected clients
const connectedClients = new Map();

// ==================== Socket.IO Event Handlers ====================
io.on("connection", (socket) => {
  const clientId = socket.id;
  const connectTime = new Date().toISOString();

  log.info(`Client connected: ${clientId} at ${connectTime}`);
  connectedClients.set(clientId, {
    id: clientId,
    connectedAt: connectTime,
    rooms: new Set(),
  });

  // Handle join event - user joins a chat room
  socket.on("join", (data) => {
    try {
      if (!data || !data.chatId) {
        log.warn(`Invalid join data from ${clientId}:`, data);
        socket.emit("error", {
          message: "Invalid join data. chatId is required.",
        });
        return;
      }

      const { chatId, username } = data;
      socket.join(chatId);

      // Track room membership
      const client = connectedClients.get(clientId);
      if (client) {
        client.rooms.add(chatId);
      }

      log.info(
        `User ${
          username || "anonymous"
        } (${clientId}) joined chat room: ${chatId}`
      );
      log.debug(
        `Total clients in room ${chatId}: ${
          io.sockets.adapter.rooms.get(chatId)?.size || 0
        }`
      );

      // Acknowledge successful join
      socket.emit("joined", { chatId, success: true });
    } catch (error) {
      log.error(`Error handling join event from ${clientId}:`, error);
      socket.emit("error", { message: "Failed to join chat room" });
    }
  });

  // Handle sendMessage event - broadcast message to all users in chat room
  socket.on("sendMessage", (data) => {
    try {
      if (!data || !data.chatId || !data.message) {
        log.warn(`Invalid message data from ${clientId}:`, data);
        socket.emit("error", {
          message: "Invalid message data. chatId and message are required.",
        });
        return;
      }

      const { chatId, message, username, sender } = data;

      // Verify sender is in the room
      const room = io.sockets.adapter.rooms.get(chatId);
      if (!room || !room.has(clientId)) {
        log.warn(
          `Client ${clientId} tried to send message to room ${chatId} without being in it`
        );
        socket.emit("error", { message: "You must join the chat room first" });
        return;
      }

      // Broadcast message to all clients in the chat room
      const messageData = {
        chatId,
        message,
        username: username || sender,
        sender: sender || username,
        timestamp: new Date().toISOString(),
      };

      io.to(chatId).emit("receiveMessage", messageData);

      log.info(
        `Message broadcasted in room ${chatId} by ${
          sender || username
        } (${clientId})`
      );
      log.debug(`Message sent to ${room.size} client(s) in room ${chatId}`);
    } catch (error) {
      log.error(`Error handling sendMessage event from ${clientId}:`, error);
      socket.emit("error", { message: "Failed to send message" });
    }
  });

  // Handle disconnect event
  socket.on("disconnect", (reason) => {
    const client = connectedClients.get(clientId);
    if (client) {
      log.info(
        `Client disconnected: ${clientId} (reason: ${reason}). Was in ${client.rooms.size} room(s)`
      );
      connectedClients.delete(clientId);
    } else {
      log.info(`Client disconnected: ${clientId} (reason: ${reason})`);
    }
  });

  // Handle connection errors
  socket.on("error", (error) => {
    log.error(`Socket error for client ${clientId}:`, error);
  });
});

// ==================== Server Startup ====================
httpServer.listen(port, hostname, () => {
  log.info(`========================================`);
  log.info(`Socket.IO Server Started Successfully`);
  log.info(`========================================`);
  log.info(`Server URL: http://${hostname}:${port}`);
  log.info(`Health Check: http://${hostname}:${port}/health`);
  log.info(`Allowed Origins: ${allowedOrigins.join(", ")}`);
  log.info(`Environment: ${process.env.NODE_ENV || "development"}`);
  log.info(`========================================`);
});

// ==================== Error Handling ====================
httpServer.on("error", (error) => {
  log.error("HTTP Server Error:", error);
  if (error.code === "EADDRINUSE") {
    log.error(`Port ${port} is already in use. Please use a different port.`);
  }
  process.exit(1);
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  log.error("Uncaught Exception:", error);
  log.error("Stack trace:", error.stack);
  // Give time for logs to flush
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  log.error("Unhandled Rejection at:", promise);
  log.error("Reason:", reason);
  // Give time for logs to flush
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  log.info("SIGTERM received, shutting down gracefully...");
  httpServer.close(() => {
    log.info("HTTP server closed");
    io.close(() => {
      log.info("Socket.IO server closed");
      process.exit(0);
    });
  });
});

process.on("SIGINT", () => {
  log.info("SIGINT received, shutting down gracefully...");
  httpServer.close(() => {
    log.info("HTTP server closed");
    io.close(() => {
      log.info("Socket.IO server closed");
      process.exit(0);
    });
  });
});
