import { execFile as execFileCb, spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);
const REMOTE = 'gdrive';
const DAY_MS = 24 * 3600 * 1000;

/**
 * Copia de seguridad de la BD: pg_dump → cifrado con age (con la clave pública; la privada solo la
 * tiene el dueño) → Google Drive con rclone. Se borran las copias de más de `keepDays` días salvo
 * la primera de cada mes, que se queda un año.
 *
 * rclone se configura por variables de entorno (sin fichero): el remoto `gdrive` con permiso
 * drive.file (solo ve lo que crea él) y el token de la autorización.
 *
 * @param {object} deps
 * @param {import('postgres').Sql} deps.db  Para apuntar cada pasada en backup_runs.
 * @param {string} deps.databaseUrl
 * @param {string} deps.recipient  Clave pública de age (age1...).
 * @param {string} deps.driveToken  JSON del token de rclone authorize drive.
 * @param {string} [deps.folder]
 * @param {number} [deps.keepDays]
 * @param {() => Date} [deps.now]
 * @param {import('pino').Logger} [deps.logger]
 */
export function createBackup({
  db,
  databaseUrl,
  recipient,
  driveToken,
  folder = 'digitaltwin-backups',
  keepDays = 30,
  now = () => new Date(),
  logger,
}) {
  const rcloneEnv = {
    ...process.env,
    [`RCLONE_CONFIG_${REMOTE.toUpperCase()}_TYPE`]: 'drive',
    [`RCLONE_CONFIG_${REMOTE.toUpperCase()}_SCOPE`]: 'drive.file',
    [`RCLONE_CONFIG_${REMOTE.toUpperCase()}_TOKEN`]: driveToken,
  };
  const rclone = (args) =>
    execFile('rclone', args, { env: rcloneEnv, maxBuffer: 16 * 1024 * 1024 });

  /** pg_dump | age -r <clave> > fichero, sin dejar el volcado sin cifrar en disco. */
  function dumpEncrypted(target) {
    return new Promise((resolve, reject) => {
      // La conexión por variables PG*: la contraseña no sale en la línea de comandos
      const url = new URL(databaseUrl);
      const dump = spawn('pg_dump', ['--format=custom', '--no-owner'], {
        env: {
          ...process.env,
          PGHOST: url.hostname,
          PGPORT: url.port || '5432',
          PGUSER: decodeURIComponent(url.username),
          PGPASSWORD: decodeURIComponent(url.password),
          PGDATABASE: url.pathname.slice(1),
        },
      });
      const age = spawn('age', ['--recipient', recipient, '--output', target]);
      const errors = [];
      dump.stderr.on('data', (d) => errors.push(`pg_dump: ${d}`));
      age.stderr.on('data', (d) => errors.push(`age: ${d}`));
      dump.stdout.pipe(age.stdin);
      let pending = 2;
      const done = (name) => (code) => {
        if (code !== 0)
          reject(new Error(`${name} terminó con ${code}: ${errors.join(' ').slice(0, 400)}`));
        else if (--pending === 0) resolve();
      };
      dump.on('error', reject);
      age.on('error', reject);
      dump.on('close', done('pg_dump'));
      age.on('close', done('age'));
    });
  }

  /** Borra del destino lo que ya no toca guardar. @returns {Promise<number>} cuántas */
  async function prune(at) {
    const { stdout } = await rclone(['lsjson', `${REMOTE}:${folder}`, '--files-only']);
    const files = JSON.parse(stdout || '[]');
    let pruned = 0;
    for (const f of files) {
      const date = f.Name.match(/^dt-(\d{4}-\d{2}-\d{2})/)?.[1];
      if (!date) continue;
      const age = (at.getTime() - Date.parse(`${date}T00:00:00Z`)) / DAY_MS;
      const monthly = date.endsWith('-01');
      if (age > keepDays && !(monthly && age <= 366)) {
        await rclone(['deletefile', `${REMOTE}:${folder}/${f.Name}`]);
        pruned++;
      }
    }
    return pruned;
  }

  return {
    /** Una pasada completa. Lanza si falla (el job reintenta y avisa en el último intento). */
    async run() {
      const at = now();
      const [run] = await db`insert into backup_runs default values returning id`;
      const dir = await mkdtemp(join(tmpdir(), 'dt-backup-'));
      const file = `dt-${at.toISOString().slice(0, 16).replace(':', '')}Z.dump.age`;
      try {
        const local = join(dir, file);
        await dumpEncrypted(local);
        const { size } = await stat(local);
        await rclone(['copyto', local, `${REMOTE}:${folder}/${file}`]);
        const pruned = await prune(at);
        await db`
          update backup_runs set status = 'ok', finished_at = now(), file = ${file},
            size_bytes = ${size}, pruned = ${pruned}
          where id = ${run.id}
        `;
        logger?.info({ file, size, pruned }, 'copia de seguridad hecha');
        return { file, size, pruned };
      } catch (err) {
        const message = String(err.message).slice(0, 500);
        await db`
          update backup_runs set status = 'error', finished_at = now(), error = ${message}
          where id = ${run.id}
        `;
        throw err;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
