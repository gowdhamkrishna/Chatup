"use client";
import React, { useEffect, useRef, useState } from 'react';
import Peer from 'simple-peer';

const VideoChat = ({ 
  socket, 
  selectedUser, 
  userData, 
  onClose, 
  initiateCall = false,
  incomingCall = null,
  onCallEnded = () => {} 
}) => {
  const [callStatus, setCallStatus] = useState(initiateCall ? 'calling' : incomingCall ? 'receiving' : 'idle');
  const [stream, setStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [callAccepted, setCallAccepted] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [micActive, setMicActive] = useState(true);
  const [cameraActive, setCameraActive] = useState(true);
  const [timer, setTimer] = useState(0);
  
  const myVideo = useRef();
  const userVideo = useRef();
  const connectionRef = useRef();
  const timerRef = useRef();
  
  // Initialize media stream and peer connection
  useEffect(() => {
    if (!selectedUser || !userData) return;
    
    const getMediaStream = async () => {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({ 
          video: true, 
          audio: true 
        });
        
        setStream(mediaStream);
        if (myVideo.current) {
          myVideo.current.srcObject = mediaStream;
        }
        
        // If we're initiating the call, create the peer and call the user
        if (initiateCall) {
          callUser();
        }
      } catch (error) {
        console.error("Error accessing media devices:", error);
        alert("Unable to access camera or microphone. Please check your device permissions.");
        onClose();
      }
    };
    
    getMediaStream();
    
    // Make sure the selected user is really online before proceeding
    socket.emit("check-user-online", {
      userName: selectedUser.userName
    });
    
    // Listen for call events from socket
    const handleCallUser = (data) => {
      console.log("Received call-user event", data);
      handleReceiveCall(data);
    };
    
    const handleCallSignal = (data) => {
      console.log("Received call-signal event", data);
      if (!connectionRef.current) {
        console.log("No connection ref to handle signal");
        return;
      }
      
      // Only accept signals intended for us
      if (data.to === userData.userName && data.from === selectedUser.userName) {
        console.log("Processing signal data");
        connectionRef.current.signal(data.signalData);
      } else {
        console.log("Ignoring signal not intended for us", {
          to: data.to,
          from: data.from,
          ourName: userData.userName,
          theirName: selectedUser.userName
        });
      }
    };
    
    const handleOnlineStatus = (status) => {
      // Only handle status updates for the selected user
      if (status.userName !== selectedUser.userName) return;
      
      console.log("Received online status update for selected user:", status);
      
      // If the user is offline and we're trying to call them, show unavailable
      if (!status.online && initiateCall && callStatus === 'calling') {
        console.log("User is offline, cannot proceed with call");
        setCallStatus('unavailable');
        setTimeout(() => {
          onClose();
          onCallEnded();
        }, 3000);
      }
    };

    socket.on("call-user", handleCallUser);
    socket.on("call-signal", handleCallSignal);
    socket.on("call-accepted", handleCallAccepted);
    socket.on("call-rejected", handleCallRejected);
    socket.on("call-ended", handleCallEnded);
    socket.on("user-not-available", handleUserNotAvailable);
    socket.on("user-online-status", handleOnlineStatus);
    socket.on("user-offline", (data) => {
      // If the selected user goes offline during a call, handle it
      if (data.userName === selectedUser.userName && callStatus === 'calling') {
        console.log("User went offline during call attempt");
        setCallStatus('unavailable');
        setTimeout(() => {
          onClose();
          onCallEnded();
        }, 3000);
      }
    });
    
    // Ping our presence to keep connection alive
    const intervalId = setInterval(() => {
      if (userData && userData.userName) {
        socket.emit("ping-user", userData.userName);
        
        // Also refresh selected user's status
        socket.emit("check-user-online", {
          userName: selectedUser.userName
        });
      }
    }, 10000);
    
    // Cleanup
    return () => {
      clearInterval(intervalId);
      
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      if (remoteStream) {
        remoteStream.getTracks().forEach(track => track.stop());
      }
      if (connectionRef.current) {
        connectionRef.current.destroy();
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      
      socket.off("call-user", handleCallUser);
      socket.off("call-signal", handleCallSignal);
      socket.off("call-accepted", handleCallAccepted);
      socket.off("call-rejected", handleCallRejected);
      socket.off("call-ended", handleCallEnded);
      socket.off("user-not-available", handleUserNotAvailable);
      socket.off("user-online-status", handleOnlineStatus);
      socket.off("user-offline");
    };
  }, [userData, selectedUser]);
  
  // Handle incoming call effect
  useEffect(() => {
    if (incomingCall && stream) {
      setCallStatus('receiving');
    }
  }, [incomingCall, stream]);
  
  // Format time for display
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };
  
  // Start timer when call is accepted
  useEffect(() => {
    if (callAccepted && !callEnded) {
      timerRef.current = setInterval(() => {
        setTimer(prev => prev + 1);
      }, 1000);
    }
    
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [callAccepted, callEnded]);
  
  // Create and initiate peer connection to call user
  const callUser = () => {
    console.log("Continuing call to", selectedUser.userName);
    
    // Notify server about outgoing call
    socket.emit("call-user", {
      from: userData.userName,
      to: selectedUser.userName
    });
    
    setCallStatus('calling');
    
    // Create peer connection as initiator
    const peer = new Peer({
      initiator: true,
      trickle: false,
      stream: stream,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    });
    
    // Handle signaling data to send to callee
    peer.on("signal", (data) => {
      console.log("Generated signal data as initiator, sending to peer");
      socket.emit("call-signal", {
        signalData: data,
        from: userData.userName,
        to: selectedUser.userName
      });
    });
    
    // Handle receiving remote stream
    peer.on("stream", (currentStream) => {
      console.log("Received remote stream");
      if (userVideo.current) {
        userVideo.current.srcObject = currentStream;
        setRemoteStream(currentStream);
      }
    });
    
    // Handle errors
    peer.on("error", (err) => {
      console.error("Peer connection error:", err);
      if (callStatus !== 'connected') {
        setCallStatus('unavailable');
        setTimeout(() => {
          onClose();
          onCallEnded();
        }, 3000);
      }
    });
    
    // Save peer connection for later cleanup
    connectionRef.current = peer;
  };
  
  // Accept incoming call
  const answerCall = () => {
    if (!stream || !incomingCall) {
      console.error("Cannot answer call - no stream or incoming call data");
      return;
    }
    
    console.log("Answering call from", incomingCall.from);
    setCallAccepted(true);
    setCallStatus('connected');
    
    // Create peer connection as non-initiator
    const peer = new Peer({
      initiator: false,
      trickle: false,
      stream: stream,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    });
    
    // Handle signaling data to send to caller
    peer.on("signal", (data) => {
      console.log("Generated signal data as answerer, sending to peer");
      socket.emit("call-accepted", {
        signalData: data,
        from: userData.userName,
        to: incomingCall.from
      });
    });
    
    // Handle receiving remote stream
    peer.on("stream", (currentStream) => {
      console.log("Received remote stream as answerer");
      if (userVideo.current) {
        userVideo.current.srcObject = currentStream;
        setRemoteStream(currentStream);
      }
    });
    
    // Handle errors
    peer.on("error", (err) => {
      console.error("Peer connection error:", err);
      if (callStatus !== 'connected') {
        setCallStatus('unavailable');
        setTimeout(() => {
          onClose();
          onCallEnded();
        }, 3000);
      }
    });
    
    // Signal with the incoming call data if available
    if (incomingCall.signalData) {
      console.log("Using existing signal data to answer call");
      peer.signal(incomingCall.signalData);
    } else {
      console.log("No signal data available yet for incoming call");
    }
    
    // Save peer connection for later cleanup
    connectionRef.current = peer;
  };
  
  // Reject incoming call
  const rejectCall = () => {
    if (incomingCall) {
      socket.emit("call-rejected", {
        from: userData.userName,
        to: incomingCall.from
      });
    }
    onClose();
  };
  
  // End the call
  const endCall = () => {
    if (connectionRef.current) {
      connectionRef.current.destroy();
    }
    
    // Notify other user that call has ended
    if (selectedUser && userData) {
      socket.emit("call-ended", {
        from: userData.userName,
        to: initiateCall ? selectedUser.userName : incomingCall?.from
      });
    }
    
    setCallEnded(true);
    setCallStatus('ended');
    
    // Stop all tracks
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    if (remoteStream) {
      remoteStream.getTracks().forEach(track => track.stop());
    }
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    
    onCallEnded();
    
    // Close call UI after brief delay
    setTimeout(() => {
      onClose();
    }, 1500);
  };
  
  // Handle receiving a call
  const handleReceiveCall = (data) => {
    console.log("Handling receive call:", data);
    // Only accept calls meant for us
    if (data.to !== userData?.userName) {
      console.log("Call not for us, ignoring");
      return;
    }
    
    // Only accept calls from the selected user
    if (selectedUser && data.from !== selectedUser.userName) {
      console.log("Call not from selected user, ignoring");
      socket.emit("user-not-available", {
        caller: data.from,
        callee: userData.userName
      });
      return;
    }
    
    console.log("Setting call status to receiving");
    setCallStatus('receiving');
  };
  
  // Handle call acceptance from the other party
  const handleCallAccepted = (signal) => {
    console.log("Handling call accepted:", signal);
    if (!signal || !signal.signalData) {
      console.log("No signal data in call-accepted event");
      return;
    }
    
    // Only accept signals meant for us
    if (signal.to !== userData?.userName || signal.from !== selectedUser?.userName) {
      console.log("Call acceptance not for our conversation, ignoring");
      return;
    }
    
    console.log("Call accepted - updating UI");
    setCallAccepted(true);
    setCallStatus('connected');
    
    // Only signal if we have a connection
    if (connectionRef.current) {
      console.log("Signaling the peer connection");
      connectionRef.current.signal(signal.signalData);
    } else {
      console.error("Connection ref is null when receiving call-accepted");
    }
  };
  
  // Handle when the other user rejects our call
  const handleCallRejected = (data) => {
    if (data.to !== userData.userName) return;
    setCallStatus('rejected');
    
    // Close call UI after brief delay
    setTimeout(() => {
      onClose();
    }, 1500);
  };
  
  // Handle when the other user ends the call
  const handleCallEnded = (data) => {
    if (data.to !== userData.userName) return;
    if (connectionRef.current) {
      connectionRef.current.destroy();
    }
    
    setCallEnded(true);
    setCallStatus('ended');
    
    // Stop all tracks
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    if (remoteStream) {
      remoteStream.getTracks().forEach(track => track.stop());
    }
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    
    // Close call UI after brief delay
    setTimeout(() => {
      onClose();
    }, 1500);
  };
  
  // Handle when the user we're trying to call is not available
  const handleUserNotAvailable = (data) => {
    if (data.caller !== userData.userName) return;
    setCallStatus('unavailable');
    
    // Close call UI after brief delay
    setTimeout(() => {
      onClose();
    }, 2000);
  };
  
  // Toggle microphone
  const toggleMic = () => {
    if (stream) {
      const audioTracks = stream.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setMicActive(prev => !prev);
    }
  };
  
  // Toggle camera
  const toggleCamera = () => {
    if (stream) {
      const videoTracks = stream.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setCameraActive(prev => !prev);
    }
  };
  
  // Switch camera (if multiple cameras available)
  const switchCamera = async () => {
    if (!stream) return;
    
    // Get current video track settings
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return;
    
    const currentCamId = videoTrack.getSettings().deviceId;
    
    try {
      // Get all video input devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      
      // If we have more than one camera
      if (videoDevices.length > 1) {
        // Find the next camera to use
        const currentIndex = videoDevices.findIndex(device => device.deviceId === currentCamId);
        const nextIndex = (currentIndex + 1) % videoDevices.length;
        const nextCam = videoDevices[nextIndex];
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
        
        // Get new stream with the next camera
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: nextCam.deviceId } },
          audio: true
        });
        
        // Update our video
        if (myVideo.current) {
          myVideo.current.srcObject = newStream;
        }
        
        // Replace track in peer connection
        if (connectionRef.current) {
          const videoSender = connectionRef.current._senders.find(sender => 
            sender.track.kind === 'video'
          );
          if (videoSender) {
            videoSender.replaceTrack(newStream.getVideoTracks()[0]);
          }
        }
        
        setStream(newStream);
      }
    } catch (error) {
      console.error("Error switching camera:", error);
    }
  };
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col">
        {/* Call Header */}
        <div className="bg-gray-800 p-4 flex items-center justify-between">
          <div className="flex items-center">
            <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold mr-3">
              {selectedUser?.userName?.charAt(0) || '?'}
            </div>
            <div>
              <h3 className="text-white font-medium">
                {initiateCall 
                  ? selectedUser?.userName 
                  : incomingCall?.from || ''}
              </h3>
              <p className="text-gray-400 text-sm">
                {callStatus === 'idle' && 'Initializing...'}
                {callStatus === 'calling' && 'Calling...'}
                {callStatus === 'receiving' && 'Incoming call...'}
                {callStatus === 'connected' && formatTime(timer)}
                {callStatus === 'rejected' && 'Call rejected'}
                {callStatus === 'ended' && 'Call ended'}
                {callStatus === 'unavailable' && 'User unavailable'}
              </p>
            </div>
          </div>
          {/* Close button */}
          <button 
            onClick={callAccepted ? endCall : onClose} 
            className="p-2 rounded-full bg-gray-700 text-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {/* Video Display Area */}
        <div className="relative bg-gray-900 w-full" style={{ height: "60vh" }}>
          {/* Remote Video (Big) */}
          {callAccepted && (
            <div className="absolute inset-0">
              <video
                ref={userVideo}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
            </div>
          )}
          
          {/* Self Video (Small) */}
          <div className={`${callAccepted ? 'absolute bottom-4 right-4 w-1/4 h-1/4 md:w-1/5 md:h-1/5' : 'absolute inset-0'} rounded-lg overflow-hidden shadow-lg`}>
            <video
              ref={myVideo}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          </div>
          
          {/* Call status overlay for various states */}
          {callStatus === 'calling' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-70">
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-blue-500 mx-auto flex items-center justify-center animate-pulse">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15.465a5 5 0 001.06-7.19l5.657-5.657a5 5 0 017.189 1.06M3.515 13.394a9 9 0 001.06-12.727l6.364-6.364a9 9 0 0112.728 1.06" />
                  </svg>
                </div>
                <h3 className="text-white font-medium mt-4 text-xl">
                  Calling {selectedUser?.userName}...
                </h3>
                <p className="text-gray-300 mt-2">
                  Waiting for answer
                </p>
              </div>
            </div>
          )}
          
          {callStatus === 'receiving' && !callAccepted && (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-70">
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-green-500 mx-auto flex items-center justify-center animate-pulse">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15.465a5 5 0 001.06-7.19l5.657-5.657a5 5 0 017.189 1.06M3.515 13.394a9 9 0 001.06-12.727l6.364-6.364a9 9 0 0112.728 1.06" />
                  </svg>
                </div>
                <h3 className="text-white font-medium mt-4 text-xl">
                  Incoming call from {incomingCall?.from}
                </h3>
                <div className="flex space-x-4 mt-6 justify-center">
                  <button 
                    onClick={rejectCall}
                    className="px-6 py-3 bg-red-500 text-white rounded-full font-medium flex items-center"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Decline
                  </button>
                  <button 
                    onClick={answerCall}
                    className="px-6 py-3 bg-green-500 text-white rounded-full font-medium flex items-center"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Answer
                  </button>
                </div>
              </div>
            </div>
          )}
          
          {callStatus === 'unavailable' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-70">
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-red-500 mx-auto flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                </div>
                <h3 className="text-white font-medium mt-4 text-xl">
                  User Unavailable
                </h3>
                <p className="text-gray-300 mt-2">
                  {selectedUser?.userName} is not available right now
                </p>
              </div>
            </div>
          )}
          
          {callStatus === 'rejected' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-70">
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-yellow-500 mx-auto flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-white font-medium mt-4 text-xl">
                  Call Rejected
                </h3>
                <p className="text-gray-300 mt-2">
                  {selectedUser?.userName} declined your call
                </p>
              </div>
            </div>
          )}
          
          {callStatus === 'ended' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-70">
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-gray-500 mx-auto flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                  </svg>
                </div>
                <h3 className="text-white font-medium mt-4 text-xl">
                  Call Ended
                </h3>
                <p className="text-gray-300 mt-2">
                  Call duration: {formatTime(timer)}
                </p>
              </div>
            </div>
          )}
        </div>
        
        {/* Call Controls */}
        <div className="bg-gray-800 p-4 flex items-center justify-center space-x-4">
          {/* Mic toggle */}
          <button 
            onClick={toggleMic}
            className={`p-4 rounded-full ${micActive ? 'bg-gray-700' : 'bg-red-500'}`}
          >
            {micActive ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            )}
          </button>
          
          {/* Camera toggle */}
          <button 
            onClick={toggleCamera}
            className={`p-4 rounded-full ${cameraActive ? 'bg-gray-700' : 'bg-red-500'}`}
          >
            {cameraActive ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3l14 14" />
              </svg>
            )}
          </button>
          
          {/* Switch camera (mobile) */}
          <button 
            onClick={switchCamera}
            className="p-4 rounded-full bg-gray-700"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          
          {/* End call button */}
          <button 
            onClick={callAccepted ? endCall : onClose} 
            className="p-4 rounded-full bg-red-500"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default VideoChat; 