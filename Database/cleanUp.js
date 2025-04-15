import User from "./models/userSchema.js";

const cleanupInactiveUsers = () => {
  setInterval(async () => {
    try {
      // Increase the inactive time to 24 hours (in milliseconds)
      const inactiveTime = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
      const cutoff = new Date(Date.now() - inactiveTime);
      
      console.log(`Running cleanup for users inactive since: ${cutoff.toISOString()}`);
      
      // Query for potentially inactive users
      const inactiveUsers = await User.find({ lastSeen: { $lt: cutoff } });
      
      if (inactiveUsers.length > 0) {
        console.log(`Found ${inactiveUsers.length} potentially inactive users`);
        
        // Check for special case users that shouldn't be deleted
        const usersToDelete = inactiveUsers.filter(user => {
          // Skip deletion for users with specific flags or conditions
          // For example, keep admin users or users with keepAlive flag
          if (user.role === 'admin' || user.keepAlive === true) {
            console.log(`Skipping deletion for protected user: ${user.userName}`);
            return false;
          }
          return true;
        });
        
        if (usersToDelete.length > 0) {
          // Get usernames for logging
          const usernamesToDelete = usersToDelete.map(u => u.userName);
          console.log(`Deleting ${usersToDelete.length} inactive users: ${usernamesToDelete.join(', ')}`);
          
          // Delete the inactive users
          const result = await User.deleteMany({ 
            _id: { $in: usersToDelete.map(u => u._id) } 
          });
          
          console.log(`Deleted ${result.deletedCount} inactive user(s)`);
        } else {
          console.log('No users to delete after filtering');
        }
      } else {
        console.log('No inactive users found');
      }
    } catch (error) {
      console.error('Error in cleanup process:', error);
    }
  }, 3600000); // Run hourly instead of every minute
};

export default cleanupInactiveUsers;