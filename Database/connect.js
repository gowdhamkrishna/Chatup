import mongoose from "mongoose"

export const connectFunction = async () => {
    if (mongoose.connection.readyState === 1) {
        // console.log('Already connected to Database');
        return;
    }
    try {
        await mongoose.connect('mongodb://localhost:27018/Chat');
        console.log('Connection Created');
    } catch (error) {
        console.error('Database connection error:', error);
        throw error;
    }
} 