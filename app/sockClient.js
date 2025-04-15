import io from 'socket.io-client';

// Socket.io client instance 
let socket = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// Connection status 
let isConnected = false;
let hasInitialized = false;

// Event callbacks
const eventCallbacks = {};

export const initializeSocket = (userName) => {
  if (hasInitialized) return;
  
  hasInitialized = true;
  
  // If we already have a socket connection, clean it up first
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
  }
  
  // Create a new socket connection with optimized settings
  socket = io('/', {
    reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    autoConnect: true,
    query: { userName }
  });
  
  // Connection event handlers
  socket.on('connect', () => {
    console.log('Socket connected:', socket.id);
    isConnected = true;
    reconnectAttempts = 0;
    
    // Emit user-online event upon successful connection
    if (userName) {
      socket.emit('user-online', { userName });
      
      // Start the ping interval to maintain online status
      startPingInterval(userName);
    }
    
    // Notify all callbacks that we're connected
    if (eventCallbacks['connect']) {
      eventCallbacks['connect'].forEach(callback => callback());
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Socket disconnected');
    isConnected = false;
    
    // Notify all callbacks that we're disconnected
    if (eventCallbacks['disconnect']) {
      eventCallbacks['disconnect'].forEach(callback => callback());
    }
  });
  
  socket.on('connect_error', (error) => {
    console.error('Connection error:', error.message);
    reconnectAttempts++;
    
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`Failed to connect after ${MAX_RECONNECT_ATTEMPTS} attempts`);
      socket.disconnect();
      
      // Notify all callbacks about the connect error
      if (eventCallbacks['connect_error']) {
        eventCallbacks['connect_error'].forEach(callback => 
          callback({ attempts: reconnectAttempts, maxAttempts: MAX_RECONNECT_ATTEMPTS }));
      }
    }
  });
  
  return socket;
};

// Ping interval reference
let pingIntervalId = null;

// Start sending periodic pings to the server
const startPingInterval = (userName) => {
  // Clear any existing interval
  if (pingIntervalId) {
    clearInterval(pingIntervalId);
  }
  
  // Set up a new ping interval - ping every 45 seconds
  pingIntervalId = setInterval(() => {
    if (isConnected && userName) {
      socket.emit('ping-user', { userName });
    }
  }, 45000); // 45 seconds
};

// Clean up ping interval
export const stopPingInterval = () => {
  if (pingIntervalId) {
    clearInterval(pingIntervalId);
    pingIntervalId = null;
  }
};

// Add event listener
export const on = (event, callback) => {
  if (!eventCallbacks[event]) {
    eventCallbacks[event] = [];
  }
  
  eventCallbacks[event].push(callback);
  
  if (socket) {
    socket.on(event, callback);
  }
  
  return () => off(event, callback);
};

// Remove event listener
export const off = (event, callback) => {
  if (eventCallbacks[event]) {
    eventCallbacks[event] = eventCallbacks[event].filter(cb => cb !== callback);
  }
  
  if (socket) {
    socket.off(event, callback);
  }
};

// Emit an event
export const emit = (event, data) => {
  if (socket && isConnected) {
    socket.emit(event, data);
    return true;
  }
  return false;
};

// Get connection status
export const getConnectionStatus = () => ({
  isConnected,
  hasInitialized,
  socketId: socket ? socket.id : null
});

// Clean up socket connection
export const cleanup = () => {
  stopPingInterval();
  
  if (socket) {
    // Remove all listeners to prevent memory leaks
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  
  isConnected = false;
  hasInitialized = false;
  Object.keys(eventCallbacks).forEach(key => {
    eventCallbacks[key] = [];
  });
};

export default {
  initializeSocket,
  on,
  off,
  emit,
  getConnectionStatus,
  cleanup,
  stopPingInterval
}; 