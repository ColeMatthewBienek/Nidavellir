import createClient from 'openapi-fetch';
import type { paths } from './types';

export const api = createClient<paths>({ baseUrl: 'http://localhost:7430' });
