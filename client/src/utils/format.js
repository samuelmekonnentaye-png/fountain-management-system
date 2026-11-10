const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  am: ['ጃንዋሪ', 'ፌብሩዋሪ', 'ማርች', 'ኤፕሪል', 'ሜይ', 'ጁን', 'ጁላይ', 'ኦገስት', 'ሴፕቴምበር', 'ኦክቶበር', 'ኖቬምበር', 'ዲሴምበር'],
};

export const monthName = (lang, m) => MONTHS[lang === 'am' ? 'am' : 'en'][m - 1] || '';
export const monthShort = (lang, m) => monthName(lang, m).slice(0, 3);

export function fmtDate(d, lang = 'en') {
  if (!d) return '';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return `${x.getUTCDate()} ${monthShort(lang, x.getUTCMonth() + 1)} ${x.getUTCFullYear()}`;
}

export function fmtDateTime(d, lang = 'en') {
  if (!d) return '';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  const hh = String(x.getHours()).padStart(2, '0');
  const mm = String(x.getMinutes()).padStart(2, '0');
  return `${x.getDate()} ${monthShort(lang, x.getMonth() + 1)} ${x.getFullYear()}, ${hh}:${mm}`;
}

// <input type="date"> needs YYYY-MM-DD
export const toDateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

export const posName = (p, lang) => (p ? (lang === 'am' && p.nameAm ? p.nameAm : p.name) : '');
export const deptName = (d, lang) => (d ? (lang === 'am' && d.nameAm ? d.nameAm : d.name) : '');

export const periodRange = (p, lang) => (p ? `${fmtDate(p.startDate, lang)} – ${fmtDate(p.endDate, lang)}` : '');
export const periodYear = (p) => new Date(p.startDate).getUTCFullYear();

// ---- local date and time (meetings are shown in the viewer's own time zone)
export function fmtLocalDate(d, lang = 'en') {
  if (!d) return '';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return `${x.getDate()} ${monthShort(lang, x.getMonth() + 1)} ${x.getFullYear()}`;
}
export function fmtTime(d) {
  if (!d) return '';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
}
export const timeRange = (start, end) => `${fmtTime(start)} – ${fmtTime(end)}`;
const dayKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
};
export const sameLocalDay = (a, b) => dayKey(a) === dayKey(b);
export const toLocalDateInput = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
export const toLocalTimeInput = (d) => fmtTime(d);
