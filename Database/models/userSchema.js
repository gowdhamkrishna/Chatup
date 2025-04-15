import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    user: { type: String, required: true },
    to:{type:String,required:true},
    message: { type: String, required: true },
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
  lastSeen: { type: Date, default: Date.now, index: { expires: 3600 } },
});

// Indexes
userSchema.index({ "chatWindow.timestamp": 1 });

const User = mongoose.models.User || mongoose.model("User", userSchema);
export default User;