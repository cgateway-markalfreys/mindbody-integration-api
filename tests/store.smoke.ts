import axios from "axios";

const baseUrl = (process.env.PUBLIC_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");

const run = async (): Promise<void> => {
  const health = await axios.get(`${baseUrl}/`);
  console.log("GET /", health.status, health.data);

  const productsResponse = await axios.get(`${baseUrl}/store/products`);
  const products = productsResponse.data?.products ?? [];
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error("Expected at least one product from /store/products");
  }

  const product = products[0];
  console.log("Using product", product);

  const sessionResponse = await axios.post(`${baseUrl}/v1/checkout/sessions`, {
    siteKey: "demo-site",
    productId: product.id,
    qty: 1,
    customer: {
      email: "demo-shopper@example.com",
      firstName: "Demo",
      lastName: "Shopper"
    }
  });

  console.log("Session response", sessionResponse.status, sessionResponse.data);

  if (sessionResponse.status !== 201 || typeof sessionResponse.data?.redirectUrl !== "string") {
    throw new Error("Expected redirectUrl in session response");
  }
};

run().catch((error) => {
  console.error("Smoke test failed", error);
  process.exitCode = 1;
});
