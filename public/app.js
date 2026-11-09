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

        let fleetTrashBtnWrap = document.getElementById('fleet-vehicle-trash-btn-wrap');
        if (fleetTrashBtnWrap) fleetTrashBtnWrap.style.display = 'block';
        let fuelPriceBox = document.getElementById('fleet-fuel-price-box');
        if (fuelPriceBox) fuelPriceBox.style.display = 'block';
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
        usersCache = Array.isArray(users) ? users : [];

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
                        <td>${fleetEsc(u.fullName || '-')}</td>
                        <td>${fleetEsc(u.email || '-')}</td>
                        <td><strong>${fleetEsc(u.username)}</strong></td>
                        <td>${u.role}</td>
                        <td class="no-print">${permsHtml}</td>
                        <td class="no-print">${accessCellHtml(u)}</td>
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
    const access = Array.from(document.querySelectorAll('.reg-access-cb:checked')).map(cb => cb.value);

    let submitBtn = document.querySelector('#user-register-form button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
        const res = await authFetch('/api/users/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fullName, email, username, password, role, permissions, access,
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
    if (!canOpenSection(sectionId)) {
        alert('ይህን ክፍል ለማየት ፈቃድ የለዎትም');
        return;
    }
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
    if (sectionId === 'fleet-vehicles-sec') { fetchVehicles(); resetVehicleForm(); }
    if (sectionId === 'fleet-trips-sec') { fetchVehicles(); fetchTripLogs(); loadFleetDepartments(); loadFuelPriceSettings(); }
    if (sectionId === 'fleet-maintenance-sec') { fetchVehicles(); fetchMaintenanceList(); }
    if (sectionId === 'fleet-fuel-sec') { fetchVehicles(); fetchFuelLogs(); loadFuelPriceSettings(); }
    if (sectionId === 'fleet-report-sec') initFleetReportSection();
    if (sectionId === 'fleet-finance-sec') initFleetFinanceSection();
    if (sectionId === 'fleet-allowance-sec') initAllowanceSection();
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
        } else {
            let errData = {};
            try { errData = await res.json(); } catch (parseErr) {}
            alert(errData.error || "መመዝገብ አልተቻለም!");
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
    if (formTitle) formTitle.innerHTML = `<i class="fas fa-redo"></i> ማደሻ፦ ${fleetEsc(record.name)}`;

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
                <td><strong>[${fleetEsc(item.category)}]</strong> ${fleetEsc(item.name)}</td>
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
                ${incCat ? `<td><strong>[${fleetEsc(item.category)}]</strong> ${fleetEsc(item.name)}</td>` : `<td>${fleetEsc(item.name)}</td>`}
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
                        <td>${fleetEsc(item.name)}</td>
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
                gallery.innerHTML += `<div style="border:1px solid rgba(255,255,255,0.1); padding:10px; border-radius:8px; width:180px; text-align:center; background:rgba(255,255,255,0.05);"><img src="${item.file}" style="width:100%; height:140px; object-fit:cover; cursor:pointer;" onclick="previewImage('${item.file}')"><p style="font-size:12px; margin-top:5px; color:#fff;">${fleetEsc(item.name)}</p></div>`;
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
            <strong>${fleetEsc(signed.fullName)}</strong><br>
            <span>${fleetEsc(signed.responsibility)}</span><br>
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
async function promptAndSign(recordId, slot, kind = 'record') {
    pendingSignContext = { recordId, slot, kind };
    let input = document.getElementById('sign-password-input');
    if (input) input.value = '';
    let errorBox = document.getElementById('sign-password-error');
    if (errorBox) { errorBox.style.display = 'none'; errorBox.innerHTML = ''; }

    let approverGroup = document.getElementById('sign-approver-group');
    let approverSelect = document.getElementById('sign-approver-select');
    const approverLabel = document.getElementById('sign-approver-label');
    if (approverLabel) {
        const nextSlotName = kind === 'allowance' ? ALLOWANCE_SLOT_NAMES[ALLOWANCE_SLOTS[ALLOWANCE_SLOTS.indexOf(slot) + 1]] : '';
        approverLabel.textContent = nextSlotName ? `ቀጣይ የሚፈርመው (${nextSlotName}) ማን ይሁን፡` : 'ለማጽደቅ ለማን ይላክ፡';
    }
    if (signNeedsNext(kind, slot)) {
        approverGroup.style.display = 'block';
        approverSelect.required = true;
        approverSelect.innerHTML = '<option value="">-- በመጫን ላይ... --</option>';
        try {
            let res = await authFetch('/api/approvers');
            let approvers = await res.json();
            approverSelect.innerHTML = approvers.length
                ? approvers.map(a => `<option value="${a.id}">${fleetEsc(a.fullName)} (${fleetEsc(a.responsibility)})</option>`).join('')
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
    let { recordId, slot, kind } = pendingSignContext;
    let errorBox = document.getElementById('sign-password-error');
    let submitBtn = document.getElementById('sign-password-submit-btn');
    if (errorBox) { errorBox.style.display = 'none'; errorBox.innerHTML = ''; }

    let body = { slot, signaturePassword };
    if (signNeedsNext(kind, slot)) {
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
        let endpoint = kind === 'allowance' ? `/api/fleet/allowance/${recordId}/sign`
            : (kind === 'maintenance' ? `/api/fleet/maintenance/${recordId}/sign` : `/api/records/${recordId}/sign`);
        let res = await authFetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        let data = await res.json();
        if (res.ok) {
            closeSignPasswordModal();
            if (kind === 'allowance') {
                let idx = fleetAllowances.findIndex(r => r._id === recordId);
                if (idx !== -1) fleetAllowances[idx] = data;
                renderAllowanceList();
                invalidateFleetReports();
                fetchApprovalNotifications();
            } else if (kind === 'maintenance') {
                let idx = fleetMaintenance.findIndex(r => r._id === recordId);
                if (idx !== -1) fleetMaintenance[idx] = data;
                renderMaintenanceList();
                fetchApprovalNotifications();
            } else {
                // Update the local copy so the receipt reflects it immediately,
                // and refresh from the server so the record list stays in sync.
                let idx = records.findIndex(r => r._id === recordId);
                if (idx !== -1) records[idx] = data;
                renderReceiptSignatures(data);
                fetchRecords();
                fetchApprovalNotifications();
            }
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
function handleApprovalNotificationClick(notifId, recordId, module) {
    markApprovalNotificationRead(notifId);
    let notifDropdown = document.getElementById('notif-dropdown');
    if (notifDropdown) notifDropdown.classList.remove('show');
    if (module === 'fleet_allowance') {
        showSection('fleet-allowance-sec', 'menu-fleet-allowance');
        fetchAllowances();
    } else if (module === 'fleet_maintenance') {
        showSection('fleet-maintenance-sec', 'menu-fleet-maintenance');
        fetchMaintenanceList();
    } else {
        previewReceipt(recordId);
    }
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
                    <div class="notif-item" onclick="handleApprovalNotificationClick('${n._id}', '${n.recordId}', '${n.module || 'record'}')" style="cursor: pointer; padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); position: relative;">
                        <span onclick="markApprovalNotificationRead('${n._id}', event)" title="እንደተነበበ ምልክት አድርግ" style="position: absolute; top: 6px; right: 6px; cursor: pointer; color: #a0aec0; font-weight: bold; padding: 2px 6px;">&times;</span>
                        <div style="padding-right: 20px;">
                            ${icon} <span style="font-size: 12px;">${fleetEsc(n.message)}</span>
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
                            ⚠️ <strong>${fleetEsc(rec.name)}</strong><br>
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
    toast.textContent = message;
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
            <td style="border:1px solid #cbd5e0; padding:7px;">${fleetEsc(r.name)}</td>
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

// ==========================================
// FLEET MANAGEMENT (ፍሊት ማኔጅመንት)
// ==========================================
let fleetVehicles = [];
let fleetTrips = [];
let fleetDepartments = [];
let fleetSettings = { dieselPricePerLiter: 0, benzinePricePerLiter: 0 };
let editingVehicleId = null;

// ---------- Vehicles ----------
async function fetchVehicles() {
    try {
        const res = await authFetch('/api/fleet/vehicles');
        fleetVehicles = await res.json();
        renderVehicleList();
        populateTripVehicleSelect();
        populateMaintenanceVehicleSelects();
    } catch (err) {
        console.log('ተሽከርካሪዎችን ማምጣት አልተቻለም');
    }
}

// A document is 🔴 overdue, 🟡 due within 10 days, or 🟢 fine — same
// thresholds as the payment/contract reminder logic elsewhere in this app.
// Returns the worst status across all 4 documents plus which one caused it.
function getVehicleDocStatus(vehicle) {
    const labels = { libre: 'ሊብሬ', bolo: 'ቦሎ', insurance: 'መድን', competency: 'ብቃት ማረጋገጫ' };
    const today = new Date(); today.setHours(0,0,0,0);
    let worst = { level: 2, text: '🟢 ሁሉም ሰነዶች ዝማኔ ናቸው' }; // 0=red,1=yellow,2=green
    const docs = vehicle.documents || {};
    Object.keys(labels).forEach(key => {
        const d = docs[key];
        if (!d || !d.expiryDate) return;
        const expiry = new Date(d.expiryDate); expiry.setHours(0,0,0,0);
        const diffDays = Math.ceil((expiry - today) / (1000*60*60*24));
        let level, text;
        if (diffDays < 0) { level = 0; text = `🔴 ${labels[key]} ካለፈ ${Math.abs(diffDays)} ቀን`; }
        else if (diffDays <= 10) { level = 1; text = `🟡 ${labels[key]} ${diffDays} ቀን ቀርቶታል`; }
        else { level = 2; text = ''; }
        if (level < worst.level) worst = { level, text };
    });
    return worst;
}

function renderVehicleList() {
    const tbody = document.getElementById('veh-data-list');
    if (!tbody) return;
    if (!fleetVehicles.length) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#a0aec0;">ምንም ተሽከርካሪ አልተመዘገበም</td></tr>`;
        return;
    }
    const statusLabels = { active: '🟢 አገልግሎት ላይ', maintenance: '🟡 ጥገና ላይ', out_of_service: '🔴 ከአገልግሎት ውጪ' };
    tbody.innerHTML = fleetVehicles.map(v => {
        const docStatus = getVehicleDocStatus(v);
        return `
            <tr>
                <td>${fleetEsc(v.plateNumber)}</td>
                <td>${fleetEsc(v.vehicleType)}${v.model ? ' / ' + fleetEsc(v.model) : ''}</td>
                <td>${fleetEsc(v.driverName || '-')}</td>
                <td>${(v.currentKm || 0).toLocaleString('en-US')}</td>
                <td>${statusLabels[v.status] || v.status}</td>
                <td>${docStatus.text || '🟢 ችግር የለም'}</td>
                <td class="no-print">
                    <button onclick="editVehicle('${v._id}')" class="btn-submit" style="padding:4px 8px; font-size:12px;" title="አርም"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteVehicle('${v._id}')" class="btn-logout" style="padding:4px 8px; font-size:12px;" title="ሰርዝ"><i class="fas fa-trash"></i></button>
                </td>
            </tr>`;
    }).join('');
}

function resetVehicleForm() {
    editingVehicleId = null;
    document.getElementById('vehicle-form').reset();
    document.getElementById('veh-edit-id').value = '';
    document.getElementById('veh-form-title').innerHTML = '<i class="fas fa-plus-circle"></i> አዲስ ተሽከርካሪ መዝግብ';
    document.getElementById('veh-btn-submit').innerHTML = '<i class="fas fa-save"></i> ተሽከርካሪ መዝግብ';
    document.getElementById('veh-btn-cancel').style.display = 'none';
}

function editVehicle(id) {
    const v = fleetVehicles.find(x => x._id === id);
    if (!v) return;
    editingVehicleId = id;
    document.getElementById('veh-edit-id').value = id;
    document.getElementById('veh-plate').value = v.plateNumber || '';
    document.getElementById('veh-type').value = v.vehicleType || '';
    document.getElementById('veh-model').value = v.model || '';
    document.getElementById('veh-chassis').value = v.chassisNumber || '';
    document.getElementById('veh-driver').value = v.driverName || '';
    setAmountValue('veh-current-km', v.currentKm || 0);
    document.getElementById('veh-status').value = v.status || 'active';
    document.getElementById('veh-fuel-type').value = v.fuelType || 'ናፍጣ';
    setAmountValue('veh-km-per-liter', v.kmPerLiter || '');
    const docs = v.documents || {};
    document.getElementById('veh-doc-libre-expiry').value = (docs.libre && docs.libre.expiryDate) || '';
    document.getElementById('veh-doc-bolo-expiry').value = (docs.bolo && docs.bolo.expiryDate) || '';
    document.getElementById('veh-doc-insurance-expiry').value = (docs.insurance && docs.insurance.expiryDate) || '';
    document.getElementById('veh-doc-competency-expiry').value = (docs.competency && docs.competency.expiryDate) || '';

    document.getElementById('veh-form-title').innerHTML = '<i class="fas fa-edit"></i> ተሽከርካሪ አርም';
    document.getElementById('veh-btn-submit').innerHTML = '<i class="fas fa-save"></i> ለውጥ አስቀምጥ';
    document.getElementById('veh-btn-cancel').style.display = 'inline-flex';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function handleVehicleSubmit(e) {
    e.preventDefault();
    const fd = new FormData();
    fd.append('plateNumber', document.getElementById('veh-plate').value.trim());
    fd.append('vehicleType', document.getElementById('veh-type').value.trim());
    fd.append('model', document.getElementById('veh-model').value.trim());
    fd.append('chassisNumber', document.getElementById('veh-chassis').value.trim());
    fd.append('driverName', document.getElementById('veh-driver').value.trim());
    fd.append('currentKm', getAmountValue('veh-current-km') || 0);
    fd.append('status', document.getElementById('veh-status').value);
    fd.append('fuelType', document.getElementById('veh-fuel-type').value);
    fd.append('kmPerLiter', getAmountValue('veh-km-per-liter') || 0);
    fd.append('documents', JSON.stringify({
        libre: { expiryDate: document.getElementById('veh-doc-libre-expiry').value },
        bolo: { expiryDate: document.getElementById('veh-doc-bolo-expiry').value },
        insurance: { expiryDate: document.getElementById('veh-doc-insurance-expiry').value },
        competency: { expiryDate: document.getElementById('veh-doc-competency-expiry').value }
    }));
    const photoFile = document.getElementById('veh-photo').files[0];
    if (photoFile) fd.append('photo', photoFile);

    try {
        const url = editingVehicleId ? `/api/fleet/vehicles/${editingVehicleId}` : '/api/fleet/vehicles';
        const method = editingVehicleId ? 'PUT' : 'POST';
        const res = await authFetch(url, { method, body: fd });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'ስህተት ተፈጥሯል'); return; }
        resetVehicleForm();
        fetchVehicles();
    } catch (err) {
        alert('መመዝገብ አልተቻለም');
    }
}

async function deleteVehicle(id) {
    if (!confirm('ይህን ተሽከርካሪ ወደ ትራሽ መላክ ይፈልጋሉ?')) return;
    try {
        await authFetch(`/api/fleet/vehicles/${id}`, { method: 'DELETE' });
        fetchVehicles();
    } catch (err) {
        alert('ማጥፋት አልተቻለም');
    }
}

let vehicleTrashOpen = false;
async function toggleVehicleTrash() {
    const box = document.getElementById('fleet-vehicle-trash-list');
    vehicleTrashOpen = !vehicleTrashOpen;
    if (!vehicleTrashOpen) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    box.innerHTML = 'በመጫን ላይ...';
    try {
        const res = await authFetch('/api/fleet/vehicles/trash/list');
        const list = await res.json();
        if (!list.length) { box.innerHTML = '<p style="color:#a0aec0;">ትራሹ ባዶ ነው</p>'; return; }
        box.innerHTML = `<table class="data-table"><thead><tr><th>ሰሌዳ ቁጥር</th><th>አይነት</th><th>የተሰረዘበት ጊዜ</th><th>እርምጃ</th></tr></thead><tbody>
            ${list.map(v => `<tr><td>${fleetEsc(v.plateNumber)}</td><td>${fleetEsc(v.vehicleType)}</td><td>${v.deletedAt ? new Date(v.deletedAt).toLocaleDateString('en-GB') : '-'}</td>
                <td><button onclick="restoreVehicle('${v._id}')" class="btn-submit" style="padding:4px 8px; font-size:12px;"><i class="fas fa-undo"></i> መልስ</button></td></tr>`).join('')}
            </tbody></table>`;
    } catch (err) {
        box.innerHTML = '<p style="color:#e53e3e;">ማምጣት አልተቻለም</p>';
    }
}
async function restoreVehicle(id) {
    try {
        await authFetch(`/api/fleet/vehicles/${id}/restore`, { method: 'POST' });
        vehicleTrashOpen = false;
        toggleVehicleTrash();
        fetchVehicles();
    } catch (err) {
        alert('መመለስ አልተቻለም');
    }
}

// ---------- Fuel price settings ----------
function fuelPriceMetaText(st) {
    if (!st || !st.updatedAt) return '';
    return `መጨረሻ የቀየረው፦ ${st.updatedByName || '-'} (${isoToEthText(dateToISO(new Date(st.updatedAt)))} ዓ.ም)`;
}
function showFuelPricesInBoxes(st) {
    ['', '2'].forEach(w => {
        setAmountValue(`fuel${w}-price-diesel`, st.dieselPricePerLiter || '');
        setAmountValue(`fuel${w}-price-benzine`, st.benzinePricePerLiter || '');
        const meta = document.getElementById(`fuel${w}-price-meta`);
        if (meta) meta.textContent = fuelPriceMetaText(st);
    });
}
async function loadFuelPriceSettings() {
    try {
        const res = await authFetch('/api/fleet/settings');
        const data = await res.json();
        if (!res.ok) return;
        fleetSettings = data;
        showFuelPricesInBoxes(data);
        autoFillFuelCost();
    } catch (err) {
        console.log('ቅንብር ማምጣት አልተቻለም');
    }
}
// `which` is '' for the box on the trips page and '2' for the one on the fuel page.
async function saveFuelPrices(which) {
    const w = which || '';
    try {
        const res = await authFetch('/api/fleet/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                dieselPricePerLiter: getAmountValue(`fuel${w}-price-diesel`) || 0,
                benzinePricePerLiter: getAmountValue(`fuel${w}-price-benzine`) || 0
            })
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'ማስቀመጥ አልተቻለም'); return; }
        fleetSettings = data;
        showFuelPricesInBoxes(data);
        alert('ዋጋው ተቀምጧል');
        updateTripEstimate();
        autoFillFuelCost();
    } catch (err) {
        alert('ማስቀመጥ አልተቻለም');
    }
}

// Fills the purchase price from litres x today's price for that vehicle's fuel
// type, until the person types a price themselves.
function autoFillFuelCost() {
    const costEl = document.getElementById('fuel-cost');
    if (!costEl || costEl.dataset.manual === '1') return;
    const vehicle = fleetVehicles.find(v => v._id === document.getElementById('fuel-vehicle').value);
    const liters = getAmountValue('fuel-liters');
    if (!vehicle || isNaN(liters)) return;
    const price = vehicle.fuelType === 'ቤንዚን' ? fleetSettings.benzinePricePerLiter : fleetSettings.dieselPricePerLiter;
    if (!price) return;
    setAmountValue('fuel-cost', Math.round(liters * price * 100) / 100);
}

// ---------- Departments ----------
async function loadFleetDepartments() {
    try {
        const res = await authFetch('/api/fleet/departments');
        fleetDepartments = await res.json();
        const select = document.getElementById('trip-department');
        if (select) {
            select.innerHTML = '<option value="">-- ይምረጡ --</option>' +
                fleetDepartments.map(d => `<option value="${d}">${d}</option>`).join('');
        }
    } catch (err) {
        console.log('ዲፓርትመንት ዝርዝር ማምጣት አልተቻለም');
    }
}

// ---------- Trip log ----------
function populateTripVehicleSelect() {
    const select = document.getElementById('trip-vehicle');
    if (!select) return;
    const activeVehicles = fleetVehicles.filter(v => v.status !== 'out_of_service');
    select.innerHTML = '<option value="">-- ይምረጡ --</option>' +
        activeVehicles.map(v => `<option value="${v._id}">${fleetEsc(v.plateNumber)} - ${fleetEsc(v.vehicleType)}</option>`).join('');
}

// Live client-side preview only — the server always recomputes and is the
// only value that actually gets saved, so a stale/manipulated preview here
// can never affect what ends up in the report.
function updateTripEstimate() {
    const preview = document.getElementById('trip-estimate-preview');
    if (!preview) return;
    const vehicleId = document.getElementById('trip-vehicle').value;
    const depKm = getAmountValue('trip-departure-km');
    const retKm = getAmountValue('trip-return-km');
    const vehicle = fleetVehicles.find(v => v._id === vehicleId);

    if (!vehicle || isNaN(depKm) || isNaN(retKm)) { preview.textContent = ''; return; }
    if (retKm < depKm) { preview.textContent = '⚠️ የተመለሰበት ኪሜ ከወጣበት ኪሜ ያንሳል'; return; }

    const distance = retKm - depKm;
    const pricePerLiter = vehicle.fuelType === 'ቤንዚን' ? (fleetSettings.benzinePricePerLiter || 0) : (fleetSettings.dieselPricePerLiter || 0);
    const cost = vehicle.kmPerLiter > 0 ? Math.round(distance * (pricePerLiter / vehicle.kmPerLiter) * 100) / 100 : 0;
    preview.textContent = `የተጓዘው ኪ.ሜ፡ ${distance.toLocaleString('en-US')} | የነዳጅ ወጪ ግምት፡ ${cost.toLocaleString('en-US')} ብር`;
}

// ---------- Long lists: show a page at a time, "ተጨማሪ አሳይ" adds the next page ----------
const FLEET_PAGE_SIZE = 20;

// Loads one page. append=false reloads from the top but keeps as many rows as are
// already on screen (at least one page), so a save/delete doesn't collapse the list.
async function fleetLoadPage(url, shownCount, append) {
    const skip = append ? shownCount : 0;
    const limit = append ? FLEET_PAGE_SIZE : Math.max(shownCount, FLEET_PAGE_SIZE);
    const res = await authFetch(`${url}?skip=${skip}&limit=${limit}`);
    const data = await res.json();
    if (!res.ok) return null;
    const items = Array.isArray(data) ? data : [];
    const header = res.headers && typeof res.headers.get === 'function' ? res.headers.get('X-Total-Count') : null;
    // No count header = a server that does not page (everything came back): show it all.
    const total = (header !== null && header !== '' && !isNaN(Number(header))) ? Number(header) : skip + items.length;
    return { items, total };
}
function fleetMergeUnique(existing, more) {
    const seen = new Set(existing.map(x => x._id));
    return existing.concat(more.filter(x => !seen.has(x._id)));
}
function renderMoreBox(boxId, shown, total, onclickName) {
    const box = document.getElementById(boxId);
    if (!box) return;
    if (total <= FLEET_PAGE_SIZE && shown >= total) { box.innerHTML = ''; return; }
    const note = `<span style="color:#a0aec0; font-size:13px; margin:0 10px;">${shown} ከ ${total} ታይተዋል</span>`;
    box.innerHTML = shown < total
        ? `${note}<button type="button" class="btn-submit" onclick="${onclickName}()"><i class="fas fa-chevron-down"></i> ተጨማሪ አሳይ</button>`
        : `${note}`;
}

let tripsTotal = 0, maintTotal = 0, fuelTotal = 0, allowanceTotal = 0;

async function fetchTripLogs(append) {
    try {
        const page = await fleetLoadPage('/api/fleet/trips', fleetTrips.length, append);
        if (!page) return;
        fleetTrips = append ? fleetMergeUnique(fleetTrips, page.items) : page.items;
        tripsTotal = page.total;
        renderTripList();
    } catch (err) {
        console.log('የአጠቃቀም ምዝገባ ማምጣት አልተቻለም');
    }
}

function loadMoreTrips() { fetchTripLogs(true); }

function renderTripList() {
    renderMoreBox('trip-more-box', fleetTrips.length, tripsTotal, 'loadMoreTrips');
    const tbody = document.getElementById('trip-data-list');
    if (!tbody) return;
    if (!fleetTrips.length) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#a0aec0;">ምንም አልተመዘገበም</td></tr>`;
        return;
    }
    tbody.innerHTML = fleetTrips.map(t => `
        <tr>
            <td>${fleetDateCell(t.tripDate)}</td>
            <td>${fleetEsc(t.department)}</td>
            <td>${fleetEsc(t.destination || '*')}</td>
            <td>${fleetEsc(t.vehiclePlate)} (${fleetEsc(t.vehicleType)})</td>
            <td>${(t.departureKm||0).toLocaleString('en-US')} - ${(t.returnKm||0).toLocaleString('en-US')}</td>
            <td>${(t.distanceKm||0).toLocaleString('en-US')}</td>
            <td>${(t.estimatedFuelCost||0).toLocaleString('en-US')} ብር</td>
            <td class="no-print" style="white-space:nowrap;">${canDeleteEntry(t) ? `<button onclick="startTripEdit('${t._id}')" class="btn-submit" style="padding:4px 8px; font-size:12px; margin-right:4px;" title="አስተካክል"><i class="fas fa-edit"></i></button><button onclick="deleteTripLog('${t._id}')" class="btn-logout" style="padding:4px 8px; font-size:12px;" title="ሰርዝ"><i class="fas fa-trash"></i></button>` : ''}</td>
        </tr>`).join('');
}

let tripEditId = null;
// The date being worked on. After each registration the rest of the form is
// cleared but the date stays, so ten vehicles for the same day need the date
// chosen only once; it changes only when the person picks another one.
let tripWorkingDate = '';

function setTripFormMode(editing) {
    const title = document.getElementById('trip-form-title');
    const submit = document.getElementById('trip-submit-btn');
    const cancel = document.getElementById('trip-cancel-btn');
    if (title) title.innerHTML = editing ? '<i class="fas fa-edit"></i> የአጠቃቀም ምዝገባ አስተካክል' : '<i class="fas fa-plus-circle"></i> የተሽከርካሪ አጠቃቀም መዝግብ';
    if (submit) submit.innerHTML = editing ? '<i class="fas fa-save"></i> ለውጡን አስቀምጥ' : '<i class="fas fa-save"></i> መዝግብ';
    if (cancel) cancel.style.display = editing ? 'inline-block' : 'none';
}

function selectOrAddOption(selectEl, value, label) {
    if (!Array.from(selectEl.options).some(o => o.value === value)) selectEl.add(new Option(label, value));
    selectEl.value = value;
}

function startTripEdit(id) {
    const t = fleetTrips.find(x => x._id === id);
    if (!t) return;
    tripEditId = id;
    selectOrAddOption(document.getElementById('trip-department'), t.department, t.department);
    selectOrAddOption(document.getElementById('trip-vehicle'), t.vehicleId, `${t.vehiclePlate} (${t.vehicleType})`);
    document.getElementById('trip-destination').value = (t.destination === '*') ? '' : (t.destination || '');
    document.getElementById('trip-date').value = t.tripDate || '';
    document.getElementById('trip-departure-time').value = t.departureTime || '';
    setAmountValue('trip-departure-km', t.departureKm);
    setAmountValue('trip-return-km', t.returnKm);
    updateTripEstimate();
    setTripFormMode(true);
    document.getElementById('trip-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelTripEdit() {
    tripEditId = null;
    document.getElementById('trip-form').reset();
    document.getElementById('trip-estimate-preview').textContent = '';
    setTripFormMode(false);
    if (tripWorkingDate) document.getElementById('trip-date').value = tripWorkingDate;
}

async function handleTripSubmit(e) {
    e.preventDefault();
    const payload = {
        department: document.getElementById('trip-department').value,
        vehicleId: document.getElementById('trip-vehicle').value,
        destination: document.getElementById('trip-destination').value.trim() || '*',
        tripDate: document.getElementById('trip-date').value,
        departureTime: document.getElementById('trip-departure-time').value,
        departureKm: getAmountValue('trip-departure-km'),
        returnKm: getAmountValue('trip-return-km')
    };
    const editing = tripEditId;
    try {
        const res = await authFetch(editing ? `/api/fleet/trips/${editing}` : '/api/fleet/trips', {
            method: editing ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'ስህተት ተፈጥሯል'); return; }
        if (!editing) tripWorkingDate = payload.tripDate;
        cancelTripEdit();
        invalidateFleetReports();
        fetchTripLogs();
        fetchVehicles(); // odometer on the vehicle may have advanced
    } catch (err) {
        alert(editing ? 'ማስተካከል አልተቻለም' : 'መመዝገብ አልተቻለም');
    }
}

async function deleteTripLog(id) {
    if (!confirm('ይህን ምዝገባ መሰረዝ ይፈልጋሉ?')) return;
    try {
        const res = await authFetch(`/api/fleet/trips/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            let d = {};
            try { d = await res.json(); } catch (parseErr) {}
            alert(d.error || 'ማጥፋት አልተቻለም');
            return;
        }
        if (tripEditId === id) cancelTripEdit();
        invalidateFleetReports();
        fetchTripLogs();
    } catch (err) {
        alert('ማጥፋት አልተቻለም');
    }
}

// ---------- Maintenance (with approval workflow) ----------
let fleetMaintenance = [];

function populateMaintenanceVehicleSelects() {
    const options = '<option value="">-- ይምረጡ --</option>' +
        fleetVehicles.map(v => `<option value="${v._id}">${fleetEsc(v.plateNumber)} - ${fleetEsc(v.vehicleType)}</option>`).join('');
    const maintSelect = document.getElementById('maint-vehicle');
    if (maintSelect) maintSelect.innerHTML = options;
    const fuelSelect = document.getElementById('fuel-vehicle');
    if (fuelSelect) fuelSelect.innerHTML = options;
}

async function fetchMaintenanceList(append) {
    try {
        const page = await fleetLoadPage('/api/fleet/maintenance', fleetMaintenance.length, append);
        if (!page) return;
        fleetMaintenance = append ? fleetMergeUnique(fleetMaintenance, page.items) : page.items;
        maintTotal = page.total;
        renderMaintenanceList();
    } catch (err) {
        console.log('የጥገና ምዝገባ ማምጣት አልተቻለም');
    }
}

// Renders the "አዘጋጀው"/"አጽዳቂ" cell for one maintenance row — the same
// prepare→send→approve logic as the payment/contract receipt modal, just
// shown inline in the table instead of in a separate modal.
function maintenanceSignCellHtml(item, slot) {
    const person = slot === 'prepared' ? item.preparedBy : item.approvedBy;
    if (person && person.signatureImage) {
        return `<span style="font-size:12px; color:#68d391;"><i class="fas fa-check-circle"></i> ${fleetEsc(person.fullName)}</span>`;
    }
    if (slot === 'prepared') {
        return `<button class="btn-submit no-print" style="padding:5px 9px; font-size:11.5px;" onclick="promptAndSign('${item._id}', 'prepared', 'maintenance')"><i class="fas fa-signature"></i> ፈርም</button>`;
    }
    // approved slot
    if (item.approval && item.approval.pendingApproverId) {
        const isMyApproval = currentUser && (currentUser.id === item.approval.pendingApproverId || currentUser.role === 'Admin');
        return isMyApproval
            ? `<button class="btn-submit no-print" style="padding:5px 9px; font-size:11.5px;" onclick="promptAndSign('${item._id}', 'approved', 'maintenance')"><i class="fas fa-signature"></i> ፈርም</button>`
            : `<span class="no-print" style="font-size:11px; color:#d69e2e;"><i class="fas fa-hourglass-half"></i> ${item.approval.pendingApproverName} እየጠበቀ</span>`;
    }
    if (currentUser && currentUser.role === 'Admin') {
        return `<button class="btn-submit no-print" style="padding:5px 9px; font-size:11.5px;" onclick="promptAndSign('${item._id}', 'approved', 'maintenance')"><i class="fas fa-signature"></i> ፈርም (Admin)</button>`;
    }
    return `<span class="no-print" style="font-size:11px; color:#a0aec0;">ገና አልተላከም</span>`;
}

// Reuses the same currentUser.role check the payment/contract UI relies on
// for the Admin-override path (permissions themselves aren't sent to the
// client at login — the server is always the real authority on those).

// The person who made an entry may edit/delete it until it is approved; an
// Admin may always (the server enforces the same rule).
function canEditMaintenance(item) {
    if (!currentUser) return false;
    if (currentUser.role === 'Admin') return true;
    return item.userId === currentUser.id && !(item.approvedBy && item.approvedBy.userId);
}

function loadMoreMaintenance() { fetchMaintenanceList(true); }

function renderMaintenanceList() {
    renderMoreBox('maint-more-box', fleetMaintenance.length, maintTotal, 'loadMoreMaintenance');
    const tbody = document.getElementById('maint-data-list');
    if (!tbody) return;
    if (!fleetMaintenance.length) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#a0aec0;">ምንም የጥገና ምዝገባ የለም</td></tr>`;
        return;
    }
    const typeLabels = { routine: 'መደበኛ', repair: 'ጥገና' };
    tbody.innerHTML = fleetMaintenance.map(item => `
        <tr>
            <td>${fleetDateCell(item.date)}</td>
            <td>${fleetEsc(item.vehiclePlate)} (${fleetEsc(item.vehicleType)})</td>
            <td>${typeLabels[item.maintenanceType] || item.maintenanceType}</td>
            <td>${fleetEsc(item.description || '-')}</td>
            <td>${(item.cost||0).toLocaleString('en-US')} ብር</td>
            <td>${maintenanceSignCellHtml(item, 'prepared')}</td>
            <td>${maintenanceSignCellHtml(item, 'approved')}</td>
            <td class="no-print" style="white-space:nowrap;">${canEditMaintenance(item) ? `<button onclick="startMaintenanceEdit('${item._id}')" class="btn-submit" style="padding:4px 8px; font-size:12px; margin-right:4px;" title="አስተካክል"><i class="fas fa-edit"></i></button><button onclick="deleteMaintenance('${item._id}')" class="btn-logout" style="padding:4px 8px; font-size:12px;" title="ሰርዝ"><i class="fas fa-trash"></i></button>` : ''}</td>
        </tr>`).join('');
}

let maintEditId = null;

function setMaintenanceFormMode(editing) {
    const title = document.getElementById('maint-form-title');
    const submit = document.getElementById('maint-submit-btn');
    const cancel = document.getElementById('maint-cancel-btn');
    if (title) title.innerHTML = editing ? '<i class="fas fa-edit"></i> ጥገና/አገልግሎት አስተካክል' : '<i class="fas fa-tools"></i> አዲስ ጥገና/አገልግሎት መዝግብ';
    if (submit) submit.innerHTML = editing ? '<i class="fas fa-save"></i> ለውጡን አስቀምጥ' : '<i class="fas fa-save"></i> መዝግብ';
    if (cancel) cancel.style.display = editing ? 'inline-block' : 'none';
}

function startMaintenanceEdit(id) {
    const item = fleetMaintenance.find(x => x._id === id);
    if (!item) return;
    if ((item.preparedBy && item.preparedBy.userId) || (item.approvedBy && item.approvedBy.userId)) {
        if (!confirm('ይህ ምዝገባ ተፈርሞበታል። ካስተካከሉት ፊርማዎቹ ይሰረዛሉ፤ እንደገና መፈረም እና ለማጽደቅ መላክ ያስፈልጋል። ይቀጥሉ?')) return;
    }
    maintEditId = id;
    const sel = document.getElementById('maint-vehicle');
    if (!Array.from(sel.options).some(o => o.value === item.vehicleId)) {
        sel.add(new Option(`${item.vehiclePlate} (${item.vehicleType})`, item.vehicleId));
    }
    sel.value = item.vehicleId;
    document.getElementById('maint-date').value = item.date || '';
    setAmountValue('maint-odometer', item.odometerKm || '');
    document.getElementById('maint-type').value = item.maintenanceType || 'routine';
    setAmountValue('maint-cost', item.cost || 0);
    document.getElementById('maint-garage').value = item.garage || '';
    document.getElementById('maint-description').value = item.description || '';
    setAmountValue('maint-next-km', item.nextServiceKm || '');
    document.getElementById('maint-next-date').value = item.nextServiceDate || '';
    document.getElementById('maint-receipt').value = '';
    setMaintenanceFormMode(true);
    document.getElementById('maintenance-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelMaintenanceEdit() {
    maintEditId = null;
    document.getElementById('maintenance-form').reset();
    setMaintenanceFormMode(false);
}

async function handleMaintenanceSubmit(e) {
    e.preventDefault();
    const fd = new FormData();
    fd.append('vehicleId', document.getElementById('maint-vehicle').value);
    fd.append('date', document.getElementById('maint-date').value);
    fd.append('odometerKm', getAmountValue('maint-odometer') || 0);
    fd.append('maintenanceType', document.getElementById('maint-type').value);
    fd.append('cost', getAmountValue('maint-cost') || 0);
    fd.append('garage', document.getElementById('maint-garage').value.trim());
    fd.append('description', document.getElementById('maint-description').value.trim());
    fd.append('nextServiceKm', getAmountValue('maint-next-km') || '');
    fd.append('nextServiceDate', document.getElementById('maint-next-date').value);
    const receiptFile = document.getElementById('maint-receipt').files[0];
    if (receiptFile) fd.append('receipt', receiptFile);

    const editing = maintEditId;
    try {
        const res = await authFetch(editing ? `/api/fleet/maintenance/${editing}` : '/api/fleet/maintenance', { method: editing ? 'PUT' : 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'ስህተት ተፈጥሯል'); return; }
        cancelMaintenanceEdit();
        invalidateFleetReports();
        fetchMaintenanceList();
    } catch (err) {
        alert(editing ? 'ማስተካከል አልተቻለም' : 'መመዝገብ አልተቻለም');
    }
}

async function deleteMaintenance(id) {
    const item = fleetMaintenance.find(x => x._id === id);
    const signed = item && ((item.preparedBy && item.preparedBy.userId) || (item.approvedBy && item.approvedBy.userId));
    if (!confirm(signed ? 'ይህ ምዝገባ ተፈርሞበታል። መሰረዝ ይፈልጋሉ?' : 'ይህን የጥገና ምዝገባ መሰረዝ ይፈልጋሉ?')) return;
    try {
        const res = await authFetch(`/api/fleet/maintenance/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            let d = {};
            try { d = await res.json(); } catch (parseErr) {}
            alert(d.error || 'ማጥፋት አልተቻለም');
            return;
        }
        if (maintEditId === id) cancelMaintenanceEdit();
        invalidateFleetReports();
        fetchMaintenanceList();
    } catch (err) {
        alert('ማጥፋት አልተቻለም');
    }
}

// ---------- Fuel Log (actual receipts, no approval) ----------
let fleetFuelLogs = [];

async function fetchFuelLogs(append) {
    try {
        const page = await fleetLoadPage('/api/fleet/fuel-logs', fleetFuelLogs.length, append);
        if (!page) return;
        fleetFuelLogs = append ? fleetMergeUnique(fleetFuelLogs, page.items) : page.items;
        fuelTotal = page.total;
        renderFuelLogList();
    } catch (err) {
        console.log('የነዳጅ ምዝገባ ማምጣት አልተቻለም');
    }
}

function loadMoreFuelLogs() { fetchFuelLogs(true); }

function renderFuelLogList() {
    renderMoreBox('fuel-more-box', fleetFuelLogs.length, fuelTotal, 'loadMoreFuelLogs');
    const tbody = document.getElementById('fuel-data-list');
    if (!tbody) return;
    if (!fleetFuelLogs.length) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#a0aec0;">ምንም የነዳጅ ምዝገባ የለም</td></tr>`;
        return;
    }
    tbody.innerHTML = fleetFuelLogs.map(f => `
        <tr>
            <td>${fleetDateCell(f.date)}</td>
            <td>${fleetEsc(f.vehiclePlate)} (${fleetEsc(f.vehicleType)})</td>
            <td>${fleetEsc(f.station || '-')}</td>
            <td>${(f.liters||0).toLocaleString('en-US')}</td>
            <td>${(f.cost||0).toLocaleString('en-US')} ብር</td>
            <td>${(f.odometerKm||0).toLocaleString('en-US')}</td>
            <td class="no-print" style="white-space:nowrap;">${canDeleteEntry(f) ? `<button onclick="startFuelEdit('${f._id}')" class="btn-submit" style="padding:4px 8px; font-size:12px; margin-right:4px;" title="አስተካክል"><i class="fas fa-edit"></i></button><button onclick="deleteFuelLog('${f._id}')" class="btn-logout" style="padding:4px 8px; font-size:12px;" title="ሰርዝ"><i class="fas fa-trash"></i></button>` : ''}</td>
        </tr>`).join('');
}

let fuelEditId = null;
let fuelWorkingDate = '';   // kept between registrations, like the trip date

function setFuelFormMode(editing) {
    const title = document.getElementById('fuel-form-title');
    const submit = document.getElementById('fuel-submit-btn');
    const cancel = document.getElementById('fuel-cancel-btn');
    if (title) title.innerHTML = editing ? '<i class="fas fa-edit"></i> የነዳጅ ግዢ አስተካክል' : '<i class="fas fa-gas-pump"></i> አዲስ የነዳጅ ግዢ መዝግብ';
    if (submit) submit.innerHTML = editing ? '<i class="fas fa-save"></i> ለውጡን አስቀምጥ' : '<i class="fas fa-save"></i> መዝግብ';
    if (cancel) cancel.style.display = editing ? 'inline-block' : 'none';
}

function startFuelEdit(id) {
    const f = fleetFuelLogs.find(x => x._id === id);
    if (!f) return;
    fuelEditId = id;
    selectOrAddOption(document.getElementById('fuel-vehicle'), f.vehicleId, `${f.vehiclePlate} (${f.vehicleType})`);
    document.getElementById('fuel-date').value = f.date || '';
    document.getElementById('fuel-station').value = f.station || '';
    setAmountValue('fuel-liters', f.liters || '');
    setAmountValue('fuel-cost', f.cost || 0);
    document.getElementById('fuel-cost').dataset.manual = '1';   // keep the saved price, don't re-fill it
    setAmountValue('fuel-odometer', f.odometerKm || '');
    document.getElementById('fuel-receipt').value = '';
    setFuelFormMode(true);
    document.getElementById('fuel-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelFuelEdit() {
    fuelEditId = null;
    document.getElementById('fuel-form').reset();
    delete document.getElementById('fuel-cost').dataset.manual;
    setFuelFormMode(false);
    if (fuelWorkingDate) document.getElementById('fuel-date').value = fuelWorkingDate;
}

async function handleFuelLogSubmit(e) {
    e.preventDefault();
    const fd = new FormData();
    fd.append('vehicleId', document.getElementById('fuel-vehicle').value);
    fd.append('date', document.getElementById('fuel-date').value);
    fd.append('station', document.getElementById('fuel-station').value.trim());
    fd.append('liters', getAmountValue('fuel-liters') || 0);
    fd.append('cost', getAmountValue('fuel-cost') || 0);
    fd.append('odometerKm', getAmountValue('fuel-odometer') || 0);
    const receiptFile = document.getElementById('fuel-receipt').files[0];
    if (receiptFile) fd.append('receipt', receiptFile);

    const editing = fuelEditId;
    try {
        const res = await authFetch(editing ? `/api/fleet/fuel-logs/${editing}` : '/api/fleet/fuel-logs', { method: editing ? 'PUT' : 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'ስህተት ተፈጥሯል'); return; }
        if (!editing) fuelWorkingDate = fd.get('date');
        cancelFuelEdit();
        invalidateFleetReports();
        fetchFuelLogs();
    } catch (err) {
        alert(editing ? 'ማስተካከል አልተቻለም' : 'መመዝገብ አልተቻለም');
    }
}

async function deleteFuelLog(id) {
    if (!confirm('ይህን ምዝገባ መሰረዝ ይፈልጋሉ?')) return;
    try {
        const res = await authFetch(`/api/fleet/fuel-logs/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            let d = {};
            try { d = await res.json(); } catch (parseErr) {}
            alert(d.error || 'ማጥፋት አልተቻለም');
            return;
        }
        if (fuelEditId === id) cancelFuelEdit();
        invalidateFleetReports();
        fetchFuelLogs();
    } catch (err) {
        alert('ማጥፋት አልተቻለም');
    }
}

// =====================================================================
// ===== Fleet weekly / range usage report (ሳምንታዊ ሪፖርት) =====
// =====================================================================
// Reads the trips already saved in "የአጠቃቀም ምዝገባ" for a chosen date
// range and produces (1) an on-screen department summary and (2) an Excel
// file in the same layout as the manual sheet: one block per day, then a
// summary table (department / km traveled / fuel cost in birr).
let fleetReportData = null;

function fleetEsc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Gregorian -> Ethiopian calendar (the company's reports use Ethiopian dates).
function gregorianToEthiopian(y, m, d) {
    const a = Math.floor((14 - m) / 12);
    const yy = y + 4800 - a;
    const mm = m + 12 * a - 3;
    const jdn = d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
    const r = (jdn - 1723856) % 1461;
    const n = (r % 365) + 365 * Math.floor(r / 1460);
    return {
        y: 4 * Math.floor((jdn - 1723856) / 1461) + Math.floor(r / 365) - Math.floor(r / 1460),
        m: Math.floor(n / 30) + 1,
        d: (n % 30) + 1
    };
}
function isoToEthText(iso) {
    const p = String(iso).split('-').map(Number);
    const e = gregorianToEthiopian(p[0], p[1], p[2]);
    return `${e.d}/${e.m}/${e.y}`;
}
function dateToISO(dt) {
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${dt.getFullYear()}-${mm}-${dd}`;
}
function addDaysISO(iso, n) {
    const p = iso.split('-').map(Number);
    return dateToISO(new Date(p[0], p[1] - 1, p[2] + n, 12));
}
function daysBetweenISO(fromIso, toIso) {
    const a = fromIso.split('-').map(Number), b = toIso.split('-').map(Number);
    const da = Date.UTC(a[0], a[1] - 1, a[2]), db = Date.UTC(b[0], b[1] - 1, b[2]);
    return Math.round((db - da) / 86400000) + 1;
}

function initFleetReportSection() {
    loadFleetDepartments();
    const fromEl = document.getElementById('freport-from');
    const toEl = document.getElementById('freport-to');
    if (fromEl && toEl && (!fromEl.value || !toEl.value)) setFleetReportPreset(7);
    else updateFleetReportEthLabel();
}
function setFleetReportPreset(days) {
    const to = dateToISO(new Date());
    document.getElementById('freport-to').value = to;
    document.getElementById('freport-from').value = addDaysISO(to, -(days - 1));
    document.getElementById('freport-detail').checked = days <= 31;
    updateFleetReportEthLabel();
}
function updateFleetReportEthLabel() {
    const from = document.getElementById('freport-from').value;
    const to = document.getElementById('freport-to').value;
    const label = document.getElementById('freport-eth-label');
    if (!label) return;
    if (!from || !to) { label.textContent = ''; return; }
    label.textContent = `ከ ${isoToEthText(from)} እስከ ${isoToEthText(to)} (ዓ.ም) — ${daysBetweenISO(from, to)} ቀን`;
}

function fleetReportDeptOrder(trips) {
    const order = Array.isArray(fleetDepartments) ? fleetDepartments.slice() : [];
    // Departments typed in older records that are no longer in the list are
    // still counted — nothing is silently dropped from the report.
    trips.forEach(t => { if (t.department && !order.includes(t.department)) order.push(t.department); });
    return order;
}
function fleetReportSummary(trips, deptOrder) {
    return deptOrder.map(dept => {
        const own = trips.filter(t => t.department === dept);
        return {
            dept,
            count: own.length,
            km: own.reduce((s, t) => s + (t.distanceKm || 0), 0),
            cost: Math.round(own.reduce((s, t) => s + (t.estimatedFuelCost || 0), 0) * 100) / 100
        };
    });
}

function fleetVehicleLabel(t) {
    return String(t.vehicleType || '').trim() || 'ያልታወቀ';
}
function fleetReportVehicleSummary(trips) {
    const map = new Map();
    trips.forEach(t => {
        const type = fleetVehicleLabel(t);
        if (!map.has(type)) map.set(type, { type, count: 0, km: 0, cost: 0 });
        const r = map.get(type);
        r.count += 1;
        r.km += t.distanceKm || 0;
        r.cost += t.estimatedFuelCost || 0;
    });
    return Array.from(map.values())
        .map(r => ({ type: r.type, count: r.count, km: r.km, cost: Math.round(r.cost * 100) / 100 }))
        .sort((a, b) => b.km - a.km);
}

async function generateFleetReport() {
    const from = document.getElementById('freport-from').value;
    const to = document.getElementById('freport-to').value;
    if (!from || !to) { alert('እባክዎ ከቀን እና እስከ ቀን ይምረጡ'); return; }
    if (from > to) { alert('"ከቀን" ከ"እስከ ቀን" መቅደም አለበት'); return; }
    const days = daysBetweenISO(from, to);
    if (days > 366) { alert('ከአንድ ዓመት በላይ መምረጥ አይቻልም'); return; }

    let includeDetail = document.getElementById('freport-detail').checked;
    if (includeDetail && days > 31) {
        includeDetail = false;
        document.getElementById('freport-detail').checked = false;
        alert('ከ31 ቀን በላይ ሲሆን የየቀኑ ዝርዝር አይካተትም፤ ማጠቃለያ ብቻ ይወጣል።');
    }

    try {
        if (!fleetDepartments.length) await loadFleetDepartments();
        const res = await authFetch(`/api/fleet/trips?from=${from}&to=${to}`);
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'ሪፖርቱን ማምጣት አልተቻለም'); return; }
        const trips = Array.isArray(data) ? data : [];
        const deptOrder = fleetReportDeptOrder(trips);
        fleetReportData = { from, to, trips, includeDetail, deptOrder };
        renderFleetReportPreview();
        document.getElementById('freport-download-btn').disabled = false;
    } catch (err) {
        alert('ሪፖርቱን ማምጣት አልተቻለም');
    }
}

function renderFleetReportPreview() {
    if (!fleetReportData) return;
    const { from, to, trips, deptOrder } = fleetReportData;
    // Only departments that actually traveled in the chosen period are listed.
    const rows = fleetReportSummary(trips, deptOrder).filter(r => r.count > 0);
    const money = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const totalKm = rows.reduce((s, r) => s + r.km, 0);
    const totalCost = Math.round(rows.reduce((s, r) => s + r.cost, 0) * 100) / 100;
    const totalCount = rows.reduce((s, r) => s + r.count, 0);

    document.getElementById('freport-result').style.display = 'block';
    document.getElementById('freport-title').innerHTML =
        `<i class="fas fa-list"></i> ማጠቃለያ — ከቀን ${fleetEsc(isoToEthText(from))} እስከ ${fleetEsc(isoToEthText(to))}`;
    document.getElementById('freport-summary-list').innerHTML = !rows.length
        ? `<tr><td colspan="5" style="text-align:center; color:#a0aec0;">በዚህ ጊዜ ምንም ጉዞ አልተመዘገበም</td></tr>`
        : rows.map((r, i) => `
        <tr>
            <td>${i + 1}</td>
            <td>${fleetEsc(r.dept)}</td>
            <td>${r.count}</td>
            <td>${r.km.toLocaleString('en-US')}</td>
            <td>${money(r.cost)}</td>
        </tr>`).join('') + `
        <tr style="font-weight:bold;">
            <td></td>
            <td>ድምር</td>
            <td>${totalCount}</td>
            <td>${totalKm.toLocaleString('en-US')}</td>
            <td>${money(totalCost)}</td>
        </tr>`;

    const vRows = fleetReportVehicleSummary(trips);
    const vKm = vRows.reduce((sum, r) => sum + r.km, 0);
    const vCost = Math.round(vRows.reduce((sum, r) => sum + r.cost, 0) * 100) / 100;
    const vBody = document.getElementById('freport-vehicle-list');
    if (vBody) {
        vBody.innerHTML = vRows.length ? vRows.map((r, i) => `
            <tr>
                <td>${i + 1}</td>
                <td>${fleetEsc(r.type)}</td>
                <td>${r.count}</td>
                <td>${r.km.toLocaleString('en-US')}</td>
                <td>${money(r.cost)}</td>
            </tr>`).join('') + `
            <tr style="font-weight:bold;">
                <td></td>
                <td>ድምር</td>
                <td>${vRows.reduce((sum, r) => sum + r.count, 0)}</td>
                <td>${vKm.toLocaleString('en-US')}</td>
                <td>${money(vCost)}</td>
            </tr>` : `<tr><td colspan="5" style="text-align:center; color:#a0aec0;">በዚህ ጊዜ ምንም ጉዞ የለም</td></tr>`;
    }
}

// ---- Excel export (professional layout, built with ExcelJS) ----
const FLEET_REPORT_ORG_NAME = 'Fountain International Trading PLC';
const FLEET_REPORT_ORG_SUB = 'ፋውንቴን ኢንተርናሽናል ትሬዲንግ ኃ/የተ/የግ/ማህበር';
const FLEET_WEEKDAYS_AM = ['እሑድ', 'ሰኞ', 'ማክሰኞ', 'ረቡዕ', 'ሐሙስ', 'ዓርብ', 'ቅዳሜ'];

function fleetWeekdayAm(iso) {
    const p = iso.split('-').map(Number);
    return FLEET_WEEKDAYS_AM[new Date(p[0], p[1] - 1, p[2], 12).getDay()];
}

// Pure builder (no DOM): returns an ExcelJS workbook. `logo` is
// { buffer, extension } or null.
function buildFleetReportWorkbook(data, logo) {
    const { from, to, trips, includeDetail, deptOrder } = data;
    const ethFrom = isoToEthText(from), ethTo = isoToEthText(to);
    const totalDays = daysBetweenISO(from, to);
    const rangeText = `ከ ${ethFrom} እስከ ${ethTo} ዓ.ም`;
    const title = totalDays === 7 ? 'ሳምንታዊ የፍሊት ማኔጅመንት ሪፖርት' : 'የፍሊት ማኔጅመንት ሪፖርት';

    const NAVY = 'FF1F4E78', LIGHT = 'FFDCE6F1', GREY = 'FFF2F2F2';
    const side = { style: 'thin', color: { argb: 'FF7F7F7F' } };
    const BORDER = { top: side, left: side, bottom: side, right: side };
    const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
    const COLS = 7; // A..G

    const wb = new ExcelJS.Workbook();
    wb.creator = FLEET_REPORT_ORG_NAME;
    const ws = wb.addWorksheet('ሪፖርት', {
        pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
            margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
        views: [{ showGridLines: false }]
    });
    ws.columns = [{ width: 9 }, { width: 26 }, { width: 24 }, { width: 18 }, { width: 22 }, { width: 14 }, { width: 18 }];

    // Write a value into a merged band A:G (or a sub-range) with one style.
    function band(rowNum, text, opts) {
        const o = Object.assign({ from: 1, to: COLS, size: 11, bold: true, color: 'FF000000', bg: null, align: 'center', border: false, italic: false, height: null }, opts || {});
        for (let c = o.from; c <= o.to; c++) {
            const cell = ws.getCell(rowNum, c);
            cell.font = { name: 'Calibri', size: o.size, bold: o.bold, italic: o.italic, color: { argb: o.color } };
            cell.alignment = { horizontal: o.align, vertical: 'middle', wrapText: true };
            if (o.bg) cell.fill = fill(o.bg);
            if (o.border) cell.border = BORDER;
        }
        ws.getCell(rowNum, o.from).value = text;
        if (o.to > o.from) ws.mergeCells(rowNum, o.from, rowNum, o.to);
        if (o.height) ws.getRow(rowNum).height = o.height;
    }
    function headerRow(rowNum, labels) {
        labels.forEach((text, i) => {
            const cell = ws.getCell(rowNum, i + 1);
            cell.value = text;
            cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = fill(NAVY);
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            cell.border = BORDER;
        });
        ws.getRow(rowNum).height = 24;
    }
    function bodyCell(rowNum, col, value, opts) {
        const o = Object.assign({ align: 'center', fmt: null, bold: false, bg: null }, opts || {});
        const cell = ws.getCell(rowNum, col);
        cell.value = value;
        cell.font = { name: 'Calibri', size: 11, bold: o.bold };
        cell.alignment = { horizontal: o.align, vertical: 'middle', wrapText: true };
        cell.border = BORDER;
        if (o.fmt) cell.numFmt = o.fmt;
        if (o.bg) cell.fill = fill(o.bg);
        return cell;
    }

    // ---------- letterhead ----------
    band(1, FLEET_REPORT_ORG_NAME, { from: 2, size: 20, color: NAVY, height: 32 });
    band(2, FLEET_REPORT_ORG_SUB, { from: 2, size: 13, color: 'FF595959', height: 22 });
    band(3, title, { size: 15, color: 'FFFFFFFF', bg: NAVY, height: 28 });
    band(4, rangeText, { size: 12, bg: LIGHT, border: true, height: 22 });
    ws.getRow(5).height = 8;
    if (logo) {
        const imgId = wb.addImage({ buffer: logo.buffer, extension: logo.extension });
        ws.addImage(imgId, { tl: { col: 0.12, row: 0.1 }, ext: { width: 62, height: 62 } });
    }

    let r = 6;
    let rangeFirst = null, rangeLast = null; // detail rows, used by the summary formulas

    // ---------- one table per day ----------
    if (includeDetail) {
        for (let i = 0; i < totalDays; i++) {
            const day = addDaysISO(from, i);
            band(r, `ቀን፦ ${isoToEthText(day)}  (${fleetWeekdayAm(day)})`, { size: 12, bg: LIGHT, align: 'left', border: true, height: 22 });
            r++;
            headerRow(r, ['ተ.ቁ', 'ዲፓርትመንት', 'የሄዱበት ቦታ', 'የመኪናዉ አይነት', 'የኪሎሜትር ንባብ', 'ኪ.ሜ ልዩነት', 'የነዳጅ ወጪ (ብር)']);
            r++;
            const dayTrips = [];
            deptOrder.forEach(dept => {
                trips.filter(t => t.tripDate === day && t.department === dept).forEach(t => dayTrips.push(t));
            });
            if (!dayTrips.length) {
                band(r, 'ጉዞ አልተመዘገበም', { bold: false, italic: true, color: 'FF7F7F7F', border: true, height: 20 });
                r += 2;
                continue;
            }
            const firstRow = r;
            dayTrips.forEach((t, idx) => {
                bodyCell(r, 1, idx + 1);
                bodyCell(r, 2, t.department, { align: 'left' });
                bodyCell(r, 3, t.destination || '*', { align: 'left' });
                bodyCell(r, 4, fleetVehicleLabel(t));
                bodyCell(r, 5, `${t.departureKm}-${t.returnKm}`);
                bodyCell(r, 6, t.distanceKm || 0, { fmt: '#,##0' });
                bodyCell(r, 7, t.estimatedFuelCost || 0, { fmt: '#,##0.00', align: 'right' });
                if (rangeFirst === null) rangeFirst = r;
                rangeLast = r;
                r++;
            });
            const dayKm = dayTrips.reduce((s, t) => s + (t.distanceKm || 0), 0);
            const dayCost = Math.round(dayTrips.reduce((s, t) => s + (t.estimatedFuelCost || 0), 0) * 100) / 100;
            for (let c = 1; c <= 5; c++) bodyCell(r, c, c === 1 ? 'የቀኑ ድምር' : null, { align: 'right', bold: true, bg: GREY });
            ws.mergeCells(r, 1, r, 5);
            bodyCell(r, 6, { formula: `SUM(F${firstRow}:F${r - 1})`, result: dayKm }, { fmt: '#,##0', bold: true, bg: GREY });
            bodyCell(r, 7, { formula: `SUM(G${firstRow}:G${r - 1})`, result: dayCost }, { fmt: '#,##0.00', bold: true, bg: GREY, align: 'right' });
            r += 2;
        }
    }

    // ---------- summary ----------
    // Start the summary on a fresh printed page when the daily tables are long.
    if (includeDetail && r > 25) ws.getRow(r - 1).addPageBreak();
    band(r, `ማጠቃለያ — ${rangeText}`, { size: 13, color: 'FFFFFFFF', bg: NAVY, height: 26 });
    r += 2;
    const useFormulas = includeDetail && rangeFirst !== null;
    const B = `$B$${rangeFirst}:$B$${rangeLast}`, D = `$D$${rangeFirst}:$D$${rangeLast}`;
    const F = `$F$${rangeFirst}:$F$${rangeLast}`, G = `$G$${rangeFirst}:$G$${rangeLast}`;

    function summaryTable(heading, nameHeader, rows, critRange) {
        band(r, heading, { size: 12, bg: LIGHT, align: 'left', border: true, height: 22, to: 5 });
        r++;
        headerRow(r, ['ተ.ቁ', nameHeader, 'የጉዞ ብዛት', 'የተጓዙት ኪ.ሜ', 'የተጠቀሙት ነዳጅ በብር']);
        r++;
        if (!rows.length) {
            band(r, 'ጉዞ አልተመዘገበም', { bold: false, italic: true, color: 'FF7F7F7F', border: true, to: 5 });
            r += 2;
            return;
        }
        const first = r;
        rows.forEach((row, i) => {
            bodyCell(r, 1, i + 1);
            bodyCell(r, 2, row.name, { align: 'left' });
            if (useFormulas) {
                bodyCell(r, 3, { formula: `COUNTIF(${critRange},B${r})`, result: row.count });
                bodyCell(r, 4, { formula: `SUMIF(${critRange},B${r},${F})`, result: row.km }, { fmt: '#,##0' });
                bodyCell(r, 5, { formula: `SUMIF(${critRange},B${r},${G})`, result: row.cost }, { fmt: '#,##0.00', align: 'right' });
            } else {
                bodyCell(r, 3, row.count);
                bodyCell(r, 4, row.km, { fmt: '#,##0' });
                bodyCell(r, 5, row.cost, { fmt: '#,##0.00', align: 'right' });
            }
            ws.getRow(r).height = 20;
            r++;
        });
        const cnt = rows.reduce((s, x) => s + x.count, 0);
        const km = rows.reduce((s, x) => s + x.km, 0);
        const cost = Math.round(rows.reduce((s, x) => s + x.cost, 0) * 100) / 100;
        bodyCell(r, 1, null, { bg: GREY });
        bodyCell(r, 2, 'ድምር', { align: 'left', bold: true, bg: GREY });
        bodyCell(r, 3, { formula: `SUM(C${first}:C${r - 1})`, result: cnt }, { bold: true, bg: GREY });
        bodyCell(r, 4, { formula: `SUM(D${first}:D${r - 1})`, result: km }, { fmt: '#,##0', bold: true, bg: GREY });
        bodyCell(r, 5, { formula: `SUM(E${first}:E${r - 1})`, result: cost }, { fmt: '#,##0.00', bold: true, bg: GREY, align: 'right' });
        ws.getRow(r).height = 20;
        r += 2;
    }

    const deptRows = fleetReportSummary(trips, deptOrder).filter(x => x.count > 0).map(x => ({ name: x.dept, count: x.count, km: x.km, cost: x.cost }));
    const vehRows = fleetReportVehicleSummary(trips).map(x => ({ name: x.type, count: x.count, km: x.km, cost: x.cost }));
    summaryTable('በዲፓርትመንት', 'ዲፓርትመንት', deptRows, B);
    summaryTable('በመኪና አይነት', 'የመኪና አይነት', vehRows, D);

    band(r, `የተዘጋጀበት ቀን፦ ${isoToEthText(dateToISO(new Date()))} ዓ.ም`, { bold: false, size: 10, color: 'FF595959', align: 'left', height: 18 });
    return wb;
}

async function loadFleetReportLogo() {
    try {
        const res = await fetch('/images/logo.png');
        if (!res.ok) return null;
        const buffer = await res.arrayBuffer();
        const b = new Uint8Array(buffer);
        // The company logo file is named .png but may really be a JPEG.
        const extension = (b[0] === 0x89 && b[1] === 0x50) ? 'png' : (b[0] === 0xFF && b[1] === 0xD8) ? 'jpeg' : null;
        return extension ? { buffer, extension } : null;
    } catch (e) {
        return null;
    }
}

async function downloadFleetReportExcel() {
    if (!fleetReportData) { alert('መጀመሪያ "ሪፖርት አውጣ" ይጫኑ'); return; }
    if (typeof ExcelJS === 'undefined') { alert('Excel ላይብረሪ አልተጫነም፤ ኢንተርኔትዎን አረጋግጠው ገጹን ያድሱና እንደገና ይሞክሩ'); return; }
    const btn = document.getElementById('freport-download-btn');
    if (btn) btn.disabled = true;
    try {
        const logo = await loadFleetReportLogo();
        const wb = buildFleetReportWorkbook(fleetReportData, logo);
        const buf = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const ethFrom = isoToEthText(fleetReportData.from).replace(/\//g, '-');
        const ethTo = isoToEthText(fleetReportData.to).replace(/\//g, '-');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `fleet_report_${ethFrom}_to_${ethTo}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (err) {
        console.error('Fleet report export error:', err);
        alert('Excel ፋይሉን ማዘጋጀት አልተቻለም');
    } finally {
        if (btn) btn.disabled = false;
    }
}


// =====================================================================
// ===== Per-user module access (which sections each person can see) =====
// =====================================================================
// The Admin ticks which modules a user may use; the sidebar then only shows
// those, and the server refuses requests to the others as well (so hiding a
// menu item is never the only protection).
const ACCESS_MODULES = [
    { key: 'dashboard', label: 'ዳሽቦርድ (Dashboard)', menu: 'menu-dash', section: 'dashboard-sec', group: 'main' },
    { key: 'payments', label: 'የክፍያዎች መዝገብ', menu: 'menu-pay', section: 'payments-sec', group: 'main' },
    { key: 'contracts', label: 'የውሎች መዝገብ', menu: 'menu-contract', section: 'contracts-sec', group: 'main' },
    { key: 'gallery', label: 'የተመዘገቡ ውሎች (ጋላሪ)', menu: 'menu-gallery', section: 'gallery-sec', group: 'main' },
    { key: 'report', label: 'የፋይናንስ ሪፖርት', menu: 'menu-report', section: 'report-sec', group: 'main' },
    { key: 'signature', label: 'የፊርማ ምዝገባ', menu: 'menu-signature', section: 'signature-sec', group: 'main' },
    { key: 'trash', label: 'ትራሽ (Trash)', menu: 'menu-trash', section: 'trash-sec', group: 'main' },
    { key: 'fleet_vehicles', label: 'ተሽከርካሪዎች', menu: 'menu-fleet-vehicles', section: 'fleet-vehicles-sec', group: 'fleet' },
    { key: 'fleet_trips', label: 'የአጠቃቀም ምዝገባ', menu: 'menu-fleet-trips', section: 'fleet-trips-sec', group: 'fleet' },
    { key: 'fleet_maintenance', label: 'ጥገና ምዝገባ', menu: 'menu-fleet-maintenance', section: 'fleet-maintenance-sec', group: 'fleet' },
    { key: 'fleet_fuel', label: 'ነዳጅ ምዝገባ', menu: 'menu-fleet-fuel', section: 'fleet-fuel-sec', group: 'fleet' },
    { key: 'fleet_report', label: 'ሳምንታዊ ሪፖርት (ፍሊት)', menu: 'menu-fleet-report', section: 'fleet-report-sec', group: 'fleet' },
    { key: 'fleet_allowance', label: 'አበል (የመስክ ስራ የውሎ አበል ጥያቄ)', menu: 'menu-fleet-allowance', section: 'fleet-allowance-sec', group: 'fleet' },
    { key: 'fleet_finance', label: 'የፍሊት ፋይናንስ ሪፖርት (በብር)', menu: 'menu-fleet-finance', section: 'fleet-finance-sec', group: 'fleet' },
    // No menu of its own: lets someone (e.g. the fleet officer) see fleet entries made by OTHER people.
    { key: 'fleet_view_all', label: 'ሌሎች የመዘገቡትን የፍሊት ምዝገባዎችም ማየት (ለፍሊት ኃላፊ/ለሪፖርት አዘጋጅ)', menu: null, section: null, group: 'fleet' }
];
let usersCache = [];
// null = unrestricted (Admin, or an older session/account without a list).
let myAccess = (currentUser && Array.isArray(currentUser.access)) ? currentUser.access : null;

function canUseModule(key) {
    if (!currentUser) return false;
    if (currentUser.role === 'Admin') return true;
    if (!Array.isArray(myAccess)) return true;
    return myAccess.includes(key);
}
function canOpenSection(sectionId) {
    if (sectionId === 'users-sec') return !!currentUser && currentUser.role === 'Admin';
    const mod = ACCESS_MODULES.find(m => m.section === sectionId);
    return mod ? canUseModule(mod.key) : true;
}
// A person may delete only their own fleet entries (Admin: any).
function canDeleteEntry(item) {
    return !!currentUser && (currentUser.role === 'Admin' || (item && item.userId === currentUser.id));
}

function applyMyAccess() {
    ACCESS_MODULES.forEach(m => {
        const el = document.getElementById(m.menu);
        if (el) el.style.display = canUseModule(m.key) ? '' : 'none';
    });
    const anyFleet = ACCESS_MODULES.some(m => m.group === 'fleet' && m.menu && canUseModule(m.key));
    const fleetLabel = document.getElementById('menu-fleet-label');
    if (fleetLabel) fleetLabel.style.display = anyFleet ? '' : 'none';
    // Today's fuel price is set by whoever registers trips / fuel, not only the Admin.
    const priceBox1 = document.getElementById('fleet-fuel-price-box');
    if (priceBox1) priceBox1.style.display = canUseModule('fleet_trips') ? 'block' : 'none';
    const priceBox2 = document.getElementById('fleet-fuel-price-box-2');
    if (priceBox2) priceBox2.style.display = canUseModule('fleet_fuel') ? 'block' : 'none';

    // If the page opened on a section this person may not use (the dashboard
    // is the default landing page), move them to the first one they can.
    const activeMenu = document.querySelector('.sidebar-item.active');
    const activeMod = activeMenu ? ACCESS_MODULES.find(m => m.menu === activeMenu.id) : null;
    if (activeMod && !canUseModule(activeMod.key)) {
        const first = ACCESS_MODULES.find(m => m.section && canUseModule(m.key));
        if (first) {
            showSection(first.section, first.menu);
        } else {
            document.querySelectorAll('.page-section').forEach(sec => sec.style.display = 'none');
            document.querySelectorAll('.sidebar-item').forEach(item => item.classList.remove('active'));
            const notice = document.getElementById('no-access-notice');
            if (notice) notice.style.display = 'block';
        }
    }
}

// Ask the server for the CURRENT list, so a change the Admin just made applies
// at the next page load instead of waiting for the person to log in again.
async function refreshMyAccess() {
    try {
        const res = await authFetch('/api/users/me/access');
        if (!res.ok) return;
        const data = await res.json();
        if (!Array.isArray(data.access)) return;
        myAccess = data.access;
        currentUser.access = data.access;
        sessionStorage.setItem('user', JSON.stringify(currentUser));
        applyMyAccess();
    } catch (err) { /* keep whatever the login gave us */ }
}

function renderAccessCheckboxes(containerId, selectedKeys, cls) {
    const box = document.getElementById(containerId);
    if (!box) return;
    const groups = [
        { id: 'main', title: 'ዋና ክፍሎች' },
        { id: 'fleet', title: 'ፍሊት ማኔጅመንት' }
    ];
    box.innerHTML = groups.map(g => `
        <div style="margin:8px 0 4px; font-size:12px; color:#a0aec0; font-weight:bold;">${g.title}</div>
        ${ACCESS_MODULES.filter(m => m.group === g.id).map(m => `
            <label style="display:flex; align-items:center; gap:8px; font-weight:normal; margin-bottom:5px;">
                <input type="checkbox" class="${cls}" value="${m.key}" style="width:auto; margin:0;" ${selectedKeys.includes(m.key) ? 'checked' : ''}> ${m.label}
            </label>`).join('')}
    `).join('');
}
function setAccessChecks(cls, checked) {
    document.querySelectorAll('.' + cls).forEach(cb => { cb.checked = checked; });
}

function accessCellHtml(u) {
    if (u.role === 'Admin') return '<span style="font-size:11px; color:#a0aec0;">ሁሉም (Admin)</span>';
    let summary;
    if (!Array.isArray(u.access)) summary = 'ሁሉም (ያልተገደበ)';
    else if (!u.access.length) summary = '<span style="color:#f6ad55;">ምንም አልተሰጠም</span>';
    else summary = `${u.access.length} ከ ${ACCESS_MODULES.length} ክፍሎች`;
    return `<div style="font-size:11px; margin-bottom:4px;">${summary}</div>
        <button class="btn-submit" style="padding:4px 8px; font-size:11px;" onclick="openAccessModal('${u._id}')"><i class="fas fa-user-lock"></i> አስተካክል</button>`;
}

let accessModalUserId = null;
function openAccessModal(userId) {
    const u = usersCache.find(x => x._id === userId);
    if (!u) return;
    accessModalUserId = userId;
    document.getElementById('access-modal-title').innerText = `የሚያያቸው ክፍሎች — ${u.fullName || u.username}`;
    // An account with no list yet currently sees everything, so start with all ticked.
    const selected = Array.isArray(u.access) ? u.access : ACCESS_MODULES.filter(m => m.key !== 'fleet_view_all').map(m => m.key);
    renderAccessCheckboxes('access-modal-box', selected, 'modal-access-cb');
    document.getElementById('access-modal').style.display = 'flex';
}
function closeAccessModal() {
    document.getElementById('access-modal').style.display = 'none';
    accessModalUserId = null;
}
async function saveAccessModal() {
    if (!accessModalUserId) return;
    const access = Array.from(document.querySelectorAll('.modal-access-cb:checked')).map(cb => cb.value);
    try {
        const res = await authFetch(`/api/users/access/${accessModalUserId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ access })
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'ማስቀመጥ አልተቻለም'); return; }
        closeAccessModal();
        fetchUsersList();
        alert('የመዳረሻ ፈቃዱ ተቀምጧል። ተጠቃሚው ገጹን ሲያድስ ይተገበራል።');
    } catch (err) {
        alert('ማስቀመጥ አልተቻለም');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initEthDatePickers();
    const tripDateEl = document.getElementById('trip-date');
    if (tripDateEl) tripDateEl.addEventListener('change', () => { if (!tripEditId) tripWorkingDate = tripDateEl.value; });
    const fuelDateEl = document.getElementById('fuel-date');
    if (fuelDateEl) fuelDateEl.addEventListener('change', () => { if (!fuelEditId) fuelWorkingDate = fuelDateEl.value; });
    applyMyAccess();
    refreshMyAccess();
    if (currentUser && currentUser.role === 'Admin') renderAccessCheckboxes('reg-access-box', [], 'reg-access-cb');
});


// =====================================================================
// ===== Fleet FINANCE report (የፍሊት ፋይናንስ ሪፖርት) — everything in birr =====
// =====================================================================
// Combines, for a chosen period: fuel actually bought (receipts), maintenance
// cost, and — for comparison — the estimated fuel cost of the recorded trips.
// The "total cost" is receipts + maintenance only (the trip estimate would
// count the same fuel twice). Allowances (አበል) will be added here too.
let fleetFinanceData = null;

function initFleetFinanceSection() {
    const fromEl = document.getElementById('ffin-from');
    const toEl = document.getElementById('ffin-to');
    if (fromEl && toEl && (!fromEl.value || !toEl.value)) setFleetFinancePreset(30);
    else updateFleetFinanceEthLabel();
}
function setFleetFinancePreset(days) {
    const to = dateToISO(new Date());
    document.getElementById('ffin-to').value = to;
    document.getElementById('ffin-from').value = addDaysISO(to, -(days - 1));
    updateFleetFinanceEthLabel();
}
function updateFleetFinanceEthLabel() {
    const from = document.getElementById('ffin-from').value;
    const to = document.getElementById('ffin-to').value;
    const label = document.getElementById('ffin-eth-label');
    if (!label) return;
    label.textContent = (from && to) ? `ከ ${isoToEthText(from)} እስከ ${isoToEthText(to)} (ዓ.ም) — ${daysBetweenISO(from, to)} ቀን` : '';
}

function fleetMaintStatusText(m) {
    if (m.approvedBy && m.approvedBy.userId) return 'ተጸድቋል';
    if (m.approval && m.approval.pendingApproverId) return 'ለማጽደቅ ተልኳል';
    if (m.preparedBy && m.preparedBy.userId) return 'ተፈርሟል';
    return 'ያልተፈረመ';
}

function fleetFinanceModel(d) {
    const round2 = n => Math.round(n * 100) / 100;
    const vehicleKey = x => `${String(x.vehiclePlate || '').trim()} (${fleetVehicleLabel(x)})`;
    const vMap = new Map();
    const vget = x => {
        const k = vehicleKey(x);
        if (!vMap.has(k)) vMap.set(k, { label: k, trips: 0, km: 0, est: 0, liters: 0, fuelCost: 0, maintCost: 0 });
        return vMap.get(k);
    };
    d.trips.forEach(t => { const v = vget(t); v.trips += 1; v.km += t.distanceKm || 0; v.est += t.estimatedFuelCost || 0; });
    d.fuel.forEach(f => { const v = vget(f); v.liters += f.liters || 0; v.fuelCost += f.cost || 0; });
    d.maint.forEach(x => { const v = vget(x); v.maintCost += x.cost || 0; });
    const vehicles = Array.from(vMap.values()).map(v => ({
        label: v.label, trips: v.trips, km: v.km, est: round2(v.est), liters: round2(v.liters),
        fuelCost: round2(v.fuelCost), maintCost: round2(v.maintCost), total: round2(v.fuelCost + v.maintCost)
    })).sort((a, b) => (b.total - a.total) || (b.km - a.km));

    const dMap = new Map();
    d.trips.forEach(t => {
        const k = String(t.department || '').trim() || 'ያልታወቀ';
        if (!dMap.has(k)) dMap.set(k, { name: k, trips: 0, km: 0, est: 0 });
        const r = dMap.get(k);
        r.trips += 1; r.km += t.distanceKm || 0; r.est += t.estimatedFuelCost || 0;
    });
    const depts = Array.from(dMap.values()).map(r => ({ name: r.name, trips: r.trips, km: r.km, est: round2(r.est) }))
        .sort((a, b) => b.est - a.est);

    const fuelCost = round2(d.fuel.reduce((s, f) => s + (f.cost || 0), 0));
    const maintCost = round2(d.maint.reduce((s, x) => s + (x.cost || 0), 0));
    const est = round2(d.trips.reduce((s, t) => s + (t.estimatedFuelCost || 0), 0));
    // Every allowance request counts as an expense, approved or not (the status is shown
    // beside it). Only the allowance + transport parts are added: the fuel part of the
    // request is already covered by the fuel receipts.
    const isApproved = x => !!(x.approver && x.approver.userId);
    const alOf = x => (x.costAllowance || 0) + (x.costTransport || 0);
    const approvedAl = (d.allowances || []).filter(isApproved);
    const pendingAl = (d.allowances || []).filter(x => !isApproved(x));
    const allowanceCost = round2((d.allowances || []).reduce((sum, x) => sum + alOf(x), 0));
    const allowancePending = round2(pendingAl.reduce((sum, x) => sum + alOf(x), 0));
    return {
        vehicles, depts, fuelCost, maintCost, allowanceCost,
        allowanceCount: (d.allowances || []).length, allowanceApprovedCount: approvedAl.length, allowancePendingCount: pendingAl.length, allowancePending,
        total: round2(fuelCost + maintCost + allowanceCost), est
    };
}

async function generateFleetFinance() {
    const from = document.getElementById('ffin-from').value;
    const to = document.getElementById('ffin-to').value;
    if (!from || !to) { alert('እባክዎ ከቀን እና እስከ ቀን ይምረጡ'); return; }
    if (from > to) { alert('"ከቀን" ከ"እስከ ቀን" መቅደም አለበት'); return; }
    if (daysBetweenISO(from, to) > 366) { alert('ከአንድ ዓመት በላይ መምረጥ አይቻልም'); return; }
    const q = `?from=${from}&to=${to}`;
    try {
        const [trRes, fuRes, maRes, alRes] = await Promise.all([
            authFetch('/api/fleet/trips' + q),
            authFetch('/api/fleet/fuel-logs' + q),
            authFetch('/api/fleet/maintenance' + q),
            authFetch('/api/fleet/allowance' + q)
        ]);
        const [tr, fu, ma, al] = await Promise.all([trRes.json(), fuRes.json(), maRes.json(), alRes.json()]);
        const failed = [[trRes, tr], [fuRes, fu], [maRes, ma], [alRes, al]].find(p => !p[0].ok);
        if (failed) { alert((failed[1] && failed[1].error) || 'ሪፖርቱን ማምጣት አልተቻለም'); return; }
        fleetFinanceData = {
            from, to,
            trips: Array.isArray(tr) ? tr : [],
            fuel: Array.isArray(fu) ? fu : [],
            maint: Array.isArray(ma) ? ma : [],
            allowances: Array.isArray(al) ? al : []
        };
        renderFleetFinancePreview();
        document.getElementById('ffin-download-btn').disabled = false;
    } catch (err) {
        alert('ሪፖርቱን ማምጣት አልተቻለም');
    }
}

function renderFleetFinancePreview() {
    if (!fleetFinanceData) return;
    const d = fleetFinanceData;
    const m = fleetFinanceModel(d);
    const money = n => (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const num = n => (n || 0).toLocaleString('en-US');
    const empty = cols => `<tr><td colspan="${cols}" style="text-align:center; color:#a0aec0;">በዚህ ጊዜ ምንም ምዝገባ የለም</td></tr>`;

    document.getElementById('ffin-result').style.display = 'block';
    document.getElementById('ffin-title').innerHTML = `<i class="fas fa-coins"></i> ማጠቃለያ — ከቀን ${fleetEsc(isoToEthText(d.from))} እስከ ${fleetEsc(isoToEthText(d.to))}`;
    document.getElementById('ffin-summary-list').innerHTML = `
        <tr><td>1</td><td>የነዳጅ ግዢ (በደረሰኝ፣ ${num(d.fuel.length)} ምዝገባ)</td><td>${money(m.fuelCost)}</td></tr>
        <tr><td>2</td><td>የጥገና ወጪ (${num(d.maint.length)} ምዝገባ)</td><td>${money(m.maintCost)}</td></tr>
        <tr><td>3</td><td>አበል እና ትራንስፖርት (${num(m.allowanceCount)} ጥያቄ)</td><td>${money(m.allowanceCost)}</td></tr>
        <tr style="font-weight:bold;"><td></td><td>ጠቅላላ ወጪ</td><td>${money(m.total)}</td></tr>
        ${m.allowancePendingCount ? `<tr style="color:#d69e2e;"><td></td><td>ከአበሉ ውስጥ ገና ያልጸደቁ (${num(m.allowancePendingCount)}) — በጠቅላላው ተካተዋል</td><td>${money(m.allowancePending)}</td></tr>` : ''}
        <tr style="color:#a0aec0;"><td></td><td>ግምታዊ የነዳጅ ወጪ ከጉዞ ምዝገባ (ለንጽጽር ብቻ፣ በጠቅላላው ውስጥ አልተካተተም)</td><td>${money(m.est)}</td></tr>`;
    document.getElementById('ffin-vehicle-list').innerHTML = m.vehicles.length ? m.vehicles.map((v, i) => `
        <tr>
            <td>${i + 1}</td><td>${fleetEsc(v.label)}</td><td>${num(v.trips)}</td><td>${num(v.km)}</td>
            <td>${money(v.est)}</td><td>${num(v.liters)}</td><td>${money(v.fuelCost)}</td><td>${money(v.maintCost)}</td>
            <td><strong>${money(v.total)}</strong></td>
        </tr>`).join('') : empty(9);
    document.getElementById('ffin-dept-list').innerHTML = m.depts.length ? m.depts.map((r, i) => `
        <tr><td>${i + 1}</td><td>${fleetEsc(r.name)}</td><td>${num(r.trips)}</td><td>${num(r.km)}</td><td>${money(r.est)}</td></tr>`).join('') : empty(5);
}

// ---- shared Excel look for the finance sheet ----
function makeFleetXlKit(ws, cols) {
    const NAVY = 'FF1F4E78', LIGHT = 'FFDCE6F1', GREY = 'FFF2F2F2';
    const side = { style: 'thin', color: { argb: 'FF7F7F7F' } };
    const BORDER = { top: side, left: side, bottom: side, right: side };
    const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
    function band(rowNum, text, opts) {
        const o = Object.assign({ from: 1, to: cols, size: 11, bold: true, color: 'FF000000', bg: null, align: 'center', border: false, italic: false, height: null }, opts || {});
        for (let c = o.from; c <= o.to; c++) {
            const cell = ws.getCell(rowNum, c);
            cell.font = { name: 'Calibri', size: o.size, bold: o.bold, italic: o.italic, color: { argb: o.color } };
            cell.alignment = { horizontal: o.align, vertical: 'middle', wrapText: true };
            if (o.bg) cell.fill = fill(o.bg);
            if (o.border) cell.border = BORDER;
        }
        ws.getCell(rowNum, o.from).value = text;
        if (o.to > o.from) ws.mergeCells(rowNum, o.from, rowNum, o.to);
        if (o.height) ws.getRow(rowNum).height = o.height;
    }
    function headerRow(rowNum, labels) {
        labels.forEach((text, i) => {
            const cell = ws.getCell(rowNum, i + 1);
            cell.value = text;
            cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = fill(NAVY);
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            cell.border = BORDER;
        });
        ws.getRow(rowNum).height = 26;
    }
    function bodyCell(rowNum, col, value, opts) {
        const o = Object.assign({ align: 'center', fmt: null, bold: false, bg: null }, opts || {});
        const cell = ws.getCell(rowNum, col);
        cell.value = value;
        cell.font = { name: 'Calibri', size: 11, bold: o.bold };
        cell.alignment = { horizontal: o.align, vertical: 'middle', wrapText: true };
        cell.border = BORDER;
        if (o.fmt) cell.numFmt = o.fmt;
        if (o.bg) cell.fill = fill(o.bg);
        return cell;
    }
    return { NAVY, LIGHT, GREY, band, headerRow, bodyCell };
}

// Writes a bordered table starting at row r; returns the next free row.
// specs: per-column { align, fmt }; sums: { labelCol, label, cols: [..] } adds a total row of SUM formulas;
// rowFormulas: { col: (rowNumber, rowArray) => ({ formula, result }) } for computed columns.
function writeFleetXlTable(ws, kit, r, headers, rows, specs, sums, rowFormulas) {
    const L = 'ABCDEFGHIJ';
    kit.headerRow(r, headers);
    r += 1;
    if (!rows.length) {
        kit.band(r, 'በዚህ ጊዜ ምንም ምዝገባ የለም', { to: headers.length, bold: false, italic: true, color: 'FF7F7F7F', border: true, height: 20 });
        return r + 2;
    }
    const first = r;
    rows.forEach(row => {
        row.forEach((v, i) => {
            let value = v;
            if (rowFormulas && rowFormulas[i + 1]) value = rowFormulas[i + 1](r, row);
            kit.bodyCell(r, i + 1, value, specs[i] || {});
        });
        r += 1;
    });
    const last = r - 1;
    if (sums) {
        for (let c = 1; c <= headers.length; c++) kit.bodyCell(r, c, null, { bg: kit.GREY });
        kit.bodyCell(r, sums.labelCol, sums.label || 'ድምር', { align: 'left', bold: true, bg: kit.GREY });
        sums.cols.forEach(c => {
            const result = rows.reduce((s, row) => {
                const cellVal = (rowFormulas && rowFormulas[c]) ? rowFormulas[c](0, row).result : row[c - 1];
                return s + (Number(cellVal) || 0);
            }, 0);
            kit.bodyCell(r, c, { formula: `SUM(${L[c - 1]}${first}:${L[c - 1]}${last})`, result }, Object.assign({}, specs[c - 1] || {}, { bold: true, bg: kit.GREY }));
        });
        r += 1;
    }
    return r + 1;
}

function buildFleetFinanceWorkbook(data, logo) {
    const m = fleetFinanceModel(data);
    const ethFrom = isoToEthText(data.from), ethTo = isoToEthText(data.to);
    const rangeText = `ከ ${ethFrom} እስከ ${ethTo} ዓ.ም`;
    const COLS = 9;
    const MONEY = '#,##0.00', INT = '#,##0';

    const wb = new ExcelJS.Workbook();
    wb.creator = FLEET_REPORT_ORG_NAME;
    const ws = wb.addWorksheet('ፋይናንስ ሪፖርት', {
        pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
            margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
        views: [{ showGridLines: false }]
    });
    ws.columns = [{ width: 7 }, { width: 28 }, { width: 22 }, { width: 20 }, { width: 18 }, { width: 26 }, { width: 18 }, { width: 18 }, { width: 20 }];
    const kit = makeFleetXlKit(ws, COLS);

    // letterhead
    kit.band(1, FLEET_REPORT_ORG_NAME, { from: 2, size: 20, color: kit.NAVY, height: 32 });
    kit.band(2, FLEET_REPORT_ORG_SUB, { from: 2, size: 13, color: 'FF595959', height: 22 });
    kit.band(3, 'የፍሊት ፋይናንስ ሪፖርት (በብር)', { size: 15, color: 'FFFFFFFF', bg: kit.NAVY, height: 28 });
    kit.band(4, rangeText, { size: 12, bg: kit.LIGHT, border: true, height: 22 });
    ws.getRow(5).height = 8;
    if (logo) {
        const imgId = wb.addImage({ buffer: logo.buffer, extension: logo.extension });
        ws.addImage(imgId, { tl: { col: 0.12, row: 0.1 }, ext: { width: 62, height: 62 } });
    }

    let r = 6;
    const section = title => { kit.band(r, title, { size: 12, bg: kit.LIGHT, align: 'left', border: true, height: 22 }); r += 1; };

    // 1) summary
    section('ማጠቃለያ');
    r = writeFleetXlTable(ws, kit, r, ['ተ.ቁ', 'የወጪ አይነት', 'መጠን (ብር)'], [
        [1, 'የነዳጅ ግዢ ', m.fuelCost],
        [2, 'የጥገና ወጪ', m.maintCost],
        [3, 'አበል እና ትራንስፖርት', m.allowanceCost]
    ], [{}, { align: 'left' }, { fmt: MONEY, align: 'right' }], { labelCol: 2, label: 'ጠቅላላ ወጪ', cols: [3] });
    r -= 1;
    kit.band(r, `ማስታወሻ፦ ግምታዊ የነዳጅ ወጪ ከጉዞ ምዝገባ (ለንጽጽር ብቻ፣ በጠቅላላው ውስጥ አልተካተተም)፦ ${m.est.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ብር`,
        { to: COLS, bold: false, italic: true, size: 10, color: 'FF595959', align: 'left', height: 20 });
    r += 1;
    if (m.allowancePendingCount > 0) {
        kit.band(r, `ማስታወሻ፦ በአበሉ ድምር ውስጥ ገና ያልጸደቁ ${m.allowancePendingCount} ጥያቄዎች (${m.allowancePending.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ብር) ተካተዋል`,
            { to: COLS, bold: false, italic: true, size: 10, color: 'FF595959', align: 'left', height: 20 });
        r += 1;
    }
    r += 1;

    // 2) by vehicle
    section('በተሽከርካሪ');
    r = writeFleetXlTable(ws, kit, r,
        ['ተ.ቁ', 'ተሽከርካሪ', 'የጉዞ ብዛት', 'የተጓዙት ኪ.ሜ', 'ግምታዊ ነዳጅ (ብር)', 'የገዙት ነዳጅ (ሊትር)', 'የነዳጅ ግዢ (ብር)', 'የጥገና (ብር)', 'ጠቅላላ ወጪ (ብር)'],
        m.vehicles.map((v, i) => [i + 1, v.label, v.trips, v.km, v.est, v.liters, v.fuelCost, v.maintCost, v.total]),
        [{}, { align: 'left' }, { fmt: INT }, { fmt: INT }, { fmt: MONEY, align: 'right' }, { fmt: MONEY, align: 'right' }, { fmt: MONEY, align: 'right' }, { fmt: MONEY, align: 'right' }, { fmt: MONEY, align: 'right' }],
        { labelCol: 2, label: 'ድምር', cols: [3, 4, 5, 6, 7, 8, 9] },
        { 9: (row, arr) => ({ formula: `G${row}+H${row}`, result: Math.round(((arr[6] || 0) + (arr[7] || 0)) * 100) / 100 }) });

    // 3) by department (from trips)
    section('በዲፓርትመንት (ከጉዞ ምዝገባ፣ ግምታዊ ነዳጅ)');
    r = writeFleetXlTable(ws, kit, r, ['ተ.ቁ', 'ዲፓርትመንት', 'የጉዞ ብዛት', 'የተጓዙት ኪ.ሜ', 'ግምታዊ ነዳጅ (ብር)'],
        m.depts.map((x, i) => [i + 1, x.name, x.trips, x.km, x.est]),
        [{}, { align: 'left' }, { fmt: INT }, { fmt: INT }, { fmt: MONEY, align: 'right' }],
        { labelCol: 2, label: 'ድምር', cols: [3, 4, 5] });

    // 4) fuel purchases (detail)
    section('የነዳጅ ግዢ ዝርዝር (በደረሰኝ)');
    const fuelSorted = data.fuel.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    r = writeFleetXlTable(ws, kit, r, ['ተ.ቁ', 'ቀን', 'ተሽከርካሪ', 'ማደያ', 'ሊትር', 'ዋጋ (ብር)', 'የኪ.ሜ ንባብ'],
        fuelSorted.map((f, i) => [i + 1, isoToEthText(f.date), `${f.vehiclePlate || ''} (${fleetVehicleLabel(f)})`, f.station || '-', f.liters || 0, f.cost || 0, f.odometerKm || 0]),
        [{}, {}, { align: 'left' }, { align: 'left' }, { fmt: MONEY, align: 'right' }, { fmt: MONEY, align: 'right' }, { fmt: INT }],
        { labelCol: 2, label: 'ድምር', cols: [5, 6] });

    // 5) maintenance (detail)
    section('የጥገና ዝርዝር');
    const typeLabels = { routine: 'መደበኛ', repair: 'ጥገና' };
    const maintSorted = data.maint.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    r = writeFleetXlTable(ws, kit, r, ['ተ.ቁ', 'ቀን', 'ተሽከርካሪ', 'ዓይነት', 'ጋራዥ/አቅራቢ', 'መግለጫ', 'ወጪ (ብር)', 'ሁኔታ'],
        maintSorted.map((x, i) => [i + 1, isoToEthText(x.date), `${x.vehiclePlate || ''} (${fleetVehicleLabel(x)})`, typeLabels[x.maintenanceType] || x.maintenanceType || '', x.garage || '-', x.description || '-', x.cost || 0, fleetMaintStatusText(x)]),
        [{}, {}, { align: 'left' }, {}, { align: 'left' }, { align: 'left' }, { fmt: MONEY, align: 'right' }, {}],
        { labelCol: 2, label: 'ድምር', cols: [7] });

    // 6) allowance requests (detail)
    section('የአበል ዝርዝር (የጸደቁትም ያልጸደቁትም በጠቅላላው ይቆጠራሉ፤ ሁኔታው በመጨረሻው አምድ ይታያል)');
    const alSorted = (data.allowances || []).slice().sort((a, b) => String(a.fromDate).localeCompare(String(b.fromDate)));
    r = writeFleetXlTable(ws, kit, r, ['ተ.ቁ', 'ሰራተኛ', 'የሄዱበት ቦታ', 'ጊዜ (ከ - እስከ)', 'ቀናት', 'ለአበል (ብር)', 'ለትራንስፖርት (ብር)', 'ሁኔታ'],
        alSorted.map((x, i) => [i + 1, x.employeeName || '', x.destination || '', `${isoToEthText(x.fromDate)} - ${isoToEthText(x.toDate)}`, x.days || 1, x.costAllowance || 0, x.costTransport || 0, allowanceStatusPlain(x)]),
        [{}, { align: 'left' }, { align: 'left' }, {}, { fmt: INT }, { fmt: MONEY, align: 'right' }, { fmt: MONEY, align: 'right' }, {}],
        { labelCol: 2, label: 'ድምር (ሁሉም ጥያቄ)', cols: [5, 6, 7] });

    kit.band(r, `የተዘጋጀበት ቀን፦ ${isoToEthText(dateToISO(new Date()))} ዓ.ም`, { bold: false, size: 10, color: 'FF595959', align: 'left', height: 18 });
    return wb;
}

async function downloadFleetFinanceExcel() {
    if (!fleetFinanceData) { alert('መጀመሪያ "ሪፖርት አውጣ" ይጫኑ'); return; }
    if (typeof ExcelJS === 'undefined') { alert('Excel ላይብረሪ አልተጫነም፤ ኢንተርኔትዎን አረጋግጠው ገጹን ያድሱና እንደገና ይሞክሩ'); return; }
    const btn = document.getElementById('ffin-download-btn');
    if (btn) btn.disabled = true;
    try {
        const logo = await loadFleetReportLogo();
        const wb = buildFleetFinanceWorkbook(fleetFinanceData, logo);
        const buf = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `fleet_finance_${isoToEthText(fleetFinanceData.from).replace(/\//g, '-')}_to_${isoToEthText(fleetFinanceData.to).replace(/\//g, '-')}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (err) {
        console.error('Fleet finance export error:', err);
        alert('Excel ፋይሉን ማዘጋጀት አልተቻለም');
    } finally {
        if (btn) btn.disabled = false;
    }
}


// =====================================================================
// ===== Ethiopian-calendar date picker =====
// =====================================================================
// Browsers can only show a Gregorian calendar in <input type="date">, so people
// had to convert every date in their head (and a day is easy to lose when doing
// that). Inside the fleet module each date box is replaced by three drop-downs
// (day / month / year) in the Ethiopian calendar. The original <input> stays in
// the page, hidden, and keeps holding the Gregorian date (YYYY-MM-DD), so all the
// existing code, the database and the reports keep working unchanged.
const ETH_MONTHS = ['መስከረም', 'ጥቅምት', 'ኅዳር', 'ታኅሣሥ', 'ጥር', 'የካቲት', 'መጋቢት', 'ሚያዝያ', 'ግንቦት', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉሜን'];

function ethiopianToGregorian(ey, em, ed) {
    const jdn = 1723856 + 365 + 365 * (ey - 1) + Math.floor(ey / 4) + 30 * em + ed - 31;
    const f = jdn + 1401 + Math.floor(Math.floor((4 * jdn + 274277) / 146097) * 3 / 4) - 38;
    const e = 4 * f + 3;
    const g = Math.floor((e % 1461) / 4);
    const h = 5 * g + 2;
    const d = Math.floor((h % 153) / 5) + 1;
    const m = ((Math.floor(h / 153) + 2) % 12) + 1;
    const y = Math.floor(e / 1461) - 4716 + Math.floor((12 + 2 - m) / 12);
    return { y, m, d };
}
function ethDaysInMonth(ey, em) {
    return em < 13 ? 30 : (((ey + 1) % 4 === 0) ? 6 : 5);
}
function isoToEthParts(iso) {
    const p = String(iso).split('-').map(Number);
    return gregorianToEthiopian(p[0], p[1], p[2]);
}
function ethPartsToIso(ey, em, ed) {
    const g = ethiopianToGregorian(ey, em, ed);
    return `${g.y}-${String(g.m).padStart(2, '0')}-${String(g.d).padStart(2, '0')}`;
}

function enhanceEthDateInput(input) {
    if (!input || input.dataset.ethEnhanced) return;
    input.dataset.ethEnhanced = '1';
    const wasRequired = input.required;
    input.required = false;            // a hidden required field would silently block form submit
    input.style.display = 'none';

    const wrap = document.createElement('div');
    wrap.className = 'eth-date-picker';
    wrap.style.cssText = 'display:flex; gap:6px; align-items:center;';
    const dSel = document.createElement('select');
    const mSel = document.createElement('select');
    const ySel = document.createElement('select');
    [dSel, mSel, ySel].forEach(sel => { sel.required = wasRequired; sel.style.flex = '1'; sel.style.minWidth = '0'; });
    dSel.title = 'ቀን'; mSel.title = 'ወር'; ySel.title = 'ዓመተ ምህረት';
    wrap.appendChild(dSel); wrap.appendChild(mSel); wrap.appendChild(ySel);
    input.parentNode.insertBefore(wrap, input.nextSibling);

    const nativeDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    const nativeGet = () => nativeDesc.get.call(input);
    const nativeSet = v => nativeDesc.set.call(input, v);

    const thisEthYear = isoToEthParts(dateToISO(new Date())).y;
    function option(value, label) { const o = document.createElement('option'); o.value = value; o.textContent = label; return o; }
    function fillYears(selected) {
        ySel.innerHTML = '';
        ySel.appendChild(option('', 'ዓ.ም'));
        let from = thisEthYear - 8, to = thisEthYear + 2;
        if (selected && selected < from) from = selected;
        if (selected && selected > to) to = selected;
        for (let y = to; y >= from; y--) ySel.appendChild(option(String(y), String(y)));
    }
    function fillMonths() {
        mSel.innerHTML = '';
        mSel.appendChild(option('', 'ወር'));
        ETH_MONTHS.forEach((name, i) => mSel.appendChild(option(String(i + 1), name)));
    }
    function fillDays(count, selected) {
        dSel.innerHTML = '';
        dSel.appendChild(option('', 'ቀን'));
        for (let d = 1; d <= count; d++) dSel.appendChild(option(String(d), String(d)));
        if (selected && selected <= count) dSel.value = String(selected);
    }
    function syncFromInput() {
        const v = nativeGet();
        if (!v) {
            fillYears(null);
            fillDays(30, null);
            mSel.value = ''; ySel.value = ''; dSel.value = '';
            return;
        }
        const e = isoToEthParts(v);
        fillYears(e.y);
        mSel.value = String(e.m);
        ySel.value = String(e.y);
        fillDays(ethDaysInMonth(e.y, e.m), e.d);
    }
    function pushToInput() {
        const y = Number(ySel.value), m = Number(mSel.value), d = Number(dSel.value);
        nativeSet(y && m && d ? ethPartsToIso(y, m, d) : '');
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function adjustDays() {
        const y = Number(ySel.value) || thisEthYear, m = Number(mSel.value) || 1;
        fillDays(ethDaysInMonth(y, m), Number(dSel.value));
    }
    mSel.addEventListener('change', () => { adjustDays(); pushToInput(); });
    ySel.addEventListener('change', () => { adjustDays(); pushToInput(); });
    dSel.addEventListener('change', pushToInput);

    // Code elsewhere sets `input.value = '2026-10-12'` (edit forms, report presets):
    // keep the three drop-downs in step with it.
    Object.defineProperty(input, 'value', {
        configurable: true,
        get() { return nativeGet(); },
        set(v) { nativeSet(v); syncFromInput(); }
    });
    if (input.form) input.form.addEventListener('reset', () => setTimeout(syncFromInput, 0));

    fillMonths();
    syncFromInput();
}

function initEthDatePickers() {
    const sections = ['fleet-vehicles-sec', 'fleet-trips-sec', 'fleet-maintenance-sec', 'fleet-fuel-sec', 'fleet-report-sec', 'fleet-finance-sec', 'fleet-allowance-sec'];
    sections.forEach(id => {
        const sec = document.getElementById(id);
        if (sec) sec.querySelectorAll('input[type="date"]').forEach(enhanceEthDateInput);
    });
}

// A date as the Ethiopian date, with the Gregorian one small beside it so a
// person can always check what was stored.
function fleetDateCell(iso) {
    if (!iso) return '-';
    return `${fleetEsc(isoToEthText(iso))} <small style="color:#a0aec0;">(${fleetEsc(iso)})</small>`;
}

// Any trip / fuel / maintenance change makes an already generated report out
// of date; hide it so a stale one is never downloaded by mistake.
function invalidateFleetReports() {
    fleetReportData = null;
    fleetFinanceData = null;
    ['freport-result', 'ffin-result'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    ['freport-download-btn', 'ffin-download-btn'].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = true; });
}


// =====================================================================
// ===== Field-work allowance requests (የመስክ ስራ የውሎ አበል ጥያቄ) =====
// =====================================================================
// Same fields as the paper form. Four signatures in order (the person asking ->
// immediate supervisor -> who authorizes -> who approves); each signer picks who
// signs next. The wording below is what is printed on the form — edit it here.
const ALLOWANCE_SLOTS = ['requester', 'supervisor', 'authorizer', 'approver'];
const ALLOWANCE_SLOT_NAMES = { requester: 'ጠያቂ', supervisor: 'የቅርብ ኃላፊ', authorizer: 'የፈቀደው', approver: 'የጸደቀው' };
const ALLOWANCE_FORM_TEXT = {
    orgAm: 'ፋውንቴን ኢንተርናሽናል ትሬዲንግ ኃ/የተ/የግ/ማ',
    orgEn: 'Fountain International Trading P.L.C',
    docNumberLabel: 'ሰነድ ቁጥር', docNumber: '12',
    issueLabel: 'Issue number', issueNumber: '01',
    pageLabel: 'ገጽ ቁጥር', pageNumber: '01',
    title: 'የመስክ ስራ የውሎ አበል ጥያቄ ማስፈቀጃና መፍቀጃ ቅጽ',
    date: 'ቀን', purpose: 'የስራ ዓላማና አጭር መግለጫ',
    period: 'የመስክ ስራው የሚፈጀው ጊዜ ከ', periodTo: 'እስከ',
    destination: 'ለመስክ ስራው የሚሄዱበት ቦታ',
    travel: 'ጉዞው የሚከናወነው', travelOffice: 'በመ/ቤት ተሽከርካሪ', travelPublic: 'በህዝብ ማመላለሻ', travelAir: 'በአውሮፕላን',
    salary: 'የደመወዝ መጠን', daily: 'የቀን አበል',
    costs: 'ለመስክ ስራ የሚያስፈልገው የወጪ ግምት', costFuel: 'ለነዳጅ ብር', costAllowance: 'ለአበል ብር', costTransport: 'ለትራንስፖርት', costTotal: 'ድምር',
    remarks: 'አስተያየት (ካለ)', employee: 'የጠየቀው ሰራተኛ ስም',
    sigRequester: 'ፊርማ', sigSupervisor: 'የቅርብ ኃላፊ ፊርማ', sigAuthorizer: 'የፈቀደው ፊርማ', sigApprover: 'የጸደቀው ፊርማ'
};

let fleetAllowances = [];
let allowanceEditId = null;

async function fetchAllowances(append) {
    try {
        const page = await fleetLoadPage('/api/fleet/allowance', fleetAllowances.length, append);
        if (!page) return;
        fleetAllowances = append ? fleetMergeUnique(fleetAllowances, page.items) : page.items;
        allowanceTotal = page.total;
        renderAllowanceList();
    } catch (err) {
        console.log('የአበል ጥያቄዎችን ማምጣት አልተቻለም');
    }
}

function setAllowanceDefaults() {
    const dateEl = document.getElementById('alw-date');
    if (dateEl && !dateEl.value) dateEl.value = dateToISO(new Date());
    const empEl = document.getElementById('alw-employee');
    if (empEl && !empEl.value && currentUser) empEl.value = currentUser.fullName || currentUser.username || '';
}
function initAllowanceSection() {
    fetchAllowances();
    if (!allowanceEditId) setAllowanceDefaults();
    updateAllowanceTotals(!!allowanceEditId);
}

// days = inclusive number of days; the allowance amount follows daily x days
// until someone types it by hand; total = fuel + allowance + transport.
function updateAllowanceTotals(keepStoredAllowance) {
    const from = document.getElementById('alw-from').value;
    const to = document.getElementById('alw-to').value;
    const daysEl = document.getElementById('alw-days');
    const days = (from && to && to >= from) ? daysBetweenISO(from, to) : 0;
    if (daysEl) daysEl.value = days ? `${days} ቀን` : '';
    // ለአበል = የቀን አበል x ቀናት, recomputed EVERY time the daily amount or either date
    // changes. When one of them is missing the box is emptied instead of keeping an
    // old number. (Only when an existing request is first opened for editing is its
    // saved amount shown untouched, until the daily amount or a date is changed.)
    if (!keepStoredAllowance) {
        const daily = getAmountValue('alw-daily');
        if (days && !isNaN(daily)) setAmountValue('alw-cost-allowance', Math.round(daily * days * 100) / 100);
        else setAmountValue('alw-cost-allowance', '');
    }
    const sum = ['alw-cost-fuel', 'alw-cost-allowance', 'alw-cost-transport'].reduce((s, id) => { const v = getAmountValue(id); return s + (isNaN(v) ? 0 : v); }, 0);
    setAmountValue('alw-total', Math.round(sum * 100) / 100);
}

function allowanceStatusText(item) {
    if (item.approver && item.approver.userId) return { text: 'ተጸድቋል', color: '#68d391' };
    if (item.pending && item.pending.userId) return { text: `${fleetEsc(item.pending.name || '')} እየጠበቀ`, color: '#d69e2e' };
    if (item.requester && item.requester.userId) return { text: 'ተፈርሟል', color: '#d69e2e' };
    return { text: 'ያልተፈረመ', color: '#a0aec0' };
}
function canEditAllowance(item) {
    if (!currentUser) return false;
    if (currentUser.role === 'Admin') return true;
    return item.userId === currentUser.id && !(item.approver && item.approver.userId);
}

function allowanceSignCellHtml(item, slot) {
    const person = item[slot];
    if (person && person.userId) {
        return `<span style="font-size:12px; color:#68d391;"><i class="fas fa-check-circle"></i> ${fleetEsc(person.fullName)}</span>`;
    }
    const idx = ALLOWANCE_SLOTS.indexOf(slot);
    const prev = idx === 0 ? true : !!(item[ALLOWANCE_SLOTS[idx - 1]] && item[ALLOWANCE_SLOTS[idx - 1]].userId);
    if (!prev) return `<span style="color:#718096;">—</span>`;
    const isAdmin = !!currentUser && currentUser.role === 'Admin';
    const btn = extra => `<button class="btn-submit no-print" style="padding:5px 9px; font-size:11.5px;" onclick="promptAndSign('${item._id}', '${slot}', 'allowance')"><i class="fas fa-signature"></i> ፈርም${extra}</button>`;
    const note = html => `<span class="no-print" style="font-size:11px; color:#d69e2e;">${html}</span>`;
    if (slot === 'requester') {
        return (isAdmin || (currentUser && item.userId === currentUser.id)) ? btn('') : note('ገና አልተፈረመም');
    }
    if (item.pending && item.pending.userId) {
        const mine = !!currentUser && item.pending.userId === currentUser.id;
        if (mine || isAdmin) return btn(mine ? '' : ' (Admin)');
        return note(`<i class="fas fa-hourglass-half"></i> ${fleetEsc(item.pending.name || '')} እየጠበቀ`);
    }
    return note('ገና አልተላከም');
}

function loadMoreAllowances() { fetchAllowances(true); }

function renderAllowanceList() {
    renderMoreBox('alw-more-box', fleetAllowances.length, allowanceTotal, 'loadMoreAllowances');
    const tbody = document.getElementById('alw-data-list');
    if (!tbody) return;
    if (!fleetAllowances.length) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; color:#a0aec0;">ምንም የአበል ጥያቄ የለም</td></tr>`;
        return;
    }
    tbody.innerHTML = fleetAllowances.map(a => {
        const st = allowanceStatusText(a);
        return `
        <tr>
            <td>${fleetDateCell(a.requestDate)}</td>
            <td>${fleetEsc(a.employeeName)}</td>
            <td>${fleetEsc(a.destination)}</td>
            <td>${fleetEsc(isoToEthText(a.fromDate))} – ${fleetEsc(isoToEthText(a.toDate))}<br><small style="color:#a0aec0;">${a.days || 1} ቀን</small></td>
            <td>${(a.total || 0).toLocaleString('en-US')} ብር</td>
            <td>${allowanceSignCellHtml(a, 'requester')}</td>
            <td>${allowanceSignCellHtml(a, 'supervisor')}</td>
            <td>${allowanceSignCellHtml(a, 'authorizer')}</td>
            <td>${allowanceSignCellHtml(a, 'approver')}<br><small style="color:${st.color};">${st.text}</small></td>
            <td class="no-print" style="white-space:nowrap;">
                <button onclick="printAllowanceForm('${a._id}')" class="btn-submit" style="padding:4px 8px; font-size:12px; margin-right:4px;" title="ቅጹን አትም"><i class="fas fa-print"></i></button>${canEditAllowance(a) ? `<button onclick="startAllowanceEdit('${a._id}')" class="btn-submit" style="padding:4px 8px; font-size:12px; margin-right:4px;" title="አስተካክል"><i class="fas fa-edit"></i></button><button onclick="deleteAllowance('${a._id}')" class="btn-logout" style="padding:4px 8px; font-size:12px;" title="ሰርዝ"><i class="fas fa-trash"></i></button>` : ''}
            </td>
        </tr>`;
    }).join('');
}

function setAllowanceFormMode(editing) {
    const title = document.getElementById('alw-form-title');
    const submit = document.getElementById('alw-submit-btn');
    const cancel = document.getElementById('alw-cancel-btn');
    if (title) title.innerHTML = editing ? '<i class="fas fa-edit"></i> የአበል ጥያቄ አስተካክል' : '<i class="fas fa-hand-holding-usd"></i> የመስክ ስራ የውሎ አበል ጥያቄ';
    if (submit) submit.innerHTML = editing ? '<i class="fas fa-save"></i> ለውጡን አስቀምጥ' : '<i class="fas fa-save"></i> መዝግብ';
    if (cancel) cancel.style.display = editing ? 'inline-block' : 'none';
}

function startAllowanceEdit(id) {
    const a = fleetAllowances.find(x => x._id === id);
    if (!a) return;
    if (allowanceAnySignedClient(a)) {
        if (!confirm('ይህ ጥያቄ ፊርማ ተጀምሮበታል። ካስተካከሉት ፊርማዎቹ ሁሉ ይሰረዛሉ፤ ከመጀመሪያው እንደገና መፈረም ያስፈልጋል። ይቀጥሉ?')) return;
    }
    allowanceEditId = id;
    document.getElementById('alw-date').value = a.requestDate || '';
    document.getElementById('alw-employee').value = a.employeeName || '';
    document.getElementById('alw-purpose').value = a.purpose || '';
    document.getElementById('alw-from').value = a.fromDate || '';
    document.getElementById('alw-to').value = a.toDate || '';
    document.getElementById('alw-destination').value = a.destination || '';
    document.getElementById('alw-travel-office').checked = (a.travelBy || []).includes('office_vehicle');
    document.getElementById('alw-travel-public').checked = (a.travelBy || []).includes('public_transport');
    document.getElementById('alw-travel-air').checked = (a.travelBy || []).includes('airplane');
    setAmountValue('alw-salary', a.salary || '');
    setAmountValue('alw-daily', a.dailyAllowance || '');
    setAmountValue('alw-cost-fuel', a.costFuel || '');
    setAmountValue('alw-cost-allowance', a.costAllowance || 0);
    setAmountValue('alw-cost-transport', a.costTransport || '');
    document.getElementById('alw-remarks').value = a.remarks || '';
    updateAllowanceTotals(true);
    setAllowanceFormMode(true);
    document.getElementById('allowance-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function allowanceAnySignedClient(a) {
    return ALLOWANCE_SLOTS.some(sl => a[sl] && a[sl].userId) || !!(a.pending && a.pending.userId);
}

function cancelAllowanceEdit() {
    allowanceEditId = null;
    document.getElementById('allowance-form').reset();
    setAllowanceFormMode(false);
    setAllowanceDefaults();
    updateAllowanceTotals();
}

async function handleAllowanceSubmit(e) {
    e.preventDefault();
    const travelBy = [];
    if (document.getElementById('alw-travel-office').checked) travelBy.push('office_vehicle');
    if (document.getElementById('alw-travel-public').checked) travelBy.push('public_transport');
    if (document.getElementById('alw-travel-air').checked) travelBy.push('airplane');
    const payload = {
        requestDate: document.getElementById('alw-date').value,
        employeeName: document.getElementById('alw-employee').value.trim(),
        purpose: document.getElementById('alw-purpose').value.trim(),
        fromDate: document.getElementById('alw-from').value,
        toDate: document.getElementById('alw-to').value,
        destination: document.getElementById('alw-destination').value.trim(),
        travelBy,
        salary: getAmountValue('alw-salary') || 0,
        dailyAllowance: getAmountValue('alw-daily') || 0,
        costFuel: getAmountValue('alw-cost-fuel') || 0,
        costAllowance: getAmountValue('alw-cost-allowance') || 0,
        costTransport: getAmountValue('alw-cost-transport') || 0,
        remarks: document.getElementById('alw-remarks').value.trim()
    };
    const editing = allowanceEditId;
    try {
        const res = await authFetch(editing ? `/api/fleet/allowance/${editing}` : '/api/fleet/allowance', {
            method: editing ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'ስህተት ተፈጥሯል'); return; }
        cancelAllowanceEdit();
        invalidateFleetReports();
        fetchAllowances();
        fetchApprovalNotifications();
    } catch (err) {
        alert(editing ? 'ማስተካከል አልተቻለም' : 'መመዝገብ አልተቻለም');
    }
}

async function deleteAllowance(id) {
    const a = fleetAllowances.find(x => x._id === id);
    if (!confirm(a && allowanceAnySignedClient(a) ? 'ይህ ጥያቄ ፊርማ ተጀምሮበታል። መሰረዝ ይፈልጋሉ?' : 'ይህን የአበል ጥያቄ መሰረዝ ይፈልጋሉ?')) return;
    try {
        const res = await authFetch(`/api/fleet/allowance/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            let d = {};
            try { d = await res.json(); } catch (parseErr) {}
            alert(d.error || 'ማጥፋት አልተቻለም');
            return;
        }
        if (allowanceEditId === id) cancelAllowanceEdit();
        invalidateFleetReports();
        fetchAllowances();
    } catch (err) {
        alert('ማጥፋት አልተቻለም');
    }
}

// Opens the official form (same layout as the paper one) ready to print / save as PDF.
function printAllowanceForm(id) {
    const a = fleetAllowances.find(x => x._id === id);
    if (!a) return;
    const T = ALLOWANCE_FORM_TEXT;
    const win = window.open('', '_blank');
    if (!win) { alert('ቅጹን ለመክፈት የአሳሹ pop-up መፍቀድ አለበት'); return; }
    const money = n => (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fill = (v, min) => `<span class="fill" style="min-width:${min || 120}px;">${(v === '' || v == null) ? '&nbsp;' : fleetEsc(v)}</span>`;
    const box = on => `<span class="box">${on ? '&#10003;' : ''}</span>`;
    const travel = a.travelBy || [];
    // One signature: the image (if signed) and, under it, who signed and when.
    const sigParts = slot => {
        const p = a[slot];
        const img = p && p.signatureImage ? `<img src="${fleetEsc(p.signatureImage)}" alt="">` : '';
        const who = p && p.userId ? `${fleetEsc(p.fullName)}${p.signedAt ? ` — ${fleetEsc(isoToEthText(dateToISO(new Date(p.signedAt))))} ዓ.ም` : ''}` : '';
        return { img, who };
    };
    const sigCol = (slot, label) => {
        const s = sigParts(slot);
        return `<div class="sigcol"><div class="sig-label">${label}</div><div class="sig-box">${s.img}</div><div class="sig-name">${s.who || '&nbsp;'}</div></div>`;
    };
    const req = sigParts('requester');
    const origin = window.location.origin;
    win.document.write(`<!DOCTYPE html><html lang="am"><head><meta charset="utf-8"><title>${fleetEsc(T.title)}</title>
<style>
@page { size: A4; margin: 10mm 12mm; }
* { box-sizing: border-box; }
body { font-family: 'Nyala','Noto Sans Ethiopic','Abyssinica SIL','Segoe UI',serif; font-size: 11.5pt; color:#000; margin:0; }
table.hdr { width:100%; border-collapse:collapse; margin-bottom:10px; }
table.hdr td { border:1px solid #000; padding:4px 8px; vertical-align:middle; }
.logo { width:22%; text-align:center; } .logo img { max-width:100%; max-height:64px; }
.org { font-weight:bold; line-height:1.3; } .title { font-weight:bold; }
.small { font-size:10pt; }
.date { text-align:right; margin-bottom:8px; }
ol { padding-left:24px; margin:0; } ol li { margin-bottom:7px; line-height:1.45; }
.fill { display:inline-block; border-bottom:1px dotted #000; padding:0 6px; }
.fill.block { display:block; min-height:20px; margin-top:1px; }
.box { display:inline-block; width:38px; height:17px; border:1px solid #000; vertical-align:middle; text-align:center; margin:0 10px 0 4px; line-height:15px; }
.costs div { margin-left:150px; margin-top:2px; }
.sig-box { height:36px; border-bottom:1px dotted #000; text-align:center; } .sig-box img { max-height:34px; max-width:100%; }
.sig-name { font-size:9pt; min-height:12px; }
.nsig { display:inline-block; vertical-align:bottom; margin-left:8px; }
.nsig .sig-box { display:inline-block; width:150px; vertical-align:bottom; }
.nsig .sig-name { margin-left:2px; }
.sigs3 { display:flex; gap:18px; margin-top:12px; }
.sigcol { flex:1; text-align:center; }
.sig-label { font-weight:bold; font-size:10.5pt; }
.sigcol .sig-box { height:44px; margin-top:2px; }
@media print { .noprint { display:none; } }
</style></head><body>
<div id="sheet">
<table class="hdr">
 <tr>
  <td class="logo" rowspan="2"><img src="${origin}/images/logo.png" alt=""></td>
  <td class="org" colspan="1">${fleetEsc(T.orgAm)}<br>${fleetEsc(T.orgEn)}</td>
  <td colspan="2" class="small"><b>${fleetEsc(T.docNumberLabel)}፡ ${fleetEsc(T.docNumber)}</b><br>Document number</td>
 </tr>
 <tr>
  <td class="title">${fleetEsc(T.title)}</td>
  <td class="small">${fleetEsc(T.issueLabel)}: ${fleetEsc(T.issueNumber)}</td>
  <td class="small">${fleetEsc(T.pageLabel)}: ${fleetEsc(T.pageNumber)}<br>Page number</td>
 </tr>
</table>
<div class="date">${fleetEsc(T.date)}፡ ${fill(isoToEthText(a.requestDate) + ' ዓ.ም', 130)}</div>
<ol>
 <li>${fleetEsc(T.purpose)} <span class="fill block">${fleetEsc(a.purpose)}</span></li>
 <li>${fleetEsc(T.period)} ${fill(isoToEthText(a.fromDate), 100)} ${fleetEsc(T.periodTo)} ${fill(isoToEthText(a.toDate), 100)} <small>(${a.days || 1} ቀን)</small></li>
 <li>${fleetEsc(T.destination)} ${fill(a.destination, 240)}</li>
 <li>${fleetEsc(T.travel)} ${fleetEsc(T.travelOffice)} ${box(travel.includes('office_vehicle'))} ${fleetEsc(T.travelPublic)} ${box(travel.includes('public_transport'))} ${fleetEsc(T.travelAir)} ${box(travel.includes('airplane'))}</li>
 <li>${fleetEsc(T.salary)} ${fill(money(a.salary) + ' ብር', 180)}</li>
 <li>${fleetEsc(T.daily)} ${fill(money(a.dailyAllowance) + ' ብር', 180)}</li>
 <li class="costs">${fleetEsc(T.costs)} ${fleetEsc(T.costFuel)} ${fill(money(a.costFuel), 130)}
   <div>${fleetEsc(T.costAllowance)} ${fill(money(a.costAllowance), 130)}</div>
   <div>${fleetEsc(T.costTransport)} ${fill(money(a.costTransport), 130)}</div>
   <div><b>${fleetEsc(T.costTotal)}</b> ${fill(money(a.total), 130)}</div></li>
 <li>${fleetEsc(T.remarks)} <span class="fill block">${fleetEsc(a.remarks || '')}</span></li>
 <li>${fleetEsc(T.employee)} ${fill(a.employeeName, 200)}
   <span class="nsig"><b>${fleetEsc(T.sigRequester)}</b> <span class="sig-box">${req.img}</span><div class="sig-name">${req.who || '&nbsp;'}</div></span></li>
</ol>
<div class="sigs3">
 ${sigCol('supervisor', fleetEsc(T.sigSupervisor))}
 ${sigCol('authorizer', fleetEsc(T.sigAuthorizer))}
 ${sigCol('approver', fleetEsc(T.sigApprover))}
</div>
</div>
<p class="noprint" style="margin-top:24px; text-align:center;"><button onclick="window.print()" style="padding:8px 18px; font-size:14px;">አትም / PDF አስቀምጥ</button></p>
<script>
// The form must stay on ONE page: if the text is long enough to overflow an A4
// sheet, shrink everything a little instead of spilling onto a second page.
window.onload = function () {
  var sheet = document.getElementById('sheet');
  var maxH = 1020; // printable height of A4 (297mm - margins) in CSS pixels, with a little spare
  if (sheet && sheet.offsetHeight > maxH) document.body.style.zoom = Math.max(0.6, maxH / sheet.offsetHeight);
  setTimeout(function () { window.print(); }, 400);
};
<\/script>
</body></html>`);
    win.document.close();
}

function signNeedsNext(kind, slot) {
    return kind === 'allowance' ? slot !== 'approver' : slot === 'prepared';
}
function allowanceStatusPlain(item) {
    if (item.approver && item.approver.userId) return 'ተጸድቋል';
    if (item.pending && item.pending.userId) return 'ለመፈረም እየጠበቀ';
    if (item.requester && item.requester.userId) return 'ተፈርሟል';
    return 'ያልተፈረመ';
}


// =====================================================================
// ===== Keyboard entry: move between fields without the mouse =====
// =====================================================================
// Works in every form of the system.
//   Enter            -> next field            (on the LAST field it saves/submits the form)
//   Shift+Enter      -> previous field
//   ↓ / ↑            -> next / previous field (in text boxes)
//   → at the end of the text / ← at the start -> next / previous field
// Tab and Shift+Tab keep working as they always did. Multi-line boxes keep
// Enter for a new line, and number/time/date boxes keep their own arrow keys.
// A form can opt out with the attribute data-no-key-nav.
const KEYNAV_TEXT_TYPES = ['text', 'search', 'tel', 'email', 'url', 'password'];
const KEYNAV_ENTER_TYPES = KEYNAV_TEXT_TYPES.concat(['number', 'date', 'time', 'datetime-local', 'month', 'week', 'checkbox']);

function keyNavVisible(el) {
    for (let n = el; n && n !== document.body && n.nodeType === 1; n = n.parentElement) {
        if (n.hidden || window.getComputedStyle(n).display === 'none') return false;
    }
    return true;
}
function keyNavFields(form) {
    return Array.from(form.elements).filter(el => {
        const tag = el.tagName;
        if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') return false;
        if (el.disabled || el.readOnly) return false;
        const type = (el.type || '').toLowerCase();
        if (['hidden', 'button', 'submit', 'reset', 'image'].includes(type)) return false;
        return keyNavVisible(el);
    });
}
function keyNavFocus(el) {
    if (!el) return;
    el.focus();
    const type = (el.type || '').toLowerCase();
    if (el.tagName === 'INPUT' && KEYNAV_TEXT_TYPES.includes(type) && typeof el.select === 'function') el.select();
}

document.addEventListener('keydown', e => {
    const el = e.target;
    if (!el || e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
    const tag = el.tagName;
    if ((tag !== 'INPUT' && tag !== 'SELECT') || !el.form || el.form.hasAttribute('data-no-key-nav')) return;
    const type = (el.type || '').toLowerCase();
    const isText = tag === 'INPUT' && KEYNAV_TEXT_TYPES.includes(type);

    let dir = 0;      // +1 next, -1 previous
    let submitOnLast = false;
    if (e.key === 'Enter') {
        if (tag === 'INPUT' && !KEYNAV_ENTER_TYPES.includes(type)) return;   // file, radio, buttons: leave alone
        dir = e.shiftKey ? -1 : 1;
        submitOnLast = !e.shiftKey;
    } else if (!e.shiftKey && isText) {
        const atEnd = el.selectionStart === el.selectionEnd && el.selectionEnd === el.value.length;
        const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
        if (e.key === 'ArrowDown' || (e.key === 'ArrowRight' && atEnd)) dir = 1;
        else if (e.key === 'ArrowUp' || (e.key === 'ArrowLeft' && atStart)) dir = -1;
    }
    if (!dir) return;

    const fields = keyNavFields(el.form);
    const idx = fields.indexOf(el);
    if (idx === -1) return;
    e.preventDefault();
    const target = fields[idx + dir];
    if (target) keyNavFocus(target);
    else if (submitOnLast) {
        if (typeof el.form.requestSubmit === 'function') el.form.requestSubmit();
        else { const btn = el.form.querySelector('button[type="submit"], input[type="submit"]'); if (btn) btn.click(); }
    }
});
