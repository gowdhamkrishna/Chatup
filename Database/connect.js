import mongoose from "mongoose"
export const connectFunction=async()=>{
    await mongoose.connect(process.env.URI||'mongodb://localhost:27017/Chat');
    console.log('Connection Created');
} 