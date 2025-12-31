import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { app, server } from '../server.js'; // Import app/server from modified server.js
import fs from 'fs';
import path from 'path';

let mongoServer;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.disconnect(); // Disconnect default connection
    await mongoose.connect(uri);
});

afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
    server.close();
});

describe('Security Hardening Tests', () => {

    describe('NoSQL Injection Prevention', () => {
        test('Should block NoSQL injection in check-user endpoint', async () => {
            const res = await request(app)
                .get('/check-user')
                .query({ userName: { "$ne": null } }); // Malicious query

            // express-mongo-sanitize should strip the $ char, making it look for key '$ne' literally or similar
            // effectively checking for username '{"$ne":null}' which doesn't exist.
            // Or it explicitly rejects it.
            // Our goal is ensuring it doesn't crash or return "true" (all users).

            // The sanitizer might invalidate the input causing 400, or sanitize it causing 200+false
            // Both are acceptable security outcomes.
            expect([200, 400]).toContain(res.status);
            if (res.status === 200) {
                expect(res.body.exists).toBe(false);
            }
        });
    });

    describe('File Upload Security (Magic Numbers)', () => {
        const uploadDir = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

        test('Should accept valid PNG image', async () => {
            // minimal valid 1x1 png
            const validPng = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2d600000000049454e44ae426082', 'hex');

            const res = await request(app)
                .post('/upload')
                .attach('image', validPng, 'test.png');

            if (res.status !== 200) console.error('Upload Success Error Body:', res.body);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        test('Should reject text file renamed to .png', async () => {
            const fakePng = Buffer.from('This is a text file disguised as PNG');

            const res = await request(app)
                .post('/upload')
                .attach('image', fakePng, 'fake.png');

            if (res.status !== 400) console.error('Upload Reject Error Body:', res.body);
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Invalid file content detected');
        });
    });

    // Note: XSS sanitization is tested primarily via logic review as it applies to socket events
    // verifying socket logic in a unit test is complex due to the setup, 
    // but we can verify the 'xss' library usage conceptually or via an integration wrapper if needed.
    // For now, we trust the integration we verified manually for socket logic 
    // and rely on this suite for the critical HTTP endpoints.
});
