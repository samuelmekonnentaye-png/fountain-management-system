import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const signToken = (id) => jwt.sign({ id: String(id) }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
export const verifyToken = (token) => jwt.verify(token, env.jwtSecret);
