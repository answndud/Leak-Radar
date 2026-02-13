import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";

// .env 파일은 프로젝트 루트에 위치 – 서비스가 어디서 실행되든 루트 .env를 로드
dotenvConfig({ path: resolve(__dirname, "../../../.env") });
dotenvConfig();

import { createServer } from "./server";
import { loadConfig } from "./config";

const start = async (): Promise<void> => {
  const config = loadConfig();
  const app = createServer();

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
