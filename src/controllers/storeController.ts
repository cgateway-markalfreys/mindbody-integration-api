import { type RequestHandler } from "express";
import { listServices } from "../services/mbo.js";

const isHidden = (service: any): boolean => Boolean(service?.IsHidden ?? service?.HideDisplay);

const parsePrice = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
};

export const createListProductsHandler = (): RequestHandler => async (_req, res) => {
  try {
    const services = await listServices();
    const products = services
      .filter((service) => !isHidden(service))
      .map((service) => ({
        id: String(service.Id ?? service.id ?? ""),
        name: String(service.Name ?? service.name ?? "Service"),
        price: parsePrice(service.OnlinePrice ?? service.Price ?? service.price)
      }));

    res.json({ products });
  } catch (error) {
    res.status(502).json({ error: "unable_to_list_services", details: (error as Error).message });
  }
};