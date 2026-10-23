import { escapeHtml, layout } from '@digitaltwin/email';
import { formatStat } from './blocks.js';
import { chartPng } from './png.js';

const MUTED = '#6b6b66';
const LINE = '#e6e6e1';
const ACCENT = '#2f6f4f';

const h2 = (text) =>
  `<h2 style="margin:24px 0 8px;font-size:15px;color:#1c1c1a;">${escapeHtml(text)}</h2>`;
const paragraphs = (text) =>
  text
    .split(/\n\s*\n/)
    .map((p) => `<p style="margin:0 0 12px;">${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');
const cell = (v) => (v == null || v === '' ? '—' : escapeHtml(String(v)));

/** Una cifra: dos por fila, la etiqueta en gris encima y el valor (y su objetivo) en grande. */
function statsHtml(block) {
  const rows = [];
  for (let i = 0; i < block.items.length; i += 2) {
    const tds = block.items.slice(i, i + 2).map((item) => {
      const value = formatStat(item);
      const note = item.note
        ? `<div style="font-size:12px;color:${MUTED};margin-top:2px;">${escapeHtml(item.note)}</div>`
        : '';
      return `<td width="50%" valign="top" style="padding:10px 12px;border-top:1px solid ${LINE};">
<div style="font-size:12px;color:${MUTED};">${escapeHtml(item.label)}</div>
<div style="font-size:17px;font-weight:600;${item.value == null ? `color:${MUTED};font-weight:400;` : ''}">${escapeHtml(value)}</div>${note}</td>`;
    });
    if (tds.length === 1) tds.push('<td width="50%"></td>');
    rows.push(`<tr>${tds.join('')}</tr>`);
  }
  return `${block.title ? h2(block.title) : ''}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table>`;
}

function tableHtml(block) {
  const head = block.columns
    .map(
      (c) =>
        `<th align="left" style="padding:6px 8px;font-size:12px;font-weight:600;color:${MUTED};border-bottom:1px solid ${LINE};">${escapeHtml(c)}</th>`,
    )
    .join('');
  const body = block.rows
    .map(
      (row) =>
        `<tr>${row.map((v) => `<td style="padding:6px 8px;font-size:13px;border-bottom:1px solid ${LINE};">${cell(v)}</td>`).join('')}</tr>`,
    )
    .join('');
  return `${block.title ? h2(block.title) : ''}<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${head}</tr>${body}</table>`;
}

function calloutHtml(block) {
  const bg = block.tone === 'warning' ? '#fdf3e4' : '#eef4f0';
  return `<div style="margin:16px 0 0;padding:12px 14px;border-radius:8px;background:${bg};font-size:14px;">${escapeHtml(block.text).replace(/\n/g, '<br>')}</div>`;
}

/**
 * El correo de un informe: HTML (las gráficas, como PNG incrustados), texto plano y los
 * adjuntos. Al final, el enlace al informe en la app, donde las gráficas se pueden tocar.
 * @param {{ title: string, blocks: object[] }} report
 * @param {{ appUrl: string, reportUrl: string, preheader?: string }} options
 */
export function renderReportEmail(report, { appUrl, reportUrl, preheader = '' }) {
  const attachments = [];
  const html = [];
  const text = [report.title, ''];

  for (const block of report.blocks) {
    switch (block.type) {
      case 'heading':
        html.push(h2(block.text));
        text.push(block.text.toUpperCase(), '');
        break;
      case 'text':
        html.push(paragraphs(block.text));
        text.push(block.text, '');
        break;
      case 'stats':
        html.push(statsHtml(block));
        if (block.title) text.push(block.title.toUpperCase());
        for (const item of block.items) {
          text.push(`- ${item.label}: ${formatStat(item)}${item.note ? ` (${item.note})` : ''}`);
        }
        text.push('');
        break;
      case 'table':
        html.push(tableHtml(block));
        if (block.title) text.push(block.title.toUpperCase());
        for (const row of block.rows)
          text.push(`- ${row.filter((v) => v != null && v !== '').join(' · ')}`);
        text.push('');
        break;
      case 'chart': {
        const contentId = `chart-${attachments.length + 1}`;
        attachments.push({ filename: `${contentId}.png`, content: chartPng(block), contentId });
        html.push(
          `<div style="margin:20px 0 0;"><img src="cid:${contentId}" width="512" alt="${escapeHtml(block.title)}" style="display:block;width:100%;max-width:512px;height:auto;border:0;"></div>`,
        );
        text.push(`[Gráfica: ${block.title}]`, '');
        break;
      }
      case 'callout':
        html.push(calloutHtml(block));
        text.push(block.text, '');
        break;
    }
  }

  html.push(
    `<p style="margin:28px 0 0;"><a href="${escapeHtml(reportUrl)}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:${ACCENT};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;">Ver el informe en TwinMe</a></p>`,
  );
  text.push(`Ver el informe en TwinMe: ${reportUrl}`);

  return {
    subject: report.title,
    html: layout({ title: report.title, preheader, body: html.join(''), appUrl }),
    text: text.join('\n'),
    attachments,
  };
}
