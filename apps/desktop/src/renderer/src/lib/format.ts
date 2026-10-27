import { formatDistanceToNowStrict, format } from 'date-fns';

export function ago(d: string | Date) {
  const s = formatDistanceToNowStrict(new Date(d));
  // LinkedIn-style compact: "3h", "2d", "5mo"
  return s
    .replace(/ seconds?/, 's')
    .replace(/ minutes?/, 'm')
    .replace(/ hours?/, 'h')
    .replace(/ days?/, 'd')
    .replace(/ weeks?/, 'w')
    .replace(/ months?/, 'mo')
    .replace(/ years?/, 'y');
}

export const dateLong = (d: string | Date) => format(new Date(d), 'EEE, d MMM yyyy · h:mm a');
export const monthYear = (d: string | Date) => format(new Date(d), 'MMM yyyy');

export function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;

const MENTION = /@\[([^\]]+)\]\(([a-z0-9]+)\)/g;
export const plainText = (body: string) => body.replace(MENTION, '@$1');
