import { rootCertificates } from 'node:tls';
import { supabaseCa } from './supabase-ca.js';

export function databaseTls(url: string, enabled: boolean) {
  if (!enabled) return false;
  const hostname = new URL(url).hostname;
  const supabase = hostname.endsWith('.supabase.co') || hostname.endsWith('.pooler.supabase.com');
  return { rejectUnauthorized: true, ...(supabase ? { ca: [...rootCertificates, supabaseCa] } : {}) };
}
