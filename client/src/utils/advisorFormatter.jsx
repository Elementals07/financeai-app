/**
 * Secure Financial Advisor Presentation Formatter
 * 
 * Safely parses Markdown text into structured React elements without using
 * dangerouslySetInnerHTML. Completely immune to XSS, script injection, and broken HTML tags.
 */
import React from 'react';

/**
 * Parses inline formatting (**bold**, ₹amounts, `code`) into an array of React elements
 */
function parseInline(text, keyPrefix = 'inline') {
    if (!text || typeof text !== 'string') return text;

    // Pattern matches:
    // 1. **bold**
    // 2. currency: ₹[0-9,]+(?:\.[0-9]{1,2})?(?:[kKmLlCrCr]+)?
    // 3. inline code: `code`
    const regex = /(\*\*.*?\*\*|₹[0-9,]+(?:\.[0-9]{1,2})?(?:[kKmLlCr]+)?|`[^`]+`)/g;
    const parts = text.split(regex);

    return parts.map((part, index) => {
        const key = `${keyPrefix}-${index}`;
        if (!part) return null;

        if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
            return (
                <strong key={key} className="adv-strong">
                    {part.slice(2, -2)}
                </strong>
            );
        }

        if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
            return (
                <code key={key} className="adv-code">
                    {part.slice(1, -1)}
                </code>
            );
        }

        if (part.startsWith('₹')) {
            return (
                <span key={key} className="adv-currency-pill">
                    {part}
                </span>
            );
        }

        return part;
    });
}

/**
 * Secure React Markdown Renderer for Advisor Responses
 */
export function AdvisorMarkdown({ content }) {
    if (!content) return null;

    const lines = String(content).split('\n');
    const elements = [];

    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const line = rawLine.trim();
        const key = `line-${i}`;

        if (!line) {
            elements.push(<div key={key} className="adv-spacing" />);
            continue;
        }

        // Horizontal dividers: --- or ===
        if (/^---+$/.test(line) || /^===+$/.test(line)) {
            elements.push(<hr key={key} className="adv-divider" />);
            continue;
        }

        // Key-Value Pipe Row: e.g. "**Income:** ₹85,000 | **Spent:** ₹30,000"
        if (line.includes('|') && line.includes(':')) {
            const parts = line.split('|').map(p => p.trim()).filter(Boolean);
            const isMetricRow = parts.length >= 2 && parts.every(p => {
                const clean = p.replace(/\*\*/g, '').trim();
                return clean.includes(':');
            });

            if (isMetricRow) {
                elements.push(
                    <div key={key} className="adv-kpi-grid">
                        {parts.map((p, idx) => {
                            const clean = p.replace(/\*\*/g, '').trim();
                            const colonIdx = clean.indexOf(':');
                            const label = clean.slice(0, colonIdx).trim();
                            const val = clean.slice(colonIdx + 1).trim();
                            return (
                                <div key={`kpi-${idx}`} className="adv-kpi-card">
                                    <span className="adv-kpi-label">{label}</span>
                                    <span className="adv-kpi-val">{parseInline(val, `val-${idx}`)}</span>
                                </div>
                            );
                        })}
                    </div>
                );
                continue;
            }
        }

        // Header Level 2 (##)
        if (/^##\s+/.test(line)) {
            const title = line.replace(/^##\s+/, '').replace(/\*\*/g, '');
            elements.push(
                <h2 key={key} className="adv-h2">
                    {parseInline(title, key)}
                </h2>
            );
            continue;
        }

        // Header Level 3 (###)
        if (/^###\s+/.test(line)) {
            const title = line.replace(/^###\s+/, '').replace(/\*\*/g, '');
            if (/^(?:🛑|🚨|🟢|🟡|💡|⚡|🎯|📌|🔍|⚠️|✅)/u.test(title)) {
                elements.push(
                    <div key={key} className="adv-verdict-banner">
                        {parseInline(title, key)}
                    </div>
                );
            } else {
                elements.push(
                    <h3 key={key} className="adv-h3">
                        {parseInline(title, key)}
                    </h3>
                );
            }
            continue;
        }

        // Header Level 4 (####)
        if (/^####\s+/.test(line)) {
            const title = line.replace(/^####\s+/, '').replace(/\*\*/g, '');
            elements.push(
                <h4 key={key} className="adv-section-title">
                    {parseInline(title, key)}
                </h4>
            );
            continue;
        }

        // Callout boxes with leading emoji: 💡, 🚨, ⚠️, 📌, ✅, 🎯
        const calloutMatch = line.match(/^(💡|🚨|⚠️|📌|✅|🎯)\s+(.*)$/u);
        if (calloutMatch) {
            const emoji = calloutMatch[1];
            const textContent = calloutMatch[2];
            let type = 'tip';
            if (emoji === '🚨') type = 'danger';
            else if (emoji === '⚠️') type = 'warning';
            else if (emoji === '✅') type = 'success';
            else if (emoji === '🎯') type = 'target';

            elements.push(
                <div key={key} className={`adv-callout adv-callout-${type}`}>
                    <span className="adv-callout-icon" aria-hidden="true">{emoji}</span>
                    <div className="adv-callout-body">{parseInline(textContent, key)}</div>
                </div>
            );
            continue;
        }

        // Blockquotes (> Quote or key summary)
        if (/^(&gt;|>)\s*/.test(line)) {
            const quoteContent = line.replace(/^(&gt;|>)\s*/, '');
            elements.push(
                <div key={key} className="adv-blockquote">
                    {parseInline(quoteContent, key)}
                </div>
            );
            continue;
        }

        // Numbered Action Items: "1. **Cut shopping:** ..."
        const numberedMatch = line.match(/^(\d+)\.\s+(.*)$/);
        if (numberedMatch) {
            const num = numberedMatch[1];
            const textContent = numberedMatch[2];
            elements.push(
                <div key={key} className="adv-action-card">
                    <span className="adv-action-badge">{num}</span>
                    <div className="adv-action-content">{parseInline(textContent, key)}</div>
                </div>
            );
            continue;
        }

        // Bullet diagnosis / breakdown items: "* 🚨 **Rent:** ..." or "* **Food:** ..."
        const bulletMatch = line.match(/^[*-]\s+(.*)$/u);
        if (bulletMatch) {
            const content = bulletMatch[1];
            const emojiBullet = content.match(/^(🚨|⚠️|✅|💡|📌|🎯)\s+(.*)$/u);
            if (emojiBullet) {
                elements.push(
                    <div key={key} className="adv-diag-item">
                        <span className="adv-diag-icon" aria-hidden="true">{emojiBullet[1]}</span>
                        <div className="adv-diag-content">{parseInline(emojiBullet[2], key)}</div>
                    </div>
                );
            } else {
                elements.push(
                    <div key={key} className="adv-bullet-box">
                        <span className="adv-bullet-dot" aria-hidden="true">•</span>
                        <div className="adv-bullet-content">{parseInline(content, key)}</div>
                    </div>
                );
            }
            continue;
        }

        // Normal text line
        elements.push(
            <p key={key} className="adv-paragraph">
                {parseInline(line, key)}
            </p>
        );
    }

    return <div className="adv-rendered-content">{elements}</div>;
}

/**
 * Backward compatibility export:
 * If any caller still passes a string to renderAdvisorMarkdown, it returns safe text.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function renderAdvisorMarkdown(text) {
    if (!text) return '';
    // Escapes all HTML characters for safe string rendering if invoked
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export default AdvisorMarkdown;
