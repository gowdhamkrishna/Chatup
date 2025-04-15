"use server"
// import mongoose from 'mongoose';
import { connectFunction } from './connect.js';
import User from './models/userSchema.js';

// Function to check if a user already exists
export const checkUser = async (formData) => {
  try {
    await connectFunction();

    let res = await User.findOne({ userName: formData.userName});
    
    if (res) {
      return true;  
    } else {
      return false; 
    }
  } catch (err) {
    console.error("Error checking user:", err);
    throw err;  
  }
};


// Function to add a new user
export const saveUser = async (formData) => {
  try {
    await connectFunction()
    const user = new User(formData);
    await user.save();  // Save the new user instance to the database
    return user;        
  } catch (err) {
    console.error("Error adding user:", err);
    throw err;  // Rethrow the error to be handled at a higher level
  }
};
export const updateLastSeen = async (userName) => {
  await connectFunction()
  await User.findOneAndUpdate({ userName }, { lastSeen: new Date() });
};
export const getUsers = async (details) => {
  try {
    await connectFunction()
    const users = await User.find({
      userName: { $ne: details.userName },
      
    }, { lastSeen: 0 })
      .lean()
      .exec();

    const formattedUsers = users.map(user => ({
      ...user,
      _id: user._id.toString(),
    }));

    return formattedUsers;
  } catch (error) {
    console.error("Error fetching users:", error);
    throw error;
  }
};


