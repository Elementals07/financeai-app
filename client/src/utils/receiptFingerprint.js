/**
 * Deterministic, non-cryptographic fingerprint used to detect an accidental
 * re-save of the same receipt on this device. It is not a security primitive.
 */
function hashString(value) {
    let hash = 5381;
    for (let i = 0; i < value.length; i += 1) {
        hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16);
}

export function buildReceiptFingerprint({ merchant, billDate, totalAmount, items } = {}) {
    const merchantPart = String(merchant || '').trim().toLowerCase();
    const datePart = String(billDate || '').trim();
    const totalPart = Number(totalAmount || 0).toFixed(2);
    const itemPart = (Array.isArray(items) ? items : [])
        .map(item => {
            const name = String(item?.name || '').trim().toLowerCase();
            const amount = Number(item?.amount || 0).toFixed(2);
            const category = String(item?.category || '').trim().toLowerCase();
            return `${name}:${amount}:${category}`;
        })
        .join('|');

    return `rcpt_${hashString(`${merchantPart}|${datePart}|${totalPart}|${itemPart}`)}`;
}
