"use client";
import React, { useState, useEffect, useRef } from "react";
import { getUsers } from "@/Database/actions";
import { useRouter } from "next/navigation";
import socket, { updateSocketUser } from "@/sockClient";
import Image from "next/image";
import EmojiPicker from "emoji-picker-react";
import Head from 'next/head';
import 'react-toastify/dist/ReactToastify.css';
import VideoChat from "@/app/components/VideoChat";
import { toast } from "react-hot-toast";

const ChatPage = () => {
  const [message, setMessage] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [onlineUsers, setOnline] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [genderFilter, setGenderFilter] = useState('all');
  const [regionFilter, setRegionFilter] = useState('all'); // Add state for region filter
  
  // Add new state variables for emoji picker and image upload
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  
  // Add new state for video calls
  const [showVideoCall, setShowVideoCall] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null);
  const [outgoingCall, setOutgoingCall] = useState(false);
  
  // Add state for notifications and sound settings
  const [notificationSound, setNotificationSound] = useState(true);
  
  const messageEndRef = useRef(null);
  const inputRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const fileInputRef = useRef(null);
  
  const router = useRouter();
  
  // Add state to track scroll position for showing/hiding the scroll button
  const [showScrollButton, setShowScrollButton] = useState(false);
  const messagesContainerRef = useRef(null);
  
  // Add a click outside handler for emoji picker
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target) && 
          !event.target.closest('[data-emoji-button="true"]')) {
        setShowEmojiPicker(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);
  
  // Load guest session
  useEffect(() => {
    const data = localStorage.getItem("guestSession");
    if (!data) {
      router.push("/");
    } else {
      setUserData(JSON.parse(data));
    }
    setIsLoading(false);
  }, [router]);

  // Add new state for session persistence
  const [sessionRefreshInterval, setSessionRefreshInterval] = useState(null);
  const [sessionLastActive, setSessionLastActive] = useState(Date.now());
  const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds
  
  // Store selected user in local storage for session persistence
  useEffect(() => {
    if (selectedUser) {
      localStorage.setItem("selectedChatUser", JSON.stringify({
        userName: selectedUser.userName,
        _id: selectedUser._id,
        timestamp: Date.now()
      }));
    }
  }, [selectedUser]);
  
  // Restore selected user from local storage on initial load
  useEffect(() => {
    if (!selectedUser && userData && onlineUsers.length > 0) {
      const savedChat = localStorage.getItem("selectedChatUser");
      
      if (savedChat) {
        try {
          const parsedChat = JSON.parse(savedChat);
          const timestamp = parsedChat.timestamp || 0;
          const now = Date.now();
          
          // Only restore if less than 1 hour old
          if (now - timestamp < 60 * 60 * 1000) {
            const foundUser = onlineUsers.find(u => u.userName === parsedChat.userName);
            if (foundUser) {
              console.log("Restoring chat with:", foundUser.userName);
              setSelectedUser(foundUser);
            }
          } else {
            // Clear outdated chat session
            localStorage.removeItem("selectedChatUser");
          }
        } catch (error) {
          console.error("Error restoring chat session:", error);
        }
      }
    }
  }, [userData, onlineUsers, selectedUser]);

  // Create a heartbeat system to maintain session
  useEffect(() => {
    if (!userData?.userName) return;
    
    const heartbeatInterval = setInterval(() => {
      const now = Date.now();
      
      // Check if user has been inactive, if active reset timer
      if (document.hasFocus()) {
        setSessionLastActive(now);
      }
      
      // If user has been inactive for too long, don't send heartbeat
      const timeSinceLastActive = now - sessionLastActive;
      if (timeSinceLastActive < SESSION_TIMEOUT) {
        // Send heartbeat to keep session alive
        socket.emit("heartbeat", {
          userName: userData.userName,
          lastActive: now
        });
      }
    }, 20000); // Send heartbeat every 20 seconds
    
    // Listen for user activity to reset the inactive timer
    const resetActivity = () => setSessionLastActive(Date.now());
    window.addEventListener('mousemove', resetActivity);
    window.addEventListener('keydown', resetActivity);
    window.addEventListener('click', resetActivity);
    window.addEventListener('touchstart', resetActivity);
    window.addEventListener('focus', resetActivity);
    
    // On window unload, try to notify server so it can set offline immediately
    const handleUnload = () => {
      try {
        const offlineEvent = new XMLHttpRequest();
        offlineEvent.open('POST', '/api/user-offline', false); // Synchronous request
        offlineEvent.setRequestHeader('Content-Type', 'application/json');
        offlineEvent.send(JSON.stringify({
          userName: userData.userName,
          timestamp: new Date().toISOString()
        }));
      } catch (e) {
        // Ignore errors on unload
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    
    setSessionRefreshInterval(heartbeatInterval);
    
    return () => {
      clearInterval(heartbeatInterval);
      window.removeEventListener('mousemove', resetActivity);
      window.removeEventListener('keydown', resetActivity);
      window.removeEventListener('click', resetActivity);
      window.removeEventListener('touchstart', resetActivity);
      window.removeEventListener('focus', resetActivity);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [userData, sessionLastActive]);

  // Get online users
  useEffect(() => {
    if (userData?.userName) {
      getOnlineData();
      
      // Create more aggressive polling for online status
      const fastPoll = setInterval(() => {
        // Fast polling only when the tab is visible 
        if (document.visibilityState === 'visible') {
          socket.emit('ping-user', userData.userName);
          
          // Request fresh data to update user statuses
          getOnlineData();
        }
      }, 15000); // Poll every 15 seconds when tab is visible
      
      // Create slower background polling
      const slowPoll = setInterval(() => {
        socket.emit('ping-user', userData.userName);
      }, 60000); // Slower ping every minute even when tab not visible
      
      // Refresh immediately when tab becomes visible
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          socket.emit('ping-user', userData.userName);
          getOnlineData();
          
          // If session is still valid, reconnect socket if needed
          const now = Date.now();
          const timeSinceLastActive = now - sessionLastActive;
          if (timeSinceLastActive < SESSION_TIMEOUT) {
            socket.emit('user-online', userData.userName);
          }
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);
      
      return () => {
        clearInterval(fastPoll);
        clearInterval(slowPoll);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [userData, sessionLastActive]);

  const getOnlineData = async (forceRefresh = false) => {
    if (userData?.userName) {
      try {
        // Only fetch if forced or if it's been more than 15 seconds since last fetch
        if (forceRefresh || !window.lastOnlineFetch || Date.now() - window.lastOnlineFetch > 15000) {
          window.lastOnlineFetch = Date.now();
          
          const users = await getUsers(userData);
          const initializedUsers = users.map(user => {
            // If we have existing data for this user
            const existingUser = onlineUsers.find(u => u.userName === user.userName);
            
            return {
              ...user,
              chatWindow: user.chatWindow || (existingUser?.chatWindow || []),
              // For online status, preserve existing if we just fetched recently (5 sec)
              online: existingUser && Date.now() - window.lastOnlineFetch < 5000 ? 
                     existingUser.online : !!user.online,
              // Use the more recent lastSeen time
              lastSeen: existingUser && new Date(existingUser.lastSeen) > new Date(user.lastSeen || 0) ?
                       existingUser.lastSeen : user.lastSeen
            };
          });
          
          // Additional logic for merging
          setOnline(prevUsers => {
            // Create a map of existing users to preserve data
            const prevUserMap = new Map();
            prevUsers.forEach(user => {
              prevUserMap.set(user.userName, user);
            });
            
            // For each new user, determine if we should keep existing data
            return initializedUsers.map(newUser => {
              const existingUser = prevUserMap.get(newUser.userName);
              
              if (!existingUser) return newUser;
              
              // Logic for merging offline users
              if (!newUser.online && !existingUser.online) {
                // Keep the most recent lastSeen timestamp
                const existingLastSeen = new Date(existingUser.lastSeen || 0);
                const newLastSeen = new Date(newUser.lastSeen || 0);
                
                if (existingLastSeen > newLastSeen) {
                  return {
                    ...newUser,
                    lastSeen: existingUser.lastSeen
                  };
                }
              }
              
              // If user was online in our existing data but offline in new data
              // Keep them online until we can verify with server
              if (existingUser.online && !newUser.online) {
                // Verify with server, but keep online in UI until confirmed
                socket.emit("check-user-online", {
                  userName: newUser.userName
                });
                
                return {
                  ...newUser,
                  online: true,
                  lastSeen: existingUser.lastSeen
                };
              }
              
              // Merge chat window data to avoid losing messages
              if (existingUser.chatWindow && existingUser.chatWindow.length > 0) {
                // Only update chatWindow in new user if existing has data
                if (!newUser.chatWindow || newUser.chatWindow.length === 0) {
                  return {
                    ...newUser,
                    chatWindow: existingUser.chatWindow
                  };
                }
                
                // Merge chat windows (avoiding duplicates)
                const existingMsgIds = new Set(existingUser.chatWindow.map(msg => msg.id));
                const newMsgs = newUser.chatWindow.filter(msg => !existingMsgIds.has(msg.id));
                
                return {
                  ...newUser,
                  chatWindow: [...existingUser.chatWindow, ...newMsgs]
                };
              }
              
              return newUser;
            });
          });
  
          // If we have a selected user, request to verify their status specifically
          if (selectedUser) {
            socket.emit("check-user-online", {
              userName: selectedUser.userName
            });
          }
          
          // Verify all users that are marked as online
          const onlineUserNames = initializedUsers
            .filter(user => user.online === true)
            .map(user => user.userName);
            
          if (onlineUserNames.length > 0) {
            socket.emit("verify-online-users", {
              users: onlineUserNames,
              requester: userData.userName
            });
          }
        }
      } catch (error) {
        console.error("Error fetching users:", error);
      }
    }
  };

  // Scroll to bottom of messages
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedUser?.chatWindow]);

  // Socket listeners
  useEffect(() => {
    if (!userData?.userName) return;
    
    // Tell the server we're online when component mounts
    socket.emit('user-online', userData.userName);
    
    // Main events for user updates
    socket.on("userUpdate", getOnlineData);
    socket.on("UserDeleted", getOnlineData);

    // Handle user status updates
    socket.on('user-online', (data) => {
      console.log('User online:', data.userName);
      setOnline(prev => {
        const newUsers = [...prev];
        const userIndex = newUsers.findIndex(u => u.userName === data.userName);
        
        if (userIndex !== -1) {
          newUsers[userIndex] = {
            ...newUsers[userIndex],
            online: true
          };
        }
        
        return newUsers;
      });
    });
    
    socket.on('user-offline', (data) => {
      console.log('User offline:', data.userName);
      
      // Immediate UI update for offline status
      setOnline(prev => {
        const newUsers = [...prev];
        const userIndex = newUsers.findIndex(u => u.userName === data.userName);
        
        if (userIndex !== -1) {
          // Create a timestamp for this offline event
          const offlineTimestamp = data.lastSeen || new Date().toISOString();
          
          newUsers[userIndex] = {
            ...newUsers[userIndex],
            online: false,
            lastSeen: offlineTimestamp
          };
          
          // If this is the selected user, update that reference too
          if (selectedUser && selectedUser.userName === data.userName) {
            setSelectedUser(prev => ({
              ...prev,
              online: false,
              lastSeen: offlineTimestamp
            }));
          }
        }
        
        return newUsers;
      });
      
      // Force a data refresh to confirm status
      setTimeout(() => getOnlineData(true), 3000);
    });
    
    // Handle updates to the user's own data
    socket.on('self-update', (updatedUserData) => {
      console.log('Self update received:', updatedUserData);
      if (updatedUserData.userName === userData.userName) {
        // Update our local data
        localStorage.setItem("guestSession", JSON.stringify(updatedUserData));
        setUserData(updatedUserData);
      }
    });
    
    // Handle updates to conversation partners
    socket.on('conversation-update', (updatedUserData) => {
      console.log('Conversation update received:', updatedUserData);
      
      // Update the specific user in our list
      setOnline(prev => {
        const newUsers = [...prev];
        const userIndex = newUsers.findIndex(u => u.userName === updatedUserData.userName);
        
        if (userIndex !== -1) {
          newUsers[userIndex] = {
            ...newUsers[userIndex],
            ...updatedUserData
          };
        } else {
          // If user doesn't exist in our list (rare case), add them
          newUsers.push(updatedUserData);
        }
        
        return newUsers;
      });
      
      // If this is the currently selected user, update that reference too
      if (selectedUser && selectedUser.userName === updatedUserData.userName) {
        setSelectedUser(updatedUserData);
      }
    });
    
    // Handle sent message confirmations
    socket.on('message-sent', (response) => {
      console.log('Message sent confirmation:', response);
      if (!response.success) {
        console.error('Failed to send message:', response.error);
        // Could show an error message to the user here
        return;
      }
    });
    
    // Handle incoming messages
    socket.on('receive-message', (messageData) => {
      console.log('Message received:', messageData);
      
      // Only process if the message is meant for this user
      if (messageData.to !== userData.userName) {
        console.log('Ignoring message not meant for this user');
        return;
      }
      
      // Optimize state updates for better performance
      requestAnimationFrame(() => {
        // Update the user in our list who sent this message
        setOnline(prev => {
          const newUsers = [...prev];
          const userIndex = newUsers.findIndex(user => user.userName === messageData.user);
          
          if (userIndex !== -1) {
            // Avoid deep clone for better performance if possible
            const updatedUser = {...newUsers[userIndex]};
            
            // Initialize chat window if not exist
            if (!updatedUser.chatWindow) {
              updatedUser.chatWindow = [];
            } else {
              // Use slice for shallow copy of array
              updatedUser.chatWindow = updatedUser.chatWindow.slice();
            }
            
            // Check if message already exists to avoid duplicates
            const messageExists = updatedUser.chatWindow.some(m => m.id === messageData.id);
            if (!messageExists) {
              updatedUser.chatWindow.push(messageData);
              newUsers[userIndex] = updatedUser;
              
              // If this user is currently selected, also update the selectedUser state
              if (selectedUser?.userName === messageData.user) {
                // Debounce selectedUser updates for better performance
                setTimeout(() => {
                  setSelectedUser(updatedUser);
                }, 10);
                
                // Mark messages as read if this user is the selected one
                markMessagesAsRead(messageData.user);
              }
            }
          }
          
          return newUsers;
        });
      });
      
      // Play notification sound if not currently viewing this conversation
      if (!selectedUser || selectedUser.userName !== messageData.user) {
        // Check if this is an image message for special notification
        if (notificationSound) {
          try {
            const audio = new Audio('/Biscay_Essential_PH-1_Stock_Notification-642959-mobiles24.mp3');
            audio.play().catch(e => console.log('Audio play prevented by browser policy'));
          } catch (error) {
            console.error('Error playing notification sound:', error);
          }
        }
      }
    });

    // Add video call event listeners
    socket.on("call-user", handleIncomingCall);
    socket.on("call-signal", handleCallSignal);

    // Clean up listeners on unmount
    return () => {
      socket.off("userUpdate");
      socket.off("UserDeleted");
      socket.off("user-online");
      socket.off("user-offline");
      socket.off("self-update");
      socket.off("conversation-update");
      socket.off("message-sent");
      socket.off("receive-message");
      
      // Remove video call listeners
      socket.off("call-user");
      socket.off("call-signal");
    };
  }, [userData, selectedUser]);

  // Create a debounced version of markMessagesAsRead
  const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  };
  
  // Create a map of debounced functions for each user
  const debouncedMarkReadFuncs = {};
  
  // Function to mark messages as read
  const markMessagesAsRead = (fromUser) => {
    if (!userData || !fromUser) return;
    
    console.log(`Marking messages from ${fromUser} as read`);
    
    // Create or get a debounced function for this user
    if (!debouncedMarkReadFuncs[fromUser]) {
      debouncedMarkReadFuncs[fromUser] = debounce((user) => {
        console.log(`Sending read receipts for ${user}`);
        socket.emit('mark-messages-read', {
          from: user,
          to: userData.userName
        });
        
        // Play a subtle read notification sound
        try {
          const audio = new Audio('/mark-read-sound.mp3');
          audio.volume = 0.2; // Quieter than message notification
          audio.play().catch(e => console.log('Audio play prevented by browser policy'));
        } catch (error) {
          console.error('Error playing read sound:', error);
        }
        
        // Also update the local state to immediately reflect read status
        setOnline(prev => {
          const newUsers = [...prev];
          const userIndex = newUsers.findIndex(u => u.userName === user);
          
          if (userIndex !== -1) {
            const updatedUser = JSON.parse(JSON.stringify(newUsers[userIndex]));
            if (updatedUser.chatWindow) {
              // Mark any messages from this user to the current user as read
              let hasUnreadMessages = false;
              updatedUser.chatWindow = updatedUser.chatWindow.map(msg => {
                if (msg.user === user && msg.to === userData.userName && !msg.read) {
                  hasUnreadMessages = true;
                  return { ...msg, read: true };
                }
                return msg;
              });
              
              // Only update if there were actually unread messages
              if (hasUnreadMessages) {
                newUsers[userIndex] = updatedUser;
                
                // If this is the selected user, update that reference too
                if (selectedUser && selectedUser.userName === user) {
                  setSelectedUser(updatedUser);
                }
                
                return [...newUsers];
              }
            }
          }
          
          return prev;
        });
      }, 300); // 300ms debounce time
    }
    
    // Call the debounced function
    debouncedMarkReadFuncs[fromUser](fromUser);
  };

  // Mark messages as read when selecting a user
  useEffect(() => {
    if (selectedUser && userData) {
      // Mark all messages from this user as read
      markMessagesAsRead(selectedUser.userName);
      
      // Update local state to mark messages as read
      setOnline(prev => {
        const newUsers = [...prev];
        const userIndex = newUsers.findIndex(u => u.userName === selectedUser.userName);
        
        if (userIndex !== -1) {
          const updatedUser = JSON.parse(JSON.stringify(newUsers[userIndex]));
          if (updatedUser.chatWindow) {
            updatedUser.chatWindow = updatedUser.chatWindow.map(msg => 
              !isMessageFromMe(msg) ? { ...msg, read: true } : msg
            );
          }
          newUsers[userIndex] = updatedUser;
        }
        
        return newUsers;
      });
      
      // Focus on input field when selecting a user
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [selectedUser, userData]);

  // Generate avatar based on username and gender
  const getAvatar = (username, gender) => {
    if (!username) return null;
    
    // Get the first 2 letters (or just 1 if username is only 1 character)
    const initials = username.slice(0, 2).toUpperCase();
    
    // Create different background colors based on gender
    let bgColor, textColor;
    if (gender && gender.toLowerCase() === 'female') {
      // Female color scheme - purple/pink gradient
      bgColor = 'linear-gradient(135deg, #9733EE 0%, #DA22FF 100%)';
      textColor = '#ffffff';
    } else {
      // Male color scheme - blue gradient
      bgColor = 'linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)';
      textColor = '#ffffff';
    }
    
    // Create a data URI for the avatar
    return `data:image/svg+xml,${encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${gender && gender.toLowerCase() === 'female' ? '#9733EE' : '#2193b0'}" />
            <stop offset="100%" stop-color="${gender && gender.toLowerCase() === 'female' ? '#DA22FF' : '#6dd5ed'}" />
          </linearGradient>
        </defs>
        <rect width="100" height="100" fill="url(#grad)" />
        <text x="50" y="50" dy="0.35em" 
          font-family="Arial, sans-serif" 
          font-size="40" 
          font-weight="bold" 
          text-anchor="middle" 
          fill="${textColor}">
          ${initials}
        </text>
      </svg>
    `)}`;
  };

  // Filter and sort users based on gender and region
  const getFilteredUsers = () => {
    // First apply gender filter
    let filteredUsers = onlineUsers;
    if (genderFilter !== 'all') {
      filteredUsers = filteredUsers.filter(user => 
        user.Gender && user.Gender.toLowerCase() === genderFilter.toLowerCase()
      );
    }
    
    // Then apply region filter if not set to 'all'
    if (regionFilter !== 'all') {
      filteredUsers = filteredUsers.filter(user => 
        user.region && user.region.toLowerCase() === regionFilter.toLowerCase()
      );
    }
    
    // If no region filter is applied, sort users to prioritize those from the same region as current user
    if (regionFilter === 'all' && userData?.region && userData.region !== 'Unknown') {
      filteredUsers.sort((a, b) => {
        // Users from same region as current user go first
        const aFromSameRegion = a.region && a.region.toLowerCase() === userData.region.toLowerCase();
        const bFromSameRegion = b.region && b.region.toLowerCase() === userData.region.toLowerCase();
        
        if (aFromSameRegion && !bFromSameRegion) return -1;
        if (!aFromSameRegion && bFromSameRegion) return 1;
        
        // Users from same country but different region go next
        if (userData.country && userData.country !== 'Unknown') {
          const aFromSameCountry = a.country && a.country.toLowerCase() === userData.country.toLowerCase();
          const bFromSameCountry = b.country && b.country.toLowerCase() === userData.country.toLowerCase();
          
          if (aFromSameCountry && !bFromSameCountry) return -1;
          if (!aFromSameCountry && bFromSameCountry) return 1;
        }
        
        // Then prioritize online users
        if (a.online && !b.online) return -1;
        if (!a.online && b.online) return 1;
        
        return 0;
      });
    }
    
    return filteredUsers;
  };

  // Add this function before handleSendMessage
  const verifyUserExists = async () => {
    if (!userData) return false;
    
    try {
      console.log("Verifying user exists in database:", userData.userName);
      
      // Get geolocation data if not already present
      if (!userData.country || !userData.region) {
        try {
          const geoResponse = await fetch('https://ipapi.co/json/');
          const geoData = await geoResponse.json();
          
          // Update userData with location information
          userData.country = geoData.country_name || 'Unknown';
          userData.region = geoData.region || 'Unknown';
          
          // Save updated userData to localStorage
          localStorage.setItem("guestSession", JSON.stringify(userData));
          
          console.log(`Updated location data: ${userData.country}, ${userData.region}`);
        } catch (geoError) {
          console.error("Error getting location data:", geoError);
          // Default values if location fetch fails
          userData.country = userData.country || 'Unknown';
          userData.region = userData.region || 'Unknown';
        }
      }
      
      // Get the base URL dynamically from the current window location
      const getBaseUrl = () => {
        if (typeof window !== 'undefined') {
          const { protocol, hostname, port } = window.location;
          // If we're on localhost, use port 5000 for the API
          if (hostname === 'localhost') {
            return `${protocol}//${hostname}:5000`;
          }
          // Use the same origin for other hosts (including IP addresses)
          return `${protocol}//${hostname}${port ? ':' + port : ''}`;
        }
        return '';
      };
      
      // First check if socket is connected - reconnect if needed
      if (!socket.connected) {
        console.log("Socket not connected, attempting to reconnect...");
        socket.connect();
        
        // Wait for connection
        await new Promise((resolve) => {
          const timeout = setTimeout(() => resolve(false), 3000);
          
          socket.once('connect', () => {
            clearTimeout(timeout);
            resolve(true);
          });
        });
        
        if (!socket.connected) {
          console.error("Failed to reconnect socket");
          return false;
        }
      }
      
      // Check if user exists in database using dynamic URL
      const apiBaseUrl = getBaseUrl();
      console.log("Using API base URL:", apiBaseUrl);
      
      try {
        const response = await fetch(`${apiBaseUrl}/check-user?userName=${userData.userName}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        const data = await response.json();
        
        // If user doesn't exist, recreate user using socket
        if (!data.exists) {
          console.log("User doesn't exist in database, recreating via socket...", userData);
          
          // Ensure all required fields are present
          const completeUserData = {
            ...userData,
            // Ensure required fields are included even if they weren't stored
            userName: userData.userName,
            Age: userData.Age || 25, // Default age if missing
            Gender: userData.Gender || 'Not specified', // Default gender if missing
            socketId: socket.id, // Ensure the socket ID is set
            online: true,
            country: userData.country || 'Unknown',
            region: userData.region || 'Unknown',
            lastSeen: new Date().toISOString()
          };
          
          // Save the complete user data to localStorage to prevent future issues
          localStorage.setItem("guestSession", JSON.stringify(completeUserData));
          
          // Try socket reconnection with retry mechanism
          return new Promise((resolve) => {
            let attempts = 0;
            const maxAttempts = 2;
            
            const attemptReconnect = () => {
              attempts++;
              console.log(`Reconnection attempt ${attempts} of ${maxAttempts}`);
              
              // Set up one-time listener for reconnect confirmation
              const reconnectListener = (response) => {
                console.log("Reconnect response:", response);
                socket.off('reconnect-confirmed', reconnectListener);
                
                if (response.success) {
                  // Ping again to ensure we're marked online
                  socket.emit('user-online', userData.userName);
                  resolve(true);
                } else {
                  if (attempts < maxAttempts) {
                    setTimeout(attemptReconnect, 1000);
                  } else {
                    resolve(false);
                  }
                }
              };
              
              // Listen for confirmation
              socket.on('reconnect-confirmed', reconnectListener);
              
              // Send reconnect request with all user data including location
              socket.emit('user-reconnect', completeUserData);
              
              // Set a timeout for this attempt
              setTimeout(() => {
                socket.off('reconnect-confirmed', reconnectListener);
                
                if (attempts < maxAttempts) {
                  attemptReconnect();
                } else {
                  console.warn("Reconnect timed out, attempting fallback API call");
                  
                  // Fallback to REST API if socket times out
                  fetch(`${apiBaseUrl}/recreate-user`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(completeUserData),
                  })
                  .then(res => res.json())
                  .then(data => {
                    if (data.success) {
                      socket.emit('user-online', completeUserData);
                      resolve(true);
                    } else {
                      console.error("User recreation failed:", data);
                      resolve(false);
                    }
                  })
                  .catch(err => {
                    console.error("Fallback failed:", err);
                    resolve(false);
                  });
                }
              }, 3000);
            };
            
            attemptReconnect();
          });
        }
        
        // User exists, send a ping to refresh the connection
        socket.emit('ping-user', userData.userName);
        socket.emit('user-online', userData.userName);
        
        return true;
      } catch (fetchError) {
        console.error("Error checking user in database:", fetchError);
        
        // Try socket-based verification as fallback
        return new Promise((resolve) => {
          const checkListener = (response) => {
            socket.off('user-exists-response', checkListener);
            resolve(response.exists);
          };
          
          socket.on('user-exists-response', checkListener);
          socket.emit('check-user-exists', { userName: userData.userName });
          
          setTimeout(() => {
            socket.off('user-exists-response', checkListener);
            resolve(false);
          }, 3000);
        });
      }
    } catch (error) {
      console.error("Error verifying user exists:", error);
      return false;
    }
  };

  // Add a function to show safety disclaimers
  const showSafetyDisclaimer = (actionType) => {
    const hasShownMessageDisclaimer = localStorage.getItem('hasShownMessageDisclaimer');
    const hasShownVideoDisclaimer = localStorage.getItem('hasShownVideoDisclaimer');
    
    if (actionType === 'message' && !hasShownMessageDisclaimer) {
      toast((t) => (
        <div className="p-2">
          <h3 className="font-bold text-red-600 mb-1">⚠️ Safety Alert</h3>
          <p className="text-sm mb-2">Remember: You are chatting with strangers. For your safety:</p>
          <ul className="text-xs list-disc pl-4 mb-2">
            <li>DO NOT share personal information (address, phone, financial details)</li>
            <li className="font-semibold">DO NOT share personal photos or explicit images</li>
            <li>The platform is NOT responsible for any shared content</li>
            <li>Images shared cannot be fully deleted once sent</li>
            <li>Report inappropriate behavior immediately</li>
          </ul>
          <div className="text-right">
            <button 
              onClick={() => {
                localStorage.setItem('hasShownMessageDisclaimer', 'true');
                toast.dismiss(t.id);
              }}
              className="bg-blue-500 text-white px-2 py-1 rounded text-xs"
            >
              I understand
            </button>
          </div>
        </div>
      ), { duration: 10000 });
    }
    
    if (actionType === 'video' && !hasShownVideoDisclaimer) {
      toast((t) => (
        <div className="p-2">
          <h3 className="font-bold text-red-600 mb-1">⚠️ Video Call Warning</h3>
          <p className="text-sm mb-2">Before starting a video call with a stranger:</p>
          <ul className="text-xs list-disc pl-4 mb-2">
            <li>Be aware of what's visible in your background</li>
            <li>DO NOT share sensitive personal information</li>
            <li>Inappropriate behavior may be reported and result in a ban</li>
            <li>The developer is not responsible for any negative experiences</li>
          </ul>
          <div className="text-right">
            <button 
              onClick={() => {
                localStorage.setItem('hasShownVideoDisclaimer', 'true');
                toast.dismiss(t.id);
              }}
              className="bg-blue-500 text-white px-2 py-1 rounded text-xs"
            >
              I understand
            </button>
          </div>
        </div>
      ), { duration: 15000 });
    }
  };

  // Handle sending messages
  const handleSendMessage = async (e) => {
    e.preventDefault();
    const trimmedMessage = message.trim();
    if ((trimmedMessage === "" && !imageFile) || !selectedUser || !userData) return;
    
    // Show safety disclaimer for messaging
    showSafetyDisclaimer('message');

    // Verify user exists in database before sending message
    try {
      const userExists = await verifyUserExists();
      if (!userExists) {
        toast.error("There was an issue with your session. Attempting to reconnect...");
        
        // Try to recreate the session one more time
        const secondAttempt = await verifyUserExists();
        if (!secondAttempt) {
          toast.error("Session could not be restored. Please refresh the page and try again.");
          return;
        } else {
          toast.success("Session restored. Continuing with your message.");
        }
      }

      const timestamp = new Date().toISOString();
      let imageUrl = null;
      
      // Create a unique ID for this message early
      const messageId = `${userData.userName}_${Date.now()}`;
      
      // Create optimistic message early
      const createNewMessage = (imgUrl) => ({
        user: userData.userName,
        to: selectedUser.userName,
        message: trimmedMessage,
        imageUrl: imgUrl,
        timestamp: timestamp,
        id: messageId
      });
      
      // Optimistically update UI immediately for better UX
      const optimisticUpdate = () => {
        const optimisticMessage = {...createNewMessage(imageUrl), read: true};
        
        // Update both users as online locally - this ensures UI stays consistent
        setOnline(prev => {
          const newUsers = [...prev];
          
          // Update selected user as online
          const selectedUserIndex = newUsers.findIndex(u => u.userName === selectedUser.userName);
          if (selectedUserIndex !== -1) {
            newUsers[selectedUserIndex] = {
              ...newUsers[selectedUserIndex],
              online: true,
              lastSeen: new Date().toISOString()
            };
          }
          
          // Also ensure current user is online
          const currentUserIndex = newUsers.findIndex(u => u.userName === userData.userName);
          if (currentUserIndex !== -1) {
            newUsers[currentUserIndex] = {
              ...newUsers[currentUserIndex],
              online: true,
              lastSeen: new Date().toISOString()
            };
          }
          
          return newUsers;
        });
        
        // Update selected user as online specifically
        setSelectedUser(prev => ({
          ...prev,
          online: true,
          lastSeen: new Date().toISOString()
        }));
        
        // Update chat window with new message
        setOnline(prev => {
          const newUsers = [...prev];
          const userIndex = newUsers.findIndex(u => u.userName === selectedUser.userName);
          
          if (userIndex !== -1) {
            const updatedUser = JSON.parse(JSON.stringify(newUsers[userIndex]));
            if (!updatedUser.chatWindow) updatedUser.chatWindow = [];
            updatedUser.chatWindow.push(optimisticMessage);
            newUsers[userIndex] = updatedUser;
            
            // Also update the selectedUser reference
            setSelectedUser(updatedUser);
          }
          
          return newUsers;
        });
        
        // Clear input
        setMessage("");
        
        // Scroll to new message
        setTimeout(() => {
          messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 100);
      };
      
      // Upload image if exists
      if (imageFile) {
        setIsUploading(true);
        try {
          // Create a FormData object to send the file
          const formData = new FormData();
          formData.append('image', imageFile);
          
          console.log('Uploading image:', imageFile.name);
          
          // Server endpoint to handle image uploads
          const response = await fetch('http://localhost:5000/upload', {
            method: 'POST',
            body: formData,
            mode: 'cors',
            credentials: 'omit',
            headers: {
              'Accept': 'application/json',
            }
          });
          
          console.log('Upload response status:', response.status);
          
          if (!response.ok) {
            const errorText = await response.text();
            console.error('Upload response error:', errorText);
            throw new Error(`Failed to upload image: ${response.status} ${errorText}`);
          }
          
          const data = await response.json();
          console.log('Upload successful:', data);
          imageUrl = data.imageUrl;
          
          // Update UI optimistically after successful upload
          optimisticUpdate();
          
          // Send message to server with retry logic
          sendMessageWithRetry(createNewMessage(imageUrl));
        } catch (error) {
          console.error('Error uploading image:', error);
          alert('Failed to upload image. Please try again.');
        } finally {
          setIsUploading(false);
          setImageFile(null);
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
        }
      } else {
        // No image, send text message directly
        optimisticUpdate();
        
        // Emit message to server with retry logic
        sendMessageWithRetry(createNewMessage(null));
      }
      
      // Focus back on input
      inputRef.current?.focus();
    } catch (error) {
      console.error("Error sending message:", error);
      toast.error("Failed to send message. Please try again.");
    }
  };

  // Add retry logic for sending messages
  const sendMessageWithRetry = (messageData, attempts = 0) => {
    const maxAttempts = 3;
    const retryDelay = 1000; // 1 second

    socket.emit("send-message", messageData);
    
    // Listen for message sent confirmation
    const messageConfirmationListener = (response) => {
      if (response.messageId === messageData.id) {
        // Success, remove listener
        socket.off('message-sent', messageConfirmationListener);
      } else if (!response.success && attempts < maxAttempts) {
        console.log(`Retrying message send, attempt ${attempts + 1} of ${maxAttempts}`);
        setTimeout(() => {
          sendMessageWithRetry(messageData, attempts + 1);
        }, retryDelay * (attempts + 1)); // Exponential backoff
      } else if (!response.success) {
        console.error('Failed to send message after multiple attempts:', response.error);
        alert('Message could not be delivered. Please try again later.');
      }
    };
    
    // Add listener for this specific message
    socket.on('message-sent', messageConfirmationListener);
    
    // Set a timeout to clean up the listener if no response
    setTimeout(() => {
      socket.off('message-sent', messageConfirmationListener);
    }, 10000); // 10 seconds timeout
  };

  // Helper to determine if a message is from the current user
  const isMessageFromMe = (msg) => {
    if (!msg || !userData) return false;
    return msg.user === userData?.userName;
  };

  // Format time for display
  const formatMessageTime = (timestamp) => {
    try {
      return new Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return '';
    }
  };

  // Format last seen time safely
  const formatLastSeen = (timestamp) => {
    if (!timestamp) return 'Unknown';
    
    try {
      const userLastSeen = new Date(timestamp);
      
      // Check if the date is valid
      if (isNaN(userLastSeen.getTime())) {
        console.warn("Invalid timestamp:", timestamp);
        return 'Unknown';
      }
      
      const now = new Date();
      
      // Calculate difference in milliseconds
      const msDiff = now - userLastSeen;
      const secondsDiff = Math.floor(msDiff / 1000);
      
      // If user was active in the last 30 seconds, show as "Online"
      if (secondsDiff < 30) return 'Online';
      
      const minutesDiff = Math.floor(secondsDiff / 60);
      const hoursDiff = Math.floor(minutesDiff / 60);
      const daysDiff = Math.floor(hoursDiff / 24);
      
      // Format based on how long ago
      if (secondsDiff < 60) return 'Just now';
      if (minutesDiff < 60) return `${minutesDiff} minute${minutesDiff !== 1 ? 's' : ''} ago`;
      if (hoursDiff < 24) return `${hoursDiff} hour${hoursDiff !== 1 ? 's' : ''} ago`;
      if (daysDiff < 7) return `${daysDiff} day${daysDiff !== 1 ? 's' : ''} ago`;
      
      // Fall back to date string for older dates
      return userLastSeen.toLocaleDateString();
    } catch (error) {
      console.error('Error formatting timestamp:', error);
      return 'Unknown';
    }
  };

  // Get unread message count
  const getUnreadCount = (user) => {
    if (!user || !user.chatWindow) return 0;
    return user.chatWindow.filter(msg => !isMessageFromMe(msg) && !msg.read).length;
  };

  // Enhanced getUnreadCount function to return object with count and latest message
  const getUnreadMessageInfo = (user) => {
    if (!user || !user.chatWindow) return { count: 0, latestMessage: null };
    
    const unreadMessages = user.chatWindow.filter(msg => !isMessageFromMe(msg) && !msg.read);
    const count = unreadMessages.length;
    const latestMessage = count > 0 ? unreadMessages[unreadMessages.length - 1] : null;
    
    return { count, latestMessage };
  };

  // Memoize expensive operations like conversation filtering
  const getConversation = React.useCallback(() => {
    if (!selectedUser?.chatWindow || !userData) return [];
    
    return selectedUser.chatWindow.filter(msg => 
      // Only show messages between the current user and selected user
      (msg.user === userData.userName && msg.to === selectedUser.userName) || 
      (msg.user === selectedUser.userName && msg.to === userData.userName)
    );
  }, [selectedUser?.chatWindow, userData?.userName, selectedUser?.userName]);
  
  // Virtualize the message list to improve performance with large conversations
  const renderMessages = () => {
    if (!selectedUser) return null;
    
    const conversation = getConversation();
    if (!conversation || conversation.length === 0) return null;
    
    // Only render the last 50 messages for better performance
    const messagesToRender = conversation.length > 50 
      ? conversation.slice(conversation.length - 50) 
      : conversation;
    
    return messagesToRender.map((msg, index) => {
      if (!msg) return null;
      
      const isMe = isMessageFromMe(msg);
      const bubbleClass = isMe
        ? "bg-gradient-to-r from-blue-500 to-indigo-600 text-white chat-bubble-out ml-auto"
        : "bg-white text-gray-700 chat-bubble-in";
        
      return (
        <div
          key={msg.id || index}
          className={`flex ${isMe ? "justify-end" : "justify-start"} mb-4`}
        >
          {!isMe && selectedUser && (
            <div className="mr-2 min-w-[36px]">
              <img
                src={getAvatar(msg.user, selectedUser?.Gender)}
                alt={msg.user || "User"}
                className="w-9 h-9 rounded-full object-cover"
              />
            </div>
          )}
          <div
            className={`max-w-xs lg:max-w-md px-4 py-3 ${bubbleClass}`}
          >
            <p className="text-sm">{msg.message}</p>
            {msg.imageUrl && (
              <div className="mt-2 mb-2">
                <img 
                  src={msg.imageUrl} 
                  alt="Shared image" 
                  className="rounded-lg max-w-full max-h-60 object-contain cursor-pointer"
                  onClick={() => window.open(msg.imageUrl, '_blank')}
                  loading="lazy" // Add lazy loading for images
                />
              </div>
            )}
            <div className="flex items-center justify-end mt-1 space-x-1">
              <span
                className={`text-xs ${
                  isMe ? "text-blue-100" : "text-gray-500"
                }`}
              >
                {formatMessageTime(msg.timestamp)}
              </span>
              {isMe && (
                <span className={`text-xs ${isMe ? "text-blue-100" : "text-gray-400"}`}>
                  {msg.read ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M10 2a8 8 0 100 16 8 8 0 000 16zm0 14a6 6 0 110-12 6 6 0 010 12z" />
                    </svg>
                  )}
                </span>
              )}
            </div>
          </div>
          {isMe && userData && (
            <div className="ml-2 min-w-[36px]">
              <img
                src={getAvatar(userData.userName, userData?.Gender)}
                alt={userData.userName || "You"}
                className="w-9 h-9 rounded-full object-cover"
              />
            </div>
          )}
        </div>
      );
    });
  };

  // Add emoji handler
  const handleEmojiClick = (emojiObj) => {
    const emoji = emojiObj.emoji;
    const cursorPosition = inputRef.current.selectionStart;
    const textBeforeCursor = message.slice(0, cursorPosition);
    const textAfterCursor = message.slice(cursorPosition);
    
    setMessage(textBeforeCursor + emoji + textAfterCursor);
    
    // Set cursor position after inserted emoji
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        const newCursorPosition = cursorPosition + emoji.length;
        inputRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
      }
    }, 10);
    
    // Hide emoji picker after selection
    setShowEmojiPicker(false);
  };

  // File input handler with improved mobile support
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Check if file is an image
    if (!file.type.match('image.*')) {
      toast.error('Only image files are supported');
      return;
    }
    
    // Check file size (limit to 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image size exceeds 5MB limit');
      return;
    }
    
    // Set the image file immediately so it can be processed
    setImageFile(file);
    
    // Always show a safety warning when an image is selected
    // Use a more prominent toast that stays visible longer
    toast.custom(
      (t) => (
        <div className={`${
          t.visible ? 'animate-enter' : 'animate-leave'
        } max-w-md w-full bg-white shadow-lg rounded-lg pointer-events-auto flex ring-1 ring-black ring-opacity-5`}>
          <div className="w-full p-4 border-l-4 border-yellow-500 bg-yellow-50">
            <div className="flex items-start">
              <div className="flex-shrink-0 pt-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="ml-3 w-0 flex-1">
                <h3 className="font-bold text-red-600 text-sm">⚠️ Image Safety Warning</h3>
                <p className="mt-1 text-sm text-gray-800">For your safety when sharing images:</p>
                <ul className="mt-1 text-xs list-disc pl-4 text-gray-800">
                  <li className="font-bold text-red-600">DO NOT share personal photos or explicit content</li>
                  <li>Remember you're chatting with someone you don't know in person</li>
                  <li>Images are stored on servers and cannot be fully deleted</li>
                  <li>Other users may download or screenshot your images</li>
                </ul>
                <div className="mt-2 flex">
                  <button
                    onClick={() => toast.dismiss(t.id)}
                    className="inline-flex items-center px-2 py-1 border border-transparent text-xs font-medium rounded text-indigo-700 bg-indigo-100 hover:bg-indigo-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                  >
                    I understand
                  </button>
                </div>
              </div>
              <div className="ml-4 flex-shrink-0 flex">
                <button
                  onClick={() => toast.dismiss(t.id)}
                  className="bg-white rounded-md inline-flex text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  <span className="sr-only">Close</span>
                  <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      ),
      { duration: 8000, position: 'top-center' }
    );
    
    // Also log to the console for debugging
    console.log('Image selected:', file.name, 'Warning toast should be shown');
  };
  
  // Capture image from camera (for mobile)
  const captureImage = () => {
    // Create a temporary file input element for camera capture
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment'; // Use the back camera
    
    // Set up event listener for when an image is captured
    input.onchange = (e) => {
      handleFileChange(e);
    };
    
    // Trigger the file input click
    input.click();
  };

  // Add this hook to handle mobile layout/viewport adjustments
  useEffect(() => {
    // Fix for mobile viewport height issues
    const setMobileHeight = () => {
      // Set a custom viewport height property
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    };

    // Initial setup
    setMobileHeight();

    // Update on resize and orientation change
    window.addEventListener('resize', setMobileHeight);
    window.addEventListener('orientationchange', setMobileHeight);

    // Scroll to bottom on mobile when keyboard appears
    const scrollToBottom = () => {
      if (messageEndRef.current && window.innerWidth < 768) {
        setTimeout(() => {
          messageEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }, 300);
      }
    };

    // Add event listeners to input for mobile keyboard
    const inputElement = inputRef.current;
    if (inputElement) {
      inputElement.addEventListener('focus', scrollToBottom);
    }

    // Cleanup
    return () => {
      window.removeEventListener('resize', setMobileHeight);
      window.removeEventListener('orientationchange', setMobileHeight);
      if (inputElement) {
        inputElement.removeEventListener('focus', scrollToBottom);
      }
    };
  }, [selectedUser]); // Re-run when selected user changes

  // Add iOS-specific keyboard fix handler
  const handleKeyboardIOSFix = (e) => {
    if (window.innerWidth >= 768) return; // Only apply on mobile
    
    // Add a small delay to ensure the view adjusts after the keyboard appears
    setTimeout(() => {
      // Scroll to the input field
      inputRef.current.scrollIntoView({ behavior: 'smooth' });
      
      // Make sure the entire message list is scrolled to show the latest messages
      messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  // In the input field, add event listeners for iOS keyboard
  useEffect(() => {
    if (!inputRef.current) return;
    
    // iOS keyboard events
    inputRef.current.addEventListener('focus', handleKeyboardIOSFix);
    
    return () => {
      if (inputRef.current) {
        inputRef.current.removeEventListener('focus', handleKeyboardIOSFix);
      }
    };
  }, [inputRef.current, selectedUser]);

  // Function to scroll to bottom
  const scrollToBottom = () => {
    if (messageEndRef.current) {
      messageEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
    
    // Also focus the input field on mobile
    if (window.innerWidth < 768 && inputRef.current) {
      setTimeout(() => {
        inputRef.current.focus();
      }, 500);
    }
  };

  // Add scroll listener to show/hide scroll button
  useEffect(() => {
    const handleScroll = () => {
      if (!messagesContainerRef.current) return;
      
      const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
      // Show button when scrolled up more than 300px from bottom
      const isScrolledUp = scrollHeight - scrollTop - clientHeight > 300;
      setShowScrollButton(isScrolledUp);
    };
    
    const container = messagesContainerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, [selectedUser]);

  // Handle incoming call from another user
  const handleIncomingCall = (data) => {
    // Only handle calls meant for us
    if (data.to !== userData?.userName) return;
    
    console.log("Incoming call from:", data.from);
    
    // Check if user is available to take calls
    if (showVideoCall) {
      // User is already in a call, send busy status
      socket.emit("user-not-available", {
        caller: data.from,
        callee: userData.userName
      });
      return;
    }
    
    // Set the incoming call data
    setIncomingCall({
      from: data.from
    });
    
    // Show notification of incoming call
    try {
      // Play notification sound
      const audio = new Audio('/call-ringtone.mp3');
      audio.loop = true;
      audio.play().catch(e => console.log('Audio play prevented by browser policy'));
      
      // Save audio reference to stop later
      window.incomingCallAudio = audio;
    } catch (error) {
      console.error("Error playing audio:", error);
    }
    
    // Show video call UI for incoming call
    setShowVideoCall(true);
  };
  
  // Handle call signaling data from the caller
  const handleCallSignal = (data) => {
    if (data.to !== userData?.userName) return;
    
    // Update incoming call with signaling data needed for peer connection
    setIncomingCall(prev => ({
      ...prev,
      from: data.from,
      signalData: data.signalData
    }));
  };
  
  // Start a video call with the selected user
  const startVideoCall = () => {
    // Add a safety warning before initiating the call
    toast((t) => (
      <div className="p-3 bg-yellow-50 border-l-4 border-yellow-500">
        <h3 className="font-bold text-red-600 mb-1">⚠️ Video Call Safety Notice</h3>
        <p className="text-sm mb-2">You are about to start a video call:</p>
        <ul className="text-xs list-disc pl-4 mb-2">
          <li className="font-bold text-red-600">DO NOT share sensitive personal information</li>
          <li className="font-bold text-red-600">DO NOT engage in explicit content during calls</li>
          <li>Remember you're talking to someone you don't know in person</li>
          <li>You can end the call at any time if you feel uncomfortable</li>
        </ul>
        <div className="flex justify-end gap-2 mt-2">
          <button 
            onClick={() => toast.dismiss(t.id)}
            className="bg-gray-200 text-gray-800 px-2 py-1 rounded text-xs"
          >
            Cancel
          </button>
          <button 
            onClick={() => {
              toast.dismiss(t.id);
              
              // Original call code
              const audio = new Audio('/sounds/outgoing-call.mp3');
              if (notificationSound) {
                audio.loop = true;
                audio.play().catch(err => console.error("Error playing sound:", err));
                // Store audio reference to stop it later
                ringToneRef.current = audio;
              }
              
              // Notify the server we're calling this user
              socket.emit('start-call', {
                from: userData.userName,
                to: selectedUser.userName,
                callType: 'video'
              });
              
              // Show outgoing call UI
              setOutgoingCall(true);
              setShowVideoCall(true);
            }}
            className="bg-blue-500 text-white px-2 py-1 rounded text-xs"
          >
            I Understand
          </button>
        </div>
      </div>
    ), { duration: 7000 });
  };
  
  // Close the video call UI
  const closeVideoCall = () => {
    setShowVideoCall(false);
    setIncomingCall(null);
    setOutgoingCall(false);
    
    // Stop ringtone if playing
    if (window.incomingCallAudio) {
      window.incomingCallAudio.pause();
      window.incomingCallAudio.currentTime = 0;
      window.incomingCallAudio = null;
    }
  };

  // Add keyboard shortcut for video call
  useEffect(() => {
    const handleKeyPress = (e) => {
      // Check if 'v' key is pressed, user is selected and online
      if (e.key.toLowerCase() === 'v' && selectedUser?.online && 
          // Make sure we're not in an input field
          !(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        startVideoCall();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    
    return () => {
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, [selectedUser]);

  // Add a useEffect hook to periodically update user status during active chat
  useEffect(() => {
    // Only run this if we're actively chatting with someone
    if (!selectedUser || !userData) return;
    
    // Send a ping every 20 seconds to keep online status active
    const pingInterval = setInterval(() => {
      // Ping ourselves and the selected user to keep both statuses fresh
      socket.emit("ping-user", userData.userName);
      
      // Also refresh the status of the user we're chatting with
      socket.emit("refresh-user-status", {
        userName: selectedUser.userName,
        requester: userData.userName
      });
    }, 20000);
    
    // Add a socket event listener for online status updates
    const handleUserOnline = (data) => {
      if (!data || typeof data !== 'object') {
        console.warn("Received invalid user online data:", data);
        return;
      }
      
      const userName = data.userName;
      if (!userName) {
        console.warn("Received user online data without username:", data);
        return;
      }
      
      // Update our local state to reflect the online status
      setOnline(prev => {
        return prev.map(user => {
          if (user.userName === userName) {
            return {
              ...user,
              online: true,
              lastSeen: new Date().toISOString()
            };
          }
          return user;
        });
      });
      
      // Also update selected user if it's the one that went online
      if (selectedUser && selectedUser.userName === userName) {
        setSelectedUser(prev => ({
          ...prev,
          online: true,
          lastSeen: new Date().toISOString()
        }));
      }
    };
    
    socket.on("user-online", handleUserOnline);
    
    return () => {
      clearInterval(pingInterval);
      socket.off("user-online", handleUserOnline);
    };
  }, [selectedUser, userData]);

  // Add useEffect hook for user initialization and socket updates
  useEffect(() => {
    if (userData?.userName) {
      console.log("Updating socket with current user:", userData.userName);
      updateSocketUser(userData.userName);
      
      // Send a ping to ensure we're marked as online
      socket.emit("ping-user", userData.userName);
      socket.emit("user-online", userData.userName);
      
      // Add listener for user-not-found events
      const handleUserNotFound = async () => {
        console.log("Server reports user not found in database, attempting recreation");
        const success = await verifyUserExists();
        if (success) {
          console.log("User successfully recreated");
          // Re-establish connection
          socket.emit("user-online", userData.userName);
        } else {
          console.error("Failed to recreate user after not-found event");
          // Could show an error or redirect to login
        }
      };
      
      socket.on("user-not-found", handleUserNotFound);
      
      // Clean up listener when component unmounts
      return () => {
        socket.off("user-not-found", handleUserNotFound);
      };
    }
  }, [userData]);

  // Add a useEffect to periodically refresh the selected user's online status
  useEffect(() => {
    if (!selectedUser || !userData) return;
    
    // Function to check and update the selected user's online status
    const checkUserStatus = () => {
      console.log("Refreshing selected user online status");
      socket.emit("check-user-online", {
        userName: selectedUser.userName
      });
    };
    
    // Initial check
    checkUserStatus();
    
    // Set up interval to refresh every 15 seconds
    const statusInterval = setInterval(checkUserStatus, 15000);
    
    // Listen for online status updates for the selected user
    const handleSelectedUserStatus = (status) => {
      if (!status || status.userName !== selectedUser.userName) return;
      
      console.log("Received updated status for selected user:", status);
      
      // Only update if there's a change in online status
      if (status.online !== selectedUser.online) {
        setSelectedUser(prev => ({
          ...prev,
          online: status.online,
          lastSeen: status.lastSeen || prev.lastSeen
        }));
        
        // Also update in the overall users list
        setOnline(prev => {
          return prev.map(user => {
            if (user.userName === selectedUser.userName) {
              return {
                ...user,
                online: status.online,
                lastSeen: status.lastSeen || user.lastSeen
              };
            }
            return user;
          });
        });
      }
    };
    
    socket.on("user-online-status", handleSelectedUserStatus);
    
    return () => {
      clearInterval(statusInterval);
      socket.off("user-online-status", handleSelectedUserStatus);
    };
  }, [selectedUser, userData]);

  // Add notification title update for browser tab
  useEffect(() => {
    // Count total unread messages
    const totalUnreadCount = onlineUsers.reduce((total, user) => {
      return total + getUnreadCount(user);
    }, 0);
    
    // Update the document title to show unread message count
    if (totalUnreadCount > 0) {
      document.title = `(${totalUnreadCount}) ChatApp`;
    } else {
      document.title = "ChatApp";
    }
    
    // Restore original title when component unmounts
    return () => {
      document.title = "ChatApp";
    };
  }, [onlineUsers]);

  // Add reconnection logic for socket
  useEffect(() => {
    const handleReconnect = async () => {
      console.log("Socket reconnected, updating user status");
      if (userData?.userName) {
        try {
          // Make sure location data is available
          if (!userData.country || !userData.region) {
            try {
              const geoResponse = await fetch('https://ipapi.co/json/');
              const geoData = await geoResponse.json();
              
              // Update userData with location information
              userData.country = geoData.country_name || 'Unknown';
              userData.region = geoData.region || 'Unknown';
              
              // Save updated userData to localStorage
              localStorage.setItem("guestSession", JSON.stringify(userData));
              
              console.log(`Updated location on reconnect: ${userData.country}, ${userData.region}`);
            } catch (geoError) {
              console.error("Error getting location on reconnect:", geoError);
              userData.country = userData.country || 'Unknown';
              userData.region = userData.region || 'Unknown';
            }
          }
          
          // Check if user exists in database before re-establishing presence
          const userExists = await verifyUserExists();
          
          if (userExists) {
            console.log("User verified after reconnection, re-establishing presence");
            // Reestablish our online presence with country and region
            socket.emit('user-online', {
              userName: userData.userName,
              country: userData.country,
              region: userData.region
            });
            
            // Force refresh data
            getOnlineData(true);
          } else {
            console.warn("User doesn't exist in database after reconnection");
            // User recreation was attempted in verifyUserExists
            setTimeout(() => getOnlineData(true), 1000);
          }
        } catch (error) {
          console.error("Error during reconnection:", error);
          // Still try to reconnect
          socket.emit('user-online', {
            userName: userData.userName,
            country: userData.country || 'Unknown',
            region: userData.region || 'Unknown'
          });
          getOnlineData(true);
        }
      }
    };
    
    socket.on('connect', handleReconnect);
    
    return () => {
      socket.off('connect', handleReconnect);
    };
  }, [userData]);

  // Setup proper viewport height for mobile devices
  useEffect(() => {
    // Fix for mobile viewport height issues
    const setMobileHeight = () => {
      // First we get the viewport height and we multiply it by 1% to get a value for a vh unit
      let vh = window.innerHeight * 0.01;
      // Then we set the value in the --vh custom property to the root of the document
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    };
    
    // Run on initial load and when window is resized
    setMobileHeight();
    window.addEventListener('resize', setMobileHeight);
    
    // Auto open sidebar on mobile if no user selected
    if (window.innerWidth < 768 && !selectedUser) {
      setTimeout(() => {
        const mobileSidebar = document.getElementById('mobileSidebar');
        if (mobileSidebar && !mobileSidebar.classList.contains('translate-x-0')) {
          mobileSidebar.classList.add('translate-x-0');
        }
      }, 500);
    }
    
    return () => {
      window.removeEventListener('resize', setMobileHeight);
    };
  }, [selectedUser]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0" />
        <style>{`
          :root {
            --vh: 1vh;
          }
          body {
            height: 100vh;
            height: calc(var(--vh, 1vh) * 100);
            overflow: hidden;
            position: fixed;
            width: 100%;
            /* Prevent elastic scrolling on iOS */
            overscroll-behavior: none;
            -webkit-overflow-scrolling: touch;
          }
          #chat-container {
            height: 100vh;
            height: calc(var(--vh, 1vh) * 100);
            overflow: hidden;
            display: flex;
            flex-direction: column;
          }
          .message-list {
            overflow-y: auto;
            flex: 1;
            padding-bottom: 16px;
            /* Better scroll on iOS */
            -webkit-overflow-scrolling: touch;
          }
          .input-container {
            position: sticky;
            bottom: 0;
            background: white;
            z-index: 10;
          }
          @media (max-width: 768px) {
            .input-container {
              /* iOS safe area support */
              padding-bottom: env(safe-area-inset-bottom, 0);
            }
            
            /* Add a little extra padding for iOS keyboard */
            .ios-fix {
              padding-bottom: 44px;
            }
            
            /* Fix for iOS sticky positioning */
            .message-list {
              padding-bottom: 80px;
            }
            
            /* Mobile emoji picker styling */
            .emoji-picker-container {
              position: fixed !important;
              bottom: 80px !important;
              left: 0 !important;
              width: 100% !important;
              z-index: 1000 !important;
              display: flex !important;
              justify-content: center !important;
            }
            
            .emoji-picker-container > div {
              max-width: 90% !important;
              max-height: 50vh !important;
            }
            
            /* Mobile sidebar animation */
            #mobileSidebar.translate-x-0 {
              transform: translateX(0%);
              box-shadow: 0 0 15px rgba(0, 0, 0, 0.1);
            }
            
            /* Pulse animation for mobile menu button */
            .pulse-animation {
              animation: pulse 2s infinite;
            }
          }
          
          @keyframes pulse {
            0% {
              box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7);
            }
            70% {
              box-shadow: 0 0 0 10px rgba(59, 130, 246, 0);
            }
            100% {
              box-shadow: 0 0 0 0 rgba(59, 130, 246, 0);
            }
          }
          
          @keyframes bounce-once {
            0%, 100% {
              transform: translateY(0);
            }
            50% {
              transform: translateY(-10px);
            }
          }
          
          .animate-bounce-once {
            animation: bounce-once 1s ease-in-out 2;
          }
        `}</style>
      </Head>

      <div id="chat-container" className="flex h-screen">
        {/* Left Sidebar */}
        <div className="hidden md:flex md:w-80 bg-white border-r border-gray-200 flex-col shadow-md rounded-tr-2xl rounded-br-2xl">
          {/* Profile Section */}
          <div className="p-6 border-b border-gray-200 flex items-center gap-4 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-tr-2xl">
            <div className="relative">
              <img
                src={getAvatar(userData?.userName, userData?.Gender)}
                alt="Profile"
                className="w-14 h-14 rounded-full object-cover border-2 border-white shadow-md"
              />
              <span className="absolute bottom-0 right-0 w-4 h-4 rounded-full bg-green-400 border-2 border-white"></span>
            </div>
            <div className="flex flex-col flex-grow">
              <h2 className="font-semibold text-lg">
                {userData?.userName || "Guest User"}
              </h2>
              <span className="text-xs font-medium text-blue-100 flex items-center">
                <span className="w-2 h-2 rounded-full bg-green-400 mr-1"></span>
                Online
              </span>
            </div>
            <button 
              onClick={() => setNotificationSound(!notificationSound)}
              className="p-2 bg-white bg-opacity-20 rounded-full hover:bg-opacity-30 transition-colors"
              title={notificationSound ? "Turn off notification sounds" : "Turn on notification sounds"}
            >
              {notificationSound ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M13 11.586V8a3 3 0 00-6 0v3.586l-.707.707A1 1 0 006 14h8a1 1 0 00.707-1.707L13 11.586z" clipRule="evenodd" />
                  <path d="M3.293 4.293a1 1 0 011.414 0L10 9.586l5.293-5.293a1 1 0 011.414 1.414L11.414 11l5.293 5.293a1 1 0 01-1.414 1.414L10 12.414l-5.293 5.293a1 1 0 01-1.414-1.414L8.586 11 3.293 5.707a1 1 0 010-1.414z" />
                </svg>
              )}
            </button>
          </div>

          {/* Filter Section */}
          <div className="px-6 py-3 border-b border-gray-200">
            <div className="flex flex-col">
              <label htmlFor="genderFilter" className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Filter By Gender
              </label>
              <div className="flex space-x-2">
                <button 
                  onClick={() => setGenderFilter('all')}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    genderFilter === 'all' 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  All
                </button>
                <button 
                  onClick={() => setGenderFilter('male')}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    genderFilter === 'male' 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Male
                </button>
                <button 
                  onClick={() => setGenderFilter('female')}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    genderFilter === 'female' 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Female
                </button>
              </div>
            </div>
            
            {/* Region Filter */}
            <div className="flex flex-col mt-4">
              <label htmlFor="regionFilter" className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Filter By Region
              </label>
              <div className="flex space-x-2">
                <button 
                  onClick={() => setRegionFilter('all')}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    regionFilter === 'all' 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  All Regions
                </button>
                {userData?.region && userData.region !== 'Unknown' && (
                  <button 
                    onClick={() => setRegionFilter(userData.region.toLowerCase())}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      regionFilter === userData.region.toLowerCase()
                        ? 'bg-blue-500 text-white' 
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                    title="Filter users from your region"
                  >
                    My Region
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Online Users List */}
          <div className="flex-1 overflow-y-auto py-3">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3 flex items-center">
              <span>Active Now</span>
              <span className="ml-2 bg-blue-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">{getFilteredUsers().length}</span>
            </h3>
            <div className="space-y-1 px-4">
              {getFilteredUsers().length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <p className="text-gray-500 text-sm">
                    {genderFilter === 'all' 
                      ? 'No active users found' 
                      : `No ${genderFilter} users found`}
                  </p>
                </div>
              ) : (
                getFilteredUsers().map((user) => {
                  const unreadCount = getUnreadCount(user);
                  const { latestMessage } = getUnreadMessageInfo(user);
                  return (
                    <div
                      key={user._id}
                      className={`flex items-center gap-3 p-3 rounded-xl transition cursor-pointer hover:shadow-md ${
                        selectedUser?._id === user._id
                          ? "bg-gradient-to-r from-blue-50 to-indigo-50 border-l-4 border-blue-500 shadow-sm"
                          : unreadCount > 0 ? "bg-blue-50 border-l-4 border-red-500" : "hover:bg-gray-50"
                      }`}
                      onClick={() => setSelectedUser(user)}
                    >
                      <div className="relative flex-shrink-0">
                        <img
                          src={getAvatar(user.userName, user.Gender)}
                          className="w-12 h-12 rounded-full object-cover shadow-sm"
                          alt={user.userName}
                        />
                        <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${user.online ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></span>
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium text-gray-800 truncate">
                          {user.userName} {unreadCount > 0 && <span className="text-red-500">•</span>}
                        </span>
                        <span className="text-xs text-gray-500 truncate">
                          {latestMessage ? (
                            <span className="text-gray-700 font-medium truncate">
                              {latestMessage.message?.substring(0, 20)}
                              {latestMessage.message?.length > 20 ? '...' : ''}
                              {latestMessage.imageUrl && ' 📷'}
                            </span>
                          ) : (
                            <>
                              <span className="capitalize">{user.Gender || 'Unknown'}</span> • {user.Age || '--'} yrs • 
                              {user.online 
                                ? <span className="text-green-600 font-medium"> Online</span> 
                                : ` Last seen: ${formatLastSeen(user.lastSeen)}`}
                            </>
                          )}
                        </span>
                        {(user.country && user.country !== 'Unknown') && (
                          <span className="text-xs italic text-gray-500 truncate">
                            {user.country}{user.region && user.region !== 'Unknown' ? `, ${user.region}` : ''}
                          </span>
                        )}
                      </div>
                      {unreadCount > 0 && (
                        <div className="ml-auto flex items-center">
                          <div className="flex flex-col items-end">
                            <span className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-xs rounded-full h-6 w-6 flex items-center justify-center shadow-sm">
                              {unreadCount}
                            </span>
                            <span className="h-3 w-3 rounded-full bg-red-500 animate-pulse mt-1"></span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Mobile menu button - only appears on small screens */}
        <div className="md:hidden fixed top-4 left-4 z-10">
          <button 
            className="p-3 bg-blue-500 text-white rounded-full shadow-md hover:bg-blue-600 transition-colors pulse-animation"
            onClick={() => document.getElementById('mobileSidebar').classList.toggle('translate-x-0')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
            </svg>
          </button>
        </div>

        {/* Mobile sidebar - hidden by default */}
        <div id="mobileSidebar" className="md:hidden fixed inset-y-0 left-0 transform -translate-x-full w-72 transition duration-300 ease-in-out z-30 bg-white shadow-xl rounded-tr-3xl rounded-br-3xl overflow-auto h-full">
          {/* Close button */}
          <button 
            className="absolute top-4 right-4 p-2 rounded-full text-gray-500 hover:bg-gray-100 transition-colors"
            onClick={() => document.getElementById('mobileSidebar').classList.remove('translate-x-0')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          
          {/* Mobile Profile Section */}
          <div className="p-6 border-b border-gray-200 flex items-center gap-4 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-tr-3xl">
            <div className="relative">
              <img
                src={getAvatar(userData?.userName, userData?.Gender)}
                alt="Profile"
                className="w-14 h-14 rounded-full object-cover border-2 border-white shadow-md"
              />
              <span className="absolute bottom-0 right-0 w-4 h-4 rounded-full bg-green-400 border-2 border-white"></span>
            </div>
            <div className="flex flex-col flex-grow">
              <h2 className="font-semibold text-lg">
                {userData?.userName || "Guest User"}
              </h2>
              <span className="text-xs font-medium text-blue-100 flex items-center">
                <span className="w-2 h-2 rounded-full bg-green-400 mr-1"></span>
                Online
              </span>
            </div>
            <button 
              onClick={() => setNotificationSound(!notificationSound)}
              className="p-2 bg-white bg-opacity-20 rounded-full hover:bg-opacity-30 transition-colors"
              title={notificationSound ? "Turn off notification sounds" : "Turn on notification sounds"}
            >
              {notificationSound ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M13 11.586V8a3 3 0 00-6 0v3.586l-.707.707A1 1 0 006 14h8a1 1 0 00.707-1.707L13 11.586z" clipRule="evenodd" />
                  <path d="M3.293 4.293a1 1 0 011.414 0L10 9.586l5.293-5.293a1 1 0 011.414 1.414L11.414 11l5.293 5.293a1 1 0 01-1.414 1.414L10 12.414l-5.293 5.293a1 1 0 01-1.414-1.414L8.586 11 3.293 5.707a1 1 0 010-1.414z" />
                </svg>
              )}
            </button>
          </div>

          {/* Add Filter Section to Mobile */}
          <div className="px-6 py-3 border-b border-gray-200">
            <div className="flex flex-col">
              <label htmlFor="genderFilter" className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Filter By Gender
              </label>
              <div className="flex space-x-2">
                <button 
                  onClick={() => setGenderFilter('all')}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    genderFilter === 'all' 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  All
                </button>
                <button 
                  onClick={() => setGenderFilter('male')}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    genderFilter === 'male' 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Male
                </button>
                <button 
                  onClick={() => setGenderFilter('female')}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    genderFilter === 'female' 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Female
                </button>
              </div>
            </div>
          </div>

          {/* Mobile Online Users List */}
          <div className="overflow-y-auto h-full py-3">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3 flex items-center">
              <span>Active Now</span>
              <span className="ml-2 bg-blue-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">{getFilteredUsers().length}</span>
            </h3>
            <div className="space-y-1 px-4">
              {getFilteredUsers().map((user) => {
                const unreadCount = getUnreadCount(user);
                const { latestMessage } = getUnreadMessageInfo(user);
                return (
                  <div
                    key={user._id}
                    className={`flex items-center gap-3 p-3 rounded-xl transition cursor-pointer hover:shadow-md ${
                      selectedUser?._id === user._id
                        ? "bg-gradient-to-r from-blue-50 to-indigo-50 border-l-4 border-blue-500 shadow-sm"
                        : unreadCount > 0 ? "bg-blue-50 border-l-2 border-red-400" : "hover:bg-gray-50"
                    }`}
                    onClick={() => {
                      setSelectedUser(user);
                      document.getElementById('mobileSidebar').classList.remove('translate-x-0');
                    }}
                  >
                    <div className="relative flex-shrink-0">
                      <img
                        src={getAvatar(user.userName, user.Gender)}
                        className="w-12 h-12 rounded-full object-cover shadow-sm"
                        alt={user.userName}
                      />
                      <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${user.online ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></span>
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium text-gray-800 truncate flex items-center gap-1">
                        {user.userName}
                        {unreadCount > 0 && <span className="h-2 w-2 rounded-full bg-red-500"></span>}
                      </span>
                      <span className="text-xs text-gray-500">
                        <span className="capitalize">{user.Gender || 'Unknown'}</span> • {user.Age || '--'} yrs • 
                        {user.online 
                          ? <span className="text-green-600 font-medium"> Online</span> 
                          : ` Last seen: ${formatLastSeen(user.lastSeen)}`}
                      </span>
                      {(user.country && user.country !== 'Unknown') && (
                        <span className="text-xs italic text-gray-500 truncate">
                          {user.country}{user.region && user.region !== 'Unknown' ? `, ${user.region}` : ''}
                        </span>
                      )}
                    </div>
                    {unreadCount > 0 && (
                      <div className="ml-auto">
                        <span className="h-3 w-3 rounded-full bg-red-500 animate-pulse"></span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Main Chat Area - updated with the mobile-optimized classes */}
        <div className="flex-1 flex flex-col">
          {!selectedUser ? (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-50 to-blue-50">
              <div className="text-center max-w-md mx-auto p-8 rounded-2xl bg-white shadow-lg border border-gray-200 transform transition-all hover:scale-105 duration-300">
                <div className="w-24 h-24 bg-gradient-to-r from-blue-400 to-indigo-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-md">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-3">
                  Welcome to ChatApp
                </h3>
                <p className="text-gray-600 mb-6">
                  Choose someone from the online users list to start a conversation.
                </p>
                <div className="flex justify-center">
                  <button
                    onClick={() => document.getElementById('mobileSidebar').classList.toggle('translate-x-0')}
                    className="md:hidden px-5 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-full shadow-lg hover:shadow-xl transition-all flex items-center animate-pulse"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    Show Online Users
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Chat Header - Add video call button */}
              <div className="bg-white p-4 shadow-md flex items-center justify-between border-b border-gray-200 sticky top-0 z-10">
                <div className="flex items-center">
                  <div className="relative mr-3">
                    <img
                      src={getAvatar(selectedUser.userName, selectedUser.Gender)}
                      alt={selectedUser.userName}
                      className="w-12 h-12 rounded-full object-cover border border-gray-200 shadow-sm"
                    />
                    <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${selectedUser.online ? 'bg-green-500' : 'bg-gray-400'}`}></span>
                  </div>
                  <div>
                    <h2 className="font-semibold text-gray-800">
                      {selectedUser.userName}
                    </h2>
                    <p className="text-xs text-gray-500">
                      {selectedUser.online 
                        ? <span className="flex items-center">
                            <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1 animate-pulse"></span>
                            Online now
                          </span> 
                        : `Last seen: ${formatLastSeen(selectedUser.lastSeen)}`}
                    </p>
                    {(selectedUser.country && selectedUser.country !== 'Unknown') && (
                      <p className="text-xs italic text-gray-500">
                        {selectedUser.country}{selectedUser.region && selectedUser.region !== 'Unknown' ? `, ${selectedUser.region}` : ''}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  {/* Video Call Button */}
                  <button 
                    onClick={startVideoCall}
                    disabled={!selectedUser?.online}
                    className={`px-4 py-2.5 rounded-lg shadow-md transition-all transform hover:scale-105 duration-200 relative group ${
                      selectedUser?.online 
                        ? 'bg-gradient-to-r from-green-500 to-teal-500 text-white hover:from-green-600 hover:to-teal-600' 
                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    <svg className="w-5 h-5 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <span className="font-medium md:inline hidden">Video Call</span>
                  </button>
                  
                  {/* Mobile back button */}
                  <button className="md:hidden p-2 rounded-full hover:bg-gray-100 text-gray-600 transition-colors" onClick={() => setSelectedUser(null)}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Messages Display */}
              <div 
                ref={messagesContainerRef}
                className="flex-1 p-4 space-y-4 overflow-y-auto message-list"
              >
                {!selectedUser ? (
                  <div className="flex flex-col items-center justify-center h-full text-gray-400">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20 mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <p className="text-lg font-semibold">Select a user to start chatting</p>
                    <p className="text-sm">Choose someone from the online users list</p>
                  </div>
                ) : (
                  <>
                    {renderMessages()}
                    <div ref={messageEndRef} /> {/* For auto-scrolling */}
                    
                    {/* Floating scroll button */}
                    {showScrollButton && (
                      <button 
                        onClick={scrollToBottom}
                        className="fixed bottom-20 right-4 md:right-8 p-3 bg-blue-500 rounded-full shadow-lg text-white z-20 animate-bounce-once"
                        aria-label="Scroll to bottom"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                        </svg>
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* Message Input - updated with the input-container class */}
              <div className="bg-white p-4 border-t border-gray-200 input-container ios-fix">
                <form onSubmit={handleSendMessage} className="flex flex-col gap-2 max-w-3xl mx-auto">
                  {imageFile && (
                    <div className="p-2 bg-gray-50 rounded-lg mb-2 flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span className="text-sm text-gray-700 truncate max-w-[150px]">{imageFile.name}</span>
                      </div>
                      <button
                        type="button"
                        className="text-gray-500 hover:text-red-500"
                        onClick={() => setImageFile(null)}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  )}
                  <div className="flex items-center space-x-2 rounded-lg border border-gray-300 bg-white px-3 py-2 shadow-sm focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500">
                    <div className="flex-shrink-0 relative">
                      <button 
                        type="button"
                        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                        className="text-gray-500 hover:text-indigo-500"
                        data-emoji-button="true"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </button>
                      
                      {showEmojiPicker && (
                        <div 
                          ref={emojiPickerRef}
                          className={`absolute bottom-16 left-0 z-50 ${window.innerWidth < 768 ? 'emoji-picker-container' : ''}`}
                          style={{
                            boxShadow: '0 0 10px rgba(0, 0, 0, 0.2)',
                            borderRadius: '10px'
                          }}
                        >
                          <EmojiPicker 
                            onEmojiClick={handleEmojiClick}
                            width={window.innerWidth < 768 ? window.innerWidth - 40 : 300}
                            height={window.innerWidth < 768 ? 350 : 400}
                            previewConfig={{
                              showPreview: false
                            }}
                            searchDisabled={window.innerWidth < 768}
                          />
                        </div>
                      )}
                    </div>
                    
                    <input
                      type="text"
                      ref={inputRef}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      onFocus={handleKeyboardIOSFix}
                      className="flex-1 border-0 p-0 focus:ring-0 text-gray-800 placeholder-gray-400 outline-none"
                      placeholder="Type a message..."
                    />
                    
                    {/* File upload button - with camera access for mobile */}
                    <div className="flex items-center space-x-1">
                      <button
                        type="button"
                        className="text-gray-500 hover:text-indigo-500"
                        onClick={() => document.getElementById('file-upload').click()}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </button>
                      {/* Camera button for mobile devices */}
                      <button
                        type="button"
                        className="text-gray-500 hover:text-indigo-500 md:hidden"
                        onClick={captureImage}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </button>
                      <input 
                        id="file-upload"
                        type="file"
                        onChange={handleFileChange}
                        accept="image/*"
                        className="hidden"
                        ref={fileInputRef}
                      />
                      <button
                        type="submit"
                        disabled={isUploading || (message.trim() === "" && !imageFile)}
                        className={`rounded-full p-2 ${
                          isUploading || (message.trim() === "" && !imageFile)
                            ? "bg-gray-300 cursor-not-allowed"
                            : "bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700"
                        }`}
                      >
                        {isUploading ? (
                          <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 0l-3 3a1 1 0 001.414 1.414L9 9.414V13a1 1 0 102 0V9.414l1.293 1.293a1 1 0 001.414-1.414z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
      
      {/* Video Call Dialog */}
      {showVideoCall && (
        <VideoChat
          socket={socket}
          selectedUser={selectedUser}
          userData={userData}
          onClose={closeVideoCall}
          initiateCall={outgoingCall}
          incomingCall={incomingCall}
          onCallEnded={() => {
            if (window.incomingCallAudio) {
              window.incomingCallAudio.pause();
              window.incomingCallAudio.currentTime = 0;
              window.incomingCallAudio = null;
            }
          }}
        />
      )}

      {/* Floating Video Call Button - Always visible when user is selected */}
      {selectedUser && !showVideoCall && (
        <div className="fixed bottom-20 right-5 z-50">
          <button
            onClick={() => {
              console.log("Video call button clicked");
              
              // If selectedUser is undefined, fetch it again
              if (!selectedUser || selectedUser.online === undefined) {
                console.log("Selected user or online status is undefined, refreshing...");
                socket.emit("check-user-online", {
                  userName: selectedUser?.userName
                });
                return;
              }
              
              console.log("User online status:", selectedUser.online);
              
              // Check if the user's online status is defined and true
              if (selectedUser?.online !== true) {
                // Double-check with the server for the latest status
                socket.emit("check-user-online", {
                  userName: selectedUser.userName
                });

                // Listen for the response
                const checkOnlineListener = (status) => {
                  console.log("Check online response:", status);
                  socket.off("user-online-status", checkOnlineListener);
                  
                  if (status.online) {
                    // User is actually online, update our local state
                    setSelectedUser(prev => ({
                      ...prev,
                      online: true
                    }));
                    
                    // Start the call
                    setOutgoingCall(true);
                    setShowVideoCall(true);
                  } else {
                    toast.error(`${selectedUser.userName} is offline. You can only call online users.`);
                    // Update the local state to reflect the actual status
                    setOnline(prev => {
                      const newUsers = [...prev];
                      const userIndex = newUsers.findIndex(u => u.userName === selectedUser.userName);
                      
                      if (userIndex !== -1) {
                        newUsers[userIndex] = {
                          ...newUsers[userIndex],
                          online: false,
                          lastSeen: status.lastSeen || new Date().toISOString()
                        };
                      }
                      
                      // Also update selected user
                      setSelectedUser(prev => ({
                        ...prev,
                        online: false,
                        lastSeen: status.lastSeen || new Date().toISOString()
                      }));
                      
                      return newUsers;
                    });
                  }
                };
                
                socket.on("user-online-status", checkOnlineListener);
                
                // Set a timeout in case the server doesn't respond
                setTimeout(() => {
                  socket.off("user-online-status", checkOnlineListener);
                }, 2000);
                
                return;
              }
              
              // User is online, proceed with call
              setOutgoingCall(true);
              setShowVideoCall(true);
            }}
            className="bg-green-500 text-white p-4 rounded-full shadow-lg hover:bg-green-600 transition-colors"
            title="Start Video Call"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
        </div>
      )}
    </>
  );
};

export default ChatPage;