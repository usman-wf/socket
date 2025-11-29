"use client";

/**
 * Socket.IO Client Utility
 *
 * Singleton pattern implementation for Socket.IO connections.
 * Ensures only one socket instance exists throughout the application.
 *
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Connection status tracking
 * - Support for both WebSocket and polling transports
 * - Environment-based URL configuration
 */

import { io } from "socket.io-client";

// Singleton socket instance
let socketInstance = null;
let connectionAttempts = 0;
const MAX_RECONNECTION_ATTEMPTS = 5;
const INITIAL_RECONNECTION_DELAY = 1000; // 1 second

/**
 * Get the Socket.IO server URL from environment variables
 * Falls back to development URL if not set
 */
const getSocketUrl = () => {
  // In production, use NEXT_PUBLIC_SOCKET_URL environment variable
  // In development, default to localhost
  if (typeof window !== "undefined") {
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;

    if (socketUrl) {
      return socketUrl;
    }

    // Development fallback
    if (process.env.NODE_ENV === "development") {
      return "http://localhost:3001";
    }

    // Production fallback (should not be used if env var is set)
    console.warn(
      "NEXT_PUBLIC_SOCKET_URL not set. Socket connection may fail in production."
    );
    return "http://localhost:3001";
  }

  return null;
};

/**
 * Calculate exponential backoff delay for reconnection
 * @param {number} attempt - Current reconnection attempt number
 * @returns {number} Delay in milliseconds
 */
const getReconnectionDelay = (attempt) => {
  return Math.min(
    INITIAL_RECONNECTION_DELAY * Math.pow(2, attempt),
    30000 // Max 30 seconds
  );
};

/**
 * Initialize Socket.IO connection
 * Creates a singleton socket instance if one doesn't exist
 *
 * @param {Object} options - Optional configuration
 * @param {string} options.url - Custom socket server URL (overrides env var)
 * @param {Function} options.onConnect - Callback when socket connects
 * @param {Function} options.onDisconnect - Callback when socket disconnects
 * @param {Function} options.onError - Callback when connection error occurs
 * @returns {Object} Socket.IO client instance
 */
export const initSocket = (options = {}) => {
  // Return existing instance if already initialized
  if (socketInstance && socketInstance.connected) {
    console.log("[Socket] Using existing socket connection");
    return socketInstance;
  }

  // If instance exists but disconnected, clean it up
  if (socketInstance) {
    console.log("[Socket] Cleaning up disconnected socket instance");
    socketInstance.disconnect();
    socketInstance = null;
  }

  const socketUrl = options.url || getSocketUrl();

  if (!socketUrl) {
    console.error("[Socket] Cannot initialize socket: URL not available");
    return null;
  }

  console.log(`[Socket] Initializing connection to: ${socketUrl}`);

  // Create new socket instance
  socketInstance = io(socketUrl, {
    transports: ["websocket", "polling"], // Try WebSocket first, fallback to polling
    reconnection: true,
    reconnectionDelay: INITIAL_RECONNECTION_DELAY,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: MAX_RECONNECTION_ATTEMPTS,
    timeout: 20000, // 20 seconds connection timeout
    forceNew: false, // Reuse existing connection if available
  });

  // Connection event handlers
  socketInstance.on("connect", () => {
    connectionAttempts = 0; // Reset on successful connection
    console.log(
      `[Socket] ✅ Connected successfully! Socket ID: ${socketInstance.id}`
    );
    console.log(
      `[Socket] Transport: ${socketInstance.io.engine.transport.name}`
    );

    if (options.onConnect) {
      options.onConnect(socketInstance);
    }
  });

  socketInstance.on("connect_error", (error) => {
    connectionAttempts++;
    console.error(
      `[Socket] ❌ Connection error (attempt ${connectionAttempts}/${MAX_RECONNECTION_ATTEMPTS}):`,
      error.message
    );

    if (connectionAttempts >= MAX_RECONNECTION_ATTEMPTS) {
      console.error(`[Socket] Max reconnection attempts reached. Giving up.`);
      if (options.onError) {
        options.onError(error);
      }
    }
  });

  socketInstance.on("disconnect", (reason) => {
    console.log(`[Socket] Disconnected. Reason: ${reason}`);

    if (options.onDisconnect) {
      options.onDisconnect(reason);
    }

    // If disconnect was intentional, don't try to reconnect
    if (reason === "io client disconnect") {
      socketInstance = null;
    }
  });

  socketInstance.on("reconnect", (attemptNumber) => {
    console.log(`[Socket] ✅ Reconnected after ${attemptNumber} attempt(s)`);
    connectionAttempts = 0;
  });

  socketInstance.on("reconnect_attempt", (attemptNumber) => {
    const delay = getReconnectionDelay(attemptNumber - 1);
    console.log(
      `[Socket] 🔄 Reconnection attempt ${attemptNumber}/${MAX_RECONNECTION_ATTEMPTS} (delay: ${delay}ms)`
    );
  });

  socketInstance.on("reconnect_error", (error) => {
    console.error(`[Socket] Reconnection error:`, error.message);
  });

  socketInstance.on("reconnect_failed", () => {
    console.error(
      `[Socket] ❌ Reconnection failed after ${MAX_RECONNECTION_ATTEMPTS} attempts`
    );
    if (options.onError) {
      options.onError(new Error("Reconnection failed"));
    }
  });

  // Error event handler
  socketInstance.on("error", (error) => {
    console.error(`[Socket] Socket error:`, error);
    if (options.onError) {
      options.onError(error);
    }
  });

  return socketInstance;
};

/**
 * Get the current socket instance
 * Returns null if socket hasn't been initialized
 *
 * @returns {Object|null} Socket.IO client instance or null
 */
export const getSocket = () => {
  if (!socketInstance) {
    console.warn("[Socket] Socket not initialized. Call initSocket() first.");
    return null;
  }
  return socketInstance;
};

/**
 * Disconnect the socket and clean up the instance
 *
 * @param {boolean} force - Force disconnect even if socket is in use
 */
export const disconnectSocket = (force = false) => {
  if (socketInstance) {
    console.log("[Socket] Disconnecting socket...");
    socketInstance.disconnect();
    socketInstance = null;
    connectionAttempts = 0;
    console.log("[Socket] Socket disconnected and cleaned up");
  } else {
    console.log("[Socket] No socket instance to disconnect");
  }
};

/**
 * Check if socket is connected
 *
 * @returns {boolean} True if socket exists and is connected
 */
export const isSocketConnected = () => {
  return socketInstance !== null && socketInstance.connected;
};

/**
 * Get socket connection status
 *
 * @returns {Object} Status object with connected, id, and transport info
 */
export const getSocketStatus = () => {
  if (!socketInstance) {
    return {
      connected: false,
      id: null,
      transport: null,
      url: null,
    };
  }

  return {
    connected: socketInstance.connected,
    id: socketInstance.id,
    transport: socketInstance.io?.engine?.transport?.name || null,
    url: socketInstance.io?.uri || null,
  };
};

// Export default for convenience
export default {
  initSocket,
  getSocket,
  disconnectSocket,
  isSocketConnected,
  getSocketStatus,
};
