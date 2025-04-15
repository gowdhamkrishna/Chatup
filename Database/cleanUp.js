import User from "./models/userSchema.js";

const cleanupInactiveUsers = () => {
  setInterval(async () => {
    // 1 hour in milliseconds = 3600000
    const cutoff = new Date(Date.now() - 60);
    console.log("User deleted");
    const result = await User.deleteMany({ lastSeen: { $lt: cutoff } });
    if (result.deletedCount > 0) {
      console.log(`Deleted ${result.deletedCount} inactive user(s)`);
    }
  }, 60000);
};

export default cleanupInactiveUsers