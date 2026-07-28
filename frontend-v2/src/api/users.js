import { request } from './client.js';

export const fetchUsers = () => request('/users');
export const createUser = (payload) => request('/users', { method: 'POST', body: payload });
