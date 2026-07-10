import axios, { AxiosInstance, AxiosError } from 'axios';

/**
 * Same-origin `/api` by default so the HttpOnly session cookie is sent on every
 * request (production Cloud Run and local Vite proxy). Override with VITE_API_URL
 * only when the API is intentionally on another origin.
 */
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

class ApiClient {
  private client: AxiosInstance;
  private handlingUnauthorized = false;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response?.status === 401) {
          // Avoid redirect loops on /login or /auth/me probes
          const path = window.location.pathname;
          const onAuthPage =
            path.startsWith('/login') ||
            path.startsWith('/auth/');
          const reqUrl = String(error.config?.url || '');
          const isMeProbe = reqUrl.includes('/auth/me');

          if (!onAuthPage && !isMeProbe && !this.handlingUnauthorized) {
            this.handlingUnauthorized = true;
            // Clear any legacy localStorage tokens from older builds
            try {
              localStorage.removeItem('sessionToken');
              localStorage.removeItem('refreshToken');
            } catch {
              /* ignore */
            }
            window.location.href = '/login';
          }
        }
        return Promise.reject(error);
      }
    );
  }

  get instance(): AxiosInstance {
    return this.client;
  }
}

export const apiClient = new ApiClient().instance;
