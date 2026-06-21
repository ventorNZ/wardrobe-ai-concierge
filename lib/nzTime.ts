export const NZ_TIME_ZONE = "Pacific/Auckland";

function partsFor(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NZ_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return { year: get("year"), month: get("month"), day: get("day") };
}

export function nzTodayIso(date = new Date()) {
  const { year, month, day } = partsFor(date);
  return `${year}-${month}-${day}`;
}

export function nzNowLabel(date = new Date()) {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: NZ_TIME_ZONE,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(date);
}

export function nzTimeOnlyLabel(date = new Date()) {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: NZ_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(date);
}

export function dateFromIsoDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year || 1970, (month || 1) - 1, day || 1, 12));
}

export function weekdayFromIsoDate(isoDate: string) {
  const date = dateFromIsoDate(isoDate);
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: "UTC",
    weekday: "long"
  }).format(date);
}

export function formatNzCalendarDate(isoDate: string) {
  const date = dateFromIsoDate(isoDate);
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long"
  }).format(date);
}

export function addDaysToIsoDate(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
