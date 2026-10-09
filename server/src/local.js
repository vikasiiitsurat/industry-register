import app from './index.js';
import { config } from './config.js';

const server = app.listen(config.port, config.host, () => {
  console.log(`Industry conversion: http://${config.host}:${config.port}`);
});
server.requestTimeout = config.fileTimeout + config.conversionTimeout + 30_000;
