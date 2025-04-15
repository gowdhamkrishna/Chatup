
import "./globals.css";
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
 
        {children}
      </body>
    </html>
  );
}
