"use client";
import React, { useState, useEffect, useRef } from "react";
import { getUsers } from "@/Database/actions";
import { useRouter } from "next/navigation";
import socket, { updateSocketUser } from "@/app/lib/sockClient";
import { toast } from "react-hot-toast";
import EmojiPicker from "emoji-picker-react";
import Head from 'next/head';
import VideoChat from "@/app/components/VideoChat";
import {
  Send, Image as ImageIcon, Smile, Phone, Video, MoreVertical,
  Search, Menu, X, ArrowLeft, Paperclip, Mic, LogOut, Bell, BellOff,
  Filter, MapPin, Loader2, User as UserIcon, Check, CheckCheck
} from 'lucide-react';

import Button from "@/app/components/ui/Button";
import Input from "@/app/components/ui/Input";
import Card from "@/app/components/ui/Card";

const ChatPage = () => {
  const [message, setMessage] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [onlineUsers, setOnline] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [genderFilter, setGenderFilter] = useState('all');
  const [regionFilter, setRegionFilter] = useState('all');

  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);

  const [showVideoCall, setShowVideoCall] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null);
  const [outgoingCall, setOutgoingCall] = useState(false);

  const [notificationSound, setNotificationSound] = useState(true);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);

  const messageEndRef = useRef(null);
  const inputRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const fileInputRef = useRef(null);
  const messagesContainerRef = useRef(null);

  const [showScrollButton, setShowScrollButton] = useState(false);

  const router = useRouter();

  // --- Logic Section (Preserved) ---

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target) &&
        !event.target.closest('[data-emoji-button="true"]')) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const data = localStorage.getItem("guestSession");
    if (!data) {
      router.push("/");
    } else {
      setUserData(JSON.parse(data));
    }
    setIsLoading(false);
  }, [router]);

  const [sessionLastActive, setSessionLastActive] = useState(Date.now());
  const SESSION_TIMEOUT = 30 * 60 * 1000;

  useEffect(() => {
    if (selectedUser) {
      localStorage.setItem("selectedChatUser", JSON.stringify({
        userName: selectedUser.userName,
        _id: selectedUser._id,
        timestamp: Date.now()
      }));
    }
  }, [selectedUser]);

  useEffect(() => {
    if (!selectedUser && userData && onlineUsers.length > 0) {
      const savedChat = localStorage.getItem("selectedChatUser");
      if (savedChat) {
        try {
          const parsedChat = JSON.parse(savedChat);
          if (Date.now() - (parsedChat.timestamp || 0) < 60 * 60 * 1000) {
            const foundUser = onlineUsers.find(u => u.userName === parsedChat.userName);
            if (foundUser) setSelectedUser(foundUser);
          } else {
            localStorage.removeItem("selectedChatUser");
          }
        } catch (error) {
          console.error("Error restoring chat session:", error);
        }
      }
    }
  }, [userData, onlineUsers, selectedUser]);

  useEffect(() => {
    if (!userData?.userName) return;

    const heartbeatInterval = setInterval(() => {
      const now = Date.now();
      if (document.hasFocus()) setSessionLastActive(now);

      if (now - sessionLastActive < SESSION_TIMEOUT) {
        socket.emit("heartbeat", { userName: userData.userName, lastActive: now });
      }
    }, 20000);

    const resetActivity = () => setSessionLastActive(Date.now());
    window.addEventListener('mousemove', resetActivity);
    window.addEventListener('keydown', resetActivity);
    window.addEventListener('click', resetActivity);
    window.addEventListener('touchstart', resetActivity);
    window.addEventListener('focus', resetActivity);

    const handleUnload = () => {
      try {
        const offlineEvent = new XMLHttpRequest();
        offlineEvent.open('POST', '/api/user-offline', false);
        offlineEvent.setRequestHeader('Content-Type', 'application/json');
        offlineEvent.send(JSON.stringify({ userName: userData.userName, timestamp: new Date().toISOString() }));
      } catch (e) { }
    };
    window.addEventListener('beforeunload', handleUnload);

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

  useEffect(() => {
    if (userData?.userName) {
      getOnlineData();
      const fastPoll = setInterval(() => {
        if (document.visibilityState === 'visible') {
          socket.emit('ping-user', userData.userName);
          getOnlineData();
        }
      }, 15000);
      const slowPoll = setInterval(() => {
        socket.emit('ping-user', userData.userName);
      }, 60000);

      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          socket.emit('ping-user', userData.userName);
          getOnlineData();
          if (Date.now() - sessionLastActive < SESSION_TIMEOUT) {
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
        if (forceRefresh || !window.lastOnlineFetch || Date.now() - window.lastOnlineFetch > 15000) {
          window.lastOnlineFetch = Date.now();
          const users = await getUsers(userData);
          const initializedUsers = users.map(user => {
            const existingUser = onlineUsers.find(u => u.userName === user.userName);
            return {
              ...user,
              chatWindow: user.chatWindow || (existingUser?.chatWindow || []),
              online: existingUser && Date.now() - window.lastOnlineFetch < 5000 ? existingUser.online : !!user.online,
              lastSeen: existingUser && new Date(existingUser.lastSeen) > new Date(user.lastSeen || 0) ? existingUser.lastSeen : user.lastSeen
            };
          });

          setOnline(prevUsers => {
            const prevUserMap = new Map();
            prevUsers.forEach(user => prevUserMap.set(user.userName, user));

            return initializedUsers.map(newUser => {
              const existingUser = prevUserMap.get(newUser.userName);
              if (!existingUser) return newUser;

              if (!newUser.online && !existingUser.online) {
                const existingLastSeen = new Date(existingUser.lastSeen || 0);
                const newLastSeen = new Date(newUser.lastSeen || 0);
                if (existingLastSeen > newLastSeen) {
                  return { ...newUser, lastSeen: existingUser.lastSeen };
                }
              }

              if (existingUser.online && !newUser.online) {
                socket.emit("check-user-online", { userName: newUser.userName });
                return { ...newUser, online: true, lastSeen: existingUser.lastSeen };
              }

              if (existingUser.chatWindow && existingUser.chatWindow.length > 0) {
                if (!newUser.chatWindow || newUser.chatWindow.length === 0) {
                  return { ...newUser, chatWindow: existingUser.chatWindow };
                }
                const existingMsgIds = new Set(existingUser.chatWindow.map(msg => msg.id));
                const newMsgs = newUser.chatWindow.filter(msg => !existingMsgIds.has(msg.id));
                return { ...newUser, chatWindow: [...existingUser.chatWindow, ...newMsgs] };
              }
              return newUser;
            });
          });

          if (selectedUser) {
            socket.emit("check-user-online", { userName: selectedUser.userName });
          }
        }
      } catch (error) {
        console.error("Error fetching users:", error);
      }
    }
  };

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedUser?.chatWindow]);

  useEffect(() => {
    if (!userData?.userName) return;

    socket.emit('user-online', userData.userName);
    socket.on("userUpdate", getOnlineData);
    socket.on("UserDeleted", getOnlineData);

    socket.on('user-online', (data) => {
      setOnline(prev => {
        const newUsers = [...prev];
        const userIndex = newUsers.findIndex(u => u.userName === data.userName);
        if (userIndex !== -1) {
          newUsers[userIndex] = { ...newUsers[userIndex], online: true };
        }
        return newUsers;
      });
    });

    socket.on('user-offline', (data) => {
      setOnline(prev => {
        const newUsers = [...prev];
        const userIndex = newUsers.findIndex(u => u.userName === data.userName);
        if (userIndex !== -1) {
          const offlineTimestamp = data.lastSeen || new Date().toISOString();
          newUsers[userIndex] = { ...newUsers[userIndex], online: false, lastSeen: offlineTimestamp };
          if (selectedUser && selectedUser.userName === data.userName) {
            setSelectedUser(prev => ({ ...prev, online: false, lastSeen: offlineTimestamp }));
          }
        }
        return newUsers;
      });
      setTimeout(() => getOnlineData(true), 3000);
    });

    socket.on('self-update', (updatedUserData) => {
      if (updatedUserData.userName === userData.userName) {
        localStorage.setItem("guestSession", JSON.stringify(updatedUserData));
        setUserData(updatedUserData);
      }
    });

    socket.on('conversation-update', (updatedUserData) => {
      setOnline(prev => {
        const newUsers = [...prev];
        const userIndex = newUsers.findIndex(u => u.userName === updatedUserData.userName);
        if (userIndex !== -1) {
          newUsers[userIndex] = { ...newUsers[userIndex], ...updatedUserData };
        } else {
          newUsers.push(updatedUserData);
        }
        return newUsers;
      });
      if (selectedUser && selectedUser.userName === updatedUserData.userName) {
        setSelectedUser(updatedUserData);
      }
    });

    socket.on('receive-message', (messageData) => {
      if (messageData.to !== userData.userName) return;

      requestAnimationFrame(() => {
        setOnline(prev => {
          const newUsers = [...prev];
          const userIndex = newUsers.findIndex(user => user.userName === messageData.user);

          if (userIndex !== -1) {
            const updatedUser = { ...newUsers[userIndex] };
            if (!updatedUser.chatWindow) updatedUser.chatWindow = [];
            else updatedUser.chatWindow = updatedUser.chatWindow.slice();

            const messageExists = updatedUser.chatWindow.some(m => m.id === messageData.id);
            if (!messageExists) {
              updatedUser.chatWindow.push(messageData);
              newUsers[userIndex] = updatedUser;

              if (selectedUser?.userName === messageData.user) {
                setTimeout(() => setSelectedUser(updatedUser), 10);
                markMessagesAsRead(messageData.user);
              }
            }
          }
          return newUsers;
        });
      });

      if ((!selectedUser || selectedUser.userName !== messageData.user) && notificationSound) {
        try {
          const audio = new Audio('/Biscay_Essential_PH-1_Stock_Notification-642959-mobiles24.mp3');
          audio.play().catch(e => { });
        } catch (error) { }
      }
    });

    socket.on("call-user", handleIncomingCall);
    socket.on("call-signal", handleCallSignal);

    return () => {
      socket.off("userUpdate");
      socket.off("UserDeleted");
      socket.off("user-online");
      socket.off("user-offline");
      socket.off("self-update");
      socket.off("conversation-update");
      socket.off("message-sent");
      socket.off("receive-message");
      socket.off("call-user");
      socket.off("call-signal");
    };
  }, [userData, selectedUser]);

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

  const debouncedMarkReadFuncs = {};

  const markMessagesAsRead = (fromUser) => {
    if (!userData || !fromUser) return;

    if (!debouncedMarkReadFuncs[fromUser]) {
      debouncedMarkReadFuncs[fromUser] = debounce((user) => {
        socket.emit('mark-messages-read', { from: user, to: userData.userName });


        setOnline(prev => {
          const newUsers = [...prev];
          const userIndex = newUsers.findIndex(u => u.userName === user);

          if (userIndex !== -1) {
            const updatedUser = JSON.parse(JSON.stringify(newUsers[userIndex]));
            if (updatedUser.chatWindow) {
              let hasUnreadMessages = false;
              updatedUser.chatWindow = updatedUser.chatWindow.map(msg => {
                if (msg.user === user && msg.to === userData.userName && !msg.read) {
                  hasUnreadMessages = true;
                  return { ...msg, read: true };
                }
                return msg;
              });

              if (hasUnreadMessages) {
                newUsers[userIndex] = updatedUser;
                if (selectedUser && selectedUser.userName === user) {
                  setSelectedUser(updatedUser);
                }
                return [...newUsers];
              }
            }
          }
          return prev;
        });
      }, 300);
    }
    debouncedMarkReadFuncs[fromUser](fromUser);
  };

  useEffect(() => {
    if (selectedUser && userData) {
      markMessagesAsRead(selectedUser.userName);
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
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [selectedUser, userData]);

  const getAvatar = (username, gender) => {
    if (!username) return null;
    const initials = username.slice(0, 2).toUpperCase();
    return `data:image/svg+xml,${encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${gender?.toLowerCase() === 'female' ? '#9733EE' : '#2193b0'}" />
            <stop offset="100%" stop-color="${gender?.toLowerCase() === 'female' ? '#DA22FF' : '#6dd5ed'}" />
          </linearGradient>
        </defs>
        <rect width="100" height="100" fill="url(#grad)" />
        <text x="50" y="50" dy="0.35em" font-family="Arial, sans-serif" font-size="40" font-weight="bold" text-anchor="middle" fill="#ffffff">${initials}</text>
      </svg>
    `)}`;
  };

  const getFilteredUsers = () => {
    let filteredUsers = onlineUsers;
    if (genderFilter !== 'all') {
      filteredUsers = filteredUsers.filter(user => user.Gender?.toLowerCase() === genderFilter.toLowerCase());
    }
    if (regionFilter !== 'all') {
      filteredUsers = filteredUsers.filter(user => user.region?.toLowerCase() === regionFilter.toLowerCase());
    }

    if (regionFilter === 'all' && userData?.region && userData.region !== 'Unknown') {
      filteredUsers.sort((a, b) => {
        // Priority 1: Unread messages
        const aUnread = getUnreadCount(a);
        const bUnread = getUnreadCount(b);
        if (aUnread > 0 && bUnread === 0) return -1;
        if (bUnread > 0 && aUnread === 0) return 1;

        // Priority 2: Recent activity (last message time)
        const aLastMsg = a.chatWindow?.length ? new Date(a.chatWindow[a.chatWindow.length - 1].timestamp).getTime() : 0;
        const bLastMsg = b.chatWindow?.length ? new Date(b.chatWindow[b.chatWindow.length - 1].timestamp).getTime() : 0;
        if (aLastMsg !== bLastMsg) return bLastMsg - aLastMsg;

        // Priority 3: Region/Country match
        if (userData.region && userData.region !== 'Unknown') {
          const aFromSameRegion = a.region?.toLowerCase() === userData.region.toLowerCase();
          const bFromSameRegion = b.region?.toLowerCase() === userData.region.toLowerCase();
          if (aFromSameRegion && !bFromSameRegion) return -1;
          if (!aFromSameRegion && bFromSameRegion) return 1;
        }

        // Priority 4: Online status
        if (a.online && !b.online) return -1;
        if (!a.online && b.online) return 1;

        return 0;
      });
    }
    return filteredUsers;
  };

  const verifyUserExists = async () => {
    if (!userData) return false;
    try {
      if (!userData.country || !userData.region) {
        try {
          const geoResponse = await fetch('https://ipapi.co/json/');
          const geoData = await geoResponse.json();
          userData.country = geoData.country_name || 'Unknown';
          userData.region = geoData.region || 'Unknown';
          localStorage.setItem("guestSession", JSON.stringify(userData));
        } catch (geoError) {
          userData.country = userData.country || 'Unknown';
          userData.region = userData.region || 'Unknown';
        }
      }

      const getBaseUrl = () => {
        if (typeof window !== 'undefined') {
          const { protocol, hostname, port } = window.location;
          if (hostname === 'localhost') return `${protocol}//${hostname}:5000`;
          return `${protocol}//${hostname}${port ? ':' + port : ''}`;
        }
        return '';
      };

      if (!socket.connected) {
        socket.connect();
        await new Promise((resolve) => {
          const timeout = setTimeout(() => resolve(false), 3000);
          socket.once('connect', () => { clearTimeout(timeout); resolve(true); });
        });
        if (!socket.connected) return false;
      }

      const apiBaseUrl = getBaseUrl();
      try {
        const response = await fetch(`${apiBaseUrl}/check-user?userName=${userData.userName}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });
        const data = await response.json();

        if (!data.exists) {
          const completeUserData = {
            ...userData,
            userName: userData.userName,
            Age: userData.Age || 25,
            Gender: userData.Gender || 'Not specified',
            socketId: socket.id,
            online: true,
            country: userData.country || 'Unknown',
            region: userData.region || 'Unknown',
            lastSeen: new Date().toISOString()
          };
          localStorage.setItem("guestSession", JSON.stringify(completeUserData));

          return new Promise((resolve) => {
            let attempts = 0;
            const maxAttempts = 2;
            const attemptReconnect = () => {
              attempts++;
              const reconnectListener = (response) => {
                socket.off('reconnect-confirmed', reconnectListener);
                if (response.success) {
                  socket.emit('user-online', userData.userName);
                  resolve(true);
                } else {
                  if (attempts < maxAttempts) setTimeout(attemptReconnect, 1000);
                  else resolve(false);
                }
              };
              socket.on('reconnect-confirmed', reconnectListener);
              socket.emit('user-reconnect', completeUserData);
              setTimeout(() => {
                socket.off('reconnect-confirmed', reconnectListener);
                if (attempts < maxAttempts) attemptReconnect();
                else {
                  fetch(`${apiBaseUrl}/recreate-user`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(completeUserData),
                  }).then(res => res.json()).then(data => {
                    if (data.success) {
                      socket.emit('user-online', completeUserData);
                      resolve(true);
                    } else resolve(false);
                  }).catch(() => resolve(false));
                }
              }, 3000);
            };
            attemptReconnect();
          });
        }
        socket.emit('ping-user', userData.userName);
        socket.emit('user-online', userData.userName);
        return true;
      } catch (fetchError) {
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
      return false;
    }
  };

  const showSafetyDisclaimer = (actionType) => {
    const hasShownMessageDisclaimer = localStorage.getItem('hasShownMessageDisclaimer');
    const hasShownVideoDisclaimer = localStorage.getItem('hasShownVideoDisclaimer');

    if (actionType === 'message' && !hasShownMessageDisclaimer) {
      toast((t) => (
        <div className="p-2">
          <h3 className="font-bold text-destructive mb-1">⚠️ Safety Alert</h3>
          <p className="text-sm mb-2">Remember: You are chatting with strangers.</p>
          <div className="text-right">
            <button
              onClick={() => { localStorage.setItem('hasShownMessageDisclaimer', 'true'); toast.dismiss(t.id); }}
              className="bg-primary text-primary-foreground px-2 py-1 rounded text-xs"
            >I understand</button>
          </div>
        </div>
      ), { duration: 10000 });
    }

    if (actionType === 'video' && !hasShownVideoDisclaimer) {
      toast((t) => (
        <div className="p-2">
          <h3 className="font-bold text-destructive mb-1">⚠️ Video Call Warning</h3>
          <p className="text-sm mb-2">Be aware of what's visible in your background.</p>
          <div className="text-right">
            <button
              onClick={() => { localStorage.setItem('hasShownVideoDisclaimer', 'true'); toast.dismiss(t.id); }}
              className="bg-primary text-primary-foreground px-2 py-1 rounded text-xs"
            >I understand</button>
          </div>
        </div>
      ), { duration: 15000 });
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    const trimmedMessage = message.trim();
    if ((trimmedMessage === "" && !imageFile) || !selectedUser || !userData) return;

    showSafetyDisclaimer('message');

    try {
      const userExists = await verifyUserExists();
      if (!userExists) {
        toast.error("Session issue. Attempting reconnect...");
        if (!(await verifyUserExists())) {
          toast.error("Session failed. Refresh page.");
          return;
        }
      }

      const timestamp = new Date().toISOString();
      let imageUrl = null;
      const messageId = `${userData.userName}_${Date.now()}`;

      const createNewMessage = (imgUrl) => ({
        user: userData.userName,
        to: selectedUser.userName,
        message: trimmedMessage,
        imageUrl: imgUrl,
        timestamp: timestamp,
        id: messageId
      });

      const optimisticUpdate = () => {
        const optimisticMessage = { ...createNewMessage(imageUrl), read: true };
        setOnline(prev => {
          const newUsers = [...prev];
          const indices = [selectedUser.userName, userData.userName].map(n => newUsers.findIndex(u => u.userName === n));
          indices.forEach(idx => {
            if (idx !== -1) newUsers[idx] = { ...newUsers[idx], online: true, lastSeen: new Date().toISOString() };
          });
          return newUsers;
        });
        setSelectedUser(prev => ({ ...prev, online: true, lastSeen: new Date().toISOString() }));

        setOnline(prev => {
          const newUsers = [...prev];
          const userIndex = newUsers.findIndex(u => u.userName === selectedUser.userName);
          if (userIndex !== -1) {
            const updatedUser = JSON.parse(JSON.stringify(newUsers[userIndex]));
            if (!updatedUser.chatWindow) updatedUser.chatWindow = [];
            updatedUser.chatWindow.push(optimisticMessage);
            newUsers[userIndex] = updatedUser;
            setSelectedUser(updatedUser);
          }
          return newUsers;
        });

        setMessage("");

        // Play sent sound (tick)
        try {
          const audio = new Audio('/mark-read-sound.mp3');
          audio.volume = 0.5;
          audio.play().catch(e => { });
        } catch (error) { }

        setTimeout(() => messageEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
      };

      if (imageFile) {
        setIsUploading(true);
        try {
          const formData = new FormData();
          formData.append('image', imageFile);
          const response = await fetch('http://localhost:5000/upload', {
            method: 'POST', body: formData, mode: 'cors', credentials: 'omit', headers: { 'Accept': 'application/json' }
          });
          if (!response.ok) throw new Error('Upload failed');
          const data = await response.json();
          imageUrl = data.imageUrl;
          optimisticUpdate();
          sendMessageWithRetry(createNewMessage(imageUrl));
        } catch (error) {
          console.error("Upload error", error);
          toast.error("Image upload failed");
        } finally {
          setIsUploading(false);
          setImageFile(null);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      } else {
        optimisticUpdate();
        sendMessageWithRetry(createNewMessage(null));
      }
      inputRef.current?.focus();
    } catch (error) {
      console.error("Send error", error);
      toast.error("Failed to send");
    }
  };

  const sendMessageWithRetry = (messageData, attempts = 0) => {
    const maxAttempts = 3;
    socket.emit("send-message", messageData);
    const messageConfirmationListener = (response) => {
      if (response.messageId === messageData.id) {
        socket.off('message-sent', messageConfirmationListener);
      } else if (!response.success && attempts < maxAttempts) {
        setTimeout(() => sendMessageWithRetry(messageData, attempts + 1), 1000 * (attempts + 1));
      } else if (!response.success) {
        toast.error("Message delivery failed");
      }
    };
    socket.on('message-sent', messageConfirmationListener);
    setTimeout(() => socket.off('message-sent', messageConfirmationListener), 10000);
  };

  const isMessageFromMe = (msg) => msg?.user === userData?.userName;
  const formatMessageTime = (ts) => { try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  const formatLastSeen = (ts) => {
    if (!ts) return 'Unknown';
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return 'Unknown';
      const diff = Math.floor((new Date() - d) / 1000);
      if (diff < 30) return 'Online';
      if (diff < 60) return 'Just now';
      const m = Math.floor(diff / 60);
      if (m < 60) return `${m}m ago`;
      const h = Math.floor(m / 60);
      return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
    } catch { return 'Unknown'; }
  };

  const getUnreadCount = (user) => user?.chatWindow?.filter(msg => !isMessageFromMe(msg) && !msg.read).length || 0;
  const getUnreadMessageInfo = (user) => {
    if (!user?.chatWindow) return { count: 0, latestMessage: null };
    const unread = user.chatWindow.filter(msg => !isMessageFromMe(msg) && !msg.read);
    return { count: unread.length, latestMessage: unread.length > 0 ? unread[unread.length - 1] : null };
  };

  const getConversation = React.useCallback(() => {
    if (!selectedUser?.chatWindow || !userData) return [];
    return selectedUser.chatWindow.filter(msg =>
      (msg.user === userData.userName && msg.to === selectedUser.userName) ||
      (msg.user === selectedUser.userName && msg.to === userData.userName)
    );
  }, [selectedUser?.chatWindow, userData?.userName, selectedUser?.userName]);

  const renderMessages = () => {
    if (!selectedUser) return null;
    const conversation = getConversation();
    if (!conversation?.length) return null;

    return (conversation.length > 50 ? conversation.slice(-50) : conversation).map((msg, index) => {
      const isMe = isMessageFromMe(msg);
      return (
        <div key={msg.id || index} className={`flex ${isMe ? "justify-end" : "justify-start"} mb-4`}>
          {!isMe && (
            <div className="mr-2 flex-shrink-0">
              <img src={getAvatar(msg.user, selectedUser?.Gender)} className="w-8 h-8 rounded-full shadow-sm" alt="User" />
            </div>
          )}
          <div className={`max-w-[75%] lg:max-w-[60%] px-4 py-3 rounded-2xl shadow-sm ${isMe
            ? "bg-primary text-primary-foreground rounded-tr-none"
            : "bg-white text-gray-800 border border-gray-100 rounded-tl-none"
            }`}>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.message}</p>
            {msg.imageUrl && (
              <div className="mt-2 mb-1">
                <img src={msg.imageUrl} className="rounded-lg max-w-full max-h-60 object-contain cursor-pointer transition-transform hover:scale-[1.02]" onClick={() => window.open(msg.imageUrl, '_blank')} />
              </div>
            )}
            <div className={`flex items-center justify-end mt-1 space-x-1 text-[10px] ${isMe ? 'text-primary-foreground/70' : 'text-gray-400'}`}>
              <span>{formatMessageTime(msg.timestamp)}</span>
              {isMe && (
                <span>{msg.read ? <CheckCheck className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5 opacity-70" />}</span>
              )}
            </div>
          </div>
        </div>
      );
    });
  };

  const handleEmojiClick = (emojiObj) => {
    const emoji = emojiObj.emoji;
    const cursor = inputRef.current.selectionStart;
    setMessage(message.slice(0, cursor) + emoji + message.slice(cursor));
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(cursor + emoji.length, cursor + emoji.length);
    }, 10);
    setShowEmojiPicker(false);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.match('image.*')) { toast.error('Images only'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Max 5MB'); return; }
    setImageFile(file);
    toast.custom((t) => (
      <div className="bg-card p-4 rounded-xl shadow-xl border border-border max-w-sm">
        <div className="flex gap-3">
          <div className="text-amber-500"><AlertCircle /></div>
          <div>
            <h4 className="font-bold text-foreground">Safety First</h4>
            <p className="text-xs text-muted-foreground mt-1">Don't share sensitive photos. We can't guarantee privacy.</p>
            <button onClick={() => toast.dismiss(t.id)} className="mt-2 text-xs bg-primary text-primary-foreground px-2 py-1 rounded">Got it</button>
          </div>
        </div>
      </div>
    ), { duration: 5000 });
  };

  const captureImage = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment';
    input.onchange = handleFileChange;
    input.click();
  };

  const handleIncomingCall = (data) => {
    if (data.to !== userData?.userName) return;
    if (showVideoCall) {
      socket.emit("user-not-available", { caller: data.from, callee: userData.userName });
      return;
    }
    setIncomingCall({ from: data.from });
    try {
      window.incomingCallAudio = new Audio('/call-ringtone.mp3');
      window.incomingCallAudio.loop = true;
      window.incomingCallAudio.play().catch(() => { });
    } catch (e) { }
    setShowVideoCall(true);
  };

  const handleCallSignal = (data) => {
    if (data.to !== userData?.userName) return;
    setIncomingCall(prev => ({ ...prev, from: data.from, signalData: data.signalData }));
  };

  const startVideoCall = () => {
    socket.emit('start-call', { from: userData.userName, to: selectedUser.userName, callType: 'video' });
    setOutgoingCall(true);
    setShowVideoCall(true);
  };

  const closeVideoCall = () => {
    setShowVideoCall(false); setIncomingCall(null); setOutgoingCall(false);
    if (window.incomingCallAudio) { window.incomingCallAudio.pause(); window.incomingCallAudio = null; }
  };

  useEffect(() => {
    if (!selectedUser || !userData) return;
    const interval = setInterval(() => {
      socket.emit("ping-user", userData.userName);
      socket.emit("refresh-user-status", { userName: selectedUser.userName, requester: userData.userName });
    }, 20000);
    const handleS = (stat) => {
      if (stat.userName === selectedUser?.userName && stat.online !== selectedUser.online) {
        setSelectedUser(p => ({ ...p, online: stat.online, lastSeen: stat.lastSeen || p.lastSeen }));
        setOnline(prev => prev.map(u => u.userName === selectedUser.userName ? { ...u, online: stat.online, lastSeen: stat.lastSeen || u.lastSeen } : u));
      }
    };
    socket.on("user-online-status", handleS);
    return () => { clearInterval(interval); socket.off("user-online-status", handleS); };
  }, [selectedUser, userData]);

  useEffect(() => {
    if (userData?.userName) {
      updateSocketUser(userData.userName);
      socket.emit("ping-user", userData.userName);
      socket.emit("user-online", userData.userName);
      const hNF = async () => { if (await verifyUserExists()) socket.emit("user-online", userData.userName); };
      socket.on("user-not-found", hNF);
      return () => socket.off("user-not-found", hNF);
    }
  }, [userData]);

  useEffect(() => {
    if (selectedUser && userData) {
      const i = setInterval(() => socket.emit("check-user-online", { userName: selectedUser.userName }), 15000);
      return () => clearInterval(i);
    }
  }, [selectedUser, userData]);

  useEffect(() => {
    const t = onlineUsers.reduce((a, u) => a + getUnreadCount(u), 0);
    document.title = t > 0 ? `(${t}) ChatUp` : `ChatUp`;
  }, [onlineUsers]);

  useEffect(() => {
    const hR = async () => { if (await verifyUserExists()) { socket.emit('user-online', userData); getOnlineData(true); } };
    socket.on('connect', hR);
    return () => socket.off('connect', hR);
  }, [userData]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
          <p className="text-muted-foreground text-sm">Loading your chats...</p>
        </div>
      </div>
    );
  }

  // --- JSX Section (Redesigned) ---

  // Custom CheckIcon to avoid naming conflict
  const CheckCircle2 = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );

  return (
    <>
      <Head><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0" /></Head>
      <div className="flex h-screen overflow-hidden bg-background">

        {/* Sidebar */}
        <div className={`
          absolute inset-y-0 left-0 z-50 w-80 bg-card border-r border-border shadow-2xl transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0
          ${showMobileSidebar ? 'translate-x-0' : '-translate-x-full'}
        `}>
          <div className="h-full flex flex-col">
            {/* Sidebar Header */}
            <div className="p-4 border-b border-border bg-gradient-to-r from-primary/10 to-transparent">
              <div className="flex items-center gap-3 mb-4">
                <div className="relative">
                  <img src={getAvatar(userData?.userName, userData?.Gender)} className="w-12 h-12 rounded-full ring-2 ring-background shadow-md" alt="Me" />
                  <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full ring-2 ring-white"></div>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-foreground truncate">{userData?.userName}</h3>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> Online
                  </p>
                </div>
                <button onClick={() => setNotificationSound(!notificationSound)} className={`p-2 rounded-full transition-colors ${notificationSound ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                  {notificationSound ? <Bell size={18} /> : <BellOff size={18} />}
                </button>
                <button onClick={() => { localStorage.removeItem("guestSession"); router.push('/'); }} className="p-2 rounded-full bg-destructive/10 text-destructive hover:bg-destructive/20 ml-1">
                  <LogOut size={18} />
                </button>
              </div>

              {/* Filters */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                  <Filter size={14} className="text-muted-foreground flex-shrink-0" />
                  {['all', 'male', 'female'].map(g => (
                    <button
                      key={g}
                      onClick={() => setGenderFilter(g)}
                      className={`px-3 py-1 rounded-full text-xs font-medium capitalize transition-all ${genderFilter === g ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                  <MapPin size={14} className="text-muted-foreground flex-shrink-0" />
                  <button onClick={() => setRegionFilter('all')} className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all ${regionFilter === 'all' ? 'bg-secondary text-secondary-foreground' : 'bg-muted text-muted-foreground'}`}>Global</button>
                  {userData?.region && (
                    <button onClick={() => setRegionFilter(userData.region.toLowerCase())} className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all ${regionFilter !== 'all' ? 'bg-secondary text-secondary-foreground' : 'bg-muted text-muted-foreground'}`}>Nearby</button>
                  )}
                </div>
              </div>
            </div>

            {/* User List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider flex justify-between">
                <span>Active Users</span>
                <span className="bg-primary/10 text-primary px-1.5 rounded-md">{getFilteredUsers().length}</span>
              </div>

              {getFilteredUsers().length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground opacity-50">
                  <UserIcon size={40} className="mb-2" />
                  <p className="text-sm">No active users</p>
                </div>
              ) : (
                getFilteredUsers().map(user => {
                  const unread = getUnreadCount(user);
                  const { latestMessage } = getUnreadMessageInfo(user);
                  const isSelected = selectedUser?._id === user._id;

                  return (
                    <div
                      key={user._id}
                      onClick={() => { setSelectedUser(user); setShowMobileSidebar(false); }}
                      className={`group flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all ${isSelected ? 'bg-primary/10 border-l-4 border-primary' : 'hover:bg-muted/50 border-l-4 border-transparent'}`}
                    >
                      <div className="relative">
                        <img src={getAvatar(user.userName, user.Gender)} className="w-10 h-10 rounded-full object-cover" alt={user.userName} />
                        <div className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-card ${user.online ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-baseline">
                          <h4 className={`text-sm font-semibold truncate ${isSelected ? 'text-primary' : 'text-foreground'}`}>{user.userName}</h4>
                          {user.online && <span className="text-[10px] text-green-500 font-medium ml-1">ON</span>}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {latestMessage ? (
                            <span className={unread > 0 ? "font-semibold text-foreground" : ""}>
                              {isMessageFromMe(latestMessage) && "You: "}{latestMessage.message || "Sent an image"}
                            </span>
                          ) : (
                            <span className="capitalize">{user.Gender} • {user.Age} • {user.country || 'Unknown'}</span>
                          )}
                        </p>
                      </div>
                      {unread > 0 && <span className="bg-destructive text-destructive-foreground text-[10px] font-bold h-5 w-5 rounded-full flex items-center justify-center">{unread}</span>}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Close Mobile Sidebar */}
          <button onClick={() => setShowMobileSidebar(false)} className="md:hidden absolute top-2 right-2 p-2 bg-white/80 rounded-full text-gray-800 shadow-sm"><X size={20} /></button>
        </div>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col w-full relative bg-gray-50/50">
          {/* Background Decoration */}
          <div className="absolute inset-0 z-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 10px 10px, #6366f1 1px, transparent 0)', backgroundSize: '30px 30px' }}></div>

          {selectedUser ? (
            <>
              {/* Chat Header */}
              <div className="relative z-10 px-4 py-3 bg-white/80 backdrop-blur-md border-b border-gray-200 flex items-center justify-between shadow-sm sticky top-0">
                <div className="flex items-center gap-3">
                  <button onClick={() => setShowMobileSidebar(true)} className="md:hidden p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-full"><ArrowLeft size={20} /></button>
                  <div className="relative">
                    <img src={getAvatar(selectedUser.userName, selectedUser.Gender)} className="w-10 h-10 rounded-full ring-2 ring-white shadow-sm" alt="User" />
                    <div className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-white ${selectedUser.online ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                  </div>
                  <div>
                    <h2 className="font-bold text-gray-900 text-sm md:text-base leading-tight">{selectedUser.userName}</h2>
                    <p className="text-xs text-gray-500 flex items-center gap-1">
                      {selectedUser.online ? <><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span> Online</> : `Last seen ${formatLastSeen(selectedUser.lastSeen)}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={selectedUser.online ? "primary" : "secondary"}
                    onClick={startVideoCall}
                    disabled={!selectedUser.online}
                    className="rounded-full shadow-lg shadow-primary/20"
                  >
                    <Video size={16} className="md:mr-1.5" />
                    <span className="hidden md:inline">Call</span>
                  </Button>
                </div>
              </div>

              {/* Messages */}
              <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 z-0 space-y-1 relative">
                {renderMessages()}
                <div ref={messageEndRef} />
              </div>

              {showScrollButton && (
                <button onClick={() => messageEndRef.current?.scrollIntoView({ behavior: 'smooth' })} className="absolute bottom-20 right-4 z-20 p-2 bg-primary text-primary-foreground rounded-full shadow-xl animate-bounce">
                  <ArrowLeft size={20} className="-rotate-90" />
                </button>
              )}

              {/* Input Area */}
              <div className="p-4 bg-white border-t border-gray-200 z-10">
                <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto relative flex items-end gap-2">
                  {/* Emoji & Attachments */}
                  <div className="flex gap-1 pb-2">
                    <button type="button" onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="p-2 text-gray-500 hover:text-primary hover:bg-primary/10 rounded-full transition-colors"><Smile size={20} /></button>
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="p-2 text-gray-500 hover:text-primary hover:bg-primary/10 rounded-full transition-colors md:block hidden"><Paperclip size={20} /></button>
                    <button type="button" onClick={captureImage} className="p-2 text-gray-500 hover:text-primary hover:bg-primary/10 rounded-full transition-colors md:hidden"><ImageIcon size={20} /></button>
                  </div>

                  {showEmojiPicker && (
                    <div ref={emojiPickerRef} className="absolute bottom-16 left-0 z-50 shadow-2xl rounded-2xl overflow-hidden">
                      <EmojiPicker onEmojiClick={handleEmojiClick} width={300} height={400} />
                    </div>
                  )}

                  <div className="flex-1 bg-gray-100 rounded-2xl flex items-center px-4 py-2 focus-within:ring-2 focus-within:ring-primary/20 focus-within:bg-white transition-all">
                    {imageFile && (
                      <div className="mr-2 relative group">
                        <div className="bg-primary/10 text-primary text-xs px-2 py-1 rounded flex items-center gap-1">
                          <ImageIcon size={12} /> Image <button onClick={() => setImageFile(null)} className="ml-1 hover:text-destructive"><X size={10} /></button>
                        </div>
                      </div>
                    )}
                    <input
                      ref={inputRef}
                      value={message}
                      onChange={e => setMessage(e.target.value)}
                      className="bg-transparent border-none appearance-none focus:ring-0 w-full py-1 text-gray-800 placeholder-gray-400 text-sm"
                      placeholder="Message..."
                    />
                  </div>

                  <Button type="submit" size="icon" disabled={!message.trim() && !imageFile} className="rounded-full w-10 h-10 p-0 shadow-md shadow-primary/30 flex items-center justify-center flex-shrink-0">
                    {isUploading ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} className="translate-x-0.5 translate-y-0.5" />}
                  </Button>
                  <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
                </form>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-gray-50/50">
              <div className="w-24 h-24 flex items-center justify-center mb-6">
                <img src="/image.png" alt="ChatUp Logo" className="w-full h-full object-contain drop-shadow-xl animate-pulse" />
              </div>
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Welcome, {userData?.userName}!</h2>
              <p className="text-gray-500 max-w-sm mx-auto mb-8">Select a conversation from the sidebar to start chatting, or wait for someone to join.</p>
              <Button onClick={() => setShowMobileSidebar(true)} className="md:hidden" variant="outline">
                View Online Users
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Video Call Modal */}
      {showVideoCall && (
        <VideoChat
          socket={socket} selectedUser={selectedUser} userData={userData}
          onClose={closeVideoCall} initiateCall={outgoingCall} incomingCall={incomingCall}
          onCallEnded={closeVideoCall}
        />
      )}
    </>
  );
};

export default ChatPage;