import { createHash } from 'node:crypto';

/** A migration file's name, as the runner accepts it: four digits, then a lowercase name. */
export const migrationName = /^\d{4}_[a-z0-9_]+\.sql$/;

/**
 * A migration's checksum. Line endings are normalised first, so a file checked
 * out on Windows with CRLF checks the same as the one that was applied.
 */
export function migrationChecksum(source: string) {
  return createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex');
}

/**
 * Which files still need applying, in order. An applied migration whose file
 * has changed is refused outright: it is checksummed so that a deployed
 * function is never altered in place, only replaced by a new migration.
 */
export function migrationPlan(files: { name: string; source: string }[], applied: Map<string, string>) {
  const pending: { name: string; source: string; checksum: string }[] = [];
  for (const file of [...files].filter(f => migrationName.test(f.name)).sort((a, b) => a.name.localeCompare(b.name))) {
    const checksum = migrationChecksum(file.source);
    const recorded = applied.get(file.name);
    if (recorded === undefined) pending.push({ ...file, checksum });
    else if (recorded !== checksum) throw new Error(`Previously applied migration was modified: ${file.name}`);
  }
  return pending;
}
