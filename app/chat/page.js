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
  
  // Add new state variables for emoji picker and image upload
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  
  // Add new state for video calls
  const [showVideoCall, setShowVideoCall] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null);
  const [outgoingCall, setOutgoingCall] = useState(false);
  
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

  // Get online users
  useEffect(() => {
    if (userData?.userName) {
    getOnlineData();
      // Send ping every 30 seconds to keep user active
      const pingInterval = setInterval(() => {
        socket.emit('ping-user', userData.userName);
      }, 30000);
      
      return () => clearInterval(pingInterval);
    }
  }, [userData]);

  const getOnlineData = async () => {
    if (userData?.userName) {
      try {
        const users = await getUsers(userData);
        const initializedUsers = users.map(user => ({
          ...user,
          chatWindow: user.chatWindow || [],
          // Ensure online status is a boolean, default to false if undefined
          online: !!user.online
        }));
        
        // Update state carefully to maintain offline users
        setOnline(prevUsers => {
          // Create a map of existing users to preserve offline status that may be more recent
          const prevUserMap = new Map();
          prevUsers.forEach(user => {
            prevUserMap.set(user.userName, user);
          });
          
          // Update users, keeping offline status if it's more recent
          return initializedUsers.map(newUser => {
            const existingUser = prevUserMap.get(newUser.userName);
            
            // If we have an existing user who is currently marked as offline
            // and they're also marked as offline in the new data
            if (existingUser && !existingUser.online && !newUser.online) {
              // Keep the most recent lastSeen timestamp
              const existingLastSeen = new Date(existingUser.lastSeen || 0);
              const newLastSeen = new Date(newUser.lastSeen || 0);
              
              if (existingLastSeen > newLastSeen) {
                return {
                  ...newUser,
                  lastSeen: existingUser.lastSeen
                };
              }
            } else if (existingUser && existingUser.online && !newUser.online) {
              // If the user was previously online but now appears offline in the new data,
              // let's verify they're actually offline by checking active socketId
              return {
                ...newUser,
                online: true // Keep them online until we can verify with server
              };
            }
            
            return newUser;
          });
        });

        // If we have a selected user, make sure to refresh their online status
        if (selectedUser) {
          // Find the user in our updated list
          socket.emit("check-user-online", {
            userName: selectedUser.userName
          });
        }
        
        // Request updated online status from server
        const onlineUserNames = initializedUsers
          .filter(user => user.online === true)
          .map(user => user.userName);
          
        // Request server to verify these users are actually online
        if (onlineUserNames.length > 0) {
          socket.emit("verify-online-users", {
            users: onlineUserNames,
            requester: userData.userName
          });
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
          newUsers[userIndex] = {
            ...newUsers[userIndex],
            online: false,
            lastSeen: data.lastSeen
          };
          
          // If this is the selected user, update that reference too
          if (selectedUser && selectedUser.userName === data.userName) {
            setSelectedUser({
              ...selectedUser,
              online: false,
              lastSeen: data.lastSeen
            });
          }
        }
        
        return newUsers;
      });
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
        if (messageData.imageUrl) {
          console.log('Image received:', messageData.imageUrl);
          // You could play a different notification sound for images
          // Example: new Audio('/image-notification.mp3').play().catch(e => console.log('Audio play prevented'));
        } else {
          // Regular message notification
          // Example: new Audio('/notification.mp3').play().catch(e => console.log('Audio play prevented'));
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
    
    // Create or get a debounced function for this user
    if (!debouncedMarkReadFuncs[fromUser]) {
      debouncedMarkReadFuncs[fromUser] = debounce((user) => {
        console.log(`Marking messages from ${user} as read`);
        socket.emit('mark-messages-read', {
          from: user,
          to: userData.userName
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

  // Filter users based on gender
  const getFilteredUsers = () => {
    if (genderFilter === 'all') {
      return onlineUsers;
    }
    return onlineUsers.filter(user => 
      user.Gender && user.Gender.toLowerCase() === genderFilter.toLowerCase()
    );
  };

  // Handle sending messages
  const handleSendMessage = async (e) => {
    e.preventDefault();
    const trimmedMessage = message.trim();
    if ((trimmedMessage === "" && !imageFile) || !selectedUser || !userData) return;

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
                      <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 14a6 6 0 110-12 6 6 0 010 12z" />
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
    
    const maxSizeInMB = 5;
    const maxSizeInBytes = maxSizeInMB * 1024 * 1024;
    
    // Check file type and size
    if (file.type.startsWith('image/')) {
      if (file.size > maxSizeInBytes) {
        toast.error(`File size exceeds ${maxSizeInMB}MB limit. Please choose a smaller file.`);
        return;
      }
      
      // For images under the size limit, proceed normally
      setImageFile(file);
    } else {
      toast.error('Please select an image file (JPEG, PNG, GIF)');
    }
    
    // Reset the file input value to allow selecting the same file again
    e.target.value = '';
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
    if (selectedUser && selectedUser.online) {
      console.log("Starting video call with", selectedUser.userName);
      setShowVideoCall(true);
    } else {
      toast.error("User is offline. Video call is not available.");
    }
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
            <div className="flex flex-col">
              <h2 className="font-semibold text-lg">
                {userData?.userName || "Guest User"}
              </h2>
              <span className="text-xs font-medium text-blue-100 flex items-center">
                <span className="w-2 h-2 rounded-full bg-green-400 mr-1"></span>
                Online
              </span>
            </div>
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
                  return (
                    <div
                      key={user._id}
                      className={`flex items-center gap-3 p-3 rounded-xl transition cursor-pointer hover:shadow-md ${
                        selectedUser?._id === user._id
                          ? "bg-gradient-to-r from-blue-50 to-indigo-50 border-l-4 border-blue-500 shadow-sm"
                          : "hover:bg-gray-50"
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
                          {user.userName}
                        </span>
                        <span className="text-xs text-gray-500">
                          <span className="capitalize">{user.Gender || 'Unknown'}</span> • {user.Age || '--'} yrs • 
                          {user.online 
                            ? <span className="text-green-600 font-medium"> Online</span> 
                            : ` Last seen: ${formatLastSeen(user.lastSeen)}`}
                        </span>
                      </div>
                      {unreadCount > 0 && (
                        <div className="ml-auto">
                          <span className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-xs rounded-full h-6 w-6 flex items-center justify-center shadow-sm">
                            {unreadCount}
                          </span>
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
            className="p-3 bg-white rounded-full shadow-md text-blue-600 hover:bg-blue-50 transition-colors"
            onClick={() => document.getElementById('mobileSidebar').classList.toggle('translate-x-0')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
            </svg>
          </button>
        </div>

        {/* Mobile sidebar - hidden by default */}
        <div id="mobileSidebar" className="md:hidden fixed inset-y-0 left-0 transform -translate-x-full w-72 transition duration-300 ease-in-out z-20 bg-white shadow-xl rounded-tr-3xl rounded-br-3xl">
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
            <div className="flex flex-col">
              <h2 className="font-semibold text-lg">
                {userData?.userName || "Guest User"}
              </h2>
              <span className="text-xs font-medium text-blue-100 flex items-center">
                <span className="w-2 h-2 rounded-full bg-green-400 mr-1"></span>
                Online
              </span>
            </div>
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
                return (
                  <div
                    key={user._id}
                    className={`flex items-center gap-3 p-3 rounded-xl transition cursor-pointer hover:shadow-md ${
                      selectedUser?._id === user._id
                        ? "bg-gradient-to-r from-blue-50 to-indigo-50 border-l-4 border-blue-500 shadow-sm"
                        : "hover:bg-gray-50"
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
                      <span className="text-sm font-medium text-gray-800 truncate">
                        {user.userName}
                      </span>
                      <span className="text-xs text-gray-500">
                        <span className="capitalize">{user.Gender || 'Unknown'}</span> • {user.Age || '--'} yrs • 
                        {user.online 
                          ? <span className="text-green-600 font-medium"> Online</span> 
                          : ` Last seen: ${formatLastSeen(user.lastSeen)}`}
                      </span>
                    </div>
                    {unreadCount > 0 && (
                      <div className="ml-auto">
                        <span className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-xs rounded-full h-6 w-6 flex items-center justify-center shadow-sm">
                          {unreadCount}
                        </span>
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
                    className="md:hidden px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-full shadow-md hover:shadow-lg transition-all"
                  >
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
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  {/* Video Call Button */}
                  <button 
                    onClick={startVideoCall}
                    disabled={!selectedUser?.online}
                    className="px-4 py-2.5 bg-gradient-to-r from-green-500 to-teal-500 text-white rounded-lg shadow-md hover:from-green-600 hover:to-teal-600 transition-all transform hover:scale-105 duration-200 relative group"
                  >
                    <svg className="w-5 h-5 inline-block mr-1 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <span className="font-medium">Video Call</span>
                    <span className="absolute -top-2 -right-2 bg-white text-green-600 text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center shadow-sm opacity-0 group-hover:opacity-100 transition-opacity">V</span>
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
                            width={window.innerWidth < 768 ? 320 : 300}
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