// =====================================================
// RAW YARN STOCK REPORT - CLIENT-SIDE JAVASCRIPT
// =====================================================

let currentReportData = null;

// =====================================================
// UTILITY FUNCTIONS
// =====================================================

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return 'N/A';
        
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        
        return `${day}/${month}/${year}`;
    } catch (e) {
        console.error('Date formatting error:', e);
        return 'N/A';
    }
}

function formatNumber(number, decimals = 2) {
    if (number === null || number === undefined) return '0.00';
    return parseFloat(number).toFixed(decimals);
}

function getAgeingBadge(days) {
    if (days <= 30) {
        return '<span class="badge badge-success">Fresh</span>';
    } else if (days <= 90) {
        return '<span class="badge badge-info">Moderate</span>';
    } else if (days <= 180) {
        return '<span class="badge badge-warning">Aged</span>';
    } else {
        return '<span class="badge badge-danger">Old Stock</span>';
    }
}

function getBalanceClass(balance) {
    if (balance > 0) return 'highlight-positive';
    if (balance < 0) return 'highlight-negative';
    return 'highlight-zero';
}

function showLoading() {
    document.getElementById('loadingSpinner').classList.add('active');
    document.getElementById('reportContainer').classList.remove('active');
}

function hideLoading() {
    document.getElementById('loadingSpinner').classList.remove('active');
}

function showReport() {
    document.getElementById('reportContainer').classList.add('active');
    document.getElementById('exportExcelBtn').style.display = 'inline-flex';
    document.getElementById('clearReportBtn').style.display = 'inline-flex';
}

function hideReport() {
    document.getElementById('reportContainer').classList.remove('active');
    document.getElementById('exportExcelBtn').style.display = 'none';
    document.getElementById('clearReportBtn').style.display = 'none';
}

// =====================================================
// DATA FETCHING FUNCTIONS
// =====================================================

async function fetchYarnLots() {
    try {
        const response = await fetch('/main/api/yarn-stock-report/yarn-lots', {
            method: 'GET',
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        const yarnLots = await response.json();
        populateYarnLotDropdown(yarnLots);
        
    } catch (error) {
        console.error('Error fetching yarn lots:', error);
        alert('Failed to load yarn lots: ' + error.message);
    }
}

function populateYarnLotDropdown(yarnLots) {
    const select = document.getElementById('searchYarnLot');
    
    if (!select) return;
    
    select.innerHTML = '<option value="">Select Yarn Lot</option>';
    
    yarnLots.forEach(lot => {
        const option = document.createElement('option');
        option.value = lot;
        option.textContent = lot;
        select.appendChild(option);
    });
    
    console.log(`Loaded ${yarnLots.length} yarn lots`);
}

async function fetchStockReport(yarnLot) {
    try {
        showLoading();
        
        const encodedLot = encodeURIComponent(yarnLot);
        const response = await fetch(`/main/api/yarn-stock-report/by-lot/${encodedLot}`, {
            method: 'GET',
            credentials: 'include'
        });
        
        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('No data found for this yarn lot');
            }
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Stock report data:', data);
        
        currentReportData = data;
        displayReport(data);
        
    } catch (error) {
        console.error('Error fetching stock report:', error);
        alert('Failed to generate report: ' + error.message);
        hideLoading();
    }
}

// =====================================================
// REPORT DISPLAY FUNCTIONS
// =====================================================

function displayReport(data) {
    hideLoading();
    showReport();
    
    // Set timestamp
    const timestamp = new Date().toLocaleString();
    document.getElementById('reportTimestamp').innerHTML = 
        `<i class="fas fa-clock"></i> Generated: ${timestamp}`;
    
    // Display yarn details
    displayYarnDetails(data.yarn_details, data.yarn_lot);
    
    // Display summary
    displaySummary(data.summary);
    
    // Display transactions
    displayReceiveTransactions(data.receive_transactions);
    displayIssueTransactions(data.issue_transactions);
    
    // Scroll to report
    document.getElementById('reportContainer').scrollIntoView({ 
        behavior: 'smooth', 
        block: 'start' 
    });
}

function displayYarnDetails(details, yarnLot) {
    const grid = document.getElementById('yarnDetailsGrid');
    
    if (!grid || !details) return;
    
    const items = [
        { label: 'Yarn Lot', value: yarnLot, icon: 'fa-box' },
        { label: 'Yarn Count', value: details.yarn_count || 'N/A', icon: 'fa-sort-numeric-up' },
        { label: 'Number of Ply', value: details.yarn_ply || 'N/A', icon: 'fa-random' },
        { label: 'Yarn Brand', value: details.yarn_brand || 'N/A', icon: 'fa-tags' },
        { label: 'Yarn Type', value: details.yarn_type || 'N/A', icon: 'fa-certificate' },
        { label: 'Composition', value: details.yarn_composition || 'N/A', icon: 'fa-layer-group' },
        { label: 'L/C Number', value: details.lc_no || 'N/A', icon: 'fa-file-contract' },
        { label: 'Beneficiary', value: details.beneficiary_factory || 'N/A', icon: 'fa-industry' },
        { label: 'Country of Origin', value: details.country_of_origin || 'N/A', icon: 'fa-globe' },
        { label: 'Source', value: details.import_local_source || 'N/A', icon: 'fa-shipping-fast' }
    ];
    
    grid.innerHTML = items.map(item => `
        <div class="yarn-detail-item">
            <div class="yarn-detail-label">
                <i class="fas ${item.icon}"></i> ${item.label}
            </div>
            <div class="yarn-detail-value">${item.value}</div>
        </div>
    `).join('');
}

function displaySummary(summary) {
    const grid = document.getElementById('summaryGrid');
    
    if (!grid || !summary) return;
    
    const balanceClass = getBalanceClass(summary.closing_balance);
    const ageingBadge = getAgeingBadge(summary.ageing_days);
    
    const cards = [
        {
            label: 'Total Received',
            value: `${formatNumber(summary.total_received)} Kgs`,
            subtitle: `${summary.receive_transaction_count} transactions`,
            icon: 'fa-download',
            type: 'success'
        },
        {
            label: 'Total Issued',
            value: `${formatNumber(summary.total_issued)} Kgs`,
            subtitle: `${summary.issue_transaction_count} transactions`,
            icon: 'fa-upload',
            type: 'info'
        },
        {
            label: 'Closing Balance',
            value: `${formatNumber(summary.closing_balance)} Kgs`,
            subtitle: summary.closing_balance > 0 ? 'Stock Available' : 
                      summary.closing_balance < 0 ? 'Over Issued' : 'Fully Consumed',
            icon: 'fa-balance-scale',
            type: summary.closing_balance > 0 ? 'success' : 
                  summary.closing_balance < 0 ? 'danger' : 'warning',
            valueClass: balanceClass
        },
        {
            label: 'Ageing Time',
            value: `${summary.ageing_days} Days`,
            subtitle: ageingBadge,
            icon: 'fa-clock',
            type: summary.ageing_days <= 90 ? 'info' : 'warning'
        },
        {
            label: 'First Receipt',
            value: formatDate(summary.first_receive_date),
            subtitle: 'Initial stock date',
            icon: 'fa-calendar-plus',
            type: 'info'
        },
        {
            label: 'Last Receipt',
            value: formatDate(summary.last_receive_date),
            subtitle: 'Most recent receipt',
            icon: 'fa-calendar-check',
            type: 'info'
        },
        {
            label: 'Last Issue',
            value: formatDate(summary.last_issue_date),
            subtitle: 'Most recent issue',
            icon: 'fa-calendar-minus',
            type: 'info'
        },
        {
            label: 'Turnover Ratio',
            value: summary.total_received > 0 ? 
                   formatNumber((summary.total_issued / summary.total_received) * 100, 1) + '%' : 
                   '0%',
            subtitle: 'Issued vs Received',
            icon: 'fa-percentage',
            type: 'info'
        }
    ];
    
    grid.innerHTML = cards.map(card => `
        <div class="summary-card ${card.type}">
            <div class="summary-card-label">
                <i class="fas ${card.icon}"></i>
                ${card.label}
            </div>
            <div class="summary-card-value ${card.valueClass || ''}">${card.value}</div>
            <div class="summary-card-subtitle">${card.subtitle}</div>
        </div>
    `).join('');
}

function displayReceiveTransactions(transactions) {
    const tbody = document.getElementById('receiveTransactionsBody');
    
    if (!tbody) return;
    
    if (!transactions || transactions.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="no-data">
                    <i class="fas fa-info-circle"></i> No receive transactions found
                </td>
            </tr>
        `;
        return;
    }
    
    let cumulativeQty = 0;
    
    tbody.innerHTML = transactions.map(txn => {
        cumulativeQty += txn.quantity;
        
        return `
            <tr>
                <td>${formatDate(txn.date)}</td>
                <td>${txn.po_number || 'N/A'}</td>
                <td>${txn.dispo_number || 'N/A'}</td>
                <td>${txn.challan_no || 'N/A'}</td>
                <td><strong>${formatNumber(txn.quantity)}</strong></td>
                <td class="highlight-positive">${formatNumber(cumulativeQty)}</td>
                <td>${txn.pi_no || 'N/A'}</td>
            </tr>
        `;
    }).join('');
    
    // Add total row
    tbody.innerHTML += `
        <tr style="background: var(--input-bg); font-weight: 700;">
            <td colspan="4" style="text-align: right;">TOTAL:</td>
            <td><strong>${formatNumber(cumulativeQty)}</strong></td>
            <td colspan="2"></td>
        </tr>
    `;
}

function displayIssueTransactions(transactions) {
    const tbody = document.getElementById('issueTransactionsBody');
    
    if (!tbody) return;
    
    if (!transactions || transactions.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="no-data">
                    <i class="fas fa-info-circle"></i> No issue transactions found
                </td>
            </tr>
        `;
        return;
    }
    
    let cumulativeQty = 0;
    
    tbody.innerHTML = transactions.map(txn => {
        cumulativeQty += txn.quantity;
        
        return `
            <tr>
                <td>${formatDate(txn.date)}</td>
                <td>${txn.issue_type || 'N/A'}</td>
                <td>${txn.issued_to || 'N/A'}</td>
                <td>${txn.challan_no || 'N/A'}</td>
                <td><strong>${formatNumber(txn.quantity)}</strong></td>
                <td class="highlight-positive">${formatNumber(cumulativeQty)}</td>
                <td>${txn.remarks || '-'}</td>
            </tr>
        `;
    }).join('');
    
    // Add total row
    tbody.innerHTML += `
        <tr style="background: var(--input-bg); font-weight: 700;">
            <td colspan="4" style="text-align: right;">TOTAL:</td>
            <td><strong>${formatNumber(cumulativeQty)}</strong></td>
            <td colspan="2"></td>
        </tr>
    `;
}

// =====================================================
// EXPORT FUNCTIONS
// =====================================================

function exportToExcel() {
    if (!currentReportData) {
        alert('No report data to export');
        return;
    }
    
    try {
        const wb = XLSX.utils.book_new();
        
        // ========================================
        // Sheet 1: Summary
        // ========================================
        const summaryData = [
            ['RAW YARN STOCK REPORT'],
            ['Generated:', new Date().toLocaleString()],
            [],
            ['YARN DETAILS'],
            ['Yarn Lot:', currentReportData.yarn_lot],
            ['Yarn Count:', currentReportData.yarn_details.yarn_count || 'N/A'],
            ['Number of Ply:', currentReportData.yarn_details.yarn_ply || 'N/A'],
            ['Yarn Brand:', currentReportData.yarn_details.yarn_brand || 'N/A'],
            ['Yarn Type:', currentReportData.yarn_details.yarn_type || 'N/A'],
            ['Composition:', currentReportData.yarn_details.yarn_composition || 'N/A'],
            ['L/C Number:', currentReportData.yarn_details.lc_no || 'N/A'],
            ['Beneficiary:', currentReportData.yarn_details.beneficiary_factory || 'N/A'],
            [],
            ['STOCK SUMMARY'],
            ['Total Received (Kgs):', currentReportData.summary.total_received],
            ['Total Issued (Kgs):', currentReportData.summary.total_issued],
            ['Closing Balance (Kgs):', currentReportData.summary.closing_balance],
            ['Ageing Days:', currentReportData.summary.ageing_days],
            ['First Receipt Date:', formatDate(currentReportData.summary.first_receive_date)],
            ['Last Receipt Date:', formatDate(currentReportData.summary.last_receive_date)],
            ['Last Issue Date:', formatDate(currentReportData.summary.last_issue_date)],
            ['Receive Transactions:', currentReportData.summary.receive_transaction_count],
            ['Issue Transactions:', currentReportData.summary.issue_transaction_count]
        ];
        
        const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
        
        // ========================================
        // Sheet 2: Receive Transactions
        // ========================================
        const receiveHeaders = [
            'Date', 'PO Number', 'Dispo Number', 'Challan No', 
            'Quantity (Kgs)', 'Cumulative (Kgs)', 'PI No'
        ];
        
        const receiveData = [receiveHeaders];
        let cumulativeReceive = 0;
        
        currentReportData.receive_transactions.forEach(txn => {
            cumulativeReceive += txn.quantity;
            receiveData.push([
                formatDate(txn.date),
                txn.po_number || 'N/A',
                txn.dispo_number || 'N/A',
                txn.challan_no || 'N/A',
                txn.quantity,
                cumulativeReceive,
                txn.pi_no || 'N/A'
            ]);
        });
        
        const receiveSheet = XLSX.utils.aoa_to_sheet(receiveData);
        XLSX.utils.book_append_sheet(wb, receiveSheet, 'Receive Transactions');
        
        // ========================================
        // Sheet 3: Issue Transactions
        // ========================================
        const issueHeaders = [
            'Date', 'Issue Type', 'Issued To', 'Challan No', 
            'Quantity (Kgs)', 'Cumulative (Kgs)', 'Remarks'
        ];
        
        const issueData = [issueHeaders];
        let cumulativeIssue = 0;
        
        currentReportData.issue_transactions.forEach(txn => {
            cumulativeIssue += txn.quantity;
            issueData.push([
                formatDate(txn.date),
                txn.issue_type || 'N/A',
                txn.issued_to || 'N/A',
                txn.challan_no || 'N/A',
                txn.quantity,
                cumulativeIssue,
                txn.remarks || '-'
            ]);
        });
        
        const issueSheet = XLSX.utils.aoa_to_sheet(issueData);
        XLSX.utils.book_append_sheet(wb, issueSheet, 'Issue Transactions');
        
        // ========================================
        // Export File
        // ========================================
        const fileName = `Raw_Yarn_Stock_Report_${currentReportData.yarn_lot}_${new Date().toISOString().split('T')[0]}.xlsx`;
        XLSX.writeFile(wb, fileName);
        
        console.log('Report exported successfully');
        
    } catch (error) {
        console.error('Error exporting to Excel:', error);
        alert('Failed to export report: ' + error.message);
    }
}

function clearReport() {
    if (confirm('Are you sure you want to clear the current report?')) {
        currentReportData = null;
        hideReport();
        document.getElementById('searchYarnLot').value = '';
        
        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// =====================================================
// EVENT LISTENERS
// =====================================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('Raw Yarn Stock Report initialized');
    
    // Fetch yarn lots on load
    fetchYarnLots();
    
    // Generate Report button
    const generateBtn = document.getElementById('generateReportBtn');
    if (generateBtn) {
        generateBtn.addEventListener('click', function() {
            const yarnLot = document.getElementById('searchYarnLot').value;
            
            if (!yarnLot) {
                alert('Please select a yarn lot');
                return;
            }
            
            fetchStockReport(yarnLot);
        });
    }
    
    // Export Excel button
    const exportBtn = document.getElementById('exportExcelBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportToExcel);
    }
    
    // Clear Report button
    const clearBtn = document.getElementById('clearReportBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', clearReport);
    }
    
    // Enter key on select
    const yarnLotSelect = document.getElementById('searchYarnLot');
    if (yarnLotSelect) {
        yarnLotSelect.addEventListener('change', function() {
            if (this.value) {
                // Auto-generate report on selection
                fetchStockReport(this.value);
            }
        });
    }
});
