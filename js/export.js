// Export Functions (CSV & Excel)

function exportCurrentCSV() {
    const collection = getCurrentCollection();
    if (collection.cards.length === 0) {
        showToast('No cards to export', '⚠️');
        return;
    }
    
    const csv = generateCSV(collection.cards);
    const filename = `${sanitizeFilename(collection.name)}.csv`;
    downloadFile(csv, filename, 'text/csv');
    showToast(`Exported ${collection.cards.length} cards`);
}

function exportAllCSV() {
    if (collections.every(c => c.cards.length === 0)) {
        showToast('No cards to export', '⚠️');
        return;
    }
    
    let exportedCount = 0;
    let totalCards = 0;
    
    collections.forEach(collection => {
        if (collection.cards.length > 0) {
            const csv = generateCSV(collection.cards);
            const filename = `${sanitizeFilename(collection.name)}.csv`;
            downloadFile(csv, filename, 'text/csv');
            exportedCount++;
            totalCards += collection.cards.length;
        }
    });
    
    showToast(`Exported ${totalCards} cards in ${exportedCount} files`);
}

function exportExcel() {
    if (collections.every(c => c.cards.length === 0)) {
        showToast('No cards to export', '⚠️');
        return;
    }
    
    const wb = XLSX.utils.book_new();
    let totalCards = 0;
    
    collections.forEach(collection => {
        if (collection.cards.length > 0) {
            const data = [
                ['Card ID', 'Name', 'Year', 'Set', 'Card Number', 'Parallel', 'Weapon', 'Power', 'Scan Method'],
                ...collection.cards.map(c => [
                    c.cardId, c.hero, c.year, c.set, c.cardNumber, c.pose, c.weapon, c.power, c.scanMethod
                ])
            ];
            
            const ws = XLSX.utils.aoa_to_sheet(data);
            
            const colWidths = [
                { wch: 12 }, { wch: 20 }, { wch: 8 }, { wch: 25 },
                { wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 20 }
            ];
            ws['!cols'] = colWidths;
            
            let sheetName = sanitizeSheetName(collection.name);
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
            totalCards += collection.cards.length;
        }
    });
    
    const today = new Date().toISOString().split('T')[0];
    const filename = `Card_Collections_${today}.xlsx`;
    
    XLSX.writeFile(wb, filename);
    showToast(`Exported ${totalCards} cards to Excel`);
}

function generateCSV(cards) {
    const headers = ['Card ID', 'Name', 'Year', 'Set', 'Card Number', 'Parallel', 'Weapon', 'Power', 'Scan Method'];
    const rows = cards.map(c => [
        c.cardId, c.hero, c.year, c.set, c.cardNumber, c.pose, c.weapon, c.power, c.scanMethod
    ]);
    
    return [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
}

function sanitizeFilename(name) {
    return name
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, '_')
        .substring(0, 100);
}

function sanitizeSheetName(name) {
    return name
        .replace(/[:\\/\?\*\[\]]/g, '_')
        .substring(0, 31);
}

function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
