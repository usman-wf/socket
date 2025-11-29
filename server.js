import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || process.env.HOST || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer(handler);

  console.log("HTTP", httpServer);

  // Initialize Socket.IO with CORS configuration for production
  const io = new Server(httpServer, {
    cors: {
      origin: dev
        ? ["http://localhost:3000", "http://127.0.0.1:3000"]
        : [
            "https://www.nexuswebsite.me",
            "https://nexuswebsite.me",
            "http://www.nexuswebsite.me",
            "http://nexuswebsite.me",
          ],
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  io.on("connection", (socket) => {
    console.log("Client connected");

    socket.on("join", (data) => {
      console.log("JOIN CALLED");
      const { chatId, username } = data;
      socket.join(chatId);
      console.log("User joined chat:", chatId);
    });

    socket.on("sendMessage", (data) => {
      console.log("SEND", data);
      const { chatId, message, username, sender } = data;
      io.to(chatId).emit("receiveMessage", {
        chatId,
        username,
        message,
        sender,
      });
    });

    socket.on("disconnect", () => {
      console.log("User disconnected");
    });
  });

  // Start the server and handle requests
  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
