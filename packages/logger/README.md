# @digitaltwin/logger

Logger compartido basado en [pino](https://getpino.io).

```js
import { createLogger } from '@digitaltwin/logger';

const logger = createLogger({ name: 'mi-proceso' });
logger.info('arrancando');
```

Variables: `LOG_LEVEL` (por defecto `info`), `NODE_ENV=development` activa salida legible.
