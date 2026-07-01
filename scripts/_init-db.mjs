import { initDb } from '../app/db.mjs';
console.log('Inicializando schema DB...');
await initDb();
console.log('OK — schema listo');
process.exit(0);
