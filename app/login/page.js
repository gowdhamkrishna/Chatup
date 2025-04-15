"use client"
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import socket from '@/sockClient';
import { toast, ToastContainer } from 'react-toastify';
import Loader from '../components/Loader';
import { FiCheckCircle, FiAlertCircle, FiUser, FiCalendar, FiArrowDown } from 'react-icons/fi';
import Image from 'next/image';
import Head from 'next/head';


export default function LoginPage() {


    const router = useRouter();
    const [formData, setFormData] = useState({
      userName: '',
      Age: '',
      Gender: '',
    });
    const [usernameError, setUsernameError] = useState('');
    const [showLoader, setLoader] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState('checking'); // 'checking', 'connected', 'error'
  
    // Username policy constants
    const MIN_USERNAME_LENGTH = 5;
    const MAX_USERNAME_LENGTH = 15;
    const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;
    const ageOptions = Array.from({ length: 83 }, (_, i) => i + 18);
  
    // Modified connection timeout for mobile devices
    const CONNECTION_TIMEOUT = 15000; // 15 seconds for slower mobile connections
  
    useEffect(() => {
      // Set up socket listeners once when component mounts
      const onUserExist = () => {
        toast.error(`Username "${formData.userName}" is already taken`, {
          toastId: "username-taken-error"
        });
        setLoader(false);
      };
  
      const onUserAdded = (userData) => {
        try {
          // Make sure we save the data from the server, not just our form data
          const userToSave = userData || formData;
          localStorage.setItem("guestSession", JSON.stringify(userToSave));
          router.push('/chat');
        } catch (error) {
          console.error("Failed to save session data:", error);
          toast.error("Failed to save your session. Please try again.");
          setLoader(false);
        }
      };
      
      // Set up server error handler
      const onServerError = (error) => {
        console.error("Server error:", error);
        toast.error(error.message || "Server error. Please try again later.");
        setLoader(false);
      };
  
      socket.on('UserExist', onUserExist);
      socket.on('userAdded', onUserAdded);
      socket.on('serverError', onServerError);
  
      // Clean up listeners when component unmounts
      return () => {
        socket.off('UserExist', onUserExist); 
        socket.off('userAdded', onUserAdded);
        socket.off('serverError', onServerError);
      };
    }, [formData, router]);
  
    useEffect(() => {
      const userExistString = localStorage.getItem("guestSession");
      
      if (userExistString) {
        try {
          // Parse the user data and show loader
          const userData = JSON.parse(userExistString);
          setLoader(true);
          
          // Set up one-time event listeners for this connection attempt
          const onConnectionRefused = () => {
            console.log("Connection refused - user no longer exists");
            toast.error("Your session has expired. Please log in again.");
            localStorage.removeItem("guestSession");
            setLoader(false);
          };
          
          const onConnectionAccepted = () => {
            console.log("Connection accepted - user exists");
            router.push('/chat');
          };
          
          // Set up the listeners
          socket.once("ConnectionRefused", onConnectionRefused);
          socket.once("ConnectionAccepted", onConnectionAccepted);
          
          // Emit the connection attempt with the stored user data
          socket.emit("AlreadyGuest", userData);
          
          // Set a timeout to handle no response from server
          const timeoutId = setTimeout(() => {
            // If we haven't heard back in 5 seconds, clean up
            socket.off("ConnectionRefused", onConnectionRefused);
            socket.off("ConnectionAccepted", onConnectionAccepted);
            toast.error("Connection timed out. Please try again.");
            setLoader(false);
          }, 5000);
          
          // Clean up on unmount
          return () => {
            clearTimeout(timeoutId);
            socket.off("ConnectionRefused", onConnectionRefused);
            socket.off("ConnectionAccepted", onConnectionAccepted);
          };
          
        } catch (error) {
          console.error("Failed to parse user data from localStorage:", error);
          toast.error("Invalid session data. Please log in again.");
          localStorage.removeItem("guestSession");
        }
      }
    }, [router]);
  
    // Check connection status on load
    useEffect(() => {
      // Check if socket is connected
      if (socket.connected) {
        setConnectionStatus('connected');
      } else {
        setConnectionStatus('checking');
        
        // Set up event listeners for connection status
        const onConnect = () => {
          console.log('Socket connected');
          setConnectionStatus('connected');
        };
        
        const onConnectError = (error) => {
          console.error('Socket connection error:', error);
          setConnectionStatus('error');
          toast.error(`Connection error: ${error.message || 'Could not connect to server'}`);
        };
        
        const onDisconnect = (reason) => {
          console.log('Socket disconnected:', reason);
          setConnectionStatus('error');
          if (reason === 'io server disconnect') {
            toast.error('Disconnected by server. Please refresh.');
          } else if (reason === 'transport close') {
            toast.error('Connection lost. Please check your network.');
          }
        };
        
        // Add event listeners
        socket.on('connect', onConnect);
        socket.on('connect_error', onConnectError);
        socket.on('disconnect', onDisconnect);
        
        // If not connected, try to connect
        if (!socket.connected) {
          socket.connect();
          
          // Set a timeout to check connection status
          const timeoutId = setTimeout(() => {
            if (!socket.connected) {
              setConnectionStatus('error');
              toast.error('Connection timeout. Server may be unavailable.');
            }
          }, 5000);
          
          // Clean up timeout
          return () => {
            clearTimeout(timeoutId);
            socket.off('connect', onConnect);
            socket.off('connect_error', onConnectError);
            socket.off('disconnect', onDisconnect);
          };
        }
        
        // Clean up event listeners
        return () => {
          socket.off('connect', onConnect);
          socket.off('connect_error', onConnectError);
          socket.off('disconnect', onDisconnect);
        };
      }
    }, []);
  
    const validateUsername = (username) => {
      if (!username.trim()) return "";
      if (username.length < MIN_USERNAME_LENGTH) {
        return `Username must be at least ${MIN_USERNAME_LENGTH} characters long`;
      }
      if (username.length > MAX_USERNAME_LENGTH) {
        return `Username cannot exceed ${MAX_USERNAME_LENGTH} characters`;
      }
      if (!USERNAME_PATTERN.test(username)) {
        return "Username can only contain letters, numbers, and underscores";
      }
      return "";
    };
  
    const handleChange = (e) => {
      const { name, value } = e.target;
      
      // Special handling for username to validate in real-time
      if (name === 'userName') {
        const error = validateUsername(value);
        setUsernameError(error);
      }
      
      setFormData(prevState => ({
        ...prevState,
        [name]: value
      }));
    };
  
    const handleSubmit = (e) => {
      e.preventDefault();
      
      // Validate username
      const usernameValidationError = validateUsername(formData.userName);
      if (usernameValidationError) {
        setUsernameError(usernameValidationError);
        toast.error(usernameValidationError);
        return;
      }
      
      // Validate other fields
      if (!formData.userName.trim()) {
        toast.error("Username is required");
        return;
      }
      
      if (!formData.Age) {
        toast.error("Please select your age");
        return;
      }
      
      if (!formData.Gender) {
        toast.error("Please select your gender");
        return;
      }

      // Show loader and attempt connection
      setLoader(true);
      
      // Create a connection timeout
      const connectionTimeout = setTimeout(() => {
        toast.error("Connection timed out. Please try again later.");
        setLoader(false);
      }, CONNECTION_TIMEOUT);
      
      // Set up a one-time handler for connection errors
      const connectionErrorHandler = (error) => {
        clearTimeout(connectionTimeout);
        console.error("Connection error:", error);
        toast.error("Unable to connect to the server. Please try again later.");
        setLoader(false);
      };
      
      // Listen for connection errors just during this connection attempt
      socket.once("connect_error", connectionErrorHandler);
      socket.once("connect_timeout", connectionErrorHandler);
      
      // Create sanitized user data
      const sanitizedData = {
        ...formData,
        userName: formData.userName.trim(),
        Age: Number(formData.Age),
        online: true,
        lastSeen: new Date().toISOString()
      };
      
      // Emit the connection event
      socket.emit("connected", sanitizedData);
      
      // Clean up the error handler when component unmounts
      return () => {
        clearTimeout(connectionTimeout);
        socket.off("connect_error", connectionErrorHandler);
        socket.off("connect_timeout", connectionErrorHandler);
      };
    };

    // Generate avatar preview based on username and gender
    const getAvatarPreview = (username, gender) => {
      if (!username) return null;
      
      // Get the first 2 letters (or just 1 if username is only 1 character)
      const initials = username.slice(0, 2).toUpperCase();
      
      // Create different background colors based on gender
      let bgColor;
      if (gender && gender.toLowerCase() === 'female') {
        // Female color scheme - purple/pink gradient
        bgColor = 'linear-gradient(135deg, #9733EE 0%, #DA22FF 100%)';
      } else if (gender && gender.toLowerCase() === 'male') {
        // Male color scheme - blue gradient
        bgColor = 'linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)';
      } else {
        // Neutral/other color scheme
        bgColor = 'linear-gradient(135deg, #8E2DE2 0%, #4A00E0 100%)';
      }
      
      // Create a data URI for the avatar
      return `data:image/svg+xml,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
          <defs>
            <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="${gender && gender.toLowerCase() === 'female' ? '#9733EE' : (gender && gender.toLowerCase() === 'male' ? '#2193b0' : '#8E2DE2')}" />
              <stop offset="100%" stop-color="${gender && gender.toLowerCase() === 'female' ? '#DA22FF' : (gender && gender.toLowerCase() === 'male' ? '#6dd5ed' : '#4A00E0')}" />
            </linearGradient>
          </defs>
          <rect width="100" height="100" fill="url(#grad)" />
          <text x="50" y="50" dy="0.35em" 
            font-family="Arial, sans-serif" 
            font-size="40" 
            font-weight="bold" 
            text-anchor="middle" 
            fill="#ffffff">
            ${initials}
          </text>
        </svg>
      `)}`;
    };

    // Function to test server connection
    const testServerConnection = async () => {
      // Don't test if already connected
      if (connectionStatus === 'connected') return;
      
      setConnectionStatus('checking');
      
      try {
        // Get server URL
        const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
        const healthUrl = `http://${hostname}:5000/health`;
        
        // Show testing toast
        toast.info(`Testing connection to ${healthUrl}...`);
        
        // Try to fetch the health endpoint
        const response = await fetch(healthUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          mode: 'cors',
          cache: 'no-cache',
          credentials: 'same-origin',
          timeout: 5000
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Server health check successful:', data);
        
        // Show success toast with connection details
        toast.success(`Connected to server! Server uptime: ${Math.floor(data.uptime / 60)} minutes. Your IP: ${data.clientIP}`);
        
        // Try reconnecting the socket
        if (!socket.connected) {
          socket.connect();
        }
        
        setConnectionStatus('connected');
      } catch (error) {
        console.error('Server health check failed:', error);
        setConnectionStatus('error');
        toast.error(`Connection test failed: ${error.message}`);
      }
    };

  return (  
    <>
      {/* Add meta tags for mobile viewport */}
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0" />
        <meta name="theme-color" content="#6366F1" />
      </Head>
      
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 animate-gradient-x p-4">
        <ToastContainer 
          position="top-center" 
          autoClose={5000}
          hideProgressBar={false}
          newestOnTop
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
        />
        {showLoader && <Loader />}
        
        <div className="bg-white p-6 md:p-10 rounded-2xl shadow-2xl w-full max-w-md transform transition-all hover:shadow-3xl duration-300 backdrop-blur-sm bg-opacity-90">
          <div className="text-center mb-10">
            <h1 className="text-4xl font-bold text-gray-900 mb-2 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Welcome Back
            </h1>
            <p className="text-gray-600 font-medium">Join our community</p>
            
            {/* Connection status indicator */}
            <div className="mt-2">
              {connectionStatus === 'checking' && (
                <div className="flex items-center justify-center text-yellow-500">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span className="text-xs">Connecting to server...</span>
                </div>
              )}
              {connectionStatus === 'connected' && (
                <div className="flex items-center justify-center text-green-500">
                  <svg className="h-4 w-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                  </svg>
                  <span className="text-xs">Connected to server</span>
                </div>
              )}
              {connectionStatus === 'error' && (
                <div className="flex flex-col items-center text-red-500">
                  <div className="flex items-center justify-center">
                    <svg className="h-4 w-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                    </svg>
                    <span className="text-xs">Connection error</span>
                  </div>
                  <button 
                    onClick={testServerConnection}
                    className="mt-2 px-3 py-1 text-xs font-medium text-white bg-blue-500 rounded-full hover:bg-blue-600 transition-colors"
                  >
                    Test Connection
                  </button>
                </div>
              )}
            </div>
            
            {/* Avatar Preview */}
            {formData.userName && (
              <div className="mt-6 flex flex-col items-center">
                <div className="w-20 h-20 rounded-full overflow-hidden mb-2">
                  <img 
                    src={getAvatarPreview(formData.userName, formData.Gender)}
                    alt="Avatar Preview"
                    className="w-full h-full object-cover"
                  />
                </div>
                <span className="text-sm text-gray-500">Avatar Preview</span>
              </div>
            )}
          </div>
          
          <form onSubmit={handleSubmit} className="space-y-5 md:space-y-7">
            <div className="space-y-6">
              <div>
                <label htmlFor="userName" className="block text-sm font-semibold text-gray-700 mb-3">
                  Username
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                    <FiUser className="h-5 w-5" />
                  </div>
                  <input
                    type="text"
                    id="userName"
                    name="userName"
                    value={formData.userName}
                    onChange={handleChange}
                    className={`w-full pl-10 pr-4 py-3.5 rounded-xl border-2 ${
                      usernameError 
                        ? 'border-red-300 focus:border-red-500' 
                        : 'border-gray-200 focus:border-blue-500'
                    } focus:ring-0 transition-all duration-200 outline-none shadow-sm placeholder-gray-400`}
                    placeholder="Enter your username"
                    required
                  />
                  {formData.userName && !usernameError && (
                    <span className="absolute right-3 top-3.5 text-green-500">
                      <FiCheckCircle className="h-6 w-6" />
                    </span>
                  )}
                  {usernameError && (
                    <span className="absolute right-3 top-3.5 text-red-500">
                      <FiAlertCircle className="h-6 w-6" />
                    </span>
                  )}
                </div>
                {usernameError && (
                  <p className="mt-2 text-sm text-red-600 font-medium">{usernameError}</p>
                )}
              </div>

              <div>
                <label htmlFor="Age" className="block text-sm font-semibold text-gray-700 mb-3">
                  Age
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                    <FiCalendar className="h-5 w-5" />
                  </div>
                  <select
                    id="Age"
                    name="Age"
                    value={formData.Age}
                    onChange={handleChange}
                    className="w-full pl-10 pr-4 py-3.5 rounded-xl border-2 border-gray-200 focus:border-blue-500 focus:ring-0 transition-all duration-200 outline-none shadow-sm appearance-none bg-white"
                    required
                  >
                    <option value="">Select Age</option>
                    {ageOptions.map((age) => (
                      <option key={age} value={age}>{age}</option>
                    ))}
                  </select>
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-gray-400">
                    <FiArrowDown className="h-5 w-5" />
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="Gender" className="block text-sm font-semibold text-gray-700 mb-3">
                  Gender
                </label>
                <div className="relative">
                  <select
                    id="Gender"
                    name="Gender"
                    value={formData.Gender}
                    onChange={handleChange}
                    className="w-full pl-10 pr-4 py-3.5 rounded-xl border-2 border-gray-200 focus:border-blue-500 focus:ring-0 transition-all duration-200 outline-none shadow-sm appearance-none bg-white"
                    required
                  >
                    <option value="">Select Gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                    <FiUser className="h-5 w-5" />
                  </div>
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-gray-400">
                    <FiArrowDown className="h-5 w-5" />
                  </div>
                </div>
              </div>
            </div>

            <button
              type="submit"
              className={`w-full py-3.5 md:py-4 px-6 rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2 transform transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] font-semibold text-white shadow-lg ${
                usernameError || connectionStatus !== 'connected'
                  ? 'bg-gray-300 cursor-not-allowed' 
                  : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 focus:ring-blue-500 shadow-blue-500/20'
              }`}
              disabled={!!usernameError || connectionStatus !== 'connected'}
            >
              Get Started
            </button>
            
            {connectionStatus === 'error' && (
              <div className="text-xs text-center mt-2 text-red-500">
                Server connection issue detected. The server may be offline or your network connection has problems.
                <div className="mt-1">
                  <span className="font-medium">Server URL:</span> {typeof window !== 'undefined' ? `${window.location.hostname}:5000` : 'Unknown'}
                </div>
                <div className="mt-2">
                  <button 
                    onClick={testServerConnection}
                    className="px-4 py-2 bg-blue-500 text-white text-xs font-medium rounded-lg hover:bg-blue-600 transition-colors"
                  >
                    Diagnose Connection
                  </button>
                </div>
              </div>
            )}
          </form>

          <div className="mt-8 text-center">
            <p className="text-sm text-gray-600">
              Already have an account?{' '}
              <a href="#" className="text-blue-600 hover:text-blue-700 font-semibold transition-colors duration-200 underline-offset-4 hover:underline">
                Sign in
              </a>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}