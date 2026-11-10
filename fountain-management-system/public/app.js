// ==========================================
// FOUNTAIN INTERNATIONAL TRADING PLC - APP.JS (UPDATED)
// ==========================================

let records = [];
let currentZoomLevel = 1; // ለሰነድ ማሳያ ዙም መቆጣጠሪያ
let selectedReportIds = new Set(); // ለ"የተመረጡትን አትም" ተግባር የተመረጡ የሪፖርት ረድፎች
let currentReceiptId = null; // በአሁኑ ጊዜ በደረሰኝ ማሳያ (receipt modal) ላይ ያለው መዝገብ
const currentUser = JSON.parse(sessionStorage.getItem("user"));
const authToken = sessionStorage.getItem("authToken") || "";

if (!currentUser) {
    window.location.href = "login.html";
}

// Every request that touches real data now needs to prove who's asking —
// the server checks this token itself, it's not just a UI nicety anymore.
// Use this instead of the raw fetch() for any /api call other than login/register.
async function authFetch(url, options = {}) {
    options.headers = { ...(options.headers || {}), 'Authorization': `Bearer ${authToken}` };
    let res = await fetch(url, options);
    if (res.status === 401) {
        // Token missing/expired — send the person back to log in again.
        sessionStorage.removeItem('user');
        sessionStorage.removeItem('authToken');
        alert('የመግቢያ ጊዜዎ አልቆ ወይም ልክ ያልሆነ ስለሆነ እንደገና መግባት አለብዎት።');
        window.location.href = 'login.html';
        throw new Error('unauthorized');
    }
    return res;
}

// ===== Safe amount entry (fixes numbers getting silently corrupted) =====
// The old amount fields were <input type="number">, which Chrome/Firefox quietly
// change whenever the mouse wheel scrolls over them while focused (e.g. typing
// 150,000 then scrolling the page nudges it down to 149,969, 31 scroll "clicks"
// subtracted) — that's why entered figures were coming out wrong on receipts.
// Fields are now plain text inputs: formatAmountInput() shows live thousands
// separators as you type, and getAmountValue()/only strips those separators
// back out, so the number stored is always exactly what was typed — nothing
// else (wheel, arrow keys, locale) can ever alter it again.
function formatAmountInput(el) {
    let cursorFromEnd = el.value.length - el.selectionStart;
    let raw = el.value.replace(/[^0-9.]/g, '');
    let firstDot = raw.indexOf('.');
    if (firstDot !== -1) {
        raw = raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, '');
    }
    let [intPart, decPart] = raw.split('.');
    intPart = (intPart || '').replace(/^0+(?=\d)/, '');
    let formattedInt = intPart ? Number(intPart).toLocaleString('en-US') : '';
    el.value = decPart !== undefined ? `${formattedInt}.${decPart}` : formattedInt;
    let pos = Math.max(0, el.value.length - cursorFromEnd);
    el.setSelectionRange(pos, pos);
}
// Reads a formatted amount field back out as the exact plain number entered.
function getAmountValue(id) {
    let raw = (document.getElementById(id).value || '').replace(/,/g, '').trim();
    return raw === '' ? NaN : Number(raw);
}
// Fills an amount field with a value, pre-formatted with thousands separators.
function setAmountValue(id, value) {
    let el = document.getElementById(id);
    if (!el) return;
    el.value = (value === null || value === undefined || value === '') ? '' : Number(value).toLocaleString('en-US');
}
// Belt-and-suspenders: any remaining/legacy <input type="number"> on the page
// still gets blurred the instant a wheel event reaches it, so scrolling can
// never silently change a focused number field's value.
document.addEventListener('wheel', () => {
    let active = document.activeElement;
    if (active && active.tagName === 'INPUT' && active.type === 'number') {
        active.blur();
    }
}, { passive: true });

document.addEventListener("DOMContentLoaded", () => {
    let userDisplay = document.getElementById('currentUser');
    if (userDisplay && currentUser) {
        userDisplay.innerText = `${currentUser.fullName || currentUser.username} (${currentUser.role})`;
    }

    if (currentUser && currentUser.role !== 'Admin') {
        let menuUsers = document.getElementById('menu-users');
        if (menuUsers) menuUsers.style.display = 'none';
    } else if (currentUser && currentUser.role === 'Admin') {
        let quickBtn = document.getElementById('admin-users-quick-btn');
        if (quickBtn) quickBtn.style.display = 'flex';
        fetchUsersList();

        let restoreBlock = document.getElementById('restore-admin-only');
        let restoreNote = document.getElementById('restore-admin-note');
        if (restoreBlock) restoreBlock.style.display = 'block';
        if (restoreNote) restoreNote.style.display = 'none';
    }

    fetchRecords();
    fetchApprovalNotifications();
    setupDocumentModalZoom();

    // Keep nagging about open reminders every 5 minutes while the app stays
    // open, instead of only alerting once at page load — this re-arms the
    // "already notified" list so due/overdue items toast + beep again. Also
    // re-check for new approval requests/updates on the same cadence.
    setInterval(() => {
        notifiedRecordIds.clear();
        checkAndTriggerNotifications();
        fetchApprovalNotifications();
    }, 5 * 60 * 1000);
});

let financialEvents = []; // current + all renewal-history amounts — see server comment on /api/records/financial-events

async function fetchRecords() {
    try {
        const res = await authFetch(`/api/records/${currentUser.id}`);
        records = await res.json();
        // Best-effort: if this call fails for any reason, totals just fall
        // back to only the current records (same as before this feature),
        // rather than blocking the whole page.
        try {
            const evRes = await authFetch(`/api/records/financial-events/${currentUser.id}`);
            financialEvents = await evRes.json();
        } catch (evErr) {
            financialEvents = records;
        }
        renderAllData();
        checkAndTriggerNotifications();
    } catch (err) {
        console.log("መረጃዎችን ማምጣት አልተቻለም");
    }
}

async function fetchUsersList() {
    try {
        const res = await authFetch('/api/users');
        const users = await res.json();

        let pendingCount = users.filter(u => u.status === 'pending').length;
        let pendingBadge = document.getElementById('pending-users-badge');
        if (pendingBadge) {
            if (pendingCount > 0) {
                pendingBadge.innerText = pendingCount;
                pendingBadge.style.display = 'inline-block';
            } else {
                pendingBadge.style.display = 'none';
            }
        }

        let usersTable = document.getElementById('all-users-list');
        if (usersTable) {
            usersTable.innerHTML = '';
            users.forEach(u => {
                let statusBadge = u.status === 'approved' 
                    ? '<span style="color:green; font-weight:bold;">የጸደቀ (Approved)</span>' 
                    : '<span style="color:orange; font-weight:bold;">በምጠባበቅ ላይ (Pending)</span>';
                
                let actionButtons = u.status === 'pending'
                    ? `<button class="btn-submit" style="padding:4px 8px; font-size:11px; background-color:#2f855a;" onclick="updateUserStatus('${u._id}', 'approved')">ፍቀድ</button> `
                    : '';
                actionButtons += `<button class="btn-logout" style="padding:4px 8px; font-size:11px;" onclick="deleteUser('${u._id}')">ሰርዝ</button>`;

                // Admin-editable responsibilities: Admin role always has full
                // access regardless of these, so the checkboxes are disabled
                // (and shown as implicitly "all") for Admin accounts.
                let perms = Array.isArray(u.permissions) ? u.permissions : ['prepare'];
                let isAdminRole = u.role === 'Admin';
                let permsHtml = isAdminRole
                    ? `<span style="font-size:11px; color:#a0aec0;">ሁሉም (Admin)</span>`
                    : `
                        <label style="display:flex; align-items:center; gap:4px; font-size:11px; font-weight:normal; margin-bottom:3px;">
                            <input type="checkbox" id="perm-${u._id}-prepare" style="width:auto; margin:0;" ${perms.includes('prepare') ? 'checked' : ''} onchange="updateUserPermission('${u._id}', 'prepare', this.checked)"> ማዘጋጀት
                        </label>
                        <label style="display:flex; align-items:center; gap:4px; font-size:11px; font-weight:normal;">
                            <input type="checkbox" id="perm-${u._id}-approve" style="width:auto; margin:0;" ${perms.includes('approve') ? 'checked' : ''} onchange="updateUserPermission('${u._id}', 'approve', this.checked)"> ማጽደቅ
                        </label>
                    `;

                usersTable.innerHTML += `
                    <tr>
                        <td style="font-size:11px;">${u._id}</td>
                        <td>${u.fullName || '-'}</td>
                        <td>${u.email || '-'}</td>
                        <td><strong>${u.username}</strong></td>
                        <td>${u.role}</td>
                        <td class="no-print">${permsHtml}</td>
                        <td>${statusBadge}</td>
                        <td class="no-print">${actionButtons}</td>
                    </tr>
                `;
            });
        }
    } catch (err) {}
}

async function updateUserStatus(userId, status) {
    try {
        let res = await authFetch(`/api/users/status/${userId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        if (res.ok) {
            fetchUsersList();
            alert("የተጠቃሚው ሁኔታ ተስተካክሏል!");
        }
    } catch (err) {
        alert("ስህተት አጋጥሟል!");
    }
}

// Toggling a responsibility checkbox in the users table saves immediately —
// sends the user's full updated permission set (both checkboxes, not just
// the one that changed) so an unrelated toggle can't drop the other one.
async function updateUserPermission(userId, perm, checked) {
    let prepareBox = document.getElementById(`perm-${userId}-prepare`);
    let approveBox = document.getElementById(`perm-${userId}-approve`);
    let current = [];
    if (prepareBox && prepareBox.checked) current.push('prepare');
    if (approveBox && approveBox.checked) current.push('approve');

    try {
        let res = await authFetch(`/api/users/permissions/${userId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ permissions: current })
        });
        if (!res.ok) {
            let data = await res.json();
            alert(data.error || "ኃላፊነቱን ማዘመን አልተቻለም");
            fetchUsersList(); // revert the checkbox to the real saved state
        }
    } catch (err) {
        fetchUsersList();
    }
}

async function registerUser(e) {
    e.preventDefault();
    const fullName = document.getElementById('reg-fullname').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value;
    const role = document.getElementById('reg-role').value;
    let permissions = [];
    if (document.getElementById('reg-perm-prepare').checked) permissions.push('prepare');
    if (document.getElementById('reg-perm-approve').checked) permissions.push('approve');

    let submitBtn = document.querySelector('#user-register-form button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
        const res = await authFetch('/api/users/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fullName, email, username, password, role, permissions,
                // The Admin is directly assigning this username/password here, so the
                // account should be usable right away instead of sitting as "Pending".
                // (The server only honors this if the request truly carries an Admin token.)
                status: 'approved'
            })
        });

        const data = await res.json();

        if (res.ok) {
            alert("ተጠቃሚው በተሳካ ሁኔታ ተመዝግቧል! አሁኑኑ በተሰጠው Username እና Password መግባት ይችላሉ።");
            document.getElementById('user-register-form').reset();
            fetchUsersList();
        } else {
            alert(data.error || "የተጠቃሚ ምዝገባ አልተሳካም!");
        }
    } catch (err) {
        alert("ከሰርቨር ጋር መገናኘት አልተቻለም!");
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

async function deleteUser(userId) {
    if (confirm("እርግጠኛ ነዎት ይህንን ተጠቃሚ መሰረዝ ይፈልጋሉ?")) {
        try {
            let res = await authFetch(`/api/users/${userId}`, { method: 'DELETE' });
            if (res.ok) {
                fetchUsersList();
            }
        } catch (err) {}
    }
}

function logout() {
    sessionStorage.clear();
    window.location.href = "login.html";
}

// ===== Mobile sidebar (hamburger menu) =====
// On narrow screens the sidebar is CSS-hidden off-canvas by default; this
// toggles the class that slides it into view plus a dimmed backdrop. Pass an
// explicit boolean to force it open/closed (e.g. always closing when a menu
// item is picked), or call with no argument to just flip the current state.
function toggleMobileSidebar(forceOpen) {
    let sidebar = document.getElementById('app-sidebar');
    let overlay = document.getElementById('sidebar-overlay');
    if (!sidebar || !overlay) return;
    let shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !sidebar.classList.contains('sidebar-mobile-open');
    sidebar.classList.toggle('sidebar-mobile-open', shouldOpen);
    overlay.classList.toggle('sidebar-overlay-visible', shouldOpen);
}

function showSection(sectionId, menuId) {
    document.querySelectorAll('.page-section').forEach(sec => sec.style.display = 'none');
    document.getElementById(sectionId).style.display = 'block';
    document.querySelectorAll('.sidebar-item').forEach(item => item.classList.remove('active'));
    let activeMenu = document.getElementById(menuId);
    if (activeMenu) activeMenu.classList.add('active');
    // Picking a section from the mobile off-canvas menu should close it
    // again immediately, the same way it would on any mobile app.
    toggleMobileSidebar(false);

    // Clear any in-progress "renew" state so navigating away and back never
    // leaves a stale edit-id that would silently overwrite the wrong record
    // next time the form is submitted. renewRecord() re-populates these
    // fields right after calling showSection(), so this doesn't interfere.
    if (sectionId === 'payments-sec') resetRecordFormMode('pay');
    if (sectionId === 'contracts-sec') resetRecordFormMode('con');
    if (sectionId === 'signature-sec') loadMySignatureStatus();
    if (sectionId === 'trash-sec') fetchTrash();
    // Chart.js needs a visible (non-zero-size) canvas to size itself
    // correctly, so redraw the dashboard charts right after it becomes visible.
    if (sectionId === 'dashboard-sec') renderDashboardCharts();
}

// Dashboard summary cards (🔴 overdue / 🟡 due this month) are clickable:
// they filter the dashboard's own activity table in place and scroll to it,
// so each status has its own clearly separated view without leaving the dashboard.
function filterDashboardByStatus(status) {
    showSection('dashboard-sec', 'menu-dash');

    let filterSelect = document.getElementById('statusFilter');
    if (filterSelect) {
        filterSelect.value = status;
    }
    renderAllData();

    let table = document.getElementById('dash-data-list');
    if (table) {
        table.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function toggleOtherInput(prefix) {
    let selectVal = document.getElementById(prefix + '-item-type').value;
    let otherGroup = document.getElementById(prefix + '-other-group');
    let otherInput = document.getElementById(prefix + '-other-name');

    if (selectVal === 'ሌላ (Other)') {
        otherGroup.style.display = 'block';
        otherInput.required = true;
    } else {
        otherGroup.style.display = 'none';
        otherInput.required = false;
        otherInput.value = '';
    }
}

async function handleFormSubmit(e, category) {
    e.preventDefault();
    let prefix = category === 'ክፍያ' ? 'pay' : 'con';
    let selectedType = document.getElementById(prefix + '-item-type').value;
    let otherName = document.getElementById(prefix + '-other-name').value.trim();
    let description = document.getElementById(prefix + '-item-desc').value.trim();
    
    let typeName = selectedType === 'ሌላ (Other)' && otherName !== '' ? otherName : selectedType;
    let finalFullName = `${typeName} (${description})`;

    let editIdField = document.getElementById(prefix + '-edit-id');
    let editId = editIdField ? editIdField.value : '';

    let formData = new FormData();
    formData.append('userId', currentUser.id);
    formData.append('name', finalFullName);
    let amountValue = getAmountValue(prefix + '-item-amount');
    if (isNaN(amountValue) || amountValue <= 0) {
        alert("የክፍያ/ውል መጠን ትክክለኛ ቁጥር መሆን አለበት!");
        return;
    }
    formData.append('amount', amountValue);
    formData.append('paymentDate', document.getElementById(prefix + '-item-paydate').value);
    formData.append('startDate', document.getElementById(prefix + '-item-startdate').value);
    formData.append('dueDate', document.getElementById(prefix + '-item-duedate').value);
    formData.append('category', category);
    
    let fileInput = document.getElementById(prefix + '-item-file');
    if (fileInput.files[0]) formData.append('file', fileInput.files[0]);

    try {
        let url = editId ? `/api/records/${editId}` : '/api/records';
        let method = editId ? 'PUT' : 'POST';
        let res = await authFetch(url, { method, body: formData });
        if (res.ok) {
            fetchRecords();
            document.getElementById(category === 'ክፍያ' ? 'payment-form' : 'contract-form').reset();
            resetRecordFormMode(prefix);
            alert(editId ? "ውሉ/ክፍያው በአዲስ ቀን ታድሷል!" : "መረጃው በትክክል ተመዝግቧል!");
        }
    } catch (err) {
        alert("ስህተት አጋጥሟል!");
    }
}

// Splits a stored "TypeName (Description)" record name back into its parts,
// the reverse of how handleFormSubmit builds finalFullName above.
function splitRecordName(fullName) {
    let match = /^(.*) \(([^)]*)\)$/.exec(fullName || '');
    if (match) {
        return { typeName: match[1], description: match[2] };
    }
    return { typeName: fullName || '', description: '' };
}

function resetRecordFormMode(prefix) {
    let editIdField = document.getElementById(prefix + '-edit-id');
    if (editIdField) editIdField.value = '';

    let submitBtn = document.getElementById(prefix + '-btn-submit');
    if (submitBtn) {
        submitBtn.innerHTML = prefix === 'pay'
            ? '<i class="fas fa-save"></i> ክፍያ መዝግብ'
            : '<i class="fas fa-save"></i> ውል መዝግብ';
    }

    let formTitle = document.getElementById(prefix + '-form-title');
    if (formTitle) {
        formTitle.innerHTML = prefix === 'pay'
            ? '<i class="fas fa-plus-circle"></i> አዲስ የክፍያ መረጃ መዝግብ'
            : '<i class="fas fa-file-contract"></i> አዲስ የውል መረጃ መዝግብ';
    }
}

// "አድስ" button on an overdue/due record: takes the user to the same
// registration form (already used to create it), pre-filled with the
// existing details, so they only need to update the dates to renew it.
function renewRecord(id) {
    let record = records.find(r => r._id === id);
    if (!record) return;

    let isPayment = record.category === 'ክፍያ';
    let prefix = isPayment ? 'pay' : 'con';
    let sectionId = isPayment ? 'payments-sec' : 'contracts-sec';
    let menuId = isPayment ? 'menu-pay' : 'menu-contract';

    showSection(sectionId, menuId);

    let { typeName, description } = splitRecordName(record.name);
    let typeSelect = document.getElementById(prefix + '-item-type');
    let knownOption = typeSelect
        ? Array.from(typeSelect.options).some(o => o.value === typeName)
        : false;

    if (typeSelect) {
        typeSelect.value = knownOption ? typeName : 'ሌላ (Other)';
    }
    toggleOtherInput(prefix);
    if (!knownOption) {
        document.getElementById(prefix + '-other-name').value = typeName;
    }

    document.getElementById(prefix + '-item-desc').value = description;
    setAmountValue(prefix + '-item-amount', record.amount);
    document.getElementById(prefix + '-item-paydate').value = record.paymentDate;
    document.getElementById(prefix + '-item-startdate').value = record.startDate;
    // Due date is intentionally left for the user to pick fresh — that's the
    // date being renewed — but pre-fill it with the old value as a starting point.
    document.getElementById(prefix + '-item-duedate').value = record.dueDate;

    document.getElementById(prefix + '-edit-id').value = record._id;

    let submitBtn = document.getElementById(prefix + '-btn-submit');
    if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-redo"></i> ውሉን/ክፍያውን አድስ (አዲስ ቀን አስቀምጥ)';

    let formTitle = document.getElementById(prefix + '-form-title');
    if (formTitle) formTitle.innerHTML = `<i class="fas fa-redo"></i> ማደሻ፦ ${record.name}`;

    let form = document.getElementById(isPayment ? 'payment-form' : 'contract-form');
    if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function deleteRecord(id) {
    if (confirm("እርግጠኛ ነዎት መሰረዝ ይፈልጋሉ? ይህ ወደ ትራሽ (Trash) ብቻ ይላካል፣ ከዚያ መልሰው ማምጣት ይችላሉ።")) {
        try {
            let res = await authFetch(`/api/records/${id}`, { method: 'DELETE' });
            if (res.ok) fetchRecords();
        } catch (err) {}
    }
}

// ===== Trash =====
async function fetchTrash() {
    let list = document.getElementById('trash-data-list');
    if (!list) return;
    list.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#a0aec0;">በመጫን ላይ...</td></tr>`;
    try {
        let res = await authFetch(`/api/trash/${currentUser.id}`);
        let items = await res.json();
        if (!items.length) {
            list.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#a0aec0;">ትራሹ ባዶ ነው</td></tr>`;
            return;
        }
        let isAdmin = currentUser && currentUser.role === 'Admin';
        list.innerHTML = items.map(item => `
            <tr>
                <td><strong>[${item.category}]</strong> ${item.name}</td>
                <td>${Number(item.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} ብር</td>
                <td>${item.dueDate}</td>
                <td>${item.deletedAt ? new Date(item.deletedAt).toLocaleString() : ''}</td>
                <td>
                    <button class="btn-submit" style="padding:4px 8px; font-size:12px; background: linear-gradient(135deg, #38a169 0%, #276749 100%);" onclick="restoreFromTrash('${item._id}')"><i class="fas fa-trash-restore"></i> መልስ (Restore)</button>
                    ${isAdmin ? `<button class="btn-logout" style="padding:4px 8px; font-size:12px;" onclick="permanentlyDeleteFromTrash('${item._id}')"><i class="fas fa-trash-alt"></i> ለዘላለም ሰርዝ</button>` : ''}
                </td>
            </tr>
        `).join('');
    } catch (err) {
        list.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#feb2b2;">ትራሽን ማምጣት አልተቻለም</td></tr>`;
    }
}
async function restoreFromTrash(id) {
    try {
        let res = await authFetch(`/api/trash/${id}/restore`, { method: 'POST' });
        let data = await res.json();
        if (res.ok) {
            fetchTrash();
            fetchRecords();
        } else {
            alert(data.error || "መልስ ማድረግ አልተቻለም");
        }
    } catch (err) {}
}
async function permanentlyDeleteFromTrash(id) {
    if (!confirm("ይህ ድርጊት የማይቀለበስ ነው — ይህ መዝገብ እና ታሪኩ ለዘላለም ይጠፋሉ። እርግጠኛ ነዎት?")) return;
    try {
        let res = await authFetch(`/api/trash/${id}/permanent`, { method: 'DELETE' });
        let data = await res.json();
        if (res.ok) {
            fetchTrash();
        } else {
            alert(data.error || "ማጥፋት አልተቻለም");
        }
    } catch (err) {}
}

// ===== Pagination (dashboard / payments / contracts lists) =====
// Each of the three main record tables keeps its own current page and shows
// RECORDS_PER_PAGE rows at a time — long lists no longer render (and scroll)
// as one giant table.
const RECORDS_PER_PAGE = 10;
let pageState = { dash: 1, pay: 1, con: 1 };
function resetDashPage() { pageState.dash = 1; renderAllData(); }
function goToPage(key, page) {
    pageState[key] = page;
    renderAllData();
    let tbody = document.getElementById(key === 'dash' ? 'dash-data-list' : key === 'pay' ? 'pay-data-list' : 'con-data-list');
    if (tbody) tbody.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function paginationBarHtml(key, page, totalPages, totalItems) {
    if (totalItems === 0) return '';
    return `
        <div class="pagination-bar no-print">
            <span class="pagination-info">ጠቅላላ ${totalItems} ውጤቶች — ገጽ ${page} ከ ${totalPages}</span>
            <div class="pagination-controls">
                <button type="button" class="pagination-btn" ${page <= 1 ? 'disabled' : ''} onclick="goToPage('${key}', ${page - 1})">‹ ቀዳሚ</button>
                <button type="button" class="pagination-btn" ${page >= totalPages ? 'disabled' : ''} onclick="goToPage('${key}', ${page + 1})">ቀጣይ ›</button>
            </div>
        </div>
    `;
}
// Slices `rows` (an array of <tr> HTML strings) to the current page for
// `key`, writes them into `tbodyId`, and renders the pager into `pagId`.
function renderPage(key, tbodyId, pagId, rows, emptyColspan) {
    let tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    let totalPages = Math.max(1, Math.ceil(rows.length / RECORDS_PER_PAGE));
    if (pageState[key] > totalPages) pageState[key] = totalPages;
    if (pageState[key] < 1) pageState[key] = 1;
    let page = pageState[key];
    let start = (page - 1) * RECORDS_PER_PAGE;
    let pageRows = rows.slice(start, start + RECORDS_PER_PAGE);
    tbody.innerHTML = pageRows.length
        ? pageRows.join('')
        : `<tr><td colspan="${emptyColspan}" style="text-align:center; padding:20px; color:#a0aec0;">ምንም መረጃ አልተገኘም</td></tr>`;

    let pagEl = document.getElementById(pagId);
    if (pagEl) pagEl.innerHTML = paginationBarHtml(key, page, totalPages, rows.length);
}

function renderAllData() {
    let dashList = document.getElementById('dash-data-list');
    let payList = document.getElementById('pay-data-list');
    let conList = document.getElementById('con-data-list');
    let gallery = document.getElementById('contracts-gallery');
    let reportList = document.getElementById('report-list');

    if (!dashList) return;

    // Rows are collected here (instead of being appended straight into the
    // table) so pagination can slice each list down to one page at the end,
    // while counts/totals below are still computed over the FULL dataset.
    let dashRows = [];
    let payRows = [];
    let conRows = [];
    if (gallery) gallery.innerHTML = '';
    if (reportList) reportList.innerHTML = '';

    let today = new Date();
    today.setHours(0,0,0,0);

    let overdueCount = 0;
    let dueSoonCount = 0;
    let totalContractCount = 0;
    // Total expense (and the monthly/type charts below) intentionally sum
    // financialEvents rather than this records loop — see the server-side
    // comment on /api/records/financial-events: a renewed record only keeps
    // its latest amount here, but every past renewal was a real payment that
    // must still count toward the total.
    let totalExpense = financialEvents
        .filter(e => e.category === 'ክፍያ')
        .reduce((sum, e) => sum + Number(e.amount || 0), 0);
    let reportIndex = 1;

    let filterSelect = document.getElementById('statusFilter');
    let searchInput = document.getElementById('dash-search'); // Fixed ID from searchQuery to dash-search
    let filterValue = filterSelect ? filterSelect.value : 'all';
    let searchQuery = searchInput ? searchInput.value.toLowerCase() : '';

    records.forEach((item) => {
        let due = new Date(item.dueDate);
        due.setHours(0,0,0,0);
        let diffDays = Math.ceil((due - today) / (1000 * 60 * 60 * 24));

        let statusText = '';
        let statusClass = '';
        let statusType = ''; 

        if (diffDays < 0) {
            statusText = `🔴 ቀን ያለፈበት (${Math.abs(diffDays)} ቀን አልፏል)`;
            statusClass = 'color:red; font-weight:bold;';
            statusType = 'overdue';
            overdueCount++;
        } else if (diffDays <= 7) {
            statusText = `🟡 ማሳሰቢያ (${diffDays} ቀን ቀርቶታል)`;
            statusClass = 'color:#d97706; font-weight:bold;';
            statusType = 'upcoming';
            dueSoonCount++;
        } else {
            statusText = '🟢 በጊዜው ላይ ያለ';
            statusClass = 'color:green; font-weight:bold;';
            statusType = 'normal';
        }

        let matchesSearch = item.name.toLowerCase().includes(searchQuery) || item.category.toLowerCase().includes(searchQuery);
        let matchesFilter = true;

        if (filterValue === 'overdue') {
            matchesFilter = (statusType === 'overdue');
        } else if (filterValue === 'upcoming') {
            matchesFilter = (statusType === 'upcoming');
        } else if (filterValue === 'normal') {
            matchesFilter = (statusType === 'normal');
        } else {
            matchesFilter = true;
        }

        if (item.category === 'ውል') totalContractCount++;
        let formattedAmount = Number(item.amount).toLocaleString(undefined, { minimumFractionDigits: 2 });

        // "አድስ" should appear starting 10 days before the due date, through
        // the due date itself, and for every day it's overdue afterwards.
        let showRenew = diffDays <= 10;

        let makeRow = (incCat) => `
            <tr>
                ${incCat ? `<td><strong>[${item.category}]</strong> ${item.name}</td>` : `<td>${item.name}</td>`}
                <td>${formattedAmount} ብር</td>
                <td>${item.paymentDate}</td>
                <td>${item.startDate} እስከ ${item.dueDate}</td>
                <td style="${statusClass}">${statusText}</td>
                <td class="no-print">
                    ${item.file ? `<button class="btn-submit" style="padding:4px 8px; font-size:12px;" onclick="previewImage('${item.file}')">እይታ</button>` : ''}
                    ${showRenew ? `<button class="btn-submit" style="padding:4px 8px; font-size:12px; background: linear-gradient(135deg, #38a169 0%, #276749 100%);" onclick="renewRecord('${item._id}')" title="ቀኑን በማዘመን ውሉን/ክፍያውን ያድሱ"><i class="fas fa-redo"></i> አድስ</button>` : ''}
                    <button class="btn-logout" style="padding:4px 8px; font-size:12px;" onclick="deleteRecord('${item._id}')">ሰርዝ</button>
                </td>
            </tr>
        `;

        if (matchesSearch && matchesFilter) {
            dashRows.push(makeRow(true));
        }

        if (item.category === 'ክፍያ') {
            payRows.push(makeRow(false));
            if (reportList) {
                let isChecked = selectedReportIds.has(item._id) ? 'checked' : '';
                reportList.innerHTML += `
                    <tr data-record-id="${item._id}">
                        <td>
                            <input type="checkbox" class="report-row-check" data-id="${item._id}" ${isChecked} onchange="toggleReportRowSelect('${item._id}', this.checked)">
                            ${reportIndex++}
                        </td>
                        <td>${item.name}</td>
                        <td>${item.paymentDate}</td>
                        <td>${formattedAmount} ብር</td>
                        <td class="no-print">
                            <span class="row-actions">
                                <button type="button" class="row-action-btn" title="እይታ" onclick="previewReceipt('${item._id}')"><i class="fas fa-eye"></i></button>
                                <button type="button" class="row-action-btn" title="አትም" onclick="printSingleReceipt('${item._id}')"><i class="fas fa-print"></i></button>
                            </span>
                        </td>
                    </tr>
                `;
            }
        }
        if (item.category === 'ውል') {
            conRows.push(makeRow(false));
            if (gallery && item.file) {
                gallery.innerHTML += `<div style="border:1px solid rgba(255,255,255,0.1); padding:10px; border-radius:8px; width:180px; text-align:center; background:rgba(255,255,255,0.05);"><img src="${item.file}" style="width:100%; height:140px; object-fit:cover; cursor:pointer;" onclick="previewImage('${item.file}')"><p style="font-size:12px; margin-top:5px; color:#fff;">${item.name}</p></div>`;
            }
        }
    });

    let overdueEl = document.getElementById('overdue-count');
    let dueEl = document.getElementById('due-count');
    let conEl = document.getElementById('contract-count');
    
    if (overdueEl) overdueEl.innerText = overdueCount;
    if (dueEl) dueEl.innerText = dueSoonCount;
    if (conEl) conEl.innerText = totalContractCount;
    
    document.querySelectorAll('.total-report-amount-val').forEach(el => el.innerText = totalExpense.toLocaleString() + ' ብር');

    renderPage('dash', 'dash-data-list', 'dash-pagination', dashRows, 6);
    renderPage('pay', 'pay-data-list', 'pay-pagination', payRows, 6);
    renderPage('con', 'con-data-list', 'con-pagination', conRows, 6);

    renderDashboardCharts();
    syncReportSelectAllState();
}

// ===== Dashboard charts (Chart.js) =====
// Three charts built straight from the already-loaded `records` array — no
// extra API calls. Chart instances are tracked and destroyed before each
// redraw (Chart.js requirement), and rendering is skipped while the
// dashboard section itself isn't visible, since a hidden canvas has no
// real size to draw into.
let chartInstances = { monthly: null, status: null, type: null };
const CHART_COLORS = ['#3182ce', '#38a169', '#dd6b20', '#e53e3e', '#805ad5', '#d69e2e', '#319795', '#718096'];

// The very first render can race the Chart.js CDN <script> tag (records load
// from the local API almost instantly; a CDN fetch over the network can take
// longer, especially on a slow connection or when the primary CDN needs to
// fall back to a secondary one). Instead of silently giving up the instant
// Chart isn't defined yet, retry for a few seconds; only after that genuinely
// give up and show a visible message in each chart instead of leaving it a
// blank, unexplained box.
let dashboardChartRetries = 0;
function renderDashboardCharts() {
    let dashSection = document.getElementById('dashboard-sec');
    if (!dashSection || dashSection.style.display === 'none') return;

    if (typeof Chart === 'undefined') {
        if (dashboardChartRetries < 15) {
            dashboardChartRetries++;
            setTimeout(renderDashboardCharts, 400);
        } else {
            showChartLoadFailure();
        }
        return;
    }
    dashboardChartRetries = 0;

    renderMonthlyExpenseChart();
    renderStatusBreakdownChart();
    renderTypeBreakdownChart();
}
function showChartLoadFailure() {
    document.querySelectorAll('.chart-canvas-wrap').forEach(wrap => {
        if (wrap.querySelector('.chart-empty-note')) return;
        let note = document.createElement('div');
        note.className = 'chart-empty-note';
        note.innerHTML = 'ግራፍ መጫን አልተቻለም — የኢንተርኔት ግንኙነትዎን አረጋግጠው ገጹን እንደገና ይጫኑ';
        wrap.appendChild(note);
    });
}

function renderMonthlyExpenseChart() {
    let canvas = document.getElementById('chart-monthly-expense');
    if (!canvas) return;

    // Build the last 6 calendar months (oldest to newest) as "YYYY-MM" keys,
    // pre-seeded at 0 so a month with no payments still shows up as a gap.
    let months = [];
    let now = new Date();
    for (let i = 5; i >= 0; i--) {
        let d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('am-ET', { month: 'short', year: '2-digit' }) });
    }
    let totals = Object.fromEntries(months.map(m => [m.key, 0]));

    // Uses financialEvents (current + renewal history), not records — each
    // renewal's amount is a real payment that happened in its own month and
    // must be counted there, not just the latest amount in the latest month.
    financialEvents.forEach(item => {
        if (item.category !== 'ክፍያ' || !item.paymentDate) return;
        let key = item.paymentDate.slice(0, 7); // "YYYY-MM" out of "YYYY-MM-DD"
        if (key in totals) totals[key] += Number(item.amount) || 0;
    });

    if (chartInstances.monthly) chartInstances.monthly.destroy();
    chartInstances.monthly = new Chart(canvas, {
        type: 'line',
        data: {
            labels: months.map(m => m.label),
            datasets: [{
                label: 'ወጪ (ብር)',
                data: months.map(m => totals[m.key]),
                borderColor: '#3182ce',
                backgroundColor: 'rgba(49, 130, 206, 0.15)',
                fill: true,
                tension: 0.3
            }]
        },
        options: chartBaseOptions()
    });
}

function renderStatusBreakdownChart() {
    let canvas = document.getElementById('chart-status-breakdown');
    if (!canvas) return;

    let today = new Date();
    today.setHours(0, 0, 0, 0);
    let counts = { overdue: 0, upcoming: 0, normal: 0 };
    records.forEach(item => {
        let due = new Date(item.dueDate);
        due.setHours(0, 0, 0, 0);
        let diffDays = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
        if (diffDays < 0) counts.overdue++;
        else if (diffDays <= 7) counts.upcoming++;
        else counts.normal++;
    });

    if (chartInstances.status) chartInstances.status.destroy();
    chartInstances.status = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: ['🔴 ቀን ያለፈበት', '🟡 በቅርቡ የሚደርስ', '🟢 በጊዜው ላይ ያለ'],
            datasets: [{
                data: [counts.overdue, counts.upcoming, counts.normal],
                backgroundColor: ['#e53e3e', '#dd6b20', '#38a169'],
                borderWidth: 0
            }]
        },
        options: { ...chartBaseOptions(), plugins: { legend: { position: 'bottom', labels: { color: '#cbd5e0', font: { size: 11 } } } } }
    });
}

function renderTypeBreakdownChart() {
    let canvas = document.getElementById('chart-type-breakdown');
    if (!canvas) return;

    let totalsByType = {};
    // Sums financialEvents (current + renewal history) for the same reason
    // as the monthly chart above — each renewal is a real amount to count.
    financialEvents.forEach(item => {
        if (item.category !== 'ክፍያ') return;
        let { typeName } = splitRecordName(item.name);
        typeName = typeName || 'ያልታወቀ';
        totalsByType[typeName] = (totalsByType[typeName] || 0) + (Number(item.amount) || 0);
    });
    let entries = Object.entries(totalsByType).sort((a, b) => b[1] - a[1]);

    if (chartInstances.type) chartInstances.type.destroy();
    chartInstances.type = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: entries.map(e => e[0]),
            datasets: [{
                label: 'ጠቅላላ ወጪ (ብር)',
                data: entries.map(e => e[1]),
                backgroundColor: entries.map((_, i) => CHART_COLORS[i % CHART_COLORS.length])
            }]
        },
        options: { ...chartBaseOptions(), indexAxis: 'y', plugins: { legend: { display: false } } }
    });
}

// Shared Chart.js styling so the three charts read cleanly against the
// app's dark, translucent background.
function chartBaseOptions() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            x: { ticks: { color: '#a0aec0', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.06)' } },
            y: { ticks: { color: '#a0aec0', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.06)' }, beginAtZero: true }
        }
    };
}

function syncReportSelectAllState() {
    let selectAll = document.getElementById('report-select-all');
    if (!selectAll) return;
    let rowChecks = document.querySelectorAll('.report-row-check');
    if (rowChecks.length === 0) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
        return;
    }
    let checkedCount = document.querySelectorAll('.report-row-check:checked').length;
    selectAll.checked = checkedCount === rowChecks.length;
    selectAll.indeterminate = checkedCount > 0 && checkedCount < rowChecks.length;
}

function toggleSelectAllReport(selectAllCheckbox) {
    let checked = selectAllCheckbox.checked;
    document.querySelectorAll('.report-row-check').forEach(cb => {
        cb.checked = checked;
        let id = cb.getAttribute('data-id');
        if (checked) selectedReportIds.add(id); else selectedReportIds.delete(id);
    });
    selectAllCheckbox.indeterminate = false;
}

function toggleReportRowSelect(id, checked) {
    if (checked) selectedReportIds.add(id); else selectedReportIds.delete(id);
    syncReportSelectAllState();
}

function printSelectedReport(idsOverride) {
    let idsToPrint = idsOverride && idsOverride.length ? new Set(idsOverride) : selectedReportIds;

    if (!idsToPrint || idsToPrint.size === 0) {
        alert("እባክዎ ለማተም ቢያንስ አንድ ረድፍ ይምረጡ (ቼክ ቦክስ ላይ ይጫኑ)።");
        return;
    }

    let rows = document.querySelectorAll('#report-list tr[data-record-id]');
    let selectedTotal = 0;

    rows.forEach(row => {
        let id = row.getAttribute('data-record-id');
        if (idsToPrint.has(id)) {
            row.classList.remove('row-hidden-print');
            let record = records.find(r => r._id === id);
            if (record) selectedTotal += Number(record.amount);
        } else {
            row.classList.add('row-hidden-print');
        }
    });

    let totalHeading = document.getElementById('report-total-heading');
    let originalTotalHTML = totalHeading ? totalHeading.innerHTML : null;
    if (totalHeading) {
        totalHeading.innerHTML = `የተመረጡት ጠቅላላ ወጪ: <span class="total-report-amount-val">${selectedTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })} ብር</span>`;
    }

    let restore = () => {
        rows.forEach(row => row.classList.remove('row-hidden-print'));
        if (totalHeading && originalTotalHTML !== null) totalHeading.innerHTML = originalTotalHTML;
        window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);

    window.print();
}

function previewReceipt(id) {
    let record = records.find(r => r._id === id);
    if (!record) return;

    currentReceiptId = id;

    let statusHtml = '-';
    let today = new Date();
    today.setHours(0,0,0,0);
    let due = new Date(record.dueDate);
    due.setHours(0,0,0,0);
    let diffDays = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) statusHtml = `🔴 ቀን ያለፈበት (${Math.abs(diffDays)} ቀን አልፏል)`;
    else if (diffDays <= 7) statusHtml = `🟡 ማሳሰቢያ (${diffDays} ቀን ቀርቶታል)`;
    else statusHtml = '🟢 በጊዜው ላይ ያለ';

    document.getElementById('rcpt-name').innerText = record.name;
    document.getElementById('rcpt-status').innerText = statusHtml;
    document.getElementById('rcpt-paydate').innerText = record.paymentDate;
    document.getElementById('rcpt-period').innerText = `${record.startDate} እስከ ${record.dueDate}`;
    document.getElementById('rcpt-amount').innerText = Number(record.amount).toLocaleString(undefined, { minimumFractionDigits: 2 }) + ' ብር';

    let attachmentSection = document.getElementById('rcpt-attachment-section');
    let attachmentImg = document.getElementById('rcpt-attachment-img');
    if (record.file) {
        attachmentSection.style.display = 'block';
        attachmentImg.src = record.file;
        attachmentImg.style.display = 'block';
    } else {
        attachmentSection.style.display = 'block';
        attachmentImg.style.display = 'none';
        if (!document.getElementById('rcpt-no-attachment-msg')) {
            let msg = document.createElement('div');
            msg.id = 'rcpt-no-attachment-msg';
            msg.className = 'receipt-no-attachment';
            msg.innerText = 'ምንም የተያያዘ ሰነድ የለም';
            document.getElementById('rcpt-attachment-wrap').appendChild(msg);
        }
    }
    if (record.file) {
        let existingMsg = document.getElementById('rcpt-no-attachment-msg');
        if (existingMsg) existingMsg.remove();
    }

    renderReceiptSignatures(record);

    document.getElementById('receipt-modal').style.display = 'flex';
}

function closeReceiptModal() {
    document.getElementById('receipt-modal').style.display = 'none';
    currentReceiptId = null;
}

// Draws the "ያዘጋጀው" / "ያጸደቀው" slots on the receipt. "ያዘጋጀው" is either the
// placed signature or a "ፈርም" button. "ያጸደቀው" depends on the approval
// workflow: signed already, awaiting a specific named approver (only that
// person — or an Admin, as an oversight override — gets a sign button; anyone
// else just sees who it's waiting on), or not sent for approval yet at all.
function signatureSignedBlockHtml(signed) {
    let signedDate = signed.signedAt ? new Date(signed.signedAt).toLocaleDateString() : '';
    return `
        <img src="${signed.signatureImage}" alt="ፊርማ" class="signature-slot-img">
        <div class="signature-slot-meta">
            <strong>${signed.fullName}</strong><br>
            <span>${signed.responsibility}</span><br>
            <span style="font-size:10px; color:#a0aec0;">${signedDate}</span>
        </div>
    `;
}
function renderReceiptSignatures(record) {
    let preparedContainer = document.getElementById('rcpt-sign-prepared');
    if (preparedContainer) {
        if (record.preparedBy && record.preparedBy.signatureImage) {
            preparedContainer.innerHTML = signatureSignedBlockHtml(record.preparedBy);
        } else {
            preparedContainer.innerHTML = `<button class="btn-submit no-print" style="padding:6px 10px; font-size:12px;" onclick="promptAndSign('${record._id}', 'prepared')"><i class="fas fa-signature"></i> ፈርም</button>`;
        }
    }

    let approvedContainer = document.getElementById('rcpt-sign-approved');
    if (approvedContainer) {
        if (record.approvedBy && record.approvedBy.signatureImage) {
            approvedContainer.innerHTML = signatureSignedBlockHtml(record.approvedBy);
        } else if (record.approval && record.approval.pendingApproverId) {
            let isMyApproval = currentUser && (currentUser.id === record.approval.pendingApproverId || currentUser.role === 'Admin');
            approvedContainer.innerHTML = isMyApproval
                ? `<button class="btn-submit no-print" style="padding:6px 10px; font-size:12px;" onclick="promptAndSign('${record._id}', 'approved')"><i class="fas fa-signature"></i> ፈርም</button>`
                : `<span class="no-print" style="font-size:11px; color:#d69e2e;"><i class="fas fa-hourglass-half"></i> ማጽደቅ በ${record.approval.pendingApproverName} እየተጠበቀ ነው</span>`;
        } else if (currentUser && currentUser.role === 'Admin') {
            approvedContainer.innerHTML = `<button class="btn-submit no-print" style="padding:6px 10px; font-size:12px;" onclick="promptAndSign('${record._id}', 'approved')"><i class="fas fa-signature"></i> ፈርም (Admin)</button>`;
        } else {
            approvedContainer.innerHTML = `<span class="no-print" style="font-size:11px; color:#a0aec0;">አዘጋጅ ገና ወደ ማንም አልላከውም</span>`;
        }
    }
}

// Opens the sign-password modal; for the "prepared" slot it also loads the
// list of people who can be sent this record to approve, and requires one
// to be picked before the signature password field is even usable.
let pendingSignContext = null;
async function promptAndSign(recordId, slot) {
    pendingSignContext = { recordId, slot };
    let input = document.getElementById('sign-password-input');
    if (input) input.value = '';
    let errorBox = document.getElementById('sign-password-error');
    if (errorBox) { errorBox.style.display = 'none'; errorBox.innerHTML = ''; }

    let approverGroup = document.getElementById('sign-approver-group');
    let approverSelect = document.getElementById('sign-approver-select');
    if (slot === 'prepared') {
        approverGroup.style.display = 'block';
        approverSelect.required = true;
        approverSelect.innerHTML = '<option value="">-- በመጫን ላይ... --</option>';
        try {
            let res = await authFetch('/api/approvers');
            let approvers = await res.json();
            approverSelect.innerHTML = approvers.length
                ? approvers.map(a => `<option value="${a.id}">${a.fullName} (${a.responsibility})</option>`).join('')
                : '<option value="">ምንም ማጽደቅ የሚችል ተጠቃሚ አልተመዘገበም — መጀመሪያ አድሚን ያዋቅር</option>';
        } catch (err) {
            approverSelect.innerHTML = '<option value="">ዝርዝሩን ማምጣት አልተቻለም</option>';
        }
    } else {
        // Hidden fields still marked `required` block the whole form's submit
        // silently in Chrome — no error, no submit event, the button just
        // looks broken — so this MUST be turned off whenever the group is
        // hidden, not just visually hidden via CSS.
        approverGroup.style.display = 'none';
        approverSelect.required = false;
        approverSelect.value = '';
    }

    document.getElementById('sign-password-modal').style.display = 'flex';
    setTimeout(() => input && input.focus(), 50);
}
function closeSignPasswordModal() {
    document.getElementById('sign-password-modal').style.display = 'none';
    pendingSignContext = null;
}
async function submitSignPassword(e) {
    e.preventDefault();
    if (!pendingSignContext) return;
    let signaturePassword = document.getElementById('sign-password-input').value;
    let { recordId, slot } = pendingSignContext;
    let errorBox = document.getElementById('sign-password-error');
    let submitBtn = document.getElementById('sign-password-submit-btn');
    if (errorBox) { errorBox.style.display = 'none'; errorBox.innerHTML = ''; }

    let body = { slot, signaturePassword };
    if (slot === 'prepared') {
        let sendToApproverId = document.getElementById('sign-approver-select').value;
        if (!sendToApproverId) {
            if (errorBox) {
                errorBox.innerHTML = "እባክዎ ማጽደቅ ያለበትን ሰው ይምረጡ";
                errorBox.style.display = 'block';
            }
            return;
        }
        body.sendToApproverId = sendToApproverId;
    }

    if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> በማስኬድ ላይ...'; }
    try {
        let res = await authFetch(`/api/records/${recordId}/sign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        let data = await res.json();
        if (res.ok) {
            closeSignPasswordModal();
            // Update the local copy so the receipt reflects it immediately,
            // and refresh from the server so the record list stays in sync.
            let idx = records.findIndex(r => r._id === recordId);
            if (idx !== -1) records[idx] = data;
            renderReceiptSignatures(data);
            fetchRecords();
            fetchApprovalNotifications();
        } else {
            // Shown inline (not a dismissible alert) so it can't be missed or
            // accidentally clicked away — the modal stays open to retry.
            // "You haven't registered your own signature yet" gets a direct
            // link to go do that, since that's the single most common reason
            // signing silently seems to "not work."
            if (errorBox) {
                let msg = data.error || "ፊርማ ማድረግ አልተቻለም";
                if (msg.includes('የራስዎን ፊርማ ይመዝገቡ')) {
                    errorBox.innerHTML = `${msg} — <a href="#" onclick="closeSignPasswordModal(); showSection('signature-sec','menu-signature'); return false;" style="color:#fff; text-decoration:underline;">አሁን ይመዝገቡ</a>`;
                } else {
                    errorBox.innerHTML = msg;
                }
                errorBox.style.display = 'block';
            }
        }
    } catch (err) {
        // authFetch already handles the unauthorized/redirect case
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-signature"></i> ፈርም (Sign)'; }
    }
}

// ===== Signature registration page =====
async function loadMySignatureStatus() {
    try {
        let res = await authFetch('/api/signature/mine');
        let data = await res.json();

        let alreadyBox = document.getElementById('sig-already-registered');
        let currentPassGroup = document.getElementById('sig-current-password-group');
        let formTitle = document.getElementById('sig-form-title');
        let submitBtn = document.getElementById('sig-btn-submit');

        if (data.registered) {
            alreadyBox.style.display = 'block';
            document.getElementById('sig-current-name').innerText = data.fullName;
            document.getElementById('sig-current-role').innerText = data.responsibility;
            document.getElementById('sig-current-image').src = data.signatureImage;

            currentPassGroup.style.display = 'block';
            formTitle.innerHTML = '<i class="fas fa-signature"></i> ፊርማ ማስተካከል (መተካት)';
            submitBtn.innerHTML = '<i class="fas fa-save"></i> ፊርማ አዘምን';

            document.getElementById('sig-fullname').value = data.fullName;
            document.getElementById('sig-responsibility').value = data.responsibility;
        } else {
            alreadyBox.style.display = 'none';
            currentPassGroup.style.display = 'none';
            formTitle.innerHTML = '<i class="fas fa-signature"></i> የፊርማ ምዝገባ';
            submitBtn.innerHTML = '<i class="fas fa-save"></i> ፊርማ መዝግብ';
        }
    } catch (err) {
        // authFetch already handles the unauthorized/redirect case
    }
}

// ===== Signature/stamp background cleanup =====
// Photos of a signature or company stamp almost never have a clean white
// background (paper tone, shadows, scanner grey), which is what made the
// placed signature show up as a visible box on receipts instead of blending
// in. This runs entirely in the browser before upload: any pixel close to
// the paper/background tone is pushed to pure white (with a short blended
// ramp so stroke edges stay smooth instead of jagged), and the image is then
// cropped tightly to just the ink itself so it's placed accurately in its
// slot instead of floating inside a large blank photo.
function cleanSignatureBackground(file) {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const data = imageData.data;

                const BG_HIGH = 232; // channel value at/above this = pure background -> forced white
                const BG_LOW = 165;  // channel value at/below this = solid ink -> left untouched
                let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;

                for (let y = 0; y < canvas.height; y++) {
                    for (let x = 0; x < canvas.width; x++) {
                        const i = (y * canvas.width + x) * 4;
                        const r = data[i], g = data[i + 1], b = data[i + 2];
                        const minCh = Math.min(r, g, b);

                        if (minCh >= BG_HIGH) {
                            data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
                        } else {
                            if (x < minX) minX = x;
                            if (x > maxX) maxX = x;
                            if (y < minY) minY = y;
                            if (y > maxY) maxY = y;
                            if (minCh > BG_LOW) {
                                const t = (minCh - BG_LOW) / (BG_HIGH - BG_LOW);
                                data[i] = Math.round(r + (255 - r) * t);
                                data[i + 1] = Math.round(g + (255 - g) * t);
                                data[i + 2] = Math.round(b + (255 - b) * t);
                            }
                        }
                        data[i + 3] = 255;
                    }
                }
                ctx.putImageData(imageData, 0, 0);

                if (maxX < 0) {
                    // Nothing dark enough was found (blank/washed-out photo) —
                    // upload as cleaned rather than guessing at a crop.
                    canvas.toBlob((blob) => resolve(blob ? signatureBlobToFile(blob, file.name) : file), 'image/png');
                    return;
                }

                const margin = Math.round(Math.max(maxX - minX, maxY - minY) * 0.06) + 4;
                const cropX = Math.max(0, minX - margin);
                const cropY = Math.max(0, minY - margin);
                const cropW = Math.min(canvas.width, maxX + margin) - cropX;
                const cropH = Math.min(canvas.height, maxY + margin) - cropY;

                const cropCanvas = document.createElement('canvas');
                cropCanvas.width = cropW;
                cropCanvas.height = cropH;
                cropCanvas.getContext('2d').drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

                cropCanvas.toBlob((blob) => resolve(blob ? signatureBlobToFile(blob, file.name) : file), 'image/png');
            } catch (err) {
                // Canvas failed for any reason — fall back to the original file
                // untouched rather than blocking registration.
                resolve(file);
            }
        };
        img.onerror = () => resolve(file);
        img.src = url;
    });
}
function signatureBlobToFile(blob, originalName) {
    const base = (originalName || 'signature').replace(/\.[^/.]+$/, '');
    return new File([blob], base + '-cleaned.png', { type: 'image/png' });
}

// Holds the already-cleaned file so submit doesn't need to reprocess it.
let pendingCleanedSignatureFile = null;

async function handleSignatureFileSelected(e) {
    let file = e.target.files[0];
    let note = document.getElementById('sig-processing-note');
    let previewWrap = document.getElementById('sig-preview-wrap');
    let previewImg = document.getElementById('sig-preview-image');
    pendingCleanedSignatureFile = null;

    if (!file) {
        if (previewWrap) previewWrap.style.display = 'none';
        return;
    }

    if (note) note.style.display = 'block';
    if (previewWrap) previewWrap.style.display = 'none';

    let cleaned = await cleanSignatureBackground(file);
    pendingCleanedSignatureFile = cleaned;

    if (note) note.style.display = 'none';
    if (previewImg && previewWrap) {
        previewImg.src = URL.createObjectURL(cleaned);
        previewWrap.style.display = 'block';
    }
}

async function submitSignatureRegister(e) {
    e.preventDefault();
    let formData = new FormData();
    formData.append('fullName', document.getElementById('sig-fullname').value.trim());
    formData.append('responsibility', document.getElementById('sig-responsibility').value.trim());
    formData.append('signaturePassword', document.getElementById('sig-new-password').value);
    formData.append('currentSignaturePassword', document.getElementById('sig-current-password').value);

    let fileInput = document.getElementById('sig-image-file');
    if (fileInput.files[0]) {
        // Use the already-cleaned (white-background, tightly-cropped) version;
        // if it somehow wasn't ready yet, clean it now rather than upload raw.
        let toUpload = pendingCleanedSignatureFile || await cleanSignatureBackground(fileInput.files[0]);
        formData.append('signatureImage', toUpload);
    }

    try {
        let res = await authFetch('/api/signature/register', { method: 'POST', body: formData });
        let data = await res.json();
        if (res.ok) {
            alert(data.message || "ፊርማ ተመዝግቧል!");
            document.getElementById('sig-new-password').value = '';
            document.getElementById('sig-current-password').value = '';
            fileInput.value = '';
            pendingCleanedSignatureFile = null;
            let previewWrap = document.getElementById('sig-preview-wrap');
            if (previewWrap) previewWrap.style.display = 'none';
            loadMySignatureStatus();
        } else {
            alert(data.error || "ፊርማ መመዝገብ አልተቻለም");
        }
    } catch (err) {
        // authFetch already handles the unauthorized/redirect case
    }
}

function printSingleReceipt(id) {
    if (!id) return;
    previewReceipt(id);

    document.body.classList.add('receipt-print-mode');

    let cleanup = () => {
        document.body.classList.remove('receipt-print-mode');
        window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);

    // Give the modal a moment to render before opening the print dialog
    setTimeout(() => window.print(), 150);
}

// Records still "urgent" right now (due within 7 days, due today, or already
// overdue by any number of days) that the user hasn't explicitly dismissed.
let dismissedNotifIds = new Set();
// Records already toasted+beeped in the current reminder cycle, so unrelated
// actions (adding/deleting an unrelated record) don't re-fire every alert —
// only the periodic re-check below intentionally re-nags about open items.
let notifiedRecordIds = new Set();

// Approval-workflow notifications from the server (records sent to me to
// approve, and updates on records I sent that have since been approved) —
// shown in the same bell dropdown as the due-date reminders, above them,
// since they're something a specific person needs to act on.
let approvalNotifications = [];
async function fetchApprovalNotifications() {
    try {
        let res = await authFetch('/api/notifications');
        approvalNotifications = await res.json();
        checkAndTriggerNotifications();
    } catch (err) {
        // authFetch already handles the unauthorized/redirect case
    }
}
async function markApprovalNotificationRead(notifId, event) {
    if (event) event.stopPropagation();
    try {
        await authFetch(`/api/notifications/${notifId}/read`, { method: 'PUT' });
    } catch (err) { /* best-effort */ }
    approvalNotifications = approvalNotifications.map(n => n._id === notifId ? { ...n, read: true } : n);
    checkAndTriggerNotifications();
}
function handleApprovalNotificationClick(notifId, recordId) {
    markApprovalNotificationRead(notifId);
    let notifDropdown = document.getElementById('notif-dropdown');
    if (notifDropdown) notifDropdown.classList.remove('show');
    previewReceipt(recordId);
}

function checkAndTriggerNotifications() {
    let today = new Date();
    today.setHours(0,0,0,0);

    let urgentRecords = [];

    records.forEach(item => {
        let due = new Date(item.dueDate);
        due.setHours(0,0,0,0);
        let diffDays = Math.ceil((due - today) / (1000 * 60 * 60 * 24));

        // Anything due within 7 days, due today, or already overdue (by any
        // number of days) counts — overdue items used to be silently excluded.
        if (diffDays <= 7 && !dismissedNotifIds.has(item._id)) {
            urgentRecords.push({ id: item._id, name: item.name, days: diffDays });
        }
    });

    let unreadApprovals = approvalNotifications.filter(n => !n.read);
    let badge = document.getElementById('notif-badge');
    let notifList = document.getElementById('notif-list');

    if (badge && notifList) {
        let totalCount = urgentRecords.length + unreadApprovals.length;
        if (totalCount > 0) {
            badge.style.display = 'inline-block';
            badge.innerText = totalCount;

            notifList.innerHTML = '';

            unreadApprovals.forEach(n => {
                let icon = n.type === 'approved' ? '✅' : '✍️';
                notifList.innerHTML += `
                    <div class="notif-item" onclick="handleApprovalNotificationClick('${n._id}', '${n.recordId}')" style="cursor: pointer; padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); position: relative;">
                        <span onclick="markApprovalNotificationRead('${n._id}', event)" title="እንደተነበበ ምልክት አድርግ" style="position: absolute; top: 6px; right: 6px; cursor: pointer; color: #a0aec0; font-weight: bold; padding: 2px 6px;">&times;</span>
                        <div style="padding-right: 20px;">
                            ${icon} <span style="font-size: 12px;">${n.message}</span>
                        </div>
                    </div>
                `;
            });

            urgentRecords.forEach(rec => {
                let isOverdue = rec.days < 0;
                let statusLine = isOverdue
                    ? `<span style="color:#fc8181; font-size: 11px;">🔴 ጊዜው አልፎበታል (<strong>${Math.abs(rec.days)} ቀን</strong> አልፏል)! ወዲያውኑ ያድሱ</span>`
                    : rec.days === 0
                        ? `<span style="color:#f6ad55; font-size: 11px;">🟠 ዛሬ ነው የሚደርሰው! ክፍያ ለመፈጸም ይጫኑ</span>`
                        : `<span style="color: #d69e2e; font-size: 11px;">🟡 የሚያበቃበት ጊዜ <strong>${rec.days} ቀን</strong> ብቻ የቀረው! (ክፍያ ለመፈጸም ይጫኑ)</span>`;

                notifList.innerHTML += `
                    <div class="notif-item" onclick="handleNotificationClick('${rec.id}')" style="cursor: pointer; padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); position: relative;">
                        <span onclick="dismissNotif('${rec.id}', event)" title="አሰናብት" style="position: absolute; top: 6px; right: 6px; cursor: pointer; color: #a0aec0; font-weight: bold; padding: 2px 6px;">&times;</span>
                        <div style="padding-right: 20px;">
                            ⚠️ <strong>${rec.name}</strong><br>
                            ${statusLine}
                        </div>
                    </div>
                `;
            });
        } else {
            badge.style.display = 'none';
            notifList.innerHTML = `<div style="padding: 15px; text-align: center; color: #a0aec0; font-size: 13px;">ምንም አዲስ ማሳሰቢያ የለም</div>`;
        }
    }

    // Toast + sound only for items not already alerted this cycle, so routine
    // actions elsewhere in the app don't repeatedly interrupt the user.
    let newOnes = urgentRecords.filter(r => !notifiedRecordIds.has(r.id));
    if (newOnes.length > 0) {
        playReminderSound();
        newOnes.forEach(rec => {
            let isOverdue = rec.days < 0;
            let msg = isOverdue
                ? `🔴 ማሳሰቢያ: ${rec.name} (${Math.abs(rec.days)} ቀን አልፎበታል!)`
                : rec.days === 0
                    ? `🟠 ማሳሰቢያ: ${rec.name} (ዛሬ ነው የሚደርሰው!)`
                    : `⚠️ ማሳሰቢያ: ${rec.name} (${rec.days} ቀን ቀርቶታል)`;
            showToast(msg);
            notifiedRecordIds.add(rec.id);
        });
    }

    // Same treatment for approval notifications — toast once per notification.
    let newApprovals = unreadApprovals.filter(n => !notifiedRecordIds.has('notif-' + n._id));
    if (newApprovals.length > 0) {
        playReminderSound();
        newApprovals.forEach(n => {
            showToast((n.type === 'approved' ? '✅ ' : '✍️ ') + n.message);
            notifiedRecordIds.add('notif-' + n._id);
        });
    }
}

// Dismisses a single reminder (the "×" on a notification item). This only
// silences it for the rest of this browser session — it still shows up in
// the dashboard counts/status, and comes back if the page is reloaded.
function dismissNotif(recordId, event) {
    if (event) event.stopPropagation();
    dismissedNotifIds.add(recordId);
    notifiedRecordIds.add(recordId);
    checkAndTriggerNotifications();
}// A short two-beep alert tone (generated in-browser, no audio file needed)
// so a due/overdue reminder is actually heard, not just seen.
function playReminderSound() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const beep = (startTime) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.0001, startTime);
            gain.gain.exponentialRampToValueAtTime(0.25, startTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.28);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(startTime);
            osc.stop(startTime + 0.3);
        };
        const now = ctx.currentTime;
        beep(now);
        beep(now + 0.35);
    } catch (err) {
        // Some browsers block audio until the user has clicked/interacted with
        // the page at least once — the visual toast/badge still work regardless.
    }
}

function handleNotificationClick(recordId) {
    let notifDropdown = document.getElementById('notif-dropdown');
    if (notifDropdown) notifDropdown.classList.remove('show');
    // Take the user straight to renewing the record, not just to its section —
    // that's almost always what clicking an overdue/due-soon reminder is for.
    renewRecord(recordId);
}

function showToast(message) {
    let container = document.getElementById('toast-container');
    if (!container) return;
    let toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.innerHTML = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 5000);
}

function toggleNotificationMenu() {
    let notifDropdown = document.getElementById('notif-dropdown');
    let profileMenu = document.getElementById('profileMenu');
    if (profileMenu) profileMenu.classList.remove('show-profile-menu');
    if (notifDropdown) notifDropdown.classList.toggle('show');
}

function setupDocumentModalZoom() {
    let modalImageContainer = document.getElementById('image-modal');
    if (!modalImageContainer) return;

    let imgContainer = modalImageContainer.querySelector('.img-container');
    if (imgContainer && !document.getElementById('zoomControlsContainer')) {
        let zoomControls = document.createElement('div');
        zoomControls.id = 'zoomControlsContainer';
        zoomControls.className = 'zoom-toolbar no-print';
        zoomControls.innerHTML = `
            <button type="button" onclick="zoomOutDoc()" title="አሳንስ">➖</button>
            <button type="button" onclick="resetZoomDoc()" title="መደበኛ">🔄</button>
            <button type="button" onclick="zoomInDoc()" title="አክብር">➕</button>
        `;
        // Appended (not inserted before the image) so it floats over a corner
        // instead of pushing the image down and covering content while scrolling.
        imgContainer.appendChild(zoomControls);
    }
}

function zoomInDoc() {
    currentZoomLevel += 0.25;
    applyZoom();
}

function zoomOutDoc() {
    if (currentZoomLevel > 0.5) {
        currentZoomLevel -= 0.25;
        applyZoom();
    }
}

function resetZoomDoc() {
    currentZoomLevel = 1;
    applyZoom();
}

function applyZoom() {
    const modalImage = document.getElementById('modal-img');
    if (modalImage) {
        modalImage.style.transform = `scale(${currentZoomLevel})`;
        modalImage.style.transition = 'transform 0.2s ease';
        modalImage.style.transformOrigin = 'center center'; // Updated to center for better zooming experience
    }
}

function openProfileModal() {
    document.getElementById('prof-fullname').innerText = currentUser.fullName || '-';
    document.getElementById('prof-email').innerText = currentUser.email || '-';
    document.getElementById('prof-username').innerText = currentUser.username;
    document.getElementById('prof-role').innerText = currentUser.role;
    document.getElementById('profile-modal').style.display = 'flex';
}
function closeProfileModal() { document.getElementById('profile-modal').style.display = 'none'; }

async function changePassword(e) {
    e.preventDefault();
    let currentPassword = document.getElementById('curr-pass').value;
    let newPassword = document.getElementById('new-pass').value;
    try {
        let res = await authFetch('/api/users/change-password', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.id, currentPassword, newPassword })
        });
        let data = await res.json();
        if (res.ok) { alert("የይለፍ ቃልዎ ተቀይሯል!"); closeProfileModal(); }
        else { alert(data.error); }
    } catch (err) {}
}

function backupData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(records));
    let dl = document.createElement('a');
    dl.setAttribute("href", dataStr);
    dl.setAttribute("download", `backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(dl); dl.click(); dl.remove();
}

// Restoring a backup now actually writes the records back into the
// database (via /api/records/restore) instead of only updating the
// in-memory `records` array — that in-memory-only approach is exactly why
// a restored backup used to vanish again on the next page refresh.
async function restoreData(event) {
    let file = event.target.files[0];
    if (!file) { return; }

    let reader = new FileReader();
    reader.onload = async function(e) {
        try {
            let parsed = JSON.parse(e.target.result);
            if (!Array.isArray(parsed)) {
                alert("ይህ የ Backup ፋይል ትክክለኛ አይደለም።");
                return;
            }
            if (!confirm(`ይህ አሁን ያለውን ውሂብ ሁሉ በዚህ Backup ፋይል ውስጥ ባሉት ${parsed.length} መዝገቦች ይተካዋል። ይህ የማይቀለበስ ነው። እርግጠኛ ነዎት?`)) {
                event.target.value = '';
                return;
            }

            let res = await authFetch('/api/records/restore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ records: parsed })
            });
            let data = await res.json();

            if (res.ok) {
                await fetchRecords(); // reload from the database, not just from memory
                alert(`መረጃዎቹ በትክክል ወደ ዳታቤዝ ተመልሰዋል! (${data.count} መዝገቦች) — ገጹን ሪፍሬሽ ቢያደርጉም አይጠፉም።`);
            } else {
                alert(data.error || "Restore ማድረግ አልተቻለም");
            }
        } catch (err) {
            alert("የ Backup ፋይሉ ማንበብ አልተቻለም ወይም ስህተት አጋጥሟል።");
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsText(file);
}

// Both exports below work off the same clean row shape (name/amount/dates +
// who prepared/approved it) instead of dumping the raw database document —
// that's what used to spill internal fields like _id, __v, isDeleted into
// the spreadsheet with no useful structure.
function buildExportRows(cat) {
    return records
        .filter(r => r.category === cat)
        .map((r, idx) => ({
            no: idx + 1,
            name: r.name || '',
            amount: Number(r.amount || 0),
            paymentDate: r.paymentDate || '',
            startDate: r.startDate || '',
            dueDate: r.dueDate || '',
            preparedBy: (r.preparedBy && r.preparedBy.fullName) || '',
            approvedBy: (r.approvedBy && r.approvedBy.fullName) || ''
        }));
}

function exportToExcel(cat) {
    let rows = buildExportRows(cat);
    let sheetTitle = cat === 'ክፍያ' ? 'ክፍያዎች' : 'ውሎች';

    let exportData = rows.map(r => ({
        'ተ.ቁ': r.no,
        'መግለጫ': r.name,
        'መጠን (ብር)': r.amount,
        'ክፍያ/ውል የተፈጸመበት ቀን': r.paymentDate,
        'መጀመሪያ ቀን': r.startDate,
        'የማብቂያ/ቀጣይ ቀን': r.dueDate,
        'ያዘጋጀው': r.preparedBy,
        'ያጸደቀው': r.approvedBy
    }));

    let ws = XLSX.utils.json_to_sheet(exportData);
    ws['!cols'] = [{ wch: 6 }, { wch: 36 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 16 }, { wch: 20 }, { wch: 20 }];

    let wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetTitle);
    XLSX.writeFile(wb, `${sheetTitle}_ሪፖርት_${new Date().toISOString().split('T')[0]}.xlsx`);
}

// Renders a clean, light-themed, printable table off-screen (instead of
// screenshotting the actual dark app UI, which is why the old PDF looked
// like a messy raw screenshot) and turns THAT into the PDF. Built as real
// DOM/text — not html2canvas of the live page — so Amharic still renders
// correctly (the browser's own font handles the Ethiopic script), but the
// output looks like an actual formatted report.
function exportToPDF(cat) {
    let rows = buildExportRows(cat);
    let title = cat === 'ክፍያ' ? 'የክፍያ ሪፖርት' : 'የውል ሪፖርት';
    let total = rows.reduce((sum, r) => sum + r.amount, 0);

    let wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed; left:-9999px; top:0; width:900px; background:#ffffff; color:#1a202c; padding:28px; font-family: "Segoe UI", Arial, sans-serif;';

    let bodyRows = rows.map(r => `
        <tr>
            <td style="border:1px solid #cbd5e0; padding:7px; text-align:center;">${r.no}</td>
            <td style="border:1px solid #cbd5e0; padding:7px;">${r.name}</td>
            <td style="border:1px solid #cbd5e0; padding:7px; text-align:right;">${r.amount.toLocaleString('en-US')}</td>
            <td style="border:1px solid #cbd5e0; padding:7px; text-align:center;">${r.paymentDate}</td>
            <td style="border:1px solid #cbd5e0; padding:7px; text-align:center;">${r.startDate}</td>
            <td style="border:1px solid #cbd5e0; padding:7px; text-align:center;">${r.dueDate}</td>
        </tr>`).join('');

    wrap.innerHTML = `
        <div style="text-align:center; margin-bottom:18px; border-bottom:2px solid #2b6cb0; padding-bottom:12px;">
            <h2 style="margin:0; color:#1a365d;">Fountain International Trading PLC</h2>
            <p style="margin:4px 0 0; color:#4a5568;">${title}</p>
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:13px;">
            <thead>
                <tr style="background:#2b6cb0; color:#ffffff;">
                    <th style="border:1px solid #cbd5e0; padding:7px;">ተ.ቁ</th>
                    <th style="border:1px solid #cbd5e0; padding:7px;">መግለጫ</th>
                    <th style="border:1px solid #cbd5e0; padding:7px;">መጠን (ብር)</th>
                    <th style="border:1px solid #cbd5e0; padding:7px;">ክፍያ/ውል ቀን</th>
                    <th style="border:1px solid #cbd5e0; padding:7px;">መጀመሪያ ቀን</th>
                    <th style="border:1px solid #cbd5e0; padding:7px;">የማብቂያ ቀን</th>
                </tr>
            </thead>
            <tbody>${bodyRows || '<tr><td colspan="6" style="text-align:center; padding:16px; color:#718096;">ምንም መረጃ አልተገኘም</td></tr>'}</tbody>
        </table>
        <p style="text-align:right; margin-top:16px; font-weight:bold; font-size:15px; color:#1a365d;">አጠቃላይ ድምር: ${total.toLocaleString('en-US')} ብር</p>
        <p style="text-align:right; margin-top:4px; font-size:11px; color:#a0aec0;">ተዘጋጅቷል፡ ${new Date().toLocaleDateString('en-GB')}</p>
    `;
    document.body.appendChild(wrap);

    html2canvas(wrap, { scale: 2, backgroundColor: '#ffffff' }).then(canvas => {
        document.body.removeChild(wrap);
        const { jsPDF } = window.jspdf;
        let pdf = new jsPDF('p', 'mm', 'a4');
        let pageWidth = pdf.internal.pageSize.getWidth();
        let imgHeight = (canvas.height * pageWidth) / canvas.width;
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pageWidth, imgHeight);
        pdf.save(`${title}_${new Date().toISOString().split('T')[0]}.pdf`);
    }).catch(() => {
        if (wrap.parentNode) document.body.removeChild(wrap);
        alert('PDF ማዘጋጀት አልተቻለም');
    });
}

function previewImage(url) {
    currentZoomLevel = 1;
    applyZoom();
    document.getElementById('modal-img').src = url;
    document.getElementById('image-modal').style.display = 'flex';
}
function closeModal() { document.getElementById('image-modal').style.display = 'none'; }
function toggleProfileMenu() { 
    let menu = document.getElementById("profileMenu");
    let notifDropdown = document.getElementById('notif-dropdown');
    if (notifDropdown) notifDropdown.classList.remove('show');
    if (menu) menu.classList.toggle("show-profile-menu"); // Fixed class name toggle
}

// Close dropdowns when clicking outside
window.onclick = function(event) {
    if (!event.target.closest('.user-profile-dropdown') && !event.target.closest('.profile-btn')) {
        let profileMenu = document.getElementById("profileMenu");
        if (profileMenu) profileMenu.classList.remove("show-profile-menu");
    }
    if (!event.target.closest('.notification-wrapper')) {
        let notifDropdown = document.getElementById("notif-dropdown");
        if (notifDropdown) notifDropdown.classList.remove("show");
    }
}