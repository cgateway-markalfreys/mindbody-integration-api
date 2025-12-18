import axios, { AxiosInstance } from "axios";

export const http = (baseURL: string, headers: Record<string, string> = {}): AxiosInstance =>
  axios.create({
    baseURL,
    headers,
    timeout: 15000,
    validateStatus: (status) => status >= 200 && status < 300
  });
