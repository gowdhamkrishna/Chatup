import express from 'express';
import { Server } from 'socket.io';
import http from 'http';
import { checkUser, saveUser, updateLastSeen } from './Database/actions.js';
import cleanupInactiveUsers from './Database/cleanUp.js';
import User from './Database/models/userSchema.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import compression from 'compression';

// Performance monitoring
const performanceStats = {
  messagesSent: 0,
  messagesReceived: 0,
  connections: 0,
  disconnections: 0,
  errors: 0,
  startTime: Date.now(),
};

// Log performance stats every minute
setInterval(() => {
  const uptime = Math.floor((Date.now() - performanceStats.startTime) / 1000);
  console.log(`
=== PERFORMANCE STATS (${uptime}s) ===
Connections: ${performanceStats.connections}
Disconnections: ${performanceStats.disconnections}
Messages Sent: ${performanceStats.messagesSent}
Messages Received: ${performanceStats.messagesReceived}
Errors: ${performanceStats.errors}
Active users: ${activeUsers.size}
`);
}, 60 * 1000);

const app = express();
const server = http.createServer(app);

// Use compression for all responses
app.use(compression());

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
  },
  fileFilter: function (req, file, cb) {
    // Accept images only
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
      return cb(new Error('Only image files are allowed!'), false);
    }
    cb(null, true);
  }
});

// Serve static files from uploads directory
app.use('/uploads', express.static(uploadsDir));

// Middleware for parsing JSON
app.use(express.json());

// Add a test endpoint
app.get('/test', (req, res) => {
  console.log('Test endpoint called');
  res.json({ message: 'Server is working!' });
});

// Add a health check endpoint for testing connections
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    clientIP: req.ip || req.connection.remoteAddress
  });
});

// Enable CORS for all routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  next();
});

// Add error handling for multer
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error('Multer error:', err);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large. Max 5MB allowed.' });
    }
    return res.status(400).json({ error: err.message });
  } else if (err) {
    console.error('Unknown error:', err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
  next();
});

// Handle image upload endpoint
app.post('/upload', upload.single('image'), (req, res) => {
  console.log('Upload request received:', req.file);
  
  try {
    if (!req.file) {
      console.log('No file in request');
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Create URL for the uploaded file
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    console.log('File uploaded successfully:', fileUrl);
    
    return res.status(200).json({
      success: true,
      imageUrl: fileUrl
    });
  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ error: 'File upload failed' });
  }
});

const io = new Server(server, {
  cors: {
    origin: ["*", "http://localhost:3000", "capacitor://localhost", "ionic://localhost", "null"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
  },
  // Socket.IO performance optimizations
  pingTimeout: 60000, // Increased to 60 seconds for mobile
  pingInterval: 25000, // Increased to 25 seconds for mobile
  transports: ['websocket', 'polling'],
  // Prefer websocket but fall back to polling for mobile
  upgradeTimeout: 10000, // 10 seconds upgrade timeout for slower mobile connections
  // Memory and CPU optimizations
  maxHttpBufferSize: 5e6, // 5MB for image transfers
  connectTimeout: 45000, // 45 second connection timeout for mobile
});

const activeUsers = new Map();

// Add rate limiting for connections and requests
const connectionLimits = {
  maxConnections: 1000,
  connectionThrottleMs: 1000, // 1 second throttle between connections
  messageRateLimit: {
    maxMessages: 10,
    timeWindow: 10 * 1000, // 10 seconds
  },
  rateLimitByIp: new Map(),
};

// Track connection timestamps by IP
const connectionTimestamps = new Map();

// Rate limiting function for messages
const isRateLimited = (userName) => {
  const now = Date.now();
  const userRateLimit = connectionLimits.rateLimitByIp.get(userName) || {
    messages: [],
    lastWarned: 0
  };
  
  // Clean up old messages
  userRateLimit.messages = userRateLimit.messages.filter(
    timestamp => now - timestamp < connectionLimits.messageRateLimit.timeWindow
  );
  
  // Check if rate limited
  if (userRateLimit.messages.length >= connectionLimits.messageRateLimit.maxMessages) {
    // Only warn once per rate limit window
    if (now - userRateLimit.lastWarned > connectionLimits.messageRateLimit.timeWindow) {
      console.log(`Rate limiting messages from ${userName}`);
      userRateLimit.lastWarned = now;
    }
    return true;
  }
  
  // Add this message timestamp
  userRateLimit.messages.push(now);
  connectionLimits.rateLimitByIp.set(userName, userRateLimit);
  return false;
};

// Clean up listeners on unmount
const cleanupListeners = (socket) => {
  // Remove all listeners for these events
  socket.removeAllListeners("userUpdate");
  socket.removeAllListeners("UserDeleted");
  socket.removeAllListeners("user-online");
  socket.removeAllListeners("user-offline");
  socket.removeAllListeners("self-update");
  socket.removeAllListeners("conversation-update");
  socket.removeAllListeners("message-sent");
  socket.removeAllListeners("receive-message");
  socket.removeAllListeners("check-user-online");
  socket.removeAllListeners("user-online-status");
  socket.removeAllListeners("verify-online-users");
  socket.removeAllListeners("refresh-user-status");
};

// Create debounced version of broadcast events to reduce load
const createThrottledBroadcast = () => {
  let pendingUpdates = new Set();
  let timeoutId = null;
  
  return {
    scheduleUserUpdate: (userName) => {
      pendingUpdates.add(userName);
      
      if (!timeoutId) {
        timeoutId = setTimeout(() => {
          if (pendingUpdates.size > 0) {
            console.log(`Broadcasting updates for ${pendingUpdates.size} users`);
            io.emit('userUpdate');
            pendingUpdates.clear();
          }
          timeoutId = null;
        }, 500); // Reduced from 2000ms to 500ms for faster updates
      }
    }
  };
};

const throttledBroadcast = createThrottledBroadcast();

io.on('connection', (socket) => {
  // Implement connection throttling
  const clientIp = socket.handshake.address;
  const now = Date.now();
  const lastConnection = connectionTimestamps.get(clientIp) || 0;
  
  if (now - lastConnection < connectionLimits.connectionThrottleMs) {
    console.log(`Connection throttled from ${clientIp}`);
    socket.emit('connectionError', { message: 'Too many connection attempts, please try again later' });
    socket.disconnect();
    return;
  }
  
  connectionTimestamps.set(clientIp, now);
  console.log('User connected:', socket.id);
  performanceStats.connections++;

  socket.on('connected', async (formData) => {
    try {
      if (!formData?.userName) {
        throw new Error('Invalid form data');
      }

      const user = await checkUser(formData);
      
      if (user) {
        console.log('User exists:', formData.userName);
        // Update socket ID for existing user
        User.findOneAndUpdate(
          { userName: formData.userName },
          { 
            socketId: socket.id, 
            lastSeen: new Date(),
            online: true
          }
        ).then(() => {
          activeUsers.set(formData.userName, socket.id);
          socket.emit('UserExist');
          
          // Notify everyone this user is online using throttled broadcasts
          io.emit('user-online', { userName: formData.userName });
          throttledBroadcast.scheduleUserUpdate(formData.userName);
        }).catch(error => {
          console.error('Error updating user:', error);
          performanceStats.errors++;
          socket.emit('connectionError', { message: error.message });
        });
      } else {
        console.log('New user:', formData.userName);
        formData.socketId = socket.id;
        formData.lastSeen = new Date();
        formData.online = true;
        
        saveUser(formData).then(() => {
          activeUsers.set(formData.userName, socket.id);
          socket.emit('userAdded');
          
          // Notify everyone this user is online using throttled broadcasts
          io.emit('user-online', { userName: formData.userName });
          throttledBroadcast.scheduleUserUpdate(formData.userName);
        }).catch(error => {
          console.error('Error saving user:', error);
          performanceStats.errors++;
          socket.emit('connectionError', { message: error.message });
        });
      }
    } catch (error) {
      console.error('Connection error:', error);
      performanceStats.errors++;
      socket.emit('connectionError', { message: error.message });
    }
  });

  socket.on('AlreadyGuest', async (formData) => {
    try {
      if (typeof formData === 'string') {
        try {
          formData = JSON.parse(formData);
        } catch (parseError) {
          console.error('Failed to parse formData string:', parseError);
        }
      }
      
      if (!formData) {
        socket.emit("ConnectionRefused", { message: "Invalid data received" });
        return;
      }
      
      const userName = formData.userName || formData.username;
      
      if (!userName) {
        socket.emit("ConnectionRefused", { message: "Username is required" });
        return;
      }
      
      const find = await User.findOneAndUpdate(
        { userName: userName },
        { 
          socketId: socket.id, 
          lastSeen: new Date(),
          online: true
        }
      );
      
      if (!find) {
        socket.emit("ConnectionRefused");
        return;
      }
      
      activeUsers.set(userName, socket.id);
      socket.emit("ConnectionAccepted", { userName: userName });
      
      // Notify everyone this user is online
      io.emit('user-online', { userName });
      io.emit("userUpdate");
    } catch (error) {
      console.error('AlreadyGuest error:', error);
      socket.emit('connectionError', { message: error.message });
    }
  });

  socket.on('ping-user', async (userName) => {
    if (!userName) return;
    
    // Don't log each ping to reduce noise
    // console.log(`Ping from user: ${userName}`);
    
    try {
      // Check if this is the correct socket for this user
      const activeUser = activeUsers.get(userName);
      if (activeUser && activeUser.socketId !== socket.id) {
        // This is a new socket for this user, update it
        console.log(`User ${userName} has a new socket, updating from ${activeUser.socketId} to ${socket.id}`);
      }
      
      const now = new Date();
      // Update less frequently (only if more than 2 minutes have passed)
      if (!activeUser || !activeUser.lastSeen || now - new Date(activeUser.lastSeen) > 120000) {
        await User.findOneAndUpdate(
          { userName },
          { 
            online: true, 
            lastSeen: now,
            socketId: socket.id 
          },
          { new: true }
        );
        
        // Add/update in active users map
        activeUsers.set(userName, { 
          socketId: socket.id, 
          online: true,
          lastSeen: now 
        });
        
        // Emit online status update more selectively
        io.emit('user-online', {
          userName,
          online: true,
          lastSeen: now
        });
      } else {
        // Just update the active users map without DB update or broadcast
        activeUsers.set(userName, { 
          socketId: socket.id, 
          online: true,
          lastSeen: now 
        });
      }
    } catch (error) {
      console.error(`Error handling ping for ${userName}:`, error);
    }
  });

  socket.on('send-message', async (messageData) => {
    try {
      const { user } = messageData;
      performanceStats.messagesReceived++;
      
      // Check if user is rate limited
      if (isRateLimited(user)) {
        socket.emit('message-sent', {
          success: false,
          error: 'You are sending messages too quickly. Please wait a moment and try again.'
        });
        return;
      }
      
      console.log('Message received:', messageData);
      const { to, message, timestamp, id, imageUrl } = messageData;
      
      // Update both users as online when they're messaging
      await Promise.all([
        // Ensure sender is marked as online
        User.findOneAndUpdate(
          { userName: user },
          { 
            online: true,
            lastSeen: new Date(),
            socketId: socket.id
          }
        ),
        // Ensure recipient is marked as online if they have an active socket
        activeUsers.has(to) ? 
          User.findOneAndUpdate(
            { userName: to },
            { 
              online: true,
              lastSeen: new Date()
            }
          ) : Promise.resolve()
      ]);
      
      // Make sure the sender is in the active users map
      activeUsers.set(user, socket.id);
      
      // Notify clients about online status
      io.emit('user-online', { userName: user });
      
      // Also notify about recipient's online status if they're active
      if (activeUsers.has(to)) {
        io.emit('user-online', { userName: to });
      }
      
      // Create message objects with proper read status
      const recipientMessage = {
        user,
        to,
        message,
        timestamp,
        id,
        imageUrl,
        read: false
      };

      const senderMessage = {
        ...recipientMessage,
        read: true // Messages in sender's history are marked as read
      };

      // Perform database updates in parallel
      const [recipientUpdate, senderUpdate] = await Promise.all([
        // Update recipient's chat window in the database
        User.findOneAndUpdate(
          { userName: to },
          { 
            $push: { chatWindow: recipientMessage },
            lastSeen: new Date()
          },
          { new: true }
        ),
        
        // Update sender's chat window in the database
        User.findOneAndUpdate(
          { userName: user },
          { 
            $push: { chatWindow: senderMessage },
            lastSeen: new Date()
          },
          { new: true }
        )
      ]);

      // Get sender and recipient socket IDs from active users map
      const senderSocketId = activeUsers.get(user);
      const recipientSocketId = activeUsers.get(to);
      
      // Prepare immediate confirmation response
      if (senderSocketId) {
        // First confirm the message was sent - do this immediately for better UX
        io.to(senderSocketId).emit('message-sent', {
          success: true,
          messageId: id,
          message: senderMessage
        });
        
        performanceStats.messagesSent++;
      }
      
      // Send to recipient if they're online - also do this immediately
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('receive-message', {
          ...recipientMessage,
          direction: 'incoming'
        });
        
        performanceStats.messagesSent++;
      } else {
        console.log(`Recipient not online: ${to} - message will be delivered when they connect`);
      }
      
      // Send the less urgent updates separately with throttling
      setTimeout(() => {
        // Send updated user data to sender
        if (senderSocketId && senderUpdate) {
          io.to(senderSocketId).emit('self-update', senderUpdate);
          
          if (recipientUpdate) {
            io.to(senderSocketId).emit('conversation-update', recipientUpdate);
          }
          
          performanceStats.messagesSent += 2;
        }
        
        // Send updated data to recipient if they're online
        if (recipientSocketId && recipientUpdate) {
          io.to(recipientSocketId).emit('self-update', recipientUpdate);
          
          if (senderUpdate) {
            io.to(recipientSocketId).emit('conversation-update', senderUpdate);
          }
          
          performanceStats.messagesSent += 2;
        }
      }, 500); // use a longer delay to reduce server load
    } catch (error) {
      console.error('Message handling error:', error);
      performanceStats.errors++;
      const senderSocketId = activeUsers.get(messageData?.user);
      if (senderSocketId) {
        io.to(senderSocketId).emit('message-sent', {
          success: false,
          error: 'Failed to send message'
        });
      }
    }
  });

  // Debounce map for mark-messages-read
  const markAsReadDebounce = new Map();
  
  socket.on('mark-messages-read', async ({ from, to }) => {
    try {
      // Debounce mark-as-read requests
      const key = `${from}-${to}`;
      const now = Date.now();
      const lastMarkAsRead = markAsReadDebounce.get(key) || 0;
      
      if (now - lastMarkAsRead < 2000) { // 2 seconds debounce
        return; // Skip if too frequent
      }
      
      markAsReadDebounce.set(key, now);
      
      console.log(`Marking messages as read - from: ${from}, to: ${to}`);
      
      // Always update the "to" user as online when marking messages as read
      // This ensures that users actively reading messages are shown as online
      await User.findOneAndUpdate(
        { userName: to },
        { 
          online: true,
          lastSeen: new Date(),
          socketId: socket.id
        }
      );
      
      // Make sure user is in active users map
      activeUsers.set(to, socket.id);
      
      // Emit online status
      io.emit('user-online', { userName: to });
      
      // Update messages as read in the database
      const updateResult = await User.updateMany(
        { userName: to },
        { 
          $set: { 
            "chatWindow.$[elem].read": true 
          } 
        },
        {
          arrayFilters: [{ 
            "elem.user": from,
            "elem.read": false 
          }],
          multi: true
        }
      );
      
      // Only fetch data if there were actual updates
      if (updateResult.modifiedCount > 0) {
        console.log(`Updated ${updateResult.modifiedCount} messages as read`);
        
        // Get the socket IDs for both users
        const fromSocketId = activeUsers.get(from);
        const toSocketId = activeUsers.get(to);
        
        // Only fetch updated data if we have active socket connections
        if (fromSocketId || toSocketId) {
          // Fetch updated data for both users in parallel - use lean() for better performance
          const [updatedFrom, updatedTo] = await Promise.all([
            fromSocketId ? User.findOne({ userName: from }).lean() : null,
            User.findOne({ userName: to }).lean()
          ]);
          
          // Use a longer timeout to reduce server load
          setTimeout(() => {
            // Send updates to the sender (from user)
            if (fromSocketId && updatedTo) {
              io.to(fromSocketId).emit('conversation-update', updatedTo);
              performanceStats.messagesSent++;
            }
            
            // Send updates to the recipient (to user)
            if (toSocketId) {
              if (updatedTo) {
                io.to(toSocketId).emit('self-update', updatedTo);
                performanceStats.messagesSent++;
              }
              
              if (updatedFrom) {
                io.to(toSocketId).emit('conversation-update', updatedFrom);
                performanceStats.messagesSent++;
              }
            }
          }, 1000); // Delay updates by 1 second
        }
      } else {
        console.log('No messages needed to be marked as read');
      }
    } catch (error) {
      console.error('Mark messages read error:', error);
      performanceStats.errors++;
    }
  });
 
  socket.on('disconnect', async () => {
    console.log(`Socket disconnected: ${socket.id}`);
    
    try {
      // Find the username associated with this socket
      let userNameToUpdate = null;
      
      for (const [userName, userData] of activeUsers.entries()) {
        if (userData.socketId === socket.id) {
          userNameToUpdate = userName;
          break;
        }
      }
      
      if (userNameToUpdate) {
        console.log(`User ${userNameToUpdate} disconnected`);
        
        const now = new Date();
        // Update the user's status in the database
        await User.findOneAndUpdate(
          { userName: userNameToUpdate },
          { 
            online: false, 
            lastSeen: now
          }
        );
        
        // Update the active users map
        activeUsers.set(userNameToUpdate, {
          socketId: null,
          online: false,
          lastSeen: now
        });
        
        // Notify all clients immediately
        io.emit('user-offline', {
          userName: userNameToUpdate,
          online: false,
          lastSeen: now
        });
      }
      
      cleanupListeners();
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });

  // Handle socket events
  socket.on('user-online', async (userName) => {
    if (!userName) {
      console.log('No username provided for user-online event');
      return;
    }
    console.log(`User online: ${userName}`);
    
    // Update the user status in the database
    try {
      const now = new Date();
      const user = await User.findOneAndUpdate(
        { userName },
        { 
          online: true, 
          lastSeen: now,
          socketId: socket.id 
        },
        { new: true }
      );
      
      if (user) {
        console.log(`Updated ${userName} as online in DB`);
        // Add to active users map
        activeUsers.set(userName, { 
          socketId: socket.id, 
          online: true,
          lastSeen: now 
        });
        
        // Broadcast to all clients
        io.emit('user-online', {
          userName,
          online: true,
          lastSeen: now
        });
      } else {
        console.log(`User ${userName} not found in database`);
      }
    } catch (error) {
      console.error(`Error updating user online status for ${userName}:`, error);
    }
  });

  // Video call event handling
  socket.on('call-user', async (data) => {
    try {
      if (!data || !data.from || !data.to) {
        console.log('Invalid call data:', data);
        return;
      }
      
      console.log(`Call request from ${data.from} to ${data.to}`);
      
      // Find the target user's socket
      const targetUser = await User.findOne({ userName: data.to });
      if (!targetUser) {
        console.log(`Target user ${data.to} not found in database`);
        socket.emit('user-not-available', {
          caller: data.from,
          callee: data.to
        });
        return;
      }

      if (!targetUser.socketId) {
        console.log(`Target user ${data.to} has no socketId`);
        socket.emit('user-not-available', {
          caller: data.from,
          callee: data.to
        });
        return;
      }
      
      // Check if the target socket exists in our active connections
      const userSocketId = targetUser.socketId;
      const isSocketActive = activeUsers.get(data.to) === userSocketId;
      
      // Get a list of all connected sockets for verification
      const sockets = await io.fetchSockets();
      const socketExists = sockets.some(s => s.id === userSocketId);
      
      console.log(`User ${data.to} socket status:`, { 
        socketId: userSocketId,
        isInActiveMap: isSocketActive,
        socketExists: socketExists,
        online: targetUser.online
      });
      
      // If socket doesn't exist in active connections or connected sockets
      if (!isSocketActive || !socketExists) {
        console.log(`Socket for user ${data.to} is not active or doesn't exist`);
        
        // Try to find any other socket for this user
        const newSocketId = sockets.find(s => 
          s.handshake.query && 
          s.handshake.query.userName === data.to
        )?.id;
        
        if (newSocketId) {
          console.log(`Found alternative socket for ${data.to}: ${newSocketId}`);
          // Update the user's socket ID
          await User.findOneAndUpdate(
            { userName: data.to },
            { socketId: newSocketId }
          );
          
          // Update active users map
          activeUsers.set(data.to, newSocketId);
          
          // Forward call to the new socket
          io.to(newSocketId).emit('call-user', {
            from: data.from,
            to: data.to
          });
          
          console.log(`Call forwarded to alternative socket`);
          return;
        }
        
        // No alternative socket found, user is not available
        console.log(`No alternative socket found for ${data.to}`);
        socket.emit('user-not-available', {
          caller: data.from,
          callee: data.to
        });
        return;
      }
      
      // Check if the user is online in database
      if (!targetUser.online) {
        console.log(`User ${data.to} is marked as offline in database`);
        
        // Only if they're in active users map, try to deliver call
        if (isSocketActive && socketExists) {
          console.log(`User ${data.to} has an active socket despite being offline, attempting call`);
          // Update user to online
          await User.findOneAndUpdate(
            { userName: data.to },
            { online: true }
          );
        } else {
          socket.emit('user-not-available', {
            caller: data.from,
            callee: data.to
          });
          return;
        }
      }
      
      console.log(`Forwarding call to ${data.to} via socket ${userSocketId}`);
      
      // Forward the call request to the target user with retries
      const emitWithRetry = (retries = 3) => {
        if (retries <= 0) {
          console.log(`Call delivery to ${data.to} failed after retries`);
          socket.emit('user-not-available', {
            caller: data.from,
            callee: data.to
          });
          return;
        }
        
        // Try to emit directly to the socket
        const socket = io.sockets.sockets.get(userSocketId);
        if (socket) {
          console.log(`Delivering call directly to socket ${userSocketId}`);
          socket.emit('call-user', {
            from: data.from,
            to: data.to
          });
        } else {
          // Use io.to as fallback
          console.log(`Socket object not found, using io.to() method to deliver call`);
          io.to(userSocketId).emit('call-user', {
            from: data.from,
            to: data.to
          });
        }
        
        // Schedule a retry with backoff
        setTimeout(() => {
          // Skip retry if call was answered
          User.findOne({ userName: data.to })
            .then(user => {
              if (!user || !user.online) {
                console.log(`Retrying call delivery to ${data.to}, attempts left: ${retries-1}`);
                emitWithRetry(retries - 1);
              }
            });
        }, 1000 * (4 - retries)); // increasing delay: 1s, 2s, 3s
      };
      
      // Start delivery with retries
      emitWithRetry();
      
    } catch (error) {
      console.error('Error handling call request:', error);
      socket.emit('user-not-available', {
        caller: data.from,
        callee: data.to
      });
    }
  });

  // Handle WebRTC signaling data
  socket.on('call-signal', (data) => {
    if (!data || !data.signalData || !data.to) {
      console.log('Invalid call signal data');
      return;
    }
    
    console.log(`Call signal from ${data.from} to ${data.to}`);
    
    User.findOne({ userName: data.to })
      .then(user => {
        if (!user) {
          console.log(`User ${data.to} not found for call signal`);
          return;
        }
        
        if (!user.socketId) {
          console.log(`No socketId for user ${data.to}`);
          return;
        }
        
        console.log(`Forwarding call signal to ${user.userName} via socket ${user.socketId}`);
        
        // Check if we can get the actual socket
        const targetSocket = io.sockets.sockets.get(user.socketId);
        if (targetSocket) {
          // Direct emission is more reliable
          targetSocket.emit('call-signal', {
            signalData: data.signalData,
            from: data.from,
            to: data.to
          });
          console.log(`Call signal delivered directly to socket`);
        } else {
          // Fallback to room emission
          io.to(user.socketId).emit('call-signal', {
            signalData: data.signalData,
            from: data.from,
            to: data.to
          });
          console.log(`Call signal delivered via room emission`);
        }
      })
      .catch(error => {
        console.error('Error forwarding call signal:', error);
      });
  });

  // Handle call acceptance
  socket.on('call-accepted', (data) => {
    if (!data || !data.signalData || !data.to) return;
    
    User.findOne({ userName: data.to })
      .then(user => {
        if (user && user.socketId) {
          io.to(user.socketId).emit('call-accepted', {
            signalData: data.signalData,
            from: data.from,
            to: data.to
          });
        }
      })
      .catch(error => {
        console.error('Error forwarding call acceptance:', error);
      });
  });

  // Handle call rejection
  socket.on('call-rejected', (data) => {
    if (!data || !data.from || !data.to) return;
    
    User.findOne({ userName: data.to })
      .then(user => {
        if (user && user.socketId) {
          io.to(user.socketId).emit('call-rejected', {
            from: data.from,
            to: data.to
          });
        }
      })
      .catch(error => {
        console.error('Error forwarding call rejection:', error);
      });
  });

  // Handle call ending
  socket.on('call-ended', (data) => {
    if (!data || !data.from || !data.to) return;
    
    User.findOne({ userName: data.to })
      .then(user => {
        if (user && user.socketId) {
          io.to(user.socketId).emit('call-ended', {
            from: data.from,
            to: data.to
          });
        }
      })
      .catch(error => {
        console.error('Error forwarding call end:', error);
      });
  });

  // Handle user not available for call
  socket.on('user-not-available', (data) => {
    if (!data || !data.caller) return;
    
    User.findOne({ userName: data.caller })
      .then(user => {
        if (user && user.socketId) {
          io.to(user.socketId).emit('user-not-available', {
            caller: data.caller,
            callee: data.callee
          });
        }
      })
      .catch(error => {
        console.error('Error forwarding user unavailable status:', error);
      });
  });

  // Handle check-user-online event for video call verification
  socket.on('check-user-online', async (data) => {
    console.log(`Checking if user ${data?.userName} is online`);
    
    if (!data || !data.userName) {
      // Send a properly structured response even for invalid requests
      socket.emit('user-online-status', {
        userName: data?.userName || 'unknown',
        online: false,
        lastSeen: new Date().toISOString(),
        error: 'Invalid username'
      });
      return;
    }
    
    try {
      // Check if the user is active in our map
      const isActive = activeUsers.has(data.userName);
      
      // Get the user from database
      const user = await User.findOne({ userName: data.userName });
      
      if (!user) {
        // User doesn't exist in database
        socket.emit('user-online-status', {
          userName: data.userName,
          online: false,
          lastSeen: new Date().toISOString(),
          error: 'User not found'
        });
        return;
      }
      
      // If socket exists in active users map, verify it's really connected
      if (isActive) {
        const socketId = activeUsers.get(data.userName);
        
        // Validate that the socket is actually connected
        const allSockets = await io.fetchSockets();
        const socketExists = allSockets.some(s => s.id === socketId);
        
        if (socketExists) {
          // User is truly online, send confirmation
          socket.emit('user-online-status', {
            userName: data.userName,
            online: true,
            lastSeen: user.lastSeen || new Date().toISOString()
          });
          
          // Update user in database as online
          if (!user.online) {
            user.online = true;
            user.lastSeen = new Date();
            await user.save();
            
            // Broadcast user online status to all clients
            io.emit('user-online', { 
              userName: data.userName,
              timestamp: new Date().toISOString()
            });
          }
          
          console.log(`Confirmed ${data.userName} is online`);
          return;
        } else {
          // Socket doesn't exist but is in active map - cleanup
          activeUsers.delete(data.userName);
          user.online = false;
          user.lastSeen = new Date();
          await user.save();
        }
      }
      
      // Try to find any other socket for this user
      const allSockets = await io.fetchSockets();
      const userSocket = allSockets.find(s => {
        return s.handshake?.query?.userName === data.userName;
      });
      
      if (userSocket) {
        // Found a socket for this user - update active users map
        activeUsers.set(data.userName, userSocket.id);
        
        // Update user as online in database
        user.online = true;
        user.socketId = userSocket.id;
        user.lastSeen = new Date();
        await user.save();
        
        // Send online status
        socket.emit('user-online-status', {
          userName: data.userName,
          online: true,
          lastSeen: user.lastSeen
        });
        
        // Broadcast to all clients
        io.emit('user-online', { 
          userName: data.userName,
          timestamp: new Date().toISOString()
        });
        
        console.log(`Found socket for ${data.userName} and marked as online`);
        return;
      }
      
      // User is genuinely offline
      socket.emit('user-online-status', {
        userName: data.userName,
        online: false,
        lastSeen: user.lastSeen || new Date().toISOString()
      });
      
      console.log(`Confirmed ${data.userName} is offline`);
      
      // If the user was previously online in database, update to offline
      if (user.online) {
        user.online = false;
        user.lastSeen = new Date();
        await user.save();
        
        // Broadcast to all clients
        io.emit('user-offline', {
          userName: data.userName,
          lastSeen: user.lastSeen
        });
      }
    } catch (error) {
      console.error(`Error checking user online status: ${error.message}`);
      // Send offline status as fallback with properly structured data
      socket.emit('user-online-status', {
        userName: data.userName,
        online: false,
        lastSeen: new Date().toISOString(),
        error: error.message
      });
    }
  });

  // Handle verify-online-users event to check multiple users at once
  socket.on('verify-online-users', async (data) => {
    console.log(`Verifying online status for ${data.users.length} users, requested by ${data.requester}`);
    
    if (!data.users || !Array.isArray(data.users) || !data.requester) {
      return;
    }
    
    try {
      // Check each user's status against the activeUsers map
      const offlineUsers = [];
      
      for (const userName of data.users) {
        const isActive = activeUsers.has(userName);
        
        if (!isActive) {
          // User is shown as online but not in activeUsers map
          const user = await User.findOne({ userName });
          offlineUsers.push({
            userName,
            lastSeen: user?.lastSeen || new Date().toISOString()
          });
        }
      }
      
      // If we found any users that are actually offline, notify the requester
      if (offlineUsers.length > 0) {
        console.log(`Found ${offlineUsers.length} users incorrectly marked as online`);
        
        // Send specific updates to the requesting client
        for (const offlineUser of offlineUsers) {
          socket.emit('user-offline', offlineUser);
          
          // Also broadcast to all clients to ensure everyone has the correct status
          io.emit('user-offline', offlineUser);
        }
      }
    } catch (error) {
      console.error(`Error verifying online users: ${error.message}`);
    }
  });

  // Handle refresh user status
  socket.on('refresh-user-status', async (data) => {
    if (!data || !data.userName || !data.requester) {
      return;
    }
    
    try {
      console.log(`Refreshing status for user ${data.userName}, requested by ${data.requester}`);
      
      // Check if the user is in the active users list
      const isActive = activeUsers.has(data.userName);
      
      if (isActive) {
        // User is online, send or broadcast online status
        const user = await User.findOne({ userName: data.userName });
        
        if (user) {
          // Update the last seen time
          user.lastSeen = new Date();
          user.online = true;
          await user.save();
          
          // Broadcast to all clients
          io.emit('user-online', { 
            userName: data.userName,
            timestamp: new Date().toISOString()
          });
          
          // Update the socket ID if it's different
          if (user.socketId !== activeUsers.get(data.userName)) {
            user.socketId = activeUsers.get(data.userName);
            await user.save();
          }
        }
      } else {
        // User is not active, check if recently disconnected
        const user = await User.findOne({ userName: data.userName });
        
        if (user) {
          const lastSeenTime = user.lastSeen ? new Date(user.lastSeen) : null;
          const now = new Date();
          
          // If last seen is less than 2 minutes ago, consider them as having connectivity issues but still online
          if (lastSeenTime && (now - lastSeenTime) < 2 * 60 * 1000) {
            // User might have connection issues but was active recently
            // Try to find their actual socket if available
            const userSockets = await io.fetchSockets();
            const matchingSocket = userSockets.find(s => s.id === user.socketId);
            
            if (matchingSocket) {
              // Socket exists but user might have connection issues
              activeUsers.set(data.userName, user.socketId);
              
              // Update user as online
              user.online = true;
              await user.save();
              
              // Broadcast online status
              io.emit('user-online', { 
                userName: data.userName,
                timestamp: new Date().toISOString()
              });
            } else {
              // Socket doesn't exist anymore, but user was recently online
              // Update the user as offline
              io.emit('user-offline', {
                userName: data.userName,
                lastSeen: user.lastSeen
              });
            }
          } else {
            // User has been offline for a while, confirm offline status
            io.emit('user-offline', {
              userName: data.userName,
              lastSeen: user.lastSeen
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error refreshing user status: ${error.message}`);
    }
  });

  // Clean up listeners on unmount
  cleanupListeners(socket);
});

// Cleanup inactive users periodically (every hour)
setInterval(() => {
  cleanupInactiveUsers();
  console.log('Active users:', activeUsers.size);
}, 60 * 60 * 1000); 

// Cleanup old image files (older than 30 days) - run daily
setInterval(() => {
  try {
    console.log('Cleaning up old image files...');
    const now = Date.now();
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
    
    fs.readdir(uploadsDir, (err, files) => {
      if (err) {
        console.error('Error reading uploads directory:', err);
        return;
      }
      
      files.forEach(file => {
        const filePath = path.join(uploadsDir, file);
        fs.stat(filePath, (err, stats) => {
          if (err) {
            console.error(`Error getting stats for file ${file}:`, err);
            return;
          }
          
          const fileAge = now - stats.mtime.getTime();
          if (fileAge > maxAge) {
            fs.unlink(filePath, err => {
              if (err) {
                console.error(`Error deleting file ${file}:`, err);
                return;
              }
              console.log(`Deleted old file: ${file}`);
            });
          }
        });
      });
    });
  } catch (error) {
    console.error('Error in image cleanup:', error);
  }
}, 24 * 60 * 60 * 1000); // Run daily

// Memory cleanup every 15 minutes
setInterval(() => {
  // Clean up stale connection timestamps
  const now = Date.now();
  const connectionThreshold = 30 * 60 * 1000; // 30 minutes
  
  // Clean connection timestamps
  for (const [ip, timestamp] of connectionTimestamps.entries()) {
    if (now - timestamp > connectionThreshold) {
      connectionTimestamps.delete(ip);
    }
  }
  
  // Clean rate limit data
  for (const [user, data] of connectionLimits.rateLimitByIp.entries()) {
    // If all messages are older than the time window, remove the entry
    if (data.messages.every(msgTime => now - msgTime > connectionLimits.messageRateLimit.timeWindow)) {
      connectionLimits.rateLimitByIp.delete(user);
    }
  }
  
  // Reset performance stats every 24 hours
  if (now - performanceStats.startTime > 24 * 60 * 60 * 1000) {
    performanceStats.startTime = now;
    performanceStats.connections = 0;
    performanceStats.disconnections = 0;
    performanceStats.messagesSent = 0;
    performanceStats.messagesReceived = 0;
    performanceStats.errors = 0;
  }
  
  // Force garbage collection if available
  if (global.gc) {
    try {
      global.gc();
      console.log('Garbage collection executed');
    } catch (e) {
      console.error('Error during garbage collection:', e);
    }
  }
  
  console.log('Memory cleanup completed');
}, 15 * 60 * 1000);

// Set reasonable socket.io ping timeout to prevent ghost connections
io.engine.pingTimeout = 30000; // 30 seconds
io.engine.pingInterval = 5000; // 5 seconds

server.listen(5000, () => {
  console.log('Server listening on *:5000');
}); 