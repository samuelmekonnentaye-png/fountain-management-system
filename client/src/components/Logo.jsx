import { useEffect, useState } from 'react';
import { useI18n, COMPANY } from '../context/I18nContext.jsx';

// The real company logo is picked up automatically when a file named logo.svg / logo.png / logo.webp / logo.jpg
// exists in client/public. Until then the built-in mark is shown.
const CANDIDATES = ['/logo.svg', '/logo.png', '/logo.webp', '/logo.jpg'];
let probe; // one lookup for the whole app

const tryLoad = (src) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0);
    img.onerror = () => resolve(false);
    img.src = src;
  });

function findLogo() {
  if (!probe) {
    probe = (async () => {
      for (const c of CANDIDATES) {
        // eslint-disable-next-line no-await-in-loop
        if (await tryLoad(c)) {
          const icon = document.querySelector("link[rel='icon']");
          if (icon) {
            icon.removeAttribute('type');
            icon.setAttribute('href', c);
          }
          return c;
        }
      }
      return null;
    })();
  }
  return probe;
}

export function useCustomLogo() {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let alive = true;
    findLogo().then((s) => alive && setSrc(s));
    return () => {
      alive = false;
    };
  }, []);
  return src;
}

export function LogoMark({ className = 'logo-mark' }) {
  const custom = useCustomLogo();
  if (custom) return <img className={`${className} logo-img`} src={custom} alt="FOUNTAIN INTERNATIONAL TRADING PLC" />;
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label="Fountain logo">
      <defs>
        <linearGradient id="fit-logo-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3a86ff" />
          <stop offset="1" stopColor="#0a3fb0" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="url(#fit-logo-grad)" />
      <path d="M32 9c8.4 10.6 14.5 17.6 14.5 26a14.5 14.5 0 0 1-29 0C17.5 26.6 23.6 19.6 32 9z" fill="#fff" />
      <path d="M24.5 36.5a8 8 0 0 0 7.5 8" stroke="#5bb4ff" strokeWidth="3.2" fill="none" strokeLinecap="round" />
      <path d="M14 52.5c4-3 8-3 12 0s8 3 12 0 8-3 12 0" stroke="#bfe1ff" strokeWidth="2.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export default function Logo() {
  const { lang } = useI18n();
  return (
    <div className="logo">
      <LogoMark />
      <div className="logo-text">
        <strong>FOUNTAIN</strong>
        <span>{lang === 'am' ? COMPANY.am : 'INTERNATIONAL TRADING PLC'}</span>
      </div>
    </div>
  );
}
