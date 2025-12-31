import User from "./models/userSchema.js";

const cleanupInactiveUsers = () => {
  // Run immediately on startup
  const runCleanup = async () => {
    try {
      // Aggressive cleanup: users inactive for more than 2 minutes
      const inactiveTime = 2 * 60 * 1000; // 2 minutes
      const cutoff = new Date(Date.now() - inactiveTime);

      console.log(`Running cleanup for users inactive since: ${cutoff.toISOString()}`);

      // Query for potentially inactive users
      const inactiveUsers = await User.find({ lastSeen: { $lt: cutoff } });

      if (inactiveUsers.length > 0) {
        // Filter out admin or protected users if necessary
        const usersToDelete = inactiveUsers.filter(user => {
          if (user.role === 'admin' || user.keepAlive === true) {
            return false;
          }
          return true;
        });

        if (usersToDelete.length > 0) {
          const usernamesToDelete = usersToDelete.map(u => u.userName);
          console.log(`Deleting ${usersToDelete.length} inactive users: ${usernamesToDelete.join(', ')}`);

          await User.deleteMany({
            _id: { $in: usersToDelete.map(u => u._id) }
          });
        }
      }
    } catch (error) {
      console.error('Error in cleanup process:', error);
    }
  };

  // Run initially
  runCleanup();

  // Then run every minute
  setInterval(runCleanup, 60000);
};

export default cleanupInactiveUsers;