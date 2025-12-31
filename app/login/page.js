"use client"
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import socket from '@/app/lib/sockClient';
import { toast } from 'react-hot-toast';
import { User, Calendar, MapPin, Globe, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import Head from 'next/head';
import Card from '@/app/components/ui/Card';
import Input from '@/app/components/ui/Input';
import Button from '@/app/components/ui/Button';

export default function LoginPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    userName: '',
    Age: '',
    Gender: '',
    country: '',
    region: ''
  });
  const [usernameError, setUsernameError] = useState('');
  const [showLoader, setLoader] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('checking'); // 'checking', 'connected', 'error'
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Username policy constants
  const MIN_USERNAME_LENGTH = 5;
  const MAX_USERNAME_LENGTH = 15;
  const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;
  const ageOptions = Array.from({ length: 83 }, (_, i) => i + 18);

  // Modified connection timeout for mobile devices
  const CONNECTION_TIMEOUT = 15000;

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
        const userToSave = userData || formData;
        localStorage.setItem("guestSession", JSON.stringify(userToSave));
        router.push('/chat');
      } catch (error) {
        console.error("Failed to save session data:", error);
        toast.error("Failed to save your session. Please try again.");
        setLoader(false);
      }
    };

    const onServerError = (error) => {
      console.error("Server error:", error);
      toast.error(error.message || "Server error. Please try again later.");
      setLoader(false);
    };

    socket.on('UserExist', onUserExist);
    socket.on('userAdded', onUserAdded);
    socket.on('serverError', onServerError);

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
        const userData = JSON.parse(userExistString);
        setLoader(true);

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

        socket.once("ConnectionRefused", onConnectionRefused);
        socket.once("ConnectionAccepted", onConnectionAccepted);
        socket.emit("AlreadyGuest", userData);

        const timeoutId = setTimeout(() => {
          socket.off("ConnectionRefused", onConnectionRefused);
          socket.off("ConnectionAccepted", onConnectionAccepted);
          toast.error("Connection timed out. Please try again.");
          setLoader(false);
        }, 5000);

        return () => {
          clearTimeout(timeoutId);
          socket.off("ConnectionRefused", onConnectionRefused);
          socket.off("ConnectionAccepted", onConnectionAccepted);
        };

      } catch (error) {
        console.error("Failed to parse user data from localStorage:", error);
        localStorage.removeItem("guestSession");
      }
    }
  }, [router]);

  // Check connection status on load
  useEffect(() => {
    if (socket.connected) {
      setConnectionStatus('connected');
    } else {
      setConnectionStatus('checking');

      const onConnect = () => {
        setConnectionStatus('connected');
      };

      const onConnectError = (error) => {
        setConnectionStatus('error');
      };

      const onDisconnect = () => {
        setConnectionStatus('error');
      };

      socket.on('connect', onConnect);
      socket.on('connect_error', onConnectError);
      socket.on('disconnect', onDisconnect);

      if (!socket.connected) {
        socket.connect();
        setTimeout(() => {
          if (!socket.connected) {
            setConnectionStatus('error');
          }
        }, 5000);
      }

      return () => {
        socket.off('connect', onConnect);
        socket.off('connect_error', onConnectError);
        socket.off('disconnect', onDisconnect);
      };
    }
  }, []);

  // Auto-detect location on component load
  useEffect(() => {
    if ((!formData.country || !formData.region) && connectionStatus === 'connected') {
      const timeoutId = setTimeout(() => {
        autoDetectLocation();
      }, 1000);
      return () => clearTimeout(timeoutId);
    }
  }, [connectionStatus]);

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
    if (name === 'userName') {
      const error = validateUsername(value);
      setUsernameError(error);
    }
    setFormData(prevState => ({
      ...prevState,
      [name]: value
    }));
  };

  const autoDetectLocation = async () => {
    try {
      const response = await fetch('https://ipapi.co/json/');
      if (!response.ok) throw new Error('Could not detect location');
      const data = await response.json();
      setFormData(prev => ({
        ...prev,
        country: data.country_name || '',
        region: data.region || ''
      }));
    } catch (error) {
      console.error('Error detecting location:', error);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const usernameValidationError = validateUsername(formData.userName);
    if (usernameValidationError) {
      setUsernameError(usernameValidationError);
      toast.error(usernameValidationError);
      return;
    }

    if (!formData.userName.trim() || !formData.Age || !formData.Gender || !termsAccepted) {
      toast.error("Please fill all fields and accept terms");
      return;
    }

    const country = formData.country.trim() || 'Unknown';
    const region = formData.region.trim() || 'Unknown';

    setLoader(true);

    const connectionTimeout = setTimeout(() => {
      toast.error("Connection timed out. Please try again later.");
      setLoader(false);
    }, CONNECTION_TIMEOUT);

    const connectionErrorHandler = (error) => {
      clearTimeout(connectionTimeout);
      console.error("Connection error:", error);
      toast.error("Unable to connect to the server.");
      setLoader(false);
    };

    socket.once("connect_error", connectionErrorHandler);
    socket.once("connect_timeout", connectionErrorHandler);

    const sanitizedData = {
      ...formData,
      userName: formData.userName.trim(),
      Age: Number(formData.Age),
      country: country,
      region: region,
      online: true,
      lastSeen: new Date().toISOString()
    };

    socket.emit("connected", sanitizedData);

    return () => {
      clearTimeout(connectionTimeout);
      socket.off("connect_error", connectionErrorHandler);
      socket.off("connect_timeout", connectionErrorHandler);
    };
  };

  const getAvatarPreview = (username, gender) => {
    if (!username) return null;
    const initials = username.slice(0, 2).toUpperCase();
    return `data:image/svg+xml,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
          <defs>
            <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="${gender?.toLowerCase() === 'female' ? '#9733EE' : gender?.toLowerCase() === 'male' ? '#2193b0' : '#8E2DE2'}" />
              <stop offset="100%" stop-color="${gender?.toLowerCase() === 'female' ? '#DA22FF' : gender?.toLowerCase() === 'male' ? '#6dd5ed' : '#4A00E0'}" />
            </linearGradient>
          </defs>
          <rect width="100" height="100" fill="url(#grad)" />
          <text x="50" y="50" dy="0.35em" font-family="Arial, sans-serif" font-size="40" font-weight="bold" text-anchor="middle" fill="#ffffff">${initials}</text>
        </svg>
      `)}`;
  };

  return (
    <>
      <Head>
        <title>Login - ChatUp</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>

      <div className="min-h-screen flex items-center justify-center p-4 bg-background relative overflow-hidden">
        {/* Animated Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-secondary/20 -z-10 animate-gradient-x" />
        <div className="absolute top-0 left-0 w-96 h-96 bg-primary/20 rounded-full blur-[100px] -translate-x-1/2 -translate-y-1/2" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-secondary/20 rounded-full blur-[100px] translate-x-1/2 translate-y-1/2" />

        <Card
          className="w-full max-w-lg shadow-2xl border-border/50 backdrop-blur-xl bg-card/80"
          title={
            <div className="text-center pb-2 flex flex-col items-center">
              <img src="/image.png" alt="ChatUp Logo" className="w-20 h-20 mb-2 object-contain drop-shadow-lg" />
              <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">
                ChatUp
              </h1>
              <p className="text-muted-foreground mt-2 text-sm">Join the community</p>
            </div>
          }
        >
          {/* Avatar Preview */}
          <div className="flex justify-center mb-8">
            <div className={`relative w-24 h-24 rounded-full ring-4 ring-background shadow-xl flex items-center justify-center overflow-hidden bg-muted transition-all duration-300 ${formData.userName ? 'scale-100' : 'scale-95 opacity-80'}`}>
              {formData.userName ? (
                <img src={getAvatarPreview(formData.userName, formData.Gender)} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <User className="w-10 h-10 text-muted-foreground/50" />
              )}
              <div className="absolute bottom-0 right-0 w-6 h-6 bg-green-500 rounded-full border-4 border-white" />
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Username"
                id="userName"
                name="userName"
                placeholder="johndoe"
                value={formData.userName}
                onChange={handleChange}
                icon={User}
                error={usernameError}
                rightElement={formData.userName && !usernameError && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                className="col-span-1 md:col-span-2"
              />

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-muted-foreground ml-1">Age</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-muted-foreground">
                    <Calendar className="h-5 w-5" />
                  </div>
                  <select
                    name="Age"
                    value={formData.Age}
                    onChange={handleChange}
                    className="flex w-full rounded-xl border-2 border-input bg-background/50 pl-10 pr-3 py-2.5 text-sm transition-all focus-visible:border-primary/50 focus-visible:ring-0"
                  >
                    <option value="">Age</option>
                    {ageOptions.map(age => <option key={age} value={age}>{age}</option>)}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-muted-foreground ml-1">Gender</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-muted-foreground">
                    <User className="h-5 w-5" />
                  </div>
                  <select
                    name="Gender"
                    value={formData.Gender}
                    onChange={handleChange}
                    className="flex w-full rounded-xl border-2 border-input bg-background/50 pl-10 pr-3 py-2.5 text-sm transition-all focus-visible:border-primary/50 focus-visible:ring-0"
                  >
                    <option value="">Gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              <Input
                label="Country"
                name="country"
                placeholder="Auto-detected"
                value={formData.country}
                onChange={handleChange}
                icon={Globe}
              />

              <Input
                label="Region"
                name="region"
                placeholder="State/City"
                value={formData.region}
                onChange={handleChange}
                icon={MapPin}
              />
            </div>

            <div className="bg-muted/50 p-4 rounded-xl border border-border/50">
              <label className="flex items-start gap-3 cursor-pointer group">
                <div className="relative flex items-center mt-0.5">
                  <input
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                    className="peer h-4 w-4 rounded-md border-input bg-background text-primary focus:ring-primary/20 transition-all cursor-pointer"
                  />
                </div>
                <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors leading-relaxed">
                  I confirm I am 18+ and accept the <span className="text-primary hover:underline">Terms of Service</span>. I understand this is an open chat platform.
                </span>
              </label>
            </div>

            <Button
              type="submit"
              fullWidth
              size="lg"
              isLoading={showLoader}
              disabled={!!usernameError || connectionStatus !== 'connected' || !termsAccepted}
              className="mt-4 shadow-lg shadow-primary/25 hover:shadow-primary/40 font-semibold"
            >
              {showLoader ? 'Establishing Secure Connection...' : 'Start Chatting'}
            </Button>

            {connectionStatus === 'checking' && (
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground animate-pulse">
                <Loader2 className="w-3 h-3 animate-spin" /> Connecting to server...
              </div>
            )}

            {connectionStatus === 'error' && (
              <div className="flex items-center justify-center gap-2 text-xs text-destructive bg-destructive/10 py-2 rounded-lg">
                <AlertCircle className="w-3 h-3" /> Server unavailable
              </div>
            )}
          </form>
        </Card>
      </div>
    </>
  );
}