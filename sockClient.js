// client.js
import { io } from "socket.io-client";

// Helper to detect if we're on mobile
const isMobileDevice = () => {
  if (typeof window === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    window.navigator.userAgent
  );
};

// Get the current hostname and port for dynamic connections
const getServerUrl = () => {
  // Use window.location.hostname to get the current host (works on both desktop and mobile)
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  // Use port 5000 for the socket server
  return `http://${hostname}:5000`;
};

// Get the current user from local storage if available
const getCurrentUser = () => {
  if (typeof window === 'undefined') return null;
  try {
    const userData = localStorage.getItem('userData');
    if (userData) {
      const parsed = JSON.parse(userData);
      return parsed?.userName || null;
    }
  } catch (e) {
    console.error("Error getting current user:", e);
  }
  return null;
};

// Logging wrapper to avoid excessive logging on mobile
const logMessage = (type, message, data) => {
  // On mobile, only log errors
  if (isMobileDevice() && type !== 'error') return;
  
  switch (type) {
    case 'error':
      console.error(message, data);
      break;
    case 'warn':
      console.warn(message, data);
      break;
    default:
      console.log(message, data);
  }
};

// Create socket instance with optimized settings
const createSocket = () => {
  const socket = io(getServerUrl(), {
    reconnection: true,
    reconnectionAttempts: Infinity, // Try to reconnect indefinitely
    reconnectionDelay: 1000,
    reconnectionDelayMax: isMobileDevice() ? 10000 : 5000, // Longer max delay on mobile
    timeout: isMobileDevice() ? 30000 : 20000, // Longer timeout on mobile
    transports: ['websocket', 'polling'],
    autoConnect: true,
    forceNew: false, // Reuse existing connection
    // Include username in handshake query if available
    query: {
      userName: getCurrentUser()
    }
  });
  
  return socket;
};

// Create socket instance
const socket = createSocket();

// Add connection handling
let reconnectAttempts = 0;
let isReconnecting = false;
let reconnectTimer = null;

// Log the connection URL once
if (typeof window !== 'undefined') {
  logMessage('info', `Socket connecting to: ${getServerUrl()} as ${getCurrentUser() || 'anonymous'}`);
}

socket.on('connect', () => {
  if (isReconnecting) {
    logMessage('info', 'Reconnected to server');
    
    // Clear any pending reconnect timer
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }
  
  reconnectAttempts = 0;
  isReconnecting = false;
  
  // Update query with current username if needed
  const currentUser = getCurrentUser();
  if (currentUser && (!socket.io.opts.query || socket.io.opts.query.userName !== currentUser)) {
    socket.io.opts.query = { ...socket.io.opts.query, userName: currentUser };
    
    // Let the server know we're online
    socket.emit('user-online', currentUser);
  }
  
  // Set up regular pinging to maintain connection
  if (typeof window !== 'undefined' && currentUser) {
    // Clear any existing ping interval
    if (window.socketPingInterval) {
      clearInterval(window.socketPingInterval);
    }
    
    // Set up new ping interval
    window.socketPingInterval = setInterval(() => {
      if (socket.connected && currentUser) {
        socket.emit('ping-user', currentUser);
      }
    }, 30000); // Ping every 30 seconds
  }
});

socket.on('connect_error', (error) => {
  if (!isReconnecting) {
    logMessage('error', 'Connection error:', error.message);
    isReconnecting = true;
  }
  
  // If on mobile, and can't connect, show a more helpful message
  if (isMobileDevice() && reconnectAttempts === 0) {
    if (typeof window !== 'undefined' && window.alert) {
      window.alert(
        `Connection issue detected. Please ensure you're connecting to the correct server at ${getServerUrl()}`
      );
    }
  }
  
  reconnectAttempts++;
});

socket.on('disconnect', (reason) => {
  logMessage('warn', `Disconnected: ${reason}`);
  
  if (reason === 'io server disconnect') {
    // Server intentionally disconnected us, wait and reconnect
    reconnectTimer = setTimeout(() => {
      const currentUser = getCurrentUser();
      if (currentUser) {
        socket.io.opts.query = { ...socket.io.opts.query, userName: currentUser };
      }
      socket.connect();
    }, 3000);
  } else if (reason === 'transport close' || reason === 'ping timeout') {
    // Transport-level disconnection - try to reconnect faster
    reconnectTimer = setTimeout(() => {
      socket.connect();
    }, 1000);
  }
});

// Custom function to force reconnect and update user status
const forceReconnect = () => {
  if (socket.disconnected) {
    const currentUser = getCurrentUser();
    if (currentUser) {
      socket.io.opts.query = { ...socket.io.opts.query, userName: currentUser };
    }
    socket.connect();
  } else if (socket.connected) {
    // Already connected, just update user status
    const currentUser = getCurrentUser();
    if (currentUser) {
      socket.emit('user-online', currentUser);
    }
  }
};

// Detect if user regains focus/comes back online at the browser level
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    const currentUser = getCurrentUser();
    if (currentUser && socket.connected) {
      socket.emit('user-online', currentUser);
    } else {
      forceReconnect();
    }
  });
  
  window.addEventListener('online', () => {
    forceReconnect();
  });
}

// Update the socket query if the user logs in after socket creation
export const updateSocketUser = (userName) => {
  if (socket && socket.io && socket.io.opts && socket.io.opts.query) {
    socket.io.opts.query.userName = userName;
    logMessage('info', `Updated socket user to: ${userName}`);
    
    // If already connected, notify the server about the user change
    if (socket.connected) {
      socket.emit('user-online', userName);
    } else {
      // Not connected, try to reconnect
      socket.connect();
    }
  }
};

// Export the socket instance, update function, and force reconnect
export { forceReconnect };
export default socket;
