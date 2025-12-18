import { getEnv } from "./config/env.js";
import { createCaymanService } from "./cayman/service.js";
import { createMindbodyService } from "./mindbody/service.js";
import { createApp } from "./server.js";

const bootstrap = (): void => {
  try {
    const env = getEnv();

    const mindbodyService = createMindbodyService({
      siteId: env.mindbodySiteId,
      serviceId: env.mindbodyServiceId,
      apiKey: env.mindbodyApiKey,
      userToken: env.mindbodyUserToken,
      userTokenUsername: env.mindbodySourceName,
      userTokenPassword: env.mindbodySourcePassword,
      caymanPaymentMethodId: env.mindbodyCaymanPaymentMethodId
    });

    const caymanService = createCaymanService({
      baseUrl: env.cayman.baseUrl,
      apiKey: env.cayman.apiKey,
      username: env.cayman.username,
      password: env.cayman.password
    });

    const app = createApp({ mindbodyService, caymanService });

    app.listen(env.port, () => {
      console.log(`Server listening on port ${env.port}`);
    });
  } catch (error) {
    console.error("Failed to start server", error);
    process.exitCode = 1;
  }
};

bootstrap();
