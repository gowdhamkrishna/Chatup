import "./globals.css";
import { Toaster } from "react-hot-toast";

export const metadata = {
  title: "Chatup",
  description: "Chat Application",
};

import PingProvider from "./ping";
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
       
      >
        <PingProvider/>
        <Toaster position="top-center" />
        {children}
      </body>
    </html>
  );
}
