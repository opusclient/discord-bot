import { config } from '../config.js';

export function developerCreditLine(): string | null {
  const credit = String(config.developerCredit ?? '').trim();
  return credit ? `***${credit}***` : null;
}
