"use client";
import { useEffect } from "react";
import socket from "@/app/lib/sockClient";

export default function PingProvider() {
  useEffect(() => {
    // Check if we have a valid session
    const sessionData = localStorage.getItem("guestSession");
    console.log(sessionData)
    if (!sessionData) return;

    try {
      const formData = JSON.parse(sessionData);
      socket.emit("connected", formData);
      const interval = setInterval(() => {
        if (socket.connected) {
          socket.emit("ping-user", formData.userName);
        }
      }, 10000);


      return () => {
        clearInterval(interval);

        // socket.emit("disconnect-user", formData.userName);
      };
    } catch (error) {
      console.error("Error parsing session data:", error);
      sessionStorage.removeItem("guestSession");
    }
  }, []);

  return null;
}