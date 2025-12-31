import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    user: { type: String, required: true },
    to: { type: String, required: true },
    message: { type: String },
    imageUrl: { type: String },
    timestamp: { type: Date, default: Date.now },
    id: { type: String, required: true },
    read: { type: Boolean, default: false }
  },
  { _id: false }
);

const userSchema = new mongoose.Schema({
  userName: { type: String, required: true, unique: true },
  Age: { type: Number, required: true },
  Gender: { type: String, required: true },
  country: { type: String, default: 'Unknown' },
  region: { type: String, default: 'Unknown' },
  socketId: { type: String, required: true },
  chatWindow: { type: [messageSchema], default: [] },
  // Cleanup is manual now, but we keep this index for efficiency in querying 'lastSeen'
  // and as a fail-safe backup.
  lastSeen: { type: Date, default: Date.now, index: true },
});

// Indexes
userSchema.index({ "chatWindow.timestamp": 1 });
// Compound index for efficient "get online users" query if we filter by lastSeen
userSchema.index({ lastSeen: 1, online: 1 });

const User = mongoose.models.User || mongoose.model("User", userSchema);
export default User;