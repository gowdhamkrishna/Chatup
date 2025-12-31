# Chatup - Anonymous Ephemeral Chat Application

## Overview
Chatup is a privacy-focused, real-time messaging platform designed for ephemeral interactions. It features anonymous logins, self-destructing data, and a secure, high-performance architecture. Built with the **MERN** stack (MongoDB, Express, React/Next.js, Node.js) and powered by **Socket.IO** for real-time communication.

## Architecture

### Tech Stack
- **Frontend**: Next.js 15, React 19, Tailwind CSS (via custom utility classes), Lucide React (Icons).
- **Backend**: Node.js, Express.js (Custom Server).
- **Real-time**: Socket.IO (WebSockets with polling fallback).
- **Database**: MongoDB (Mongoose ORM).
- **Testing**: Jest, Supertest, MongoMemoryServer.

### Key Components
1.  **Custom Server (`server.js`)**:
    - Hybrid setup handling both Next.js SSR and Socket.IO signaling.
    - Implements custom API endpoints (`/upload`, `/health`, `/check-user`).
    - Enforces security middleware (Helmet, Rate Limiting, Sanitization).
2.  **Database Layer (`Database/`)**:
    - **`userSchema.js`**: Defines the user model with compound indexes for performance.
    - **`cleanUp.js`**: Aggressive background worker that deletes inactive users every minute.
    - **`actions.js`**: Abstraction layer for DB operations.
3.  **Frontend (`app/`)**:
    - **`app/chat/page.js`**: Main chat interface handling socket events, message rendering, and media handling.
    - **`app/login/page.js`**: Entry point with validation and avatar selection.

## Core Features Implementation

### 1. Ephemeral & Anonymous
- **No Authentication**: Users pick a username/avatar and join immediately.
- **Auto-Cleanup**:
    - Users inactive for **2 minutes** are hard-deleted from the database.
    - `lastSeen` timestamp is updated on every heartbeat and message.
    - **Grace Period**: Disconnecting starts a 10-second countdown; reconnecting cancels deletion.

### 2. Security (Hardened)
- **Input Sanitization**:
    - All WebSocket messages undergo **XSS sanitization** using `xss`.
    - MongoDB queries passed through `express-mongo-sanitize` to prevent **NoSQL Injection**.
- **Secure File Uploads**:
    - Validates **Magic Numbers** (file signatures) to ensure files are genuine images (PNG/JPG), ignoring file extensions.
    - Rejects executables or disguised scripts.
- **HTTP Security**:
    - **Helmet.js** sets strict HTTP headers.
    - **CSP (Content Security Policy)** restricts script sources to `'self'`.
- **Rate Limiting**: Limits API requests to 100 per 15 mins per IP.

### 3. Performance Optimizations
- **Static Caching**: Uploaded images in `/uploads` are served with `Cache-Control: public, max-age=1y, immutable`.
- **Database Indexing**:
    - Compound Index `{ lastSeen: 1, online: 1 }` speeds up the frequent "who is online" and "cleanup" queries.
- **Compression**: GZIP compression enabled for all HTTP responses.

### 4. Stability & Reliability
- **Graceful Shutdown**: Handles `SIGTERM`/`SIGINT` to close DB connections and sockets cleanly.
- **Health Check**: `/health` endpoint provides real-time MongoDB connection status and system uptime.
- **Error Handling**: Global error boundaries catch unhandled rejections to prevent zombie processes.

## Setup & Running

### Prerequisites
- Node.js (v18+)
- MongoDB (running on local instance or cluster)

### Installation
```bash
npm install
```

### Running Locally
```bash
# Starts MongoDB (if local script available) and the Server
./run.sh
```

### Testing
Run the automated security test suite:
```bash
npm test
```
*Tests cover NoSQL injection patterns and malicious file upload attempts.*

## Project Structure
```
Chatup/
├── app/                  # Next.js Frontend Pages & Components
├── Database/             # Mongoose Models & Connection Logic
├── public/               # Static Assets
├── tests/                # Jest Security Tests
├── uploads/              # User uploaded content (cached)
├── server.js             # Main Entry Point (Express + Socket.IO)
└── run.sh                # Startup Script
```
