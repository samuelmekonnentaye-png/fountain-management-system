import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

const transporter = env.smtp.host
  ? nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    })
  : null;

export const mailEnabled = Boolean(transporter);

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Sends an individual notification email to each recipient (so To/CC are not exposed as one list).
export async function sendReportEmails({ report, sender, recipients, link }) {
  if (!transporter) return;
  const s = report.snapshot;
  for (const r of recipients) {
    if (!r.user?.email) continue;
    try {
      await transporter.sendMail({
        from: env.smtp.from,
        to: r.user.email,
        subject: `[${env.company.en}] ${report.subject || 'Work plan report'}`,
        html: `
          <div style="font-family:Arial,sans-serif;color:#0a2a66">
            <h2 style="margin:0 0 8px">${esc(env.company.en)}</h2>
            <p>${esc(sender.fullName)} sent you a <b>${esc(report.kind)}</b> report (${esc(r.type === 'to' ? 'To' : 'CC')}).</p>
            <p>Employee: <b>${esc(s.ownerName)}</b><br/>
               Period: ${esc(s.periodName)}<br/>
               Score: <b>${esc(s.scoreWeighted)}%</b> (by count ${esc(s.scoreByCount)}%)</p>
            ${report.message ? `<p style="white-space:pre-wrap">${esc(report.message)}</p>` : ''}
            <p><a href="${esc(link)}">Open the report</a></p>
          </div>`,
      });
    } catch (e) {
      console.error('email failed for', r.user.email, '-', e.message);
    }
  }
}
