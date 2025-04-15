# Video Chat Feature

This chat application now includes a WebRTC-based peer-to-peer video chat feature. The video chat functionality allows users to make direct video calls to other online users in the application.

## Features

- **Peer-to-peer video calls**: Direct connection between users for lower latency
- **Camera toggle**: Turn your camera on/off during calls
- **Microphone toggle**: Mute/unmute your microphone during calls
- **Camera switching**: Switch between front and rear cameras on mobile devices
- **Call duration timer**: See how long your call has been active
- **Incoming call notifications**: Ringtone alert when receiving calls
- **Call status indicators**: Visual feedback for call states (calling, receiving, connected, ended)

## How It Works

The video chat feature uses WebRTC (Web Real-Time Communication) technology to establish direct peer-to-peer connections between browsers. The server only assists in the signaling process (connecting users) but doesn't relay the audio/video data.

### Technical Implementation

1. **Client Libraries**:
   - `simple-peer`: A WebRTC library that simplifies peer connection setup
   - `react`: For the UI components and state management

2. **Server Signaling**:
   - Uses Socket.io to handle the signaling process
   - Routes call requests, call acceptances, and call rejections

3. **Connection Process**:
   - User A initiates a call to User B
   - Server forwards the call request to User B
   - User B accepts the call
   - WebRTC establishes a direct peer connection
   - Audio and video streams are exchanged directly between browsers

## Usage Instructions

### Making a Video Call

1. Start a chat with another user
2. Click the video camera icon in the chat header
3. Wait for the other user to accept your call
4. Once connected, you'll see the other user's video stream

### Receiving a Video Call

1. When someone calls you, you'll see an incoming call screen with the caller's name
2. Choose to either accept or decline the call
3. If you accept, the video call will start automatically

### During a Call

- Use the microphone button to mute/unmute yourself
- Use the camera button to turn your camera on/off
- Use the switch camera button to toggle between front/rear cameras (on mobile)
- Use the red end call button to terminate the call

## Troubleshooting

- **Camera/Microphone Access**: Make sure to grant the browser permissions to access your camera and microphone
- **Connection Issues**: Both users need to be online and have a stable internet connection
- **Mobile Support**: Works best on modern mobile browsers (Chrome, Safari, Firefox)
- **Firewall Issues**: If behind a restrictive firewall, some connections may not be possible

## Privacy Note

All video and audio is transmitted directly between users and is not stored on any server. The server only helps establish the initial connection but does not have access to the call content.
hey 