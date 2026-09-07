import * as m001 from './001_init.js';
import * as m002 from './002_async_pvp.js';

export interface Migration {
  name: string;
  sql: string;
}

/** Applied in array order. Never reorder or edit a migration once it has shipped. */
export const migrations: Migration[] = [
  { name: m001.name, sql: m001.sql },
  { name: m002.name, sql: m002.sql },
];
