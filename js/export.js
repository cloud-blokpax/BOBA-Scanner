// ============================================================
// js/export.js — FIXED
// Changes:
//   - exportAllCSV() and exportExcel() now use getCollections() instead of
//     the undefined bare `collections` variable (was throwing ReferenceError)
//   - generateCSV() now properly escapes quotes inside cell values
//   - sanitizeFilename() and sanitizeSheetName() unchanged
// ============================================================

function exportCurrentCSV() {
  const collection = getCurrentCollection();
  if (collection.cards.length === 0) {
    showToast('No cards to export', '⚠️');
    return;
  }
  downloadFile(generateCSV(collection.cards), `${sanitizeFilename(collection.name)}.csv`, 'text/csv');
  showToast(`Exported ${collection.cards.length} cards`);
}

// FIXED: Was referencing undefined global `collections` — now uses getCollections()
function exportAllCSV() {
  const allCollections = getCollections();
  const withCards = allCollections.filter(c => c.cards.length > 0);
  if (withCards.length === 0) {
    showToast('No cards to export', '⚠️');
    return;
  }
  let totalCards = 0;
  for (const col of withCards) {
    downloadFile(generateCSV(col.cards), `${sanitizeFilename(col.name)}.csv`, 'text/csv');
    totalCards += col.cards.length;
  }
  showToast(`Exported ${totalCards} cards in ${withCards.length} files`);
}

// FIXED: Was referencing undefined global `collections` — now uses getCollections()
function exportExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('Excel library not loaded', '❌');
    return;
  }

  const allCollections = getCollections();
  const withCards = allCollections.filter(c => c.cards.length > 0);
  if (withCards.length === 0) {
    showToast('No cards to export', '⚠️');
    return;
  }

  const wb = XLSX.utils.book_new();
  let totalCards = 0;

  for (const col of withCards) {
    const data = [
      ['Card ID', 'Name', 'Year', 'Set', 'Card Number', 'Parallel', 'Weapon', 'Power', 'Scan Method'],
      ...col.cards.map(c => [
        c.cardId, c.hero, c.year, c.set, c.cardNumber,
        c.pose, c.weapon, c.power, c.scanMethod
      ])
    ];
    const ws  = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [
      { wch: 12 }, { wch: 20 }, { wch: 8 }, { wch: 25 },
      { wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 20 }
    ];
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(col.name));
    totalCards += col.cards.length;
  }

  const today    = new Date().toISOString().split('T')[0];
  const filename = `Card_Collections_${today}.xlsx`;
  XLSX.writeFile(wb, filename);
  showToast(`Exported ${totalCards} cards to Excel`);
}

// FIXED: Values with quotes or commas are now properly escaped
function generateCSV(cards) {
  const headers = ['Card ID', 'Name', 'Year', 'Set', 'Card Number', 'Parallel', 'Weapon', 'Power', 'Scan Method'];
  const rows    = cards.map(c => [
    c.cardId, c.hero, c.year, c.set, c.cardNumber,
    c.pose, c.weapon, c.power, c.scanMethod
  ]);

  const escapeCell = (val) => {
    const str = String(val ?? '');
    // Wrap in quotes; escape any existing quotes by doubling them
    return `"${str.replace(/"/g, '""')}"`;
  };

  return [
    headers.map(escapeCell).join(','),
    ...rows.map(row => row.map(escapeCell).join(','))
  ].join('\n');
}

function sanitizeFilename(name) {
  return (name || 'collection')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 100);
}

function sanitizeSheetName(name) {
  return (name || 'Sheet')
    .replace(/[:\\/\?\*\[\]]/g, '_')
    .substring(0, 31);
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

console.log('✅ Export module loaded');
