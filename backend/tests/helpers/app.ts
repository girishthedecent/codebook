import request from 'supertest';
import { createApp } from '../../src/app.js';

export const testApp = () => request(createApp());
