import { mbo } from "./http.js";

interface ClientInput {
  Email: string;
  FirstName: string;
  LastName: string;
}

export const listServices = async (): Promise<any[]> => {
  const response = await mbo.get("/sale/services");
  const data = response.data as { Services?: any[] };
  return data.Services ?? [];
};

export const getServiceById = async (id: string): Promise<any | undefined> => {
  const services = await listServices();
  return services.find((service) => String(service.Id ?? service.id) === String(id));
};

export const addOrUpdateClient = async (input: ClientInput): Promise<any> => {
  const response = await mbo.post("/client/addclient", {
    Client: input
  });
  return response.data;
};

export const checkoutShoppingCart = async (payload: Record<string, unknown>): Promise<any> => {
  const response = await mbo.post("/sale/checkoutshoppingcart", payload);
  return response.data;
};
