# @digitaltwin/db

PostgreSQL + TimescaleDB con [postgres.js](https://github.com/porsager/postgres) y migraciones en
SQL a pelo (sin ORM: las funciones de Timescale —hypertables, compresión, continuous aggregates—
se usan tal cual).

```js
import { createDb, migrate, ping } from '@digitaltwin/db';

const sql = createDb(process.env.DATABASE_URL);
await migrate(sql); // aplica las de migrations/ que falten
const rows = await sql`select * from measurements where user_id = ${userId}`; // parametrizado
await sql.end();
```

## Migraciones

- Ficheros `migrations/NNNN_descripcion.sql`; se aplican en orden por nombre y se apuntan en
  `schema_migrations`. La API las aplica al arrancar (con un advisory lock, así que dos procesos a
  la vez no chocan).
- Cada una va en su transacción. Si lleva algo que no puede ir en una (continuous aggregates…),
  la primera línea es `-- no-transaction`.
- Una migración aplicada no se edita nunca: se crea otra nueva.

## Tests

Necesitan una BD real; sin `TEST_DATABASE_URL` se saltan. Cada ejecución usa un schema temporal.

```bash
make docker-up   # levanta digitaltwin-db en localhost:5433
make test-db     # los tests con la BD de make docker-up
```
